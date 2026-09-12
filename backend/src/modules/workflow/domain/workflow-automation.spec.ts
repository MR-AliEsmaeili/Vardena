import { describe, expect, it } from 'vitest';
import {
  isValidAutomationParameters,
  normalizeAutomationParameters,
  planWorkflowAutomation,
} from './workflow-automation.js';

/**
 * Automation binding envelope (Task 9 §18).
 *
 * Bindings reference the code-defined action catalogue — no user scripts,
 * no stored code. Parameters are a FLAT JSON object with bounded keys and
 * primitive values: enough for "recipients + template" style bindings, too
 * small to smuggle a program. Nested structures are rejected.
 */
describe('automation parameter envelope', () => {
  it('accepts absent parameters', () => {
    expect(isValidAutomationParameters(null)).toBe(true);
    expect(isValidAutomationParameters(undefined)).toBe(true);
  });

  it('accepts flat primitive objects', () => {
    expect(
      isValidAutomationParameters({
        template: 'invoice_posted',
        channel: 'in_app',
        retries: 3,
        urgent: false,
        note: null,
      }),
    ).toBe(true);
  });

  it('rejects nested objects, arrays and non-objects', () => {
    expect(isValidAutomationParameters({ nested: { deep: true } })).toBe(false);
    expect(isValidAutomationParameters({ list: [1, 2] })).toBe(false);
    expect(isValidAutomationParameters([['nope']])).toBe(false);
    expect(isValidAutomationParameters('nope')).toBe(false);
    expect(isValidAutomationParameters(42)).toBe(false);
  });

  it('rejects malformed keys, over-long strings and oversized envelopes', () => {
    expect(isValidAutomationParameters({ 'has space': 'x' })).toBe(false);
    expect(isValidAutomationParameters({ '9starts': 'x' })).toBe(false);
    expect(isValidAutomationParameters({ ok: 'x'.repeat(501) })).toBe(false);
    const many = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`k${index}`, index]),
    );
    expect(isValidAutomationParameters(many)).toBe(false);
  });

  it('rejects non-finite numbers and undefined values', () => {
    expect(isValidAutomationParameters({ n: Number.NaN })).toBe(false);
    expect(isValidAutomationParameters({ n: Number.POSITIVE_INFINITY })).toBe(
      false,
    );
    expect(isValidAutomationParameters({ n: undefined })).toBe(false);
  });
});

describe('automation binding shape', () => {
  it('accepts a valid binding', () => {
    expect(
      planWorkflowAutomation({
        action: 'notify',
        parameters: { template: 'invoice_posted' },
        sortOrder: 0,
      }),
    ).toEqual({ problem: null });
  });

  it('rejects malformed actions and sort orders', () => {
    expect(
      planWorkflowAutomation({
        action: 'Not An Action!',
        parameters: null,
        sortOrder: 0,
      }).problem,
    ).toBe('invalid_action');
    expect(
      planWorkflowAutomation({
        action: 'notify',
        parameters: null,
        sortOrder: -1,
      }).problem,
    ).toBe('invalid_sort_order');
  });

  it('rejects invalid parameter envelopes', () => {
    expect(
      planWorkflowAutomation({
        action: 'notify',
        parameters: { nested: { deep: true } },
        sortOrder: 0,
      }).problem,
    ).toBe('invalid_parameters');
  });
});

describe('parameter normalization', () => {
  it('normalizes absent parameters to null and copies objects', () => {
    expect(normalizeAutomationParameters(null)).toBeNull();
    expect(normalizeAutomationParameters(undefined)).toBeNull();
    const input = { template: 'x' };
    const normalized = normalizeAutomationParameters(input);
    expect(normalized).toEqual(input);
    expect(normalized).not.toBe(input);
  });
});
