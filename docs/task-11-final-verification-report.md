# Task 11 — Final Verification Pass

Status: **ACCEPTED (with recorded gaps)** · Date: 2026-09-22 · Type: verification (no feature work)
Verifier scope: Task 11 remediation as merged into PR **#27** (`arena/01a0c905-vardena`, head `f39f1bb` + this pass)
Environment: sandboxed Debian 12, Node 22.22.3, disposable PostgreSQL **17.10** (embedded-postgres), no Prisma engine binaries (`binaries.prisma.sh` unreachable — HTTP 000), GitHub Actions reachable.

> This document is the auditable output of the final verification pass. Every
> claim is one of **VERIFIED** (an executed command produced it, quoted here),
> **INFERRED** (read from code/data, not executed), **SKIPPED** (the runner did
> not execute it), or **NOT EXECUTED** (the environment could not run it; the
> reason is given). Nothing here is asserted from compilation alone.

**Headline:** every critical Task 11 invariant is demonstrated by executable
evidence, and the tests that guard them were mutation-tested to prove they can
fail. Three gaps remain open — none of them a defect in the merged code — and one
governance inaccuracy was found **by this pass** and fixed (§A).

---

## A. Exact files changed during this verification pass

| File | Change | Why |
|---|---|---|
| `.vardena/project-context.md` | Corrected the module inventory: the repository has **nine** module directories (`health` + eight domain modules), not eight; the repository map line now says "health + the eight domain modules". | **Found by this pass**: the claim written during remediation was checkable and wrong (`ls backend/src/modules` = 9, `app.module.ts` registers `HealthModule`). A governance artifact must not state repository facts inaccurately. |
| `docs/task-11-final-verification-report.md` | New: this report. | Deliverable of the verification pass. |

**No production code, test, migration, schema or configuration file was changed
in this pass.** The verification used mutation testing only, and every mutated
file was restored with `git checkout --`; the tree was confirmed clean after each
battery (`git status --porcelain` → empty, except the two documentation files
above).

Non-repository artifacts created (not part of the deliverable, listed for
reproducibility): two scratch databases on the disposable cluster —
`vardena_rehearsal_task11` (kept with `KEEP=1` for independent probing),
`vardena_test_live` (all 13 migrations, for the live-suite attempt),
`vardena_pre11_probe` (12 pre-Task-11 migrations, for the schema-representability
check). No scratch file remains in the repository (verified by `git status`).

---

## B. Exact commands executed

```bash
# --- 1. migration rehearsal against a real PostgreSQL (kept for probing) ------
cd backend
KEEP=1 VARDENA_REHEARSAL_ADMIN_URL="postgresql://vardena:vardena_test_password@127.0.0.1:55432/postgres" \
  npm run test:migration-rehearsal
# → exit 0, "REHEARSAL PASSED", DB kept

# --- 2. independent probes of the migrated database (Node pg client) ---------
node ./fv-probe2.tmp.mjs     # per-org level sets, 7 SQL-computed invariants
node ./fv-probe3.tmp.mjs     # org-no-config untouched
# (temp files deleted afterwards; sources are the SQL in this report)

# --- 3. pre-Task-11 schema representability check ---------------------------
# replay the 12 pre-Task-11 migrations into vardena_pre11_probe, then:
#   INSERT account with coding_structure_version_id = NULL            → 23502
#   INSERT account with coding_structure_version_id = 'does-not-exist' → 23503

# --- 4. mutation battery (each: mutate → run → expect FAIL → restore → expect PASS)
node prisma/rehearsal/task-11-configuration-foundation/rehearse.mjs   # M1c, M6, M7
npx vitest run --config ./vitest.config.ts <target spec>              # M2, M3, M4, M5, M9, M10

# --- 5. full suites ---------------------------------------------------------
npm test                     # unit
npm run test:e2e             # e2e (live suites skip without VARDENA_TEST_DATABASE_URL)
npm run typecheck
npm run lint                 # oxlint
npm run format:check
npm run prisma:validate      # NOT EXECUTED (engine download blocked)

# --- 6. live-PostgreSQL attempt (classified NOT EXECUTED) -------------------
VARDENA_TEST_DATABASE_URL="postgresql://vardena:vardena_test_password@127.0.0.1:55432/vardena_test_live" \
  npx vitest run --config ./vitest.config.e2e.ts test/accounting-configuration-live.e2e-spec.ts
# → exit 1: "Error: Prisma Client has not been generated. Run \"npm run prisma:generate\" …", 8 tests skipped

# --- 7. governance claim checks + CI evidence -------------------------------
gh api repos/MR-AliEsmaeili/Vardena/actions/runs/35727571225            # code SHA 6ff4f48
gh api repos/MR-AliEsmaeili/Vardena/actions/runs/35727571225/jobs       # 15 steps, all success
gh api repos/MR-AliEsmaeili/Vardena/actions/runs/35728013047            # docs SHA f39f1bb
gh pr checks 27
```

