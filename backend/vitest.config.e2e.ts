import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // E2E runs against an intentionally unreachable database so the
    // readiness/503 path is deterministic without Docker. See test/README.
    // A live-database suite is opt-in via VARDENA_TEST_DATABASE_URL.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://vardena:invalid@127.0.0.1:1/vardena_test',
      // The harness explicitly selects the configuration-backed development
      // licensing authority (L-02): the suites below exercise other modules
      // and must not each activate a license. Selection is by provider name,
      // never by NODE_ENV — the licensing suites that exercise persistence
      // and activation override this per app (test/licensing-activation*).
      LICENSE_PROVIDER: 'local-development',
    },
  },
});
