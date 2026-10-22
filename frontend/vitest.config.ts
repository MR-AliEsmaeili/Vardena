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
    // The suite is integration-heavy: most files render the full provider stack
    // (query cache, session, licensing, organization, permissions) in jsdom. On
    // a many-core developer machine Vitest otherwise starts one worker per core
    // and the scheduling contention turns legitimate "eventually" assertions
    // into random failures, which reads as a red suite that nobody can trust.
    // Four workers is the CI runner's vCPU count, so `npm test` locally behaves
    // like the gate that actually merges.
    maxWorkers: 4,
    // The heaviest flows (offline licensing exchange, multi-step wizards) drive
    // real user events through the full provider stack and legitimately need
    // more than the 5s default when four workers share a contended machine.
    // 15s still fails fast on a genuine hang; assertions are unchanged.
    testTimeout: 15_000,
  },
});
