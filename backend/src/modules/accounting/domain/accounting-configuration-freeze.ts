/**
 * Accounting Configuration Freeze Policy — Task 11 §2, §5; WIRED by Task 13.
 *
 * This is the domain-owned invariant for operational freeze:
 *
 * > هر Accounting Configuration که بر Transaction، Posting یا Reporting اثر
 * > می‌گذارد، قبل از اولین استفاده عملیاتی قابل تغییر است؛ پس از شروع استفاده
 * > عملیاتی، تغییر مخرب ممنوع است و تغییرات آینده باید از طریق Version جدید
 * > یا Migration کنترل‌شده انجام شوند.
 *
 * Task 11 scope (foundation only):
 * - Implements `operationally_used_at` marker and domain guards
 *   (`canDestructivelyMutate`, `canDeleteConfiguration`, `assertConfigurationMutable`).
 * - Does NOT yet enforce freeze based on posting, ledger, dimensions,
 *   system posting, balances, or reports — those are future tasks.
 * - The abstraction is intentionally reusable: future tasks will call
 *   `markOperationallyUsed` when they create operational artifacts.
 *
 * Task 13 scope (operational freeze INTEGRATION — this file's second half):
 * - The marker now HAS its caller: the document-finalization transaction
 *   (`data/accounting-documents.ts` → `data/accounting-configuration-usage.ts`)
 *   marks the configurations a POSTED voucher actually used, in the same
 *   transaction as the ledger entries. See
 *   `docs/task-13-implementation-report.md`.
 * - The identity of a usage mark is the FIRST-USE TIMESTAMP on the
 *   configuration row (a one-way transition `NULL → instant`), NOT an
 *   append-only usage log: repeated uses of a used configuration leave the
 *   original timestamp untouched (see `docs/accounting/task-11-mark-operationally-used-decision-note.md` §5,
 *   which this task implements verbatim).
 * - `resolveUsedConfigurationIds` is the domain rule that answers "which
 *   configuration did this posting use?" — the ONLY answer allowed to reach
 *   the marker, so no caller decides it ad hoc.
 *
 * Future scope (still not this task):
 * - Detail Structure, Dimensions, Posting Rules, Control Roles, Tax Rules,
 *   Costing Rules, Numbering Policies, Closing Policies — their operational
 *   detection will extend `isConfigurationUsedOperationally` and call the same
 *   marker. They are NOT modeled yet, so nothing here marks them.
 * - Historical backfill: configurations already used by ledger entries
 *   committed BEFORE Task 13 are not retroactively marked (report §12).
 *
 * Design:
 * - `isOperationallyUsed` is a domain concept, not a scattered
 *   `if (hasAnyVoucher)` check.
 * - Freeze is enforced by domain functions, not controllers.
 * - Future transactions (dimensions, posting rules) mark configuration usage
 *   through the same seam (`data/accounting-configuration-usage.ts`), never a
 *   second one.
 * - The freeze guard is a pure function that can be reused.
 * - MAX depth 8 is an architecture technical ceiling (ADR-0028), not a business rule.
 *
 * Framework-free (AR-05).
 */

import type { AccountingConfiguration } from './accounting-configuration.js';
import {
  isConfigurationOperationallyUsed,
  canDestructivelyMutate,
  canDeleteConfiguration,
} from './accounting-configuration.js';

/**
 * The freeze state of a configuration.
 *
 * - `mutable`: DRAFT and not yet operationally used — can be changed.
 * - `frozen_active`: ACTIVE — cannot be destructively mutated or deleted.
 * - `frozen_used`: operationally used (any status) — immutable, only new
 *   version allowed.
 * - `superseded`: SUPERSEDED — immutable, historical.
 */
export type FreezeState =
  'mutable' | 'frozen_active' | 'frozen_used' | 'superseded';

export function resolveFreezeState(
  config: Pick<AccountingConfiguration, 'status' | 'operationallyUsedAt'>,
): FreezeState {
  if (config.status === 'SUPERSEDED') return 'superseded';
  if (isConfigurationOperationallyUsed(config)) return 'frozen_used';
  if (config.status === 'ACTIVE') return 'frozen_active';
  return 'mutable';
}

/**
 * Whether configuration is frozen for destructive changes.
 *
 * Task 11: frozen when ACTIVE or operationally used or SUPERSEDED.
 * Future consumers (Posting Rules, Dimensions, System Posting, Inventory
 * Accounting, Sales Accounting, Reports) will reuse this guard, but their
 * operational detection is NOT yet implemented in Task 11 — they will call
 * `markOperationallyUsed` when they create operational artifacts.
 */