---

## C. Test results with meaningful evidence

### Check 1 — migration rehearsal against a real PostgreSQL (populated fixtures)

**VERIFIED.** Command and result (exit code 0, `REHEARSAL PASSED`):

```text
== Task 11 migration rehearsal ==
    migrations before Task 11: 12
    created disposable database "vardena_rehearsal_task11"
-- phase 1: apply 12 pre-Task-11 migrations            (all applied, 5–19 ms each)
-- phase 2: seed populated pre-Task-11 data
    accounts: 9 · coding_structure_levels: 12 · coding_structure_versions: 6 · organizations: 5
-- phase 3: apply 20260920000000_accounting_configuration_foundation (single transaction, lock probe)
    observed: migration waiting on AccessExclusiveLock for accounting.accounts
    applied 20260920000000_accounting_configuration_foundation (108 ms)
    migration transaction committed (108 ms) after the lock was released
-- phase 4: verification
    19 × "PASS …" notices + 1 × "OBSERVED …" notice (listed in Check 3)
REHEARSAL PASSED: migration completed and every verification check passed.
```

Required fixture coverage — **VERIFIED**, both by the runner and by independent
SQL probes executed against the retained database:

| Required case | Fixture | Executed evidence (independent probe) |
|---|---|---|
| **a) three-level coding structure** | `org-multi` (active `csv-multi-v2`, 2+3+3) | config levels `1:2 2:3 3:3` = ACTIVE version's 3 rows; symmetric difference with `csv-multi-v2` = 0 rows; 3 accounts preserved |
| **b) one-level coding structure** | `org-one-level` (`csv-one-v1`, one level, 4 digits) | config levels `1:4` — exactly ONE row, **no `level_index = 2`** |
| **c) no coding structure** | `org-no-config` | no configuration, no accounts, no versions, no levels created (`[PASS] org-no-config untouched`). A fixture with accounts but *no* coding version is **unrepresentable** in the pre-Task-11 schema — VERIFIED by execution: the insert is refused with `23502` (NULL) and `23503` (unknown id); that case is therefore covered by (e) |
| **d) draft configuration** | `org-draft-version` (active 3+2 + unpublished 2+2 draft) | config levels `1:3 2:2` = the ACTIVE version's set; the draft's 2+2 shape was **not** copied (`level1_not_2digits = true`) |
| **e) superseded-only coding versions** | `org-superseded-only` (only version is `superseded`) | config levels `1:2 2:3` — the documented default fallback, reported as `OBSERVED` (OQ-63), never as a silent assumption |

### Check 2 — level structure preservation (especially the one-level case)

**VERIFIED — and proven non-vacuous by mutation (M1c).** Independent probe:

```text
[PASS] one-level structure preserved as exactly ONE level (no level_index 2)   {"observed":"1:4"}
[PASS] org-multi config level set EQUALS the ACTIVE version csv-multi-v2 …      {"config_rows":3,"version_rows":3}
[PASS] org-draft-version config level set EQUALS the ACTIVE version csv-draft-v1 (not the draft) {"level1_not_2digits":"true"}
[PASS] total configuration levels = 8 (3+1+2+2) and no level_index gaps         {"total":8}
```

Mutation **M1c** (the only production file touched, then restored): the ORIGINAL
pre-remediation `COUNT(*)=1` level-2 append was added back verbatim to
`20260920000000_accounting_configuration_foundation/migration.sql`:

```text
M1c_REHEARSAL_EXIT=1
REHEARSAL FAILED: org-one-level legacy configuration has 2 level(s); a ONE-level structure must not be extended
```

→ The check fails for the exact wrong behavior and passes for the correct one.
Restoring the file returns to `REHEARSAL PASSED` (verified).

### Check 3 — `verify.sql`: is it real invariants, and what is each result?

