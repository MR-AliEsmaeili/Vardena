import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

// ---------------------------------------------------------------------------
// Accounting module domain events — Task 10.2 foundation
// (docs/modules.md §Accounting "Publishes", §Event catalog, contract §21).
//
// Naming follows the repository convention `Entity.PastTenseVerb` and the
// contract §21 vocabulary verbatim: `FiscalYear.*` and
// `AccountingPeriod.*` supersede the `AccountingPeriod.Closed` placeholder
// catalog row now that the module ships them. They are published by the
// module's application services and consumed by the future Audit /
// Notifications modules through the kernel `DomainEventBus`; there is no
// parallel audit table in this module (AR-23).
//
// Payload policy: stable identifiers plus the business key, and — for
// lifecycle transitions only — the from/to statuses and the mandatory
// reason. The reason has no column anywhere (there is no transition
// history table in Task 10.2), so carrying it in the event is what keeps
// the §6.3/§23 "reasoned operation" evidence instead of a write-only
// formality. Titles are display text and stay out of payloads.
// ---------------------------------------------------------------------------

/** Payload shared by every financial-area event. */
export interface FinancialAreaEventPayload {
  /** ULID of the area. */
  id: string;
  /** Organization the area belongs to. */
  organizationId: string;
  /** Business code (not a title — titles are display text). */
  code: string;
}

/** Payload for fiscal-year creation. */
export interface FiscalYearEventPayload {
  /** ULID of the year. */
  id: string;
  /** Organization the year belongs to. */
  organizationId: string;
  /** Financial area the year belongs to. */
  financialAreaId: string;
  /** Business code. */
  code: string;
}

/** Payload for fiscal-year lifecycle transitions. */
export interface FiscalYearTransitionEventPayload
  extends FiscalYearEventPayload {
  fromStatus: string;
  toStatus: string;
  reason: string;
}

/** Payload for accounting-period opening. */
export interface AccountingPeriodEventPayload {
  /** ULID of the period. */
  id: string;
  /** Organization the period belongs to. */
  organizationId: string;
  /** Financial area the period belongs to. */
  financialAreaId: string;
  /** Fiscal year the period belongs to. */
  fiscalYearId: string;
  /** 1-based ordinal inside the year. */
  sequence: number;
}

/** Payload for accounting-period lifecycle transitions. */
export interface AccountingPeriodTransitionEventPayload
  extends AccountingPeriodEventPayload {
  fromStatus: string;
  toStatus: string;
  reason: string;
}

interface ScopedEvent<
  TType extends string,
  TAggregate extends string,
  TPayload,
> extends DomainEvent {
  type: TType;
  aggregateType: TAggregate;
  aggregateId: string;
  payload: TPayload;
}

// ---- FinancialArea ----------------------------------------------------------

export const FINANCIAL_AREA_CREATED_EVENT = 'FinancialArea.Created' as const;
export const FINANCIAL_AREA_UPDATED_EVENT = 'FinancialArea.Updated' as const;
export const FINANCIAL_AREA_ENABLED_EVENT = 'FinancialArea.Enabled' as const;
export const FINANCIAL_AREA_DISABLED_EVENT = 'FinancialArea.Disabled' as const;

export type FinancialAreaCreatedEvent = ScopedEvent<
  typeof FINANCIAL_AREA_CREATED_EVENT,
  'FinancialArea',
  FinancialAreaEventPayload
>;
export type FinancialAreaUpdatedEvent = ScopedEvent<
  typeof FINANCIAL_AREA_UPDATED_EVENT,
  'FinancialArea',
  FinancialAreaEventPayload
>;
export type FinancialAreaEnabledEvent = ScopedEvent<
  typeof FINANCIAL_AREA_ENABLED_EVENT,
  'FinancialArea',
  FinancialAreaEventPayload
>;
export type FinancialAreaDisabledEvent = ScopedEvent<
  typeof FINANCIAL_AREA_DISABLED_EVENT,
  'FinancialArea',
  FinancialAreaEventPayload
>;

// ---- FiscalYear ---------------------------------------------------------------
// NOTE: the contract §21 vocabulary lists Created/Closed/Reopened/Sealed/
// Unsealed and deliberately no Updated: year edits are recorded through
// the AR-12 `updated_by/at` columns, while the event stream carries the
// lifecycle operations Audit subscribes to.

