# Licensing Option C — current-state acceptance audit (2026-10-22)

## Executive disposition

**Status: READY FOR REVIEW.** The required combined Owner-to-customer acceptance passed
on implementation head `7153b3763f61e18a62876cf8585c686b3226c7f0` in CI run
[39711315248](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39711315248),
including two fresh distinct PostgreSQL databases and all classifier-applicable CI
jobs. The subsequent documentation-only audit head `ba92fce267638e0735dc504020ce7440ea8ae508`
also passed all applicable CI in run
[39740988959](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39740988959).
This is not a claim of full licensing-system completion: manual Persian RTL acceptance
remains **NOT RUN**, and the residual/component-only cases below remain explicitly
distinguished. The current citation refresh is documentation-only and will receive its
own exact-head CI run before review.

This audit re-checks the exact PR base `92586fa87b7aa678fc26dddcc775b54eddbc15c3`
and separates implementation, component-test, CI, cross-application, and manual
evidence. Owner Licensing and the customer runtime remain separate applications with
separate databases. No accepted product or protocol decision was changed, and no code
defect or contradiction with PDR-19 was demonstrated in this audit.

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
permissions after customer persistence confirms activation. Eighth combined CI attempt
on `a75aa75f7397184f17f9f27103ff9ed35bc18f92` failed with HTTP 403 because the fixture
role lacked that bootstrap permission; it is granted before activation now. Ninth
combined CI attempt on `671ce7c3545f7dd148ce670bf3d75371cbd8067b` passed the Owner tamper, binding and
customer auth gates, then failed an assertion that compared PostgreSQL's numeric
artifact byte-size value to a string. The assertion now compares numeric types. Tenth combined CI attempt on
`818b64415324c3e13f6dabe8bae121f2de7d7778` passed Owner archival and customer import,
then exposed that `license_versions.document_hash` is the hash of the signed VLIC2
document, not the outer archived envelope bytes. The checks now distinguish the
artifact SHA-256 from the signed-document digest, and assert both raw artifact and
canonical-payload hashes for customer revocation persistence. Eleventh combined CI
attempt on `e61de3e8d6bc32f52bbee41290cf570183aae7b7` verified the corrected
signed-document digest assertion, then showed that the wrong-customer case reused the
already-applied operation ID and was therefore correctly rejected first as
`duplicate-operation`. That negative fixture now uses distinct operation and license
IDs so it reaches the intended customer binding check. Twelfth combined CI attempt
on `6ed38f669bce63bfefb2d3318ce256b1655b64fe` reached the audit-count assertion; the
snapshot correctly contained three events (one applied activation plus two
pre-activation signature rejections), not four. The test now checks that exact count
and verifies the later customer-binding rejection audit rows and unverified-signature
audit fields explicitly. Thirteenth combined CI attempt on
`a249a1a85a60ab92239b9b698e66b8cb3fa95fd0` passed those checks and reached the
Read-Only mutation refusal, where the fixture expected an internal `license_read_only`
detail that is intentionally not exposed by the authorization guard's existing public
403 contract. Fourteenth attempt on `9aade497a2ab94aff08e317b2fe03e878bf6d3ef` then
showed the public code is `PermissionDenied`, not the generic `Forbidden`; the test now
pins the exact established code and retained state. Component tests continue to pin
internal Read-Only policy details. Fifteenth combined CI attempt on
`aa7e503ef5817e87bbcf26cf7dc1e25f52e26082` passed Read-Only enforcement and reached
customer revocation persistence. The existing customer service stores the canonical
VREV1 payload digest in both `artifact_sha256` and `canonical_payload_sha256`; the
fixture had expected the outer JSON-envelope digest in the former. It now follows the
implemented customer persistence contract while separately asserting Owner's raw
archived-artifact SHA-256 and exact-byte transport. No product or protocol behavior
changed. Sixteenth combined CI attempt: [run 39711315248](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39711315248)
on exact implementation head `7153b3763f61e18a62876cf8585c686b3226c7f0` passed the
required dual-PostgreSQL acceptance step and all classifier-applicable jobs: `classify`,
`backend`, `frontend`, `generated-api-client`, `docs`, and `ci-gate`. This is the first
successful live combined-flow run; the run creates separate disposable Owner and
customer PostgreSQL databases, and no local live-DB pass is claimed. The documentation-only follow-up on exact head
`ba92fce267638e0735dc504020ce7440ea8ae508` also passed run 39740988959 across all six
applicable jobs, including the required acceptance step. This current audit citation
refresh itself requires a subsequent exact-head run. `verify:interop` and existing
Owner/customer tests remain component coverage, not substitutes for the combined run.
The critical Persian RTL workflow was not driven by a human operator.

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
- Successful combined acceptance: [run 39711315248](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39711315248)
  completed with conclusion `success` on exact implementation head
  `7153b3763f61e18a62876cf8585c686b3226c7f0`. All six applicable jobs passed:
  `classify`, `backend`, `frontend`, `generated-api-client`, `docs`, and `ci-gate`.
  The backend step `Required Owner-to-customer dual-PostgreSQL acceptance` passed,
  as did existing Owner PostgreSQL, customer live PostgreSQL, licensing, and E2E suites.
  PR #193's base remains `92586fa87b7aa678fc26dddcc775b54eddbc15c3`; the run verifies
  implementation head `7153b37...`. The audit-only follow-up commit will require a
  fresh full CI run on its exact resulting head.
