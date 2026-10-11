# Licensing version model, signed documents and file exchange — technical design

| Field | Value |
| --- | --- |
| Status | ACTIVE design record for the first implementation slice (L-03) |
| Authority | [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) (decision) · [PDR-11](../../decisions/product/PDR-11-vardena-licensing-product-requirements.md) (product source) |
| Date | 2026-10-11 |
| Scope | Server license import: signed document format, retained versions, effective-version resolution, replay protection, audit, migration, API and frontend boundary |
| Out of scope (unchanged, gated) | Owner-side licensing system, CRM/billing, client-device licensing, server replacement, full revocation/reactivation, Grace/Read-Only enforcement, installation identity key, clock-rollback enforcement, test/training entitlements |

This record is the design detail behind ADR-0046. Where PDR-11 leaves a product
question open, this document says so explicitly and fails closed instead of
inventing policy. Registered open items are listed in `docs/open-questions.md`
(OQ-74…OQ-85) and cross-referenced from PDR-11 §19.4.

---

## 1. Terms and the typed model

```text
licensing.customers            commercial party (minimal, not CRM)
licensing.installations        ONE Vardena server installation (is_self, L-02)
licensing.licenses             the commercial License: customer + installation
licensing.license_versions     every retained signed LicenseVersion
licensing.license_version_entitlements
licensing.license_audit_events typed, append-only licensing audit trail
```

PDR-11 §14 conceptual entities → implemented tables (CF-17):

| PDR-11 (§14) | Implemented | Note |
| --- | --- | --- |
| License | `licensing.licenses` | One row per commercial license; bound to one installation (one active installation per license, §5.3). Holds no dates and no entitlements: those belong to a version. It is deliberately minimal — it is also the future home of license-level revocation state (PDR-11 §10, OQ-78). |
| LicenseVersion | `licensing.license_versions` | Retained, never overwritten. Carries validity window, limits, status, entitlements, signing key id, document hash, operation id, source and import facts. |
| Customer / Contract | `licensing.customers` | Customer only. Contracts, pricing and billing are out of scope (PDR-11 §4.1/§17.1) and stay Owner-side. |
| ServerInstallation | `licensing.installations` | Unchanged from L-02 (ADR-0045 Decision 1). |
| ReplacementRecord | — | Not implemented; replacement workflow is a later slice (PDR-11 §5.5, U-9). |
| ClientDevice | — | Not implemented; client-device licensing is a later slice (PDR-11 §7). |
| AuditEvent | `licensing.license_audit_events` | Typed columns, append-only. Retention periods are open (PDR-11 U-7 → OQ-77). |

Status vocabulary is **unchanged** from ADR-0030/ADR-0045 —
`ACTIVE | EXPIRED | SUSPENDED` on a version, `UNLICENSED` as the absence of any
version. PDR-11 §3.5's *revoked* and the mapping of `SUSPENDED` (PQ-4) are open
(OQ-79); nothing here re-labels them, and no migration rewrites a status value.

## 2. The signed document

### 2.1 Artifact

```text
VLIC2.<base64url(canonical payload bytes)>.<base64url(Ed25519 signature)>
```

Canonical payload (fixed key order, sorted arrays, ISO-8601 UTC instants):

```json
{
  "v": 2,
  "kind": "SERVER_LICENSE_VERSION",
  "operationId": "01J…",
  "licenseId": "01J…",
  "customerId": "01J…",
  "customerName": "…",
  "installationId": "01J…",
  "status": "ACTIVE",
  "validFrom": "2027-01-01T00:00:00.000Z",
  "validUntil": "2028-01-01T00:00:00.000Z",
  "organizationLimit": 3,
  "userLimit": 25,
  "modules": ["accounting", "organization", "users"],
  "features": [],
  "supersedesOperationId": null,
  "issuedAt": "2026-10-11T00:00:00.000Z"
}
```

