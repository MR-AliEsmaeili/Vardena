# Task 11 — Remediation & Verification Implementation Report

Status: **READY FOR REVIEW** · Date: 2026-09-22 · Mode: implementation + verification
Branch: `arena/01a0c905-vardena` · Pull request: **#27** · Base: `main` (`936be83`)

Legend used in this report: `V` = VERIFIED (a command or file in this repository produced it), `R` = REPORTED (taken from the review input), `U` = UNVERIFIED (not executable in this environment).

---

## A. Changed files

| File | Change |
|---|---|
| `backend/prisma/migrations/20260920000000_accounting_configuration_foundation/migration.sql` | **V** D3 level copy joins exactly one ACTIVE version deterministically; the default 2-level fallback is one statement guarded by "this configuration has no level rows"; explanatory comments. |
| `backend/prisma/schema/accounting.prisma` | **V** Integrity comment: `uq_accounting_configurations_org_active` is a raw-SQL partial unique index (Prisma cannot declare it); the drift risk is accepted and verified live + by the rehearsal. |
| `backend/src/modules/accounting/domain/accounting-configuration.ts` | **V** `MAX_LEVEL_KIND_LENGTH = 20`; problems `level_kind_invalid` (blank) and `level_kind_too_long` (>20); messages; trim-equality rejection removed (padded-but-short values are accepted as-is). |
| `backend/src/modules/accounting/api/dto/accounting-configuration.dto.ts` | **V** `levelKind` is `@IsString @MaxLength(MAX_LEVEL_KIND_LENGTH)` (was 64) + nullable + documented `maxLength`. |
| `backend/src/modules/accounting/domain/account.ts` | **V** `planRootAccountPin` (root pin ACTIVE checks) and `planAccountMovePin` (move must match the account's own pinned pair) + problem messages. |
| `backend/src/modules/accounting/data/accounts.repository.ts` | **V** `createChecked`: root locks the coding-version row **and** the configuration row and re-checks via `planRootAccountPin`; child path rejects a configuration/version mismatch; `updateChecked` refuses a move snapshot that is not the account's own pair (`planAccountMovePin`). |
| `backend/src/modules/accounting/application/accounts.service.ts` | **V** Move snapshot comes from `pinnedPairForMove(current)` (the account's own configuration/version) instead of the organization's active configuration; comment records that `markOperationallyUsed` is deliberately not called (D4). |
| `backend/src/modules/accounting/application/accounting-configurations.service.ts` | **V** The misleading "called from AccountsService.createAccount" comment replaced by the D4-deferred doc and a pointer to the decision note (no behaviour change). |
| `backend/src/modules/accounting/application/coding-structure-accounts.spec.ts` | **V** Two new application-level regression tests (own-configuration move validation; concurrent publish superseding the resolved version during a root create). |
| `backend/src/modules/accounting/domain/account-placement.spec.ts` | **V** New describes: move-pin refusal, root-pin write-boundary problems (31 tests total). |
| `backend/src/modules/accounting/domain/accounting-configuration.spec.ts` | **V** `levelKind` 20/21/64 boundary test (15 tests total). |
| `backend/src/modules/accounting/api/dto/accounting-configuration.dto.spec.ts` | **V (new)** 5 DTO boundary tests (`levelKind` 20/21/64, null, non-string). |
| `backend/src/modules/accounting/domain/level-kind-contract.spec.ts` | **V (new)** 3 cross-layer tests: domain constant = Prisma `@db.VarChar(20)` = migration `VARCHAR(20)`; no `slice/substring/substr/padEnd/padStart` on any `levelKind` line. |
| `backend/test/support/accounting-structure-repositories.ts` | **V** The in-memory account repository mirrors the real one: root create dispatches `planRootAccountPin`, move requires the snapshot and `planAccountMovePin`. |
| `backend/test/accounting-configuration-live.e2e-spec.ts` | **V** Repaired live suite (8 tests): FK-negative with control + DB-state oracle, partial-unique index challenged directly, `level_kind` width, root write-boundary ACTIVE re-check, D4 non-marking, D6 typed error, NOT NULL/RESTRICT, D1/D2 pins. |
| `backend/prisma/rehearsal/task-11-configuration-foundation/**` | **V (new)** `pre-task-11-fixture.sql` (5 orgs / 6 versions / 12 levels / 9 accounts), `verify.sql` (563 lines of assertions), `rehearse.mjs` (disposable DB, lock probe, notices as evidence). |
| `backend/package.json` | **V** `test:migration-rehearsal` script. |
| `docs/accounting/task-index.md` | **V** Task 11 row (PR #25 + remediation), architecture note, §6 status, §8 follow-ups, §9 history, date. |
| `docs/accounting/configuration.md` | **V** Corrected D3/migration semantics, updated test inventory, remediation section, decision-note/OQ links. |
| `docs/accounting/task-11-mark-operationally-used-decision-note.md` | **V (new)** Item 9 deliverable (caller, transaction boundary, failure, idempotency, replay, multi-configuration vouchers). |
| `docs/adr/0028-accounting-configuration-foundation.md` | **V** Remediation addendum (decisions stand; the five clarifications recorded). |
| `docs/modules.md` | **V** Accounting entry: Task 11 tables/API/permissions (31 codes), rehearsal pointer, D4/OQ status. |
| `.vardena/project-context.md` | **V** Staleness fixed: the file now describes the implemented backend (Tasks 1–11), tests and governance pointers. |
| `docs/open-questions.md` | **V** OQ-62 (pin compatibility), OQ-63 (legacy fallback shape), OQ-64 (operational-use boundary); date. |
| `docs/task-11-implementation-report.md` | **V (new)** This report. |

No file outside the Accounting module, its tests, its migration/Prisma sources
and the governance docs was touched.

---

## B. Exact defects fixed

1. **Cross-configuration validation was possible on a move** — `accounts.service.ts` resolved the organization's active configuration for a move, so an account pinned to a different configuration could be validated against the wrong level set. **Fixed (V):** the move snapshot is the account's own pinned pair (`pinnedPairForMove`), and `AccountsRepository.updateChecked` refuses any snapshot that is not that pair (`planAccountMovePin` → `AccountPlacementRejectedError('version_mismatch')`). Regression: `coding-structure-accounts.spec.ts` — with a second configuration `WIDE` (5+1) ACTIVE, a child→root move still fails with `level_length_mismatch` against the account's own 2+3 pair and the raw row keeps its pins.
2. **Coding-version ACTIVE was checked only during service resolution** — a publish between resolution and the locked insert could pin a superseded version. **Fixed (V):** `createChecked` locks the coding-version and configuration rows and re-checks both (`planRootAccountPin`); `CodingStructureVersionNotActiveError` / `AccountingConfigurationNotActiveError` are thrown at the write boundary. Regression: app-level test (monkey-patched `findActiveForOrganization` supersedes the resolved version → `Conflict`, no account row written) + live test (repository called directly with a superseded version id → refused, nothing written; the ACTIVE version is accepted).
3. **Migration appended a default level to a ONE-level copy** — the old fallback inserted level 2 whenever `COUNT(*) = 1`, so an organization whose coding structure has a single level received a two-level configuration, silently widening the code shape its new accounts would be validated against. **Fixed (V):** the fallback is one statement guarded by `NOT EXISTS (… WHERE accounting_configuration_id = lc.id)` ("no level rows at all"); a copied set — including a one-level set — is never extended. Rehearsal evidence: `PASS level preservation: … 1 level for org-one-level`.
4. **Nondeterministic level copy** — the copy joined `coding_structure_versions` on `status='active'`; if the "exactly one active version" invariant were violated, two rows for one level index would abort the whole migration on `uq_accounting_configuration_levels_config_level`. **Fixed (V):** the join uses a deterministic single row (`ORDER BY version_number DESC, id ASC LIMIT 1`).
5. **`levelKind` contract drift** — the DTO allowed 64 characters while the column stores 20; a 21–64 character value reached PostgreSQL and could fail (or, under a different deployment, be truncated). **Fixed (V):** 20 in the domain constant, the DTO (`@MaxLength`), the Prisma schema and the SQL column; values over the limit are refused with `level_kind_too_long` (400) and the live test proves the database also rejects a raw 21-character insert (`22001`) rather than storing a shortened value.
6. **FK-negative live test could not fail** — it threw its own error inside `try`, caught it, and asserted only that the caught message matched `/fk|foreign|mismatch/`, which its own message did. **Fixed (V):** the test now performs a **control insert** with a valid coding-version id (proving the probe shape works), then the violating insert, and asserts the **database state** (`SELECT … WHERE id = probe` returns no row) plus an FK-shaped error.
7. **Partial-unique live test never challenged the index** — it only counted `status='ACTIVE'` rows, which passes with no index at all (and with a non-partial index). **Fixed (V):** the test asserts `pg_indexes.indexdef` (UNIQUE + WHERE + ACTIVE), inserts a **DRAFT control** (accepted), then attempts a second ACTIVE row (rejected, nothing written, `23505`-shaped error), and re-checks the ACTIVE count.
8. **The D3 "orphan>0" claim was untestable in the live suite** — a database migrated from empty has no pre-Task-11 rows. **Fixed (V):** the live suite no longer claims it; the populated-backfill verification lives in the deterministic rehearsal (section D) with real orphans, one-level structures, multiple organizations, a draft version and a superseded-only organization.
9. **Misleading D4 comment** — `AccountingConfigurationsService.markOperationallyUsed` claimed "called from AccountsService.createAccount", the opposite of D4. **Fixed (V):** comment replaced; the method remains a deliberately unused seam (decision note + OQ-64). Live regression keeps `operationallyUsedAt` NULL after account creation.
10. **`project-context.md` claimed the repository had no application code** — misleading for every future agent. **Fixed (V):** the file now describes the implemented backend, the test layout, the rehearsal and the governance documents.

---

## C. Remaining unresolved decisions

| # | Decision needed | Registered as | Why it cannot be guessed |
|---|---|---|---|
| 1 | Do an account's two pins (D1 configuration, D2 coding version) have to describe the same level shape, and which one wins when they differ? | **OQ-62** | No rule exists today; both pins are assigned together at creation and inherited by children. The rehearsal produced a **real divergence** (`org-superseded-only`: accounts pin a superseded 2+2 version, the LEGACY configuration carries the default 2+3 shape), so enforcing compatibility would immediately require a data-repair policy — a product/architecture decision. |
| 2 | Which level set should the LEGACY configuration get when the organization has no ACTIVE coding version: the documented default (2+3), the newest SUPERSEDED version's set, or should the migration refuse? | **OQ-63** | The default is what the approved D3 text says and what the migration does (rehearsal `OBSERVED fallback…`); deriving from a superseded version would change approved semantics, and refusing would block the migration. |
| 3 | What exactly is "the first operational use" that freezes a configuration (cardinality when a voucher references accounts of several configurations; where the marker write sits in the module's lock order; whether a SUPERSEDED configuration referenced by a new voucher is marked)? | **OQ-64** + `docs/accounting/task-11-mark-operationally-used-decision-note.md` | The invariant and the transaction semantics are not unambiguous; §9 forbids implementing on a guess. |

Not decisions, but standing constraints introduced by the rehearsal (recorded in
`verify.sql`/the docs): the rehearsal assumes the Task 11 migration is the last
migration in `prisma/migrations` (it fails loudly otherwise), and the partial
unique index is raw-SQL-only (a future `prisma migrate dev` must not regenerate
the schema from the Prisma model blindly).

---

## D. Migration rehearsal — commands and outputs

**V** Environment: disposable PostgreSQL 17.10 started from the npm
`embedded-postgres` binaries (`pg_ctl -D /tmp/pgdata -o "-p 55432"`), role
`vardena`, database created/dropped by the script itself. CI uses the same
script against its `postgres:16` service.

```bash
cd backend
VARDENA_REHEARSAL_ADMIN_URL="postgresql://vardena:vardena_test_password@127.0.0.1:55432/postgres" \
  npm run test:migration-rehearsal          # = node prisma/rehearsal/task-11-configuration-foundation/rehearse.mjs
```

Output (exact, abbreviated to the phases and notices; exit code `0`):

```text
== Task 11 migration rehearsal ==
    migrations before Task 11: 12
    created disposable database "vardena_rehearsal_task11"
-- phase 1: apply 12 pre-Task-11 migrations            (each ~5–20 ms, all applied)
-- phase 2: seed populated pre-Task-11 data
    accounts: 9
    coding_structure_levels: 12
    coding_structure_versions: 6
    organizations: 5
    accounts with a NULL coding version (impossible): 0
-- phase 3: apply 20260920000000_accounting_configuration_foundation (single transaction, lock probe)
    observed: migration waiting on AccessExclusiveLock for accounting.accounts
    applied 20260920000000_accounting_configuration_foundation (109 ms)
    migration transaction committed (109 ms) after the lock was released
-- phase 4: verification
    PASS row counts: accounts=9 (unchanged), coding_structure_versions=6 (unchanged), coding_structure_levels=12 (unchanged)
    PASS per-organization account counts unchanged
    PASS row preservation: every account kept its id, code, level, parent, nature and coding_structure_version_id
    PASS NOT NULL: every account is backfilled, the column is NOT NULL and every pin is same-organization
    PASS orphan handling: exactly one LEGACY ACTIVE v1 configuration per organization with accounts; org-no-config untouched
    PASS level preservation: copied sets equal the ACTIVE coding structure (3 levels for org-multi, 1 level for org-one-level, ACTIVE 3+2 for org-draft-version)
    OBSERVED fallback: org-superseded-only (accounts pin a SUPERSEDED version, no ACTIVE one) received the documented default shape 2+3 — decision-open, see the Task 11 remediation report
    PASS NOT NULL: a NULL accounting_configuration_id is rejected by the database (23502)
    PASS FK: accounts.accounting_configuration_id rejects unknown configurations (23503)
    PASS FK: accounts.coding_structure_version_id rejects unknown versions (23503)
    PASS FK: re-pinning an account to an unknown configuration is rejected
    PASS FK RESTRICT: a configuration referenced by accounts cannot be deleted
    PASS FK RESTRICT: a coding-structure version referenced by accounts cannot be deleted
    PASS partial unique index present: CREATE UNIQUE INDEX uq_accounting_configurations_org_active ON accounting.accounting_configurations USING btree (organization_id) WHERE ((status)::text = 'ACTIVE'::text)
    PASS partial unique index: a second ACTIVE configuration for the same organization is rejected (23505)
    PASS exactly one ACTIVE configuration per organization
    PASS level_kind: a 20-character value is stored as-is
    PASS level_kind: a 21-character value is REJECTED (22001), never truncated
    PASS migration completion: tables, indexes and foreign keys all exist
    PASS rehearsal summary: 5 organizations, 9 accounts, 4 configurations, 8 configuration levels
    dropped "vardena_rehearsal_task11"

REHEARSAL PASSED: migration completed and every verification check passed.
```

Fixture coverage (all required cases from §7 of the task): organization with no
configuration (`org-no-config`, untouched), organization with an active
configuration (`org-multi`), accounts referencing coding structures (9 accounts
across 4 organizations), **one-level configuration structure**
(`org-one-level`, level count must stay 1), orphan accounts (all 9 rows start
without a configuration), **multiple organizations** (5), plus a draft-version
organization and a superseded-only organization. Lock behaviour is **measured**
(the migration is proven to block on the `accounts` table's `AccessExclusiveLock`
before it is allowed to proceed), and `KEEP=1` retains the database for
inspection.

---

## E. Tests added / changed

| Test | Kind | What it proves |
|---|---|---|
| `coding-structure-accounts.spec.ts` — "validates a move against the account's OWN configuration, never the organization's active one" | app-level (new) | With a second ACTIVE configuration (5+1) the move is still validated against the account's own 2+3 pair (`level_length_mismatch`); the raw row keeps parent/level/pins. |
| `coding-structure-accounts.spec.ts` — "refuses to pin a new root to a coding version that stopped being active between resolution and write" | app-level (new) | Concurrent publish → `Conflict`, no account row written. |
| `domain/account-placement.spec.ts` | unit (extended) | `planAccountMovePin` refusal on either pin mismatch; `planRootAccountPin` problem table (missing/not-active for both rows) — 31 tests. |
| `domain/accounting-configuration.spec.ts` | unit (extended) | `levelKind` null / blank / 20 / 21 / 64 behaviour; no truncation — 15 tests. |
| `api/dto/accounting-configuration.dto.spec.ts` | unit (new, 5) | DTO accepts 20, rejects 21 and 64 with a 400; null accepted; non-string rejected. |
| `domain/level-kind-contract.spec.ts` | unit (new, 3) | Domain constant = Prisma `@db.VarChar(20)` (both models) = migration DDL `VARCHAR(20)`; no silently truncating call on any `levelKind` source line. |
| `test/accounting-configuration-live.e2e-spec.ts` | live e2e (repaired, now 8 tests) | D1/D2 pins; D6 typed business-rule error; FK-negative with control + DB-state oracle; partial unique index challenged directly; NOT NULL + no NULL rows + FK RESTRICT; `level_kind` width; root write-boundary ACTIVE re-check; D4 non-marking. |
| `test/support/accounting-structure-repositories.ts` | test support | The in-memory twin enforces the same pin decisions as the repository (so unit-level tests cannot pass on a weakened fake). |
| `prisma/rehearsal/task-11-configuration-foundation/{pre-task-11-fixture.sql,verify.sql,rehearse.mjs}` | migration rehearsal (new) | Section D. |

Anti-tautology measures: the FK test asserts database state (not the thrown
message alone) and includes a positive control; the partial-index test asserts
the index definition and includes a DRAFT control; the level-copy assertions
compare full level rows (index, title, digit length, postability, kind) in both
directions; the lock assertion fails the run when no blocked
`AccessExclusiveLock` is observed.

---

## F. Exact test results

| Command | Baseline (`936be83`) | After this change |
|---|---|---|
| `npm test` (unit) | 74 files / 911 tests pass (30.3 s) | **76 files / 926 tests pass** (27.6 s) **V** |
| `npm run test:e2e` (non-live + skipped live) | 15 files pass + 8 skipped; 189 pass + 42 skipped (58.4 s) | **15 files pass + 8 skipped; 189 pass + 45 skipped** (38.3 s) **V** — the real live-DB suites still run only with `VARDENA_TEST_DATABASE_URL` (CI) |
| `npm run typecheck` | clean | **clean** **V** |
| `npm run lint` (`oxlint`) | 0 errors / 5 warnings | **0 errors / 4 warnings** **V** (one pre-existing warning disappeared: the in-memory fake now uses `CodingStructureVersionNotActiveError`) |
| `npm run format:check` | clean | **clean** **V** |
| `npm run test:migration-rehearsal` | not existing | **REHEARSAL PASSED** (exit 0) **V** |

Accounting-specific counts (**V**, from the run above):
`coding-structure-accounts.spec.ts` 31 · `account-placement.spec.ts` 31 ·
`accounting-configuration.spec.ts` 15 · `accounting-configurations.spec.ts` 8 ·
`accounting-configuration.dto.spec.ts` 5 · `level-kind-contract.spec.ts` 3 ·
`coding-structure.spec.ts` 25 · `account-code.spec.ts` 13.

Environment limits, stated explicitly: this sandbox has **no Prisma CLI**
(`binaries.prisma.sh` is unreachable) and the generated Prisma client is a
committed stub, so the **live-DB e2e suites cannot execute here** — they are
`U` locally and are exercised by CI (step "E2E tests (incl. live-DB suites)").
The PostgreSQL 17.10 rehearsal (section D) is the local database-level evidence
and covers the migration, the backfill and every constraint.

---

## G. CI status

**V — PASS.** Pull request **#27** (`arena/01a0c905-vardena` → `main`), workflow
run **35727571225** on head `6ff4f48` (`gh pr checks 27` → `backend  pass  2m51s`).
Every step is green:

```text
1 Set up job                     success      10 Typecheck                      success
2 Initialize containers          success      11 Format check                 success
3 Checkout                       success      12 Unit tests                   success
4 Setup Node.js                  success      13 Build                        success
5 Upgrade npm to v11             success      14 Migrate test database        success
6 Install dependencies           success      15 E2E tests (incl. live-DB)    success
7 Prisma validate                success      28–31 Post steps / containers   success
8 Prisma generate                success
9 Lint                           success
```

Why the **live-DB step is the authoritative live verification for items 3/5/6**:
`VARDENA_TEST_DATABASE_URL` is set at job level in `.github/workflows/ci.yml`, so
the `describe.skipIf(DATABASE_URL === undefined)` guards in the live specs
(including the repaired `accounting-configuration-live.e2e-spec.ts`, 8 tests) do
not skip; the step fails if any of them fails, and it passed. The `migrate
deploy` step before it applies the Task 11 migration to the `postgres:16`
service, so the DDL under test is the real one.

Limitation, stated explicitly: the per-test stdout of that step could not be
retrieved from this sandbox (`gh run view --log` cannot reach GitHub's log
host), so the evidence at test granularity is **U**; the step conclusion and the
guard analysis above are **V**. The lint annotations reported by CI match the
local run (0 errors, 4 warnings).

---

## H. Updated governance files

| File | Update |
|---|---|
| `docs/accounting/task-index.md` | Task 11 added to the verification table (PR #25), a Task 11 architecture block in §3, §6 clarified (Task 11 is defined; every future task still passes §7), three new §8 follow-ups (OQ-62/63/64), §9 history entry 2026-09-22, date bumped. |
| `docs/modules.md` | Module catalog row + Accounting section: Task 11 foundation (tables, lifecycle, backstop index, D1/D2 pins, LEGACY backfill), 31 permissions, `/api/v1/accounting-configurations`, rehearsal + D4/OQ status. |
| `.vardena/project-context.md` | "Current Repository State" rewritten (backend implemented, Tasks 1–11, tests, rehearsal, governance pointers); repository map updated to the real layout. |
| `docs/accounting/configuration.md` | D3/migration semantics corrected (deterministic copy, "no level rows" fallback, never extend a copied set), test inventory refreshed, remediation section, links to the decision note/rehearsal/OQs. |
| `docs/adr/0028-accounting-configuration-foundation.md` | Remediation addendum: the five clarifications (copy semantics, dense lock/backfill verification, levelKind width, D4 note, pin compatibility) — decisions unchanged. |
| `docs/open-questions.md` | OQ-62, OQ-63, OQ-64 registered with assumptions and owners. |
| `docs/accounting/task-11-mark-operationally-used-decision-note.md` | New (item 9). |
| `docs/task-11-implementation-report.md` | This report. |

---

## I. Risks / follow-up tasks

1. **Legacy divergence is real data, not a hypothesis** (OQ-62): after this
   migration, an organization whose accounts pin a superseded coding version can
   carry a configuration whose level shape differs from that version. New codes
   are validated against the configuration (D1), so the divergence is invisible
   to the application today. A follow-up task should decide detection/repair
   (report, data-fix migration, or accept-and-document per organization).
2. **Default fallback shape** (OQ-63): the two-level default is applied to every
   organization without an ACTIVE coding version; if the product wants the
   newest SUPERSEDED version's shape instead, that is a targeted data migration
   plus a decision, not a code change.
3. **Operational freeze** (OQ-64): the freeze guard is inert until a caller
   exists, so `operationally_used_at` never blocks a destructive change today —
   dependency of the freeze promise on the Posting task (documented in
   configuration.md/ADR-0028).
4. **Rehearsal maintenance**: the runner requires the Task 11 migration to be the
   last one and will fail loudly when a later migration is added; the next Task 11
   migration-adjacent change (or a generalisation of the runner to a target
   migration) should be considered deliberately.
5. **Raw-SQL-only partial index** (`accounting.prisma` comment): a future
   `prisma migrate dev` that regenerates the schema from the Prisma models would
   drop `uq_accounting_configurations_org_active`; the live index-definition test
   and the rehearsal catch that drift, but the comment is the guard against
   surprise.
6. **`--no-verify`-free hygiene**: the four remaining lint warnings are
   pre-existing (two unused imports, one unused fixture helper, one unsafe
   optional chain) and were left untouched to keep the diff focused.
7. **Not verified in this sandbox**: live-DB e2e execution (needs the CI
   database; CI run 35727571225 passed it — see §G); everything else above was
   executed here.
8. **Rehearsal is now wired into CI** (was: run manually). The pipeline runs
   `npm run test:migration-rehearsal` between `migrate deploy` and the e2e step,
   so the populated pre-Task-11 backfill is verified on every change; the step
   drops its disposable database on success and fails the job otherwise (it
   needs `CREATE DATABASE` on the service, which the CI `postgres:16` service
   grants). Recorded in
   `docs/task-11-final-verification-report.md` §F2.

---

## J. Final status

**READY FOR REVIEW** — all nine required items are addressed: four defect classes
are fixed with regression tests that fail when the invariant breaks (items 1, 3,
5, 6), the migration semantics are corrected and verified on populated pre-Task-11
data by a deterministic rehearsal (items 4, 7), the reference/consistency question
is answered by enumeration and registered as decisions rather than guessed
(item 2), the deferral is documented instead of implemented (item 9), and the
governance documents and this report are updated (item 8). CI run 35727571225
passed every step, including the live-DB e2e step against the migrated
`postgres:16` service; the rehearsal passed locally against PostgreSQL 17.10.
Three decisions remain open by design (OQ-62…OQ-64) and are recorded with
assumptions instead of guesses.
