# Owner-side issuance — decision → implementation → evidence traceability

**What this file is.** For every recordable decision in PDR-19 and every open
question that touches the Owner-side issuance slice, it states what exists in
code, what proves it, and what does not exist. A row is only **DONE** when the
implementation and an executed test are both present; everything else says so
in plain words.

**Environment note.** This record deliberately caches **no CI run id and no
commit SHA**: a run id is evidence only for the head it was executed on, and a
stale id in a document is worse than none. The authoritative execution record
for the current head is the pull request's own checks (`classify`, `docs`,
`backend`, `frontend`, `generated-api-client`, `ci-gate`). The `backend` job
runs `npm test` plus
`owner-licensing/backend → npm run test:integration`, which applies migrations
001–007 to a **fresh** `owner_test` database and runs both
`test/api.test.ts` and `test/licensing-lifecycle.test.ts` with
`--no-file-parallelism`. Rows below distinguish **local** evidence (runs on a
developer machine) from **CI-only** evidence (needs PostgreSQL).

**Local PostgreSQL execution (2026-10-20).** The sandbox that produced this
branch has no Docker and therefore no CI database, so the suites above marked
"CI-only" were also executed locally against a **disposable PostgreSQL 18.4**
started from embedded binaries (CI itself runs PostgreSQL 16). All 43 backend
Prisma migrations — ending with `20261024000000_licensing_revocations` — were
applied in order to a fresh database, then:

- `owner-licensing/backend/test/api.test.ts` — **26/26 passed**
- `owner-licensing/backend/test/licensing-lifecycle.test.ts` — **22/22 passed**
- `backend/test/licensing-persistence-live.e2e-spec.ts` — **24/24 passed**
- `backend/test/client-device-persistence-live.e2e-spec.ts` — **2/2 passed**
- every other `backend` e2e suite — **52 files / 625 tests passed**

A real **backup → restore → verification drill** for the OD-LIC-19 artifact
archive was also executed on a disposable **PostgreSQL 16.2** pair (`owner_drill`
→ `owner_restored`, `pg_dump -Fc` + `pg_restore`, byte copy, `artifacts:verify`),
including the missing/truncated/digest-mismatch/orphan/staged-registration cases;
the exact commands and results are recorded in
[`docs/licensing/artifacts-backup-restore.md`](../licensing/artifacts-backup-restore.md)
§7.

These runs are **local evidence**, not CI evidence: they do not replace the pull
request's `backend` job, which remains the authoritative record for the current
head.

Nothing here claims a production key, a deployment, a customer installation
that has applied a revocation, or the 14-step acceptance flow.

## 1. Decisions

