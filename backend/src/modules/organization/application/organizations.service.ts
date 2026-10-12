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
import {
  getPrincipal,
  getRequestContext,
} from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsRepository } from '../data/organizations.repository.js';
import { OrganizationMembershipsRepository } from '../data/organization-memberships.repository.js';
import type {
  Organization,
  OrganizationDateTimeSettings,
  OrganizationDto,
} from '../domain/organization.js';
import {
  DEFAULT_DATE_TIME_SETTINGS,
  toDateTimeSettings,
  toOrganizationDto,
} from '../domain/organization.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { normalizeCode, normalizeName } from '../domain/master-data.js';
import { ORGANIZATION_PERMISSIONS } from '../domain/organization-permissions.js';
import { LicensingService } from '../../licensing/application/licensing.service.js';
import {
  ORGANIZATION_CREATED_EVENT,
  ORGANIZATION_DISABLED_EVENT,
  ORGANIZATION_ENABLED_EVENT,
  ORGANIZATION_UPDATED_EVENT,
} from '../domain/organization.events.js';
import {
  assertCodeAndName,
  assertTimeZone,
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

/**
 * Identity of the organization row the installation bootstrap creates for the
 * configured `DEPLOYMENT_ORGANIZATION_ID` (ADR-0025). Only the initial values:
 * an operator renames it afterwards through the ordinary Organization.Edit
 * API, and a later bootstrap never overwrites the stored code/name.
 */
export const DEPLOYMENT_ORGANIZATION_BOOTSTRAP_CODE = 'MAIN';
export const DEPLOYMENT_ORGANIZATION_BOOTSTRAP_NAME = 'سازمان اصلی';

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
  timeZone?: string | undefined;
}

export interface UpdateOrganizationInput {
  code?: string | undefined;
  name?: string | undefined;
  /** C-63: must be a resolvable IANA zone. */
  timeZone?: string | undefined;
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
    /**
     * The principal → organization binding (Task 19, ODR-3). Injected here —
     * in the module that owns organizational scope — because this service is
     * the cross-module reference-resolution entry point (AR-07): every
     * organization-scoped path in every module resolves its organization
     * through `requireUsableOrganization` / `assertOrganizationInScope`, so
     * binding the principal there confines them all without each module
     * reimplementing the check.
     */
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly licensing: LicensingService,
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
      const visible = org !== null && this.matchesListFilters(org, query);
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