Rules: the payload must round-trip to **exactly** the signed bytes (canonical
form), `validUntil` is exclusive and `null` means perpetual, limits are
positive-or-null, module codes must be known to this build, feature codes must
match the code pattern, and no duplicates are allowed.

### 2.2 File envelope (primary transport)

```json
{
  "format": "vardena-license",
  "fileVersion": 1,
  "document": "VLIC2.…"
}
```

The envelope is **not trusted**: it carries no licensing fact and the parse
rejects unknown top-level keys. Its only jobs are (a) to make the file
self-describing and versionable and (b) to mark the transport for the audit
trail. Text transport is the bare artifact; `VLIC1` codes are accepted for
compatibility. All three decode into the same pipeline, so a text code is never
a weaker trust path than a file.

### 2.3 Trusted keys and rotation

`LICENSE_SIGNING_PUBLIC_KEYS` accepts comma-separated entries, each either bare
PEM/base64-DER (id derived from the key material) or `keyId:<material>`. If the
file's optional `keyId` hint is present, it must name a trusted entry — an
unknown id is rejected with its own reason (`unknown-key`) so the operator knows
to update the trust list — and verification uses that key only. Without a hint,
the document is verified against every trusted key. **Verification happens at
import only**: an already-retained version stays effective without touching the
key list, so retiring or rotating a key cannot invalidate a valid perpetual
license (PDR-11 §3.1, CF-8). Retiring a key therefore restricts *future* imports
signed with it; the retirement policy for revocation-era verification is a later
decision (PDR-11 U-1, U-3).

## 3. Version lifecycle and effectivity

### 3.1 Lifecycle

```text
import ──► retained (not yet effective | effective | expired)
                    │
                    └── superseded by an explicit signed supersession (retained, ineligible)
```

- A version is **retained** the moment it imports successfully; it is never
  overwritten and never deleted.
- **Not yet effective**: `validFrom > now`.
- **Effective**: `validFrom <= now < validUntil` (or `validUntil = null`) and not
  superseded and `status = ACTIVE`.
- **Expired**: `validUntil <= now`. Expiry is derived, never written; the row is
  immutable.
- **Superseded**: an explicitly declared later operation retired it. The row is
  retained as history (`superseded_at`, `superseded_by_version_id`) and is no
  longer eligible for effectivity.
- **Revoked / Grace / Read-Only**: not implemented (PDR-11 §9, §10; OQ-45, OQ-78,
  OQ-79).

### 3.2 Deterministic effective-version resolution (at any instant `at`)

1. **Eligible** = retained versions with `superseded_at IS NULL`.
2. **Covering** = eligible versions whose window contains `at`.
3. Exactly one covering version → it governs; its `status` and dates then decide
   `active` / `inactiveReason` exactly as L-02 did (`status`, `expired`,
   `not-yet-valid`).
4. No covering version, but at least one eligible version **ended** before `at` →
   the one with the latest `validUntil` reports `expired` (a subscription that
   ended, even if a renewal is scheduled).
5. No covering and no ended version, but an eligible version is in the future →
   `not-yet-valid` (the earliest such version).
6. No eligible version at all → `UNLICENSED`.
7. More than one covering version — impossible through the import path, which
   rejects overlap — is resolved deterministically (latest `validFrom`, then
   latest `imported_at`, then `id`) and logged as a data-integrity warning. This
   is a defensive failure mode for corrupted or manually edited data, **not** a
   product precedence rule, and it does not decide PDR-11 PQ-5 (OQ-80).

### 3.3 Overlap, gaps and supersession

- Half-open intervals (`[validFrom, validUntil)`); adjacency
  (`a.validUntil == b.validFrom`) is not an overlap; a `null` end is open-ended.
- An import whose window overlaps any **eligible** version is rejected unless the
  document explicitly supersedes a retained version by `operationId`
  (fail-closed default for the open PQ-5). Unknown or already-superseded targets
  are rejected.
- A supersession that is declared for a non-overlapping version is allowed and
  simply retires that version (a correction of an expired or scheduled version);
  it never creates ambiguity.