**VERIFIED.** `verify.sql` is 563 lines, **19 `DO` blocks / 19 `PASS` notices + 1 `OBSERVED` notice and 38 `RAISE EXCEPTION` guards**. Every block computes a
value, compares it, and `RAISE EXCEPTION`s on violation — there is no
"query executed successfully" check. It runs inside a transaction the runner
rolls back (the negative probes insert/delete nothing permanently).

Executed results — one line per assertion (verbatim from the run):

| # | Assertion (fails the run when violated) | Result |
|---|---|---|
| 1 | accounts / versions / levels row counts unchanged vs `snapshot_pre` | **PASS** accounts=9, versions=6, levels=12 |
| 2 | per-organization account counts unchanged | **PASS** |
| 3 | every account row identical to the pre-migration snapshot (id, code, title, parent, level, nature, coding version) | **PASS** |
| 4 | no NULL `accounting_configuration_id`, column is `NOT NULL`, every pin same-organization | **PASS** |
| 5 | orphan handling: exactly one LEGACY ACTIVE v1 per organization with accounts; `org-no-config` untouched; every created configuration referenced by ≥1 account and having ≥1 level; `operationally_used_at` set on legacy rows | **PASS** |
| 6 | level preservation: copied sets equal the ACTIVE coding structure (3 / 1 / ACTIVE 3+2); the draft shape was not copied | **PASS** |
| 7 | (OBSERVED, not an assertion of correctness) superseded-only org received the documented 2+3 default | **OBSERVED** — OQ-63 |
| 8 | NULL `accounting_configuration_id` rejected | **PASS** 23502 |
| 9 | unknown `accounting_configuration_id` rejected (FK) | **PASS** 23503 |
| 10 | unknown `coding_structure_version_id` rejected (FK) | **PASS** 23503 |
| 11 | re-pinning an account to an unknown configuration rejected **and** the pin unchanged | **PASS** |
| 12 | deleting a referenced configuration refused (RESTRICT) | **PASS** |
| 13 | deleting a referenced coding version refused (RESTRICT) | **PASS** |
| 14 | partial unique index exists and is `UNIQUE … WHERE … ACTIVE` | **PASS** (indexdef quoted) |
| 15 | a second ACTIVE configuration for one organization rejected; ACTIVE count unchanged | **PASS** 23505 |
| 16 | exactly one ACTIVE configuration per organization | **PASS** |
| 17 | `level_kind` column is 20 wide; a 20-character value is stored verbatim | **PASS** |
| 18 | a 21-character `level_kind` is rejected (22001) — never truncated | **PASS** |
| 19 | migration completion: tables, indexes and foreign keys all exist | **PASS** |
| — | rehearsal summary (5 orgs, 9 accounts, 4 configurations, 8 configuration levels) | **PASS** |

**Non-vacuity of the database probes (mutation-verified):**

| Mutation (restored after) | Expected | Executed result |
|---|---|---|
| **M6** — migration without `fk_accounts_accounting_configuration` | rehearsal FAILS | `REHEARSAL FAILED: expected FK rejection: inserting an account with a non-existent accounting_configuration_id succeeded` |
| **M7** — migration without `uq_accounting_configurations_org_active` | rehearsal FAILS | `REHEARSAL FAILED: partial unique index uq_accounting_configurations_org_active does not exist` |

### Check 4 — the listed review areas

