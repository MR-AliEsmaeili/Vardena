import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Static lock-order contract checks (Task 12 R-01).
 *
 * The global order is:
 *   financial_area → fiscal_year → accounting_period → accounts FOR SHARE
 *   → account_balance_projections FOR UPDATE (Task 12 tail)
 *   → accounting_document FOR UPDATE (last)
 *
 * `finalizeChecked` must acquire balances BEFORE the document so two
 * concurrent finalizations for the same (period, account) tail
 * `→ balances → document` and never invert to `document → balances`
 * (which would deadlock against `rebuildScoped` which also holds
 * `balances FOR UPDATE`). This spec asserts the source order by
 * inspecting the implementation text — a real PG deadlock would only
 * surface under parallel transactions, but the static order is the
 * invariant reviewers check.
 */
describe('balance lock order (Task 12 R-01)', () => {
  const repoPath = path.join(process.cwd(), 'src/modules/accounting/data/accounting-documents.repository.ts');
  const locksPath = path.join(process.cwd(), 'src/modules/accounting/data/accounting-locks.ts');
  const projRepoPath = path.join(process.cwd(), 'src/modules/accounting/data/account-balance-projections.repository.ts');

  it('finalizeChecked locks projection rows BEFORE the document', () => {
    const src = fs.readFileSync(repoPath, 'utf-8');
    // Scope check to finalizeChecked body only, not the whole file (which also
    // contains other helpers that reference the same lock functions).
    const finalizeStart = src.indexOf('async finalizeChecked');
    expect(finalizeStart).toBeGreaterThan(-1);
    const finalizeEnd = src.indexOf('async deleteChecked', finalizeStart);
    const slice = src.slice(finalizeStart, finalizeEnd === -1 ? undefined : finalizeEnd);
    const posBalances = slice.indexOf('lockBalanceProjectionRows(');
    const posDocument = slice.indexOf('lockDocumentInTx(');
    const posAccounts = slice.indexOf('lockAccountsForLinesInTx(');
    expect(posBalances, 'lockBalanceProjectionRows must appear in finalizeChecked').toBeGreaterThan(-1);
    expect(posDocument, 'lockDocumentInTx must appear in finalizeChecked').toBeGreaterThan(-1);
    expect(posAccounts, 'lockAccountsForLinesInTx must appear in finalizeChecked').toBeGreaterThan(-1);
    expect(posBalances).toBeLessThan(posDocument);
    expect(posAccounts).toBeLessThan(posBalances);
  });

  it('finalizeChecked uses the with-locks-held helper (no second balances→document inversion)', () => {
    const src = fs.readFileSync(repoPath, 'utf-8');
    expect(src).toContain('applyBalanceProjectionDeltasWithLocksHeldInTx');
    // The legacy helper that locks internally must NOT be used on the
    // production finalization path (it would be document→balances).
    // Keep it only for tests that call it outside the tail.
    const finalizeSlice = src.slice(src.indexOf('async finalizeChecked'), src.indexOf('async deleteChecked'));
    expect(finalizeSlice).not.toContain('applyBalanceProjectionDeltaInTx(');
  });

  it('accounting-locks documents balances before document', () => {
    const src = fs.readFileSync(locksPath, 'utf-8');
    // The header comment must document the 6-step order with balances before document.
    expect(src).toContain('account_balance_projections');
    expect(src).toContain('accounting_document');
    // Ensure the comment order: accounts → account_balance_projections → accounting_document
    const posAccounts = src.indexOf('accounts (FOR SHARE');
    const posBalances = src.indexOf('account_balance_projections (FOR UPDATE');
    const posDocument = src.indexOf('accounting_document (FOR UPDATE, last)');
    expect(posAccounts).toBeGreaterThan(-1);
    expect(posBalances).toBeGreaterThan(posAccounts);
    expect(posDocument).toBeGreaterThan(posBalances);
  });

  it('projection helper does not acquire its own lock when called with locks held', () => {
    const src = fs.readFileSync(projRepoPath, 'utf-8');
    expect(src).toContain('applyBalanceProjectionDeltasWithLocksHeldInTx');
    const heldStart = src.indexOf('export async function applyBalanceProjectionDeltasWithLocksHeldInTx');
    expect(heldStart).toBeGreaterThan(-1);
    // Find the next function after the held helper (aggregateDeltas) — limit to that function's range.
    const nextFn = src.indexOf('function aggregateDeltas', heldStart);
    const heldEnd = nextFn === -1 ? heldStart + 3000 : nextFn;
    const heldSlice = src.slice(heldStart, heldEnd);
    expect(heldSlice).not.toContain('lockBalanceProjectionRows');
    // The legacy helper still does (kept for non-finalization callers)
    expect(src).toContain('lockBalanceProjectionRows');
  });

  it('rebuild locks the scope predicate FOR UPDATE (slice frozen)', () => {
    const src = fs.readFileSync(projRepoPath, 'utf-8');
    expect(src).toContain('lockBalanceProjectionScope');
  });
});