| Decision | What the slice implements | Tests / evidence | Honest status |
|---|---|---|---|
| **OD-LIC-07** permission split, per-operator grants | `Permission` vocabulary and eligibility matrix in `owner-licensing/backend/src/domain.ts`; `owner.user_permission_grants` in migration `007`; grant/revoke/list routes; effective-permission read in `security.ts`; per-permission route gates in `app.ts` | `test/unit.test.ts` (matrix, R-1 defaults, grant widening refused) — **local**; `test/api.test.ts` grant fixtures and default-deny assertion — **CI-only** | **implemented and unit-tested; integration evidence is CI-only** |
| **OD-LIC-08** air-gapped signing flow | Unsigned `VLSR1` request preparation; offline signer in `src/signer/`; import verifies strictly before recording; artifact archived outside PostgreSQL | `test/licensing.test.ts`, `test/signer.test.ts`, `test/protocol.test.ts` — **local**; end-to-end prepare → sign → import → replay — **CI-only** in `test/licensing-lifecycle.test.ts` | **implemented and executed**, except the end-to-end case (CI-only) |
| **OD-LIC-09** controlled installation identity registration | `owner.installation_identities` (ULID grammar, source `CUSTOMER_VARDENA_SCREEN`, confirmation evidence, terminal retirement); register/retire/list routes; issuance refuses a retired or foreign identity | `test/licensing-lifecycle.test.ts`: re-entry + confirmation required, duplicate → `409 DuplicateInstallationIdentity`, foreign customer → `404`, retire → `409 InstallationIdentityRetired`, reactivation refused by the trigger — **CI-only** | **implemented; tests now exist (CI-only). No UI. The recorded identifier is an operator-confirmed claim, not cryptographic proof** — see §2 OQ-90 |
| **OD-LIC-10** dedicated signed-artifact store | `LicenseArtifactStore` rooted at absolute `OWNER_LICENSE_ARTIFACT_DIR`, one file per target, `wx`+`link`+`fsync`+read-back, 0444, digest recorded | `test/artifact-store.test.ts` (10 tests, **local, executed**): configuration refusal, key derivation/traversal, 0444/0700, byte-identical rewrite, different-bytes refusal, foreign object at the key, missing read, digest-change detection, sorted `listKeys` with noise, missing root. `test/licensing-lifecycle.test.ts` — **CI-only**: first import leaves exactly one `DURABLE` row whose bytes equal the artifact | **implemented and tested at both layers (store local, staging CI-only)** |
| **OD-LIC-11** digest before the key | `signLicenseRequest` / `signRevocationRequest` ordering: structure → digest present → 64-hex → constant-time compare → key id → dates → replay state → **then** `loadPrivateKey`; CLI reads the digest from stdin, never argv | `test/signer.test.ts`: malformed/absent digest cases, substitution cases, key never loaded; CLI/argv isolation asserted — **local, executed** | **implemented and unit-tested** |
| **OD-LIC-12** default-deny grants (R-1) | `effectivePermissions = eligibility ∩ active grants`; `hasEffectivePermission` fails closed; `security.ts` supplies the effective set on every request; `OWNER_ADMIN` outside the model | `test/unit.test.ts` — **local**; `test/licensing-lifecycle.test.ts` creates a fresh operator and grants each capability explicitly, and a viewer without `licenses.import` is refused **before** the replay path — **CI-only**; `test/api.test.ts` — **CI-only** | **implemented and unit-tested; integration evidence CI-only** |
| **OD-LIC-13** profile reactivation | `customer_limit_profiles` with partial unique `WHERE status='ACTIVE'`, immutable ceiling columns, `ACTIVE⇄RETIRED` trigger, reactivate/retire routes | `test/licensing-lifecycle.test.ts` — **CI-only**: second profile while one is active is a `409 ActiveProfileExists` on reactivation, reactivation succeeds after the conflict is retired, the ceiling is unchanged, both rows are retained, one `LIMIT_PROFILE_REACTIVATED` audit | **implemented; test now exists (CI-only)** |
| **OD-LIC-14** creation-time snapshot | `license_issuances` stores the full snapshot and `limit_profile_id`; the `enforce_issuance_facts` trigger freezes every snapshot column and the digests; prepare evaluates the profile once | `test/licensing-lifecycle.test.ts` — **CI-only**: a request prepared under an ACTIVE profile still imports after that profile is retired, keeping its recorded ceiling; six direct `UPDATE` statements (dates, limits, profile, both digests, operation id) are refused by the trigger; an illegal status transition is refused; the profile ceiling cannot be edited | **implemented; snapshot-immutability and in-flight completion now tested (CI-only)** |
| **OD-LIC-15** manual auditable rotation | Trust list is configuration (`OWNER_LICENSE_TRUSTED_PUBLIC_KEYS`); import requires an `ACTIVE` `owner.signing_keys` row; no key material in repo, build, logs or artifacts | `test/signer.test.ts` build-exclusion assertions; `test/protocol.test.ts` rotation vectors — **local** | **implemented; the documented procedure and the customer redeploy requirement remain prose** |
| **OD-LIC-16** renewal/replacement `OWNER_ADMIN`-only | Prepare refuses lineage for a non-admin **before** writing anything; lineage targets must be recorded issuances of the same customer; no DTO change | `test/licensing-lifecycle.test.ts` — **CI-only**: an operator with `licenses.issue.time_limited` gets `403` for both `renewsOperationId` and `supersedesOperationId`, the issuance count and `LICENSE_REQUEST_PREPARED` count are unchanged, and exactly the two intended `LICENSE_REQUEST_DENIED` audits exist; an Owner Admin naming an unknown target gets `400` with no row | **implemented and tested (CI-only)** |
| **OD-LIC-17** signed revocation artifact | [`VREV1` protocol](../licensing/revocation-artifact-protocol.md). **Owner side:** `prepareRevocation`/`importRevocationArtifact`/`downloadRevocationArtifact`, `owner.license_revocations`, preparation UI. **Customer side (this branch):** `domain/license-revocation.ts`, `application/license-revocation.service.ts`, `POST /api/v1/license/revocations/import` under `Licensing.License.Revoke`, `licensing.license_revocations` + `licenses.revoked_at`/`revocation_id` + `license_versions.signed_issued_at`, `revoked` ranked above every other inactive reason and above Grace, `license-revoked` refusal on every later license artifact — checked **before** the duplicate/replay precheck, so an exact replay of a revoked license reports `license-revoked`, never `duplicate-operation` or an idempotent no-op | Owner: `test/protocol.test.ts`, `test/signer.test.ts` — **local**; `test/licensing-lifecycle.test.ts` prepares an Owner revocation request (operator `403`, admin `201`, unsigned, issuance untouched) — **CI-only**. Customer: `domain/license-revocation.spec.ts` (literal canonical bytes, committed vectors, tamper/untrusted/key-mismatch/non-canonical/unknown-key/bad-version, rotation), `application/license-revocation.service.spec.ts` (apply, idempotent replay, conflicting replay, already-revoked, wrong installation/customer/target, future-dated, stale, unauthorized-before-decode, revoked license refuses every artifact, never Grace) — **local, executed**; live-PostgreSQL case in `test/licensing-persistence-live.e2e-spec.ts` — **CI-only** | **Owner half: implemented; the recorded artifact is NOT applied to any customer installation by the Owner. Customer half: implemented and unit-tested; no customer installation has been observed applying a revocation, and the live case is CI-only. Partial by design — see §4** |
| **OD-LIC-18** duplicate import returns the first result | Both import services return the stored outcome for a replay, create no row and write no issuance audit event; a different artifact for the same target is `409 OperationConflict`; authorization runs first | `test/licensing-lifecycle.test.ts` — **CI-only**: byte-identical replay returns `replayed: true` / `historicalResult: true`, `imported_at`/`signed_at` unchanged, artifact count still 1, one `LICENSE_ARTIFACT_IMPORTED`; a session without `licenses.import` gets `403` **with no side effect**; a different artifact gets `409 OperationConflict`; an altered installation binding gets `409 ArtifactBindingMismatch` with the request still `REQUEST_PREPARED` and no archive row | **implemented and tested (CI-only)** |
| **OD-LIC-19** indefinite exact-byte retention, backup and restore | Staged `PENDING → DURABLE` after read-back; `DURABLE → QUARANTINED` on a later integrity failure; download re-verifies the digest; `reconcileArtifacts` reports orphans and quarantines; `npm run artifacts:backup` copies verified bytes and writes a metadata manifest, `npm run artifacts:verify` is a read-only size+SHA-256 restore gate ([`artifact-backup.ts`](../../owner-licensing/backend/src/artifact-backup.ts), [`artifacts.ts`](../../owner-licensing/backend/src/artifacts.ts)) | `test/artifact-store.test.ts` — **local**; `test/artifact-backup.test.ts` — **local, 9 tests**: intact store, missing file, truncation, same-size corruption, orphan, unsettled `PENDING`, backup refusal on an unverifiable source, quarantined exclusion, bundle verification, malformed manifest; `test/licensing-lifecycle.test.ts` — **PostgreSQL**: full-archive verify and byte-identical backup, missing-file detection with recovery by restoring the original bytes, backup refusal on corrupted source, unaccounted file reported (never adopted), and a staged `PENDING` row refused by the gate until reconciliation settles it `DURABLE` and a re-run passes. A **real `pg_dump`/`pg_restore` + file-copy drill on PostgreSQL 16.2** is recorded in [`artifacts-backup-restore.md`](../licensing/artifacts-backup-restore.md) §7 | **implemented; automated integrity/recovery tests executed locally; backup→restore→verification drill executed 2026-10-20. The pull request's `backend` job is still the authoritative CI record** |
| **OD-LIC-20** fixed 14 × 24-hour prepared-request age | `PREPARED_REQUEST_MAX_AGE_MS` / `isPreparedRequestExpired` in `licensing.ts`; the import service holds the row lock, evaluates the boundary before replay/parse/writes, and on the first expired attempt moves `REQUEST_PREPARED → ABANDONED` + writes a system-origin `LICENSE_REQUEST_ABANDONED` audit (`actor_id` null, reserved `SYSTEM_EXPIRY` reason) in the same transaction; the route commits that refusal; `abandonIssuance` refuses the reserved prefix; injected clock through `createApp({ now })`; the artifact store and trust list are **providers** (`IssuanceImportDependencies`) resolved only after the lock/expiry decision, so a `503` cannot mask the rule; `lockIssuanceForImport` runs authorization → identifier → `FOR UPDATE` → expiry before **any body validation**, and the same guard runs from the body-parser rejection hook for unparsable/oversized import bodies | `test/licensing.test.ts` — **local, 5 tests**: exact 14×24h constant, just-before/exact/just-after, European DST anchor, process-timezone independence, later client instant cannot extend; `test/licensing-lifecycle.test.ts` — **PostgreSQL, 27 tests**: completes 1 minute before the boundary; exact boundary and +1 ms refuse and abandon atomically; snapshot unchanged; system-origin audit fields; no artifact/archive/success audit; artifact `issuedAt` cannot extend life; forced audit failure → 500 with the row still `REQUEST_PREPARED`; concurrent attempts produce one transition; authorization runs first; repeated attempts stay terminal; replacement gets new operation/license identities; expired import with no artifact store and with no trust list → `409` + durable `ABANDONED` + system audit; eligible import with either dependency missing → `503` and the row stays `REQUEST_PREPARED`; duplicate replay works without a store but refuses without the trust list; expired import with missing, wrong-typed, unparsable or oversized `fileContent` → `409` + durable `ABANDONED` + system audit; eligible import with missing/oversized payload → `400` and the row stays `REQUEST_PREPARED`; an unauthorized actor is refused before body validation; through the parser rejection hook, an unauthorized actor's unparsable body → `403` and an unauthenticated oversized body → `401` (the auth refusal is never replaced by the parser's `400`), a forced audit failure on a malformed body → `500` with nothing committed, an eligible request 1 ms before the boundary with an unparsable body → `400`, and an unknown id keeps the parser's `400` | **implemented and executed locally (unit + PostgreSQL). CI re-runs on the final head; no manual acceptance flow and no expiry UI claim** |

