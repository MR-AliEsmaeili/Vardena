import { describe, expect, it } from 'vitest';
import {
  effectiveApprovalPermission,
  isTransitionPermitted,
  isValidTransitionPermission,
  planTransitionExecution,
  planWorkflowTransition,
  type TransitionExecutionFacts,
} from './workflow-transition.js';

/**
 * Transition shape validation, the execution decision table and the
 * authorization-decision helper (Task 9 §8/§9/§17/§28).
 *
 * Permissions use the EXISTING `Module.Entity.Action` registry shape — the
 * module defines no authorization vocabulary of its own. The execution plan
 * orders its checks (version → state → permission → conditions) so a stale
 * caller learns "moved on" rather than "denied".
 */
describe('transition permission codes', () => {
  it('accepts well-formed RBAC codes', () => {
    expect(isValidTransitionPermission('Inventory.Receipt.Approve')).toBe(true);
    expect(isValidTransitionPermission('Workflow.Instance.Execute')).toBe(true);
  });

  it('rejects wildcards, short codes and over-long codes', () => {
    expect(isValidTransitionPermission('Inventory.Receipt.*')).toBe(false);
    expect(isValidTransitionPermission('Inventory.Approve')).toBe(false);
    expect(isValidTransitionPermission('inventory.receipt.approve')).toBe(
      false,
    );
    expect(isValidTransitionPermission('')).toBe(false);
    expect(isValidTransitionPermission(`A.B.${'x'.repeat(160)}`)).toBe(false);
  });
});

describe('transition shape validation', () => {
  const valid = {
    code: 'submit_for_approval',
    name: 'Submit for approval',
    description: null,
    sortOrder: 0,
    sourceStateId: 'state-a',
    targetStateId: 'state-b',
    requiredPermission: 'Inventory.Receipt.Submit',
    approvalPermission: null,
  };

  it('accepts a valid transition', () => {
    expect(planWorkflowTransition(valid)).toEqual({ problem: null });
  });

  it('rejects malformed codes and blank names', () => {
    expect(planWorkflowTransition({ ...valid, code: 'Submit!' }).problem).toBe(
      'invalid_code',
    );
    expect(planWorkflowTransition({ ...valid, name: '  ' }).problem).toBe(
      'blank_name',
    );
  });

  it('rejects malformed permission codes', () => {
    expect(
      planWorkflowTransition({ ...valid, requiredPermission: 'nope' }).problem,
    ).toBe('invalid_required_permission');
    expect(
      planWorkflowTransition({ ...valid, approvalPermission: 'nope' }).problem,
    ).toBe('invalid_approval_permission');
  });

  it('rejects self-transitions', () => {
    expect(
      planWorkflowTransition({ ...valid, targetStateId: 'state-a' }).problem,
    ).toBe('self_transition');
  });

  it('rejects out-of-range sort orders', () => {
    expect(planWorkflowTransition({ ...valid, sortOrder: -1 }).problem).toBe(
      'invalid_sort_order',
    );
  });
});

describe('effective approval permission', () => {
  it('defaults to the transition permission when none is configured', () => {
    expect(
      effectiveApprovalPermission({
        requiredPermission: 'Inventory.Receipt.Submit',
        approvalPermission: null,
      }),
    ).toBe('Inventory.Receipt.Submit');
  });

  it('prefers the explicit approval permission', () => {
    expect(
      effectiveApprovalPermission({
        requiredPermission: 'Inventory.Receipt.Submit',
        approvalPermission: 'Inventory.Receipt.Approve',
      }),
    ).toBe('Inventory.Receipt.Approve');
  });
});

describe('transition authorization decisions', () => {
  const transition = { requiredPermission: 'Inventory.Receipt.Submit' };

  it('permits a caller holding the required code', () => {
    expect(
      isTransitionPermitted(
        transition,
        new Set(['Inventory.Receipt.Submit', 'Workflow.Instance.Execute']),
      ),
    ).toBe(true);
  });

  it('denies a caller without the required code — no wildcard, no bypass', () => {
    expect(
      isTransitionPermitted(transition, new Set(['Workflow.Instance.Execute'])),
    ).toBe(false);
    expect(isTransitionPermitted(transition, new Set(['*']))).toBe(false);
    expect(isTransitionPermitted(transition, new Set())).toBe(false);
  });
});

describe('execution decision table', () => {
  const proceeding: TransitionExecutionFacts = {
    versionMatches: true,
    sourceIsCurrent: true,
    transitionEnabled: true,
    statesEnabled: true,
    sourceIsTerminal: false,
    actorPermitted: true,
    commentSatisfied: true,
    actorDiffersSatisfied: true,
    approvalSatisfied: true,
  };

  it('proceeds when every check holds', () => {
    expect(planTransitionExecution(proceeding)).toEqual({ problem: null });
  });

  it.each([
    ['versionMatches', 'version_mismatch'],
    ['sourceIsCurrent', 'not_in_source_state'],
    ['transitionEnabled', 'transition_disabled'],
    ['statesEnabled', 'state_disabled'],
    ['actorPermitted', 'permission_denied'],
    ['commentSatisfied', 'comment_required'],
    ['actorDiffersSatisfied', 'same_actor'],
    ['approvalSatisfied', 'approval_required'],
  ] as const)('reports %s as %s', (fact, problem) => {
    expect(planTransitionExecution({ ...proceeding, [fact]: false })).toEqual({
      problem,
    });
  });

  it('reports a terminal source as terminal', () => {
    expect(
      planTransitionExecution({ ...proceeding, sourceIsTerminal: true }),
    ).toEqual({ problem: 'terminal_state' });
  });

  it('orders version before state, state before permission, permission before conditions', () => {
    // A cross-version call is a client bug, not a race: version wins.
    expect(
      planTransitionExecution({
        ...proceeding,
        versionMatches: false,
        sourceIsCurrent: false,
        actorPermitted: false,
      }),
    ).toEqual({ problem: 'version_mismatch' });
    // A stale caller learns "moved on", not "denied": state wins.
    expect(
      planTransitionExecution({
        ...proceeding,
        sourceIsCurrent: false,
        actorPermitted: false,
      }),
    ).toEqual({ problem: 'not_in_source_state' });
    // Permission wins over conditions: no condition probing without access.
    expect(
      planTransitionExecution({
        ...proceeding,
        actorPermitted: false,
        commentSatisfied: false,
      }),
    ).toEqual({ problem: 'permission_denied' });
  });
});
