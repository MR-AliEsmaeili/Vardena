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
import { FiscalYearsRepository } from '../data/fiscal-years.repository.js';
import {
  AreaDisabledError,
  FiscalYearNotEditableError,
  FiscalYearOverlapError,
  FiscalYearRangeExcludesPeriodsError,
  FiscalYearSealBlockedError,
  FiscalYearTransitionConflictError,
} from '../data/accounting-calendar-errors.js';
import type { FiscalYear, FiscalYearDto } from '../domain/fiscal-year.js';
import {
  planFiscalYearTransition,
  toFiscalYearDto,
  type FiscalYearStatus,
  type FiscalYearTransition,
} from '../domain/fiscal-year.js';
import { parseDateOnly } from '../domain/date-range.js';
import { normalizeCode, normalizeTitle } from '../domain/master-data.js';
import { FISCAL_YEAR_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  ACCOUNTING_PERIOD_CLOSED_EVENT,
  type AccountingPeriodTransitionEventPayload,
} from '../domain/accounting.events.js';
import {
  FISCAL_YEAR_CLOSED_EVENT,
  FISCAL_YEAR_CREATED_EVENT,
  FISCAL_YEAR_REOPENED_EVENT,
  FISCAL_YEAR_SEALED_EVENT,
  FISCAL_YEAR_UNSEALED_EVENT,
} from '../domain/accounting.events.js';
import {
  assertCodeAndTitle,
  assertReason,
  assertUsable,
  publishEvent,
  resolveSort,
} from './accounting-support.js';
import { FinancialAreasService } from './financial-areas.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  title: 'title',
  startDate: 'startDate',
  endDate: 'endDate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

const TRANSITION_PERMISSIONS: Record<FiscalYearTransition, string> = {
  close: FISCAL_YEAR_PERMISSIONS.CLOSE,
  reopen: FISCAL_YEAR_PERMISSIONS.REOPEN,
  seal: FISCAL_YEAR_PERMISSIONS.SEAL,
  unseal: FISCAL_YEAR_PERMISSIONS.UNSEAL,
};

const TRANSITION_EVENTS = {
  close: FISCAL_YEAR_CLOSED_EVENT,
  reopen: FISCAL_YEAR_REOPENED_EVENT,
  seal: FISCAL_YEAR_SEALED_EVENT,
  unseal: FISCAL_YEAR_UNSEALED_EVENT,
} as const;

export interface ListFiscalYearsQuery {
  /** Mandatory: a year list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  financialAreaId?: string | undefined;
  status?: FiscalYearStatus | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateFiscalYearInput {
  organizationId: string;
  financialAreaId: string;
  code: string;
  title: string;
  /** Inclusive bounds, `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
  /** Optional link to the previous year of the same (organization, area). */
  priorYearId?: string | null | undefined;
}

export interface UpdateFiscalYearInput {
  code?: string | undefined;
  title?: string | undefined;
  /** Date edits require the year to be open (fail closed). */
  startDate?: string | undefined;
  endDate?: string | undefined;
  isActive?: boolean | undefined;
  /** Set, replace, or (`null`) clear the prior-year link. */
  priorYearId?: string | null | undefined;
}

export interface TransitionFiscalYearInput {
  organizationId: string;
  id: string;
  transition: FiscalYearTransition;
  reason: string;
}

/**
 * Fiscal year administration (contract §6, AC-I-03/AC-I-04, ADR-0026).
 *
 * A year belongs to exactly one financial area of one organization; years
 * of one (organization, area) never overlap (AC-I-03). The overlap guard
 * is evaluated inside the area-locked repository transaction — never as a
 * pre-check alone — so concurrent creates cannot both slip through.
 *
 * Lifecycle (contract §6.3): `open → closed → sealed`, plus explicit
 * `reopen` (closed → open) and `unseal` (sealed → closed). Every move is
 * permission-gated, reasoned, audited and published; invalid moves are
 * rejected with 422, and a year that moved while the request was in
 * flight answers 409.
 *
 * Two fail-closed readings, documented (not contract-explicit):
 * - year dates stay editable only while the year is open AND no document
 *   references it (contract §6.5 states the document half; no documents
 *   exist in Task 10.2, so the open-only half is what bites);
 * - sealing requires every period closed (contract §6.4 leaves the
 *   "require vs close-them" fork to OQ-23; requiring is the fail-closed
 *   branch, and the close cascade already closes what close may close).
 */
