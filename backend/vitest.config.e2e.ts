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
    },
  },
});
