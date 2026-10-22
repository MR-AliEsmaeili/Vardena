# Licensing Option C — current-state acceptance audit (2026-10-22)

## Executive disposition

**Status: BLOCKED. Licensing is not fully verified against Option C.**

This audit re-checks the exact current `main` snapshot and separates implementation,
component-test, CI, cross-application, and manual evidence. Owner Licensing and the
customer runtime remain separate applications with separate databases. No accepted
product or protocol decision was changed, and no code defect or contradiction with
PDR-19 was demonstrated in this audit.

The concrete gap is test evidence, not a newly proven production defect: the current
`verify:interop` command generates an ephemeral Ed25519 key and exercises Owner
protocol signing against customer **domain parsers** in process. It does not prepare
from persisted Owner records, import through Owner and customer HTTP/service paths,
verify customer PostgreSQL state, or test both databases in one orchestrated flow.
Owner and customer live-database suites test their own applications separately. The
critical Persian RTL workflow was not driven by a human operator.

## Repository and GitHub evidence

- Revalidated base: `origin/main` at `92586fa87b7aa678fc26dddcc775b54eddbc15c3`.
  This is also the merge commit for PR #191. Local branch before these documentation
  changes was exactly at that SHA.
- PR #191 is merged. Its head was `a3cb6f8ecb010252d6c12bbd0720e8d1b4fc4854`;
  merge commit: `92586fa87b7aa678fc26dddcc775b54eddbc15c3`.
- The latest `main` CI run at audit time is [run 39657663222](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39657663222),
  event `push`, exact `headSha=92586fa87b7aa678fc26dddcc775b54eddbc15c3`, result
  **success**. `classify`, `backend`, `frontend`, `generated-api-client`, `docs`,
  and `ci-gate` all passed. The backend run included the Owner fresh-migration/API
  suite and customer live-PostgreSQL E2E/licensing-persistence steps. This is CI
  evidence for that exact base SHA, not evidence for this audit branch's later head.
