import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Frontend test configuration.
 *
 * Vitest is the repository's existing test runner (`backend/vitest.config.ts`),
 * so no second framework is introduced (AG-11, AR-30). React components are
 * rendered with Testing Library in jsdom; the API layer is stubbed at the
 * module boundary, never by a mock HTTP server, so no network dependency and
 * no extra tooling is required.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
  },
});