export function isConfigurationFrozen(
  config: Pick<AccountingConfiguration, 'status' | 'operationallyUsedAt'>,
): boolean {
  const state = resolveFreezeState(config);
  return state !== 'mutable';
}

/**
 * Guard that asserts configuration is mutable.
 *
 * @throws {ConfigurationFrozenError} when frozen.
 */
export function assertConfigurationMutable(
  config: Pick<AccountingConfiguration, 'status' | 'operationallyUsedAt'>,
): void {
  if (
    !canDestructivelyMutate({
      status: config.status,
      isOperationallyUsed: isConfigurationOperationallyUsed(config),
    })
  ) {
    throw new ConfigurationFrozenError(resolveFreezeState(config));
  }
}

/**
 * Guard that asserts configuration can be deleted.
 *
 * @throws {ConfigurationFrozenError} when cannot be deleted.
 */
export function assertConfigurationDeletable(
  config: Pick<AccountingConfiguration, 'status' | 'operationallyUsedAt'>,
): void {
  if (
    !canDeleteConfiguration({
      status: config.status,
      isOperationallyUsed: isConfigurationOperationallyUsed(config),
    })
  ) {
    throw new ConfigurationFrozenError(resolveFreezeState(config));
  }
}

export class ConfigurationFrozenError extends Error {
  constructor(public readonly freezeState: FreezeState) {
    super(
      `Accounting configuration is frozen (${freezeState}) and cannot be destructively mutated or deleted. Create a new version or use controlled migration.`,
    );
    this.name = 'ConfigurationFrozenError';
  }
}

/**
 * Operational usage marker — domain-level abstraction.
 *
 * Since Task 13 this shape describes WHY a mark happened, and the marking
 * itself is one statement inside the finalization transaction
 * (`data/accounting-configuration-usage.ts`). Only the fact "used at" is
 * persisted (`operationally_used_at`): there is no usage table and no `reason`
 * column, because inventing either is out of scope (report §12). The cause of a
 * mark stays recoverable from the durable effect itself — the ledger entries
 * and the `accounting_posting_operations` row of the finalization that wrote
 * them, joined through the account that carries the pin.
 */
export interface OperationalUsage {
  configurationId: string;
  organizationId: string;
  usedAt: Date;
  /** What caused the usage — for audit, e.g. 'voucher_finalized', 'ledger_posted' */
  reason: string;
}

/**
 * Whether a configuration version is considered operationally used based on
 * existence of accounting artifacts.
 *
 * For Task 11, we don't implement full usage detection — but we provide the
 * abstraction so future tasks can extend it.
 *
 * Example future implementations:
 * - hasAnyVoucher(organizationId, configurationId)
 * - hasAnyLedgerEntry(organizationId, configurationId)
 * - hasAnyPostingRule(organizationId, configurationId)
 *
 * The important part is that the CHECK is centralized here, not scattered.
 */
export function isConfigurationUsedOperationally(input: {
  hasLedgerEntries: boolean;
  hasVouchers: boolean;
  hasPostingRules: boolean;
  hasDimensions: boolean;
}): boolean {
  // Any operational artifact means used.
  return (
    input.hasLedgerEntries ||
    input.hasVouchers ||
    input.hasPostingRules ||
    input.hasDimensions
  );
}

// ---------------------------------------------------------------------------
// Which configuration a business operation used — Task 13 (integration).
// ---------------------------------------------------------------------------
//
// The marker's caller must be able to answer one question with ONE answer:
// "which accounting configurations did this posting use?". The accepted model
// answers it structurally: a voucher's lines reference ACCOUNTS, and every
// account carries exactly one pinned configuration
// (`accounts.accounting_configuration_id`, NOT NULL since Task 11 D1/D3). The
// set of configurations a posting used is therefore the DISTINCT set of pins of
// the accounts its stored lines reference — nothing else, and never "whichever
// configuration happens to be ACTIVE" (that would freeze a configuration the
// voucher never touched and leave a touched one mutable — the hazard
// `task-11-mark-operationally-used-decision-note.md` §6 names).
//
// Consequences this rule encodes:
// - a mixed-configuration voucher (possible by design after the Task 11
//   backfill: older accounts pinned to LEGACY, newer roots to the published
//   DEFAULT) marks EVERY configuration it touched. Refusing such a voucher
//   would be a new business rule and is explicitly out of scope;
// - a SUPERSEDED pin is marked too: the marker is a FACT about use, not a
//   gate, and the immutability of `SUPERSEDED` is unaffected;
// - levels (`accounting_configuration_levels`, whose `levelKind` carries
//   general/subsidiary/detail titles) belong to the configuration VERSION, so
//   marking the version root is the whole statement — the model has no
//   per-level usage marker and inventing one would be a new configuration type.