## 2. Open questions touched by this slice

| OQ | Classification | Why |
|---|---|---|
| OQ-74 signing-key scope | **non-blocking-isolatable** | The slice records key ids and requires an `ACTIVE` metadata row; long-term key scope stays undecided. |
| OQ-75 signing-key distribution | **non-blocking-isolatable** | The trust list is operator configuration; distribution is a deployment concern. |
| OQ-78 revocation/no-reactivation | **resolved by decision OD-LIC-17** for the artifact and the customer enforcement mechanism; **OPEN** for policy, recovery and operational evidence | The artifact cannot reactivate; the customer runtime refuses every license artifact for a revoked license and reports `revoked` (never Grace). Nothing here proves that any customer installation received or applied a revocation. |
| OQ-81 semantic fingerprint/replay | **resolved by canonical source** (operation id + canonical bytes + binding digest), referenced by OD-LIC-18 | No DTO change. |
| OQ-85 customer-code grammar | **resolved by canonical source** (`license-code.ts` grammar mirrored in `protocol.ts`) | Enforced by the same validator; pinned by `test/protocol.test.ts`. |
| OQ-90 installation identity | **non-blocking-isolatable** for registration; **blocking** for any claim of a verified binding | See §2.1. |
| OQ-91 retention/recovery | **resolved by OD-LIC-19; implemented with executed evidence** | Staged states, reconciliation, quarantine, backup refusal, and the restore verification gate are tested; a real `pg_dump`/`pg_restore` drill is recorded in §2.2's linked procedure. |
| Prepared-request expiry | **resolved by OD-LIC-20 and implemented** | See §2.2. Fixed 14 × 24-hour age, server-side, with executed unit and PostgreSQL conformance tests. Not the replacement confirmation window. |
| Completion after profile change | **resolved by decision OD-LIC-14**, now with executed coverage (CI-only) | The snapshot is immutable and a replayed import never re-evaluates it. |
| `renewsOperationId` / `supersedesOperationId` semantics | **resolved by OD-LIC-16** for authority, PDR-12/ADR-0046 for meaning | Emitted in the signed bytes exactly as the customer contract requires; only `OWNER_ADMIN` may set them. |

