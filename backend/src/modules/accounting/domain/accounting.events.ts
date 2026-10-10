import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

// ---------------------------------------------------------------------------
// Accounting module domain events — Task 10.2 foundation, Task 10.3 chart and
// Task 10.4 accounting documents (docs/modules.md §Accounting "Publishes",
// §Event catalog, contract §21).
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
export interface FiscalYearTransitionEventPayload extends FiscalYearEventPayload {
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

/** Payload shared by every account (chart of accounts) event — Task 10.3, updated Task 11 final. */
export interface AccountEventPayload {
  /** ULID of the account. */
  id: string;
  /** Organization the account belongs to (the chart is organization-scoped). */
  organizationId: string;
  /** Canonical digits-only code (business key, never a title). */
  code: string;
  /** 1-based tree depth. */
  level: number;
  /** Legacy: coding-structure version the code was composed under (§9.4). Nullable after Task 11 final. */
  codingStructureVersionId: string | null;
  /** Canonical configuration scope after Task 11 final (D1). Nullable for legacy orphan D3. */
  accountingConfigurationId: string | null;
}

/** Payload for accounting-period lifecycle transitions. */
export interface AccountingPeriodTransitionEventPayload extends AccountingPeriodEventPayload {
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

// ---- Account (chart of accounts, Task 10.3) ---------------------------------
// Contract §21 names exactly `Account.{Created,Updated,Enabled,Disabled}` for
// chart maintenance, and deliberately NO `Account.Deleted`: accounts are never
// deleted (§8.6).
//
// There is NO `CodingStructure.*` row in the §21 vocabulary, so publishing a
// version emits nothing: the change is durable in the AR-12 columns
// (`updated_by`/`updated_at` on the version row) and every consequence shows up
// as `Account.Created` from the accounts created under the new version.
// Inventing an event name the contract does not carry would extend the event
// contract, which is ADR-gated (AR-29) — recorded here so the next task finds
// the decision, not a silent gap.

export const ACCOUNT_CREATED_EVENT = 'Account.Created' as const;
export const ACCOUNT_UPDATED_EVENT = 'Account.Updated' as const;
export const ACCOUNT_ENABLED_EVENT = 'Account.Enabled' as const;
export const ACCOUNT_DISABLED_EVENT = 'Account.Disabled' as const;
export const ACCOUNT_DETAIL_UNLINKED_EVENT = 'Account.DetailUnlinked' as const;

export interface AccountDetailUnlinkedEventPayload {
  organizationId: string;
  accountId: string;
  accountCode: string;
  detailGroupId: string;
  detailGroupCode: string;
  actorId: string | null;
  unlinkedAt: string;
  operation: 'account_detail_unlink';
  affectedDocumentLinesCount: number;
  affectedLedgerEntriesCount: number;
}

export type AccountCreatedEvent = ScopedEvent<
  typeof ACCOUNT_CREATED_EVENT,
  'Account',
  AccountEventPayload
>;
export type AccountUpdatedEvent = ScopedEvent<
  typeof ACCOUNT_UPDATED_EVENT,
  'Account',
  AccountEventPayload
>;
export type AccountEnabledEvent = ScopedEvent<
  typeof ACCOUNT_ENABLED_EVENT,
  'Account',
  AccountEventPayload
>;
export type AccountDisabledEvent = ScopedEvent<
  typeof ACCOUNT_DISABLED_EVENT,
  'Account',
  AccountEventPayload
>;
export type AccountDetailUnlinkedEvent = ScopedEvent<
  typeof ACCOUNT_DETAIL_UNLINKED_EVENT,
  'Account',
  AccountDetailUnlinkedEventPayload
>;

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

export const ACCOUNTING_PERIOD_OPENED_EVENT =
  'AccountingPeriod.Opened' as const;
export const ACCOUNTING_PERIOD_CLOSED_EVENT =
  'AccountingPeriod.Closed' as const;
export const ACCOUNTING_PERIOD_REOPENED_EVENT =
  'AccountingPeriod.Reopened' as const;
export const ACCOUNTING_PERIOD_SEALED_EVENT =
  'AccountingPeriod.Sealed' as const;

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

// ---- AccountingDocument (documents, Task 10.4) --------------------------------
// Contract §21 verbatim: `AccountingDocument.{Created,Updated,Finalized,
// Deleted,Reversed,Corrected,Replaced}` with `Updated`/`Deleted` only
// pre-final. Task 10.4 ships the four that its lifecycle produces:
//   * `Created`  — a voucher was composed (draft or directly temporary);
//   * `Updated`  — an editable voucher's header/lines changed, including the
//                  draft → temporary issuance (there is no `Submitted`/
//                  `Issued` row in the vocabulary, so the state change is an
//                  `Updated` — inventing a name the contract does not carry
//                  would extend the event contract, AR-29);
//   * `Finalized` — the voucher became part of the books (§15.5);
//   * `Deleted`  — a pre-final voucher was discarded (§15.3, AC-D-21).
// `Reversed`/`Corrected`/`Replaced` arrive with the correction task (AC-D-22).
//
// Payload policy: identifiers, scope, the business number, the phase and the
// origin — NO amounts. §21 allows amounts "for `Finalized` only where a
// consumer needs them, and never as a substitute for reading the owning
// module"; no consumer needs them yet, and the owning module is the only
// legitimate reader of its own rows.

/** Payload shared by every accounting-document event. */
export interface AccountingDocumentEventPayload {
  /** ULID of the document. */
  id: string;
  /** Organization the document belongs to. */
  organizationId: string;
  /** Financial area the document is booked in. */
  financialAreaId: string;
  /** Resolved fiscal year (stored, never recomputed — AC-I-14). */
  fiscalYearId: string;
  /** Resolved accounting period. */
  accountingPeriodId: string;
  /** Registered Document Foundation type (`accounting_voucher`). */
  documentType: string;
  /** Numeric-only serial, or `null` while the document is a draft. */
  documentNumber: string | null;
  /** The phase the document is in AFTER the event. */
  state: string;
  /** `manual` | `system` (§16.1). */
  origin: string;
}

export const ACCOUNTING_DOCUMENT_CREATED_EVENT =
  'AccountingDocument.Created' as const;
export const ACCOUNTING_DOCUMENT_UPDATED_EVENT =
  'AccountingDocument.Updated' as const;
export const ACCOUNTING_DOCUMENT_FINALIZED_EVENT =
  'AccountingDocument.Finalized' as const;
export const ACCOUNTING_DOCUMENT_DELETED_EVENT =
  'AccountingDocument.Deleted' as const;
export const ACCOUNTING_DOCUMENT_REVERSED_EVENT =
  'AccountingDocument.Reversed' as const;

export type AccountingDocumentCreatedEvent = ScopedEvent<
  typeof ACCOUNTING_DOCUMENT_CREATED_EVENT,
  'AccountingDocument',
  AccountingDocumentEventPayload
>;
export type AccountingDocumentUpdatedEvent = ScopedEvent<
  typeof ACCOUNTING_DOCUMENT_UPDATED_EVENT,
  'AccountingDocument',
  AccountingDocumentEventPayload
>;
export type AccountingDocumentFinalizedEvent = ScopedEvent<
  typeof ACCOUNTING_DOCUMENT_FINALIZED_EVENT,
  'AccountingDocument',
  AccountingDocumentEventPayload
>;
export type AccountingDocumentDeletedEvent = ScopedEvent<
  typeof ACCOUNTING_DOCUMENT_DELETED_EVENT,
  'AccountingDocument',
  AccountingDocumentEventPayload
>;

// ---- Balance projection (Task 12, ADR-0031, contract §19.3 AC-D-31) ------------
// Rebuild is the ONE mutating operation on the projection and is an
// audited maintenance event — the Inventory `Reconciliation.Execute`
// precedent (§19.3). The event carries the scoped slice (always the org;
// optionally the area/year the rebuild re-derived) plus the audit
// evidence (actor + reason + inserted/deleted counts) because the balance
// projection has no separate transition-history table. The ledger stays the
// source of truth; this event is the projection's evidence.

export const ACCOUNT_BALANCE_REBUILT_EVENT = 'AccountBalance.Rebuilt' as const;

export interface AccountBalanceRebuiltEventPayload {
  organizationId: string;
  financialAreaId: string | null;
  fiscalYearId: string | null;
  deleted: number;
  inserted: number;
  reason: string | null;
  rebuiltBy: string | null;
  rebuiltAt: string;
}

export type AccountBalanceRebuiltEvent = ScopedEvent<
  typeof ACCOUNT_BALANCE_REBUILT_EVENT,
  'AccountBalanceProjection',
  AccountBalanceRebuiltEventPayload
>;

/** Every event this module publishes (used by tests to assert the catalog). */
export const ACCOUNTING_EVENT_TYPES = [
  ACCOUNT_CREATED_EVENT,
  ACCOUNT_UPDATED_EVENT,
  ACCOUNT_ENABLED_EVENT,
  ACCOUNT_DISABLED_EVENT,
  ACCOUNT_DETAIL_UNLINKED_EVENT,
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
  ACCOUNTING_DOCUMENT_CREATED_EVENT,
  ACCOUNTING_DOCUMENT_UPDATED_EVENT,
  ACCOUNTING_DOCUMENT_FINALIZED_EVENT,
  ACCOUNTING_DOCUMENT_DELETED_EVENT,
  ACCOUNTING_DOCUMENT_REVERSED_EVENT,
  ACCOUNT_BALANCE_REBUILT_EVENT,
] as const;
