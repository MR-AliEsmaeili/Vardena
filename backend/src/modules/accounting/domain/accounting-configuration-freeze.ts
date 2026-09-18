/**
 * Accounting Configuration Freeze Policy — Task 11 §2, §5.
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
 * Future scope (not Task 11):
 * - Chart of Accounts usage detection (hasAnyVoucher, hasAnyLedgerEntry)
 * - Detail Structure, Dimensions, Posting Rules, Control Roles, Tax Rules,
 *   Costing Rules, Numbering Policies, Closing Policies — their operational
 *   detection will extend `isConfigurationUsedOperationally` and call
 *   `markOperationallyUsed`.
 *
 * Design:
 * - `isOperationallyUsed` is a domain concept, not a scattered
 *   `if (hasAnyVoucher)` check.
 * - Freeze is enforced by domain functions, not controllers.
 * - Future transactions (posting, ledger, dimensions) can mark configuration
 *   as operationally used via `markOperationallyUsed`.
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
  | 'mutable'
  | 'frozen_active'
  | 'frozen_used'
  | 'superseded';

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
 * Future accounting transactions (voucher finalization, ledger entry
 * creation, dimension assignment, posting rule application) should call
 * `markOperationallyUsed` to freeze the configuration.
 *
 * This is intentionally NOT a scattered `if (hasAnyVoucher)` check — it is a
 * domain-owned, reusable invariant.
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