- A **gap** is allowed. During it the installation is inactive with
  `inactiveReason: expired` (rule 4 above) — nothing is extended and no policy is
  invented.
- `superseded_at` and `superseded_by_version_id` are the only fields written on an
  existing version row; validity, limits, entitlements and status of a retained
  version are immutable.

## 4. Import pipeline (strict order, nothing written until every stage passes)

| # | Stage | Rejection code |
| --- | --- | --- |
| 1 | Authorization: session + `Licensing.License.Activate` (route guard and application service, AR-21) | 401 / 403 |
| 2 | Transport parse: envelope or bare artifact (legacy `VLIC1` supported) | `malformed` |
| 3 | Payload version supported (`v: 1 | 2`, `fileVersion: 1`) | `unsupported-version` |
| 4 | Signature verified against trusted keys; unknown key hint rejected | `signature`, `unknown-key` |
| 5 | Canonical form / typed payload validation | `payload` |
| 6 | Installation binding: `installationId` is this installation's identity | `installation-mismatch` |
| 7 | Document semantics: interval, limits, entitlements, status `ACTIVE`, document not already expired at `now` | `validity`, `limits`, `entitlements`, `not-active`, `expired-document` |
| 8 | Replay: `operationId` already applied on this installation | `duplicate-operation` (409, no state change) |
| 9 | Version conflicts: overlap without explicit supersession, unknown supersession target | `overlapping-range`, `unknown-supersession` (409, no state change) |
| 10 | Persist: ONE transaction (customer upsert, license upsert, version + entitlements insert, supersession stamps, audit event) | — |

Capacity validation in this slice is **shape** validation (positive-or-null
limits, known entitlements). PDR-11 §8.6 conflict detection against existing
users/organizations/devices is a later slice: it needs the owning modules' public
count contracts, and no destructive or automatic correction is implemented
anywhere. Documented as a gap in the implementation report.

## 5. Operations, replay and duplicates

- The v2 `operationId` is the operation's identity. Applying it inserts the
  version; the unique index `(installation_id, operation_id)` is the database
  backstop, so a concurrent double-apply cannot create two versions.
- A duplicate v2 operation is **rejected** (409, `duplicate-operation`) and
  changes nothing (PDR-11 §10.8, G-6). Retry after an ambiguous failure is safe:
  the state is already correct and the second attempt is refused with a message
  that says so.
- A legacy `VLIC1` code has no operation id; its identity is its SHA-256 hash.
  Re-importing the same code keeps the documented L-02 behaviour: an idempotent
  no-op (`changed: false`, `outcome: unchanged`). Re-importing a *different*
  valid legacy code keeps the documented replacement semantics for the version
  that currently governs. PDR-11 PQ-8 asks whether the strict rule should apply
  to every operation type — that is **open** (OQ-81) and this asymmetry is the
  documented interim behaviour, not a product decision.
- A rejected operation is recorded in the audit trail with its outcome; it does
  **not** consume the operation id, so an operator may re-issue a corrected
  document with a new operation id at any time.

## 6. Transaction boundaries and failure recovery

One transaction per import, in the licensing schema only:

```text
BEGIN
  upsert licensing.customers        (id = payload.customerId, display name)
  upsert licensing.licenses         (id = payload.licenseId, installation, customer)
  lock + stamp superseded version   (superseded_at, superseded_by_version_id)
  insert licensing.license_versions (+ entitlements)
  insert licensing.license_audit_events (applied)
COMMIT
```

- A failure at any statement rolls the whole import back: no license, no version,
  no entitlement, no supersession and no `applied` audit event survives. This is
  asserted by the live PostgreSQL suite (a forced failure leaves the previous
  state byte-identical) and by the in-memory suite.
- The current version is never replaced *before* the new one is validated: a
  failed import cannot deactivate a valid installation (ADR-0045 Decision 6 keeps
  its guarantee).
