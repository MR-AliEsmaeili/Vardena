import { describe, expect, it } from 'vitest';
import { generateId } from '../../../kernel/ids/ulid.js';
import { planEntityReference } from './workflow-instance.js';
import { planWorkflowDefinition } from './workflow-definition.js';
import { planWorkflowState } from './workflow-state.js';

/**
 * Definition, state and entity-reference shape validation (Task 9 §5/§7/§11).
 *
 * Codes are stable snake_case (history and bindings resolve them); the
 * bound entity is a logical (module + type + ULID) reference that Workflow
 * stores but never dereferences (AR-07/08).
 */
describe('definition shape validation', () => {
  it('accepts a valid definition', () => {
    expect(
      planWorkflowDefinition({
        code: 'inventory_receipt',
        name: 'Inventory receipt',
        description: null,
      }),
    ).toEqual({ problem: null });
  });

  it('rejects malformed codes and blank or over-long names', () => {
    expect(
      planWorkflowDefinition({
        code: 'Inventory Receipt!',
        name: 'Inventory receipt',
        description: null,
      }).problem,
    ).toBe('invalid_code');
    expect(
      planWorkflowDefinition({
        code: 'inventory_receipt',
        name: '   ',
        description: null,
      }).problem,
    ).toBe('blank_name');
    expect(
      planWorkflowDefinition({
        code: 'inventory_receipt',
        name: 'x'.repeat(201),
        description: null,
      }).problem,
    ).toBe('name_too_long');
    expect(
      planWorkflowDefinition({
        code: 'inventory_receipt',
        name: 'Inventory receipt',
        description: 'x'.repeat(2001),
      }).problem,
    ).toBe('description_too_long');
  });
});

describe('state shape validation', () => {
  const valid = {
    code: 'pending_approval',
    name: 'Pending approval',
    description: null,
    sortOrder: 0,
  };

  it('accepts a valid state', () => {
    expect(planWorkflowState(valid)).toEqual({ problem: null });
  });

  it('rejects malformed codes, blank names and bad sort orders', () => {
    expect(planWorkflowState({ ...valid, code: 'Pending!' }).problem).toBe(
      'invalid_code',
    );
    expect(planWorkflowState({ ...valid, name: '' }).problem).toBe(
      'blank_name',
    );
    expect(planWorkflowState({ ...valid, sortOrder: 1_000_001 }).problem).toBe(
      'invalid_sort_order',
    );
  });
});

describe('entity reference validation', () => {
  const entityId = generateId();

  it('accepts a well-formed logical reference', () => {
    expect(
      planEntityReference({
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId,
      }),
    ).toEqual({ problem: null });
  });

  it('rejects malformed modules, types and non-ULID ids', () => {
    expect(
      planEntityReference({
        entityModule: 'Inventory!',
        entityType: 'inventory_receipt',
        entityId,
      }).problem,
    ).toBe('invalid_module');
    expect(
      planEntityReference({
        entityModule: 'inventory',
        entityType: 'Inventory Receipt',
        entityId,
      }).problem,
    ).toBe('invalid_entity_type');
    expect(
      planEntityReference({
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: 'not-a-ulid',
      }).problem,
    ).toBe('invalid_entity_id');
  });
});
