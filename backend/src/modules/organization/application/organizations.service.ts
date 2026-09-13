import { Inject, Injectable } from '@nestjs/common';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listOrganizations(
    query: ListOrganizationsQuery,
  ): Promise<PaginatedResult<OrganizationDto>> {
    await this.authorization.requireAllPermissions([
      ORGANIZATION_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const pin = this.config.deploymentOrganizationId;
    if (pin !== null) {
      // A pinned deployment lists exactly its own organization (ADR-0025):
      // no filter can surface another tenant's row, not even an empty page
      // that hints at existence.
      const org = await this.repository.findById(pin);
      const visible =
        org !== null && this.matchesListFilters(org, query);
      const pageItems = visible && skip === 0 ? [org] : [];
      return toPaginatedResult(
        pageItems.map(toOrganizationDto),
        visible ? 1 : 0,
        query.page,
        query.pageSize,
      );
    }
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
    if (this.config.deploymentOrganizationId !== null) {
      // The deployment serves exactly one organization (ADR-0025): the pinned
      // organization is bootstrapped out-of-band, never created on demand.
      throw AppException.businessRule(
        'This deployment is pinned to a single organization; additional organizations cannot be created through the API.',
      );
    }
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
    this.assertOrganizationInScope(id);
    const organization = await this.repository.findById(id);
    if (organization === null) throw AppException.notFound('Organization', id);
    assertUsable('Organization', organization.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return organization;
  }

  /**
   * Deployment organization pin (ADR-0025). Every organization-scoped write
   * and every scoped by-id resolver calls this before touching data, so a
   * direct service caller is bounded to the same organization as the HTTP
   * surface. A mismatch answers `EntityNotFound` (not 403): the API never
   * confirms that an out-of-scope id exists (ADR-0021 §4).
   *
   * No-op when no pin is configured: structural scoping (ADR-0021) remains
   * the only guarantee and multi-organization isolation stays a product
   * decision (OQ-01/OQ-22).
   */
  assertOrganizationInScope(id: string): void {
    const pin = this.config.deploymentOrganizationId;
    if (pin !== null && id !== pin) {
      throw AppException.notFound('Organization', id);
    }
  }

  // ---- internals ----------------------------------------------------------

  /** Whether one organization row satisfies the list filters. */
  private matchesListFilters(
    organization: Organization,
    query: ListOrganizationsQuery,
  ): boolean {
    if (
      query.isActive !== undefined &&
      organization.isActive !== query.isActive
    ) {
      return false;
    }
    const search = query.search?.trim().toLowerCase();
    if (search !== undefined && search !== '') {
      return (
        organization.code.toLowerCase().includes(search) ||
        organization.name.toLowerCase().includes(search)
      );
    }
    return true;
  }

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
    this.assertOrganizationInScope(id);
    const organization = await this.repository.findById(id);
    if (organization === null) throw AppException.notFound('Organization', id);
    return organization;
  }
}


