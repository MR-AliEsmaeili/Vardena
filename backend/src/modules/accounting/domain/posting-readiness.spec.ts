import { describe, expect, it } from 'vitest';
import {
  evaluatePostingReadiness,
  type PostingReadinessAccount,
  type PostingReadinessEvaluation,
  type PostingReadinessScope,
} from './posting-readiness.js';
import type { AccountingDocument } from './accounting-document.js';
import { parseDateOnly } from './date-range.js';

/**
 * The posting-readiness decision table (Task 10.5, contract §15.5/§19.3).
 *
 * What is pinned here is the SHAPE OF THE VERDICT, never message text: the
 * reason codes (machine-readable, reusing `VoucherLineProblem` and the
 * origin vocabulary verbatim), the every-problem-at-once behaviour, the
 * fixed reason order, and the two DELIBERATE non-criteria — calendar
 * statuses and account activity cannot even be expressed in the input
 * (§7.2 rule 7, §8.6), which the service-level suite pins end to end.
 *
 * The snapshots are crafted directly: several states below (a final voucher
 * without a number, an unbalanced stored line set) are unreachable through
 * the application's guarded paths — the evaluation is the defensive
 * re-verification the future Posting Engine consumes, so its decision table
 * must be proven on the unreachable states it exists to catch.
 */

const ORG = '01ORGANIZATIONA000000000AA';
const AREA = '01AREAAAAAAAAAAAAAAAAAAAA01';
const YEAR = '01YEARAAAAAAAAAAAAAAAAAAAA01';
const PERIOD = '01PERIODAAAAAAAAAAAAAAAAAAA01';
const DEBIT_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA01';
const CREDIT_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA02';
const DOCUMENT_ID = '01VOUCHERAAAAAAAAAAAAAAAA01';

const DOCUMENT_DATE = parseDateOnly('2026-04-05') as Date;
const YEAR_START = parseDateOnly('2026-01-01') as Date;
const YEAR_END = parseDateOnly('2026-12-31') as Date;
const PERIOD_START = parseDateOnly('2026-04-01') as Date;
const PERIOD_END = parseDateOnly('2026-04-30') as Date;

/** A stored FINAL voucher that satisfies every book invariant (§15.5). */
function finalVoucher(
  overrides: Partial<AccountingDocument> = {},
): AccountingDocument {
  return {
    id: DOCUMENT_ID,
    organizationId: ORG,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    accountingPeriodId: PERIOD,
    documentType: 'accounting_voucher',
    documentNumber: '0001',
    documentDate: DOCUMENT_DATE,
    description: 'Opening entry',
    phase: 'final',
    origin: 'manual',
    branchId: null,
    source: null,
    idempotencyReference: null,
    requestHash: null,
    finalizedAt: new Date('2026-04-05T08:00:00Z'),
    finalizedBy: '01ACTOR000000000000000000A',
    correlationId: null,
    lines: [
      {
        id: '01LINEAAAAAAAAAAAAAAAAAAAA01',
        documentId: DOCUMENT_ID,
        lineNo: 1,
        accountId: DEBIT_ACCOUNT,
        debitAmount: '1250',
        creditAmount: '0',
        description: null,
        sourceLineReference: null,
      },
      {
        id: '01LINEAAAAAAAAAAAAAAAAAAAA02',
        documentId: DOCUMENT_ID,
        lineNo: 2,
        accountId: CREDIT_ACCOUNT,
        debitAmount: '0',
        creditAmount: '1250',
        description: null,
        sourceLineReference: null,
      },
    ],
    createdAt: new Date('2026-04-05T07:00:00Z'),
    updatedAt: new Date('2026-04-05T08:00:00Z'),
    ...overrides,
  };
}

/** The calendar rows as the finalization transaction resolved them. */
function resolvedScope(): PostingReadinessScope {
  return {
    area: { id: AREA, organizationId: ORG },
    fiscalYear: {
      id: YEAR,
      organizationId: ORG,
      financialAreaId: AREA,
      startDate: YEAR_START,
      endDate: YEAR_END,
    },
    accountingPeriod: {
      id: PERIOD,
      fiscalYearId: YEAR,
      startDate: PERIOD_START,
      endDate: PERIOD_END,
    },
  };
}

/** The baseline debit account, postable and in-organization. */
function debitAccount(): PostingReadinessAccount {
  return { id: DEBIT_ACCOUNT, organizationId: ORG, isPostable: true };
}

