# Owner-side issuance — decision → implementation → evidence traceability

**Status:** implementation slice on branch `arena/34983fce-vardena`, based on
`11e1d1a`. This file is the honest cross-reference the issuance mission asks
for: for every recordable decision and every open question that touches the
slice, it states what exists, what proves it, and what does not exist yet. A
row is only **DONE** when implementation and a test are both present; anything
else says so.

Nothing here claims a customer runtime change, a production key, a deployment,
a CI run or an acceptance of the 14-step flow. Those require the evidence named
in the last columns and, for the customer runtime, code that this change does
not contain.

## 1. Decisions

| Decision | What the slice implements | Tests / evidence | Honest status |
|---|---|---|---|
| **OD-LIC-07** permission split, per-operator grants | `Permission` vocabulary and eligibility matrix in `owner-licensing/backend/src/domain.ts`; `owner.user_permission_grants` in migration `007`; grant/revoke/list routes; effective-permission read in `security.ts`; per-permission route gates in `app.ts` | `test/unit.test.ts` (matrix, R-1 defaults, grant widening refused); `test/api.test.ts` grant fixtures and default-deny assertion (CI-only, needs PostgreSQL) | **implemented, unit-tested; integration suite not executed in this environment** |
| **OD-LIC-08** air-gapped signing flow | Unsigned `VLSR1` request preparation; offline signer in `src/signer/`; import verifies strictly before recording; artifact archived outside PostgreSQL | `test/licensing.test.ts` (request/prepare response), `test/signer.test.ts`, `test/protocol.test.ts`; `tsconfig.build.json` excludes the signer from the deploys | **implemented and unit-tested** |
| **OD-LIC-09** controlled installation identity registration | `owner.installation_identities` (ULID grammar, source `CUSTOMER_VARDENA_SCREEN`, confirmation evidence, terminal retirement); register/retire/list routes; issuance refuses a retired or foreign identity | none yet | **backend implemented, untested; no UI; row stays OPEN** |
| **OD-LIC-10** dedicated signed-artifact store | `LicenseArtifactStore` rooted at absolute `OWNER_LICENSE_ARTIFACT_DIR`, one file per target, `wx`+`link`+`fsync`+read-back, 0444, digest recorded | `test/protocol.test.ts` does not cover the store; no store test exists yet | **implemented, untested; gap acknowledged** |
| **OD-LIC-11** digest before the key | `signLicenseRequest` / `signRevocationRequest` ordering: structure → digest present → 64-hex → constant-time compare → key id → dates → replay state → **then** `loadPrivateKey`; CLI reads the digest from stdin, never argv | `test/signer.test.ts`: 8 malformed/absent digest cases, 8 substitution cases, key never loaded; CLI/argv isolation asserted | **implemented and unit-tested** |
| **OD-LIC-12** default-deny grants (R-1) | `effectivePermissions = eligibility ∩ active grants`; `hasEffectivePermission` fails closed; `security.ts` supplies the effective set on every request; `OWNER_ADMIN` outside the model | `test/unit.test.ts`; `test/api.test.ts` default-deny → grant → access sequence (CI-only) | **implemented; unit tests pass, integration unexecuted here** |
| **OD-LIC-13** profile reactivation | `customer_limit_profiles` with partial unique `WHERE status='ACTIVE'`, immutable ceiling columns, `ACTIVE⇄RETIRED` trigger, reactivate/retire routes | none yet (migration not executed locally) | **implemented, untested; migration unverified on PostgreSQL** |
| **OD-LIC-14** creation-time snapshot | `license_issuances` stores the full snapshot and `limit_profile_id`; trigger freezes every snapshot column; prepare evaluates the profile once | `test/licensing.test.ts` pins the response; snapshot immutability has no test | **implemented; snapshot-immutability test missing** |
| **OD-LIC-15** manual auditable rotation | Trust list is configuration (`OWNER_LICENSE_TRUSTED_PUBLIC_KEYS`); import requires an `ACTIVE` `owner.signing_keys` row; no key material in repo, build, logs or artifacts | `test/signer.test.ts` build-exclusion assertions; `test/protocol.test.ts` rotation vectors accept-while-both/refuse-after-retire | **implemented; the documented procedure and the customer redeploy requirement are prose only** |
| **OD-LIC-16** renewal/replacement OWNER_ADMIN-only | Prepare refuses lineage for a non-admin **before** writing anything; lineage targets must be recorded issuances of the same customer; no DTO change | not covered by a test yet | **implemented, untested** |
| **OD-LIC-17** signed revocation artifact | [`VREV1` protocol](../licensing/revocation-artifact-protocol.md); `prepareRevocation`/`importRevocationArtifact`/`downloadRevocationArtifact`; `owner.license_revocations`; UI prepare action | `test/protocol.test.ts` (literal canonical bytes, tamper, untrusted, key mismatch, non-canonical, cross-format); `test/signer.test.ts` (revocation signing and substitution refusal) | **Owner side implemented and tested; customer-side import does not exist** |
| **OD-LIC-18** duplicate import returns the first result | Both import services return the stored outcome for a replay, create no row and write no issuance audit event; a different artifact for the same target is `409 OperationConflict`; authorization runs first | replay logic is SQL-bound; no test | **implemented, untested** |
| **OD-LIC-19** indefinite exact-byte retention | Staged `PENDING → DURABLE` after read-back; `DURABLE → QUARANTINED` on a later integrity failure; download re-verifies the digest; `reconcileArtifacts` reports orphans and quarantines | no test; no backup/restore procedure run | **implemented, untested; backup/restore documentation is not written** |

