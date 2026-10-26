/**
 * WindowScrollMemory — §6.5 per-window scroll save/restore semantics.
 */

import { describe, expect, it } from 'vitest';
import { WindowScrollMemory } from './workspace-scroll';

function fakeElement(initial = 0) {
  return { scrollTop: initial };
}

describe('WindowScrollMemory', () => {
  it('restores exactly what was saved for each window', () => {
    const el = fakeElement();
    const memory = new WindowScrollMemory(() => el);
    el.scrollTop = 240;
    memory.save('a');
    el.scrollTop = 0; // the switch scrolled the document away
    memory.restore('a');
    expect(el.scrollTop).toBe(240);
  });

  it('keeps positions per window id', () => {
    const el = fakeElement();
    const memory = new WindowScrollMemory(() => el);
    el.scrollTop = 100;
    memory.save('a');
    el.scrollTop = 500;
    memory.save('b');
    el.scrollTop = 0;
    memory.restore('b');
    expect(el.scrollTop).toBe(500);
    memory.restore('a');
    expect(el.scrollTop).toBe(100);
  });

  it('restore is a no-op for a window that was never scrolled (restored descriptor)', () => {
    const el = fakeElement(321);
    const memory = new WindowScrollMemory(() => el);
    memory.restore('never-saved');
    expect(el.scrollTop).toBe(321); // untouched
  });

  it('forget drops a closed window entry', () => {
    const el = fakeElement();
    const memory = new WindowScrollMemory(() => el);
    el.scrollTop = 90;
    memory.save('a');
    memory.forget('a');
    el.scrollTop = 0;
    memory.restore('a');
    expect(el.scrollTop).toBe(0);
  });

  it('clear drops every entry (scope reset, W-06)', () => {
    const el = fakeElement();
    const memory = new WindowScrollMemory(() => el);
    el.scrollTop = 10;
    memory.save('a');
    el.scrollTop = 20;
    memory.save('b');
    memory.clear();
    el.scrollTop = 0;
    memory.restore('a');
    memory.restore('b');
    expect(el.scrollTop).toBe(0);
  });

  it('tolerates a missing scrolling element (SSR/detached document)', () => {
    const memory = new WindowScrollMemory(() => null);
    expect(() => {
      memory.save('a');
      memory.restore('a');
    }).not.toThrow();
  });
});
