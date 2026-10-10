import { describe, expect, it } from 'vitest';
import { parseDateOnly } from './date-range.js';
import {
  ACCOUNTING_DOCUMENT_PHASES,
  ACCOUNTING_DOCUMENT_ORIGINS,
  ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
  ACCOUNTING_VOUCHER_TYPE_DEFINITION,
  checkOriginEvidence,
  isAccountingDocumentPhase,
  isEditablePhase,
  planVoucherAreaChange,
  planVoucherCreate,
  planVoucherDelete,
  planVoucherEdit,
  planVoucherFinalize,
  planVoucherIssue,
  toAccountingDocumentDto,
  voucherScopeKey,
  type AccountingDocument,
} from './accounting-document.js';

/**
 * The voucher aggregate's lifecycle and origin rules (contract §12/§15/§16,
 * AC-D-16…AC-D-24).
 *
 * What is pinned here is the SHAPE OF THE DECISION, not its message text: the
 * planners compose the Document Foundation's model (ADR-0023) instead of
 * re-implementing it, so this suite asserts that the composition happens —
 * `final` is protected everywhere, a draft can be issued but not finalized,
 * and the deletable phases are exactly the two the contract names.
 */
describe('accounting voucher type definition (§12.1, AC-D-16)', () => {
  it('registers exactly one manual|system document type with the contract lifecycle', () => {
    expect(ACCOUNTING_VOUCHER_DOCUMENT_TYPE).toBe('accounting_voucher');
    expect(ACCOUNTING_VOUCHER_TYPE_DEFINITION.code).toBe('accounting_voucher');
    expect(ACCOUNTING_VOUCHER_TYPE_DEFINITION.module).toBe('accounting');
    // The type reaches `temporary` on creation and `final` only by finalizing:
    // no `initial`, no `final` entry state (§15.1; Mode A is OQ-42-gated).
    expect([...ACCOUNTING_VOUCHER_TYPE_DEFINITION.entryStates]).toEqual([
      'temporary',
    ]);
    // AC-D-21 verbatim — and `final` is deliberately absent.
    expect([...ACCOUNTING_VOUCHER_TYPE_DEFINITION.deletablePhases]).toEqual([
      'draft',
      'temporary',
    ]);
    expect(ACCOUNTING_VOUCHER_TYPE_DEFINITION.draftCapable).toBe(true);
  });

  it('knows exactly three phases and no more', () => {
    expect([...ACCOUNTING_DOCUMENT_PHASES]).toEqual([
      'draft',
      'temporary',
      'final',
    ]);
    expect(isAccountingDocumentPhase('draft')).toBe(true);
    expect(isAccountingDocumentPhase('temporary')).toBe(true);
    expect(isAccountingDocumentPhase('final')).toBe(true);
    // No `initial`, no `void`, no `deleted`, no `reopened` (§15.1).
    for (const value of ['initial', 'void', 'deleted', 'posted', 'approved']) {
      expect(isAccountingDocumentPhase(value)).toBe(false);
    }
    expect(ACCOUNTING_DOCUMENT_ORIGINS).toEqual(['manual', 'system']);
  });

  it('treats draft AND temporary as editable, and final as never editable', () => {
    expect(isEditablePhase('draft')).toBe(true);
    expect(isEditablePhase('temporary')).toBe(true);
    expect(isEditablePhase('final')).toBe(false);
  });

  it('scopes numbering by the financial area, in the Foundation token grammar', () => {
    // `numbering.scope_key` is opaque but lowercase-only; a ULID is uppercase,
    // so the encoding is lossless and injective.
    const areaId = '01J8ZQ9W7R6T5Y4U3I2O1P0ABC';
    expect(voucherScopeKey(areaId)).toBe('01j8zq9w7r6t5y4u3i2o1p0abc');
    expect(/^[a-z0-9_-]{0,64}$/.test(voucherScopeKey(areaId))).toBe(true);
    // Two different areas never share a series.
    expect(voucherScopeKey(areaId)).not.toBe(
      voucherScopeKey('01J8ZQ9W7R6T5Y4U3I2O1P0ABD'),
    );
  });
});