## 2. Open questions touched by this slice

| OQ | Classification | Why |
|---|---|---|
| OQ-74 signing-key scope | **non-blocking-isolatable** | The slice records key ids and requires an `ACTIVE` metadata row; it does not decide long-term key scope. |
| OQ-75 signing-key distribution | **non-blocking-isolatable** | The trust list is operator configuration; distribution stays a deployment concern. |
| OQ-78 revocation/no-reactivation | **resolved by decision OD-LIC-17** for the Owner artifact; customer enforcement remains unimplemented | The artifact cannot reactivate; the customer runtime does not yet read it. |
| OQ-81 semantic fingerprint/replay | **resolved by canonical source** for artifact identity (operation id + canonical bytes + binding digest), referenced by OD-LIC-18 | No DTO change; the import API is introduced here. |
| OQ-85 customer-code grammar | **resolved by canonical source** (`license-code.ts` grammar mirrored in `protocol.ts`) | `test/protocol.test.ts` pins the module catalogue; the code grammar is enforced by the same validator. |
| OQ-90 installation identity | **non-blocking-isolatable** for registration; **blocking** for a verified binding claim | Registration exists; nothing claims the recorded value is cryptographic proof. |
| OQ-91 retention/recovery | **resolved by decision OD-LIC-19** at policy level; evidence missing | Staged states and reconciliation exist; no recovery drill. |
| Prepared-request expiry | **blocking a specific phase** (`OD-LIC-14` follow-on) — **PO decision required** | Options: (a) requests never expire; (b) a fixed window (e.g. 30 days) after which import is refused and the request is abandoned; (c) expiry configurable per deployment. Recommendation: (b) with an explicit `ABANDONED` audit, because an indefinite request keeps a stale ceiling alive and contradicts nothing in OD-LIC-14. Trade-off: an operator who loses a request must recreate it, changing the operation id. |
| Completion after profile change | **resolved by decision OD-LIC-14** | The snapshot is immutable and replayed imports never re-evaluate it. |
| `renewsOperationId` / `supersedesOperationId` semantics | **resolved by OD-LIC-16** for authority, PDR-12/ADR-0046 for meaning | Both are emitted in the signed bytes exactly as the customer contract requires; only `OWNER_ADMIN` may set them. |

## 3. Test map

| Area | Test file | Environment |
|---|---|---|
| Permission matrix, effective grants, default deny | `owner-licensing/backend/test/unit.test.ts` | local |
| VLIC2 canonical bytes against the shared corpus | `owner-licensing/backend/test/protocol.test.ts` | local |
| Independent literal canonical bytes (license, renewal, device limit) | `owner-licensing/backend/test/protocol.test.ts` | local |
| VREV1 canonical bytes and refusals | `owner-licensing/backend/test/protocol.test.ts` | local |
| Signer ordering, digest gate, replay state, key permissions, build exclusion | `owner-licensing/backend/test/signer.test.ts` | local |
| Import binding, response shape, request age | `owner-licensing/backend/test/licensing.test.ts` | local |
| Grants/default-deny and existing Owner API regressions | `owner-licensing/backend/test/api.test.ts` | **CI only** (PostgreSQL) |
| Owner UI states and digests | `owner-licensing/frontend/src/features/licenses/licenses-page.test.tsx` | local |
| Existing Owner UI regressions | `owner-licensing/frontend/src/**/*.test.tsx` | local |

## 4. What remains before the 14-step acceptance flow can be claimed

1. **Customer-side `VREV1` import** — parse, verify against the customer trust
   list, persist the revocation, block any future license import for that
   `licenseId`, and surface it. This is the largest missing piece and the
   reason OD-LIC-17 is not reported complete.
2. **Integration evidence** — `api.test.ts` on a disposable PostgreSQL database
   (grants, migrations `007`, archive replay, duplicate import, revocation
   ledger).
3. **Migration verification** — `007` has not been executed anywhere yet.
4. **Recovery drill** — archive restore and reconciliation under a real
   filesystem failure.
5. **Manual Persian RTL smoke** — the page renders, validates and reports
   failures; the flow has not been driven end-to-end with a real signer.