### 2.1 OQ-90 — installation identity is a **manual claim**, not cryptographic proof

Registering an installation identity records an identifier an operator read from
the customer's Vardena screen and deliberately re-entered, together with the
operator, the time and an optional evidence reference. **Nothing in this slice
proves that the identifier belongs to that customer's installation.** There is
no challenge/response, no key exchange, no customer callback and no online trust
service — introducing one would be a new protocol and is explicitly out of
scope without a Product Owner decision.

Consequences, stated so nobody reads the record as more than it is:

- A wrong-but-confirmed identifier produces a license that the intended
  installation cannot use, and that some other installation might accept. The
  mitigation is operational: the re-entry confirmation, the audit trail and the
  ability to retire the identity.
- The issuance path binds the signed payload to the **recorded** customer,
  customer code and installation identifier; a mismatch at import is refused.
  That proves the artifact matches the request, not that the installation
  exists.
- The Owner UI now says this in Persian next to the field
  (`installationIdentityHelp`), and no page claims verification.

**Follow-up needed for a stronger claim:** a PO decision on whether an
installation-bound proof (for example a signed installation challenge) is
required, plus a protocol/vector change and customer-runtime support. Until
then the residual risk stays documented here and in the design.

### 2.2 Prepared-request expiry — decided and implemented (OD-LIC-20)