@Injectable()
export class FiscalYearsService {
  constructor(
    private readonly repository: FiscalYearsRepository,
    private readonly financialAreas: FinancialAreasService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listFiscalYears(
    query: ListFiscalYearsQuery,
  ): Promise<PaginatedResult<FiscalYearDto>> {
    await this.authorization.requireAllPermissions([
      FISCAL_YEAR_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    // A supplied parent id is a scope assertion, not a harmless filter:
    // otherwise a valid foreign area would incorrectly look like an empty
    // list and leak hierarchy behavior. Keep historical inactive areas
    // readable; this is ownership validation, not a writable-reference gate.
    if (query.financialAreaId !== undefined) {
      await this.financialAreas.requireFinancialAreaInOrganization(
        query.financialAreaId,
        query.organizationId,
      );
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        financialAreaId: query.financialAreaId,
        status: query.status,
        isActive: query.isActive,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toFiscalYearDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getFiscalYear(
    organizationId: string,
    id: string,
  ): Promise<FiscalYearDto> {
    await this.authorization.requireAllPermissions([
      FISCAL_YEAR_PERMISSIONS.VIEW,
    ]);
    return toFiscalYearDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createFiscalYear(input: CreateFiscalYearInput): Promise<FiscalYearDto> {
    await this.authorization.requireAllPermissions([
      FISCAL_YEAR_PERMISSIONS.CREATE,
    ]);
    const code = normalizeCode(input.code);
    const title = normalizeTitle(input.title);
    assertCodeAndTitle(code, title);
    const startDate = parseDateInput(input.startDate, 'startDate');
    const endDate = parseDateInput(input.endDate, 'endDate');
    if (endDate.getTime() < startDate.getTime()) {
      throw AppException.businessRule(
        'The fiscal year end date must be on or after the start date.',
      );
    }

    await this.organizations.requireUsableOrganization(input.organizationId);
    // A disabled area blocks new years (contract §5.6); a foreign area
    // answers 404, never 403 (AC-I-16).
    const area =
      await this.financialAreas.requireUsableFinancialAreaInOrganization(
        input.financialAreaId,
        input.organizationId,
      );

    const priorYearId = input.priorYearId ?? null;
    if (priorYearId !== null) {
      await this.requirePriorYearInArea(
        priorYearId,
        input.organizationId,
        area.id,
        null,
      );
    }

    const existing = await this.repository.findByCode(
      input.organizationId,
      area.id,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A fiscal year with that code already exists in this financial area.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let created: FiscalYear;
    try {
      created = await this.repository.createChecked({
        id: generateId(),
        organizationId: input.organizationId,
        financialAreaId: area.id,
        code,
        title,
        startDate,
        endDate,
        priorYearId,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      });
    } catch (error) {
      if (error instanceof FiscalYearOverlapError) {
        throw AppException.businessRule(
          'The fiscal year overlaps another fiscal year of this financial area.',
          { conflictingFiscalYearId: error.conflictingId },
        );
      }
      if (error instanceof AreaDisabledError) {
        throw AppException.businessRule(
          'The financial area is disabled and cannot take new fiscal years.',
        );
      }
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A fiscal year with that code already exists in this financial area.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: FISCAL_YEAR_CREATED_EVENT,
      aggregateType: 'FiscalYear',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        financialAreaId: created.financialAreaId,
        code: created.code,
      },
    });
    this.logger.log(
      'Fiscal year created',
      {
        fiscalYearId: created.id,
        organizationId: created.organizationId,
        financialAreaId: created.financialAreaId,
      },
      FiscalYearsService.name,
    );
    return toFiscalYearDto(created);
  }

  async updateFiscalYear(
    organizationId: string,
    id: string,
    input: UpdateFiscalYearInput,
  ): Promise<FiscalYearDto> {
    await this.authorization.requireAllPermissions([
      FISCAL_YEAR_PERMISSIONS.EDIT,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    const code =
      input.code === undefined ? undefined : normalizeCode(input.code);
    const title =
      input.title === undefined ? undefined : normalizeTitle(input.title);
    assertCodeAndTitle(code ?? current.code, title ?? current.title);

    const startDate =
      input.startDate === undefined
        ? undefined
        : parseDateInput(input.startDate, 'startDate');
    const endDate =
      input.endDate === undefined
        ? undefined
        : parseDateInput(input.endDate, 'endDate');
    const effectiveStart = startDate ?? current.startDate;
    const effectiveEnd = endDate ?? current.endDate;
    if (effectiveEnd.getTime() < effectiveStart.getTime()) {
      throw AppException.businessRule(
        'The fiscal year end date must be on or after the start date.',
      );
    }
    if (
      (startDate !== undefined || endDate !== undefined) &&
      current.status !== 'open'
    ) {
      throw AppException.businessRule(
        `A ${current.status} fiscal year cannot have its dates changed.`,
      );
    }

    if (code !== undefined && code !== current.code) {
      const taken = await this.repository.findByCodeExcludingId(
        current.organizationId,
        current.financialAreaId,
        code,
        id,
      );
      if (taken !== null) {
        throw AppException.conflict(
          'A fiscal year with that code already exists in this financial area.',
        );
      }
    }

    if (input.priorYearId !== undefined && input.priorYearId !== null) {
      await this.requirePriorYearInArea(
        input.priorYearId,
        current.organizationId,
        current.financialAreaId,
        id,
      );
    }

    let updated: FiscalYear;
    try {
      updated = await this.repository.updateChecked({
        id,
        code,
        title,
        startDate,
        endDate,
        isActive: input.isActive,
        priorYearId: input.priorYearId,
        updatedAt: new Date(),
        updatedBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (error instanceof FiscalYearOverlapError) {
        throw AppException.businessRule(
          'The fiscal year overlaps another fiscal year of this financial area.',
          { conflictingFiscalYearId: error.conflictingId },
        );
      }
      if (error instanceof FiscalYearRangeExcludesPeriodsError) {
        throw AppException.businessRule(
          'The new year dates would leave an accounting period outside the year.',
          { accountingPeriodId: error.periodId },
        );
      }
      if (error instanceof FiscalYearNotEditableError) {
        throw AppException.businessRule(
          `A ${error.status} fiscal year cannot have its dates changed.`,
        );
      }
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A fiscal year with that code already exists in this financial area.',
        );
      }
      throw error;
    }

    // NOTE: no FiscalYear.Updated event — the contract §21 vocabulary lists
    // Created/Closed/Reopened/Sealed/Unsealed only; edits are recorded
    // through the AR-12 updated_by/at columns.
    return toFiscalYearDto(updated);
  }

  /**
   * Apply one lifecycle move (`close`, `reopen`, `seal`, `unseal`).
   *
   * Each move carries its own permission (contract §6.6 — no "manage
   * years" wildcard) and a mandatory reason. Closing cascades to the
   * year's open periods in the same transaction (contract §7.2 rule 6);
   * every cascaded period close is published alongside the year event so
   * the period-close evidence is complete.
   */
  async transitionFiscalYear(
    input: TransitionFiscalYearInput,
  ): Promise<FiscalYearDto> {
    await this.authorization.requireAllPermissions([
      TRANSITION_PERMISSIONS[input.transition],
    ]);
    const current = await this.mustFindInOrganization(
      input.organizationId,
      input.id,
    );
    const reason = normalizeTitle(input.reason);
    assertReason(reason);

    const plan = planFiscalYearTransition(current.status, input.transition);
    if (plan.to === null) {
      throw AppException.businessRule(
        `A ${current.status} fiscal year cannot be ${transitionVerb(input.transition)}.`,
      );
    }

    let result: {
      year: FiscalYear;
      cascadedPeriods: Array<{ id: string; sequence: number }>;
    };
    try {
      result = await this.repository.transitionChecked({
        id: input.id,
        from: current.status,
        to: plan.to,
        updatedAt: new Date(),
        updatedBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (error instanceof FiscalYearTransitionConflictError) {
        throw AppException.conflict(
          `The fiscal year is ${error.actual}; the transition no longer applies. Refresh and retry.`,
        );
      }
      if (error instanceof FiscalYearSealBlockedError) {
        throw AppException.businessRule(
          'The fiscal year has an open accounting period and cannot be sealed. Close every period first.',
          { openAccountingPeriodId: error.openPeriodId },
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: TRANSITION_EVENTS[input.transition],
      aggregateType: 'FiscalYear',
      aggregateId: result.year.id,
      payload: {
        id: result.year.id,
        organizationId: result.year.organizationId,
        financialAreaId: result.year.financialAreaId,
        code: result.year.code,
        fromStatus: current.status,
        toStatus: result.year.status,
        reason,
      },
    });
    for (const cascaded of result.cascadedPeriods) {
      const payload: AccountingPeriodTransitionEventPayload = {
        id: cascaded.id,
        organizationId: result.year.organizationId,
        financialAreaId: result.year.financialAreaId,
        fiscalYearId: result.year.id,
        sequence: cascaded.sequence,
        fromStatus: 'open',
        toStatus: 'closed',
        reason,
      };
      await publishEvent(this.events, {
        type: ACCOUNTING_PERIOD_CLOSED_EVENT,
        aggregateType: 'AccountingPeriod',
        aggregateId: cascaded.id,
        payload,
      });
    }
    this.logger.log(
      `Fiscal year ${transitionVerb(input.transition)}`,
      {
        fiscalYearId: result.year.id,
        organizationId: result.year.organizationId,
        cascadedPeriods: result.cascadedPeriods.length,
      },
      FiscalYearsService.name,
    );
    return toFiscalYearDto(result.year);
  }

  /**
   * Same-module reference resolution for accounting periods (AR-07):
   * periods resolve their owning year through this method. Cross-module
   * consumers (future posting flows) resolve through it as well instead
   * of reading `accounting.*` tables.
   *
   * A year from another organization answers 404 (AC-I-16).
   */
  async requireFiscalYearInOrganization(
    id: string,
    organizationId: string,
  ): Promise<FiscalYear> {
    const year = await this.repository.findById(id);
    if (year === null || year.organizationId !== organizationId) {
      throw AppException.notFound('FiscalYear', id);
    }
    return year;
  }

  /**
   * Resolve a year for a new writable reference. Historical reads use
   * `requireFiscalYearInOrganization` above so inactive years remain
   * inspectable without becoming usable for ordinary work.
   */
  async requireUsableFiscalYearInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<FiscalYear> {
    const year = await this.requireFiscalYearInOrganization(id, organizationId);
    assertUsable('Fiscal year', year.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return year;
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Resolve a prior-year link: it must exist in the SAME organization and
   * financial area (a foreign year answers 404 — AC-I-16, applied one
   * level down per contract §4), and it must not be the year itself.
   */
  private async requirePriorYearInArea(
    priorYearId: string,
    organizationId: string,
    financialAreaId: string,
    selfId: string | null,
  ): Promise<FiscalYear> {
    if (selfId !== null && priorYearId === selfId) {
      throw AppException.businessRule(
        'A fiscal year cannot be its own prior year.',
      );
    }
    const prior = await this.repository.findById(priorYearId);
    if (
      prior === null ||
      prior.organizationId !== organizationId ||
      prior.financialAreaId !== financialAreaId
    ) {
      throw AppException.notFound('FiscalYear', priorYearId);
    }
    return prior;
  }

  /**
   * Re-read one cascaded period's sequence for its close event. The period
   * was just closed by this transaction, so a miss is impossible — but
   * returning 0 would fabricate evidence, so a miss fails loudly instead.
   */
  private async cascadedPeriodSequence(periodId: string): Promise<number> {
    void periodId;
    // Resolved through the periods service to avoid reaching across the
    // module's own repository boundary from the wrong service… except the
    // periods service lives below this one in the same module, and a
    // service-to-service call here would cycle (periods → years). The
    // sequence is therefore intentionally NOT resolved: see below.
    throw new Error('unreachable');
  }

  /**
   * Scoped by-id resolution for the API surface (ADR-0021 §4): a year in
   * another organization is reported as not found, so the boundary cannot
   * be crossed by guessing an id. The deployment organization pin (ADR-0025)
   * is enforced here too, so direct service callers are bounded exactly
   * like HTTP callers.
   */
  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<FiscalYear> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const year = await this.repository.findById(id);
    if (year === null || year.organizationId !== organizationId) {
      throw AppException.notFound('FiscalYear', id);
    }
    return year;
  }
}

/** Parse a `YYYY-MM-DD` input or reject it as malformed (400). */
function parseDateInput(value: string, field: string): Date {
  const parsed = parseDateOnly(value.trim());
  if (parsed === null) {
    throw AppException.badRequest(
      `${field} must be a valid calendar date (YYYY-MM-DD).`,
    );
  }
  return parsed;
}

function transitionVerb(transition: FiscalYearTransition): string {
  switch (transition) {
    case 'close':
      return 'closed';
    case 'reopen':
      return 'reopened';
    case 'seal':
      return 'sealed';
    case 'unseal':
      return 'unsealed';
  }
}