| Area | Evidence | Verdict |
|---|---|---|
| **configuration-specific level validation** | Mutation **M5** (domain `planAccountMovePin` always accepts): `coding-structure-accounts.spec.ts` + `account-placement.spec.ts` → **1 failed**, restored → **62 passed** | **VERIFIED**, non-vacuous |
| **account/configuration compatibility** | Enumerated: no code or constraint compares the two pins; the rehearsal produced a real divergence. Executed consequence (real domain function, temp probe deleted): under the pinned version the sibling code `1001` is accepted; under the LEGACY configuration `1001` → `level_length_mismatch` and only `10001` is accepted | **VERIFIED as unenforced**; registered as **OQ-62** (existing account codes can no longer be used as a child-create template in that organization — materially observable, not cosmetic) |
| **authoritative active coding-version validation** | Mutation **M4** (remove `version.status !== 'active'` from `planRootAccountPin`): `account-placement.spec.ts` → **1 failed**; restored → **31 passed**. Live suite test `item 3: the ROOT write boundary refuses a coding version that is no longer active` calls the real `AccountsRepository.createChecked` with a superseded version and asserts the typed error **and** that no row exists (CI-executed, see Check 8) | **VERIFIED** |
| **levelKind length consistency (API/domain/Prisma/SQL)** | Cross-layer spec + mutations **M9** (migration `VARCHAR(30)`) → `level-kind-contract.spec.ts` **1 failed**; **M10** (`MAX_LEVEL_KIND_LENGTH = 25`) → **2 failed**; **M2** (DTO `@MaxLength(64)`) → DTO spec **2 failed**. Live suite asserts `information_schema` width = 20 and a raw 21-char insert rejected | **VERIFIED**, non-vacuous at every layer |
| **FK-negative tests** | Rehearsal probes #8–#13 above, mutation-verified by **M6**; the repaired live test uses a **control insert** (valid FK id accepted) + the **database state** as the oracle (row must not exist). Executed locally: rehearsal only; live test is CI-executed | **VERIFIED** (DB layer here; app layer by CI) |
| **orphan backfill tests** | 9/9 accounts backfilled, 4 LEGACY configurations created, `org-no-config` untouched, counts/references preserved (rehearsal #1–#5 + independent probes). Mutation **M1b** (invalid splice, discarded) and **M1c** show the harness bites | **VERIFIED** |
| **partial unique-index tests** | Rehearsal #14–#16 executed; mutation **M7** proves the check fails when the index is absent. The repaired live test asserts `pg_indexes.indexdef` **and** attempts a violating raw INSERT with a DRAFT control | **VERIFIED** |

### Check 5 — misleading or vacuous tests

Scans executed: no test block in `src/modules/accounting/**` lacks an assertion;
the two tests repaired during remediation were re-read and each carries a
positive control plus a database-state oracle (an error message is never the sole
evidence). Mutation battery — every one of these **failed for the wrong behavior
and passed for the correct behavior**:

| Mutation (all restored) | Test target | Wrong behavior | Correct behavior |
|---|---|---|---|
| M1c original `COUNT(*)=1` level append | rehearsal | `REHEARSAL FAILED: org-one-level … has 2 level(s)` | PASSED |
| M2 DTO `@MaxLength(64)` | DTO spec | 2 failed / 5 | 5 passed |
| M3 domain `level_kind_too_long` removed | domain spec | 1 failed / 15 | 15 passed |
| M4 `planRootAccountPin` version-status check removed | placement spec | 1 failed / 31 | 31 passed |
| M5 `planAccountMovePin` always accepts | placement + app-level specs | 1 failed / 62 | 62 passed |
| M6 migration without the configuration FK | rehearsal | FK probe FAILED | PASSED |
| M7 migration without the partial unique index | rehearsal | index probe FAILED | PASSED |
| M9 migration `VARCHAR(30)` | level-kind contract spec | 1 failed / 3 | 3 passed |
| M10 `MAX_LEVEL_KIND_LENGTH = 25` | contract + DTO specs | 2 failed / 8 | 8 passed |

**Gap G1 (reported, not repaired — repairing needs a Prisma double):** mutation
**M8** deleted the move-pin refusal from the *real*
`AccountsRepository.updateChecked` and **all 22 accounting unit files / 364 tests
still passed**. The invariant is demonstrated at three other points (domain
function unit tests, the in-memory repository twin used by the app-level
regression, database-level guarantees), and the branch is unreachable through the
service because the service always supplies the account's own pair — but the
real call site itself has **no direct test** in either the local or the CI suite.
Recommended follow-up (documented, out of scope here): a repository-level test
using the established fake-transactional-client pattern
(`src/modules/accounting/data/accounting-documents.repository.spec.ts`).

### Check 6 — `markOperationallyUsed`

**VERIFIED by inspection with executed checks. Classification: INCOMPLETE, but
HARMLESS and honestly documented — not architecturally misleading.**

- Presence: repository seam (`accounting-configurations.repository.ts:396`,
  idempotent read-then-write, **not** transaction-aware) and an application
  method (`accounting-configurations.service.ts:368`); **no production caller**
  (grep over `src/` + `test/`: only specs and the in-memory fake).
- **Not exposed over HTTP** (grep of `src/modules/accounting/api/` → no route).
- The marker **is** read by real guards: service `updateConfiguration` /
  `deleteConfiguration` business rules and repository draft-update/delete guards
  refuse a configuration whose `operationally_used_at` is set.
- The freeze **guard functions** (`assertConfigurationMutable`,
  `assertConfigurationDeletable`, `isConfigurationFrozen`, `resolveFreezeState`)
  have **no production consumer** — grep returns specs only. So the freeze is
  inert until a caller sets the marker.
- No speculative behavior exists (nothing marks, nothing pretends to mark), the
  earlier misleading comment ("called from AccountsService") is corrected, and
  the deferral is recorded in ADR-0028, `configuration.md`, the decision note
  and OQ-64. Live regression asserts the marker stays NULL after account
  creation (CI-executed).
- Residual risk, documented in the decision note: a future caller that invokes
  `markOperationallyUsed` outside the finalization transaction would not
  guarantee the freeze (crash window), and the multi-configuration voucher
  question (§6 of the note) is unresolved — that is exactly why the caller is
  deferred.

**Follow-up decision: OQ-64** (already registered; owner Product + architecture).

### Check 7 — governance artifacts

**VERIFIED**, claim by claim against repository facts (script + runtime probe):

| Artifact | Checks | Result |
|---|---|---|
| `docs/accounting/task-index.md` | Task 11 row (PR #25 + remediation), §3 architecture block, §6 status, §8 follow-ups OQ-62/63/64, §9 history 2026-09-22 | all **PASS** |
| `docs/modules.md` | catalog row, Task 11 section, "Permissions (implemented, 31 codes)" vs **runtime count = 31 with no duplicates**, Task 11 API block, rehearsal reference | all **PASS** |
| `.vardena/project-context.md` | no longer claims "documentation-only"; describes the implemented backend; governance pointers; module inventory | **1 FAIL found and fixed by this pass** (§A), then **PASS** |
| `docs/task-11-implementation-report.md` | sections A–J present; its numbers re-run today: unit 76/926, e2e 15 pass + 8 skip / 189 pass + 45 skip, lint 4 warnings, typecheck clean, format clean; fixture counts 5/6/12/9; rehearsal "PASSED" | all **PASS** (numbers match exactly) |
| ADR / decision references | ADR-0028 remediation addendum present; decision note exists and is referenced from `configuration.md` and ADR-0028; OQ-62…64 registered with assumptions and owners; max OQ id = OQ-64 | all **PASS** |
| factual claims | "13 migrations" = actual 13; "nine modules" = actual 9 module directories | **PASS** after the fix |

### Check 8 — test execution with explicit classification

| Suite | Command | Result | Classification |
|---|---|---|---|
| Unit | `npm test` | 76 files / **926 tests passed** (28.6 s) | **PASS** (executed locally) |
| E2E (non-live) | `npm run test:e2e` | 15 files passed / 8 skipped; **189 passed / 45 skipped** (43.3 s) | **PASS** (executed locally) |
| Migration rehearsal | `npm run test:migration-rehearsal` (KEEP=1) | 19 PASS + 1 OBSERVED notices, exit 0 | **PASS** (executed locally, PostgreSQL 17.10) |
| Live-PostgreSQL e2e (`test/accounting-configuration-live.e2e-spec.ts`, 8 tests) | with `VARDENA_TEST_DATABASE_URL` → fully migrated DB | `Error: Prisma Client has not been generated`; 8 tests skipped; file exit 1 | **NOT EXECUTED** (environment: no Prisma engines; `binaries.prisma.sh` HTTP 000) — and **PASS in CI** (below) |
| Live-DB e2e in the default e2e run | `npm run test:e2e` | 8 live files listed as `↓ skipped` | **SKIPPED** (by design: opt-in via `VARDENA_TEST_DATABASE_URL`) |
| `prisma validate` / `generate` | `DATABASE_URL=… npm run prisma:validate` | `request to https://binaries.prisma.sh/… failed` | **NOT EXECUTED** (environment) — **PASS in CI** |
| Typecheck / lint / format | `npm run typecheck`, `npm run lint`, `npm run format:check` | clean / 0 errors 4 warnings / clean | **PASS** (executed locally) |
| CI | runs `35727571225` (`6ff4f48`, code) and `35728013047` (`f39f1bb`, docs) | `conclusion=success`; **all 15 steps success**, including `Prisma validate`, `Prisma generate`, `Migrate test database`, `E2E tests (incl. live-DB suites)` | **PASS — verifiable CI evidence** (`gh api …/actions/runs/<id>/jobs`) |

CI evidence is quoted from the GitHub API (not from memory), and its limitation is
stated: the per-test stdout of the e2e step could not be retrieved in this sandbox
(`gh run view --log` cannot reach GitHub's log host), so CI test-granularity is
**NOT EXECUTED-as-evidence** here; the step conclusion and the opt-in guard
analysis (job-level `VARDENA_TEST_DATABASE_URL`, so the live specs do not skip)
are the verified part.

---

## D. Remaining risks or gaps

1. **G1 — repository call-site coverage (test gap, not a defect).** Removing the
   move-pin refusal from the real `AccountsRepository.updateChecked` leaves all
   364 accounting unit tests green (mutation M8). The invariant is still guarded
   by the domain function, the in-memory twin and the service contract, and the
   branch is unreachable through the service — but the call site deserves a
   repository-level test. Follow-up task; pattern exists
   (`data/accounting-documents.repository.spec.ts`).
2. **G2 — live-DB layer cannot be re-verified from this sandbox.** The app-level
   wiring (real Prisma client against PostgreSQL) is evidenced by CI step
   conclusions only. Anyone re-verifying locally needs
   `npm run prisma:generate` + `VARDENA_TEST_DATABASE_URL`.
3. **G3 — OQ-62 is materially observable, not cosmetic.** Executed demonstration:
   in `org-superseded-only`, the code shape that matches the account's own pinned
   version (`1001`) is refused under the LEGACY configuration, while `10001` is
   accepted. New child codes under such accounts must follow the configuration,
   not the version. Decision needed before accounts are created in such
   organizations.
4. **G4 — OQ-63:** the default 2+3 fallback for organizations with accounts but no
   ACTIVE coding version is the documented behavior and the rehearsal reports it
   as `OBSERVED`; whether the newest SUPERSEDED version's shape should be derived
   instead remains a product/architecture decision.
5. **G5 — OQ-64 / freeze inert:** `operationally_used_at` is never set in
   production; the freeze promise is unrealizable until the Posting task wires the
   caller inside the finalization transaction (decision note §3/§6).
6. **G6 — rehearsal is not part of CI.** It is run manually (or by a future
   pipeline change); the CI job applies migrations but does not run
   `npm run test:migration-rehearsal`.
7. **G7 — raw-SQL-only partial index drift.** `uq_accounting_configurations_org_active`
   exists only in the migration; a future `prisma migrate dev` regenerating the
   schema from the Prisma models would drop it. Guarded by the live index-definition
   test (CI), the rehearsal (locally) and the comment in `accounting.prisma`.
8. **G8 — this pass found one governance inaccuracy** (module count) and fixed it;
   the same class of error could exist in claims not covered by a check. The
   executable claim checks in Check 7 are the mitigation.

---

## E. Final recommendation

## **ACCEPTED**

Rationale, stated against the acceptance rule ("ACCEPTED only if all critical
invariants are demonstrated by executable evidence"):

- Every critical Task 11 invariant has executed evidence **in this environment**:
  populated-fixture migration rehearsal over a real PostgreSQL (19/19 checks
  PASS + 1 explicitly OBSERVED, exit 0), the one-level structure preserved
  (mutation M1c), the FK RESTRICT / NOT NULL / partial-unique / `level_kind`
  probes (mutations M6, M7), and the pin + length semantics (mutations M2–M5,
  M9, M10).
- Every test that guards those invariants was shown to **fail for the wrong
  behavior and pass for the correct behavior** — the tests are not vacuous.
- The application/HTTP layer (real Prisma client) is verified by CI runs whose
  step-level outcomes are verifiable through the GitHub API (`35727571225` on the
  code commit and `35728013047` on the documentation commit: all 15 steps
  success, including the live-DB e2e step, with the live suites enabled by the
  job-level `VARDENA_TEST_DATABASE_URL`).
- Governance artifacts are accurate, complete and cross-referenced; the one
  inaccuracy found by this pass was corrected.
- The three open questions (OQ-62/63/64) are documented decisions with owners,
  explicitly deferred rather than guessed, and none of them leaves a critical
  invariant unprotected.

The gaps in §D are coverage/maintenance items (G1, G2, G6, G7) and open product
decisions (G3, G4, G5) — not evidence that a Task 11 invariant fails. They are
recorded with concrete follow-ups so acceptance does not hide them.