**Product Owner decision confirmed 2026-10-20: Option B, fixed maximum age of 14 days.**
The canonical policy is recorded as **OD-LIC-20** in
[PDR-19 §11](../decisions/product/PDR-19-owner-side-issuance-decisions.md). It is
implemented on this branch exactly as decided, with no configuration knob.

**Rule.** A prepared issuance request is eligible for completion only while
`now < requested_at + 14 × 24 hours`, where `requested_at` is the persisted
server-set creation instant and the arithmetic is on UTC instants, not local
calendar days. At `now >= requested_at + 14 × 24 hours` it is expired. The limit
is fixed; it is not per-customer, per-deployment or UI-configurable.

**Enforcement.** `importIssuanceArtifact` (the single completion entry point)
authorizes first, takes the row lock, and evaluates the boundary before the
request-body validation, any replay shortcut, artifact parsing or write. The
shared `lockIssuanceForImport` guard also runs from an error-handling middleware
for `POST …/import` bodies that `express.json` refused to parse or rejected as
oversized, so payload validation at the transport edge cannot bypass the rule
either. On the first expired attempt it:
moves the row `REQUEST_PREPARED → ABANDONED` in the same transaction, writes a
`LICENSE_REQUEST_ABANDONED` audit with `actor_id = NULL` (system origin) and a
reason beginning with the reserved `SYSTEM_EXPIRY` marker that names
`requested_at` and the exact expiry instant, and then returns
`409 InvalidTransition` — with the transaction **committed**. If the transition or
the audit cannot be written, the error escapes, the transaction rolls back, and
neither a successful abandonment nor an import is ever reported. A human
abandonment may not use the reserved reason prefix. The clock is injected
(`createApp`'s `dependencies.now`, defaulting to real time); durable timestamps
remain database-clock values.

**Terminal.** Nothing revives the row. A replacement is a new request with a new
operation identity and a new license identity; the old row keeps its immutable
creation snapshot (OD-LIC-14) and its audit history, and its status is
`ABANDONED`. No artifact, archive row, `SIGNED_RECORDED` state or
`LICENSE_ARTIFACT_IMPORTED` audit is created by an expired attempt. The signed
payload's `issuedAt` must equal `requested_at` at import, so a signer or client
cannot choose a later creation instant.

**Executed evidence (local).**

| Case | Where | Result |
|---|---|---|
| exact 14 × 24 h constant, just-before / exact-boundary / just-after, DST anchor, process-timezone independence, later client instant cannot extend | `test/licensing.test.ts` | **5/5 passed** |
| completes one minute before the boundary | `test/licensing-lifecycle.test.ts` | passed (200, `SIGNED_RECORDED`) |
| exact boundary (European DST anchor) and one millisecond after: `409`, row `ABANDONED`, reason, system-origin audit, no artifact/success audit | same | passed |
| artifact's own `issuedAt` cannot extend life | same | passed |
| forced audit failure: `500`, row still `REQUEST_PREPARED`, no audit, no artifact | same | passed |
| two concurrent attempts: both `409`, exactly one transition and one audit | same | passed |
| viewer without `licenses.import`: `403`, no transition | same | passed |
| repeated attempts on an `ABANDONED` row: deterministic `409`, no revival, snapshot unchanged | same | passed |
| replacement request: new operation and license identities, old row untouched | same | passed |
| human reason with the `SYSTEM_EXPIRY` prefix refused | same | passed |
| expired request with **`fileContent` missing**: `409`, durable `ABANDONED`, system-origin audit, no artifact/success audit | same | passed |
| expired request with **`fileContent` of the wrong type**: same durable expiry | same | passed |
| expired request with **`fileContent` over the byte limit** (transport parser refuses the body): `409` via the parser rejection hook, same durable expiry | same | passed |
| expired request with a **body that is not valid JSON**: `409`, same durable expiry | same | passed |
| eligible request with **missing** `fileContent`: `400 ValidationFailed`, row still `REQUEST_PREPARED`, no expiry audit, no artifact | same | passed |
| eligible request with **oversized** `fileContent`: `400`, row still `REQUEST_PREPARED`, no expiry audit | same | passed |
| unauthorized actor with a malformed body on an expired request: `403` before body validation, row still `REQUEST_PREPARED` | same | passed |
| unauthorized actor whose body is not valid JSON (parser rejection hook): `403 PermissionDenied`, not the parser's `400`, row and audit untouched | same | passed |
| unauthenticated actor whose body exceeds the parser limit (parser rejection hook): `401 Unauthorized`, not the parser's `400`, row and audit untouched | same | passed |
| forced audit failure through the parser rejection hook (malformed body): `500 InternalError` with no database detail, row still `REQUEST_PREPARED`, no audit, no artifact — the expiry refusal is never reported without a commit | same | passed |
| eligible request one millisecond before the boundary with a body that is not valid JSON: `400 ValidationFailed`, row still `REQUEST_PREPARED`, no expiry audit | same | passed |
| unknown issuance id with a malformed body: parser's `400` unchanged, no audit | same | passed |
| expired request with **artifact storage unconfigured**: `409`, row `ABANDONED`, system-origin audit, no artifact/success audit | same (`app` without `artifactDir`) | passed |
| expired request with the **trust list unavailable**: same durable expiry, no dependency `503` | same (`app` without trusted keys) | passed |
| eligible import with **artifact storage unconfigured**: `503 ArtifactStorageUnavailable`, row still `REQUEST_PREPARED`, nothing written | same | passed |
| eligible import with **no trust list**: `503 TrustListUnavailable`, row still `REQUEST_PREPARED`, nothing written | same | passed |
| historical duplicate import: succeeds without artifact storage, refuses `503` without the trust list, still one artifact row and one import audit | same | passed |

Scope boundaries are unchanged: this is prepared-request age only. It does not
change OD-LIC-14 snapshot immutability, the separate OQ-82 server-replacement
window (1 hour–7 days, default 24 hours), customer license expiry or its 14-day
Grace, revocation, authorization-before-replay, duplicate-import
historical-result semantics, VLIC1/VLIC2/VREV1 bytes, canonicalization, vectors,
trust rules, public API contracts or unrelated customer runtime behavior.

**Still not claimed:** no UI affordance shows the expiry before an attempt (the
server refusal and the resulting `ABANDONED` row are authoritative), no manual
acceptance flow was run, and CI re-execution of these tests on the final head is
the remaining verification step.

## 3. Test map

| Area | Test file | Environment | Executed |
|---|---|---|---|
| Permission matrix, effective grants, default deny | `owner-licensing/backend/test/unit.test.ts` | local | yes |
| VLIC2 canonical bytes against the shared corpus | `owner-licensing/backend/test/protocol.test.ts` | local | yes |
| Independent literal canonical bytes (license, renewal, device limit) | `owner-licensing/backend/test/protocol.test.ts` | local | yes |
| VREV1 canonical bytes and refusals (Owner) | `owner-licensing/backend/test/protocol.test.ts` | local | yes |
| Signer ordering, digest gate, replay state, key permissions, build exclusion | `owner-licensing/backend/test/signer.test.ts` | local | yes |
| Import binding, response shape, request age, and the OD-LIC-20 boundary (constant, just-before/exact/just-after, DST, timezone independence) | `owner-licensing/backend/test/licensing.test.ts` | local | yes — 27 tests |
| Artifact store write-once, byte mismatch, path validation, recovery surface | `owner-licensing/backend/test/artifact-store.test.ts` | local | yes (10 tests) |
| Backup/restore verification: intact, missing, truncated, digest mismatch, orphan, unsettled `PENDING`, backup refusal, quarantined exclusion, malformed manifest | `owner-licensing/backend/test/artifact-backup.test.ts` | local | yes — 9 tests |
| Installation identity, lineage refusal, import/replay/archive, snapshot immutability, profile lifecycle, artifact reconciliation, OD-LIC-20 expiry (including missing-dependency ordering), archive backup/restore | `owner-licensing/backend/test/licensing-lifecycle.test.ts` | PostgreSQL, migration 007 | yes — 48 tests on PostgreSQL 18.4; the pull-request `backend` job re-runs the file on PostgreSQL 16 |
| Grants/default-deny and existing Owner API regressions | `owner-licensing/backend/test/api.test.ts` | PostgreSQL | yes — 26 tests on PostgreSQL 18.4; the pull-request `backend` job re-runs the file on PostgreSQL 16 |
| VREV1 canonical bytes, committed vectors, refusals (customer) | `backend/src/modules/licensing/domain/license-revocation.spec.ts` + `docs/licensing/vectors/revocation/` | local | yes |
| Revocation import, replay, binding, staleness, revoked-license refusal | `backend/src/modules/licensing/application/license-revocation.service.spec.ts` | local | yes |
| Revocation persistence, unique index, CHECK, idempotent replay, revoked-license refusal ordering | `backend/test/licensing-persistence-live.e2e-spec.ts` | PostgreSQL | yes — 24 tests on PostgreSQL 18.4; the pull-request `backend` job re-runs the file serially on PostgreSQL 16 |
| Current-state OpenAPI property set (includes `revokedAt`) | `backend/test/license-state-route.e2e-spec.ts` | local | yes — 3 tests |
| Owner UI states, digests, revocation wording | `owner-licensing/frontend/src/features/licenses/licenses-page.test.tsx` | local | yes |

## 4. What remains before the 14-step acceptance flow can be claimed

1. **Prepared-request expiry** — resolved and implemented as OD-LIC-20 (fixed 14 days) with local unit and PostgreSQL conformance tests; CI re-runs them on the final head. No manual acceptance flow has exercised an expired request against the UI.
2. **Owner-side revocation is partial** — the Owner can prepare, import and
   re-download a `VREV1` document, and the customer runtime can verify and apply
   it, but nothing in this repository demonstrates a **customer installation**
   actually applying one. No UI or document may say otherwise; the Owner UI now
   states that recording a revocation document is not applying it.
3. **Backup/restore** — procedure, verification tooling, automated
   integrity/recovery tests and a real `pg_dump`/`pg_restore` drill on a
   disposable PostgreSQL 16.2 pair are done ([procedure](../licensing/artifacts-backup-restore.md)).
   Not done: a rehearsal against a production-sized Owner database, and proof of
   independence of the backup medium (a deployment responsibility).
4. **Manual Persian RTL smoke** — the page renders, validates and reports
   failures in automated tests; the flow has not been driven end-to-end by a
   human with a real signer.
5. **Customer-runtime compatibility evidence** — the revocation artifact is
   accepted by the customer's committed vectors and unit tests; a signed
   artifact produced by the Owner signer has not been replayed into a running
   customer installation in this environment.