export const FISCAL_YEAR_CREATED_EVENT = 'FiscalYear.Created' as const;
export const FISCAL_YEAR_CLOSED_EVENT = 'FiscalYear.Closed' as const;
export const FISCAL_YEAR_REOPENED_EVENT = 'FiscalYear.Reopened' as const;
export const FISCAL_YEAR_SEALED_EVENT = 'FiscalYear.Sealed' as const;
export const FISCAL_YEAR_UNSEALED_EVENT = 'FiscalYear.Unsealed' as const;

export type FiscalYearCreatedEvent = ScopedEvent<
  typeof FISCAL_YEAR_CREATED_EVENT,
  'FiscalYear',
  FiscalYearEventPayload
>;
export type FiscalYearClosedEvent = ScopedEvent<
  typeof FISCAL_YEAR_CLOSED_EVENT,
  'FiscalYear',
  FiscalYearTransitionEventPayload
>;
export type FiscalYearReopenedEvent = ScopedEvent<
  typeof FISCAL_YEAR_REOPENED_EVENT,
  'FiscalYear',
  FiscalYearTransitionEventPayload
>;
export type FiscalYearSealedEvent = ScopedEvent<
  typeof FISCAL_YEAR_SEALED_EVENT,
  'FiscalYear',
  FiscalYearTransitionEventPayload
>;
export type FiscalYearUnsealedEvent = ScopedEvent<
  typeof FISCAL_YEAR_UNSEALED_EVENT,
  'FiscalYear',
  FiscalYearTransitionEventPayload
>;

// ---- AccountingPeriod ---------------------------------------------------------
// NOTE: opening a period IS creating it (the row is born `open`), so the
// creation event is `Opened`, not `Created` — contract §21 verbatim. There
// is no `Updated`: periods have no update endpoint (no `Edit` code in
// contract §22).

export const ACCOUNTING_PERIOD_OPENED_EVENT = 'AccountingPeriod.Opened' as const;
export const ACCOUNTING_PERIOD_CLOSED_EVENT = 'AccountingPeriod.Closed' as const;
export const ACCOUNTING_PERIOD_REOPENED_EVENT =
  'AccountingPeriod.Reopened' as const;
export const ACCOUNTING_PERIOD_SEALED_EVENT = 'AccountingPeriod.Sealed' as const;

export type AccountingPeriodOpenedEvent = ScopedEvent<
  typeof ACCOUNTING_PERIOD_OPENED_EVENT,
  'AccountingPeriod',
  AccountingPeriodEventPayload
>;
export type AccountingPeriodClosedEvent = ScopedEvent<
  typeof ACCOUNTING_PERIOD_CLOSED_EVENT,
  'AccountingPeriod',
  AccountingPeriodTransitionEventPayload
>;
export type AccountingPeriodReopenedEvent = ScopedEvent<
  typeof ACCOUNTING_PERIOD_REOPENED_EVENT,
  'AccountingPeriod',
  AccountingPeriodTransitionEventPayload
>;
export type AccountingPeriodSealedEvent = ScopedEvent<
  typeof ACCOUNTING_PERIOD_SEALED_EVENT,
  'AccountingPeriod',
  AccountingPeriodTransitionEventPayload
>;

/** Every event this module publishes (used by tests to assert the catalog). */
export const ACCOUNTING_EVENT_TYPES = [
  FINANCIAL_AREA_CREATED_EVENT,
  FINANCIAL_AREA_UPDATED_EVENT,
  FINANCIAL_AREA_ENABLED_EVENT,
  FINANCIAL_AREA_DISABLED_EVENT,
  FISCAL_YEAR_CREATED_EVENT,
  FISCAL_YEAR_CLOSED_EVENT,
  FISCAL_YEAR_REOPENED_EVENT,
  FISCAL_YEAR_SEALED_EVENT,
  FISCAL_YEAR_UNSEALED_EVENT,
  ACCOUNTING_PERIOD_OPENED_EVENT,
  ACCOUNTING_PERIOD_CLOSED_EVENT,
  ACCOUNTING_PERIOD_REOPENED_EVENT,
  ACCOUNTING_PERIOD_SEALED_EVENT,
] as const;
