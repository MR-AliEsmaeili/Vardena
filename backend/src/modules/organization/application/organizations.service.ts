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
import { OrganizationsRepository } from '../data/organizations.repository.js';
import type { Organization, OrganizationDto } from '../domain/organization.js';
import { toOrganizationDto } from '../domain/organization.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { normalizeCode, normalizeName } from '../domain/master-data.js';
import { ORGANIZATION_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  ORGANIZATION_CREATED_EVENT,
  ORGANIZATION_DISABLED_EVENT,
  ORGANIZATION_ENABLED_EVENT,
  ORGANIZATION_UPDATED_EVENT,
} from '../domain/organization.events.js';
import {
  assertCodeAndName,
  assertUsable,
  publishEvent,
  resolveSort,
} from './master-data-support.js';

/** Sortable list fields; anything else is rejected (`architecture.md` §9). */
const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListOrganizationsQuery {
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateOrganizationInput {
  code: string;
  name: string;
}

export interface UpdateOrganizationInput {
  code?: string | undefined;
  name?: string | undefined;
}

/**
 * Organization administration + the module's public read surface for the
 * organization root.
 *
 * Every administration method requires its `Organization.Organization.*`
 * permission **in this layer** (AR-04, AR-21), not only in the route guard: a
 * worker or another service calling the method directly is authorized the same
 * way, and an HTTP request without the permission is rejected here even if a
 * future controller forgets the guard.
 *
 * `requireUsableOrganization` is the cross-module reference-resolution entry
 * point (AR-07): other modules resolve an organization through it instead of
 * reading `organization.organizations`. It carries no permission of its own —
 * the calling service has already performed its own authorization check, and
 * adding `Organization.Organization.View` here would mean every user who may
 * create an item also needs permission to read organizations.
 *
 * Not implemented (deliberately, per the Task 6 scope): the fiscal calendar,
 * numbering series, tax definitions, workflow definitions and custom-field
 * definitions that ADR-0020 also assigns to this module.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly repository: OrganizationsRepository,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listOrganizations(
    query: ListOrganizationsQuery,
  ): Promise<PaginatedResult<OrganizationDto>> {
    await this.authorization.requireAllPermissions([
      ORGANIZATION_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: { isActive: query.isActive, search: query.search },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toOrganizationDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getOrganization(id: string): Promise<OrganizationDto> {
    await this.authorization.requireAllPermissions([
      ORGANIZATION_PERMISSIONS.VIEW,
    ]);
    return toOrganizationDto(await this.mustFind(id));
  }

  async createOrganization(
    input: CreateOrganizationInput,
  ): Promise<OrganizationDto> {
    await this.authorization.requireAllPermissions([
      ORGANIZATION_PERMISSIONS.CREATE,
    ]);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    assertCodeAndName(code, name);

    const existing = await this.repository.findByCode(code);
    if (existing !== null) {
      throw AppException.conflict(
        'An organization with that code already exists.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let created: Organization;
    try {
      created = await this.repository.create({
        id: generateId(),
        code,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'An organization with that code already exists.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: ORGANIZATION_CREATED_EVENT,
      aggregateType: 'Organization',
      aggregateId: created.id,
      payload: { id: created.id, code: created.code },
    });
    this.logger.log(
      'Organization created',
      { organizationId: created.id },
      OrganizationsService.name,
    );
    return toOrganizationDto(created);
  }

  async updateOrganization(
    id: string,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationDto> {
    await this.authorization.requireAllPermissions([
      ORGANIZATION_PERMISSIONS.EDIT,
    ]);
    const current = await this.mustFind(id);

    const code =
      input.code === undefined ? undefined : normalizeCode(input.code);
    const name =
      input.name === undefined ? undefined : normalizeName(input.name);
    // Validate the values that will be in effect after the update: unchanged
    // fields keep their (already valid) current value, so only what the caller
    // supplied is re-checked.
    assertCodeAndName(code ?? current.code, name ?? current.name);
    if (code !== undefined && code !== current.code) {
      const taken = await this.repository.findByCodeExcludingId(code, id);
      if (taken !== null) {
        throw AppException.conflict(
          'An organization with that code already exists.',
        );
      }
    }

    const patch: {
      code?: string;
      name?: string;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (name !== undefined) patch.name = name;

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Organization', id);

    await publishEvent(this.events, {
      type: ORGANIZATION_UPDATED_EVENT,
      aggregateType: 'Organization',
      aggregateId: updated.id,
      payload: { id: updated.id, code: updated.code },
    });
    return toOrganizationDto(updated);
  }

  async enableOrganization(id: string): Promise<OrganizationDto> {
    return this.setActive(id, true, ORGANIZATION_PERMISSIONS.ENABLE);
  }

  async disableOrganization(id: string): Promise<OrganizationDto> {
    return this.setActive(id, false, ORGANIZATION_PERMISSIONS.DISABLE);
  }

  /**
   * Cross-module reference resolution (AR-07). Returns the organization when it
   * exists and may be used as the owner of a record.
   *
   * @throws `EntityNotFound` when no such organization exists.
   * @throws `BusinessRuleViolation` when it is disabled and the caller is
   *   creating/reassigning rather than reading an existing link.
   */
  async requireUsableOrganization(
    id: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Organization> {
    const organization = await this.repository.findById(id);
    if (organization === null) throw AppException.notFound('Organization', id);
    assertUsable('Organization', organization.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return organization;
  }

  // ---- internals ----------------------------------------------------------

  private async setActive(
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<OrganizationDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFind(id);
    if (current.isActive === isActive) return toOrganizationDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Organization', id);

    await publishEvent(this.events, {
      type: isActive ? ORGANIZATION_ENABLED_EVENT : ORGANIZATION_DISABLED_EVENT,
      aggregateType: 'Organization',
      aggregateId: updated.id,
      payload: { id: updated.id, code: updated.code },
    });
    this.logger.log(
      isActive ? 'Organization enabled' : 'Organization disabled',
      { organizationId: updated.id },
      OrganizationsService.name,
    );
    return toOrganizationDto(updated);
  }

  private async mustFind(id: string): Promise<Organization> {
    const organization = await this.repository.findById(id);
    if (organization === null) throw AppException.notFound('Organization', id);
    return organization;
  }
}


