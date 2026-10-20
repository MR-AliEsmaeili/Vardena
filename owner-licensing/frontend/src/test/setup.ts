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

// jsdom has no canvas context. Real engine scheduling is tested with a no-op
// context in thinking-orb.test.tsx; feature suites exercise the actual DOM.
HTMLCanvasElement.prototype.getContext = () => null;