- Rejections are audited through a **separate** insert after the read-only checks
  (they never share the state-change transaction); the audit insert itself is
  best-effort for the request but never masks the rejection.
- No network, no outbox, no worker: import is a local, synchronous, offline-safe
  operation (PDR-11 §11.1).

## 7. Installation identity and its dedicated key (separation, not yet implemented)

- The installation **id** stays the backend-owned ULID in
  `licensing.installations` (ADR-0045 Decision 1). It is what a signed document
  binds to and what an operator quotes to obtain a license.
- The installation **identity key** (PDR-11 §5.1) is a *second*, independent
  fact: a per-installation Ed25519 key pair whose private part never leaves the
  server and whose public part can be included in requests, receipts and
  replacement records. **Design only in this slice.** Implementation is blocked
  by two open items, and the blocker is recorded rather than guessed:
  - storage and backup of the private part depend on the backup-encryption
    design (PDR-11 U-2; §6.1 requires it to be encrypted in the full backup and
    §6.2 forbids escrow);
  - key loss must lead to the replacement workflow (PDR-11 §6.4), which is not
    designed or approved (U-9, PQ-3 → OQ-78; replacement detail OQ-82).
- Therefore: import **never creates, recreates or adopts** an installation row.
  A document for an unknown installation is rejected (`installation-mismatch`)
  and leaves the database without any installation row — an identity is only ever
  created by `InstallationIdentityService` during bootstrap. A restored database
  that lacks identity material can never silently become the previous
  installation: it fails binding; recovery stays an Owner-side, auditable process
  (PDR-11 §6.5, CF-5).

## 8. Restore and recovery access

- Import adds **no** gate to backup, export or restore. Restore is an
  out-of-product, runbook-driven operation performed by the customer's IT/server
  administrator (OQ-53) and is not blocked by license state (G-9) — there is no
  licensing check on any such path, and this slice adds none.
- Full revocation (PDR-11 §10) is not implemented. Its recovery path must not
  depend on an ordinary licensed ERP session (§10.3), so the future slice is
  required to provide an offline, auditable, operator-level reactivation path
  that works while login is blocked. The product-level choice of that process is
  **open** (PQ-3 → OQ-78); only the constraint is recorded here.

## 9. Audit and security-sensitive logging

- `licensing.license_audit_events` rows are typed and append-only:
  `license.import.applied`, `license.import.rejected`, `license.import.unchanged`,
  `license.version.superseded` (event type), outcome, `operation_id` (only when
  the signature verified), license/version ids, actor, transport source,
  `document_hash`, a bounded reason code and a bounded non-sensitive detail.
  Retention periods and sensitive-data policy are open (PDR-11 U-7 → OQ-77); the
  table stores **no** raw document, no signature, no key material and no customer
  payload beyond an id and a display name.
- Logging never includes the document body, the signature, the key or the
  entitlements payload. Rejections log the reason code and non-identifying
  context; the installation id and (for verified documents) the license id are
  the only identifiers logged.
- A rejected attempt never changes state, and a rejected unverified document
  cannot influence persisted data — including its `operationId`, which is not
  trusted until the signature verifies.

## 10. API and frontend boundary

Backend (REST/OpenAPI, ADR-0014, AR-10/AR-21):