- Exact audit-head verification: [run 39740988959](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39740988959)
  completed with conclusion `success` on exact SHA
  `ba92fce267638e0735dc504020ce7440ea8ae508`. All six jobs passed, including backend
  `Required Owner-to-customer dual-PostgreSQL acceptance`, frontend, generated API
  client, docs and `ci-gate`. This head differs from the tested implementation head
  `7153b37...` only by the traceability-document update; this follow-up therefore
  confirms the combined flow and all required CI on an audit-updated head.
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
- Tenth combined acceptance attempt: [run 39708270039](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39708270039)
  on exact head `818b64415324c3e13f6dabe8bae121f2de7d7778` passed archival and
  authenticated customer activation, then failed because the test equated the VLIC2
  document digest in customer persistence with the outer artifact-envelope digest.
  Assertions now verify each digest according to its distinct persisted contract,
  including raw/canonical hashes for customer revocation. Other CI jobs passed.
- Eleventh combined acceptance attempt: [run 39708752719](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39708752719)
  on exact head `e61de3e8d6bc32f52bbee41290cf570183aae7b7` passed the revised digest
  assertion, then the wrong-customer case returned `duplicate-operation` because it
  reused the activated license's operation ID. The negative fixture now assigns unique
  operation and license IDs to reach the intended customer-binding rejection. Other
  CI jobs passed.
- Twelfth combined acceptance attempt: [run 39709253540](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39709253540)
  on exact head `6ed38f669bce63bfefb2d3318ce256b1655b64fe` reached an incorrect
  expectation of four audit events; the snapshot had three—one applied activation and
  two unverified signature rejections. The fixture now asserts that exact pre-binding
  count and checks the later binding-rejection audit details directly. Other CI jobs
  passed.
- Thirteenth combined acceptance attempt: [run 39709779746](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39709779746)
  on exact head `a249a1a85a60ab92239b9b698e66b8cb3fa95fd0` passed through Grace,
  then reached the Read-Only mutation refusal. The fixture expected an internal reason
  in the API body, but the established authorization guard returns the stable public
  `Forbidden` code without that detail. The assertion was changed to check the public
  403 code and retained state. Other CI jobs passed.
- Fourteenth combined acceptance attempt: [run 39710257851](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39710257851)
  on exact head `9aade497a2ab94aff08e317b2fe03e878bf6d3ef` confirmed the actual public
  denial code is `PermissionDenied`, not `Forbidden`. The fixture now asserts the exact
  existing code and verifies persisted state remains unchanged. Other CI jobs passed.
- Fifteenth combined acceptance attempt: [run 39710676331](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39710676331)
  on exact head `aa7e503ef5817e87bbcf26cf7dc1e25f52e26082` passed the Read-Only
  public denial, then showed customer `license_revocations.artifact_sha256` matches the
  canonical VREV1 payload digest (the same value as `canonical_payload_sha256`), rather
  than the outer envelope digest. The assertion now matches that persisted service
  contract; Owner's envelope digest check remains separate. Other CI jobs passed.
