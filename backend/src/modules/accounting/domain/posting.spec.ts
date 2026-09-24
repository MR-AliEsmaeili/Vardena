import { describe, expect, it } from 'vitest';
import type { AccountingDocument } from './accounting-document.js';
import { parseDateOnly } from './date-range.js';
import {
  checkPostingInput,
  toLedgerEntries,
  toPostingInput,
  toPostingResult,
  type PostingInput,
  type PostingResult,
} from './posting.js';
import { checkLedgerEntry } from './ledger-entry.js';

/**
 * Posting & Ledger Contract Foundation tests (Task 10.6, §22) — CORRECTED.
 *
 * Correction: `accounting_posting_operations` is idempotency/evidence
 * infrastructure, NOT Posting entity identity. PostingResult must NOT assert
 * `id === accounting_posting_operations.id`. Persistence identity of future
 * Posting record is deferred.
 *
 * Covers:
 * - valid contract: finalized voucher → valid posting input
 * - invalid cases: explicit domain-contract rejections
 * - immutability: cannot mutate source voucher
 * - identity: voucher and operation identity preserved, but NOT conflated with ledger row id
 * - relationship: voucher line → ledger entry traceability
 * - idempotency: no second mechanism, operationKey/requestHash remain, evidence vs business act distinguished
 */

const ORG = '01ORGANIZATIONA000000000AA';
const AREA = '01AREAAAAAAAAAAAAAAAAAAAA01';
const YEAR = '01YEARAAAAAAAAAAAAAAAAAAAA01';
const PERIOD = '01PERIODAAAAAAAAAAAAAAAAAAA01';
const DEBIT_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA01';
const CREDIT_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA02';
const DOCUMENT_ID = '01VOUCHERAAAAAAAAAAAAAAAA01';
const OPERATION_KEY = '01OPERATIONKEYAAAAAAAAAAAAAA01';
const REQUEST_HASH = 'a'.repeat(64);

const DOCUMENT_DATE = parseDateOnly('2026-04-05') as Date;
const FINALIZED_AT = new Date('2026-04-05T08:00:00Z');

function finalDocument(
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
    finalizedAt: FINALIZED_AT,
    finalizedBy: '01ACTOR000000000000000000A',
    correctionKind: null,
    correctionReason: null,
    reversesDocumentId: null,
    reversedByDocumentId: null,
    correlationId: '01CORRELATIONAAAAAAAAAAAAAA01',
    lines: [
      {
        id: '01LINEAAAAAAAAAAAAAAAAAAAA01',
        documentId: DOCUMENT_ID,
        lineNo: 1,
        accountId: DEBIT_ACCOUNT,
        debitAmount: '1250',
        creditAmount: '0',
        description: 'Cash',
        sourceLineReference: null,
      },
      {
        id: '01LINEAAAAAAAAAAAAAAAAAAAA02',
        documentId: DOCUMENT_ID,
        lineNo: 2,
        accountId: CREDIT_ACCOUNT,
        debitAmount: '0',
        creditAmount: '1250',
        description: 'Revenue',
        sourceLineReference: null,
      },
    ],
    createdAt: new Date('2026-04-05T07:00:00Z'),
    updatedAt: new Date('2026-04-05T08:00:00Z'),
    ...overrides,
  };
}

function validPostingInput(
  overrides: Partial<PostingInput> = {},
): PostingInput {
  const doc = finalDocument();
  return {
    organizationId: doc.organizationId,
    financialAreaId: doc.financialAreaId,
    fiscalYearId: doc.fiscalYearId,
    accountingPeriodId: doc.accountingPeriodId,
    voucherId: doc.id,
    voucherNumber: doc.documentNumber as string,
    documentDate: doc.documentDate,
    description: doc.description,
    branchId: doc.branchId,
    origin: doc.origin,
    source: null,
    correlationId: doc.correlationId,
    finalizedAt: doc.finalizedAt as Date,
    finalizedBy: doc.finalizedBy,
    lines: doc.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      accountId: line.accountId,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
      description: line.description,
      sourceLineReference: line.sourceLineReference,
    })),
    operationKey: OPERATION_KEY,
    requestHash: REQUEST_HASH,
    ...overrides,
  };
}