function baseline(
  overrides: {
    document?: Partial<AccountingDocument>;
    scope?: Partial<PostingReadinessScope>;
    accounts?: PostingReadinessAccount[];
  } = {},
): PostingReadinessEvaluation {
  const document = finalVoucher(overrides.document);
  return {
    document,
    scope: { ...resolvedScope(), ...overrides.scope },
    accounts: overrides.accounts ?? [
      debitAccount(),
      { id: CREDIT_ACCOUNT, organizationId: ORG, isPostable: true },
    ],
  };
}

describe('posting readiness — the positive verdict (§15.5)', () => {
  it('reports a finalized, valid voucher as ready with no reasons', () => {
    const verdict = evaluatePostingReadiness(baseline());
    expect(verdict).toEqual({
      status: 'ready',
      documentId: DOCUMENT_ID,
      reasons: [],
    });
  });

  it('is pure: the same input yields the same verdict and is left untouched', () => {
    const input = baseline();
    const inputSnapshot = structuredClone(input);
    const first = evaluatePostingReadiness(input);
    const second = evaluatePostingReadiness(input);
    expect(second).toEqual(first);
    expect(input).toEqual(inputSnapshot);
  });
});

describe('posting readiness — document state (§15.1/§18/§12.2)', () => {
  it('refuses a draft voucher and names its phase', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        document: {
          phase: 'draft',
          documentNumber: null,
          finalizedAt: null,
          finalizedBy: null,
        },
      }),
    );
    expect(verdict.status).toBe('not_ready');
    expect(verdict.reasons).toContainEqual({
      problem: 'document_not_final',
      phase: 'draft',
    });
    // A draft has no serial yet by design (§18): that is not a defect of its
    // own, so the number rule stays silent for non-final documents.
    expect(verdict.reasons).not.toContainEqual({
      problem: 'document_not_numbered',
    });
  });

  it('refuses a temporary voucher and names its phase', () => {
    const verdict = evaluatePostingReadiness(
      baseline({ document: { phase: 'temporary', finalizedAt: null } }),
    );
    expect(verdict.status).toBe('not_ready');
    expect(verdict.reasons).toEqual([
      { problem: 'document_not_final', phase: 'temporary' },
    ]);
  });

  it('refuses a final voucher that carries no number (§18: one always exists)', () => {
    const verdict = evaluatePostingReadiness(
      baseline({ document: { documentNumber: null } }),
    );
    expect(verdict.status).toBe('not_ready');
    expect(verdict.reasons).toEqual([{ problem: 'document_not_numbered' }]);
  });

  it('refuses a voucher with a blank description (§12.2)', () => {
    const verdict = evaluatePostingReadiness(
      baseline({ document: { description: '   ' } }),
    );
    expect(verdict.reasons).toEqual([{ problem: 'missing_description' }]);
  });
});

describe('posting readiness — origin evidence (§16.1/§16.3)', () => {
  it('refuses a system-origin voucher without its source identity', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        document: {
          origin: 'system',
          source: null,
          idempotencyReference: 'key-1',
          requestHash: 'hash-1',
        },
      }),
    );
    expect(verdict.reasons).toEqual([
      { problem: 'source_required_for_system' },
    ]);
  });

  it('refuses a manual voucher that carries a system source identity', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        document: {
          source: {
            module: 'inventory',
            entityType: 'inventory_movement',
            entityId: '01MOVEMENTAAAAAAAAAAAAAAAA1',
            operation: 'post',
          },
        },
      }),
    );
    expect(verdict.reasons).toEqual([
      { problem: 'source_forbidden_for_manual' },
    ]);
  });

  it('refuses a malformed source identity', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        document: {
          origin: 'system',
          source: {
            module: 'Inventory!',
            entityType: 'inventory_movement',
            entityId: '01MOVEMENTAAAAAAAAAAAAAAAA1',
            operation: 'post',
          },
        },
      }),
    );
    expect(verdict.reasons).toEqual([{ problem: 'malformed_source' }]);
  });

  it('accepts a consistent system-origin voucher (the shape OQ-39 will deliver)', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        document: {
          origin: 'system',
          source: {
            module: 'inventory',
            entityType: 'inventory_movement',
            entityId: '01MOVEMENTAAAAAAAAAAAAAAAA1',
            operation: 'post',
          },
        },
      }),
    );
    expect(verdict.status).toBe('ready');
  });
});