| Method | Route | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/license/current` | authenticated (bootstrap self-read) | evaluated state + effective version + scheduled version + bounded retained-version history |
| POST | `/api/v1/license/import` | `Licensing.License.Activate` | import a signed document (file envelope or text artifact) |
| POST | `/api/v1/license/activate` | `Licensing.License.Activate` | L-02 compatibility alias for the same pipeline (text code) |

Response DTO classes are declared for OpenAPI; the request body carries exactly
one field (`document`), so a client can never describe the license it wants.

Frontend (`features/licensing/`): the license stage keeps its single source
(`GET /license/current`) and its rule that a successful POST is not an active
license — the mutation invalidates and awaits the canonical query. The form
offers the **file** first (read client-side and posted as text) and the pasted
artifact as the fallback transport. Persian copy comes from the i18n dictionary;
no licensing fact is derived client-side, and no signature, hash or key ever
reaches the browser.

## 11. Migration and compatibility (L-01/L-02 installations)

The migration is additive first and lossy never:

1. create `license_versions`, `license_version_entitlements`,
   `license_audit_events`;
2. backfill one version per existing `licensing.licenses` row — the same `id`,
   its dates, limits, status, provider and entitlements, `document_hash =
   code_hash`, `document_version = 1`, `source = 'legacy-code'`,
   `operation_id = 'legacy-code:' || code_hash || ':' || id` (unique by
   construction), `superseded_at = replaced_at` and `superseded_by_version_id =
   NULL` (the historical successor is not recoverable from old rows);
3. create one `licenses` row per distinct legacy license id (the license
   identity), keeping the customer binding;
4. move entitlements to `license_version_entitlements`;
5. drop the version columns from `licenses` and the L-02 partial unique index
   that encoded "exactly one current license".

Invariants preserved: every currently valid license stays valid and effective
(identical dates, limits, entitlements); every replaced row stays as retained,
ineligible history; `code_hash` idempotency for legacy codes keeps working
(`document_hash` equality); the provider name and status values are copied
verbatim (no lossy status migration — CF-11 stays open, OQ-79).

Evidence: `backend/prisma/rehearsal/licensing-version-model/rehearse.mjs`
(disposable database, populated pre-migration fixture, post-migration
assertions) plus the live PostgreSQL suite.

## 12. Test strategy

| Area | Level | Cases |
| --- | --- | --- |
| Document format | unit (`license-document.spec.ts`) | round-trip; canonical form; tampered payload; foreign signer; unknown/absent key hint; rotation (old key still verifies while trusted, new key accepted); malformed envelope; unknown envelope key; unsupported versions |
| Version resolution | unit (`license-version.spec.ts`) | single covering version; not yet effective; expired; gap; superseded ineligible; ambiguous defensive resolution; effective-version selection across retained history |
| Import pipeline | service spec + e2e (in-memory repositories) | valid import (file, text, legacy code); wrong installation; malformed payload; expired document; not-active status; duplicate operation; overlap; explicit supersession; unknown supersession; legacy replacement/idempotency; authorization denial (401/403) |
| Persistence and transactions | live PostgreSQL e2e | real transaction commit; forced failure ⇒ no partial write (no version, no supersession, no audit, previous state intact); unique operation index; legacy fixture migration; effective-version read after restart |
| Migration | rehearsal script | populated pre-migration data → migration → assertions on validity, history, ids, hashes |
| Frontend | component tests | file path; text path; rejected document keeps the operator on the screen; duplicate conflict message; success releases the gate only after the canonical re-read |

## 13. Explicitly not implemented (and why)

| Not implemented | Blocker |
| --- | --- |
| Full revocation, reactivation file, login-blocking state | PDR-11 §10 needs the external recovery process (PQ-3 → OQ-78) and the `SUSPENDED`/revoked mapping (PQ-4 → OQ-79) |
| Grace / Read-Only enforcement | OQ-45 shape decided, duration and override authority open |
| Installation identity key | PDR-11 U-2 + U-9/PQ-3 (see §7) |
| Server replacement workflow and receipts | PDR-11 §5.5, U-9; product choice open |
| Client-device licensing | PDR-11 §7; separate slice, quota effects open (PQ-6 → OQ-83) |
| Owner-side issuance system and role matrix | PDR-11 §4, U-5 → OQ-75; CRM/billing and OQ-61 out of scope |
| Clock-rollback enforcement | PDR-11 §12.6 thresholds open (U-6 → OQ-76) |
| §8.6 capacity-conflict detection and resolution UI | needs the owning modules' public count contracts; separate slice |
| Audit read API and retention | retention open (U-7 → OQ-77) |