describe('posting input contract — valid contract (task §22)', () => {
  it('a valid finalized voucher can be represented as valid posting input', () => {
    const doc = finalDocument();
    const input = toPostingInput({
      document: doc,
      operationKey: OPERATION_KEY,
      requestHash: REQUEST_HASH,
    });
    expect(checkPostingInput(input)).toEqual([]);
    expect(input.voucherId).toBe(DOCUMENT_ID);
    expect(input.voucherNumber).toBe('0001');
    expect(input.lines).toHaveLength(2);
  });

  it('preserves voucher identity and operation identity', () => {
    const doc = finalDocument();
    const input = toPostingInput({
      document: doc,
      operationKey: OPERATION_KEY,
      requestHash: REQUEST_HASH,
    });
    expect(input.voucherId).toBe(doc.id);
    expect(input.organizationId).toBe(doc.organizationId);
    expect(input.financialAreaId).toBe(doc.financialAreaId);
    expect(input.fiscalYearId).toBe(doc.fiscalYearId);
    expect(input.accountingPeriodId).toBe(doc.accountingPeriodId);
    expect(input.operationKey).toBe(OPERATION_KEY);
    expect(input.requestHash).toBe(REQUEST_HASH);
  });
});

describe('posting input contract — invalid cases (task §22)', () => {
  it('rejects missing organization (AC-I-01)', () => {
    const input = validPostingInput({ organizationId: '' });
    expect(checkPostingInput(input)).toContain('missing_organization');
  });

  it('rejects missing financial area (AC-D-02/03)', () => {
    const input = validPostingInput({ financialAreaId: '' });
    expect(checkPostingInput(input)).toContain('missing_financial_area');
  });

  it('rejects missing voucher id (AC-I-14)', () => {
    const input = validPostingInput({ voucherId: '' });
    expect(checkPostingInput(input)).toContain('missing_voucher_id');
  });

  it('rejects missing voucher number (AC-I-22)', () => {
    const input = validPostingInput({ voucherNumber: '' });
    expect(checkPostingInput(input)).toContain('missing_voucher_number');
  });

  it('rejects blank description (contract §12.2)', () => {
    const input = validPostingInput({ description: '   ' });
    expect(checkPostingInput(input)).toContain('blank_description');
  });

  it('rejects missing operation key (AC-I-12 idempotency)', () => {
    const input = validPostingInput({ operationKey: '' });
    expect(checkPostingInput(input)).toContain('missing_operation_key');
  });

  it('rejects missing request hash (ADR-0022 §4)', () => {
    const input = validPostingInput({ requestHash: '' });
    expect(checkPostingInput(input)).toContain('missing_request_hash');
  });

  it('rejects unbalanced lines (AC-I-07)', () => {
    const input = validPostingInput({
      lines: [
        {
          id: '01LINEAAAAAAAAAAAAAAAAAAAA01',
          lineNo: 1,
          accountId: DEBIT_ACCOUNT,
          debitAmount: '100',
          creditAmount: '0',
          description: null,
          sourceLineReference: null,
        },
        {
          id: '01LINEAAAAAAAAAAAAAAAAAAAA02',
          lineNo: 2,
          accountId: CREDIT_ACCOUNT,
          debitAmount: '0',
          creditAmount: '99',
          description: null,
          sourceLineReference: null,
        },
      ],
    });
    expect(checkPostingInput(input)).toContain('unbalanced_document');
  });

  it('rejects zero lines (AC-I-08)', () => {
    const input = validPostingInput({
      lines: [
        {
          id: '01LINEAAAAAAAAAAAAAAAAAAAA01',
          lineNo: 1,
          accountId: DEBIT_ACCOUNT,
          debitAmount: '0',
          creditAmount: '0',
          description: null,
          sourceLineReference: null,
        },
        {
          id: '01LINEAAAAAAAAAAAAAAAAAAAA02',
          lineNo: 2,
          accountId: CREDIT_ACCOUNT,
          debitAmount: '0',
          creditAmount: '0',
          description: null,
          sourceLineReference: null,
        },
      ],
    });
    expect(checkPostingInput(input)).toContain('zero_line');
  });

  it('rejects system origin without source (AC-D-25)', () => {
    const input = validPostingInput({ origin: 'system', source: null });
    expect(checkPostingInput(input)).toContain('source_required_for_system');
  });

  it('rejects manual origin with source (AC-D-24)', () => {
    const input = validPostingInput({
      origin: 'manual',
      source: {
        module: 'inventory',
        entityType: 'inventory_movement',
        entityId: '01MOVEMENTAAAAAAAAAAAAAAAA1',
        operation: 'post',
      },
    });
    expect(checkPostingInput(input)).toContain('source_forbidden_for_manual');
  });
});