describe('accounting voucher lifecycle decisions (§15, AC-D-20…AC-D-23)', () => {
  it('starts in draft only when the organization requires a draft (§15.1)', () => {
    expect(planVoucherCreate({ draftRequired: true })).toEqual({
      problem: null,
      phase: 'draft',
    });
    expect(planVoucherCreate({ draftRequired: false })).toEqual({
      problem: null,
      phase: 'temporary',
    });
  });

  it('allows edits in draft and temporary, and protects final (AC-I-05)', () => {
    expect(planVoucherEdit('draft').problem).toBeNull();
    expect(planVoucherEdit('temporary').problem).toBeNull();
    expect(planVoucherEdit('final').problem).toBe('final_protected');
  });

  it('allows discarding a pre-final voucher and never a final one (AC-I-06)', () => {
    expect(planVoucherDelete('draft').problem).toBeNull();
    expect(planVoucherDelete('temporary').problem).toBeNull();
    expect(planVoucherDelete('final').problem).toBe('final_protected');
  });

  it('issues a draft, replays an issued voucher, refuses a final one', () => {
    expect(planVoucherIssue('draft')).toEqual({ kind: 'issue' });
    // Issuance is idempotent on its post-state: no second serial is allocated.
    expect(planVoucherIssue('temporary')).toEqual({ kind: 'replay' });
    expect(planVoucherIssue('final')).toEqual({
      kind: 'refused',
      problem: 'final_protected',
    });
  });

  it('finalizes only a temporary voucher — never a draft, never a final', () => {
    expect(planVoucherFinalize('temporary').problem).toBeNull();
    // A draft has no serial yet, so it cannot enter the books.
    expect(planVoucherFinalize('draft').problem).toBe('not_temporary');
    // Re-finalizing is a state conflict, not a silent no-op.
    expect(planVoucherFinalize('final').problem).toBe('already_final');
  });

  it('freezes the financial area once the voucher is issued (AC-D-03)', () => {
    expect(
      planVoucherAreaChange({ phase: 'draft', areaChanged: true }).problem,
    ).toBeNull();
    expect(
      planVoucherAreaChange({ phase: 'draft', areaChanged: false }).problem,
    ).toBeNull();
    expect(
      planVoucherAreaChange({ phase: 'temporary', areaChanged: true }).problem,
    ).toBe('area_immutable_after_issuance');
    expect(
      planVoucherAreaChange({ phase: 'temporary', areaChanged: false }).problem,
    ).toBeNull();
    expect(
      planVoucherAreaChange({ phase: 'final', areaChanged: true }).problem,
    ).toBe('area_immutable_after_issuance');
  });
});

describe('system-origin source identity (§16.1/§16.3, AC-D-24)', () => {
  const source = {
    module: 'inventory',
    entityType: 'inventory_movement',
    entityId: '01J8ZQ9W7R6T5Y4U3I2O1P0ABC',
    operation: 'post',
  };

  it('forbids a source identity on a manual document and requires it for a system one', () => {
    expect(checkOriginEvidence('manual', null)).toBeNull();
    expect(checkOriginEvidence('manual', source)).toBe(
      'source_forbidden_for_manual',
    );
    expect(checkOriginEvidence('system', source)).toBeNull();
    expect(checkOriginEvidence('system', null)).toBe(
      'source_required_for_system',
    );
  });

  it('refuses a malformed source identity (grammar, not policy)', () => {
    expect(
      checkOriginEvidence('system', { ...source, module: 'Inventory' }),
    ).toBe('malformed_source');
    expect(
      checkOriginEvidence('system', { ...source, operation: 'post-movement' }),
    ).toBe('malformed_source');
    expect(checkOriginEvidence('system', { ...source, entityId: '' })).toBe(
      'malformed_source',
    );
    expect(
      checkOriginEvidence('system', {
        ...source,
        operation: 'x'.repeat(33),
      }),
    ).toBe('malformed_source');
  });
});

