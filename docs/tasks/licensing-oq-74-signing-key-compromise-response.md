# OQ-74 — administrative signing-key tracking and compromise response

**Decision:** Product Owner instruction, 2026-10-18/19. **Implementation:** this PR;
CI results and exact final head are recorded in its description, not inferred from
this document. Product Owner acceptance remains outstanding.

## Baseline and prior review

- Fetched `origin/main`: `ba634fae3cb8b7cf579f211293cf5cb601510271`.
- Session branch: `arena/64341f6b-vardena` (fixed by Arena).
- PR [#177](https://github.com/MR-AliEsmaeili/Vardena/pull/177) is **CLOSED, NOT MERGED**;
  head `0249abb92a26c181e81381b2bedd529ab82c48e3`. Its full patch, single commit,
  review and all three inline comments were inspected. No separate security
  review was recorded. Its code is absent on main; migration history ends at 005.
- Prior [CI run](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39123406857):
  classify/docs passed, backend/frontend/ci-gate failed; generated client skipped.
  Backend annotations identify two stale migration-ledger expectations; UI test
  used `AppProviders client` instead of `queryClient`. Neither is success evidence.
- Later main changes include customer license-version conflict fixes, Inventory
  Kardex, generated API updates, and OD-LIC-06 renewal design (#180). None adds
  Owner signing-key tracking. This PR preserves their code and the current Owner
  005 date model. It ports only the earlier feature, corrected and tested.
- Existing domain/operation/audit tests, PostgreSQL `api.test.ts`, date formatter
  tests and operations React flow tests provide the surrounding regression base.

## Decision and boundary

Register non-secret identifiers and labels; status is ACTIVE / COMPROMISED /
REVOKED. An association is an **operator observation, not cryptographic proof**.
SAFE means only that its recorded key is administratively ACTIVE; other known
statuses yield NEEDS_REVIEW; absent/unrecognized status or no association yields
UNKNOWN. Status is derived from persisted key state on reads, never stored twice.

On compromise the Owner must generate a replacement using the separately approved
Owner-controlled process, update appropriate trusted-key configuration for future
issuance, and review existing customers case by case. **This application neither
generates keys nor performs or claims a trust rollout.** Removing an old trust key
can affect future imports; safe provenance/containment/custody remain under U-1.
Changing metadata does not rewrite, revoke or invalidate any issued license.
Customer signature verification remains authoritative (PDR-17 / ADR-0048).

## Requirement-to-evidence matrix

Paths below are relative to `owner-licensing/`. All implementation rows are
**implemented; CI verification is tracked at the exact PR head**. This is not a
claim that tests have run merely because they exist.

| Requirement | Implementation | Regression evidence | Actions job | Limitation |
|---|---|---|---|---|
| OQ74-PERSIST | backend/migrations/006-signing-key-tracking.sql | backend/test/api.test.ts populated 005 upgrade, ledger retry/preservation, FK/type/immutability probes | backend | Disposable DB evidence only, not customer-data audit |
| OQ74-ID / review B | backend/src/domain.ts signingKeyId; backend/src/signing-keys.ts; audit.ts; frontend audit schema | backend/test/signing-keys.test.ts boundaries/controls/markers; api.test.ts authority-2026 across routes + 120-character key | backend, frontend | IDs are metadata, not key custody |
| OQ74-SAFETY | backend/src/operations.ts LEFT JOIN; domain.ts operationResponse | signing-keys.test.ts all mappings/inconsistent references; api.test.ts dynamic list/detail/activation after compromise/revocation | backend | Administrative observation only |
| OQ74-AUTH | backend/src/app.ts routes, signing-keys.ts service permission checks | signing-keys.test.ts service denials before SQL; api.test.ts unauthenticated + operator mutation denials | backend | Existing two roles only |
| OQ74-AUDIT | signing-keys.ts; operations.ts snapshot; audit.ts allowlist/filter | signing-keys.test.ts payload projection; api.test.ts persistence and injected audit-failure rollback | backend | Existing append-only audit, no invented WORM |
| OQ74-UI / review A | frontend/features/operations/operation-forms.tsx, schema, API; operations list/detail | operations-flow.test.tsx actual selected signingKeyId payload, explicit historical mode, UNKNOWN rendering | frontend | No historical association fabrication/editing |
| OQ74-ADMIN | frontend/features/signing-keys/signing-keys-page.tsx | signing-keys-page.test.tsx registration, validation, status reason/evidence, notes, permission/error/empty states and cached-query invalidation | frontend | No cryptographic signer |
| OQ74-TIME / review C | signing-keys-page.tsx uses lib/date-time.ts formatOwnerInstant | signing-keys-page.test.tsx near-midnight consumer; lib/date-time.test.ts | frontend | Fixed approved Asia/Tehran display, seconds/zone/offset; ISO retained |
| OQ74-COMPAT | No customer runtime, wire format, canonicalization or trust configuration changes | Existing customer protocol vectors, import/version tests, live persistence and production-image isolation | backend; frontend | No actual customer trust rotation executed |

## Review disposition

A: old form omitted schema/default/control/payload. Added registered-key picker,
ACTIVE filter by default, no implicit selection, searchable pagination, explicit
historical inclusion of compromised/revoked keys, null-compatible omission.
B: old service used ULID validation for signing-key paths. All key routes now use
one opaque-ID validator, including audit filters when targetType=SigningKey;
unrelated entities remain ULID-only. Reject raw whitespace/control/secret markers
before lookup. Encoded API paths preserve opaque IDs.
C: old browser-local `toLocaleString` replaced with canonical `formatOwnerInstant`.
These are all original inline findings; no finding is declared resolved based
only on a push. Tests and final diff are the supporting evidence.

Additional defects corrected: concurrent duplicate registration uses INSERT ON
CONFLICT DO NOTHING without overwriting metadata; conflicting label/notes/evidence
returns 409. All signing-key metadata including reasons is bounded and rejects
controls/artifact markers before trim. Audit source target IDs widened to 120;
archive already supports 128. Creation/update actors have Owner-local FKs. Key
association is LICENSE-only, FK-protected, nullable and immutable. Mutations and
audit share existing transaction/commit-before-response boundaries. Status changes
invalidate both operation list and detail caches. Notes UI and key metadata are
available without introducing customer-side dependencies.

## Migration and deployment

006 is additive; 001–005 checksums unchanged. No backfill, destructive statement,
customer schema access or cross-boundary FK. Deploy with the existing Owner
migration runner before serving the new API/UI. Existing runtime privileges must
include SELECT/INSERT/UPDATE on owner.signing_keys (no DELETE/TRUNCATE) using the
existing deployment-specific provisioning procedure. Preserve all existing audit
and transition grants. Reverting application code does not require dropping data;
do not rewrite the ledger or reverse 006 automatically. On failure, the runner
transaction rolls back and retry verifies checksums.

## TEST EXECUTION MATRIX

Local fast checks (exact commands/results and corrections are kept in PR evidence):
`npm run typecheck` in each Owner package; changed-file Prettier checks;
`npx oxlint src test` (API) / `npx oxlint src` (UI);
`npx vitest run test/signing-keys.test.ts` (API);
`npx vitest run src/features/operations/operation-schema.test.ts` (UI);
`python3 scripts/check-date-contract.py`; `python3 scripts/check-docs-links.py`.

CI-only: full customer backend/frontend, Owner unit/API/PostgreSQL integration
(including populated migration rehearsal in api.test.ts), full Owner React flows,
Docker builds/production artifacts/isolation, protocol-vector determinism,
customer migration rehearsals/live/E2E. Existing `.github/workflows/ci.yml`
backend/frontend jobs already execute these; no redundant workflow is introduced.
Generated customer API consistency is classifier-controlled: no customer API
contract changes here, so a skipped generated-api-client job is not a pass claim.
`ci-gate` verifies every applicable job. Run URLs, conclusions, SHA and any
corrective-run failures are recorded in the PR after execution.

**No heavy E2E/live-DB test was executed locally unless explicitly authorized.**
No heavy local execution was used; Actions is authoritative.

## Remaining limitations

U-1 production custody, provenance for issued-but-not-imported licenses,
compromise/replay/trust containment and offline recovery design remain open.
OQ-78 revocation artifacts, cryptographic receipts, protocol changes, renewal and
server replacement are out of scope. No automatic invalidation, new role,
customer DB access, callback or private-key storage. UI tests are automated;
a manual browser/assistive-technology acceptance pass remains a review activity.

### Local execution results before first push

- Owner API `npm run typecheck`, `npx oxlint src test`, changed-file
  `npx prettier --check ...`: passed; lint 0 warnings/errors.
- Owner API `npx vitest run test/signing-keys.test.ts`: 6/6 passed (321ms first run;
  313ms repeated after formatting).
- Owner UI `npm run typecheck`, `npx oxlint src`, changed-file
  `npx prettier --check ...`: passed; lint 0 warnings/errors.
- Owner UI `npx vitest run src/features/operations/operation-schema.test.ts`:
  3/3 passed (2.59s). No full React flow tests ran locally.
- `python3 scripts/check-date-contract.py`: passed.
- `python3 scripts/check-docs-links.py`: passed (0 broken links).
- `git diff --check`: passed.
- `python3 scripts/check-production-artifacts.py`: **not passed locally**;
  production artifacts intentionally not built, so two missing-dist errors;
  manifest and tracked/staged secret scan portions passed. Full check delegated
  to CI. `python3 scripts/check-owner-isolation.py` without `--artifact` returned
  usage error; no isolation success is claimed locally. Actual built/image
  isolation verification is CI-only. Neither command launched a build or test.
- Early typechecks exposed an extra validator argument, Zod input/output default
  mismatch and inherited wrong test-provider prop. Corrected; final local
  typechecks passed. Early formatting was corrected before final checks.

### First Actions attempt and correction

Run [39209199908](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39209199908),
head `5373cc127106c60d152947c3bb57504c77037ae7`: classify/docs passed;
frontend failed in Owner UI verification because the notes test matched both
registration and existing-key fields. Backend Owner static/unit/API/PostgreSQL
steps completed successfully before the corrective push; later customer artifact
and E2E work was not yet final and is not claimed green. Generated API skipped
as classified. The correction scopes the existing-key notes control and upgrades
the status test to navigate back to an infinitely-fresh cached observations list
and assert the newly displayed NEEDS_REVIEW result. All heavy tests remain in CI.
Final run/head evidence is maintained in the PR description to avoid recursive
SHA-changing documentation commits.

Customer compatibility checks already present in CI include
`licensing-protocol-vectors.spec.ts` (ROT-01/ROT-02),
`license-document.spec.ts` (rotated-away key trusted only while listed), and
`license-import.service.spec.ts` (untrusted-key refusal and retained-license
validity across rotation). No customer code changes were needed for this slice.
