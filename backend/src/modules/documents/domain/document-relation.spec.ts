import { describe, expect, it } from 'vitest';
import { generateId } from '../../../kernel/ids/ulid.js';
import {
  isQuantityAwareKind,
  isRelationKind,
  planRelation,
  QUANTITY_AWARE_KINDS,
  RELATION_KINDS,
  relationProblemMessage,
  type DocumentEndpoint,
} from './document-relation.js';

function endpoint(overrides: Partial<DocumentEndpoint> = {}): DocumentEndpoint {
  return {
    module: 'sales',
    documentType: 'sales_invoice',
    documentId: generateId(),
    ...overrides,
  };
}

describe('relation kinds (closed list, ADR-0019 §5.1)', () => {
  it('is exactly the six agreed kinds', () => {
    expect([...RELATION_KINDS].sort()).toEqual(
      [
        'derive',
        'fulfill',
        'reference',
        'reverse',
        'settle',
        'transfer_of',
      ].sort(),
    );
  });

  it('rejects free-text kinds', () => {
    expect(isRelationKind('reference')).toBe(true);
    expect(isRelationKind('related_to')).toBe(false);
    expect(isRelationKind('parent_of')).toBe(false);
  });

  it('marks only fulfill as quantity-aware', () => {
    expect([...QUANTITY_AWARE_KINDS]).toEqual(['fulfill']);
    expect(isQuantityAwareKind('fulfill')).toBe(true);
    expect(isQuantityAwareKind('reference')).toBe(false);
  });
});

describe('relation validation', () => {
  it('accepts a valid document-level reference link', () => {
    expect(
      planRelation({
        kind: 'reference',
        source: endpoint(),
        target: endpoint(),
      }),
    ).toEqual({ problem: null });
  });

  it('accepts line-level links (partial fulfilment support)', () => {
    expect(
      planRelation({
        kind: 'derive',
        source: endpoint({ lineId: generateId() }),
        target: endpoint({ lineId: generateId() }),
      }),
    ).toEqual({ problem: null });
  });

  it('requires a positive quantity for fulfill', () => {
    expect(
      planRelation({
        kind: 'fulfill',
        source: endpoint(),
        target: endpoint(),
        quantity: '12.5',
      }),
    ).toEqual({ problem: null });
    expect(
      planRelation({ kind: 'fulfill', source: endpoint(), target: endpoint() }),
    ).toEqual({ problem: 'quantity_required' });
    expect(
      planRelation({
        kind: 'fulfill',
        source: endpoint(),
        target: endpoint(),
        quantity: '0',
      }),
    ).toEqual({ problem: 'invalid_quantity' });
    expect(
      planRelation({
        kind: 'fulfill',
        source: endpoint(),
        target: endpoint(),
        quantity: '1.23456',
      }),
    ).toEqual({ problem: 'invalid_quantity' });
  });

  it('forbids a quantity on non-quantity kinds', () => {
    expect(
      planRelation({
        kind: 'reference',
        source: endpoint(),
        target: endpoint(),
        quantity: '5',
      }),
    ).toEqual({ problem: 'quantity_forbidden' });
  });

  it('rejects a self-referencing link', () => {
    const same = endpoint();
    expect(
      planRelation({ kind: 'reference', source: same, target: same }),
    ).toEqual({ problem: 'self_reference' });
  });

  it('rejects malformed endpoints', () => {
    expect(
      planRelation({
        kind: 'reference',
        source: endpoint({ module: 'Bad Module' }),
        target: endpoint(),
      }),
    ).toEqual({ problem: 'invalid_endpoint' });
    expect(
      planRelation({
        kind: 'reference',
        source: endpoint({ documentId: 'not-a-ulid' }),
        target: endpoint(),
      }),
    ).toEqual({ problem: 'invalid_endpoint' });
  });

  it('provides a message for every problem code', () => {
    for (const problem of [
      'invalid_kind',
      'invalid_endpoint',
      'self_reference',
      'quantity_required',
      'quantity_forbidden',
      'invalid_quantity',
    ] as const) {
      expect(relationProblemMessage(problem).length).toBeGreaterThan(0);
    }
  });
});
