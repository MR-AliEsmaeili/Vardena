import { describe, expect, it } from 'vitest';
import {
  isApprovalConsumable,
  isApprovalDecidable,
  isApprovalStale,
  isWorkflowApprovalDecision,
  isWorkflowApprovalStatus,
  planApprovalComment,
} from './workflow-approval.js';

/**
 * Single-level approval semantics (Task 9 §16).
 *
 * Approvals are recorded evidence with a staleness rule: `baseSequence`
 * pins the request to the history length it was requested in, so an
 * approval can never authorize a state it was not requested in. Multi-level
 * chains, delegation and escalation are out of v1 scope (OQ-26).
 */
describe('approval vocabulary', () => {
  it('accepts the closed status list', () => {
    expect(isWorkflowApprovalStatus('pending')).toBe(true);
    expect(isWorkflowApprovalStatus('approved')).toBe(true);
    expect(isWorkflowApprovalStatus('rejected')).toBe(true);
    expect(isWorkflowApprovalStatus('escalated')).toBe(false);
    expect(isWorkflowApprovalStatus('delegated')).toBe(false);
  });

  it('accepts approve/reject decisions only', () => {
    expect(isWorkflowApprovalDecision('approved')).toBe(true);
    expect(isWorkflowApprovalDecision('rejected')).toBe(true);
    expect(isWorkflowApprovalDecision('pending')).toBe(false);
    expect(isWorkflowApprovalDecision('abstain')).toBe(false);
  });

  it('is decidable only while pending', () => {
    expect(isApprovalDecidable('pending')).toBe(true);
    expect(isApprovalDecidable('approved')).toBe(false);
    expect(isApprovalDecidable('rejected')).toBe(false);
  });
});

describe('approval staleness', () => {
  const approval = { baseSequence: 2 };

  it('is fresh when no transition landed since the request', () => {
    expect(isApprovalStale(approval, 2)).toBe(false);
  });

  it('is stale once any transition landed since the request', () => {
    expect(isApprovalStale(approval, 3)).toBe(true);
    expect(isApprovalStale(approval, 9)).toBe(true);
  });
});

describe('approval consumption', () => {
  const approved = {
    instanceId: 'instance-1',
    transitionId: 'transition-1',
    status: 'approved' as const,
    baseSequence: 2,
  };
  const context = {
    instanceId: 'instance-1',
    transitionId: 'transition-1',
    currentHistoryLength: 2,
  };

  it('consumes a fresh approval for the same (instance, transition)', () => {
    expect(isApprovalConsumable(approved, context)).toBe(true);
  });

  it('refuses pending and rejected approvals', () => {
    expect(
      isApprovalConsumable({ ...approved, status: 'pending' }, context),
    ).toBe(false);
    expect(
      isApprovalConsumable({ ...approved, status: 'rejected' }, context),
    ).toBe(false);
  });

  it('refuses approvals for another instance or transition', () => {
    expect(
      isApprovalConsumable({ ...approved, instanceId: 'instance-2' }, context),
    ).toBe(false);
    expect(
      isApprovalConsumable(
        { ...approved, transitionId: 'transition-2' },
        context,
      ),
    ).toBe(false);
  });

  it('refuses decided-then-stale approvals: status is evidence, freshness is the authorization', () => {
    expect(
      isApprovalConsumable(approved, { ...context, currentHistoryLength: 3 }),
    ).toBe(false);
  });
});

describe('approval comments', () => {
  it('accepts absent and bounded comments', () => {
    expect(planApprovalComment(null)).toEqual({ problem: null });
    expect(planApprovalComment('  Looks good.  ')).toEqual({ problem: null });
  });

  it('rejects over-long comments', () => {
    expect(planApprovalComment('x'.repeat(2001))).toEqual({
      problem: 'comment_too_long',
    });
  });
});