  /**
   * The organization BOOTSTRAP read (Organization Bootstrap & Context
   * Foundation): the organizations the AUTHENTICATED SESSION may actually use
   * as its working scope.
   *
   * This is deliberately a different authority than `listOrganizations`:
   * `listOrganizations` is the `Organization.Organization.View`
   * ADMINISTRATION catalog (every organization the deployment serves, for a
   * principal who may manage them), while this method answers "which
   * organizations is THIS principal a member of" — decided by
   * `organization_memberships` alone, exactly like every other
   * `assertOrganizationInScope` consumer, and carrying NO permission
   * requirement of its own (mirrors `GET /license/current` and
   * `GET /permissions/effective`: an authenticated self/bootstrap read).
   *
   * Conflating the two would mean an ordinary member who was never granted
   * the administration permission could never resolve an organization
   * context at all — the organization bootstrap gate would be permanently
   * stuck behind an unrelated administrative grant. It would also mean a
   * principal holding `Organization.Organization.View` without being a
   * member of anything could see (and be offered to select) organizations it
   * has no membership in, which the deployment pin / ODR-3 chokepoint would
   * then reject on every subsequent scoped request — a context the user could
   * "choose" and then use nowhere.
   *
   * Lifecycle: an inactive organization is excluded, exactly like a
   * deactivated membership would be (`master-data-strategy.md` §7.4) — a
   * disabled organization must not become, or remain, anyone's active
   * working scope.
   */
  async listMyOrganizations(): Promise<OrganizationDto[]> {
    const principal = getPrincipal();
    if (principal === undefined) {
      // Belt-and-braces: the route only reaches here behind `AuthGuard`.
      throw AppException.unauthorized('Authentication is required.');
    }

    const pin = this.config.deploymentOrganizationId;
    if (pin !== null) {
      // A pinned deployment (ADR-0025) has exactly one organization to
      // discover; membership of THAT organization is still required — the
      // pin names the deployment's organization, it does not grant access
      // to it.
      const membership = await this.memberships.findMembership(
        principal.userId,
        pin,
      );
      if (membership === null) return [];
      const organization = await this.repository.findById(pin);
      return organization !== null && organization.isActive
        ? [toOrganizationDto(organization)]
        : [];
    }

    const organizationIds = await this.memberships.listOrganizationIdsForUser(
      principal.userId,
    );
    if (organizationIds.length === 0) return [];
    const organizations =
      await this.repository.listActiveByIds(organizationIds);
    return organizations.map(toOrganizationDto);
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
    const allocation = await this.licensing.organizationAllocation();
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    assertCodeAndName(code, name);
    if (input.timeZone !== undefined) assertTimeZone(input.timeZone);

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
      const allocated = await this.repository.createWithinLicenseLimit(
        {
          id: generateId(),
          code,
          name,
          isActive: true,
          // The calendar is a fixed Jalali-first MVP policy. The only
          // per-organization date/time value is the IANA zone.
          timeZone: input.timeZone ?? DEFAULT_DATE_TIME_SETTINGS.timeZone,
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        allocation,
      );
      if (allocated === null) this.licensing.throwOrganizationLimitReached();
      created = allocated;
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

    if (input.timeZone !== undefined) assertTimeZone(input.timeZone);

    const patch: {
      code?: string;
      name?: string;
      timeZone?: string;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (name !== undefined) patch.name = name;
    if (input.timeZone !== undefined) patch.timeZone = input.timeZone;

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
   * ODR-3 (Task 19): the caller must also be a MEMBER of the organization
   * whenever a principal is in flight — `assertOrganizationInScope` enforces
   * that binding here. System context (no HTTP request) keeps the established
   * trusted-caller posture (bootstrap, worker, tests calling services
   * directly); it is not reachable from HTTP.
   *
   * @throws `EntityNotFound` when no such organization exists, or when the
   *   caller is not a member (a foreign organization is indistinguishable
   *   from a missing one — AC-I-16, no IDOR).
   * @throws `BusinessRuleViolation` when it is disabled and the caller is
   *   creating/reassigning rather than reading an existing link.
   */
  /**
   * The date/time policy of an organization (C-63, ADR-0042 §6).
   *
   * The cross-module rendering entry point (AR-07), shaped like
   * `requireUsableOrganization`: the caller has already authorized its own
   * request and asserted its own scope, so this read carries no permission of
   * its own — but it DOES assert the principal-bound organization scope,
   * exactly like every other organization-scoped path (Task 19, ODR-3), so it
   * can never leak another tenant's settings.
   *
   * Read it ONCE per response and pass the resulting value to the DTO mapper;
   * a per-field lookup would multiply queries and could mix two settings
   * versions inside one response.
   */
  async getDateTimeSettings(id: string): Promise<OrganizationDateTimeSettings> {
    await this.assertOrganizationInScope(id);
    const organization = await this.repository.findById(id);
    if (organization === null) throw AppException.notFound('Organization', id);
    return toDateTimeSettings(organization);
  }

  async requireUsableOrganization(
    id: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Organization> {
    await this.assertOrganizationInScope(id);
    const organization = await this.repository.findById(id);
    if (organization === null) throw AppException.notFound('Organization', id);
    assertUsable('Organization', organization.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return organization;
  }

  /**
   * Organization scope assertion (ADR-0025 + ODR-3): the deployment pin, then
   * the principal → organization binding. This is the single chokepoint every
   * organization-scoped read and write passes through — the services of every
   * module call it (directly or via `requireUsableOrganization` /
   * `mustFindInOrganization` resolvers), so a direct service caller is bounded
   * exactly like an HTTP caller.
   *
   * 1. **Deployment pin (ADR-0025):** a mismatch answers `EntityNotFound`
   *    (not 403) — the API never confirms that an out-of-scope id exists.
   *    No-op when no pin is configured.
   * 2. **Principal binding (ODR-3, Task 19):** when a request context with an
   *    authenticated principal is in flight, the principal must hold a
   *    membership of the organization; otherwise `EntityNotFound` again — a
   *    permission holder must not learn that another organization exists by
   *    probing its ids, and "no membership" must be indistinguishable from
   *    "no organization". The check reads `organization_memberships` on every
   *    call with no cache (the same immediate-revocation posture as RBAC
   *    permission evaluation, docs/security.md §3).
   *
   * Contexts:
   * - **system context** (no request context — bootstrap, worker, direct
   *   service use in tests): no principal check. This mirrors
   *   `AuthorizationService.requireAllPermissions`: authorization is the
   *   caller's concern, and it is not reachable from HTTP.
   * - **request context without a principal**: 401, mirroring the
   *   authorization service (an anonymous caller is an authentication
   *   failure, not a scope failure).
   */
  async assertOrganizationInScope(id: string): Promise<void> {
    this.assertDeploymentOrganizationPin(id);
    const context = getRequestContext();
    if (context === undefined) {
      // System/internal context (no HTTP request in flight): trusted caller,
      // the established posture (see `AuthorizationService.requireAllPermissions`).
      return;
    }
    const principal = getPrincipal();
    if (principal === undefined) {
      throw AppException.unauthorized('Authentication is required.');
    }
    const membership = await this.memberships.findMembership(
      principal.userId,
      id,
    );
    if (membership === null) {
      throw AppException.notFound('Organization', id);
    }
  }

  /**
   * Deployment organization pin (ADR-0025) — the pin half of the scope
   * assertion, on its own. Public for the membership ADMINISTRATION path
   * (`OrganizationMembershipsService`), which applies the pin first and then
   * decides whether the acting principal's membership is required: it always
   * is, except for the one bootstrap case (granting the FIRST member of an
   * organization whose membership set is empty), where there is no membership
   * to hold yet.
   */
  assertDeploymentOrganizationPin(id: string): void {
    const pin = this.config.deploymentOrganizationId;
    if (pin !== null && id !== pin) {
      throw AppException.notFound('Organization', id);
    }
  }

  /**
   * The membership administration ORGANIZATION resolver: the organization
   * must exist, be inside the deployment pin and be usable. It carries no
   * principal binding of its own — the caller
   * (`OrganizationMembershipsService`) performs the ODR-3 membership
   * assertion around it, because only the caller knows whether the operation
   * is the bootstrap grant of the first member. Everything else about the
   * posture matches `requireUsableOrganization` (404 for unknown/foreign ids,
   * 422 for a disabled organization, which may not anchor new records —
   * master-data-strategy.md §7.4).
   *
   * Not a general-purpose entry point: organization-scoped DATA paths must
   * keep using `requireUsableOrganization` / `assertOrganizationInScope`,
   * which are principal-bound unconditionally.
   */
  async requireAdministrableOrganization(id: string): Promise<Organization> {
    this.assertDeploymentOrganizationPin(id);
    const organization = await this.repository.findById(id);
    if (organization === null) throw AppException.notFound('Organization', id);
    assertUsable('Organization', organization.isActive, {
      allowInactive: false,
    });
    return organization;
  }

  /**
   * INSTALLATION ONLY — materialize the organization named by
   * `DEPLOYMENT_ORGANIZATION_ID` (ADR-0025 "bootstrapped out-of-band").
   *
   * ADR-0025 pins a deployment to exactly one organization id but deliberately
   * refuses to create organizations through the API in pinned mode, so a fresh
   * installation previously had a pinned id pointing at no row and no
   * documented, non-SQL way to create it. This method is that missing
   * out-of-band step and nothing more:
   *
   * - it exists only for the post-migration `bootstrap:system-admin` command
   *   and is refused when an HTTP request is in flight, so it adds no API
   *   surface and no authorization bypass;
   * - it creates at most the single pinned row, with the pinned id, so
   *   repeated installs can never produce a second organization;
   * - it returns `null` when no pin is configured — an unpinned deployment
   *   stays in ADR-0021 structural mode, where the administrator creates the
   *   first organization through the ordinary API and takes the existing
   *   ODR-3 first-member grant. No organization is invented there.
   */
  async ensureDeploymentOrganization(): Promise<{
    organization: Organization;
    created: boolean;
  } | null> {
    const pin = this.config.deploymentOrganizationId;
    if (pin === null) return null;
    if (getRequestContext() !== undefined) {
      // Fail closed: this is an installation command operation, never a
      // request-serving one. No controller may reach it.
      throw AppException.forbidden(
        'The deployment organization can only be provisioned by the installation bootstrap command.',
      );
    }

    const existing = await this.repository.findById(pin);
    if (existing !== null) return { organization: existing, created: false };

    // An installation that has never activated a license provisions nothing:
    // organizations are a licensed capability (ADR-0030). Bootstrap is
    // idempotent and reconciling, so the operator activates the license and
    // re-runs the command — the pinned organization is created then. The
    // alternative (creating it unlicensed) would be a licensing bypass.
    if (await this.licensing.isUnlicensed()) {
      this.logger.warn(
        'Deployment organization provisioning deferred: the installation is not licensed yet',
        { organizationId: pin },
        OrganizationsService.name,
      );
      return null;
    }

    const allocation = await this.licensing.organizationAllocation();
    const now = new Date();
    try {
      const created = await this.repository.createWithinLicenseLimit(
        {
          id: pin,
          code: DEPLOYMENT_ORGANIZATION_BOOTSTRAP_CODE,
          name: DEPLOYMENT_ORGANIZATION_BOOTSTRAP_NAME,
          isActive: true,
          // Calendar display is a fixed Jalali-first MVP policy; the only
          // organization-specific setting here is the IANA time zone.
          timeZone: DEFAULT_DATE_TIME_SETTINGS.timeZone,
          createdAt: now,
          updatedAt: now,
          createdBy: null,
        },
        allocation,
      );
      if (created === null) this.licensing.throwOrganizationLimitReached();
      await publishEvent(this.events, {
        type: ORGANIZATION_CREATED_EVENT,
        aggregateType: 'Organization',
        aggregateId: created.id,
        payload: { id: created.id, code: created.code },
      });
      this.logger.log(
        'Deployment organization provisioned by installation bootstrap',
        { organizationId: created.id },
        OrganizationsService.name,
      );
      return { organization: created, created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent bootstrap won the race (same pinned id, or the code is
        // already taken by an operator-renamed row). Adopt the real state.
        const raced = await this.repository.findById(pin);
        if (raced !== null) return { organization: raced, created: false };
        throw AppException.conflict(
          'The deployment organization code is already used by a different organization; rename it or set DEPLOYMENT_ORGANIZATION_ID to that organization.',
        );
      }
      throw error;
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

  /**
   * How many organizations exist, for the licensing module's capacity-conflict
   * check (PDR-11 §8.6, L-04). Cross-module internal contract (AR-07): carries
   * no permission of its own, exactly like the `requireUsable*` methods — the
   * calling operation has already performed its own authorization — and counts
   * through THIS module's repository (`countAll()`), the exact count the
   * creation guard enforces.
   */
  async countLicensedOrganizations(): Promise<number> {
    return this.repository.countAll();
  }

  private async mustFind(id: string): Promise<Organization> {
    await this.assertOrganizationInScope(id);
    const organization = await this.repository.findById(id);
    if (organization === null) throw AppException.notFound('Organization', id);
    return organization;
  }
}
