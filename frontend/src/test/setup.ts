import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
