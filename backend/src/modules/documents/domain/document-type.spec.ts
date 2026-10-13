import { describe, expect, it } from 'vitest';
import {
  assertValidDocumentTypeDefinition,
  assertValidDocumentTypeDefinitions,
  defaultEntryState,
  DOCUMENT_ACTIONS,
  DOCUMENT_STATES,
  DRAFT_PHASE,
  isDocumentAction,
  isDocumentPhase,
  isDocumentState,
  isValidDocumentTypeCode,
  isValidModuleName,
  type DocumentTypeDefinition,
} from './document-type.js';

function definition(
  overrides: Partial<DocumentTypeDefinition> = {},
): DocumentTypeDefinition {
  return {
    code: 'inventory_receipt',
    module: 'inventory',
    name: 'Inventory receipt',
    draftCapable: true,
    entryStates: ['temporary'],
    deletablePhases: ['draft', 'temporary'],
    ...overrides,
  };
}

describe('document states', () => {
  it('has exactly temporary and final as primary states — no INITIAL', () => {
    expect([...DOCUMENT_STATES].sort()).toEqual(['final', 'temporary']);
    expect(isDocumentState('temporary')).toBe(true);
    expect(isDocumentState('final')).toBe(true);
    expect(isDocumentState('initial')).toBe(false);
    expect(isDocumentState('draft')).toBe(false);
  });

  it('treats draft as a separate phase, not a state', () => {
    expect(DRAFT_PHASE).toBe('draft');
    expect(isDocumentPhase('draft')).toBe(true);
    expect(isDocumentPhase('temporary')).toBe(true);
    expect(isDocumentPhase('final')).toBe(true);
    expect(isDocumentPhase('initial')).toBe(false);
  });

  it('models the ten state/phase actions', () => {
    expect([...DOCUMENT_ACTIONS].sort()).toEqual(
      [
        'assign_number',
        'create',
        'delete',
        'edit',
        'export',
        'finalize',
        'print',
        'reopen',
        'submit',
        'view',
      ].sort(),
    );
    expect(isDocumentAction('finalize')).toBe(true);
    expect(isDocumentAction('approve')).toBe(false);
  });
});

describe('document type codes and module names', () => {
  it('accepts stable snake_case codes', () => {
    expect(isValidDocumentTypeCode('inventory_receipt')).toBe(true);
    expect(isValidDocumentTypeCode('sales_invoice')).toBe(true);
    expect(isValidDocumentTypeCode('accounting_journal')).toBe(true);
  });

  it('rejects codes with symbols, spaces or uppercase', () => {
    expect(isValidDocumentTypeCode('Inventory.Receipt')).toBe(false);
    expect(isValidDocumentTypeCode('inventory-receipt')).toBe(false);
    expect(isValidDocumentTypeCode('inv 001')).toBe(false);
    expect(isValidDocumentTypeCode('')).toBe(false);
  });

  it('accepts lowercase module names', () => {
    expect(isValidModuleName('inventory')).toBe(true);
    expect(isValidModuleName('sales')).toBe(true);
    expect(isValidModuleName('Sales')).toBe(false);
  });
});

describe('document type definition validation', () => {
  it('accepts a well-formed definition', () => {
    expect(() => assertValidDocumentTypeDefinition(definition())).not.toThrow();
  });

  it('rejects an empty entry-state list', () => {
    expect(() =>
      assertValidDocumentTypeDefinition(definition({ entryStates: [] })),
    ).toThrow(/entry state/i);
  });

  it('rejects an unknown entry state', () => {
    expect(() =>
      assertValidDocumentTypeDefinition(
        definition({ entryStates: ['initial' as never] }),
      ),
    ).toThrow(/entry state/i);
  });

  it('rejects draft listed as deletable on a non-draft-capable type', () => {
    expect(() =>
      assertValidDocumentTypeDefinition(
        definition({
          draftCapable: false,
          deletablePhases: ['draft', 'temporary'],
        }),
      ),
    ).toThrow(/draft/i);
  });

  it('fails registration on duplicated codes', () => {
    expect(() =>
      assertValidDocumentTypeDefinitions([definition(), definition()]),
    ).toThrow(/duplicate/i);
  });
});

describe('default entry state', () => {
  it('uses the first declared entry state', () => {
    expect(defaultEntryState(definition({ entryStates: ['temporary'] }))).toBe(
      'temporary',
    );
    expect(defaultEntryState(definition({ entryStates: ['final'] }))).toBe(
      'final',
    );
  });
});
