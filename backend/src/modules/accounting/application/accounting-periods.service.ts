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
import { AccountingPeriodsRepository } from '../data/accounting-periods.repository.js';
import {
  PeriodOutsideYearError,
  PeriodOverlapError,
  PeriodTransitionConflictError,
  PeriodYearNotOpenError,
  PeriodYearNotUsableError,
  PeriodYearSealedError,
} from '../data/accounting-calendar-errors.js';
import type {
  AccountingPeriod,
  AccountingPeriodDto,
} from '../domain/accounting-period.js';
import {
  planAccountingPeriodTransition,
  toAccountingPeriodDto,
  type AccountingPeriodStatus,
  type AccountingPeriodTransition,
} from '../domain/accounting-period.js';
import { parseDateOnly } from '../domain/date-range.js';
import { normalizeTitle } from '../domain/master-data.js';
import { ACCOUNTING_PERIOD_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  ACCOUNTING_PERIOD_CLOSED_EVENT,
  ACCOUNTING_PERIOD_OPENED_EVENT,
  ACCOUNTING_PERIOD_REOPENED_EVENT,
  ACCOUNTING_PERIOD_SEALED_EVENT,
} from '../domain/accounting.events.js';
import {
  assertReason,
  assertTitle,
  publishEvent,
  resolveSort,
} from './accounting-support.js';
import { FiscalYearsService } from './fiscal-years.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  sequence: 'sequence',
  startDate: 'startDate',
  endDate: 'endDate',
  createdAt: 'createdAt',
};

const TRANSITION_PERMISSIONS: Record<AccountingPeriodTransition, string> = {
  close: ACCOUNTING_PERIOD_PERMISSIONS.CLOSE,
  reopen: ACCOUNTING_PERIOD_PERMISSIONS.REOPEN,
  seal: ACCOUNTING_PERIOD_PERMISSIONS.SEAL,
};

const TRANSITION_EVENTS = {
  close: ACCOUNTING_PERIOD_CLOSED_EVENT,
  reopen: ACCOUNTING_PERIOD_REOPENED_EVENT,
  seal: ACCOUNTING_PERIOD_SEALED_EVENT,
} as const;

export interface ListAccountingPeriodsQuery {
  /** Mandatory: a period list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  fiscalYearId?: string | undefined;
  status?: AccountingPeriodStatus | undefined;
  sort?: string | undefined;
}

export interface CreateAccountingPeriodInput {
  organizationId: string;
  fiscalYearId: string;
  /** 1-based ordinal inside the year; unique per year. */
  sequence: number;
  title: string;
  /** Inclusive bounds, `YYYY-MM-DD`; must lie inside the year. */
  startDate: string;
  endDate: string;
}

export interface TransitionAccountingPeriodInput {
  organizationId: string;
  id: string;
  transition: AccountingPeriodTransition;
  reason: string;
}

/**
 * Accounting period administration (contract §7, AC-I-03/AC-I-04, ADR-0026).
 *
 * A period belongs to exactly one fiscal year; periods of one year never
 * overlap and always lie inside the year's range (AC-I-03). The guards are
 * evaluated inside the year-locked repository transaction — never as a
 * pre-check alone — so concurrent opens cannot both slip through.
 *
 * Opening a period IS creating it: the row is born `open`, authorized by
 * `Accounting.AccountingPeriod.Open` (the contract §22 vocabulary has no
 * `Create` code, and the §21 event is `Opened`, not `Created`). Periods
 * are created explicitly — Task 10.2 builds NO layout generator, because
 * the layout policy is expert-gated (OQ-23).
 *
 * Lifecycle: `open → closed → sealed`, plus `reopen` (closed → open and,
 * once the year is unsealed, sealed → open — contract §7.2 rule 4).
 * `close` and `reopen` are refused while the year is sealed. There is no
 * update endpoint (no `Edit` code in contract §22).
 */