/** One referenced account and the configuration version it is pinned to. */
export interface AccountConfigurationPin {
  accountId: string;
  /** `null` only when the pin column was lost again — never silently skipped. */
  accountingConfigurationId: string | null;
}

/** Why a usage reference cannot be resolved (fail closed, never guess). */
export type ConfigurationUsageProblem =
  /** A referenced account could not be read in this organization. */
  | 'account_pin_unresolved'
  /** The account row carries no configuration pin (schema regression). */
  | 'account_pin_missing'
  /** One account answered twice with two different pins. */
  | 'account_pin_conflict'
  /** A pin was read for an account the document does not reference. */
  | 'account_pin_unexpected';

/**
 * A usage reference the caller cannot be trusted to resolve.
 *
 * Every case is an impossible state under the accepted invariants (the pin is
 * NOT NULL, accounts are never deleted, and the finalization transaction
 * re-validates the line set under its locks). It is therefore raised as a
 * loud failure that ABORTS the surrounding operation — the module's posture
 * for "the stored books contradict the contract": never mark a subset quietly,
 * never post anyway.
 */
export class ConfigurationUsageReferenceError extends Error {
  readonly problem: ConfigurationUsageProblem;
  readonly subject: string;

  constructor(problem: ConfigurationUsageProblem, subject: string) {
    super(
      `Cannot resolve the accounting configuration used by account "${subject}" (${problem}).`,
    );
    this.name = 'ConfigurationUsageReferenceError';
    this.problem = problem;
    this.subject = subject;
  }
}

/**
 * The distinct accounting-configuration set a posted document used, derived
 * from the accounts its lines reference.
 *
 * Pure and total: `accountIds` is the authoritative set of referenced accounts
 * (already deduplicated + sorted by the caller, per the module's lock-input
 * discipline) and `pins` is what the transaction read back for them. The
 * result is deduplicated and ascending, so the marker statement locks its rows
 * in a deterministic order.
 *
 * @throws ConfigurationUsageReferenceError on an unresolved, missing,
 *   conflicting or unexpected pin — the operation must not commit a partial
 *   usage record.
 */
export function resolveUsedConfigurationIds(input: {
  accountIds: readonly string[];
  pins: readonly AccountConfigurationPin[];
}): string[] {
  const expected = new Set(input.accountIds);
  if (expected.size !== input.accountIds.length) {
    // The caller owns that discipline; a duplicate here would silently shrink
    // the checked set, so the seam refuses rather than normalizing.
    throw new ConfigurationUsageReferenceError(
      'account_pin_unexpected',
      'duplicated account id in the usage reference set',
    );
  }
  const byAccount = new Map<string, string>();
  for (const pin of input.pins) {
    if (!expected.has(pin.accountId)) {
      throw new ConfigurationUsageReferenceError(
        'account_pin_unexpected',
        pin.accountId,
      );
    }
    const seen = byAccount.get(pin.accountId);
    if (seen !== undefined) {
      if (seen !== (pin.accountingConfigurationId ?? '')) {
        throw new ConfigurationUsageReferenceError(
          'account_pin_conflict',
          pin.accountId,
        );
      }
      continue;
    }
    if (pin.accountingConfigurationId === null) {
      throw new ConfigurationUsageReferenceError(
        'account_pin_missing',
        pin.accountId,
      );
    }
    const configurationId = pin.accountingConfigurationId.trim();
    if (configurationId === '') {
      throw new ConfigurationUsageReferenceError(
        'account_pin_missing',
        pin.accountId,
      );
    }
    byAccount.set(pin.accountId, configurationId);
  }
  for (const accountId of input.accountIds) {
    if (!byAccount.has(accountId)) {
      throw new ConfigurationUsageReferenceError(
        'account_pin_unresolved',
        accountId,
      );
    }
  }
  return [...new Set(byAccount.values())].sort();
}
