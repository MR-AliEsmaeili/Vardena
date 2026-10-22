# Licensing Option C — current-state acceptance audit (2026-10-22)

## Executive disposition

**Status: BLOCKED. Licensing is not fully verified against Option C.**

This audit re-checks the exact current `main` snapshot and separates implementation,
component-test, CI, cross-application, and manual evidence. Owner Licensing and the
customer runtime remain separate applications with separate databases. No accepted
product or protocol decision was changed, and no code defect or contradiction with
PDR-19 was demonstrated in this audit.

The initial audit found a missing combined test. This PR now adds a required
Owner-to-customer acceptance suite and a fresh, dual-database CI step. Local static
checks pass, and missing/unavailable-URL paths fail explicitly. First combined CI
attempt on `c54cf5914e93b5e5504ede1221b038590351de8c` failed at Owner signing-key
fixture setup because its harmless `notes` text included the server-forbidden phrase
`private key`; the fixture note was changed to neutral text. Second combined CI attempt
on `646da4f3cfaf1a042b731ed09d7a539008e6bcee` reached the real applications but failed
because Vitest's worker did not load the generated customer Prisma TypeScript client
when the test imported cross-project source; the command was then tried with the `tsx`
ESM loader and customer backend `tsconfig.json` (including decorators). Third combined
CI attempt on
`596e95ea2789f691b1c096f6772ef1ad98e0776d` still failed: importing customer source
outside the Owner Vitest root left Prisma's generated `.js` import outside Vitest's
module resolver. The runner now delegates execution to a dedicated customer-root
Vitest config so real customer modules and generated client stay in the normal app
module graph. Fourth combined CI attempt on
`9af1f0a556fd0e4ec1dc023b4470ad888b985a26` reached role setup but failed because the
fixture assigned every registered permission, including modules not granted by the
artifact; the product correctly denied an Accounting permission. The fixture now
starts with only the unconditionally available `Licensing.License.Activate` bootstrap
permission, then grants its other necessary permissions after customer activation.
Fifth
combined CI attempt on `22351e42861e73725b4d82284bd12980f84f4af0` reached the tamper
case but the Owner's fixed 2030 clock made a DB-created request appear expired against
PostgreSQL's current clock; the test now captures Owner PostgreSQL time once and uses
that exact instant for the deterministic Owner/customer clock and offline signer.
Sixth combined CI attempt on `5fb20618bb7a54ecf98b550aa4bd6ada22c229fc` passed the
Owner expiry/tamper path but failed in the isolated signer's payload-mismatch helper:
JSON transport had converted payload `Date` fields to strings. The signer now revives
the protocol date fields in its own process before canonicalization. Seventh combined
CI attempt on `cc01b0186c7bc79d5ebce18509baf9140e972350` passed the Owner signer and
binding cases but customer import returned 403: the unlicensed fixture role lacked the
platform `Licensing.License.Activate` permission. The test now grants that bootstrap
permission before activation, and only assigns `License.Revoke` plus Organization
permissions after customer persistence confirms activation. Ninth combined CI attempt
on `671ce7c3545f7dd148ce670bf3d75371cbd8067b` passed the Owner tamper, binding and
customer auth gates, then failed an assertion that compared PostgreSQL's numeric
artifact byte-size value to a string. The assertion now compares numeric types. The
live dual-PostgreSQL flow remains **BLOCKED pending a passing exact-final-head CI run**.
`verify:interop` and existing Owner/customer tests remain component coverage, not
substitutes for the combined run. The critical Persian RTL workflow was not driven
by a human operator.

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
- At initial audit time, the only open PR was [#192](https://github.com/MR-AliEsmaeili/Vardena/pull/192),
  head `bb055f9d0b2e654f1a9f79e09258180bcde50c5b`. Its CI run
  [39693999819](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39693999819)
  passed `classify`, `frontend`, `generated-api-client`, and `ci-gate`; `docs` and
  `backend` were skipped. It is unrelated frontend coverage and was not modified.
- This audit is submitted as [PR #193](https://github.com/MR-AliEsmaeili/Vardena/pull/193).
  Its first CI run [39698666695](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39698666695)
  passed on head `d2f73428356c50ab258d00d41ade112507a5406a`: `classify`, `docs`,
  and `ci-gate` passed; backend, frontend and generated-client jobs were correctly
  skipped for the documentation-only change. A later documentation-only refresh of
  this audit needs its own check run; the PR checks page is authoritative for the
  latest exact SHA.
- First combined acceptance CI attempt: [run 39702199010](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39702199010)
  on exact head `c54cf5914e93b5e5504ede1221b038590351de8c` failed at the required dual-DB
  test. The Owner API correctly rejected test signing-key metadata with HTTP 400
  because its `notes` fixture text contained the forbidden `private key` phrase;
  the fixture was changed to neutral text. All earlier backend steps and the other
  CI jobs passed. This is a corrected test-fixture failure, not a product API change.
- Second combined acceptance attempt: [run 39702748443](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39702748443)
  on exact head `646da4f3cfaf1a042b731ed09d7a539008e6bcee` reached real app setup but
  failed because Vitest could not load the generated customer Prisma TypeScript client
  through its dynamic `.js` import when loading cross-project source. The acceptance
  attempt used Vitest with `NODE_OPTIONS=--import=tsx` and
  `TSX_TSCONFIG_PATH=../../backend/tsconfig.json`; no production loader or service
  code was changed. Frontend, generated-client and docs jobs passed.
- Third combined acceptance attempt: [run 39703367826](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39703367826)
  on exact head `596e95ea2789f691b1c096f6772ef1ad98e0776d` still failed because customer
  source imported from outside the Owner Vitest root left Prisma's generated `.js`
  import outside Vitest's module resolver. The runner now delegates to a dedicated
  customer-root Vitest config so the real customer app and generated client stay in
  the normal module graph. Frontend, generated-client and docs jobs passed.
- Fourth combined acceptance attempt: [run 39704794416](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39704794416)
  on exact head `9af1f0a556fd0e4ec1dc023b4470ad888b985a26` reached real service/API
  execution but failed while preparing the fixture role: it attempted to grant every
  registry permission, including `Accounting.Account.Create`, although this test
  artifact grants only Organization/Users modules. License-gated assignment correctly
  denied it. The fixture now creates the role empty before activation, then assigns
  only `Organization.Organization.View` and `Organization.Organization.Create` after
  customer persistence confirms activation. This preserves real entitlement checks.
  Other CI jobs passed.
- Fifth combined acceptance attempt: [run 39705475724](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39705475724)
  on exact head `22351e42861e73725b4d82284bd12980f84f4af0` reached the real Owner
  tamper path but returned `InvalidTransition` rather than the expected signature
  refusal. The fixture's 2030 app clock was ahead of PostgreSQL's real `requested_at`,
  so Owner correctly expired the prepared request. The test now captures
  `clock_timestamp()` from the disposable Owner DB, uses that instant as its frozen
  app/customer clock, and passes it explicitly to the offline signer.
- Sixth combined acceptance attempt: [run 39706220846](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39706220846)
  on exact head `5fb20618bb7a54ecf98b550aa4bd6ada22c229fc` reached the signed tamper
  and binding cases but failed in the signer's mismatch helper because JSON transport
  converted `Date` fields to strings. The isolated signer now reconstructs the signed
  protocol dates before canonicalization; no production protocol behavior changed.
  Other jobs passed.
- Seventh combined acceptance attempt: [run 39706773283](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39706773283)
  on exact head `cc01b0186c7bc79d5ebce18509baf9140e972350` passed Owner's expiry and
  tampered-signature assertions, then failed in the signer's binding-mismatch helper
  on the same JSON `Date` serialization issue. The worker now revives `validFrom`,
  `validUntil` and `issuedAt` before canonicalizing test payloads; other CI jobs passed.
- Eighth combined acceptance attempt: [run 39707257267](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39707257267)
  on exact head `a75aa75f7397184f17f9f27103ff9ed35bc18f92` passed the tamper and
  binding-rejection assertions, then got HTTP 403 at the customer's required
  authenticated import route. The setup user had no `Licensing.License.Activate`,
  which is intentionally required even before an installation is licensed. The test
  now grants that platform bootstrap permission pre-activation and waits for persisted
  customer activation before granting `License.Revoke` and Organization permissions.
  Other CI jobs passed.
- Ninth combined acceptance attempt: [run 39707721579](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39707721579)
  on exact head `671ce7c3545f7dd148ce670bf3d75371cbd8067b` passed the Owner tamper,
  binding and customer auth assertions; Owner archive persistence reached its byte-size
  check, which compared a PostgreSQL numeric value to a string. The assertion now
  compares numeric values; other CI jobs passed.
- Environment: Node `v22.22.3`, npm `10.9.8`; no `psql`, `pg_isready`, or Docker
  executable was available. No database URLs were set. Therefore no local live-DB
  run is claimed. The repository's CI at the base SHA did run live DB tests, but it
  did not run a combined Owner-to-customer acceptance flow.

## Gap matrix

| Requirement | Current implementation | Existing test/evidence | Missing evidence | Exact next action | Status |
|---|---|---|---|---|---|
| Separate Owner/customer applications and databases; no Owner-to-customer connection | Owner and customer remain separate apps/databases; the acceptance suite receives two URLs, verifies reachability, checks the acceptance-only name marker and rejects equal database identities | Base CI run 39657663222 passed Owner image/isolation checks; new suite has explicit URL, availability, distinct-database and empty-state assertions | Exact-head live run pending; no app-to-app network connection is added | Run `owner-licensing/backend: npm run test:acceptance` from CI after provisioning two fresh databases | BLOCKED pending exact-head CI |
| Owner administrator bootstrap/authentication and real-record issuance preparation | New suite bootstraps/migrates a fresh Owner DB and uses authenticated Owner APIs to persist customer, confirmed installation identity, profile, public signing-key metadata and issuance/request digests | New `owner-licensing/backend/test/owner-customer-acceptance.test.ts` asserts those persisted records and IDs | Exact-head live run pending | Run the required acceptance command on two fresh PostgreSQL DBs | BLOCKED pending exact-head CI |
| Offline signing and exact-byte Owner import/archive | A dedicated child-process test signer generates the ephemeral key; only the public key reaches Owner/customer services. It signs the persisted Owner request, and Owner imports/downloads the archived artifact through authenticated APIs | New combined suite compares signer envelope, Owner download bytes, archived digest/size, and customer request body; Owner remains unaware of private key | Exact-head live run pending | Run the dual-DB acceptance suite; no private key is written or passed to Owner/customer process | BLOCKED pending exact-head CI |
| Customer import and backend-confirmed activation persistence | New suite posts the Owner-downloaded exact bytes to authenticated customer `POST /api/v1/license/import`, then reads authenticated `GET /api/v1/license/current` and PostgreSQL licensing rows | Assertions cover customer/installation/license/operation/version, signature key ID, raw artifact hash, validity dates, entitlement rows, limits, typed audit and effective status | Exact-head live run pending | Run the required acceptance command against fresh separate DBs | BLOCKED pending exact-head CI |
| Tamper, signer/binding mismatch, replay/conflict; stable errors and retained state | New suite tests tampered signature, alternate private signer falsely claiming the pinned test key ID, signed Owner request binding mismatch, wrong customer binding, Owner conflicting replay and customer duplicate operation | Each rejected Owner/customer request asserts a stable HTTP/code/reason and unchanged issuance/license/version/entitlement/revocation/organization state; designed rejection audit rows are counted separately | Malformed and every possible lineage/error variant remain covered by component tests, not this combined scenario; exact-head run pending | Run exact-head CI; retain component-only distinctions | BLOCKED pending exact-head CI |
| Duplicate/replayed issuance and revocation; stale revocation; old license after revocation | New suite exercises Owner license archive replay/conflict, customer duplicate license refusal, Owner VREV1 preparation/sign/import/archive replay, customer VREV1 import/replay and refusal to re-import the revoked renewal | Real authenticated APIs and two PostgreSQL stores; customer current state and revocation/audit rows inspected | Stale-revocation dates remain component coverage only; exact-head run pending | Run exact-head CI; do not infer activation/revocation from Owner archive state | BLOCKED pending exact-head CI |
| Expired/abandoned prepared request and rejected lineage target | Owner has a fixed 14×24-hour prepared-request age, terminal abandonment and same-customer recorded-lineage validation | Owner `licensing.test.ts` and `licensing-lifecycle.test.ts` cover injected-clock boundaries, abandonment, immutable snapshot, operator denial and unknown lineage target; CI base run passed those suites | No combined acceptance record asserts stable API errors plus Owner/customer/archive state for these cases within a cross-app flow | Include expiry/abandonment and rejected renewal/supersession target cases in the dual-DB acceptance suite; snapshot issuance, audit and artifact counts before/after | BLOCKED |
| Positive renewal and early import; separate supersession with retained signed history | Combined suite prepares/signs/imports an Owner renewal against the persisted predecessor; early customer import leaves the predecessor effective and exposes the signed end date at `governsFrom` | Customer versions and `license.import.renewed` audit are queried; effective state is checked before and at hand-over | Supersession is not part of the combined case; continue to rely on separate component tests. Exact-head live run pending | Run exact-head CI and keep supersession listed as component-only | BLOCKED pending exact-head CI |
| Grace exactly 14×24 hours UTC and Read-Only allowances/refusals | Combined suite freezes customer time and exercises actual customer status, organization view/create and post-Grace write denial; login is repeated at the simulated boundaries | Current route reports Grace then Read-Only; a Grace write succeeds subject to its signed cap; Read-Only preserves view/status and rejects mutation with stable reason | Print/export/backup-specific endpoint checks are not in this combined scenario; existing policy tests cover permission classification; human UI still NOT RUN | Verify exact-head CI and retain endpoint/manual residuals | BLOCKED pending exact-head CI; manual NOT RUN |
| Module and numeric ceiling enforcement | Combined profile/artifact grants organization and user modules with an organization cap; actual organization API creates to the cap and rejects the next create in Grace | Current persisted signed limits/entitlements and organization row count are asserted | Exact-head live run pending; user-cap boundary is component coverage only | Run exact-head CI and retain module/user-specific distinction | BLOCKED pending exact-head CI |
| Signed revocation and archive recovery | Combined suite prepares, signs, records, downloads and imports VREV1; customer remains unrevoked until its real authenticated import, then persists one revocation and refuses the old license | Customer revocation table, exact artifact hash, typed audit and current-state API are asserted; replay is unchanged | No production-sized archive-restore rehearsal or post-revocation recovery issuance is claimed; exact-head run pending | Run exact-head CI; archive presence alone is never stated as customer revocation | BLOCKED pending exact-head CI |
| Critical Owner/customer Persian RTL UI paths | Both SPAs implement licensing pages/forms and Persian RTL translations | Owner and customer frontend test suites passed locally on 2026-10-22 | No actual human operation in the UI; automated UI tests do not count as manual acceptance | Named operator executes checklist below in a staging/test installation and records date, build SHA, result and redacted evidence | NOT RUN |
| Full CI on final PR head | Base SHA has a fully green CI run; this docs-only PR uses change-aware checks | Run 39698666695 passed on exact tested SHA `d2f73428356c50ab258d00d41ade112507a5406a` (`classify`, `docs`, `ci-gate`); backend/frontend/generated-client skipped as not applicable | The combined acceptance test is absent; a docs-only green run cannot satisfy the Option C CI requirement. Check PR #193 for the latest run after this audit update | Require `docs` and `ci-gate` on this docs-only PR's current exact head. The follow-up code PR that adds the combined test must run all classifier-applicable backend/customer live-DB, Owner integration, frontend, generated-client, docs and gate checks on that code PR head | BLOCKED |

## Command record (historical audit plus implementation follow-up)

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
| `gh pr create --base main --head arena/70985c35-vardena ...` | Created focused documentation audit PR #193: https://github.com/MR-AliEsmaeili/Vardena/pull/193 |
| `gh run watch 39698666695 --exit-status` | Passed at the then-current PR head `d2f73428356c50ab258d00d41ade112507a5406a`: `classify`, `docs`, `ci-gate`; other jobs skipped as not applicable |
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
| From `owner-licensing/backend`: `npm run typecheck:acceptance` | Passed; acceptance test and imported customer production-pipeline source type-check on this branch |
| From `owner-licensing/backend`: `npm run typecheck && npm run lint && npm run format:check` | Passed; 0 lint warnings/errors |
| From `owner-licensing/backend`: `node --import tsx test/support/offline-acceptance-signer.ts </dev/null` | Passed signer subprocess startup; emitted ephemeral public key only; private key not emitted or persisted |
| From `owner-licensing/backend`: `npm run test:acceptance` with both DB URLs unset | Failed explicitly at suite import with `OWNER_ACCEPTANCE_DATABASE_URL is required`; no success/skip path exists |
| From `owner-licensing/backend`: `npm run test:acceptance` with two acceptance-marked URLs at `127.0.0.1:1` | Failed explicitly in `beforeAll` with `Both disposable PostgreSQL databases must be reachable` / `ECONNREFUSED`; Vitest labels the test body skipped only because the setup hook failed, but the suite is **failed**, not skipped/passed. No `skipIf`/`it.skip` is used. |
| Owner→customer dual-PostgreSQL acceptance against live services | **Not run locally**: no PostgreSQL tooling/service or disposable DB URLs. Required CI suite is implemented; exact-head CI result is recorded below after it runs. |

The known lint warnings are unrelated to code changes in this audit. Frontend build
warnings from third-party Zod pure-comment annotations and existing chunk-size
limits were non-fatal; builds succeeded.

## Security review summary

- **Private signing keys:** the new combined test starts a dedicated signer child process
  with a sanitized environment containing no database URLs. That process generates
  its ephemeral key and holds the private key; the Owner and customer processes receive
  only public material. The signing request/digest and signed public artifact cross the
  test boundary; no private key is written, logged, committed or uploaded.
- **Trust and signed bytes:** VLIC2/VREV1 canonical formats, vectors, signed fields,
  and public error contracts were not changed. Interop checks cryptographic parsing
  and some negative cases only; service/persistence binding still requires the
  combined suite.
- **Isolation:** Owner code still has no customer DB connection; Owner exclusion from
  the customer production image remains checked by CI. The new suite requires two
  separate URLs with an `acceptance` database-name marker, probes both identities,
  rejects same-database targets and requires empty licensing/application state.
- **Replay/transactions/archive:** the combined suite verifies each application's
  own API transaction and persisted facts; it does not create a cross-database
  transaction. Owner archive and customer activation remain separate operations by
  design. Production backup independence and restore readiness are not claimed.
- **Residuals:** full dual-database execution awaits the exact final-head CI result.
  Supersession, stale-revocation, post-revocation recovery and every Print/Export/Backup
  route are not all repeated in the new combined scenario; they remain component or
  manual evidence. No production-sized archive restore rehearsal, production-key
  custody audit, deployment review, or human UI acceptance was performed. This is not
  a claim of full licensing-system completion or a finding of safety.

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

1. **CI verification:** the implementation adds the required non-skipping combined
   suite and a CI step that creates fresh `vardena_owner_acceptance` and
   `vardena_customer_acceptance` PostgreSQL databases, applies customer migrations,
   then runs `npm run test:acceptance` from `owner-licensing/backend`. Record the
   exact run URL and head SHA here after completion; do not treat a docs-only PR run
   as acceptance evidence.
2. **Manual operator work:** the Persian RTL checklist below remains **NOT RUN**.
   A named operator must record test build SHA/date/result and redacted evidence in
   a disposable environment. In particular, print/export/backup and UI recovery
   actions are not implied by the API scenario.
3. **Scope:** do not change PR #192, accepted PDR/protocol/public error contracts,
   historical migrations, or Owner/customer separation. Do not claim a revocation
   until the customer API has persisted it, and do not label component tests as
   combined-flow proof.

**Disposition: BLOCKED pending exact-head live CI and manual Persian RTL acceptance.**
The new acceptance implementation is present, but until its two-database CI run passes
on the final PR head, the requested combined evidence is not established. Manual RTL
acceptance and the residual coverage listed above remain outstanding regardless of CI.