@Injectable()
export class AccountingPeriodsService {
  constructor(
    private readonly repository: AccountingPeriodsRepository,
    private readonly fiscalYears: FiscalYearsService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listAccountingPeriods(
    query: ListAccountingPeriodsQuery,
  ): Promise<PaginatedResult<AccountingPeriodDto>> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_PERIOD_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    // A fiscal-year id is a scoped parent reference, not an untrusted list
    // filter. Resolve it before reading child periods so a year from another
    // organization is indistinguishable from an unknown year (404), rather
    // than becoming an empty cross-tenant result. Historical periods of an
    // inactive year remain readable, so this is intentionally not a usable
    // (active/open) gate.
    if (query.fiscalYearId !== undefined) {
      await this.fiscalYears.requireUsableFiscalYearInOrganization(
        query.fiscalYearId,
        query.organizationId,
        { allowInactive: true },
      );
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        fiscalYearId: query.fiscalYearId,
        status: query.status,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ sequence: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toAccountingPeriodDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getAccountingPeriod(
    organizationId: string,
    id: string,
  ): Promise<AccountingPeriodDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_PERIOD_PERMISSIONS.VIEW,
    ]);
    return toAccountingPeriodDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createAccountingPeriod(
    input: CreateAccountingPeriodInput,
  ): Promise<AccountingPeriodDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_PERIOD_PERMISSIONS.OPEN,
    ]);
    const title = normalizeTitle(input.title);
    assertTitle(title);
    const startDate = parseDateInput(input.startDate, 'startDate');
    const endDate = parseDateInput(input.endDate, 'endDate');
    if (endDate.getTime() < startDate.getTime()) {
      throw AppException.businessRule(
        'The period end date must be on or after the start date.',
      );
    }

    await this.organizations.requireUsableOrganization(input.organizationId);
    // The year must exist in this organization (404 otherwise — AC-I-16)
    // and be usable; its status gate (open only) is re-evaluated inside
    // the guarded transaction, so a close racing this open cannot slip by.
    const year = await this.fiscalYears.requireUsableFiscalYearInOrganization(
      input.fiscalYearId,
      input.organizationId,
    );

    const existing = await this.repository.findBySequence(
      year.id,
      input.sequence,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'Sequence is already used by another period of this fiscal year.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let created: AccountingPeriod;
    try {
      created = await this.repository.createChecked({
        id: generateId(),
        organizationId: input.organizationId,
        financialAreaId: year.financialAreaId,
        fiscalYearId: year.id,
        sequence: input.sequence,
        title,
        startDate,
        endDate,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      });
    } catch (error) {
      if (error instanceof PeriodYearNotUsableError) {
        throw AppException.businessRule(
          'The fiscal year is disabled and cannot take new periods.',
        );
      }
      if (error instanceof PeriodYearNotOpenError) {
        throw AppException.businessRule(
          `A ${error.status} fiscal year cannot take new periods.`,
        );
      }
      if (error instanceof PeriodOutsideYearError) {
        throw AppException.businessRule(
          'The period must lie inside its fiscal year.',
        );
      }
      if (error instanceof PeriodOverlapError) {
        throw AppException.businessRule(
          'The period overlaps another period of this fiscal year.',
          { conflictingAccountingPeriodId: error.conflictingId },
        );
      }
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'Sequence is already used by another period of this fiscal year.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: ACCOUNTING_PERIOD_OPENED_EVENT,
      aggregateType: 'AccountingPeriod',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        financialAreaId: created.financialAreaId,
        fiscalYearId: created.fiscalYearId,
        sequence: created.sequence,
      },
    });
    this.logger.log(
      'Accounting period opened',
      {
        accountingPeriodId: created.id,
        organizationId: created.organizationId,
        fiscalYearId: created.fiscalYearId,
      },
      AccountingPeriodsService.name,
    );
    return toAccountingPeriodDto(created);
  }

  /**
   * Apply one lifecycle move (`close`, `reopen`, `seal`). Each move
   * carries its own permission (contract §22) and a mandatory reason.
   *
   * The plan below is re-evaluated against the LOCKED row inside the
   * repository transaction (organization ownership of the year and the
   * period verified there too), so the decision is made on persisted state,
   * never on the pre-read copy: a period that moved while the request was in
   * flight answers 409, a move the current status refuses answers 422, and a
   * sealed fiscal year gates `close`/`reopen` (contract §7.2 rule 4).
   */
  async transitionAccountingPeriod(
    input: TransitionAccountingPeriodInput,
  ): Promise<AccountingPeriodDto> {
    await this.authorization.requireAllPermissions([
      TRANSITION_PERMISSIONS[input.transition],
    ]);
    const current = await this.mustFindInOrganization(
      input.organizationId,
      input.id,
    );
    const reason = normalizeTitle(input.reason);
    assertReason(reason);

    const plan = planAccountingPeriodTransition(
      current.status,
      input.transition,
    );
    if (plan.to === null) {
      throw AppException.businessRule(
        `A ${current.status} accounting period cannot be ${transitionVerb(input.transition)}.`,
      );
    }

    let updated: AccountingPeriod;
    try {
      updated = await this.repository.transitionChecked({
        organizationId: input.organizationId,
        id: input.id,
        from: current.status,
        to: plan.to,
        gatesOnYearSealed: input.transition !== 'seal',
        updatedAt: new Date(),
        updatedBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (error instanceof PeriodTransitionConflictError) {
        throw AppException.conflict(
          `The accounting period is ${error.actual}; the transition no longer applies. Refresh and retry.`,
        );
      }
      if (error instanceof PeriodYearSealedError) {
        throw AppException.businessRule(
          'The fiscal year is sealed; unseal the year before changing its periods.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: TRANSITION_EVENTS[input.transition],
      aggregateType: 'AccountingPeriod',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        financialAreaId: updated.financialAreaId,
        fiscalYearId: updated.fiscalYearId,
        sequence: updated.sequence,
        fromStatus: current.status,
        toStatus: updated.status,
        reason,
      },
    });
    this.logger.log(
      `Accounting period ${transitionVerb(input.transition)}`,
      {
        accountingPeriodId: updated.id,
        organizationId: updated.organizationId,
      },
      AccountingPeriodsService.name,
    );
    return toAccountingPeriodDto(updated);
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Scoped by-id resolution for the API surface (ADR-0021 §4): a period in
   * another organization is reported as not found, so the boundary cannot
   * be crossed by guessing an id. The deployment organization pin (ADR-0025)
   * is enforced here too, so direct service callers are bounded exactly
   * like HTTP callers.
   */
  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<AccountingPeriod> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const period = await this.repository.findById(id);
    if (period === null || period.organizationId !== organizationId) {
      throw AppException.notFound('AccountingPeriod', id);
    }
    return period;
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

function transitionVerb(transition: AccountingPeriodTransition): string {
  switch (transition) {
    case 'close':
      return 'closed';
    case 'reopen':
      return 'reopened';
    case 'seal':
      return 'sealed';
  }
}