- Environment: Node `v22.22.3`, npm `10.9.8`; no `psql`, `pg_isready`, or Docker
  executable was available. No database URLs were set. Therefore no local live-DB
  run is claimed. The repository's CI at the base SHA did run live DB tests, but it
  did not run a combined Owner-to-customer acceptance flow.

## Gap matrix

| Requirement                                                                                | Current implementation                                                                                                                                                                                                                               | Existing test/evidence                                                                                                                                                                                                                | Missing evidence                                                                                                                                            | Exact next action                                                                                                   | Status                                                                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Separate Owner/customer applications and databases; no Owner-to-customer connection        | Owner and customer remain separate applications and databases; no inter-app API/DB connection was added. CI provisions two fresh disposable PostgreSQL DBs; the suite rejects missing/unreachable/equal DBs and nonempty/incorrectly marked targets. | Run 39711315248 passed on implementation head `7153b3763f61e18a62876cf8585c686b3226c7f0`; isolation checks and production-image exclusion passed.                                                                                     | None for this acceptance scope; no production deployment claim.                                                                                             | Verify final audit-only head CI.                                                                                    | PASS — implementation and audit-head CI passed (runs 39711315248, 39740988959)                  |
| Owner administrator bootstrap/authentication and real-record issuance preparation          | Suite migrates/bootstrap fresh Owner DB and uses authenticated Owner APIs to persist customer, confirmed installation, active profile, public signing-key metadata, and issuance/request records.                                                    | Run 39711315248 passed; assertions cover persisted IDs, request digest and bindings.                                                                                                                                                  | None for required combined scenario.                                                                                                                        | Verify final audit-only head CI.                                                                                    | PASS — implementation and audit-head CI passed (runs 39711315248, 39740988959)                  |
| Offline signing and exact-byte Owner import/archive                                        | Separate child-process signer creates ephemeral key; only public material enters Owner/customer. Signed persisted request is imported through Owner API and archived/downloaded through authenticated routes.                                        | Run 39711315248 passed; exact envelope bytes, Owner artifact size/raw SHA-256, signer output and archived download match.                                                                                                             | Production key custody/deployment audit and archive restore rehearsal are outside scope.                                                                    | Retain signer/process isolation; verify final audit-only head CI.                                                   | PASS — implementation and audit-head CI passed (runs 39711315248, 39740988959)                  |
| Customer import and backend-confirmed activation persistence                               | Owner archive does not activate customer. Exact downloaded bytes are sent to authenticated customer import; authenticated current-license API and customer PostgreSQL rows are inspected.                                                            | Run 39711315248 passed; identity/binding, operation/version/key, dates, entitlements/limits, audit and effective state asserted. Customer `document_hash` is distinguished from Owner outer-artifact SHA-256.                         | No production customer DB/credential used.                                                                                                                  | Verify final audit-only head CI.                                                                                    | PASS — implementation and audit-head CI passed (runs 39711315248, 39740988959)                  |
| Tamper, signer/binding mismatch, replay/conflict; stable errors and retained state         | Combined test covers tampered signature, rogue signer claiming pinned key ID, Owner request binding mismatch, wrong customer/installation, conflicting Owner replay and duplicate customer operation.                                                | Run 39711315248 passed; stable HTTP/code/reason and unchanged business state are checked; rejected signature/binding audits are inspected.                                                                                            | Exhaustive malformed/lineage variants remain component coverage, not combined-flow proof.                                                                   | Keep component-only distinction; verify final audit-head CI.                                                        | PASS for listed combined cases; residual variants component-only                                |
| Duplicate/replayed issuance and revocation; stale revocation; old license after revocation | Combined scenario exercises Owner archive replay/conflict, customer duplicate license refusal, VREV1 Owner record/archive replay, customer import/replay and refusal to re-import revoked renewal.                                                   | Run 39711315248 passed; customer current state and persisted revocation/audit rows verified after real API import.                                                                                                                    | Stale-revocation-date variants remain component-only.                                                                                                       | Do not infer customer revocation from Owner archive; retain stale-date caveat.                                      | PASS for listed cases; stale-date variant component-only                                        |
| Expired/abandoned prepared request and rejected lineage target                             | Owner age/abandonment and same-customer lineage rules are implemented and covered by Owner `licensing.test.ts` / `licensing-lifecycle.test.ts`.                                                                                                      | Existing component tests and base CI cover injected-clock boundaries, abandonment, immutable snapshot, operator denial and unknown lineage target.                                                                                    | Not repeated through cross-app acceptance APIs with before/after Owner/customer/archive snapshots.                                                          | Keep component-only; add a combined case only if that cross-app proof is separately required.                       | PARTIAL — component-tested; not in combined flow                                                |
| Positive renewal and early import; separate supersession with retained signed history      | Combined flow signs/imports a renewal from persisted Owner predecessor; early import leaves predecessor effective until handover.                                                                                                                    | Run 39711315248 passed; version lineage, `governsFrom`, current API and `license.import.renewed` audit asserted.                                                                                                                      | Separate supersession remains component-only.                                                                                                               | Preserve the distinction; verify final audit-head CI.                                                               | PASS for renewal; supersession component-only                                                   |
| Grace exactly 14×24 hours UTC and Read-Only allowances/refusals                            | Combined test exercises customer current/status, authenticated organization read, capped write during Grace, then Read-Only read and blocked mutation after exact 14-day boundary.                                                                   | Run 39711315248 passed; `PermissionDenied` public code and unchanged persisted state checked.                                                                                                                                         | Print/export/backup-specific routes and human UI paths are not exercised in this combined flow.                                                             | Keep endpoint/manual residual explicit; manual checklist remains NOT RUN.                                           | PASS for tested API policy; manual/UI NOT RUN                                                   |
| Module and numeric ceiling enforcement                                                     | Combined signed profile grants Organization and Users modules with caps; actual organization API creates to cap and rejects next create.                                                                                                             | Run 39711315248 passed; signed entitlement and persisted organization count/limit asserted.                                                                                                                                           | User-cap boundary remains component coverage only.                                                                                                          | Preserve scope distinction.                                                                                         | PASS for Organization cap; Users cap component-only                                             |
| Signed revocation and archive recovery                                                     | Combined flow prepares/signs/records/downloads VREV1; customer is unchanged before authenticated import, then persists revocation, safely replays and refuses old renewal.                                                                           | Run 39711315248 passed; Owner outer-envelope digest is checked separately; customer canonical payload digest and audit/current state are inspected.                                                                                   | No production-sized archive restore rehearsal or post-revocation recovery issuance is claimed.                                                              | Do not describe archive alone as applied revocation; retain recovery caveat.                                        | PASS for signed import/replay/old-license refusal; recovery rehearsal NOT RUN                   |
| Critical Owner/customer Persian RTL UI paths                                               | Both applications implement licensing UI and Persian RTL translations.                                                                                                                                                                               | Automated frontend tests passed; they are not manual acceptance.                                                                                                                                                                      | No human operator performed the critical RTL flow.                                                                                                          | Named operator runs checklist below in disposable environment and records build SHA/date/results/redacted evidence. | NOT RUN                                                                                         |
| Full CI on final PR head                                                                   | CI workflow provisions two separate fresh disposable databases and requires `npm run test:acceptance`; no silent skip.                                                                                                                               | Run 39711315248 passed all applicable jobs on implementation head `7153b3763f61e18a62876cf8585c686b3226c7f0`: `classify`, `backend`, `frontend`, `generated-api-client`, `docs`, `ci-gate`; required combined acceptance step passed. | Run 39740988959 passed on audit head `ba92fce267638e0735dc504020ce7440ea8ae508`; current citation refresh changes PR head and needs a fresh exact-head run. | Verify green CI on this current citation-refresh head before review.                                                | PASS on audit head `ba92fce267638e0735dc504020ce7440ea8ae508`; citation-refresh head CI pending |

