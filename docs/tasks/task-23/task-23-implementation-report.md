# Task 23 — Base Chart Template + Explicit Organization Adoption — Implementation Report

- **Status:** READY FOR REVIEW — NOT ACCEPTED
- **Branch:** `arena/01a0dfac-vardena` (Arena session-fixed branch)
- **PR:** [#66](https://github.com/MR-AliEsmaeili/Vardena/pull/66)
- **Baseline:** `main` at `778a9d4bbfc313204c379f095f5e7b68e4487a7f`
- **Final CI evidence at report creation:** run [`36297693862`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36297693862), backend and frontend successful
- **Scope:** backend-only, mechanism-only; no accounting chart content was supplied by the implementation

## 1. Objective

Implement the Task 23 mechanism for an Accounting-owned, versioned Base Chart Template and explicit organization adoption. Adoption copies a selected published version into ordinary organization-owned `accounting.accounts` rows after compatibility, organization-scope, active-pin, closure, mandatory-inclusion, emptiness, and duplicate checks. This report records the implementation and its verified state; it does not perform Owner acceptance.

The binding identity and posting boundary is:

```text
Template identity ≠ Ledger identity / Adoption = Copy / Posting = Leaf-only / Aggregation = Reporting/read-time
```

Equivalently, the four invariants are:

```text
Template identity ≠ Ledger identity
Adoption = Copy
Posting = Leaf-only
Aggregation = Reporting/read-time
```

## 2. Repository baseline inspected

The implementation and completion review inspected:

- PR #66 and the Task 23 specification, draft brief, decision analysis, and pre-implementation report;
- the accepted Task 21 governance baseline and acceptance record;
- OD-20-1 through OD-20-6 in the Task 20 investigation and owner-decision baseline;
- the Accounting module, existing `Account` model/repository/service, Coding Structure, Accounting Configuration, active-pin coherence, ledger foreign keys, and reporting/read-time aggregation;
- Organization deployment scope, membership authorization, RBAC permission registry, guards, and failure posture;
- Prisma multi-schema conventions, relational migrations, guarded transactions, PostgreSQL row-lock ordering, and existing live-database suites;
- `backend/vitest.config.ts`, `backend/vitest.config.e2e.ts`, `backend/test/*-live.e2e-spec.ts`, `backend/test/support/test-app.ts`, `.github/workflows/ci.yml`, and `docs/testing/test-execution-policy.md`.

**DEC-a-2 — prior-memory-fabrication control:** claims inherited from prior agent/session memory were treated as untrusted until verified against the checkout, Git history, PR metadata, source files, or CI evidence. This report records only repository- or CI-verifiable facts.

## 3. Existing architecture reused

No replacement architecture was introduced. Task 23 reuses:

- the NestJS Accounting module and controller → application service → data repository layering;
- the production HTTP bootstrap and global exception/validation pipeline;
- `OrganizationsService.assertOrganizationInScope` and the existing deployment/membership chokepoints;
- `AuthGuard`, `AuthorizationGuard`, `RequirePermission`, and the permission registry—without wildcard or administrator bypass;
- existing Coding Structure and Accounting Configuration active-version services plus ODR-1 pin coherence;
- the existing Account tree and code-placement rules;
- Prisma transactions and the repository's ordered `SELECT … FOR UPDATE` lock discipline;
- existing `Account.Created` events only; no speculative Base Chart event vocabulary was added;
- existing pagination, normalization, ULID generation, audit columns, and typed `AppException` responses.

`LedgerEntry.accountId → Account.id`, PostingService, account balance projections, and report aggregation were not redesigned.

## 4. Domain model implemented

The product-owned model consists of:

- `BaseChartTemplate`: stable code/title identity;
- `BaseChartTemplateVersion`: independent numbered versions with `draft | approved | published | superseded` lifecycle;
- relational version levels defining configurable depth and digit shape;
- relational nodes carrying template-local key, parent key/resolved parent, derived level, code, title, nature, postability default, mandatory marker, and activation default;
- `BaseChartAdoption`: immutable organization/version/configuration pin evidence and copied account count.

Template node identities are internal to one template version. They are not organization Account identities and never become document, balance, or ledger references. The content planner derives levels, validates hierarchy and code shape, refuses cycles/unknown parents/postable non-leaves, and supports the existing configurable depth ceiling rather than hardcoding four levels.

## 5. Database changes

Task 23 adds five normalized relational tables in the `accounting` schema:

1. `base_chart_templates`
2. `base_chart_template_versions`
3. `base_chart_template_levels`
4. `base_chart_template_nodes`
5. `base_chart_adoptions`

The schema uses keys, foreign keys, unique indexes, scope-leading indexes, audit columns, and `RESTRICT` history relationships. It does not use JSONB, EAV, generic polymorphic payloads, or an `accounts.is_mandatory` column. `accounts` receives no template-node foreign key or provenance field. Existing ledger/account foreign keys remain unchanged.

## 6. Migration details

Migration: `backend/prisma/migrations/20260926010000_accounting_base_chart/migration.sql`.

Properties:

- forward-only creation of Task 23 tables, constraints, and indexes;
- no destructive alteration of existing accounting rows;
- no seed data, codes, Persian titles, chart opinions, or mandatory list;
- no implicit organization adoption;
- relational mappings reflected in the split Prisma schema.

Verification evidence:

- GitHub CI `Prisma validate`: **PASS**;
- GitHub CI `Prisma generate`: **PASS**;
- GitHub CI `prisma migrate deploy` against PostgreSQL 16, including the Task 23 migration: **PASS**;
- repository migration rehearsal step (the existing populated pre-Task-11 rehearsal): **PASS**.

The existing rehearsal is not misrepresented as a populated pre-Task-23 upgrade rehearsal; Task 23's additive migration was applied from the CI migration chain and exercised by real PostgreSQL integration/E2E tests.

## 7. API endpoints

### Product-scoped template APIs

- `GET /api/v1/base-chart-templates`
- `POST /api/v1/base-chart-templates`
- `GET /api/v1/base-chart-templates/:id`
- `PATCH /api/v1/base-chart-templates/:id`
- `GET /api/v1/base-chart-template-versions`
- `POST /api/v1/base-chart-template-versions`
- `GET /api/v1/base-chart-template-versions/:id`
- `PUT /api/v1/base-chart-template-versions/:id/content`
- `POST /api/v1/base-chart-template-versions/:id/approve`
- `POST /api/v1/base-chart-template-versions/:id/publish`
- `POST /api/v1/base-chart-template-versions/:id/supersede`

### Organization-scoped adoption APIs

- `POST /api/v1/accounting/adopt-base-chart/preview`
- `POST /api/v1/accounting/adopt-base-chart`
- `GET /api/v1/accounting/base-chart-adoptions`
- `GET /api/v1/accounting/base-chart-adoptions/:id`

DTO validation and OpenAPI annotations use the existing project conventions.

## 8. Lifecycle rules

The lifecycle is one-way:

```text
Draft → Approved → Published → Superseded
```

- A template is created atomically with version 1 in `draft`.
- Only drafts accept level/node content replacement.
- Approval requires a draft.
- Publication requires an approved version and revalidates complete content under the template-wide lock.
- Publishing a newer version supersedes the previously published version and links history to its replacement.
- Published and superseded content is immutable; historical rows remain present.
- Invalid or reverse transitions are typed 422 business-rule failures.
- There is no delete/recreate lifecycle shortcut.

The PostgreSQL integration suite verifies valid transitions, invalid publish-from-draft, automatic supersession, history retention, and mutation refusal for both published and superseded versions.

## 9. Adoption algorithm

The service and guarded repository apply the same decisions, with the repository replay authoritative under locks:

1. resolve and authorize organization scope;
2. resolve the exact template version and require `published`;
3. resolve the organization's ACTIVE Accounting Configuration and ACTIVE Coding Structure Version;
4. prove ODR-1 coherence of that pair;
5. prove template/configuration digit-depth compatibility;
6. compute the final set as requested nodes plus ancestor closure plus mandatory inclusion;
7. ensure the organization's chart is empty;
8. ensure `(organization, template version)` was not already adopted;
9. insert ordinary organization-owned accounts, parents first;
10. insert one immutable adoption record;
11. commit, then publish the existing `Account.Created` event for each copied account.

Steps 1–10 are validation-before-mutation and the mutation is one Prisma transaction. The PostgreSQL suite intentionally supplies duplicate Account IDs to trigger a real unique-constraint failure after insertion starts and verifies complete rollback of accounts and adoption rows.

## 10. Ancestor closure

Partial selection is bounded. Selecting `R1C1L1` computes and persists exactly its complete path:

```text
R1
R1C1
R1C1L1
```

Unselected siblings and independent roots are not copied unless mandatory inclusion requires them. The planner emits deterministic parent-before-child order. Both PostgreSQL integration and HTTP E2E suites verify the closure using persisted Account rows, not only pure functions.

## 11. Mandatory inclusion

`isMandatory` exists only on template nodes and means inclusion during adoption. It is not copied into `accounts`, and no post-adoption mandatory mutation guard was invented.

When `R2C1` is mandatory and the request selects only `R1C1L1`, the final set is:

```text
R1 + R1C1 + R1C1L1 + R2 + R2C1
```

Thus the implementation realizes `requested + ancestor closure + mandatory inclusion`. No product mandatory list or accounting content was created by the agent.

## 12. Compatibility validation

Compatibility is fail-closed and checks:

- published version status;
- ACTIVE configuration and coding-structure availability;
- coherence between those two active pins;
- configured depth and level digit lengths;
- each selected/copied code against the compatible shape;
- valid requested keys and complete computed hierarchy.

Preview is read-only and returns `compatible` or `incompatible` with a typed problem. Adoption repeats the checks under transaction locks. Incompatible configuration produces a typed 422 on write and no accounts/adoption row.

## 13. Organization isolation

Adoption rows and resulting accounts are organization-scoped. Reads require an explicit organization and repository lookup refuses an adoption whose stored `organizationId` differs. Account queries remain scope-leading on `organizationId`.

Tests use Org A and Org B and verify:

- Org A's adoption is absent from Org B repository scope;
- Org A accounts are absent from Org B database scope;
- an authenticated, fully permissioned Org B member receives 404 when listing or retrieving Org A adoption;
- the same principal can read its own organization scope.

This preserves the repository's 404 non-disclosure posture for foreign organizations.

## 14. Authorization

Registered permissions:

- `Accounting.BaseChart.View`
- `Accounting.BaseChart.Configure`
- `Accounting.BaseChart.Adopt`

Controllers use normal authentication and authorization guards. Application services additionally reuse organization-scope enforcement for organization data. There is no wildcard permission, no role-name check, no superuser bypass, and no test-only production authorization path. Missing permission remains 403; unknown/foreign organization scope remains 404; disabled organization remains 422 through the existing Organization boundary.

## 15. Idempotency

The chosen Task 23 semantics are deterministic conflict, not silent success:

- first adoption of `(organizationId, publishedVersionId)`: success;
- repeated adoption: `409 Conflict`;
- database unique index is the concurrency backstop;
- the second request creates no Account and no adoption row.

Both service/application tests and live PostgreSQL/API tests verify unchanged account/adoption counts after the duplicate attempt.

## 16. Existing data compatibility

Adoption into a non-empty organization chart is refused with `409 Conflict`. There is no merge, upsert, overwrite, code reconciliation, or implicit migration. PostgreSQL tests create an existing ordinary Account, attempt adoption, and verify one unchanged Account and zero adoption rows.

Publishing template v2 after Org A adopted v1 does not modify Org A's copied accounts. Its adoption remains pinned to v1, v1 remains immutable history (now superseded), and v2 exists independently. This is the database-level proof that adoption is copy rather than a live reference.

## 17. Tests

### Existing Task 23 fast tests

- domain template planner: 24 cases;
- domain adoption planner: 19 cases;
- template application service: 11 cases;
- adoption application service: 13 cases;
- contract-faithful in-memory repositories exercise guard mappings and application behavior.

### New PostgreSQL integration suite

`backend/test/base-chart-live.e2e-spec.ts` contains 10 real-database integration scenarios covering:

- v1 draft persistence, relational levels/nodes, resolved parents and derived levels;
- valid draft mutation plus invalid parent and cycle refusal without mutation;
- lifecycle, invalid transition, supersession, immutability, and history;
- full COPY and persisted organization/tree/nature/configuration pins;
- proof that Accounts have no template FK and ledger `account_id` still targets `accounts`;
- partial closure and mandatory inclusion;
- leaf-only authoring/persistence;
- scoped reads and duplicate conflict with unchanged counts;
- existing-chart conflict with no mutation;
- real transaction rollback on unique-constraint failure;
- v1 adoption independence after v2 publication.

### New API E2E suite

`backend/test/base-chart-api-live.e2e-spec.ts` contains the required ten HTTP journeys using real Nest bootstrap, session cookies, guards, membership, services, Prisma repositories, and PostgreSQL:

1. create → draft → approve → publish;
2. preview compatible;
3. adopt → accounts created;
4. partial closure + mandatory inclusion;
5. duplicate → 409/no duplicates;
6. non-empty chart → 409/no mutation;
7. incompatible configuration refused;
8. published mutation refused;
9. Org B cannot access Org A adoption;
10. v2 publish leaves Org A's v1 copy unchanged.

There is no `.only`, `.skip`, fake PostgreSQL integration, or repository mock in either live Task 23 suite. The standard `describe.skipIf(VARDENA_TEST_DATABASE_URL === undefined)` follows the repository's existing live-suite convention: CI always supplies the variable and executes the scenarios.

## 18. CI results

Final evidence: GitHub Actions CI run [`36297693862`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36297693862) for PR #66 / commit `047832b64ddaab1e6e3380a0eccff8f50ebcf9e7`.

| Gate                                  | Result                                      | Execution         |
| ------------------------------------- | ------------------------------------------- | ----------------- |
| Prisma validate                       | PASS                                        | GitHub CI         |
| Prisma generate                       | PASS                                        | GitHub CI         |
| Lint                                  | PASS (0 errors; pre-existing warnings only) | local + GitHub CI |
| Typecheck                             | PASS                                        | local + GitHub CI |
| Format check                          | PASS                                        | local + GitHub CI |
| Unit tests                            | PASS — 1,220 tests / 107 files locally      | local + GitHub CI |
| Build                                 | PASS                                        | local + GitHub CI |
| Migration deploy (PostgreSQL 16)      | PASS                                        | GitHub CI         |
| Existing migration rehearsal          | PASS                                        | GitHub CI         |
| Integration (Task 23, PostgreSQL)     | PASS                                        | GitHub CI E2E job |
| E2E (Task 23, real HTTP + PostgreSQL) | PASS                                        | GitHub CI E2E job |
| Backend job                           | PASS                                        | GitHub CI         |
| Frontend regression job               | PASS                                        | GitHub CI         |

Full local E2E was intentionally not run because no local PostgreSQL service was available and the test-execution policy assigns heavy live E2E to CI. Local validation comprised dependency install, TypeScript typecheck, lint, format check, all 1,220 unit tests, and production build. No local result is claimed for Prisma validate, migration deploy/rehearsal, PostgreSQL integration, or full E2E; those PASS claims come from the linked CI run.

## 19. Files changed

Production/migration implementation (commit `15cf438`):

- Prisma migration and `accounting.prisma` / `organization.prisma` relations;
- Accounting module wiring and permission definitions;
- Base Chart domain planners/specs;
- template/adoption repositories, row contracts, errors, and lock helpers;
- template/adoption application services/specs;
- three controllers and Base Chart DTOs;
- contract-faithful test support repository.

Completion changes:

- `backend/test/base-chart-live.e2e-spec.ts`;
- `backend/test/base-chart-api-live.e2e-spec.ts`;
- this report: `docs/tasks/task-23/task-23-implementation-report.md`.

No CI workflow change was required because existing discovery already includes `test/**/*.e2e-spec.ts` and supplies PostgreSQL to every `*-live.e2e-spec.ts` suite.

## 20. Scope exclusions

Explicitly excluded and unchanged:

- invented Base Chart codes, Persian titles, natures, mandatory sets, or statutory content;
- Control Roles or `Account.control_role`;
- Dimensions;
- Treasury;
- Frontend;
- PostingService and ledger redesign;
- account code-history resolution;
- post-adoption mandatory-account guards;
- automatic upgrade/synchronization of adopted charts;
- Task 19/20/21 decision reopening;
- OQ resolution or ADR promotion.

## 21. Remaining OQs

The following remain **OPEN and unchanged**:

- **OQ-25:** expert-approved Base Chart content and related concrete accounting values;
- **OQ-36:** code reuse/deletion/history policy beyond the accepted producer-bound boundary;
- **OQ-41:** dimension catalog, requirements, binding, and applicability;
- **OQ-43:** statutory reporting/profile content and legal maintenance.

Task 23 implements mechanism only and does not imply closure of any of them.

## 22. Follow-ups

### Follow-ups / Non-blocking Findings

- Existing lint reports warnings in pre-existing Accounting files; CI has zero lint errors. Cleaning unrelated warnings is outside Task 23.
- GitHub Actions reports platform deprecation notices for actions currently targeting Node.js 20 and the future `ubuntu-latest` image migration. Workflow maintenance is repository-wide and outside Task 23.
- If the Owner later approves actual Base Chart content under OQ-25, deliver it through a separately reviewed content process; do not retrofit content into this mechanism silently.
- A dedicated populated pre-Task-23 upgrade rehearsal could be added if repository migration policy later requires one for additive migrations. Current evidence is migration-chain deploy plus live relational tests.

## 23. Known limitations

- No Base Chart content is bundled; templates must be explicitly authored by an authorized caller.
- Adoption only targets an empty organization chart. Merge/reconciliation is intentionally undefined and refused.
- Re-adoption uses deterministic 409 semantics rather than returning the original result.
- There is no automatic organization upgrade from one template version to another.
- Mandatory is adoption-time template semantics only; adopted Accounts do not retain the marker.
- Local live PostgreSQL integration/E2E was not available in this sandbox; final live evidence is the successful GitHub CI run.
- The existing migration rehearsal is for populated pre-Task-11 data, not a bespoke populated pre-Task-23 dataset; Task 23 is additive and was validated by migrate-deploy and live suites.

## 24. Final verification checklist

### Base Chart

- [x] Versioned
- [x] Draft → Approved → Published → Superseded lifecycle
- [x] Published immutable
- [x] Superseded immutable
- [x] No invented accounting content

### Adoption

- [x] Explicit and permission-gated
- [x] COPY semantics to organization-owned Accounts
- [x] Atomic guarded transaction
- [x] Duplicate protected with deterministic 409
- [x] Non-empty chart rejected with no mutation
- [x] Partial adoption
- [x] Ancestor closure
- [x] Mandatory inclusion
- [x] Version independence

### Accounting

- [x] Leaf-only posting
- [x] `LedgerEntry.accountId` remains `Account.id`
- [x] No template identity in ledger or Account FK
- [x] Reporting/read-time roll-up semantics unchanged

### Security

- [x] Organization isolation
- [x] Existing permission model
- [x] No wildcard
- [x] No bypass

### Database

- [x] Migration-only relational change
- [x] Prisma validate PASS in CI
- [x] Migration deploy PASS in CI
- [x] Existing migration rehearsal PASS in CI
- [x] No destructive existing-data change

### Tests and documentation

- [x] Unit PASS
- [x] Task-specific PostgreSQL integration PASS in CI
- [x] Task-specific real API E2E PASS in CI
- [x] Final CI green
- [x] 24-section implementation report exists
- [x] Report distinguishes local and CI evidence
- [x] No false acceptance claim

**Recommendation:** READY FOR REVIEW. Acceptance remains **NOT PERFORMED** and belongs to the authorized reviewer/Owner.
