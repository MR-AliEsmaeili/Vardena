import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 CLI configuration (docs/database-strategy.md section 2).
// - `schema` points at the per-module schema folder (ADR-0008).
// - `migrations.path` is explicit: migrations live in prisma/migrations.
// - The connection string comes from the environment, never the schema.
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
