/**
 * Warehouse Accounting posting mode (C-62, PDR-10 C62-OD-02).
 *
 * The mode is configured PER WAREHOUSE and decides how an Accounting-eligible
 * Inventory document of that warehouse reaches the General Ledger:
 *
 *   `direct_final` — the Accounting Posting Operation produces a FINAL
 *                    Accounting voucher (a real GL effect) in the same
 *                    request. Inventory may then show
 *                    «سند حسابداری صادر شده — شماره سند حسابداری: X».
 *
 *   `draft`        — the operation produces an Accounting-OWNED draft. An
 *                    accountant registers or cancels it later. A draft is
 *                    NEVER Accounting Posted: no final voucher, no GL effect.
 *                    A cancellation leaves the document back in its normal
 *                    accounting-eligible lifecycle state and keeps the audit
 *                    history.
 *
 * Framework-free (AR-05): a closed, code-defined vocabulary, stored as text
 * like every other vocabulary column in this module, so no database enum has
 * to be migrated to add or rename a mode. The default is `direct_final`
 * (deterministic, and the behaviour every existing warehouse already has
 * conceptually) — see `prisma/schema/inventory.prisma`.
 */

export const WAREHOUSE_ACCOUNTING_POSTING_MODES = [
  'direct_final',
  'draft',
] as const;

export type WarehouseAccountingPostingMode =
  (typeof WAREHOUSE_ACCOUNTING_POSTING_MODES)[number];

export function isWarehouseAccountingPostingMode(
  value: string,
): value is WarehouseAccountingPostingMode {
  return (WAREHOUSE_ACCOUNTING_POSTING_MODES as readonly string[]).includes(
    value,
  );
}

/**
 * The mode a stored value resolves to. Fail closed on anything else: an
 * unknown stored mode is a configuration defect, and guessing `draft` would
 * silently post nothing while guessing `direct_final` would silently post to
 * the General Ledger.
 */
export function resolveWarehouseAccountingPostingMode(
  value: string,
): WarehouseAccountingPostingMode {
  if (!isWarehouseAccountingPostingMode(value)) {
    throw new Error(
      `Stored warehouse accounting posting mode "${value}" is not a known mode.`,
    );
  }
  return value;
}

/**
 * Assert a caller-supplied mode. Used by the administrative surface: an
 * unknown value is a 422, never a silent default, so the operator learns the
 * configuration was not applied instead of discovering it in the books.
 */
export function assertWarehouseAccountingPostingMode(
  value: string,
): WarehouseAccountingPostingMode {
  if (!isWarehouseAccountingPostingMode(value)) {
    throw new Error(
      `Warehouse accounting posting mode "${value}" is not one of: ${WAREHOUSE_ACCOUNTING_POSTING_MODES.join(', ')}.`,
    );
  }
  return value;
}
