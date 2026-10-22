import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: [
      '../owner-licensing/backend/test/owner-customer-acceptance.test.ts',
    ],
    env: {
      NODE_ENV: 'test',
    },
  },
});