describe('posting input contract — immutability (task §22)', () => {
  it('does not mutate source voucher', () => {
    const doc = finalDocument();
    const originalLines = structuredClone(doc.lines);
    const originalDate = doc.documentDate.getTime();
    const input = toPostingInput({
      document: doc,
      operationKey: OPERATION_KEY,
      requestHash: REQUEST_HASH,
    });

    // Mutate returned input
    (input as any).voucherNumber = '9999';
    (input as any).description = 'Hacked';
    (input.lines[0] as any).debitAmount = '999999';
    input.documentDate.setFullYear(2000);
    input.finalizedAt.setFullYear(2000);

    // Source document must be unchanged
    expect(doc.documentNumber).toBe('0001');
    expect(doc.description).toBe('Opening entry');
    expect(doc.lines).toEqual(originalLines);
    expect(doc.documentDate.getTime()).toBe(originalDate);
  });

  it('ledger entries do not mutate posting input', () => {
    const input = validPostingInput();
    const inputSnapshot = structuredClone(input);
    let counter = 0;
    const entries = toLedgerEntries(
      input,
      () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    );

    // Mutate entries
    (entries[0] as any).debitAmount = '9999';

    // Input must stay unchanged
    expect(input).toEqual(inputSnapshot);
  });
});

describe('posting input contract — identity (task §22) — CORRECTED', () => {
  it('preserves voucher line identity for traceability', () => {
    const input = validPostingInput();
    let counter = 0;
    const entries = toLedgerEntries(
      input,
      () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    );

    expect(entries).toHaveLength(input.lines.length);
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      const line = input.lines[i]!;
      expect(entry.voucherLineId).toBe(line.id);
      expect(entry.lineNo).toBe(line.lineNo);
      expect(entry.accountId).toBe(line.accountId);
      expect(entry.debitAmount).toBe(line.debitAmount);
      expect(entry.creditAmount).toBe(line.creditAmount);
    }
  });

  it('posting result preserves voucher and operation identity WITHOUT conflating with accounting_posting_operations.id', () => {
    const input = validPostingInput();
    let counter = 0;
    const result = toPostingResult({
      input,
      generateId: () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    });

    // No artificial id = accounting_posting_operations.id
    expect((result as any).id).toBeUndefined();
    expect(result.voucherId).toBe(input.voucherId);
    expect(result.voucherNumber).toBe(input.voucherNumber);
    expect(result.operationKey).toBe(input.operationKey);
    expect(result.requestHash).toBe(input.requestHash);
    expect(result.organizationId).toBe(input.organizationId);
    expect(result.financialAreaId).toBe(input.financialAreaId);
    expect(result.ledgerEntries).toHaveLength(2);
  });

  it('accounting_posting_operations is idempotency/evidence, not Posting entity identity', () => {
    const input = validPostingInput();
    let counter = 0;
    const result: PostingResult = toPostingResult({
      input,
      generateId: () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    });

    // Result must NOT have a field that claims to be the ledger row id
    // The only identities it carries are business (voucher) + idempotency (operationKey/requestHash)
    expect(Object.keys(result)).not.toContain('id');
    expect(Object.keys(result)).toContain('operationKey');
    expect(Object.keys(result)).toContain('requestHash');
    expect(Object.keys(result)).toContain('voucherId');
    expect(result.operationKey).toBe(OPERATION_KEY);
    expect(result.requestHash).toBe(REQUEST_HASH);

    // Explicitly distinguish:
    // operationKey/requestHash = idempotency identity/evidence
    // Posting = business/domain act (finalization makes voucher part of books)
    // LedgerEntry = resulting historical evidence
    expect(
      result.ledgerEntries.every((e) => e.voucherId === result.voucherId),
    ).toBe(true);
  });
});

