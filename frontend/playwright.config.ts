import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration (`docs/frontend/e2e-testing.md`).
 *
 * Scope: the tests drive the REAL application shell, the real router, the real
 * grid and the real Jalali date components inside Chromium. Only the HTTP
 * boundary is stubbed (`e2e/fixtures/api.ts`): there is no PostgreSQL, no
 * NestJS process and no session cookie handling in CI, and a UI regression is
 * still caught because every selector is a role or a `data-testid` of the
 * shipped DOM, never a CSS class.
 *
 * The suite is deliberately NOT part of `npm test` (Vitest/jsdom stays the
 * fast local loop); run it with `npm run test:e2e`. It is executed in CI only —
 * a full browser run on a developer machine is not required by the standard
 * (`docs/frontend/data-table.md` §۱۰).
 */
export default defineConfig({
  testDir: './e2e',
  // One file at a time per worker keeps the route stubs independent: every
  // test installs its own `/api/v1/**` handler on its own page.
  fullyParallel: true,
  forbidOnly: process.env['CI'] === 'true',
  retries: process.env['CI'] === 'true' ? 1 : 0,
  ...(process.env['CI'] === 'true' ? { workers: 2 } : {}),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter:
    process.env['CI'] === 'true'
      ? [
          ['list'],
          // Machine-readable inventory: the CI failure step turns it into
          // annotations, because the uploaded report artifact is not always
          // reachable from a review surface.
          ['json', { outputFile: 'test-results/results.json' }],
          ['html', { open: 'never' }],
        ]
      : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    // RTL product: the browser must not auto-mirror, the app owns `dir="rtl"`.
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: process.env['CI'] !== 'true',
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
