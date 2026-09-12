import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { DocumentTypeConfigsRepository } from '../data/document-type-configs.repository.js';
import type {
  DocumentPhase,
  DocumentState,
  DocumentTypeDefinition,
} from '../domain/document-type.js';
import { DOCUMENT_TYPE_PERMISSIONS } from '../domain/document-permissions.js';
import { DOCUMENT_TYPE_CONFIGURED_EVENT } from '../domain/document.events.js';
import { publishEvent } from './documents-support.js';
import { DocumentTypeRegistry } from './document-type-registry.js';

/** The merged view of a registered type + its organization configuration. */
export interface DocumentTypeView {
  code: string;
  module: string;
  name: string;
  description: string | null;
  draftCapable: boolean;
  entryStates: DocumentState[];
  deletablePhases: DocumentPhase[];
  draftRequired: boolean;
  configured: boolean;
}

export interface ListDocumentTypesQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string | undefined;
}

export interface DocumentTypeSettings {
  definition: DocumentTypeDefinition;
  draftRequired: boolean;
}

/**
 * Document type metadata + per-organization configuration (Task 8 §6/§8).
 *
 * The registry is the source of truth for what types exist; this service
 * merges the registered structure with the organization's selection
 * (`draft_required` today) and enforces that only registered types can be
 * configured — there is no free-text type creation and no user-programmable
 * document schema.
 */
@Injectable()
export class DocumentTypesService {
  constructor(
    private readonly registry: DocumentTypeRegistry,
    private readonly configs: DocumentTypeConfigsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listDocumentTypes(
    query: ListDocumentTypesQuery,
  ): Promise<PaginatedResult<DocumentTypeView>> {
    await this.authorization.requireAllPermissions([
      DOCUMENT_TYPE_PERMISSIONS.VIEW,
    ]);
    await this.organizations.requireUsableOrganization(query.organizationId);

    const configured = await this.configs.list({
      organizationId: query.organizationId,
      orderBy: [{ documentType: 'asc' }],
      skip: 0,
      take: 10_000,
    });
    const byCode = new Map(
      configured.items.map((config) => [config.documentType, config]),
    );

    const search = query.search?.trim().toLowerCase() ?? '';
    const matched = this.registry.all().filter((definition) => {
      if (search === '') return true;
      return (
        definition.code.toLowerCase().includes(search) ||
        definition.module.toLowerCase().includes(search) ||
        definition.name.toLowerCase().includes(search)
      );
    });

    const { skip, take } = toOffset(query.page, query.pageSize);
    const page = matched.slice(skip, skip + take);
    return toPaginatedResult(
      page.map((definition) => {
        const config = byCode.get(definition.code);
        return this.toView(
          definition,
          config?.draftRequired ?? false,
          config !== undefined,
        );
      }),
      matched.length,
      query.page,
      query.pageSize,
    );
  }

  async getDocumentType(
    organizationId: string,
    code: string,
  ): Promise<DocumentTypeView> {
    await this.authorization.requireAllPermissions([
      DOCUMENT_TYPE_PERMISSIONS.VIEW,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const definition = this.registry.get(code);
    if (definition === undefined) {
      throw AppException.notFound('Document type', code);
    }
    const config = await this.configs.findForType(organizationId, code);
    return this.toView(
      definition,
      config?.draftRequired ?? false,
      config !== null,
    );
  }

  async configureDocumentType(
    organizationId: string,
    code: string,
    input: { draftRequired: boolean },
  ): Promise<DocumentTypeView> {
    await this.authorization.requireAllPermissions([
      DOCUMENT_TYPE_PERMISSIONS.CONFIGURE,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const definition = this.registry.get(code);
    if (definition === undefined) {
      throw AppException.notFound('Document type', code);
    }
    // Draft can only be required for a draft-capable type (Task 8 §8).
    if (input.draftRequired && !definition.draftCapable) {
      throw AppException.businessRule(
        `Document type "${code}" does not support the draft phase, so draft cannot be required.`,
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const existing = await this.configs.findForType(organizationId, code);
    const config =
      existing === null
        ? await this.createConfig(
            organizationId,
            code,
            input.draftRequired,
            now,
            actorId,
          )
        : ((await this.configs.update(existing.id, {
            draftRequired: input.draftRequired,
            updatedAt: now,
            updatedBy: actorId,
          })) ?? existing);

    await publishEvent(this.events, {
      type: DOCUMENT_TYPE_CONFIGURED_EVENT,
      aggregateType: 'DocumentType',
      aggregateId: config.id,
      payload: {
        organizationId,
        documentType: code,
        draftRequired: input.draftRequired,
      },
    });
    this.logger.log(
      'Document type configured',
      {
        organizationId,
        documentType: code,
        draftRequired: input.draftRequired,
      },
      DocumentTypesService.name,
    );
    return this.toView(definition, input.draftRequired, true);
  }

  /**
   * Cross-module reference resolution (AR-07): other modules (numbering series
   * configuration, future document modules) resolve a document type through
   * this method and never read the registry or invent codes. No permission of
   * its own — the calling service has already authorized its action.
   */
  requireDocumentType(code: string): DocumentTypeDefinition {
    const definition = this.registry.get(code);
    if (definition === undefined) {
      throw AppException.notFound('Document type', code);
    }
    return definition;
  }

  /**
   * Cross-module read of a type's organization settings (definition +
   * draft_required). Same no-permission convention as `requireDocumentType`.
   */
  async requireTypeSettings(
    organizationId: string,
    code: string,
  ): Promise<DocumentTypeSettings> {
    const definition = this.requireDocumentType(code);
    const config = await this.configs.findForType(organizationId, code);
    return {
      definition,
      draftRequired: config?.draftRequired ?? false,
    };
  }

  // ---- internals ----------------------------------------------------------

  private async createConfig(
    organizationId: string,
    code: string,
    draftRequired: boolean,
    now: Date,
    actorId: string | null,
  ) {
    try {
      return await this.configs.create({
        id: generateId(),
        organizationId,
        documentType: code,
        draftRequired,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Lost a create race: the winner's row is what we configure now.
        const raced = await this.configs.findForType(organizationId, code);
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  private toView(
    definition: DocumentTypeDefinition,
    draftRequired: boolean,
    configured: boolean,
  ): DocumentTypeView {
    return {
      code: definition.code,
      module: definition.module,
      name: definition.name,
      description: definition.description ?? null,
      draftCapable: definition.draftCapable,
      entryStates: [...definition.entryStates],
      deletablePhases: [...definition.deletablePhases],
      draftRequired,
      configured,
    };
  }
}
