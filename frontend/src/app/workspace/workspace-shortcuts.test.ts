/**
 * workspace-shortcuts — the limited §4.8 dock handler. The decision function
 * is pure and fully branch-covered here; `attachWorkspaceShortcuts` gets one
 * DOM-level integration test (preventDefault + dispatch + detach).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachWorkspaceShortcuts,
  isTextEditingTarget,
  resolveWorkspaceShortcut,
  type WorkspaceShortcutContext,
} from './workspace-shortcuts';

const CONTEXT: WorkspaceShortcutContext = {
  windowCount: 3,
  hasActiveWindow: true,
  eventTarget: null,
};

function key(
  partial: Partial<
    Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
  >,
) {
  return {
    key: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe('resolveWorkspaceShortcut', () => {
  it('Alt+W closes the active window', () => {
    expect(
      resolveWorkspaceShortcut(key({ key: 'w', altKey: true }), CONTEXT),
    ).toEqual({
      type: 'closeActive',
    });
    expect(
      resolveWorkspaceShortcut(key({ key: 'W', altKey: true }), CONTEXT),
    ).toEqual({ type: 'closeActive' });
  });

  it('Alt+W is ignored while typing in a text-editing surface', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    for (const target of [input, textarea, editable]) {
      expect(
        resolveWorkspaceShortcut(key({ key: 'w', altKey: true }), {
          ...CONTEXT,
          eventTarget: target,
        }),
      ).toBeNull();
    }
    // A plain button still allows the shortcut.
    expect(
      resolveWorkspaceShortcut(key({ key: 'w', altKey: true }), {
        ...CONTEXT,
        eventTarget: document.createElement('button'),
      }),
    ).toEqual({ type: 'closeActive' });
  });

  it('Alt+W with no active window is a no-op', () => {
    expect(
      resolveWorkspaceShortcut(key({ key: 'w', altKey: true }), {
        ...CONTEXT,
        hasActiveWindow: false,
      }),
    ).toBeNull();
  });

  it('Alt+Shift+W is left alone (browser/OS territory)', () => {
    expect(
      resolveWorkspaceShortcut(
        key({ key: 'W', altKey: true, shiftKey: true }),
        CONTEXT,
      ),
    ).toBeNull();
  });

  it('RTL arrows: right = previous, left = next; single window = no-op', () => {
    expect(
      resolveWorkspaceShortcut(
        key({ key: 'ArrowRight', altKey: true }),
        CONTEXT,
      ),
    ).toEqual({ type: 'activateOffset', offset: -1 });
    expect(
      resolveWorkspaceShortcut(
        key({ key: 'ArrowLeft', altKey: true }),
        CONTEXT,
      ),
    ).toEqual({ type: 'activateOffset', offset: 1 });
    const single = { ...CONTEXT, windowCount: 1 };
    expect(
      resolveWorkspaceShortcut(
        key({ key: 'ArrowRight', altKey: true }),
        single,
      ),
    ).toBeNull();
    expect(
      resolveWorkspaceShortcut(key({ key: 'ArrowLeft', altKey: true }), single),
    ).toBeNull();
  });

  it('Alt+1..9 jumps to window n; n > N is a no-op', () => {
    expect(
      resolveWorkspaceShortcut(key({ key: '1', altKey: true }), CONTEXT),
    ).toEqual({ type: 'activateIndex', index: 0 });
    expect(
      resolveWorkspaceShortcut(key({ key: '3', altKey: true }), CONTEXT),
    ).toEqual({ type: 'activateIndex', index: 2 });
    expect(
      resolveWorkspaceShortcut(key({ key: '4', altKey: true }), CONTEXT),
    ).toBeNull();
    expect(
      resolveWorkspaceShortcut(key({ key: '9', altKey: true }), CONTEXT),
    ).toBeNull();
    // 0 is not a window number.
    expect(
      resolveWorkspaceShortcut(key({ key: '0', altKey: true }), CONTEXT),
    ).toBeNull();
  });

  it('requires Alt and rejects Ctrl/Meta combinations', () => {
    expect(resolveWorkspaceShortcut(key({ key: 'w' }), CONTEXT)).toBeNull();
    expect(
      resolveWorkspaceShortcut(
        key({ key: 'w', altKey: true, ctrlKey: true }),
        CONTEXT,
      ),
    ).toBeNull();
    expect(
      resolveWorkspaceShortcut(
        key({ key: '1', altKey: true, metaKey: true }),
        CONTEXT,
      ),
    ).toBeNull();
  });

  it('Escape and unrelated keys are never handled here (dialogs own Escape)', () => {
    expect(
      resolveWorkspaceShortcut(key({ key: 'Escape', altKey: true }), CONTEXT),
    ).toBeNull();
    expect(
      resolveWorkspaceShortcut(key({ key: 'Escape' }), CONTEXT),
    ).toBeNull();
    expect(
      resolveWorkspaceShortcut(key({ key: 'k', altKey: true }), CONTEXT),
    ).toBeNull();
  });
});

describe('isTextEditingTarget', () => {
  it('classifies inputs, textareas and contenteditable only', () => {
    expect(isTextEditingTarget(null)).toBe(false);
    expect(isTextEditingTarget(document.createElement('input'))).toBe(true);
    expect(isTextEditingTarget(document.createElement('textarea'))).toBe(true);
    const editable = document.createElement('span');
    editable.contentEditable = 'true';
    expect(isTextEditingTarget(editable)).toBe(true);
    expect(isTextEditingTarget(document.createElement('a'))).toBe(false);
  });
});

describe('attachWorkspaceShortcuts', () => {
  const detachers: Array<() => void> = [];
  afterEach(() => {
    while (detachers.length > 0) detachers.pop()?.();
  });

  it('dispatches actions and preventDefaults handled combinations', () => {
    const closeActive = vi.fn();
    const activateOffset = vi.fn();
    const activateIndex = vi.fn();
    detachers.push(
      attachWorkspaceShortcuts({
        closeActive,
        activateOffset,
        activateIndex,
        getWindowContext: () => CONTEXT,
      }),
    );

    const wEvent = new KeyboardEvent('keydown', {
      key: 'w',
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(wEvent);
    expect(closeActive).toHaveBeenCalledTimes(1);
    expect(wEvent.defaultPrevented).toBe(true);

    const arrowEvent = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(arrowEvent);
    expect(activateOffset).toHaveBeenCalledWith(1);
    expect(arrowEvent.defaultPrevented).toBe(true);

    const digitEvent = new KeyboardEvent('keydown', {
      key: '2',
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(digitEvent);
    expect(activateIndex).toHaveBeenCalledWith(1);

    const plainEvent = new KeyboardEvent('keydown', {
      key: 'w',
      cancelable: true,
    });
    window.dispatchEvent(plainEvent);
    expect(closeActive).toHaveBeenCalledTimes(1); // unchanged
    expect(plainEvent.defaultPrevented).toBe(false);
  });

  it('detach removes the listener', () => {
    const closeActive = vi.fn();
    const detach = attachWorkspaceShortcuts({
      closeActive,
      activateOffset: vi.fn(),
      activateIndex: vi.fn(),
      getWindowContext: () => CONTEXT,
    });
    detach();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', altKey: true }),
    );
    expect(closeActive).not.toHaveBeenCalled();
  });
});