describe('accounting document DTO (§13.5, AR-24)', () => {
  const document: AccountingDocument = {
    id: '01J8ZQ9W7R6T5Y4U3I2O1P0ABC',
    organizationId: '01J8ZQ9W7R6T5Y4U3I2O1P0ORG',
    financialAreaId: '01J8ZQ9W7R6T5Y4U3I2O1P0ARA',
    fiscalYearId: '01J8ZQ9W7R6T5Y4U3I2O1P0FYR',
    accountingPeriodId: '01J8ZQ9W7R6T5Y4U3I2O1P0PRD',
    documentType: 'accounting_voucher',
    documentNumber: '1002',
    documentDate: parseDateOnly('2026-04-05')!,
    description: 'Opening entry',
    phase: 'temporary',
    origin: 'manual',
    branchId: null,
    source: null,
    idempotencyReference: null,
    requestHash: null,
    finalizedAt: null,
    finalizedBy: null,
    correctionKind: null,
    correctionReason: null,
    reversesDocumentId: null,
    reversedByDocumentId: null,
    correlationId: null,
    lines: [
      {
        id: 'line-2',
        documentId: 'doc',
        lineNo: 2,
        accountId: 'account-2',
        debitAmount: '0.00',
        creditAmount: '1250.00',
        description: null,
        sourceLineReference: null,
      },
      {
        id: 'line-1',
        documentId: 'doc',
        lineNo: 1,
        accountId: 'account-1',
        debitAmount: '1250.00',
        creditAmount: '0',
        description: 'Debit',
        sourceLineReference: null,
      },
    ],
    createdAt: new Date(Date.UTC(2026, 3, 5, 10, 30)),
    updatedAt: new Date(Date.UTC(2026, 3, 5, 10, 30)),
  };

  it('renders a date-only business date and derives the exact totals', () => {
    const dto = toAccountingDocumentDto(document);
    expect(dto.documentDate).toBe('2026-04-05');
    expect(dto.state).toBe('temporary');
    expect(dto.totalDebit).toBe('1250');
    expect(dto.totalCredit).toBe('1250');
    // Canonical strings, never floats, never the raw `numeric` spelling.
    expect(dto.lines.map((line) => line.debitAmount)).toEqual(['1250', '0']);
  });

  it('renders the lines in rendering order regardless of storage order', () => {
    const dto = toAccountingDocumentDto(document);
    expect(dto.lines.map((line) => line.lineNo)).toEqual([1, 2]);
    expect(dto.lines.map((line) => line.accountId)).toEqual([
      'account-1',
      'account-2',
    ]);
  });

  it('never leaks an audit actor (AR-24)', () => {
    const dto = toAccountingDocumentDto(document) as unknown as Record<
      string,
      unknown
    >;
    expect(dto.createdBy).toBeUndefined();
    expect(dto.updatedBy).toBeUndefined();
    expect(Object.keys(dto)).not.toContain('createdBy');
    expect(Object.keys(dto)).not.toContain('updatedBy');
  });

  it('carries reversal linkage on the DTO', () => {
    const dto = toAccountingDocumentDto({
      ...document,
      correctionKind: 'reversal',
      correctionReason: 'Posted in error',
      reversesDocumentId: '01J8ZQ9W7R6T5Y4U3I2O1P0ORG',
      reversedByDocumentId: null,
    });
    expect(dto.correctionKind).toBe('reversal');
    expect(dto.correctionReason).toBe('Posted in error');
    expect(dto.reversesDocumentId).toBe('01J8ZQ9W7R6T5Y4U3I2O1P0ORG');
    expect(dto.reversedByDocumentId).toBeNull();
  });
});