- Only open PR at audit time: [#192](https://github.com/MR-AliEsmaeili/Vardena/pull/192),
  head `bb055f9d0b2e654f1a9f79e09258180bcde50c5b`. Its CI run
  [39693999819](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39693999819)
  passed `classify`, `frontend`, `generated-api-client`, and `ci-gate`; `docs` and
  `backend` were skipped. It is unrelated frontend coverage and was not modified.
- Environment: Node `v22.22.3`, npm `10.9.8`; no `psql`, `pg_isready`, or Docker
  executable was available. No database URLs were set. Therefore no local live-DB
  run is claimed. The repository's CI at the base SHA did run live DB tests, but it
  did not run a combined Owner-to-customer acceptance flow.

## Gap matrix

| Requirement | Current implementation | Existing test/evidence | Missing evidence | Exact next action | Status |
|---|---|---|---|---|---|
| Separate Owner/customer applications and databases; no Owner-to-customer connection | Owner has its own `owner` schema and database configuration; customer uses its own Prisma database; `scripts/check-owner-isolation.py` and CI image checks enforce packaging/isolation | CI run 39657663222 at base SHA passed Owner isolation and production artifact checks; repo isolation check exists | The new acceptance harness must prove two distinct disposable database URLs are used in the same test run | Add a non-skipping CI acceptance test that requires distinct disposable Owner/customer DB URLs and fails closed if either is absent/equal | PASS for architectural separation; BLOCKED for combined flow |
| Owner administrator bootstrap/authentication and real-record issuance preparation | Owner API supports bootstrap, login, customer, installation identity, profile, signing-key selection, preparation and digest generation | `owner-licensing/backend/test/licensing-lifecycle.test.ts`; CI base run passed fresh Owner migrations and API/security regressions | No single scenario carries the persisted Owner request through customer activation | Use Owner API lifecycle fixture as first phase of a dedicated cross-app test; persist and assert all source rows and digests | BLOCKED |
| Offline signing and exact-byte Owner import/archive | Offline signer validates request digest before loading a private key; Owner stores and re-downloads exact signed artifact bytes | `test/signer.test.ts`, `test/artifact-store.test.ts`, Owner lifecycle tests; `npm run verify:interop` uses an ephemeral in-memory key | Current interop check does not sign the persisted prepared request nor compare Owner archived bytes to customer-submitted bytes | In the combined test, sign only with a generated ephemeral test key outside Owner API process, import via Owner endpoint, then byte-compare archive download | BLOCKED |
| Customer import and backend-confirmed activation persistence | Customer import/current-state routes and persistence repositories are implemented; frontend releases its gate only after GET current re-read | `backend/test/license-import.e2e-spec.ts`; 24 customer licensing unit/DB test files represented in code; CI base run passed live licensing PostgreSQL suite; frontend import tests | No persisted Owner artifact is imported through customer endpoint in a run that also asserts database identity/version/operation/entitlements | Send Owner-downloaded bytes through customer authenticated API; query customer DB and GET current after import; assert exact identities, limits, entitlements, dates, operation/version | BLOCKED |
| Tamper, malformed input, untrusted/mismatched signer, customer/install/lineage binding; API errors and no mutation | Customer parsers/services and Owner APIs enforce signature/trust/binding/replay rules | `verify-licensing-interop.ts` covers signature-level tamper and unknown signer; customer domain/service specs cover stable reasons and binding; Owner lifecycle tests cover Owner rejection/authorization | Cross-app API-level outcomes and before/after persisted state are not asserted together for the requested matrix | Add table-driven API tests recording stable codes plus row/audit/archive counts before and after each rejected case | BLOCKED |
| Duplicate/replayed issuance and revocation; stale revocation; old license after revocation | Both apps implement idempotency/conflict handling; customer rejects old license artifacts once a license is revoked | Owner lifecycle replay tests; customer revocation service specs and live DB test; frontend revocation gating tests | No test imports Owner-produced VREV1 into a real customer database after Owner archives it | Continue the combined flow through revocation endpoint; assert customer revocation/audit rows, replay stability, and old-license refusal | BLOCKED |
| Expired/abandoned prepared request and rejected lineage target | Owner has a fixed 14×24-hour prepared-request age, terminal abandonment and same-customer recorded-lineage validation | Owner `licensing.test.ts` and `licensing-lifecycle.test.ts` cover injected-clock boundaries, abandonment, immutable snapshot, operator denial and unknown lineage target; CI base run passed those suites | No combined acceptance record asserts stable API errors plus Owner/customer/archive state for these cases within a cross-app flow | Include expiry/abandonment and rejected renewal/supersession target cases in the dual-DB acceptance suite; snapshot issuance, audit and artifact counts before/after | BLOCKED |
| Positive renewal and early import; separate supersession with retained signed history | Owner API and UI support renewal/supersession; customer version model preserves history and governs by effective dates | Owner lifecycle positive renewal/supersession tests; `backend/test/license-import.e2e-spec.ts`; customer import unit tests | No shared scenario proves Owner lineage records are consumed by customer persistence and early import leaves the current window intact | In the acceptance suite, perform one early renewal and a separate supersession; query both databases and current license state after each | BLOCKED |
| Grace exactly 14 calendar days UTC and Read-Only allowances/refusals | Customer clock/status and authorization enforcement are implemented; business operations are backend guarded | Grace domain/application tests; CI base run passed customer backend suites; repository report documents existing Grace/Read-Only tests | No cross-app flow seeds/activates the actual entitlement before deterministic clock transitions and checks every permitted operation on customer backend | Add deterministic-clock tests using existing abstractions; cover pre-expiry, 14-day Grace, post-Grace mutation refusal and each allowed endpoint | BLOCKED for combined acceptance; local component evidence exists |
| Module and numeric ceiling enforcement | Customer authorization and limit services enforce modules and ceilings server-side | `backend/src/modules/licensing/application/license-limit-concurrency.spec.ts`, `backend/test/licensing-limits-live.e2e-spec.ts`, import and organization/user service tests; base CI live suite green | Combined issued profile → imported artifact → denied over-ceiling operations not demonstrated | Use the persisted Owner profile in the acceptance flow; assert boundary and boundary+1 results at customer API and DB state | BLOCKED |
| Signed revocation and archive recovery | Owner VREV1 prep/import/download and archive backup/verify exist; customer revocation endpoint/service persists revocation; recovery requires new license | Owner `artifact-backup.test.ts`, lifecycle tests; customer revocation service and live persistence tests; documented PostgreSQL 16 backup/restore drill in `docs/licensing/artifacts-backup-restore.md` | No combined run proves Owner-produced archived VREV1 applies to customer. Existing restore drill is not production-sized and is not a cross-app run | Add the positive flow and replay/old-license checks; retain current documented restore test as limited evidence, not production readiness | BLOCKED |
| Critical Owner/customer Persian RTL UI paths | Both SPAs implement licensing pages/forms and Persian RTL translations | Owner and customer frontend test suites passed locally on 2026-10-22 | No actual human operation in the UI; automated UI tests do not count as manual acceptance | Named operator executes checklist below in a staging/test installation and records date, build SHA, result and redacted evidence | NOT RUN |
| Full CI on final PR head | Base SHA has a fully green CI run; PR #192 unrelated backend was skipped | Exact run 39657663222 passed at base SHA | This documentation-only PR has no run yet; it will not add the missing combined test | Require `docs` and `ci-gate` for this documentation-only PR on its exact head. The follow-up code PR that adds the combined test must run all classifier-applicable backend/customer live-DB, Owner integration, frontend, generated-client, docs and gate checks on that code PR head | BLOCKED |

## Command record (executed 2026-10-22 UTC)

All commands ran from the indicated directory. Dependency installation used
`npm ci --ignore-scripts --no-audit --no-fund`; no lockfiles or source files were
changed by installs.

| Command | Result |
|---|---|
| `git fetch origin main`; `git rev-parse origin/main`; `git rev-parse HEAD` | `origin/main=92586fa87b7aa678fc26dddcc775b54eddbc15c3`; initial `HEAD` matched exactly |
| `gh pr list --state open --json number,title,headRefName,baseRefName,url` | Only open PR #192, frontend coverage |
| `gh pr view 191 --json ...` | Merged; head `a3cb6f8...`; merge commit current base `92586fa...`; all six checks successful |
| `gh run view 39657663222 --json ...` | Exact base SHA CI successful; all six jobs passed; backend included fresh Owner migrations/API and customer live DB licensing suites |
| `gh run list --commit 92586fa87b7aa678fc26dddcc775b54eddbc15c3 ...` | Failed: installed `gh` reports `unknown flag: --commit`; reran successfully with `gh run list --branch main` and inspected exact SHA via `gh run view 39657663222` |
| `gh pr view 192 --json ...` | Head `bb055f9...`; classify/frontend/generated-client/ci-gate passed; backend/docs skipped |
| `node --version`; `npm --version`; `command -v psql`; `command -v docker`; `pg_isready` | Node `v22.22.3`; npm `10.9.8`; psql/docker unavailable; `pg_isready` unavailable |
| `owner-licensing/backend: npm ci --ignore-scripts --no-audit --no-fund` | Passed, 208 packages |
| `backend: npm ci --ignore-scripts --no-audit --no-fund` | Passed, 459 packages |
| `owner-licensing/frontend: npm ci --ignore-scripts --no-audit --no-fund` | Passed, 221 packages |
| `frontend: npm ci --ignore-scripts --no-audit --no-fund` | Passed, 217 packages |
| `owner-licensing/backend: npm run verify:interop` | **7/7 passed** (VLIC2 accept, fields preserved, perpetual variant, one-byte tamper refusal, unknown signer refusal, VREV1 accept, re-aimed revocation refusal). This is domain/protocol interop, not the two-DB acceptance flow. |
| `owner-licensing/backend: npm test` | **9 files, 140 tests passed** |
| `owner-licensing/backend: npm run typecheck && npm run lint && npm run format:check && npm run build` | Passed; lint 0 warnings/errors |
| `backend: npm test` | **166 files, 2,262 tests passed**, including licensing unit/service/domain specs |
| `backend: npm run typecheck && npm run lint && npm run format:check` | Passed; lint had 3 pre-existing warnings in `src/tools/generate-licensing-vectors.ts`, `src/modules/accounting/application/coding-structure-accounts.spec.ts`, `src/modules/licensing/domain/licensing-protocol-vectors.spec.ts`; 0 errors |
| `backend: npm run build` | Passed |
| `backend: npm run test:e2e -- test/license-import.e2e-spec.ts test/licensing.e2e-spec.ts test/licensing-activation.e2e-spec.ts` | **3 files, 45 tests passed**; these selected E2E tests use the repository's test app/in-memory stores, not live PostgreSQL |
| `owner-licensing/frontend: npm test && npm run typecheck && npm run lint && npm run format:check && npm run build` | **21 files, 268 tests passed**; all checks/build passed |
| `frontend: npm test && npm run typecheck && npm run lint && npm run format:check && npm run build` | **68 files, 485 tests passed**; all checks/build passed |
| `python3 scripts/check-docs-links.py` | Passed; 338 markdown files, 1,254 relative links, 0 broken |
| `git diff --check` | Passed |
| Owner `npm run test:integration` | **NOT RUN locally**: no PostgreSQL binaries/service/URL. Base CI did run these tests, but not cross-app orchestrated. |
| Customer `npm run test:e2e -- test/licensing-persistence-live.e2e-spec.ts` | **NOT RUN locally**: live PostgreSQL unavailable. Not run without `VARDENA_TEST_DATABASE_URL`; thus no skipped-as-pass claim. Base CI did run the live suite on base SHA. |
| Cross-app dual-database acceptance scenario | **NOT RUN / not currently implemented as a combined suite** |

The known lint warnings are unrelated to code changes in this audit. Frontend build
warnings from third-party Zod pure-comment annotations and existing chunk-size
limits were non-fatal; builds succeeded.

## Security review summary

- **Private signing keys:** interop tool generates a disposable keypair in memory;
  the Owner signer is a separate offline executable. No production key, credential,
  or private key was used or added. The signer tests cover digest-before-key-load.
- **Trust and signed bytes:** VLIC2/VREV1 canonical formats, vectors, signed fields,
  and public error contracts were not changed. Interop checks cryptographic parsing
  and some negative cases only; service/persistence binding still requires the
  combined suite.
- **Isolation:** Owner's code has no customer database connection; the repository
  and CI verify Owner exclusion from the customer production artifact. Preserve
  distinct DB URLs in a future integrated test.
- **Replay/transactions/archive:** existing Owner/customer service and live DB tests
  provide component evidence, but this audit does not claim cross-system transaction
  behavior or production recovery. The archive is separate from PostgreSQL by design.
- **Residuals:** no actual installation revocation was performed; no production-sized
  archive restore rehearsal, production key custody audit, deployment review, or
  human UI acceptance was performed in this session. No concrete exploitable defect
  was found in the reviewed evidence; these are verification limits, not findings of
  safety.

## Manual Persian RTL acceptance checklist — NOT RUN

No operator performed this checklist in this session. Do not mark a row passed until
the operator records the test build SHA, date/time, environment, result, and redacted
screenshots/log correlation IDs. Use disposable databases and ephemeral test keys.

| UI path | Reproducible operator action | Expected evidence | Result |
|---|---|---|---|
| Owner login and authorization | Sign in as bootstrap Owner Admin, complete forced password change; create a new License Operator with no grants; attempt licensing views/actions, then grant minimum permissions and retry | Default deny before grant; only permitted actions after grant; no sensitive error details | NOT RUN |
| Owner customer/installation/profile | Create a customer; obtain installation ID from test customer runtime; register with exact re-entry/confirmation; configure a valid limit profile | Persisted customer code, identity, active profile, module and numeric ceilings | NOT RUN |
| Owner prepare/review | Select persisted customer, identity, active signing key and profile; prepare license; review fields and both SHA-256 digests | Review exactly matches snapshot; request and digests available; no private key in Owner web process | NOT RUN |
| Offline signing/download/import | Download request; check payload digest independently; sign with supported test signer; import signed artifact; download archived artifact | API success and exact byte equality/hash; Owner durable issuance/archive records | NOT RUN |
| Customer import/activation/status | Import downloaded bytes through customer licensing page; wait for backend `GET /license/current` re-read | Workspace unlock only after server state; current license/version, identity, dates, limits/modules and operation ID match | NOT RUN |
| Renewal and supersession | Prepare/import an early renewal, then separately supersede another version | Same customer/code; correct lineage; early renewal does not shorten current entitlement; prior history retained | NOT RUN |
| Grace and Read-Only | With test clock or deterministic test deployment, inspect before expiry, within days 1–14 Grace, and after Grace; attempt one permitted and one prohibited operation per policy | Backend permits login/view/print/export/backup/status/renewal; backend rejects mutations after Grace | NOT RUN |
| Revocation/status/recovery | Prepare and import a VREV1 against persisted license; download exact artifact; import at customer; replay; try old license; issue new license for recovery | Owner receipt alone does not block customer; only backend-confirmed customer revoked status blocks; replay is safe; old license cannot resurrect | NOT RUN |
| UI authorization errors | Repeat restricted route/action as non-admin operator and customer user without revoke permission | Stable error code, no unintended row/audit/archive changes | NOT RUN |

## Next actions and decision status

1. Engineering: add a dedicated, non-skipping cross-application acceptance test that
   exercises real Owner and customer endpoints against two separately migrated,
   disposable PostgreSQL databases and asserts API outcomes **and** persisted state.
   Reuse the existing lifecycle, live persistence, and `verify:interop` coverage;
   do not replace them or modify PR #192.
2. CI: this documentation-only audit PR must at least pass its applicable `docs`
   and `ci-gate` jobs on its exact PR head. The follow-up code PR must run the new
   combined suite and all classifier-applicable checks on that exact code head.
3. Product Owner / test operator: nominate an operator and test installation for the
   Persian RTL checklist. No new product decision is requested; existing PDR-19,
   PDR-14, PDR-16, PDR-18, and revocation protocol decisions remain controlling.

**Final acceptance status: BLOCKED.** The existing implementation and component
coverage are substantial, and current base CI is green, but Option C's required
cross-application dual-database run and actual manual UI evidence are outstanding.
