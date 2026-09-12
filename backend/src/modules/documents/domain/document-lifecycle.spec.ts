import { describe, expect, it } from 'vitest';
import {
  lifecycleProblemMessage,
  planDelete,
  planDocumentAction,
  planEdit,
  planEntry,
  planFinalize,
  planReopen,
  planSubmit,
  requiresDraft,
} from './document-lifecycle.js';
import type { DocumentLifecycleContext } from './document-lifecycle.js';
import type { DocumentPhase, DocumentTypeDefinition } from './document-type.js';

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

function context(
  phase: DocumentPhase | null,
  overrides: Partial<DocumentLifecycleContext> = {},
): DocumentLifecycleContext {
  return {
    definition: definition(),
    draftRequired: false,
    phase,
    ...overrides,
  };
}

describe('draft selection (Task 8 §8)', () => {
  it('requires draft only when configured AND the type is draft-capable', () => {
    expect(requiresDraft(definition(), true)).toBe(true);
    expect(requiresDraft(definition(), false)).toBe(false);
    expect(requiresDraft(definition({ draftCapable: false }), true)).toBe(
      false,
    );
  });
});

describe('entry states (Task 8 §7)', () => {
  it('accepts a declared entry state', () => {
    expect(planEntry(definition(), 'temporary')).toEqual({ problem: null });
  });

  it('rejects an undeclared entry state', () => {
    expect(planEntry(definition(), 'final')).toEqual({
      problem: 'invalid_entry_state',
    });
  });
});

describe('submit: draft → temporary/final (Task 8 §7/§8)', () => {
  it('allows a draft to be submitted into a declared entry state', () => {
    expect(planSubmit(context('draft'), 'temporary')).toEqual({
      problem: null,
    });
  });

  it('forbids submitting a non-draft document', () => {
    expect(planSubmit(context('temporary'), 'temporary')).toEqual({
      problem: 'not_draft',
    });
    expect(planSubmit(context('final'), 'final')).toEqual({
      problem: 'not_draft',
    });
  });

  it('forbids submitting into an undeclared state', () => {
    expect(planSubmit(context('draft'), 'final')).toEqual({
      problem: 'invalid_entry_state',
    });
  });
});

describe('finalize: temporary → final (Task 8 §7)', () => {
  it('allows finalizing a temporary document', () => {
    expect(planFinalize(context('temporary'))).toEqual({ problem: null });
  });

  it('forbids finalizing a draft (submit first) or a final document', () => {
    expect(planFinalize(context('draft'))).toEqual({
      problem: 'not_temporary',
    });
    expect(planFinalize(context('final'))).toEqual({
      problem: 'already_final',
    });
  });
});

describe('reopen: final → temporary (Task 8 §9)', () => {
  it('allows reopening a final document', () => {
    expect(planReopen(context('final'))).toEqual({ problem: null });
  });

  it('forbids reopening a temporary or draft document', () => {
    expect(planReopen(context('temporary'))).toEqual({
      problem: 'already_temporary',
    });
    expect(planReopen(context('draft'))).toEqual({ problem: 'not_final' });
  });
});

describe('final protection (Task 8 §15)', () => {
  it('allows editing draft and temporary documents', () => {
    expect(planEdit(context('draft'))).toEqual({ problem: null });
    expect(planEdit(context('temporary'))).toEqual({ problem: null });
  });

  it('forbids editing a final document', () => {
    expect(planEdit(context('final'))).toEqual({ problem: 'final_protected' });
  });
});

describe('deletion policy (Task 8 §14)', () => {
  it('allows deletion only in the declared deletable phases', () => {
    expect(planDelete(context('draft'))).toEqual({ problem: null });
    expect(planDelete(context('temporary'))).toEqual({ problem: null });
  });

  it('forbids deleting a final document (final protection)', () => {
    expect(planDelete(context('final'))).toEqual({
      problem: 'final_protected',
    });
  });

  it('forbids deletion where the type declares it non-deletable', () => {
    const ctx = context('temporary', {
      definition: definition({ deletablePhases: ['draft'] }),
    });
    expect(planDelete(ctx)).toEqual({ problem: 'not_deletable' });
  });
});

describe('state/action authorization (Task 8 §9)', () => {
  it('allows create, view, print and export across the lifecycle', () => {
    expect(planDocumentAction('create', context(null))).toEqual({
      problem: null,
    });
    for (const phase of ['draft', 'temporary', 'final'] as const) {
      expect(planDocumentAction('view', context(phase))).toEqual({
        problem: null,
      });
      expect(planDocumentAction('print', context(phase))).toEqual({
        problem: null,
      });
      expect(planDocumentAction('export', context(phase))).toEqual({
        problem: null,
      });
    }
  });

  it('refuses view/print/export on a non-existent document', () => {
    expect(planDocumentAction('view', context(null))).toEqual({
      problem: 'document_does_not_exist',
    });
  });

  it('refuses assign_number on a final document (number is permanent)', () => {
    expect(planDocumentAction('assign_number', context('temporary'))).toEqual({
      problem: null,
    });
    expect(planDocumentAction('assign_number', context('final'))).toEqual({
      problem: 'final_protected',
    });
  });

  it('routes submit/finalize/reopen to the right transition plans', () => {
    expect(planDocumentAction('submit', context('draft'), 'temporary')).toEqual(
      {
        problem: null,
      },
    );
    expect(planDocumentAction('finalize', context('temporary'))).toEqual({
      problem: null,
    });
    expect(planDocumentAction('reopen', context('final'))).toEqual({
      problem: null,
    });
  });

  it('rejects unknown actions', () => {
    expect(planDocumentAction('approve' as never, context('draft'))).toEqual({
      problem: 'unknown_action',
    });
  });

  it('provides a message for every problem code', () => {
    for (const problem of [
      'unknown_action',
      'unknown_phase',
      'document_does_not_exist',
      'not_draft',
      'not_temporary',
      'not_final',
      'already_final',
      'already_temporary',
      'invalid_entry_state',
      'final_protected',
      'not_deletable',
      'draft_not_configured',
    ] as const) {
      expect(lifecycleProblemMessage(problem).length).toBeGreaterThan(0);
    }
  });
});
