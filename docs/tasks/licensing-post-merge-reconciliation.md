# Licensing slice — post-merge audit, reconciliation and verification (PR #137)

> **Current-tree reconciliation (2026-10-14):** at `main`
> `05933588fad3f1cb76475d48c3f9586ec32494df`, L-05 (#146), F-12's core
> bootstrap/forced-change flow (#149), and L-06 (#150; #151 shares its merged
> commit) exist. Earlier outstanding-feature/credential-policy statements below
> are historical. The remaining F-12 credential-transition defects and their
> corrective slice are recorded in
> [the repository-first task record](f-12-credential-transition-correction.md).
> OQ-83 remains open; no device policy or Owner acceptance is inferred.

| Field | Value |
| --- | --- |
| Date | 2026-10-11 (UTC) |
| Scope | The merged first Licensing vertical slice (L-03: signed-file import, installation binding, retained versions, effective-version resolution, supersession hand-over, concurrency, migrations, frontend license gate and renewal card). |
| `main` inspected | `345047abec5a6af6760b05ad36b570ee5ed3a5f9` (merge commit of PR #137). Parents: `f27065149ffcb3b6d62929e418a8c6c1b4ce8fea` (`main` before, PR #136 merge) and `2ecd8396f0edcc1c34b3724c79cd767b3401c96d` (PR #137 head). |
| Session branch | `arena/f0ddc379-vardena` (created from `345047a`; did not exist on origin before this audit). |
| Merge state of this report's fixes | **Merged 2026-10-12 as PR #138, merge commit `d283744b4098346b6ef2e0b91922266f10cdabd1`, merge-commit CI green (run `38210710188`).** Everything below was written while the branch was still unmerged: where §3–§13 say "on this branch", read `d283744`. See §14. |
| `main` at the original latest verification (before PR #142) | `d283744b4098346b6ef2e0b91922266f10cdabd1` (PR #138 merge). This is a historical baseline, not the current tip; the post-PR #142 `main` state is recorded in §16. |
| Owner acceptance | **Not given.** Nothing in this record accepts the slice, any OQ answer or any §15 policy. |
| Product policy | **No product decision is taken here.** OQ-80 and OQ-86 stay OPEN (decision brief: `docs/tasks/licensing-oq-80-oq-86-decision-brief.md`). |

Three states are kept apart throughout: **merged** (on `main`), **technically verified** (executed and passing, with the evidence named), and **Owner-accepted** (not yet — no Owner acceptance is recorded anywhere).

---

## 1. Baseline and PR #137 identity (verified with `gh` and `git ls-remote`, 2026-10-11)

- `git ls-remote origin refs/heads/main` → `345047abec5a6af6760b05ad36b570ee5ed3a5f9`.
- PR #137 (`Licensing L-03: PDR-11 reconciliation + signed-file import slice …`): `state=MERGED`, `mergedAt=2026-10-11T20:10:51Z`, `mergedBy=MR-AliEsmaeili`, `mergeCommit.oid=345047abec5a6af6760b05ad36b570ee5ed3a5f9`, `headRefOid=2ecd8396f0edcc1c34b3724c79cd767b3401c96d`, base `main`, head branch `arena/5fd62737-vardena`.
- The merge commit's tree is identical to the PR head's tree (verified in the earlier audit pass; the merge added no content beyond the PR head).
- Stale "unmerged" statements were found in `STATE.md` §32 and `docs/tasks/pdr-11-conflict-reconciliation.md`. They are reconciled in §8.

## 2. Post-merge CI evidence

This table is the evidence for the **PR #137** merge commit `345047a`. The CI evidence for the **PR #138** merge commit `d283744` — the commit that actually carries this report's fixes onto `main` — is in §14.2.

| Item | Run / job | Event and SHA | Result | Use as evidence |
| --- | --- | --- | --- | --- |
| **Merge commit** (the only CI result that verifies `main`) | run `38171112633` (`CI`) | `push` to `main` at `345047a` | `completed / success` | **Yes** — verifies `main` |
| merge commit, backend job | job `114563738873` | `345047a` | `success`, 27 steps | Yes. Steps: Prisma validate, Prisma generate, Lint, Typecheck, Format check, Unit tests, Build, Migrate test database, Bootstrap system administrator, Inventory BusinessDate live suite (Asia/Tehran), Inventory BusinessDate live suite (America/Los_Angeles), Migration rehearsal (populated pre-Task-11 data), Migration rehearsal (Inventory BusinessDate validity windows), Migration rehearsal (Licensing version model and import), E2E tests (incl. live-DB suites) — all `success` |
| merge commit, frontend job | job `114563738695` | `345047a` | `success`, 13 steps (Lint, Typecheck, Format check, Tests, Build) | Yes |
| PR head run | run `38169633397` | `pull_request` at `2ecd839` | `success` | **Not** merge-commit evidence. Recorded for history only. |
| earlier PR head | run `38169257077` | `pull_request` at **`df41f735a206581c601f28a179b378dd8f2da0bf`** (branch `arena/5fd62737-vardena`) | `success` (re-verified) | Only for `df41f73`. Not evidence for any other SHA. |

**Gaps in the CI evidence (stated, not hidden):**
- Per-test counts for the merged CI run cannot be quoted from the sandbox: the Actions log blob host is not reachable from here. Only step- and job-level conclusions are cited.
- The legacy combined-status endpoint for `345047a` reports `pending` with zero statuses. This repo's checks are Actions check runs, and the check-runs API reports `backend: success` and `frontend: success`. The legacy endpoint is not used as evidence.
- CI has no step that checks the generated OpenAPI client is in sync with the backend. That gap is what allowed `frontend/src/api/generated/vardena-api.d.ts` to fall behind (finding F-5, §6).

## 3. Gaps A and B — live probe (pre-fix), and the fix

A scratch live probe ran against PostgreSQL 16.4 on the **unfixed** `345047a` code. Its output is `/tmp/probe.log`. The scratch file was deleted from the repository; its assertions were not kept.

- **Gap B — re-binding a license to another customer (confirmed).** Two signed documents shared `licenseId` `01PROBELICENSE00000000001`: the first for customer A, the second (a renewal) for customer B. Result: `PROBE1 renewal result: applied`. The license row then read `customer_id = 01PROBECUSTOMERB0000000002` ("Customer B"). Both retained versions read through the license join, so the version imported for A was attributed to B. This contradicts PDR-11 §2.1 ("bound to one customer and to one server installation").
- **Gap A — a `licenseId` owned by another installation (confirmed).** A foreign license `01PROBEFOREIGNLICENSE00001` (owned by another installation, customer Z), then a new version for it. Result: `PROBE2 result: THREW PrismaClientKnownRequestError code=P2003`, FK `license_versions_license_id_installation_id_fkey`, model `LicenseVersion`. `PROBE2 licenses unchanged: true`; no version written. The global filter maps a non-`AppException` to a generic 500 `InternalError`. A probe run lost one piece of output to a field access in the probe itself; that does not affect the product results above.

**Decision and fix (on `arena/f0ddc379-vardena`).** A license is bound to one customer and one installation, so a conflicting identifier is refused, not re-bound. The approved contracts settle that a conflict is refused with nothing written; they do not name the HTTP reason. The 409 family (ADR-0046: retained-state conflicts) is the closest approved class. One new reason is therefore added: **`license-binding-conflict`, 409, nothing written.** This is an interpretation for Product Owner ratification (§9).

Implementation:
- `backend/src/modules/licensing/domain/license-version.ts` — new reason; rule 2a in `evaluateImportConflicts`: same `licenseId` retained for this installation under a different `customerId` → conflict. Applies to renewals and to explicit supersessions alike.
- `backend/src/modules/licensing/data/licenses.repository.ts` — the candidate carries `licenseId` and `customerId`; **rule 2b**: under the installation lock and before any upsert, `tx.license.findUnique` reads the license; if it belongs to another installation or another customer, `ImportConflictError({reason:'license-binding-conflict', overlapping:0})` is thrown and the transaction rolls back.
- `backend/src/modules/licensing/application/license-import.service.ts` — reason added to the rejection union and to the 409 set; one shared message (`LICENSE_BINDING_CONFLICT_MESSAGE`) in the signed, legacy and lost-race paths.
- `backend/test/support/licensing-repositories.ts` — the in-memory store refuses a cross-installation identifier the same way.
- The frontend needs no change: `license-import-errors.ts` maps every 409 to the retained-state conflict message.

**Post-fix evidence (executed in this session, see §4):** domain unit tests (`license-version.spec.ts`: different customer refused; explicit supersession cannot re-bind; same-customer renewal still accepted); service unit test (`license-import.service.spec.ts`: "refuses a renewal that re-binds the license to another customer as a 409, and keeps the customer" — 409, `already bound to a different customer`, one version, customer unchanged, audit `license-binding-conflict`); live PostgreSQL tests (`licensing-persistence-live.e2e-spec.ts`: "refuses a renewal that re-binds a license to another customer, and keeps the customer" and "refuses a license identifier that another installation owns, as a conflict and not a database error" — 409, `customer_id`/`installation_id` unchanged, no `license_versions` row for the refused operation, audit row present).

The post-fix live suite runs on the real database, and the pre-fix probe outcomes (applied re-bind; P2003) are the behaviour these tests would have failed on. A red-before-green run on the unfixed code was **not** executed in this session; the pre-fix probe output is the recorded red evidence.

## 4. Local verification executed in this session

**Environment and substitutions (not CI parity):**
- Node/npm from the sandbox; **no Docker** available, so the Compose path was not run (see §7 for the Owner's checklist).
- PostgreSQL 16.4 from `@embedded-postgres/linux-x64@16.4.0-beta.13` (npm), running on `127.0.0.1:5432` from `/tmp/pgtools`. It is not the CI service container.
- The Prisma schema engine and query engine binaries cannot be downloaded (`binaries.prisma.sh` is not on the allowed-host list). `prisma validate` and `prisma generate` ran with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true PRISMA_QUERY_ENGINE_LIBRARY=/bin/true`.
- `prisma migrate deploy` was replaced by `/tmp/pgtools/apply-migrations.mjs`, which applies the same 34 `migration.sql` files in lexical order and records them in `_prisma_migrations`. Checksum fidelity with Prisma is therefore not established locally; CI's migrate step is the authority for that.
- `prisma generate` overwrote the tracked stub `backend/src/generated/prisma/client.ts`. It is restored with `git checkout` before any commit (§5).

**Results (all on the final working tree of this branch; "pre-fix" entries are noted where they differ):**

| Check | Command | Result |
| --- | --- | --- |
| Backend typecheck | `npx tsc --noEmit` (against the regenerated client) | rc 0 (`/tmp/tc-final.log`) |
| Backend lint | `npm run lint` | rc 0; 1 warning, pre-existing, in `src/modules/accounting/application/coding-structure-accounts.spec.ts` (not in licensing) |
| Backend format | `npm run format:check` | rc 0 |
| Backend unit | `npm test` | **147 files, 1962 of 1962 passed** (was 1958 before this fix) |
| Backend licensing unit | `vitest run … src/modules/licensing` | **8 files, 115 of 115 passed** |
| Backend licensing live + e2e | `vitest run … test/licensing-persistence-live.e2e-spec.ts test/licensing.e2e-spec.ts test/license-import.e2e-spec.ts test/license-state-route.e2e-spec.ts test/licensing-activation.e2e-spec.ts test/licensing-limits-live.e2e-spec.ts` | **6 files, 55 of 55 passed** (persistence-live: 12, up from 10) |
| Backend full e2e | `vitest run --config vitest.config.e2e.ts` | **51 files, 616 of 616 passed** (was 614; the two new live cases) |
| BusinessDate live (Asia/Tehran) | `TZ=Asia/Tehran vitest … inventory-business-date-writes-live + inventory-business-documents-live` | **2 files, 24 of 24 passed** |
| BusinessDate live (America/Los_Angeles) | same, `TZ=America/Los_Angeles` | **2 files, 24 of 24 passed** |
| Migration rehearsal (populated pre-Task-11) | `npm run test:migration-rehearsal` | rc 0 — "REHEARSAL PASSED" |
| Migration rehearsal (BusinessDate validity) | `npm run test:business-date-validity-rehearsal` | rc 0 — "PASS" |
| Migration rehearsal (Licensing version model) | `npm run test:licensing-version-rehearsal` | rc 0 — "Migration rehearsal passed." (includes the preserved-state assertions) |
| Operational-freeze rehearsal | `npm run test:operational-freeze-rehearsal` | rc 0 — 5/5 checks |
| Bootstrap, fresh database | migrations applied to an empty database, then `npm run bootstrap:system-admin` twice | rc 0 both runs; second run is a no-op (`/tmp/bootstrap-fresh-*.log`); scratch database dropped |
| Backend build | `npm run build` | rc 0 |
| Frontend typecheck, lint, format | `npm run typecheck`, `npm run lint`, `npm run format:check` | rc 0 each (after the generated-type refresh) |
| Frontend tests | `npm test` | **56 files, 397 of 397 passed** |
| Frontend build | `npm run build` | rc 0 |
| OpenAPI capture | built API booted against the test database; `GET /api/docs-json` → 200, 193 paths, the three `/api/v1/license/*` paths present | `/tmp/openapi.json` (not committed) |

**Known non-results:**
- The scratch probe was not re-run after the fix. The live suite now asserts the same outcomes against the same database, and the pre-fix output is recorded in §3.
- `bootstrap:system-admin` on the shared test database returned rc 1 ("The installation license active-user limit has been reached.") because a previous test run had left an active license at its user limit. This is the designed refusal for creating a user at capacity (PDR-11 §8.3). A fresh database (the Compose case: UNLICENSED, bootstrap allowance) returned rc 0. Recorded as finding F-11.
- Lock-wait timeout behaviour (ADR-0046 D11, 10 s) is implemented as a server error, which matches the ADR, but no test exercises the timeout path (finding F-10).

## 5. Merged-slice audit (requirement by requirement)

| Area (scope item) | Evidence | Result |
| --- | --- | --- |
| Signed-file import and installation binding | `license-import.service.spec.ts` — "rejects a document issued for another installation" (422, nothing written); "imports a signed file, retains the version and records the audit event"; unit `license-document.spec.ts` (14). Live: "rejects a license bound to another installation against the real database". | **Verified** (unit, hermetic e2e `license-import.e2e-spec.ts`, live PostgreSQL) |
| Installation binding — cross-customer and cross-installation identifiers | §3 (Gaps A/B) and the new tests. | **Defect found and fixed on this branch** (F-1, F-2) |
| Retained versions and entitlements | Migration `20261014000000_licensing_version_model_and_import`; live "persists the identity and the retained version across a restart"; rehearsal preserved-state assertions. | **Verified** (local PG 16.4 + rehearsal; CI migrate and rehearsal steps `success` on `345047a`) |
| Effective-version resolution and scheduled renewals | `license-version.spec.ts` (36 tests incl. `resolveEffectiveVersion`); service: "retains a future-dated renewal without deactivating the current version", "keeps the current license governing while the successor is still future-dated"; live: "retains a signed future-dated version and resolves it by date". | **Verified** |
| Duplicate operation handling and audit | Service: "rejects a duplicate operation and keeps the retained version untouched"; live: "refuses a duplicate operation inside the transaction and writes nothing", "refuses a duplicate operation at the database level", "applies a replayed document exactly once under concurrency". Audit rows: `license.import.rejected` with reason, `applied` events. | **Verified** |
| Supersession hand-over — future-dated | Service: "applies a supersession whose hand-over is the import instant itself"; "lets exactly one of two concurrent successors retire a version" (live); `governs_until` set to successor `validFrom` (`20261015000000_licensing_supersession_governs_until`). | **Verified** |
| Supersession hand-over — backdated | Service: "refuses a successor that would hand over before the import instant" (422, nothing written). **Not covered:** a *non-superseding* backdated document that overlaps a retired version's past window (Gap C, F-3). | **Verified for supersession; open policy gap for non-superseding backdated documents (OQ-80/OQ-86)** |
| Concurrent import serialization and rollback | Live: "commits exactly one of two concurrent imports with the same window", "rolls a LATE failure back completely (no partial write)", "lets exactly one of two concurrent successors retire a version". Lock: `SELECT … FOR UPDATE` on the installation row, READ COMMITTED, re-run of the evaluation under the lock. | **Verified** (local live PG 16.4 and CI live suite on `345047a`) |
| Migration ordering and rehearsal | Ordered names `20261014…` then `20261015…`; rehearsals pass locally (§4) and in CI. | **Verified** locally and in CI; the licensing migrations ship no down script (F-13) |
| Legacy-data preservation | Migration backfills every existing license row; rehearsal "preserved state assertions passed". The rehearsal uses **synthetic** fixtures; no production data was inspected. | **Verified on fixtures only** |
| Frontend license-gate refresh | `license-import.test.tsx` — "releases the gate only on the backend-confirmed re-read"; `license-gate.test.tsx` — "stops before organization bootstrap when the license is inactive"; success invalidates `queryKeys.licenseState()` only. | **Verified** (hermetic unit tests, 397/397) |
| Dashboard renewal | `license-import.test.tsx` — "shows the scheduled renewal on an active installation and imports the next version without interrupting work"; `LicenseStatusCard` self-gated on `Licensing.License.Activate`. | **Verified** (component tests) |
| API / OpenAPI contract consistency | Live OpenAPI capture (§4). `/license/import` and its DTO were **missing** from the committed generated client (`frontend/src/api/generated/vardena-api.d.ts`) — regenerated (F-5). `GET /license/current` 200 has **no schema** in the document (F-6). | **Gap found; import route fixed; current-state schema gap open** |

## 6. Findings

Classification: **Blocker** = must be fixed or formally accepted before the slice is treated as accepted; **Important** = a real gap that needs a fix or a recorded decision; **Minor** = low impact or documentation; **No issue** = checked, no finding.

Statuses were re-read against the merged tree at `d283744` on 2026-10-12 (§14): every row marked *Fixed* is present on `main`; every row marked *Open* is still open there.

| ID | Class | Status | Finding | Evidence / action |
| --- | --- | --- | --- | --- |
| F-1 | Important | **Fixed — merged in PR #138 (`d283744`)** | A renewal naming an existing `licenseId` with a different customer was applied and re-attributed every retained version. | §3; rule 2a + rule 2b; tests in §4. |
| F-2 | Important | **Fixed — merged in PR #138 (`d283744`)** | A `licenseId` owned by another installation surfaced as an unmapped database FK error (HTTP 500), not a documented refusal. | §3; rule 2b under the lock; live test; 409. |
| F-3 | Important | **Open — Owner decision (OQ-80 / OQ-86)** | A **non-superseding** backdated document whose window overlaps the past governed window of a version that a later supersession retired is **accepted**. The as-of read for that period then reports `ambiguous`. ADR-0046 D4 says effective windows are pairwise disjoint after every import. The existing unit test "never counts a superseded version as an overlap" pins the implemented rule. | Verified by a scratch spec on the unfixed code: retired R (2026-01-01, superseded by S at 2026-12-01), backdated N (2026-03-01 → 2026-06-01) imported 2027-01-15 → accepted; `resolveEffectiveVersion` at 2026-04-01 → `ambiguous`. Code reading: the overlap rule considers only versions still eligible at the import instant, so a document that covers the present or the future is refused; the observable effect is on past instants, which no current API exposes. **Not changed** — choosing between the D4 wording and the implemented rule is the OQ-86 decision. The recorded text is in `version-model-and-file-exchange.md` §3.5. |
| F-4 | Important | **Open — Owner question** | An applied import overwrites the **installation's** `customerId` (`tx.installation.update`), including when the new license names a different customer. PDR-11 §2.1 says a customer owns one or more installations but does not say whether an installation can change customer. | `licenses.repository.ts` (installation update). Not changed. Recorded in the decision brief (Q4). |
| F-5 | Important | **Fixed (follow-up round, 2026-10-12) — merged in PR #138 (`d283744`)** | The committed generated client declared the import endpoint's 200 response as `content?: never`, although the endpoint returns a JSON receipt. First pass (2026-10-11) added the path; the follow-up gives the response a schema (`LicenseImportResultDto`) and regenerates. | §13. The diff is additive: three component schemas and the import 200 content. |
| F-6 | Important | **Partially fixed (2026-10-12)** | The import response now has a schema. `GET /api/v1/license/current` and `POST /api/v1/license/activate` still document a 200 response with **no content schema**; the frontend hand-restores `LicenseState` in `contracts.ts`. | §13. The same DTO pattern applies to those two routes; left open to keep this round to the import contract. |
| F-7 | Important | **Open — process** | No CI step verifies that `frontend/src/api/generated/vardena-api.d.ts` matches the backend's OpenAPI document. | Recommended: a CI step that boots the API (or uses a committed OpenAPI snapshot) and fails on drift. Not added here (CI change is a separate, reviewable slice). |
| F-8 | Important | **Open — Owner question** | The issuer CLI always generates a **new** `licenseId` (`buildLicensePayload` → `options.licenseId ?? generateId()`) and has no option to target an existing license. A renewal through the CLI therefore never shares a `licenseId` with the license it renews. The rule in F-1/F-2 can be reached only by a document the trusted authority signs deliberately (or by a hand-built document). | `backend/src/issue-development-license.ts` (options: `--customer`, no `--license-id`). Whether renewals keep the license identity is an Owner decision (decision brief Q3). Documentation corrected in `licensing-architecture.md` to reference this finding. |
| F-9 | Minor | **Fixed (documentation) — merged in PR #138 (`d283744`)** | `docs/licensing-architecture.md` documented CLI flags the parser does not accept: `--file-out` (the parser reads `--out`), `--operation` (`--operation-id`), `--legacy-code` (`--format v1`). Following the documented command would not have written the file. | Corrected in the same document; the binding refusal is also described there. |
| F-10 | Minor | Open (test gap) | No test exercises the 10 s lock-wait timeout (`LOCK_WAIT_TIMEOUT_MS`). Behaviour matches ADR-0046 D11 (server error, nothing written). | Add a deterministic test in a later slice; not a contract defect. |
| F-11 | Minor | Open (observation) | Bootstrap refuses to **create** the system administrator when an active license is already at its user limit (designed refusal, PDR-11 §8.3, loud failure by design). This surfaced on the shared test database. A fresh database (Compose's first run) passes, and re-running bootstrap is a no-op. | `bootstrap:system-admin` on the shared database rc 1; on a fresh database rc 0, second run rc 0. No change. |
| F-12 | Blocker for any non-development deployment; pre-existing, out of this slice | Open | The initial administrator's password is the documented constant `1` (`README.md`, bootstrap service), with no forced change (the README says so). | Documented limitation, not introduced by PR #137. Must be resolved before any deployment beyond local development. Owner/security decision on the remediation path; no change made here. |
| F-13 | Minor | Open (operational) | The two licensing migrations (`20261014…`, `20261015…`) ship **no down script**; a rollback therefore means restoring a pre-deployment backup. | Include a pre-migration backup in the Owner checklist (§7). |
| F-14 | Minor | Open (process) | Local live results are from PostgreSQL 16.4 binaries and `apply-migrations.mjs`, not from the CI service container and `prisma migrate deploy`. | The merge-commit CI run is the authority for those checks. |
| F-15 | No issue | — | Frontend license gate: a successful import never promotes the response into the cache; the gate releases only on a backend-confirmed `active` re-read (tested). | `license-import.test.tsx`, `license-gate.test.tsx`. |
| F-16 | No issue | — | Merged-slice concurrency and rollback: exercised on a real PostgreSQL 16.4 instance locally and in CI (`345047a`). | §5. |
| F-17 | No issue | — | Backend lint warning is in an unrelated accounting spec and predates this slice. | §4. |

**Blocker summary:** no blocker in the *code* of the merged slice after the fixes above. F-12 is a blocker for any deployment beyond local development and is pre-existing. The slice is not Owner-accepted.

## 7. Owner smoke-test checklist (local Docker / API / frontend)

Not executed by the agent: no Docker in the sandbox. Each step lists the expected result from the code and docs. Record the outcome of each step.

**Prerequisites**
1. Docker with Compose. From the repo root, `docker compose up --build` (or `docker-compose up --build`). The stack: PostgreSQL 16, `migrate` (runs `prisma migrate deploy` and the bootstrap), `api` on `http://localhost:3000`, `worker`.
2. **Back up first** if this database holds anything you need: `docker compose exec postgres pg_dump -U vardena vardena > pre-licensing.sql`. The licensing migrations ship no down script (F-13).

**Steps**
3. Check the stack. `curl http://localhost:3000/api/v1/health/live` → 200. `migrate` exits 0 (`docker compose ps`). Expected: the migrate log shows `20261014…` and `20261015…` applied and the bootstrap complete.
4. Log in as the documented administrator (`README.md`: username `مدیر`, password `1`). **Change the password immediately** (F-12). Expected: a session cookie; `GET /api/v1/auth/me` returns the user.
5. Read the license state: `GET /api/v1/license/current` (authenticated). Expected on a new installation: `UNLICENSED`, the installation id present, no key or signature anywhere in the response. **Copy the installation id.**
6. Frontend: `cd frontend && npm install && npm run dev` (dev server proxies `/api` to `http://localhost:3000`, see `frontend/README.md`). Open the printed URL, log in. Expected: the license screen ("this installation has no license yet") quoting the installation id — not the "inactive" screen.
7. Issue a **development** license (never on a production host). `npm run license:keygen` (keep the private key out of the repo). Set `LICENSE_SIGNING_PUBLIC_KEYS` to the public key in `.env` (or the compose environment for `api` and `worker`), then `docker compose up -d --build api worker`. Issue:
   `LICENSE_SIGNING_PRIVATE_KEY=<private> npm run license:issue -- --installation <id> --customer-name "Smoke customer" --users 5 --modules organization,users --valid-from <now-ish> --valid-until <next-year> --out smoke-1.vlic`
   (`--out`, not `--file-out`; see F-9.)
8. Import through the UI: choose `smoke-1.vlic` in the import form. Expected: the gate releases only after the re-read; the dashboard shows the license; `GET /api/v1/license/current` shows `ACTIVE`, the effective version and the entitlements.
9. **Replay:** import `smoke-1.vlic` again. Expected: an "unchanged receipt" (the frontend test's wording) — no new version; `GET /api/v1/license/current` retains one version.
10. **Overlap:** issue a document for the same installation with an overlapping window and no `--supersedes`. Expected: refused with a retained-state conflict (409 `overlapping-range`); nothing written.
11. **Re-binding (F-1):** issue a document with the *same `licenseId`* but another customer. The CLI cannot choose `licenseId` (F-8), so this step needs a hand-built document signed by the same key. Expected: 409, `license-binding-conflict`, the customer on the license unchanged, nothing written.
12. **Tamper and foreign installation:** edit one character of `smoke-1.vlic` → refused (422, signature). Issue for a different installation id → refused (422, "different Vardena installation"). Expected: nothing written in either case.
13. **Scheduled renewal:** issue a future-dated renewal (`--valid-from` next month, no `--supersedes`) and import it. Expected: the current version still governs; the dashboard shows the scheduled renewal.
14. **Restart:** `docker compose restart api`. Expected: the license state is unchanged and the file is not re-entered.
15. **Known limits to note, not to test as pass/fail:** the Gap C scenario (backdated non-superseding document), F-4 (installation customer changes with the license) and F-8 are open Owner questions — see the decision brief.

Record the results, the installation id (not a secret), the migration log lines and any unexpected 500 responses. Any 500 from steps 8–13 is a defect to report.

## 8. Reconciliation of records (what changed and why)

| Record | Change |
| --- | --- |
| `STATE.md` §32 | "Implemented on `arena/5fd62737-vardena` … unmerged at the time of writing" → merged to `main` at `345047a` (PR #137), CI on the merge commit recorded; post-merge verification and the new reason added; "Next gate" changed from "review of PR #137 on its head" to the Owner decisions and acceptance that remain. Acceptance remains the Owner's. |
| `docs/tasks/pdr-11-conflict-reconciliation.md` | Status row and a new §6 "Post-merge verification (2026-10-11)" listing F-1…F-17 and the new reason. The existing per-matrix rows are unchanged; OQ-80/OQ-86 stay OPEN. |
| `docs/decisions/product/PDR-11-vardena-licensing-product-requirements.md` §19.4 | Post-merge addendum: merged state, the new 409 reason for PO ratification, OQ-80/OQ-86 evidence. No decision text in §1–§18 changed. |
| `docs/adr/0046-…md` | Addendum on the license binding (Decision 2 enforced for identifiers), cross-referencing `version-model` §3.5. |
| `docs/licensing/version-model-and-file-exchange.md` | §3.5 (binding; the OQ-86 known behaviour); the reason lists in §3.4 and the §4 pipeline table (step 10) updated for `license-binding-conflict`. |
| `docs/licensing-architecture.md` | Corrected CLI flags (F-9); binding refusal sentence added; reference to F-8. |
| `docs/open-questions.md` | Historical-log entry for this audit; evidence notes on OQ-80 and OQ-86. **Status of every OQ unchanged (OPEN).** |
| `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` | New: the decision brief (no decision). |
| `frontend/src/api/generated/vardena-api.d.ts` | Regenerated from the live document (additive; F-5). |
| `backend/src/generated/prisma/client.ts` | **Not committed** — restored to the tracked stub (§5 of the workflow). |

## 9. Items for Product Owner ratification

1. **The new 409 reason `license-binding-conflict`** (F-1, F-2). The approved PDR-11/ADR-0046 texts settle that the conflict is refused with nothing written and that the license is bound to one customer and installation; they do not name the reason or its HTTP class. This was placed in the existing 409 family (ADR-0046 retained-state conflicts). Ratify the name and the class, or direct a different reason.
   **RATIFIED (2026-10-12):** the Product Owner ratified the reason as `license-binding-conflict`, in the 409 family, with the "nothing is written" guarantee. Recorded in `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §7/§8.5.
2. **OQ-80 and OQ-86** — **DECIDED (2026-10-12):** overlap = Option B, gap = G2, OQ-86 = Option C, legacy `VLIC1` restriction preserved, tolerance strict, as-of reads recomputation. Recorded verbatim in the decision brief §7/§8. Implementation is recorded in the same change; Product Owner acceptance remains outstanding. **CI status (2026-10-12): verified on the branch's head `68d50517c2d2888f38f10ca1a615f05ce19b7fe0` — run `38239438399`, `completed / success`.**
3. **F-4 and F-8** — installation customer change and renewal identity (decision brief Q3 and Q4). **Q4 DECIDED (2026-10-12):** an installation's commercial customer may change only through an explicit, authorized, audited operation (never inferred from a document); implemented in this change. **Q3 DECIDED (2026-10-12):** a renewal keeps the same `licenseId`; the issuer tooling change (F-8's `--license-id`) is **not** part of this change and remains an open follow-up.
4. **F-12** — the initial administrator credential is a documented constant. Not a licensing item, but it blocks any non-development deployment. **Still open.**

## 10. Files changed on this branch

| File | Rationale |
| --- | --- |
| `backend/src/modules/licensing/domain/license-version.ts` | Rule 2a; new reason; candidate carries `licenseId`/`customerId`. |
| `backend/src/modules/licensing/data/licenses.repository.ts` | Candidate fields; rule 2b under the lock; `findUnique` on the license delegate. |
| `backend/src/modules/licensing/application/license-import.service.ts` | Reason in the 409 set; shared message in the three wording paths. |
| `backend/src/modules/licensing/api/license-import.controller.ts` | 409 description lists the new case (OpenAPI text only). |
| `backend/src/modules/licensing/domain/license-version.spec.ts` | Domain tests for re-binding and same-customer renewal. |
| `backend/src/modules/licensing/application/license-import.service.spec.ts` | Service test: 409, message, one version, customer unchanged, audit. |
| `backend/test/support/licensing-repositories.ts` | In-memory store refuses a cross-installation identifier. |
| `backend/test/licensing-persistence-live.e2e-spec.ts` | Two live cases on real PostgreSQL. |
| `frontend/src/api/generated/vardena-api.d.ts` | Regenerated from the live OpenAPI (additive). |
| `docs/licensing-architecture.md` | CLI flags corrected; binding sentence. |
| `docs/licensing/version-model-and-file-exchange.md` | §3.5; reason lists. |
| `docs/adr/0046-signed-license-documents-and-version-lifecycle.md` | Addendum. |
| `docs/tasks/licensing-post-merge-reconciliation.md` | This report (new). |
| `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` | Decision brief (new). |
| `docs/tasks/pdr-11-conflict-reconciliation.md`, `docs/decisions/product/PDR-11-…md`, `STATE.md`, `docs/open-questions.md` | Reconciliation (§8). |

Not changed: any OQ status; any §15 policy; any migration; the accepted architecture; the frontend source (no change was needed for the new reason).

## 11. Recommended next Licensing slice (not started)

**Candidate: L-04 — capacity-change conflicts (PDR-11 §8.3, §8.4, §8.6).** Rationale: §8.3 (user capacity at limit blocks creation) is already implemented for activation and organization creation (`LicensingService.assertCanActivateUser`, `assertCanCreateOrganization`). §8.4 (reduction: the administrator deactivates excess users) and §8.6 (check, explain, preserve, require resolution before a reducing version is applied) are **not** implemented — the import does not compare a new version's capacity with current usage. PDR-11's own table row 59 marks the §8.6 algorithm "design item (§16)".

- **Dependencies / decisions required first:** (a) whether a capacity-reducing version takes effect at its `validFrom` with a conflict state, or is held until the administrator resolves the excess (§8.6 wording admits both readings); (b) which version's capacity applies on a given day, which depends on OQ-80 for overlapping and gapped windows; (c) F-8 — renewal identity; (d) the deactivation semantics for excess users (§8.4, existing user lifecycle).
- **Backend:** a read-only conflict evaluation on import; a conflict state in the license state read; an explicit resolution command (deactivate chosen users) that is audited; creation blocked while a conflict is unresolved. **DB:** likely a conflict record or state table (new migration, rehearsal required). **Frontend:** explanation and a resolution list in the licensing stage. **Security/audit:** every deactivation attributed to the administrator and audited; no automatic deactivation.
- **Tests/CI:** domain unit tests for the conflict evaluation; service tests for each resolution path; live PostgreSQL tests for concurrent creation during a conflict; migration rehearsal; frontend component tests.
- **Out of scope:** Grace/Read-Only enforcement (OQ-45, durations undecided), revocation (OQ-78), replacement (OQ-82), device quota (OQ-83), signed receipts (OQ-84), the Owner-side system (OQ-85), and any policy in §15 that is still undecided.

**Do not start L-04 until the Owner has decided (a) and (b) above.** The alternatives are blocked by undecided policy: revocation, Grace/Read-Only and replacement each depend on OQ-45, OQ-78 or OQ-82.

> **Update (2026-10-12): the gate is lifted and L-04 is implemented.** The Owner decided OQ-87 = **Option B** ([PDR-13](../decisions/product/PDR-13-post-gap-recovery.md), decision id **OD-LIC-02**), which was the last open decision in this slice's dependency set ((b) via the OQ-80 round; (a) resolved as implemented: a conflicting reduction is refused 409 `reduction-requires-resolution` with a structured explain payload and applies only through the dedicated `reduction-resolution` operation — the conflict state is the refusal itself, no conflict table; (c) Q3 was decided same `licenseId`; (d) §8.4's existing deactivation lifecycle is untouched — no automatic deactivation exists and none was added). §11's machinery sketch above was written before those decisions; the implemented shape differs (usage counts under allocation locks instead of a conflict-state table; the explain payload instead of a preview) and is authoritative — see PDR-13 §5 and the PR.

## 12. Limitations of this audit

- No Docker; the Compose path and the browser smoke test were not executed (§7 is the Owner's checklist).
- Local PostgreSQL 16.4 and `apply-migrations.mjs` are not the CI environment (F-14). CI on the merge commit is the authority for the CI-only steps.
- Gap C was confirmed by a scratch spec on the unfixed code; that scratch spec was deleted and is not kept as an automated test, since its expected outcome depends on the OQ-86 decision.
- The merge-commit CI log content (per-test counts) could not be retrieved from the sandbox.
- No live Owner or customer data was inspected; migration rehearsals use synthetic fixtures.

## 13. Follow-up round on PR #138 (2026-10-12)

Scope of this round: (1) the cross-installation license-identifier race; (2) the import endpoint's OpenAPI response contract. Head before this round `8a8e6370c0b5460b6447b43884eb5745efd6442b`.

### 13.1 F-18 — the cross-installation claim of one license identifier (Important, fixed)

**Defect.** The installation row lock serializes imports of one installation. Two different installations can both read a `licenseId` as unused (the binding pre-check in §3 sees only committed rows) and then both claim it. The record of the defect is the pre-fix run of the new live cases, not a model of it:

- Deterministic case (self import paused at its customer write while a foreign installation commits the identifier): the self import surfaced as an **unhandled `PrismaClientKnownRequestError` `P2003`** on `license_versions_license_id_installation_id_fkey`. It was **not** `duplicate-operation`.
- Repeated case (five rounds of simultaneous imports): round 0 surfaced the same raw `P2003`.
- Cause: the license row was written with `upsert`. When the row already exists, Prisma issues `INSERT … ON CONFLICT DO UPDATE`, which silently adopts the other installation's row. The version insert then fails on the composite foreign key `(license_id, installation_id)`. The generic `P2002` → `duplicate-operation` mapping in `persist` was therefore not the path taken; it was still too broad, and is narrowed as well.

**Fix.**
- `licenses.repository.ts`: a new license identifier is claimed by a plain `INSERT` (`tx.license.create`). The primary key arbitrates: the loser waits for the winner's commit, fails with a unique violation, and that violation is converted inside the transaction to `ImportConflictError({reason:'license-binding-conflict'})`. The transaction rolls back and the rejection is audited outside it, as for every other refusal. An identifier already bound to this installation and customer is touched only through a guarded `updateMany` (the binding is re-asserted in SQL). The installation-lock serialization and the retained-version checks are unchanged.
- `license-import.service.ts`: `persist` maps a unique violation to `duplicate-operation` only when it touches the version's own identity constraints (operation id or artifact hash, via `uniqueViolationTouches`). Any other unique violation is rethrown as an unexpected error.

**Evidence (live PostgreSQL 16.4, local).**
- Red, unfixed code: `licensing-persistence-live.e2e-spec.ts` — the two new cases failed (2 failed, 12 passed; the failures are the `P2003` above).
- Green, fixed code: the same file 14/14. Four consecutive runs green (initial plus three repeats).
- Deterministic case asserts: 409 with `reason: 'license-binding-conflict'`; the license row still bound to the winning installation and customer; exactly one version for the identifier (the winner's); no version for the loser; the loser's customer write and installation update rolled back (display name and installation customer unchanged); a `license.import.rejected` audit row with that reason.
- Repeated case asserts, per round: exactly one fulfilled and one rejected import; the rejection is an `ImportConflictError` with that reason; one license row, bound to the winner; one version. It does not claim that every round hit the unique-violation branch; the deterministic case is the proof of that branch.
- Service unit tests (`license-import.service.spec.ts`, "lost races inside the import transaction"): a claimed identifier → 409 `license-binding-conflict` with the audit reason; a unique violation on the version operation → 409 `duplicate-operation`; an unrelated unique violation → rethrown, not reported as a duplicate, nothing written.

**What is not proven here.** The race has been reproduced in one PostgreSQL instance with two installation rows. In a real deployment each installation has its own database, so this collision is reachable only where one database holds several installation rows (the schema allows it; the normal deployment does not). The fix is at the database boundary, so it holds in either case. Not run: a multi-instance (separate processes) race; the cases use one application instance and separate pooled connections.

### 13.2 F-5 / F-6 — the import response contract (OpenAPI)

**Runtime check.** `POST /api/v1/license/import` returns a JSON receipt: the evaluated license state (`LicenseStateView`), the bounded version history, `changed` and `outcome` (`'APPLIED' | 'UNCHANGED'`). It is not empty. The committed client had `content?: never` for its 200 response because the decorator declared a description and no type.

**Fix.**
- `api/dto/license.dto.ts`: `LicenseImportResultDto`, `LicenseVersionSummaryDto`, `LicenseEntitlementDto`. Each class `implements` the domain or view type it mirrors, so a field change there fails the build. Nullable string fields carry an explicit `type: String` — without it, TypeScript reflects `string | null` as `Object` and OpenAPI renders an unusable `Record<string, never>`; this was found and fixed during regeneration.
- `license-import.controller.ts`: `@ApiOkResponse({ type: LicenseImportResultDto })`; the method returns the DTO type.
- `test/license-import.e2e-spec.ts`: "documents the import response body in the OpenAPI contract, matching the real response" — fetches `/api/docs-json`, asserts the 200 response is `$ref: LicenseImportResultDto`, the 409 and 422 responses exist, the schema's property names equal the names of a real response (and of its first version summary), and the outcome enum. Red check: with the `type` removed from the decorator, this case fails (`× documents the import response body …`); restored, it passes.
- `frontend/src/api/generated/vardena-api.d.ts`: regenerated with the pinned `openapi-typescript@7.13.0` from the live document (`/tmp/openapi3.json`, the built API at this round's code). Diff: 67 added lines, 1 removed (`content?: never` on the import 200 response). Nothing else changed.
- `frontend/src/api/contracts.ts`: the hand-written `LicenseImportResult` keeps its narrower literal unions for the UI (a wider generated type would weaken them). A compile-time check, `LICENSE_IMPORT_RECEIPT_MATCHES_OPENAPI`, requires the hand-written receipt to remain assignable to `Schemas['LicenseImportResultDto']`. Negative check: changing `changed` to `string` fails `tsc` with `Type 'true' is not assignable to type 'never'`; restored.

**Drift check.** No CI step detects drift between the backend's live document and the committed client (F-7, still open). What exists now: the e2e contract case (server side), and the typecheck assertion (client side). A regeneration check from the final code is recorded in §13.4.

### 13.3 Test and check results of this round

| Check | Result |
| --- | --- |
| Backend typecheck | rc 0 |
| Backend lint | 1 warning (pre-existing, unrelated accounting spec); 0 errors. The new test code was briefly at 107 warnings (unnecessary escapes in template literals); fixed. |
| Backend format | rc 0 |
| Backend unit | 147 files, 1965 / 1965 |
| Licensing unit | 8 files, 118 / 118 |
| Licensing live + e2e (6 files) | 58 / 58 (persistence-live 14, up from 12; license-import e2e 14, up from 13) |
| Persistence-live repeats | 4 runs, 14 / 14 each |
| Full backend e2e (51 files) | **619 / 619** (was 616) |
| BusinessDate live, Asia/Tehran and America/Los_Angeles | 24 / 24 each |
| Migration rehearsals (four) | rc 0 each |
| Bootstrap on a fresh database (twice) | rc 0 both |
| Backend build | rc 0 |
| Frontend lint, typecheck, format, build | rc 0 each |
| Frontend tests | 56 files, 397 / 397 |

**Environment note.** The sandbox was reset between sessions: `/tmp`, the PostgreSQL cluster and `node_modules` were rebuilt. PostgreSQL 16.4 binaries were reinstalled from npm (`@embedded-postgres/linux-x64@16.4.0-beta.13`), the migration helper was recreated (same logic), and the Prisma client was regenerated with the engine overrides. These are the same substitutions as §4; CI remains the authority for the CI-only steps.

### 13.4 Regeneration check from the final code

The client was regenerated from the built API at the final code of this round (193 paths; `POST /api/v1/license/import` → 200 `application/json` → `#/components/schemas/LicenseImportResultDto`) with the pinned `openapi-typescript@7.13.0`. The output is byte-identical to the committed `frontend/src/api/generated/vardena-api.d.ts`. This is a manual regeneration check, not a CI gate (F-7).


## 14. Post-merge verification of PR #138 (2026-10-12)

Scope: verify the state of `main` after this report's own fixes were merged, and correct only the records that the merge made stale. No product decision, no OQ status change, no product-code change. The full verification report, the Owner decision package and the L-04 readiness assessment are `docs/tasks/licensing-pr-138-post-merge-verification-and-l-04-readiness.md`; this section keeps the reconciliation report internally consistent.

### 14.1 Merge identity (verified with `gh` and `git`, not from the PR description)

- `git ls-remote origin refs/heads/main` and `git rev-parse origin/main` → `d283744b4098346b6ef2e0b91922266f10cdabd1`.
- PR #138 (`Licensing: refuse license re-binding; post-merge audit of PR #137`): `state=MERGED`, `mergedAt=2026-10-12T06:03:27Z`, `mergeCommit.oid=d283744b4098346b6ef2e0b91922266f10cdabd1`, `headRefOid=4bdd97048002dede854d3925c3a182854ed93988`, base `main`, head branch `arena/f0ddc379-vardena`.
- Merge-commit parents: `345047a` (PR #137 merge, `main` before) and `4bdd970` (PR #138 head).
- **Tree equality:** `git rev-parse d283744^{tree} 4bdd970^{tree}` → both `f9dd36f5b5a273dbc0e24ae79c3d9e1a0b0da487`, and `git diff --stat 4bdd970 d283744` is empty. The merge introduced no content beyond the reviewed head, so §13's description of "the final code of this round" describes `main`.
- Local history is shallow; the SHAs above were re-fetched (`git fetch --depth=1 origin <sha>`) before being used, so `345047a` could be inspected directly for the absence of the fix.

### 14.2 CI evidence for `d283744`, kept apart from head-CI and from local claims

| Item | Run / job | Event and SHA | Result | Use as evidence |
| --- | --- | --- | --- | --- |
| **Merge commit** (the only CI result that verifies `main`) | run `38210710188` (`CI`), created `2026-10-12T06:03:29Z`, updated `2026-10-12T06:09:41Z` | `push` to `main` at `d283744` | `completed / success` | **Yes** — verifies `main` |
| merge commit, backend job | job `114683993213` | `d283744` | `success`, 27 steps | Yes. Steps `success`: Prisma validate, Prisma generate, Lint, Typecheck, Format check, Unit tests, Build, Migrate test database, Bootstrap system administrator, Inventory BusinessDate live suite (Asia/Tehran), Inventory BusinessDate live suite (America/Los_Angeles), Migration rehearsal (populated pre-Task-11 data), Migration rehearsal (Inventory BusinessDate validity windows), Migration rehearsal (Licensing version model and import), E2E tests (incl. live-DB suites). Two steps `skipped` by design (`Publish e2e failure inventory`, `Upload backend logs on failure` — both `if: failure()`). |
| merge commit, frontend job | job `114683993419` | `d283744` | `success`, 13 steps (Lint, Typecheck, Format check, Tests, Build) | Yes |
| PR #138 head, final | run `38208790250` | `pull_request` at `4bdd970` (created `2026-10-12T05:38:04Z`) | `success` (backend job `114678096343`, frontend job `114678095992`) | **Not** merge-commit evidence. Identical tree, but recorded separately. |
| PR #138 head, round 1 | run `38174043699` | `pull_request` at `8a8e637` | `success` (backend job `114572514150`, frontend job `114572513981`) | Only for `8a8e637`. Not evidence for `4bdd970` or `d283744`. |
| PR #137 merge commit | run `38171112633` | `push` to `main` at `345047a` | `success` | Verifies `345047a` only — which does **not** contain §3/§13's fixes. |

**Gaps in the CI evidence (stated, not hidden):**
- Per-test counts inside the CI log cannot be quoted from the sandbox: the Actions log blob host is unreachable. Only step- and job-level conclusions are cited. Nothing in §13.3's counts is a CI result.
- The legacy combined-status endpoint for `d283744` reports `pending` with `total_count: 0`, exactly as it did for `345047a` (§2). This repo's gates are Actions check runs; the check-runs API reports `backend: success` and `frontend: success`. The legacy endpoint is not used as evidence and its `pending` is not a failure.
- The first check-runs read during this verification returned `backend: in_progress` for `d283744` (a stale cache of the same run while it was finishing). The run itself completed `success`; both readings are recorded so the sequence is not mistaken for a re-run. There is exactly one `push`-to-`main` run for `d283744`.
- CI still has **no** step that regenerates or diffs the committed OpenAPI client (F-7). The green run above therefore does **not** prove the client is in sync; §13.4's byte-identical regeneration remains a manual check.

### 14.3 Local claims versus CI

§4 and §13.3 are **local** results, produced against PostgreSQL 16.4 binaries from `@embedded-postgres/linux-x64`, `apply-migrations.mjs` in place of `prisma migrate deploy`, and Prisma engine overrides (F-14). They are not CI results and were never presented as such. `d283744`'s green run `38210710188` is the authority for the CI-only steps — Prisma checksum fidelity under `prisma migrate deploy`, the CI service container, and the rehearsal wiring.

**Record inconsistency found (not editable by an agent, therefore recorded here).** PR #138's merged description quotes the round-1 local counts — backend unit 1962/1962, licensing unit 115/115, licensing live+e2e 55/55, full backend e2e 616/616, client diff "additive only (84 lines)" — which match §4, not §13.3. The merged tree's final round is §13.3: backend unit **1965/1965**, licensing unit **118/118**, licensing live+e2e **58/58**, full backend e2e **619/619**, client diff **67 added / 1 removed**. The PR description also lists the client change as "`/license/import` added", which was round 1; round 2 gave the import 200 response a schema (`LicenseImportResultDto`). Read §13.3 for the merged tree. Neither set is CI evidence.

### 14.4 Records corrected by this verification

| Record | Correction |
| --- | --- |
| `STATE.md` §32 | The post-merge bullet's present-tense "`main` and the PR #137 merge commit are `345047a`" was factually stale after the PR #138 merge; scoped to its date, with the fix's absence at `345047a` recorded. The follow-up bullet now states its merge commit. "Next gate" names both PR #137 and PR #138 as merged-not-accepted and extends F-6 to `POST /license/activate`. New §33 holds this verification pass. |
| This report | Header rows for merge state and the current tip of `main`; §2 scoped to PR #137; §6 statuses re-read against `d283744`; F-1, F-2, F-5, F-9 marked merged; this §14 added. |
| `docs/tasks/pdr-11-conflict-reconciliation.md` | Status row: the fixes it describes reached `main` through PR #138 at `d283744`, not at `345047a`. |
| `docs/decisions/product/PDR-11-…md` §19.4 | One merge-state sentence added to the post-merge addendum. **§1–§18 policy text untouched; §15 unchanged; PQ-5/OQ-80 and OQ-86 stay OPEN.** |
| `docs/open-questions.md` | A dated historical-log entry for this verification. **Status of every OQ unchanged (OPEN).** |
| `docs/tasks/licensing-pr-138-post-merge-verification-and-l-04-readiness.md` | New: the verification report, the Owner decision package (D-1…D-6) and the L-04 readiness assessment. |

Not changed: any OQ status; any PDR-11 §1–§18 policy; the decision brief's options; any migration; any product code; the accepted architecture; `.github/workflows/ci.yml` (F-7 remains a separate, reviewable slice).

## 15. Owner decisions of 2026-10-12 and their implementation (records + code, not yet accepted)

**Time scope:** the status cells below record the state when §15 was first written, before PR #142 merged. Their later merge/CI state is reconciled in §16; earlier SHA-scoped CI entries remain historical and are not deleted.

| Item | Decision (recorded verbatim in `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §7) | Status of this change |
| --- | --- | --- |
| OQ-80 overlap | **Option B** — the later starting version governs in the overlap; a candidate that starts at or before the version it overlaps is refused | Implementation recorded; unit + live-PostgreSQL tests pass locally; CI and Owner acceptance outstanding |
| OQ-80 gap | **G2** — a renewal may not leave a gap; adjacency (`previous.validUntil == next.validFrom`) is contiguous | Implementation recorded; boundary tests in `license-version.spec.ts` and the service/e2e suites |
| OQ-86 | **Option C** — the candidate is checked against the full retained effective history, retired windows included (closes Gap C) | Implementation recorded; the unit case that pinned the old rule was replaced by the Option C cases |
| OQ-86 legacy `VLIC1` | restriction preserved, no bypass | Unchanged code path; its L-02 lifecycle rules keep priority in the evaluation |
| OQ-86 tolerance / as-of reads | strict; recomputation | Unchanged |
| Q3 renewal identity | same `licenseId` | Decision recorded; issuer CLI `--license-id` (F-8) remains an open follow-up |
| Q4 customer change | explicit, authorized, audited operation only | Implementation recorded (`licenses.repository.transferCustomer` + typed `license.installation.customer-transferred` event + the dedicated `POST /api/v1/license/customer-transfer` route); tests at unit and live-PostgreSQL level |
| `license-binding-conflict` | ratified (name, 409, nothing written) | Unchanged behaviour; ratification recorded in §9 |
| **OQ-87 (new)** | **Not decided** — may a NEW license identity cover a lapse for the same customer + installation? | **BLOCKED**: no rule grants or refuses it (pre-decision behaviour preserved); no workflow may claim post-gap recovery. Registered in `docs/open-questions.md` **(Update 2026-10-12: DECIDED — Option B, [PDR-13](../decisions/product/PDR-13-post-gap-recovery.md); dedicated audited recovery operation, ordinary import never recovers; the BLOCKED gate above is lifted and L-04 is implemented in the same change)** |

## 16. Post-merge verification of PR #142 (2026-10-12)

Scope: re-establish live GitHub state, verify the final merged implementation and migration ordering, and reconcile only stale status language. No product-code, schema, permission, generated-client or product-policy change is made by this section. Product Owner acceptance is not inferred from merge, review or CI.

### 16.1 Merge identity and current `main`

- Live GitHub reports PR #142 (`Licensing: OQ-87 Option B — dedicated post-gap recovery + L-04 usage-aware reduction flow`) `closed` / `merged`, merged at `2026-10-12T18:20:27Z`.
- Final PR head: `fdf2fdbc665359157d74210b65e4fb1defaead63`. Distinct merge commit: `f0b047ae4950edced9e301411da710dd82c68ed1`. The GitHub commit API reports the merge commit's parents as pre-merge `main` `f4c2e84f7af734c356e035dabc69bb8acfa81a05` and the PR head; the merge commit message and two parents establish merge-commit method (not squash/rebase).
- The live `main` ref and fetched `origin/main` both point to `f0b047ae4950edced9e301411da710dd82c68ed1`; that exact merge commit is the current tip. The merge and PR-head trees are identical (`aebf5e42dfc62875461687b86ebb8200fb1bd9f5`).

### 16.2 CI evidence, never transferred between SHAs

| Item | Workflow / job | Event and exact tested SHA | Result |
| --- | --- | --- | --- |
| PR #142 final head | [run `38289188865`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38289188865) | `pull_request`, `fdf2fdbc665359157d74210b65e4fb1defaead63` | `CI`, completed / success |
| PR-head backend | job `114944834096` | `fdf2fdbc665359157d74210b65e4fb1defaead63` | success: Prisma validate/generate, lint, typecheck, format, unit, build, migrate test DB, bootstrap, both timezone live suites, all three migration rehearsals and E2E (incl. live-DB suites); failure-only inventory/upload steps skipped |
| PR-head generated API client | job `114944834385` | `fdf2fdbc665359157d74210b65e4fb1defaead63` | success, including generated-client drift check |
| PR-head frontend | job `114944834437` | `fdf2fdbc665359157d74210b65e4fb1defaead63` | success: lint, typecheck, format, tests and build |
| **Merge commit/current `main`** | [run `38290247234`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38290247234) | `push` to `main`, `f0b047ae4950edced9e301411da710dd82c68ed1` | `CI`, completed / success |
| Merge/main backend | job `114948327992` | `f0b047ae4950edced9e301411da710dd82c68ed1` | success: same backend quality, unit, build, migrate, rehearsal and E2E step set as above |
| Merge/main generated API client | job `114948328423` | `f0b047ae4950edced9e301411da710dd82c68ed1` | success, including generated-client drift check |
| Merge/main frontend | job `114948328482` | `f0b047ae4950edced9e301411da710dd82c68ed1` | success: lint, typecheck, format, tests and build |

The merge commit itself therefore has verified CI. The PR-head run is separate evidence for `fdf2f...` and is not used as a substitute. The legacy combined-status endpoint returned `pending` with zero legacy statuses for the merge SHA; the GitHub Actions check-runs API and completed workflow/job records above are the evidence used here. The initial inspection observed the merge run while `backend` E2E was still in progress; the final workflow API and `gh run watch` show the same run completed successfully.

### 16.3 Merged implementation review

**OQ-87 / PDR-13 recovery:**

- `backend/src/modules/licensing/api/license-gap-recovery.controller.ts` applies `AuthGuard` and `AuthorizationGuard` at the route, with `@RequirePermission(Licensing.License.Activate, Licensing.Installation.RecoverAfterGap)`. `RequirePermission` explicitly requires all listed codes. `LicenseImportService.runImport` rechecks both permissions at the application boundary (AR-21).
- `RecoverAfterGapDto` applies the documented 3–500 character constraint. The service rechecks a minimum trimmed length before entering the import pipeline; see the bounded-reason finding below for the upper-bound audit issue.
- The signed-document path, recovery intent and typed `license.import.recovered` event are handled by `LicensesRepository.importVersion` in one transaction. It locks the installation, recomputes conflicts, writes the version and supersession stamp, then writes the recovery audit event before commit. `previous_license_id` is machine-readable; `detail` captures the lapsed coverage end, and the response receipt carries the transaction's lapsed license and coverage end. An audit insert failure rolls back the whole transaction; no partial applied version survives.
- Ordinary import refuses a new-identity post-gap candidate as `post-gap-recovery-requires-dedicated-operation`; the route is the only path to the recovery intent. `recovery-not-applicable`, `recovery-requires-signed-document` for `VLIC1`, and duplicate `duplicate-operation` behavior are present and covered by `backend/test/license-recovery-resolution.e2e-spec.ts` plus domain/service tests. Customer binding is checked against the installation under the lock; a recovery cannot transfer it. Signature, identity, precedence, retained-history and reduction checks remain on the shared pipeline.

**L-04 / PDR-11 §8.6 usage-aware reduction:**

- `CrossModuleLicenseUsage` obtains organizations and active-user counts through the owning modules' published service contracts; it does not read their tables. The authoritative read is executed inside the import transaction after taking the same `vardena:license:{installationId}:active-users` and `...:organizations` transaction advisory locks used by the allocation guards. A failed/unavailable count aborts or yields a `usage-unavailable` conflict; neither path applies a candidate without the count.
- `evaluateReductionHandOver` compares each finite capacity reduction to counted usage and every removed entitlement to the retained grant. A conflict returns `reduction-requires-resolution` with predecessor and per-conflict details before any state write. `POST /api/v1/license/reduction-resolution` requires `Licensing.License.ResolveReduction` plus `Licensing.License.Activate`, and a reason; the application service rechecks both. The repository recomputes usage/conflicts under the locks and writes the `license.import.reduction-resolved` event atomically with the import. A non-conflicting request is refused as `resolution-not-applicable`; PDR-12's open-end behavior remains non-resolvable except for the already-decided explicit signed supersession.

**Migration:** `20261017000000_license_audit_previous_license_id` adds nullable `previous_license_id` and a comment only. It is ordered after `20261014000000_licensing_version_model_and_import` creates `license_audit_events` and after `20261016000000_licensing_customer_transfer_audit`; no table rewrite, backfill, FK or pairing check was added. This is the additive history fact required by PDR-13.

### 16.4 Blocking finding — valid maximum-length operation reason can exceed audit `detail`

**Severity: medium (P2), functional failure at a documented boundary.** The source-derived finding was subsequently reproduced by the real PostgreSQL CI suite on PR #143's exact pre-fix head `dceeaea954aef4f4b48bfdeaa186e5f66d0f44f3`, run [`38305329909`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38305329909). The annotations for [`licensing-persistence-live.e2e-spec.ts`](https://github.com/MR-AliEsmaeili/Vardena/blob/dceeaea954aef4f4b48bfdeaa186e5f66d0f44f3/backend/test/licensing-persistence-live.e2e-spec.ts) show both exactly-500-character requests—post-gap recovery and authorized L-04 resolution—returned HTTP 500 instead of 200. In each test the preceding PostgreSQL assertions verified rollback: no applied version/audit event and no predecessor supersession facts persisted. The test summary exposes the generic HTTP response, not a PostgreSQL SQLSTATE. This is actual database evidence, not an in-memory reproduction.

**Root cause:** the successful-event builders compose required lapse/conflict context with the operator reason, but the old `.slice(0, 500)` calls do not bound the final composed string; the recovery/resolution detail therefore exceeds `license_audit_events.detail VARCHAR(500)`. `importVersion` inserts the event inside the state-change transaction, so PostgreSQL rejects the audit insert and correctly rolls the whole operation back. The customer-transfer builder has a separate 500-character slice that silently drops part of a valid maximum-length reason. The DTOs enforce 3–500; the application boundary previously rechecked only the minimum.

**PR #143 remediation (CI-verified; Product Owner acceptance outstanding):** the candidate removes truncation from the successful transfer/recovery/resolution event builders, rechecks the 3–500 boundary in the application service, and changes `detail` to PostgreSQL `TEXT` through additive migration `20261018000000_licensing_audit_detail_text`. No applied migration is edited. The type conversion preserves existing row values; the licensing migration rehearsal seeds a populated 500-character audit detail, applies the widening after the existing audit migrations, checks the old value unchanged and round-trips a new 750-character detail. The live PostgreSQL regression cases assert the full recovery/resolution reason plus required context and replay refusal on success; the exact pre-fix CI reproduction documented above confirms rollback/no partial writes on the failure path. Authorization, signatures, customer/installation binding, locks, replay handling, usage checks and licensing policies are unchanged.

**Verification status:** runtime correction commit `4ca6239cd1fca2b8ddea5a7291072c2523d83451` passed exact PR CI run [`38351688052`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38351688052). The [`backend` job](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38351688052/job/115145296879) passed Prisma validation/generation, lint, typecheck, format, unit tests, build, fresh migration deploy, all migration rehearsals (including the populated licensing audit-detail upgrade), E2E and the serial live PostgreSQL licensing suite. The `frontend` job [`115145296807`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38351688052/job/115145296807) and `generated-api-client` job [`115145296947`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38351688052/job/115145296947) also passed. This is post-fix evidence from GitHub's real PostgreSQL infrastructure, not an in-memory claim. The focused local service unit suite (74 tests), in-memory recovery/resolution route suite (4 tests), typecheck, build, lint, format check, rehearsal `node --check` and `git diff --check` pass; lint has one pre-existing warning in an unrelated accounting spec. PostgreSQL and Prisma validation/generation were **NOT RUN locally**: `pg_isready`, `psql` and Docker are unavailable, and the Prisma formatter could not download its schema engine from `binaries.prisma.sh`. This paragraph is scoped to runtime commit `4ca6239`; the subsequent documentation-only PR head requires its own exact-head CI, which is reported in PR #143. Product Owner acceptance is not recorded or inferred; verification does not constitute acceptance.

### 16.5 Records and gates

- `STATE.md` §36 and `docs/open-questions.md` OQ-87 now distinguish: Product Owner decision recorded; implementation merged; exact PR-head and merge/main CI evidence; Product Owner acceptance outstanding. Earlier head runs stay as historical evidence and the pre-merge statements are time-scoped, not deleted.
- `docs/licensing-architecture.md` no longer describes OQ-80's interim behavior as the current rule. PDR-13, the decision brief, PDR-11 §19.4 and the product decision index were checked; their dated decision/history text is preserved. PDR-11 §1–§18 policy is unchanged. No OQ status is changed here: OQ-79, OQ-82, OQ-83, OQ-84 and OQ-77 remain Open.
- Product Owner acceptance is not recorded or inferred. No product code, schema, permission, generated client or API contract is changed by this reconciliation section.

## 17. Product Owner decisions of 2026-10-13 — F-8 supersession and F-12 (dated addendum)

**Scope:** records only. No product code, schema, migration, permission, API
contract or generated client is changed by this section, and no earlier text in
this document is rewritten — the affected statements are superseded, not
amended. The audit that establishes the facts is
[`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md`](licensing-po-acceptance-audit-2026-10-13.md).

- **Q3 (renewal identity) — SUPERSEDED.** §15's row "Q3 renewal identity = same
  `licenseId`" and the follow-ups it created (§9 item 3, finding F-8 and its
  `--license-id` tooling change) are superseded by the Product Owner decision of
  2026-10-13: preserving the previous `licenseId` during renewal is **not** a
  product requirement. What remains required is that a newly issued license stay
  bound to the same intended customer and the same customer code, and that a
  changed `licenseId` not bypass customer binding, installation binding,
  retained history, version precedence, capacity/entitlement reduction controls,
  replay protection, or audit requirements. **`--license-id` must not be
  implemented** merely to force reuse of the old identifier — the tooling
  follow-up is withdrawn, not owed. Supersession note recorded in the decision
  brief §8.3.1. **Requirement-level status (revision 2, 2026-10-13): F-8 is NOT
  fully satisfied.** What holds for a changed identifier is customer binding by
  `customerId`, installation binding, retained history, version precedence, replay
  protection and audit (audit report §4.2/§4.3). Two criteria are outstanding
  implementation items against the same decision: (a) the **same customer code** is
  not representable, signed or validated anywhere in the tree (corrective task
  **L-06**); (b) the **capacity/entitlement reduction control** (§8.6) does not
  execute on a renewal that retires nothing, for either identity (corrective task
  **L-05**, audit report §4.4.1 — a requirement defect, and PR #142 stays `HOLD`
  until it is fixed and verified).
- **F-8 finding (this document, §9) — status.** The finding that the issuer CLI
  cannot target an existing `licenseId` is no longer a defect: new identity per
  renewal is now an accepted policy, and the issuer's `options.licenseId ??
  generateId()` behaviour matches it. Nothing in the merged slice silently
  claims the OLD policy; the records are updated here instead.
- **Revision note (2026-10-13, after Product Owner review of PR #144).** The two
  F-8 follow-ups above replace the earlier single-bullet wording, which had
  described G-8.1 as if narrowing §8.6 were an acceptable alternative to
  implementing it. Narrowing is **not** accepted: PDR-11 §8.6 is unconditional and
  the F-8 decision requires the control for a changed `licenseId`. The dated history
  of §17 is preserved; only the requirement-level status is stated here.
- **F-12 (initial System Administrator) — DECIDED, NOT IMPLEMENTED.** The
  Product Owner's decisions of 2026-10-13: (1) the initial password remains
  exactly `1`; (2) the account must hold the real System Administrator role with
  the highest software access the purchased license and its entitlements allow,
  without bypassing license/module restrictions; (3) after the first successful
  login the user must be forced to set a new password **before** accessing
  normal application functionality; (4) the requirement must be enforced in the
  **backend** as well as the frontend, covering API access, session/token
  handling, refresh flows, failure paths and bootstrap idempotency; (5) the
  initial password must **not** be replaced by an environment variable or a
  different bootstrap policy, and authorization must not be weakened or given
  wildcard permissions. **State on `main`:** (1) and (2) are satisfied
  (hardcoded `'1'` with no env override; the role is built from every registered
  permission filtered by `LicensingService.filterLicensedPermissions`, and the
  same filter applies at authorization time). (3) and (4) are **not
  implemented anywhere** in the merged tree: there is no change-required state
  in the schema or code, no forced-change gate in `auth`/`AuthGuard`, no
  self-service password-change endpoint (the only password mutation is the
  administrator route `POST /api/v1/users/{id}/password-reset`), and no
  frontend flow. The row in §3/§9 that calls F-12 "an Owner/security decision on
  the remediation path" is superseded: the remediation path is now decided
  (forced first-login change) and is an **outstanding implementation item** and
  a deployment blocker, with the eight acceptance tests recorded in the audit
  §5.2.

## 18. L-05 implemented — §8.6 reduction control on the renewal path (2026-10-13, dated addendum)

**Scope:** records the corrective implementation of finding G-8.1 (§17 and the
[acceptance audit](licensing-po-acceptance-audit-2026-10-13.md) §4.4.1, task
**L-05**). No decision text is rewritten; the historical statements above —
including this document's earlier "a document that retires nothing has no
predecessor whose grant could be taken away" boundary and the audit's probe
evidence — remain as dated records of the state they describe. Product Owner
acceptance is not recorded or inferred.

- **What changed.** The single conflict authority
  (`backend/src/modules/licensing/domain/license-version.ts`) gained rule 6c:
  a candidate that retires nothing (the ordinary contiguous renewal) is
  measured, after the existing rules accept it, against the **deterministic
  continuation baseline** — the retained version whose effective window ends
  exactly at the candidate's `validFrom`, selected by preferring the
  candidate's `licenseId`, then the installation's bound customer, ties by
  latest import then id. The shipped `reductionConflicts` usage check runs
  against that baseline; a conflicting renewal is refused
  `reduction-requires-resolution` (409, nothing written) with the baseline in
  `reduction.predecessorVersionId`, and lifts only through the existing
  authorized `ReductionResolutionIntent`. The legacy `VLIC1` adjacency renewal
  is guarded by the same rule after its L-02 rules; its transport still cannot
  carry a resolution. The repository's resolution receipt and the typed
  `license.import.reduction-resolved` event now name the evaluation's
  **resolution subject** (retired predecessor, or the baseline) and the
  baseline is never stamped. Out of scope, unchanged: first license, backwards
  gap fill, dedicated post-gap recovery; the open-end arm has no continuation
  case (proof-tested). PDR-12's non-bypass rule is untouched. No schema,
  migration, OpenAPI contract, generated-client or frontend change; the
  existing Persian `reduction-requires-resolution` copy applies to the new
  path unchanged.
- **Requirement-level status.** With this change the G-8.1 defect's
  implementation exists; F-8's reduction-control criterion and PR #142's
  `HOLD` remain as recorded in §17 until the change is merged and verified
  with exact-SHA CI, and acceptance stays with the Product Owner. The design
  rule is recorded in
  [`docs/licensing/version-model-and-file-exchange.md`](../licensing/version-model-and-file-exchange.md)
  §3.3 and the rule-6b/6c documentation of the conflict authority.
- **Verification.** Local fast checks (backend unit suite, typecheck, lint,
  format, build, hermetic route e2e) passed at the implementation head; the
  live-PostgreSQL and migration verification is delegated to CI per
  [`docs/testing/test-execution-policy.md`](../testing/test-execution-policy.md)
  and is recorded with the exact head SHA in the pull request. Local tests are
  not live-PostgreSQL proof.
- **Next justified sequence (unchanged from the audit §9).** F-12 (decided,
  unimplemented, deployment blocker; acceptance tests in the audit §5.2) is
  independent of Licensing's import path and comes next; L-06 (customer code)
  follows once the Product Owner records what the customer code IS (audit
  §4.6 step 1) — neither is a dependency of L-05, and neither is started here.

---

## 19. L-06 — stable customer code across the license lifecycle (2026-10-14)

**Scope:** records the Product Owner decision (**[PDR-14](../decisions/product/PDR-14-licensing-customer-code.md)**, decision id **OD-LIC-03**) and the corrective implementation of task **L-06** ([acceptance audit](licensing-po-acceptance-audit-2026-10-13.md) §4.6). Earlier historical statements remain dated records of the state they describe.

- **Product Owner decision recorded (`PDR-14` / `OD-LIC-03`).**
  1. Every licensing customer has a stable, independent business `customerCode` (`licensing.customers.customer_code`).
  2. `customerId` (`licensing.customers.id`) remains the internal database identity and is not replaced by `customerCode`.
  3. `customerName` (`licensing.customers.display_name`) remains a display name, not an identity key; renaming it does not alter `customerId` or `customerCode`, and ordinary license import never silently overwrites a customer's stored `display_name`.
  4. Signed license artifacts (`VLIC2` and `VLIC1`) carry `customerCode` inside the signed payload, and issuance and import validate `customerCode` against the intended customer.
  5. Customer or installation rebinding requires the explicit, authorized, auditable transfer operation (`POST /api/v1/license/customer-transfer`, `Licensing.License.TransferCustomer`); editing a display name or changing `customerCode` in an ordinary import never transfers ownership.
  6. Renewals — whether preserving `licenseId` or using a new `licenseId` (L-05) — remain bound to the same customer (`customerId` and `customerCode`).
- **What changed.**
  - **Schema and migration (`backend/prisma/schema/licensing.prisma`, `backend/prisma/migrations/20261020000000_licensing_customer_code/migration.sql`):** added `customer_code VARCHAR(64) NOT NULL`, unique index `uq_customers_customer_code`, and `customers_customer_code_check` (`customer_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$' AND customer_code <> id`), guarded by a fail-closed migration preflight that refuses null/blank/invalid/duplicate `customer_code` on existing rows without fabricating codes from `id` or `display_name`. Rehearsed in `backend/prisma/rehearsal/licensing-version-model/rehearse.mjs`.
  - **Signed artifact contract (`license-document.ts`, `license-code.ts`):** added `customerCode` in canonical wire order (`customerId`, `customerCode`, `customerName`), covered by Ed25519 signature verification and validated against `CUSTOMER_CODE_PATTERN` (`customerCode !== customerId`).
  - **Issuance and CLI (`development-license-authority.ts`, `issue-development-license.ts`):** required explicit valid `customerId` and `customerCode` (or an explicit customer record with consistent `customerId` and `customerCode`) and `--customer` / `--customer-code` CLI flags; never auto-generates `customerId` or `customerCode` and never derives `customerCode` from `customerName` or `customerId`.
  - **Conflict authority, persistence, transfer, and audit (`license-version.ts`, `licenses.repository.ts`, `license-import.service.ts`):** added `customer-code-mismatch` (HTTP 409, nothing written) when `customerId` or `customerCode` conflicts with persisted customer records across ordinary import, renewal (same or new `licenseId`), recovery, reduction resolution, or customer transfer; replaced the `display_name`-overwriting customer upsert with read-and-validate plus insert-only-if-absent so ordinary imports never overwrite `display_name`; extended transfer results and `LICENSE_CUSTOMER_TRANSFERRED` audit details with `previousCustomerCode` and `newCustomerCode`; exposed `customerCode` on `LicenseStateDto` and regenerated the OpenAPI TypeScript client (`frontend/src/api/generated/vardena-api.d.ts`).

