import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Full-shell integration tests render the session, licensing, organization and
 * financial-context gates before the routed page exists, so a `findBy*`
 * assertion waits on a chain of (mocked, but still asynchronous) providers.
 * The 1 s default was tight enough to fail intermittently on a loaded CI/local
 * machine even though nothing was wrong: the assertion retried inside a
 * scheduling gap, not against slower behaviour. 3 s keeps the assertion meaning
 * ("eventually") while removing the timing race. This affects only how long a
 * query retries — never what it asserts, and real failures still fail.
 */
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    localStorage.removeItem('vardena:appearance:v1');
    localStorage.removeItem('vardena:sidebar:v1');
  } catch {
    // ignore storage-less environments
  }
  document.documentElement.setAttribute('data-theme', 'light');
  document.documentElement.setAttribute('data-font-scale', 'default');
});

// jsdom does not implement `matchMedia`, which Tailwind-driven components may
// consult indirectly through third-party code.
if (!('matchMedia' in globalThis.window)) {
  Object.defineProperty(globalThis.window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom has no canvas implementation. `thinking-orbs` guards a null 2D
// context (it returns before painting), but jsdom's own `getContext` logs a
// "Not implemented" console error when called. Returning `null` explicitly
// keeps the suite free of that noise while preserving the library's real
// guarded path. Tests that need a context install their own stub.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  writable: true,
  value: () => null,
});