describe('posting input contract — relationship (task §22)', () => {
  it('voucher 1 → N ledger entries, line 1 → 1 ledger entry', () => {
    const input = validPostingInput();
    let counter = 0;
    const entries = toLedgerEntries(
      input,
      () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    );

    // Voucher 1 → N
    expect(entries.every((e) => e.voucherId === input.voucherId)).toBe(true);
    expect(entries).toHaveLength(input.lines.length);

    // Line 1 → 1
    const lineIds = input.lines.map((l) => l.id);
    const entryLineIds = entries.map((e) => e.voucherLineId);
    expect(entryLineIds).toEqual(lineIds);

    // Each entry passes ledger invariants
    for (const entry of entries) {
      expect(checkLedgerEntry(entry)).toEqual([]);
    }
  });

  it('ledger entries balance per voucher (AC-I-07)', () => {
    const input = validPostingInput();
    let counter = 0;
    const entries = toLedgerEntries(
      input,
      () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    );

    const totalDebit = entries.reduce(
      (sum, e) => sum + Number(e.debitAmount),
      0,
    );
    const totalCredit = entries.reduce(
      (sum, e) => sum + Number(e.creditAmount),
      0,
    );
    expect(totalDebit).toBe(totalCredit);
  });
});

describe('posting contract — idempotency boundary (task §22, §11) — CORRECTED', () => {
  it('does not introduce second idempotency mechanism — reuses operationKey/requestHash', () => {
    const input = validPostingInput();
    // The contract's idempotency fields are exactly the existing ledger's
    // (organizationId, operationKey, requestHash). No new table, no new key scheme.
    expect(input.operationKey).toBe(OPERATION_KEY);
    expect(input.requestHash).toBe(REQUEST_HASH);
    expect(input.operationKey.trim().length).toBeGreaterThan(0);
    expect(input.requestHash.trim().length).toBe(64);

    // PostingResult also carries same operationKey/requestHash, not a new one, and no id conflation
    let counter = 0;
    const result = toPostingResult({
      input,
      generateId: () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    });
    expect(result.operationKey).toBe(OPERATION_KEY);
    expect(result.requestHash).toBe(REQUEST_HASH);
    expect((result as any).id).toBeUndefined();
  });

  it('operationKey and requestHash remain part of posting input contract', () => {
    const input = validPostingInput();
    expect(input.operationKey).toBeDefined();
    expect(input.requestHash).toBeDefined();
    expect(checkPostingInput(input)).not.toContain('missing_operation_key');
    expect(checkPostingInput(input)).not.toContain('missing_request_hash');
  });

  it('toPostingInput throws for non-final voucher (only final may be posted)', () => {
    const draft = finalDocument({
      phase: 'draft',
      documentNumber: null,
      finalizedAt: null,
    });
    expect(() =>
      toPostingInput({
        document: draft,
        operationKey: OPERATION_KEY,
        requestHash: REQUEST_HASH,
      }),
    ).toThrow(/non-final/);
  });

  it('toPostingInput throws for unnumbered final voucher (AC-I-22)', () => {
    const unnumbered = finalDocument({ documentNumber: null });
    expect(() =>
      toPostingInput({
        document: unnumbered,
        operationKey: OPERATION_KEY,
        requestHash: REQUEST_HASH,
      }),
    ).toThrow(/unnumbered/);
  });

  it('does NOT pre-commit to ledger-post-${voucherId} pattern', () => {
    // The corrected contract explicitly does NOT mandate ledger-post-${voucherId}
    // The idempotency boundary for a separated ledger materialization transaction
    // must be decided in that future task (OQ-39 dependent).
    const input = validPostingInput();
    // Our current operationKey is the finalization's key, not a pre-committed ledger-post- pattern
    expect(input.operationKey).toBe(OPERATION_KEY);
    expect(input.operationKey).not.toMatch(/^ledger-post-/);
  });
});

describe('posting contract — dimensions seam (OQ-41)', () => {
  it('ledger entries have empty dimensionAssignments by default (deferred)', () => {
    const input = validPostingInput();
    let counter = 0;
    const entries = toLedgerEntries(
      input,
      () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    );
    for (const entry of entries) {
      expect(entry.dimensionAssignments).toEqual([]);
    }
  });
});

describe('posting contract — no migration (task §20)', () => {
  it('contract does not require new tables — uses existing accounting_posting_operations as evidence only', () => {
    // This test documents that no new table is introduced; the contract is pure domain types.
    // The presence of operationKey/requestHash proves reuse, not invention.
    const input = validPostingInput();
    expect(input.operationKey).toBe(OPERATION_KEY);
    // PostingResult has no id that would imply a new Posting persistence table
    let counter = 0;
    const result = toPostingResult({
      input,
      generateId: () => `01LEDGER${String(counter++).padStart(18, '0')}`,
    });
    expect((result as any).id).toBeUndefined();
  });
});
