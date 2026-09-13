import { describe, expect, it } from 'vitest';
import {
  isVersionBindable,
  isVersionEditable,
  isWorkflowVersionStatus,
  planPublish,
} from './workflow-version.js';

/**
 * Version lifecycle + publish validation (Task 9 §6/§14/§15/§23).
 *
 * The lifecycle is one-way (`draft → active → superseded`): only drafts are
 * editable, only active versions bind. Publishing is deterministic — exactly
 * one enabled initial state, no outgoing edge from a terminal state, every
 * transition inside the version.
 */
describe('workflow version lifecycle', () => {
  it('accepts only the closed status list', () => {
    expect(isWorkflowVersionStatus('draft')).toBe(true);
    expect(isWorkflowVersionStatus('active')).toBe(true);
    expect(isWorkflowVersionStatus('superseded')).toBe(true);
    expect(isWorkflowVersionStatus('published')).toBe(false);
    expect(isWorkflowVersionStatus('archived')).toBe(false);
    expect(isWorkflowVersionStatus('')).toBe(false);
  });

  it('is editable only while a draft', () => {
    expect(isVersionEditable('draft')).toBe(true);
    expect(isVersionEditable('active')).toBe(false);
    expect(isVersionEditable('superseded')).toBe(false);
  });

  it('is bindable only while active', () => {
    expect(isVersionBindable('draft')).toBe(false);
    expect(isVersionBindable('active')).toBe(true);
    expect(isVersionBindable('superseded')).toBe(false);
  });
});

describe('publish validation', () => {
  const open = {
    id: 'state-open',
    code: 'open',
    isInitial: true,
    isTerminal: false,
    isActive: true,
  };
  const closed = {
    id: 'state-closed',
    code: 'closed',
    isInitial: false,
    isTerminal: true,
    isActive: true,
  };
  const close = {
    id: 'transition-close',
    code: 'close',
    sourceStateId: 'state-open',
    targetStateId: 'state-closed',
    isActive: true,
  };

  it('accepts a minimal valid version', () => {
    expect(
      planPublish({ states: [open, closed], transitions: [close] }),
    ).toEqual({ problem: null });
  });

  it('accepts the degenerate immediately-complete version (initial + terminal, no edges)', () => {
    const done = { ...open, isTerminal: true };
    expect(planPublish({ states: [done], transitions: [] })).toEqual({
      problem: null,
    });
  });

  it('rejects a version without states', () => {
    expect(planPublish({ states: [], transitions: [] }).problem).toBe(
      'no_states',
    );
  });

  it('rejects a version without an initial state', () => {
    const noInitial = { ...open, isInitial: false };
    expect(
      planPublish({ states: [noInitial, closed], transitions: [] }).problem,
    ).toBe('missing_initial_state');
  });

  it('rejects multiple initial states', () => {
    const second = { ...closed, isInitial: true };
    expect(
      planPublish({ states: [open, second], transitions: [] }).problem,
    ).toBe('multiple_initial_states');
  });

  it('rejects a disabled initial state', () => {
    const disabled = { ...open, isActive: false };
    expect(
      planPublish({ states: [disabled, closed], transitions: [] }).problem,
    ).toBe('initial_state_disabled');
  });

  it('rejects a transition referencing a state outside the version', () => {
    const stray = { ...close, targetStateId: 'state-elsewhere' };
    expect(
      planPublish({ states: [open, closed], transitions: [stray] }),
    ).toEqual({ problem: 'unknown_transition_state', subject: 'close' });
  });

  it('rejects outgoing transitions from a terminal state', () => {
    const reopen = {
      id: 'transition-reopen',
      code: 'reopen',
      sourceStateId: 'state-closed',
      targetStateId: 'state-open',
      isActive: true,
    };
    expect(
      planPublish({ states: [open, closed], transitions: [close, reopen] }),
    ).toEqual({
      problem: 'terminal_state_has_outgoing_transition',
      subject: 'reopen',
    });
  });

  it('rejects self-transitions', () => {
    const loop = { ...close, targetStateId: 'state-open' };
    expect(
      planPublish({ states: [open, closed], transitions: [loop] }),
    ).toEqual({ problem: 'self_transition', subject: 'close' });
  });

  it('ignores disabled transitions', () => {
    const disabledReopen = {
      id: 'transition-reopen',
      code: 'reopen',
      sourceStateId: 'state-closed',
      targetStateId: 'state-open',
      isActive: false,
    };
    expect(
      planPublish({
        states: [open, closed],
        transitions: [close, disabledReopen],
      }),
    ).toEqual({ problem: null });
  });
});