describe('posting readiness — line composition (§13, AC-I-07/08)', () => {
  it("reuses the voucher-lines decision table's vocabulary verbatim", () => {
    // Unbalanced: the stored amounts no longer satisfy Σ debit = Σ credit.
    const unbalanced = evaluatePostingReadiness(
      baseline({
        document: {
          lines: finalVoucher().lines.map((line, index) =>
            index === 0 ? { ...line, debitAmount: '1250.01' } : line,
          ),
        },
      }),
    );
    expect(unbalanced.status).toBe('not_ready');
    expect(unbalanced.reasons).toEqual([{ problem: 'unbalanced_document' }]);

    // A single line is not a double-entry document.
    const oneLine = evaluatePostingReadiness(
      baseline({ document: { lines: finalVoucher().lines.slice(0, 1) } }),
    );
    expect(oneLine.reasons).toContainEqual({ problem: 'too_few_lines' });
    expect(oneLine.reasons).toContainEqual({ problem: 'missing_credit_side' });

    // A zero line carries no accounting fact (§13.2).
    const zeroLine = evaluatePostingReadiness(
      baseline({
        document: {
          lines: finalVoucher().lines.map((line, index) =>
            index === 0
              ? { ...line, debitAmount: '0', creditAmount: '0' }
              : line,
          ),
        },
      }),
    );
    expect(zeroLine.reasons).toContainEqual({ problem: 'zero_line' });

    // Both sides on one line is two lines (§13.2).
    const bothSides = evaluatePostingReadiness(
      baseline({
        document: {
          lines: finalVoucher().lines.map((line, index) =>
            index === 0
              ? { ...line, debitAmount: '10', creditAmount: '10' }
              : line,
          ),
        },
      }),
    );
    expect(bothSides.reasons).toContainEqual({ problem: 'both_sides_set' });

    // Dense 1-based numbering is part of the composition (§12.5).
    const gapped = evaluatePostingReadiness(
      baseline({
        document: {
          lines: finalVoucher().lines.map((line, index) =>
            index === 1 ? { ...line, lineNo: 3 } : line,
          ),
        },
      }),
    );
    expect(gapped.reasons).toContainEqual({ problem: 'gaps_in_line_numbers' });
  });

  it('reports every composition problem at once, not just the first', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        document: {
          lines: [
            {
              id: '01LINEAAAAAAAAAAAAAAAAAAAA01',
              documentId: DOCUMENT_ID,
              lineNo: 1,
              accountId: DEBIT_ACCOUNT,
              debitAmount: '5',
              creditAmount: '5',
              description: null,
              sourceLineReference: null,
            },
            {
              id: '01LINEAAAAAAAAAAAAAAAAAAAA02',
              documentId: DOCUMENT_ID,
              lineNo: 3,
              accountId: CREDIT_ACCOUNT,
              debitAmount: '0',
              creditAmount: '0',
              description: null,
              sourceLineReference: null,
            },
          ],
        },
      }),
    );
    expect(verdict.reasons.map((reason) => reason.problem)).toEqual(
      expect.arrayContaining([
        'both_sides_set',
        'zero_line',
        'gaps_in_line_numbers',
      ]),
    );
  });
});

describe('posting readiness — accounts (§14, AC-I-09)', () => {
  it('refuses a line whose account row is missing', () => {
    const verdict = evaluatePostingReadiness(
      baseline({ accounts: [debitAccount()] }),
    );
    expect(verdict.reasons).toEqual([
      { problem: 'account_not_found', accountId: CREDIT_ACCOUNT },
    ]);
  });

  it('treats an account of another organization as not found (AC-I-16)', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        accounts: [
          debitAccount(),
          {
            id: CREDIT_ACCOUNT,
            organizationId: '01ORGANIZATIONB000000000BB',
            isPostable: true,
          },
        ],
      }),
    );
    expect(verdict.reasons).toEqual([
      { problem: 'account_not_found', accountId: CREDIT_ACCOUNT },
    ]);
  });

  it('refuses a non-postable account and names it', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        accounts: [
          debitAccount(),
          { id: CREDIT_ACCOUNT, organizationId: ORG, isPostable: false },
        ],
      }),
    );
    expect(verdict.reasons).toEqual([
      { problem: 'account_not_postable', accountId: CREDIT_ACCOUNT },
    ]);
  });

  it('reports each offending account once, ascending by id', () => {
    // Both referenced accounts are missing from the snapshot: two reasons,
    // deduplicated per account and sorted by id (…01 before …02).
    const verdict = evaluatePostingReadiness(baseline({ accounts: [] }));
    expect(verdict.reasons).toEqual([
      { problem: 'account_not_found', accountId: DEBIT_ACCOUNT },
      { problem: 'account_not_found', accountId: CREDIT_ACCOUNT },
    ]);
  });
});

