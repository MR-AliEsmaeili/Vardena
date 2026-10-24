import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SIDEBAR_STATE,
  parseSidebarState,
  persistSidebarState,
  readSidebarState,
  SIDEBAR_STORAGE_KEY,
} from './sidebar-state';

/**
 * Sidebar persistence is the only durable memory of the rail's shape.
 *
 * These tests pin the two things a stored preference must never do: crash the
 * shell on a malformed value, and silently turn a hand-edited/corrupt entry
 * into an unexpected expanded 16rem rail. Anything unreadable degrades to the
 * documented default (expanded, every group open).
 */

beforeEach(() => {
  localStorage.clear();
});

describe('parseSidebarState', () => {
  it('returns the documented default for an absent preference', () => {
    expect(parseSidebarState(null)).toEqual(DEFAULT_SIDEBAR_STATE);
    expect(DEFAULT_SIDEBAR_STATE).toEqual({
      collapsed: false,
      collapsedGroups: [],
    });
  });

  it('keeps a valid stored shape', () => {
    expect(
      parseSidebarState(
        JSON.stringify({ collapsed: true, collapsedGroups: ['accounting'] }),
      ),
    ).toEqual({ collapsed: true, collapsedGroups: ['accounting'] });
  });

  it('degrades on malformed JSON instead of throwing', () => {
    expect(parseSidebarState('{not json')).toEqual(DEFAULT_SIDEBAR_STATE);
  });

  it('ignores a non-boolean collapsed flag and non-string group ids', () => {
    expect(
      parseSidebarState(
        JSON.stringify({
          collapsed: 'yes',
          collapsedGroups: ['accounting', 7, null, { id: 'inventory' }],
        }),
      ),
    ).toEqual({ collapsed: false, collapsedGroups: ['accounting'] });
  });

  it('ignores a non-array group list', () => {
    expect(
      parseSidebarState(
        JSON.stringify({ collapsed: true, collapsedGroups: 'a' }),
      ),
    ).toEqual({ collapsed: true, collapsedGroups: [] });
  });
});

describe('read/persist round-trip', () => {
  it('reads what it wrote under the versioned key', () => {
    persistSidebarState({ collapsed: true, collapsedGroups: ['inventory'] });

    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe(
      JSON.stringify({ collapsed: true, collapsedGroups: ['inventory'] }),
    );
    expect(readSidebarState()).toEqual({
      collapsed: true,
      collapsedGroups: ['inventory'],
    });
  });

  it('falls back to the default when nothing is stored', () => {
    expect(readSidebarState()).toEqual(DEFAULT_SIDEBAR_STATE);
  });

  it('does not throw when storage rejects the write (private mode/quota)', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    expect(() =>
      persistSidebarState({ collapsed: true, collapsedGroups: [] }),
    ).not.toThrow();

    setItem.mockRestore();
  });

  it('does not throw when storage rejects the read', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    expect(readSidebarState()).toEqual(DEFAULT_SIDEBAR_STATE);

    getItem.mockRestore();
  });
});
