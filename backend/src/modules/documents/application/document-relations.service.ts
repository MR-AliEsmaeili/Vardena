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
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { DocumentRelationsRepository } from '../data/document-relations.repository.js';
import type { DocumentRelation } from '../domain/document-relation.js';
import {
  planRelation,
  relationProblemMessage,
  toDocumentRelationDto,
  type DocumentEndpoint,
} from '../domain/document-relation.js';
import { RELATION_PERMISSIONS } from '../domain/document-permissions.js';
import {
  DOCUMENT_RELATION_CREATED_EVENT,
  DOCUMENT_RELATION_REMOVED_EVENT,
} from '../domain/document.events.js';
import { publishEvent } from './documents-support.js';

const SORTABLE_FIELDS: Record<string, string> = {
  createdAt: 'createdAt',
};

export interface ListRelationsQuery {
  organizationId: string;
  relationKind?: string | undefined;
  sourceModule?: string | undefined;
  sourceDocumentType?: string | undefined;
  sourceDocumentId?: string | undefined;
  targetModule?: string | undefined;
  targetDocumentType?: string | undefined;
  targetDocumentId?: string | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface CreateRelationInput {
  organizationId: string;
  source: DocumentEndpoint;
  target: DocumentEndpoint;
  relationKind: string;
  quantity?: string | null | undefined;
  createdByProcess?: boolean | undefined;
}

/**
 * Document relations (Task 8 §13, ADR-0019 §5).
 *
 * The Foundation stores and looks up typed links between logical documents.
 * Shape/kind/quantity rules are validated here (via the framework-free
 * `planRelation`); cross-module existence of the referenced documents is the
 * creating (owning) module's responsibility — the generic HTTP surface cannot
 * dereference another module's tables (AR-07), and the module-internal
 * `linkDocuments` path is called by the module that already knows its own rows.
 */
@Injectable()
export class DocumentRelationsService {
  constructor(
    private readonly repository: DocumentRelationsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listRelations(
    query: ListRelationsQuery,
  ): Promise<PaginatedResult<ReturnType<typeof toDocumentRelationDto>>> {
    await this.authorization.requireAllPermissions([RELATION_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        relationKind: query.relationKind,
        sourceModule: query.sourceModule,
        sourceDocumentType: query.sourceDocumentType,
        sourceDocumentId: query.sourceDocumentId,
        targetModule: query.targetModule,
        targetDocumentType: query.targetDocumentType,
        targetDocumentId: query.targetDocumentId,
      },
      orderBy: resolveSort(query.sort),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toDocumentRelationDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getRelation(organizationId: string, id: string) {
    await this.authorization.requireAllPermissions([RELATION_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(organizationId);
    return toDocumentRelationDto(
      await this.requireRelationInOrganization(organizationId, id),
    );
  }

  /** HTTP path: creating a relation is an explicit, permission-gated action. */
  async createRelation(input: CreateRelationInput) {
    await this.authorization.requireAllPermissions([
      RELATION_PERMISSIONS.CREATE,
    ]);
    return this.linkDocuments(input);
  }

  async deleteRelation(organizationId: string, id: string) {
    await this.authorization.requireAllPermissions([
      RELATION_PERMISSIONS.DELETE,
    ]);
    const existing = await this.requireRelationInOrganization(
      organizationId,
      id,
    );
    const deleted = await this.repository.delete(id);
    if (deleted === null) throw AppException.notFound('Document relation', id);
    await publishEvent(this.events, {
      type: DOCUMENT_RELATION_REMOVED_EVENT,
      aggregateType: 'DocumentRelation',
      aggregateId: deleted.id,
      payload: {
        id: deleted.id,
        organizationId: deleted.organizationId,
        relationKind: deleted.relationKind,
        source: deleted.source,
        target: deleted.target,
      },
    });
    this.logger.log(
      'Document relation removed',
      { relationId: deleted.id, organizationId: deleted.organizationId },
      DocumentRelationsService.name,
    );
    return toDocumentRelationDto(existing);
  }

  /**
   * Module-internal link creation (AR-07): a future owning module creates
   * relations through this method inside its own transaction. No permission of
   * its own — the calling module has already authorized the operation that
   * produces the link. `createdByProcess` records automation vs user origin.
   */
  async linkDocuments(input: CreateRelationInput) {
    const planned = planRelation({
      kind: input.relationKind,
      source: input.source,
      target: input.target,
      quantity: input.quantity,
    });
    if (planned.problem !== null) {
      throw AppException.businessRule(relationProblemMessage(planned.problem));
    }
    await this.organizations.requireUsableOrganization(input.organizationId);

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const created = await this.repository.create({
      id: generateId(),
      organizationId: input.organizationId,
      sourceModule: input.source.module,
      sourceDocumentType: input.source.documentType,
      sourceDocumentId: input.source.documentId,
      sourceLineId: input.source.lineId ?? null,
      targetModule: input.target.module,
      targetDocumentType: input.target.documentType,
      targetDocumentId: input.target.documentId,
      targetLineId: input.target.lineId ?? null,
      relationKind: input.relationKind,
      quantity: input.quantity ?? null,
      createdByProcess: input.createdByProcess ?? false,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      updatedBy: actorId,
    });
    await publishEvent(this.events, {
      type: DOCUMENT_RELATION_CREATED_EVENT,
      aggregateType: 'DocumentRelation',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        relationKind: created.relationKind,
        source: created.source,
        target: created.target,
      },
    });
    this.logger.log(
      'Document relation created',
      {
        relationId: created.id,
        organizationId: created.organizationId,
        relationKind: created.relationKind,
      },
      DocumentRelationsService.name,
    );
    return toDocumentRelationDto(created);
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Organization-scoped by-id resolution (AR-07, ADR-0016). A relation that
   * does not exist or belongs to another organization is reported as *not
   * found*, so the API never confirms that an id from another tenant exists.
   */
  async requireRelationInOrganization(
    organizationId: string,
    id: string,
  ): Promise<DocumentRelation> {
    const relation = await this.repository.findById(id);
    if (relation === null || relation.organizationId !== organizationId) {
      throw AppException.notFound('Document relation', id);
    }
    return relation;
  }
}

// ---- Internal helpers ----

function resolveSort(
  sort: string | undefined,
): Array<Record<string, 'asc' | 'desc'>> {
  if (sort === undefined || sort === '') {
    return [{ createdAt: 'desc' }];
  }
  return sort.split(',').map((entry) => {
    const [field, direction] = entry.split(':');
    const mapped = field === undefined ? undefined : SORTABLE_FIELDS[field];
    if (mapped === undefined || (direction !== 'asc' && direction !== 'desc')) {
      throw AppException.validation([
        {
          field: 'sort',
          message: `Cannot sort by "${field ?? ''}". Allowed: ${Object.keys(SORTABLE_FIELDS).join(', ')}.`,
          code: 'isSortableField',
        },
      ]);
    }
    return { [mapped]: direction };
  });
}