describe('posting readiness — calendar scope (§6.2 rule 4, AC-I-02/14)', () => {
  it('refuses a voucher whose financial area is gone or foreign', () => {
    const missing = evaluatePostingReadiness(
      baseline({ scope: { area: null } }),
    );
    expect(missing.reasons).toEqual([
      { problem: 'scope_unresolvable', scope: 'area' },
    ]);

    const foreign = evaluatePostingReadiness(
      baseline({
        scope: {
          area: { id: AREA, organizationId: '01ORGANIZATIONB000000000BB' },
        },
      }),
    );
    expect(foreign.reasons).toEqual([
      { problem: 'scope_unresolvable', scope: 'area' },
    ]);
  });

  it('refuses a voucher whose stored year no longer contains its date', () => {
    // The realistic drift: a year's dates were edited while it was open
    // (Task 10.2's §6.5 reading) and the stored resolution went stale.
    const drifted = evaluatePostingReadiness(
      baseline({
        scope: {
          fiscalYear: {
            id: YEAR,
            organizationId: ORG,
            financialAreaId: AREA,
            startDate: parseDateOnly('2027-01-01') as Date,
            endDate: parseDateOnly('2027-12-31') as Date,
          },
        },
      }),
    );
    expect(drifted.reasons).toEqual([
      { problem: 'scope_unresolvable', scope: 'year' },
    ]);
  });

  it('refuses a voucher whose year belongs to another area or organization', () => {
    const otherArea = evaluatePostingReadiness(
      baseline({
        scope: {
          fiscalYear: {
            id: YEAR,
            organizationId: ORG,
            financialAreaId: '01AREAAAAAAAAAAAAAAAAAAAA99',
            startDate: YEAR_START,
            endDate: YEAR_END,
          },
        },
      }),
    );
    expect(otherArea.reasons).toEqual([
      { problem: 'scope_unresolvable', scope: 'year' },
    ]);

    const otherOrg = evaluatePostingReadiness(
      baseline({
        scope: {
          fiscalYear: {
            id: YEAR,
            organizationId: '01ORGANIZATIONB000000000BB',
            financialAreaId: AREA,
            startDate: YEAR_START,
            endDate: YEAR_END,
          },
        },
      }),
    );
    expect(otherOrg.reasons).toEqual([
      { problem: 'scope_unresolvable', scope: 'year' },
    ]);
  });

  it('refuses a voucher whose period is gone, foreign to its year, or off-date', () => {
    const missing = evaluatePostingReadiness(
      baseline({ scope: { accountingPeriod: null } }),
    );
    expect(missing.reasons).toEqual([
      { problem: 'scope_unresolvable', scope: 'period' },
    ]);

    const otherYear = evaluatePostingReadiness(
      baseline({
        scope: {
          accountingPeriod: {
            id: PERIOD,
            fiscalYearId: '01YEARAAAAAAAAAAAAAAAAAAAA99',
            startDate: PERIOD_START,
            endDate: PERIOD_END,
          },
        },
      }),
    );
    expect(otherYear.reasons).toEqual([
      { problem: 'scope_unresolvable', scope: 'period' },
    ]);

    const offDate = evaluatePostingReadiness(
      baseline({
        scope: {
          accountingPeriod: {
            id: PERIOD,
            fiscalYearId: YEAR,
            startDate: parseDateOnly('2026-05-01') as Date,
            endDate: parseDateOnly('2026-05-31') as Date,
          },
        },
      }),
    );
    expect(offDate.reasons).toEqual([
      { problem: 'scope_unresolvable', scope: 'period' },
    ]);
  });
});

describe('posting readiness — the aggregate verdict', () => {
  it('reports every dimension in the fixed order, all at once', () => {
    const verdict = evaluatePostingReadiness(
      baseline({
        document: {
          phase: 'draft',
          documentNumber: null,
          description: '',
          lines: finalVoucher().lines.slice(0, 1),
        },
        accounts: [],
        scope: { area: null, fiscalYear: null, accountingPeriod: null },
      }),
    );
    expect(verdict.status).toBe('not_ready');
    expect(verdict.documentId).toBe(DOCUMENT_ID);
    expect(verdict.reasons.map((reason) => reason.problem)).toEqual([
      'document_not_final',
      'missing_description',
      'too_few_lines',
      'missing_credit_side',
      'unbalanced_document',
      'account_not_found',
      'scope_unresolvable',
      'scope_unresolvable',
      'scope_unresolvable',
    ]);
  });
});
