# Task 33 — Test Evidence

## Baseline and policy

The Warehouse implementation was audited at baseline `ee17f41c5022d7185087285361f17be9c9567627`. Local execution is intentionally limited to fast checks. The complete backend suite, migration deployment/rehearsal, and live PostgreSQL E2E run in GitHub Actions as defined by `.github/workflows/ci.yml`.

## Local fast verification

| Check | Result |
|---|---|
| Focused Warehouse unit/application tests | NOT RUN — no Warehouse-specific unit spec exists at baseline; implementation was preserved |
| `npm run typecheck` | PASS (18.8s) |
| `npm run lint` | PASS with 1 pre-existing warning in `coding-structure-accounts.spec.ts:896` (0 errors; 0.6s) |
| `npm run format:check` | PASS (20.0s) |
| Full `npm test` / `npm run test:e2e` | NOT RUN locally by policy |

## Existing relevant coverage

`backend/test/inventory-core.e2e-spec.ts` boots the real application harness and exercises warehouse creation, movement-backed lifecycle behavior, organization-scoped by-ID behavior, and Inventory flows. The CI backend job runs all E2E specs after PostgreSQL migration deployment and bootstrap.

## CI evidence

- Run: **PENDING post-push run**
- Backend job: **PENDING**
- Relevant groups: Prisma validate/generate, lint, typecheck, format check, unit tests, build, migration deploy, migration rehearsal, live PostgreSQL E2E.

No CI result is claimed until the actual post-push GitHub Actions run and job are inspected with `gh`.