## Command record (historical audit plus implementation follow-up)

All commands ran from the indicated directory. Dependency installation used
`npm ci --ignore-scripts --no-audit --no-fund`; no lockfiles or source files were
changed by installs.

| Command                                                                                                                                                                                                                                                                                              | Result                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git fetch origin main`; `git rev-parse origin/main`; `git rev-parse HEAD`                                                                                                                                                                                                                           | `origin/main=92586fa87b7aa678fc26dddcc775b54eddbc15c3`; initial `HEAD` matched exactly                                                                                                                                                                                   |
| `gh pr list --state open --json number,title,headRefName,baseRefName,url`                                                                                                                                                                                                                            | Only open PR #192, frontend coverage                                                                                                                                                                                                                                     |
| `gh pr view 191 --json ...`                                                                                                                                                                                                                                                                          | Merged; head `a3cb6f8...`; merge commit current base `92586fa...`; all six checks successful                                                                                                                                                                             |
| `gh run view 39657663222 --json ...`                                                                                                                                                                                                                                                                 | Exact base SHA CI successful; all six jobs passed; backend included fresh Owner migrations/API and customer live DB licensing suites                                                                                                                                     |
| `gh run list --commit 92586fa87b7aa678fc26dddcc775b54eddbc15c3 ...`                                                                                                                                                                                                                                  | Failed: installed `gh` reports `unknown flag: --commit`; reran successfully with `gh run list --branch main` and inspected exact SHA via `gh run view 39657663222`                                                                                                       |
| `gh pr view 192 --json ...`                                                                                                                                                                                                                                                                          | Head `bb055f9...`; classify/frontend/generated-client/ci-gate passed; backend/docs skipped                                                                                                                                                                               |
| `gh pr create --base main --head arena/70985c35-vardena ...`                                                                                                                                                                                                                                         | Created focused documentation audit PR #193: https://github.com/MR-AliEsmaeili/Vardena/pull/193                                                                                                                                                                          |
| `gh run watch 39698666695 --exit-status`                                                                                                                                                                                                                                                             | Passed at the then-current PR head `d2f73428356c50ab258d00d41ade112507a5406a`: `classify`, `docs`, `ci-gate`; other jobs skipped as not applicable                                                                                                                       |
| `node --version`; `npm --version`; `command -v psql`; `command -v docker`; `pg_isready`                                                                                                                                                                                                              | Node `v22.22.3`; npm `10.9.8`; psql/docker unavailable; `pg_isready` unavailable                                                                                                                                                                                         |
| `owner-licensing/backend: npm ci --ignore-scripts --no-audit --no-fund`                                                                                                                                                                                                                              | Passed, 208 packages                                                                                                                                                                                                                                                     |
| `backend: npm ci --ignore-scripts --no-audit --no-fund`                                                                                                                                                                                                                                              | Passed, 459 packages                                                                                                                                                                                                                                                     |
| `owner-licensing/frontend: npm ci --ignore-scripts --no-audit --no-fund`                                                                                                                                                                                                                             | Passed, 221 packages                                                                                                                                                                                                                                                     |
| `frontend: npm ci --ignore-scripts --no-audit --no-fund`                                                                                                                                                                                                                                             | Passed, 217 packages                                                                                                                                                                                                                                                     |
| `owner-licensing/backend: npm run verify:interop`                                                                                                                                                                                                                                                    | **7/7 passed** (VLIC2 accept, fields preserved, perpetual variant, one-byte tamper refusal, unknown signer refusal, VREV1 accept, re-aimed revocation refusal). This is domain/protocol interop, not the two-DB acceptance flow.                                         |
| `owner-licensing/backend: npm test`                                                                                                                                                                                                                                                                  | **9 files, 140 tests passed**                                                                                                                                                                                                                                            |
| `owner-licensing/backend: npm run typecheck && npm run lint && npm run format:check && npm run build`                                                                                                                                                                                                | Passed; lint 0 warnings/errors                                                                                                                                                                                                                                           |
| `backend: npm test`                                                                                                                                                                                                                                                                                  | **166 files, 2,262 tests passed**, including licensing unit/service/domain specs                                                                                                                                                                                         |
| `backend: npm run typecheck && npm run lint && npm run format:check`                                                                                                                                                                                                                                 | Passed; lint had 3 pre-existing warnings in `src/tools/generate-licensing-vectors.ts`, `src/modules/accounting/application/coding-structure-accounts.spec.ts`, `src/modules/licensing/domain/licensing-protocol-vectors.spec.ts`; 0 errors                               |
| `backend: npm run build`                                                                                                                                                                                                                                                                             | Passed                                                                                                                                                                                                                                                                   |
| `backend: npm run test:e2e -- test/license-import.e2e-spec.ts test/licensing.e2e-spec.ts test/licensing-activation.e2e-spec.ts`                                                                                                                                                                      | **3 files, 45 tests passed**; these selected E2E tests use the repository's test app/in-memory stores, not live PostgreSQL                                                                                                                                               |
| `owner-licensing/frontend: npm test && npm run typecheck && npm run lint && npm run format:check && npm run build`                                                                                                                                                                                   | **21 files, 268 tests passed**; all checks/build passed                                                                                                                                                                                                                  |
| `frontend: npm test && npm run typecheck && npm run lint && npm run format:check && npm run build`                                                                                                                                                                                                   | **68 files, 485 tests passed**; all checks/build passed                                                                                                                                                                                                                  |
| `python3 scripts/check-docs-links.py`                                                                                                                                                                                                                                                                | Passed after final code work; 338 markdown files, 1,256 relative links, 0 broken                                                                                                                                                                                         |
| `git diff --check`                                                                                                                                                                                                                                                                                   | Passed                                                                                                                                                                                                                                                                   |
| From `owner-licensing/backend`: `npx prettier --check ../../docs/tasks/licensing-e2e-acceptance-2026-10-22.md`                                                                                                                                                                                       | Passed after formatting the audit with Prettier                                                                                                                                                                                                                          |
| From repository root: `python3 scripts/check-docs-links.py`                                                                                                                                                                                                                                          | Passed after this audit update; 338 Markdown files, 1,256 relative links, 0 broken                                                                                                                                                                                       |
| Owner `npm run test:integration`                                                                                                                                                                                                                                                                     | **NOT RUN locally**: no PostgreSQL binaries/service/URL. Base CI did run these tests, but not cross-app orchestrated.                                                                                                                                                    |
| Customer `npm run test:e2e -- test/licensing-persistence-live.e2e-spec.ts`                                                                                                                                                                                                                           | **NOT RUN locally**: live PostgreSQL unavailable. Not run without `VARDENA_TEST_DATABASE_URL`; thus no skipped-as-pass claim. Base CI did run the live suite on base SHA.                                                                                                |
| From `owner-licensing/backend`: `npm run typecheck:acceptance`                                                                                                                                                                                                                                       | Passed; acceptance test and imported customer production-pipeline source type-check on this branch                                                                                                                                                                       |
| From `owner-licensing/backend`: `npm run typecheck && npm run lint && npm run format:check`                                                                                                                                                                                                          | Passed; 0 lint warnings/errors                                                                                                                                                                                                                                           |
| From `owner-licensing/backend`: `node --import tsx test/support/offline-acceptance-signer.ts </dev/null`                                                                                                                                                                                             | Passed signer subprocess startup; emitted ephemeral public key only; private key not emitted or persisted                                                                                                                                                                |
| From `owner-licensing/backend`: `npm run test:acceptance` with both DB URLs unset                                                                                                                                                                                                                    | Failed explicitly at suite import with `OWNER_ACCEPTANCE_DATABASE_URL is required`; no success/skip path exists                                                                                                                                                          |
| CI run 39711315248: `createdb -h localhost -U vardena vardena_owner_acceptance`; `createdb -h localhost -U vardena vardena_customer_acceptance`; `(cd backend && DATABASE_URL="$CUSTOMER_ACCEPTANCE_DATABASE_URL" npm run prisma:deploy)`; `(cd owner-licensing/backend && npm run test:acceptance)` | Passed on exact implementation head `7153b3763f61e18a62876cf8585c686b3226c7f0`; CI supplies separate DB URLs; acceptance plus all applicable CI jobs passed. See [run 39711315248](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39711315248).                  |
| Documentation-only audit-head rerun: run 39740988959                                                                                                                                                                                                                                                 | Passed on exact head `ba92fce267638e0735dc504020ce7440ea8ae508`; all six classifier-applicable jobs passed, including the required dual-PostgreSQL acceptance. See [run 39740988959](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39740988959).                |
| From `owner-licensing/backend`: `npm run test:acceptance` with two acceptance-marked URLs at `127.0.0.1:1`                                                                                                                                                                                           | Failed explicitly in `beforeAll` with `Both disposable PostgreSQL databases must be reachable` / `ECONNREFUSED`; Vitest labels the test body skipped only because the setup hook failed, but the suite is **failed**, not skipped/passed. No `skipIf`/`it.skip` is used. |
| Owner→customer dual-PostgreSQL acceptance against live services                                                                                                                                                                                                                                      | **Not run locally**: no PostgreSQL tooling/service or disposable DB URLs. Required CI suite is implemented; exact-head CI result is recorded below after it runs.                                                                                                        |

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
- **Residuals:** the combined dual-database acceptance passed in CI on implementation
  head `7153b3763f61e18a62876cf8585c686b3226c7f0`; no local live-DB pass is claimed.
  Supersession, stale-revocation dates, post-revocation recovery and every
  Print/Export/Backup route are not all repeated in the combined scenario; they remain
  component/manual evidence. No production-sized archive restore rehearsal,
  production-key custody audit, deployment review, or human UI acceptance was performed.
  This is not a claim of full licensing-system completion or a finding of safety.

## Manual Persian RTL acceptance checklist — NOT RUN

No operator performed this checklist in this session. Do not mark a row passed until
the operator records the test build SHA, date/time, environment, result, and redacted
screenshots/log correlation IDs. Use disposable databases and ephemeral test keys.

| UI path                             | Reproducible operator action                                                                                                                                                               | Expected evidence                                                                                                                                | Result  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Owner login and authorization       | Sign in as bootstrap Owner Admin, complete forced password change; create a new License Operator with no grants; attempt licensing views/actions, then grant minimum permissions and retry | Default deny before grant; only permitted actions after grant; no sensitive error details                                                        | NOT RUN |
| Owner customer/installation/profile | Create a customer; obtain installation ID from test customer runtime; register with exact re-entry/confirmation; configure a valid limit profile                                           | Persisted customer code, identity, active profile, module and numeric ceilings                                                                   | NOT RUN |
| Owner prepare/review                | Select persisted customer, identity, active signing key and profile; prepare license; review fields and both SHA-256 digests                                                               | Review exactly matches snapshot; request and digests available; no private key in Owner web process                                              | NOT RUN |
| Offline signing/download/import     | Download request; check payload digest independently; sign with supported test signer; import signed artifact; download archived artifact                                                  | API success and exact byte equality/hash; Owner durable issuance/archive records                                                                 | NOT RUN |
| Customer import/activation/status   | Import downloaded bytes through customer licensing page; wait for backend `GET /license/current` re-read                                                                                   | Workspace unlock only after server state; current license/version, identity, dates, limits/modules and operation ID match                        | NOT RUN |
| Renewal and supersession            | Prepare/import an early renewal, then separately supersede another version                                                                                                                 | Same customer/code; correct lineage; early renewal does not shorten current entitlement; prior history retained                                  | NOT RUN |
| Grace and Read-Only                 | With test clock or deterministic test deployment, inspect before expiry, within days 1–14 Grace, and after Grace; attempt one permitted and one prohibited operation per policy            | Backend permits login/view/print/export/backup/status/renewal; backend rejects mutations after Grace                                             | NOT RUN |
| Revocation/status/recovery          | Prepare and import a VREV1 against persisted license; download exact artifact; import at customer; replay; try old license; issue new license for recovery                                 | Owner receipt alone does not block customer; only backend-confirmed customer revoked status blocks; replay is safe; old license cannot resurrect | NOT RUN |
| UI authorization errors             | Repeat restricted route/action as non-admin operator and customer user without revoke permission                                                                                           | Stable error code, no unintended row/audit/archive changes                                                                                       | NOT RUN |

## Next actions and decision status

1. **Final-head CI:** successful combined-flow evidence is [run 39711315248](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39711315248)
   on `7153b3763f61e18a62876cf8585c686b3226c7f0`. This audit refresh is documentation-only;
   verify the new PR head's full applicable CI before review and record its exact SHA/run.
2. **Manual operator work:** the Persian RTL checklist below remains **NOT RUN**.
   A named operator must record test build SHA/date/result and redacted evidence in
   a disposable environment. Print/export/backup and UI recovery actions are not implied
   by the successful API scenario.
3. **Scope:** do not change PR #192, accepted PDR/protocol/public error contracts,
   historical migrations, or Owner/customer separation. Do not claim a revocation
   until the customer API has persisted it, and do not label component tests as
   combined-flow proof.

**Disposition: READY FOR REVIEW** on the successful combined acceptance and CI evidence
above, subject to a green exact-head rerun for this audit-only update. Manual Persian
RTL acceptance remains **NOT RUN**, component-only residuals remain identified above,
and this is not a claim of full licensing-system completion.
