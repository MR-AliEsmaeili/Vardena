import { describe, expect, it } from 'vitest';
import { JobsRegistry } from './jobs.registry.js';

describe('JobsRegistry', () => {
  it('registers, resolves, and lists handlers', async () => {
    const registry = new JobsRegistry();
    const handler = async (payload: { n: number }) => {
      expect(payload.n).toBe(1);
    };
    registry.register('demo.job', handler, { description: 'demo' });

    expect(registry.has('demo.job')).toBe(true);
    expect(registry.has('missing')).toBe(false);
    expect(registry.list()).toEqual([
      { name: 'demo.job', description: 'demo' },
    ]);
    await registry.get('demo.job')({ n: 1 }, { correlationId: 'c1' });
  });

  it('rejects duplicates, blank names, and unknown lookups', () => {
    const registry = new JobsRegistry();
    const handler = async () => {};
    registry.register('demo.job', handler);
    expect(() => registry.register('demo.job', handler)).toThrow(
      /already registered/,
    );
    expect(() => registry.register('   ', handler)).toThrow(/non-empty/);
    expect(() => registry.get('missing')).toThrow(/No job handler/);
  });
});
