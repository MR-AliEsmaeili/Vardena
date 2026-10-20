import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginRequest,
  endRequest,
  getRequestActivitySnapshot,
  resetRequestActivityForTests,
  subscribeToRequestActivity,
} from './request-activity';

afterEach(() => {
  resetRequestActivityForTests();
});

describe('request-activity registry', () => {
  it('starts empty', () => {
    const snap = getRequestActivitySnapshot();
    expect(snap.total).toBe(0);
    expect(snap.global).toBe(0);
    expect(snap.background).toBe(0);
    expect(snap.globalMessage).toBeNull();
  });

  it('tracks a single global request', () => {
    const token = beginRequest({ scope: 'global', message: 'saving' });
    const snap = getRequestActivitySnapshot();
    expect(snap.total).toBe(1);
    expect(snap.global).toBe(1);
    expect(snap.globalMessage).toBe('saving');
    endRequest(token);
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('tracks concurrent background and global', () => {
    const t1 = beginRequest({ scope: 'background', message: 'receiving' });
    const t2 = beginRequest({ scope: 'global', message: 'processing' });
    const snap = getRequestActivitySnapshot();
    expect(snap.total).toBe(2);
    expect(snap.background).toBe(1);
    expect(snap.global).toBe(1);
    endRequest(t1);
    endRequest(t2);
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('endRequest is idempotent for known, unknown and undefined tokens', () => {
    const token = beginRequest({ scope: 'global', message: 'deleting' });
    endRequest(token);
    endRequest(token);
    endRequest(undefined);
    endRequest(999_999);
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('notifies subscribers on change and cleans up on unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRequestActivity(listener);
    beginRequest({ scope: 'background', message: 'receiving' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    beginRequest({ scope: 'global', message: 'saving' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('falls back to null globalMessage when messages disagree', () => {
    beginRequest({ scope: 'global', message: 'saving' });
    beginRequest({ scope: 'global', message: 'deleting' });
    expect(getRequestActivitySnapshot().globalMessage).toBeNull();
  });

  it('keeps a single agreed globalMessage when concurrent globals match', () => {
    beginRequest({ scope: 'global', message: 'updating' });
    beginRequest({ scope: 'global', message: 'updating' });
    expect(getRequestActivitySnapshot().globalMessage).toBe('updating');
    expect(getRequestActivitySnapshot().global).toBe(2);
  });

  it('snapshot identity is stable when nothing changes', () => {
    const a = getRequestActivitySnapshot();
    const b = getRequestActivitySnapshot();
    expect(a).toBe(b);
  });
});

it('ending the same token twice cannot end another concurrent request', () => {
  const first = beginRequest({ scope: 'global', message: 'saving' });
  const second = beginRequest({ scope: 'global', message: 'saving' });
  endRequest(first);
  const snapshot = getRequestActivitySnapshot();
  endRequest(first);
  expect(getRequestActivitySnapshot()).toBe(snapshot);
  expect(snapshot.total).toBe(1);
  endRequest(second);
  expect(getRequestActivitySnapshot().total).toBe(0);
});
