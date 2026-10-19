import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginRequest,
  endRequest,
  getRequestActivitySnapshot,
  resetRequestActivityForTests,
  subscribeToRequestActivity,
} from './request-activity';

/**
 * Unit coverage of the loading registry itself: token lifecycle, concurrency,
 * idempotent finalization and the mixed-message fallback. The Axios wiring is
 * covered separately in `client.test.ts`; nothing here issues a request.
 */

beforeEach(() => {
  resetRequestActivityForTests();
});

describe('request activity registry', () => {
  it('starts empty', () => {
    expect(getRequestActivitySnapshot()).toEqual({
      total: 0,
      global: 0,
      background: 0,
      globalMessage: null,
    });
  });

  it('counts a global request until its own token ends', () => {
    const token = beginRequest({ scope: 'global', message: 'saving' });

    expect(getRequestActivitySnapshot()).toEqual({
      total: 1,
      global: 1,
      background: 0,
      globalMessage: 'saving',
    });

    endRequest(token);

    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('ignores a second finalization of the same token', () => {
    const token = beginRequest({ scope: 'global', message: 'saving' });
    const other = beginRequest({ scope: 'global', message: 'saving' });

    endRequest(token);
    endRequest(token);

    expect(getRequestActivitySnapshot().total).toBe(1);
    expect(getRequestActivitySnapshot().global).toBe(1);

    endRequest(other);
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('ignores unknown and undefined tokens', () => {
    beginRequest({ scope: 'global', message: 'saving' });

    endRequest(undefined);
    endRequest(9_999);

    expect(getRequestActivitySnapshot().global).toBe(1);
  });

  it('keeps concurrent requests independent', () => {
    const first = beginRequest({ scope: 'global', message: 'saving' });
    const second = beginRequest({ scope: 'global', message: 'saving' });
    const third = beginRequest({ scope: 'background', message: 'receiving' });

    expect(getRequestActivitySnapshot()).toMatchObject({
      total: 3,
      global: 2,
      background: 1,
    });

    endRequest(first);
    expect(getRequestActivitySnapshot()).toMatchObject({
      total: 2,
      global: 1,
      background: 1,
    });

    endRequest(second);
    endRequest(third);
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('reports the shared message only while every global request agrees', () => {
    const saving = beginRequest({ scope: 'global', message: 'saving' });
    const savingTwo = beginRequest({ scope: 'global', message: 'saving' });
    expect(getRequestActivitySnapshot().globalMessage).toBe('saving');

    const deleting = beginRequest({ scope: 'global', message: 'deleting' });
    expect(getRequestActivitySnapshot().globalMessage).toBeNull();

    endRequest(deleting);
    expect(getRequestActivitySnapshot().globalMessage).toBe('saving');

    endRequest(saving);
    endRequest(savingTwo);
    expect(getRequestActivitySnapshot().globalMessage).toBeNull();
  });

  it('does not let a background request change the global message', () => {
    beginRequest({ scope: 'global', message: 'saving' });
    beginRequest({ scope: 'background', message: 'receiving' });

    expect(getRequestActivitySnapshot().globalMessage).toBe('saving');
    expect(getRequestActivitySnapshot().background).toBe(1);
  });

  it('notifies subscribers on begin and end and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRequestActivity(listener);

    const token = beginRequest({ scope: 'global', message: 'saving' });
    expect(listener).toHaveBeenCalledTimes(1);

    endRequest(token);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    beginRequest({ scope: 'global', message: 'saving' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('returns a stable snapshot object until the registry changes', () => {
    const before = getRequestActivitySnapshot();
    expect(getRequestActivitySnapshot()).toBe(before);

    const token = beginRequest({ scope: 'background', message: 'receiving' });
    const after = getRequestActivitySnapshot();
    expect(after).not.toBe(before);

    const same = getRequestActivitySnapshot();
    expect(same).toBe(after);

    endRequest(token);
    expect(getRequestActivitySnapshot()).toBe(before);
  });
});
