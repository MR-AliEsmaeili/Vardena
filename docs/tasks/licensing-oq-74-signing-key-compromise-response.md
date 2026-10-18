# OQ-74 — Signing-key compromise response (Product Owner decision 2026-10-18)

- **Authority:** Product Owner decision recorded 2026-10-18 in conversation.
- **Status:** **Decided — implementation delivered in PR `arena/oq-74-signing-key-tracking`.**
- **Related:** [PDR-11 §3.9 / §10.1](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) (no automatic invalidation of already-issued licenses on key rotation/compromise), [ADR-0048](../adr/0048-owner-side-licensing-separation-boundary.md), [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md) (Owner app is observational; cryptographic issuance is "not implemented" there).

## 1. The question

What happens to licenses signed with an Owner signing key when that key is compromised? Specifically:

1. Is a new key generated as replacement?
2. Does the software produce future licenses with the new key?
3. What is the disposition of customers whose licenses were signed with the compromised key?
4. What does the Owner UI show about which key signed which license?

## 2. The decision

1. **A new key is generated as replacement.** The customer runtime's trust list is rotated: the new key is added and the compromised key is removed. Future licenses are issued with the new key. (This is already supported by the existing trust-list rotation mechanism on the customer side; no new infrastructure is required.)

2. **Disposition of customers with old licenses is the Owner's case-by-case decision.** There is **NO automatic invalidation** of already-issued licenses solely because the signing key is compromised. This preserves the PDR-11 §3.9 invariant: "no automatic invalidation of already-issued permanent licenses solely because a signing key is rotated or compromised, unless an explicitly approved incident policy requires a specific response."

3. **The Owner UI displays, per license observation, which signing key signed it.** A new `signingKeyId` column is added to the operations list. The Owner Admin registers each signing key in a new `signing-keys` page when it is generated (id + human-friendly label).

4. **A derived safety status column shows which licenses need Owner review vs which are safe:**
   - `SAFE` — signed with an `ACTIVE` key
   - `NEEDS_REVIEW` — signed with a `COMPROMISED` or `REVOKED` key
   - `UNKNOWN` — no signing key recorded for this observation

5. **Marking a key as `COMPROMISED` or `REVOKED` does NOT automatically invalidate any license.** It only changes the safety badge on every license observation linked to that key. The Owner must review each affected license case by case and decide: reissue with the new key, accept (if the license is still considered valid for business reasons), or pursue a separate revocation instrument (which is a separate open question — OQ-78, F2–F5).

6. **`REVOKED` is distinct from `COMPROMISED`**: `REVOKED` is for explicit administrative revocation separate from compromise (e.g. routine rotation, end of key lifetime). Both surface licenses as `NEEDS_REVIEW`, but the operational meaning is different and is recorded in the audit trail.

## 3. What this decision does NOT do

- It does **not** introduce a signed revocation artifact (that is OQ-78 / F3, still open).
- It does **not** automatically invalidate any already-issued license.
- It does **not** change signature verification on the customer runtime — the customer runtime remains the authority for actual signature verification (PDR-17). This decision only adds an administrative layer on the Owner side.
- It does **not** introduce a new permission or role. The two-role MVP (Owner Admin + License Operator) is preserved: both can read signing keys; only Owner Admin can mutate.
- It does **not** change renewal semantics, version-conflict rules, or any other licensing control.

## 4. Implementation summary

The implementation is delivered in branch `arena/oq-74-signing-key-tracking` (PR pending). Key files:

### Backend (`owner-licensing/backend/`)
- `migrations/006-signing-key-tracking.sql` — new `owner.signing_keys` table (id, label, status, status_detected_at, status_reason, evidence_ref, notes, audit fields) + `signing_key_id` column on `owner.operational_records` (nullable, FK, LICENSE-only CHECK constraint).
- `src/domain.ts` — `signingKeyStatuses` (`ACTIVE`/`COMPROMISED`/`REVOKED`), `SigningKeySafety` (`SAFE`/`NEEDS_REVIEW`/`UNKNOWN`), validators (`signingKeyId`, `signingKeyLabel`, `signingKeyStatus`, `signingKeyNotes`, `signingKeyEvidenceRef`), `signingKeySafety()` derivation, `signingKeyResponse()` allowlist.
- `src/signing-keys.ts` — new service: `listSigningKeys`, `getSigningKey`, `registerSigningKey` (idempotent on id+label), `updateSigningKeyStatus` (with reason + optional evidence), `updateSigningKeyNotes`, `findSigningKeyStatus` (helper for operations join).
- `src/operations.ts` — extended `listOperations` and `getOperation` to join signing-key status in one round-trip (no denormalized column to drift); `recordLicenseObservation` accepts optional `signingKeyId` (must already be registered); `recordActivationObservation` and the three server-replacement mutations pass the status through `operationResponse`.
- `src/domain.ts::operationResponse` — new fields: `signingKeyId`, `signingKeyStatus`, `signingKeySafety`.
- `src/app.ts` — five new routes: `GET /signing-keys`, `GET /signing-keys/:id`, `POST /signing-keys`, `POST /signing-keys/:id/status`, `PATCH /signing-keys/:id/notes`. Read routes use `customers.view`; write routes use `customers.write`.

### Frontend (`owner-licensing/frontend/`)
- `src/api/contracts.ts` — new `SigningKey` interface; extended `OperationalRecord` with `signingKeyId`, `signingKeyStatus`, `signingKeySafety`; added `SigningKey` to `AuditTargetType`.
- `src/api/owner.api.ts` — new functions: `signingKeys`, `signingKey`, `registerSigningKey`, `updateSigningKeyStatus`, `updateSigningKeyNotes`; extended `recordLicenseObservation` with optional `signingKeyId`.
- `src/features/signing-keys/signing-keys-page.tsx` — new page: list with search/status filters, register form (Owner Admin only), status-change form (Owner Admin only), `StatusBadge` component (color-coded by status).
- `src/features/signing-keys/signing-keys-page.test.tsx` — 5 focused tests: nav link visible, Owner Admin can register, SAFE badge shown for ACTIVE key, NEEDS_REVIEW badge shown for COMPROMISED key, License Operator sees page but no register form.
- `src/features/operations/operations-page.tsx` — new `SigningKeySafetyLine` component rendered inline per LICENSE observation, showing the key id + color-coded safety badge.
- `src/features/operations/operations-flow.test.tsx` — existing fixture updated with the three new fields (all `null`/`UNKNOWN`).
- `src/lib/owner-i18n.ts` — new Persian/RTL labels for all signing-key UI elements + new audit event labels (`SIGNING_KEY_REGISTERED`, `SIGNING_KEY_STATUS_CHANGED`, `SIGNING_KEY_NOTES_UPDATED`) + new audit target label (`SigningKey`).
- `src/app/layouts/app-shell.tsx` — new nav entry "کلیدهای امضا" gated behind `customers.view`.
- `src/app/router.tsx` — new route `/app/signing-keys`.

### Audit
Three new typed audit events:
- `SIGNING_KEY_REGISTERED` — when a new key is registered.
- `SIGNING_KEY_STATUS_CHANGED` — when a key is marked COMPROMISED/REVOKED/ACTIVE, with reason + optional evidence reference.
- `SIGNING_KEY_NOTES_UPDATED` — when notes are updated.

## 5. Security review

| Area | Finding |
|---|---|
| Private key material | **Never accepted, stored, or returned.** Validators (`signingKeyId`, `signingKeyLabel`, `signingKeyNotes`, `signingKeyEvidenceRef`) all reject the artifact-markers regex (`PRIVATE KEY`, `VLIC1`, `VLIC2`, `VDEA1`, `VDRQ1`, `VDRP1`, `-----BEGIN `) and control characters. The `signingKeyId` also rejects whitespace. |
| Authorization | Read routes (`GET /signing-keys`, `GET /signing-keys/:id`) use `customers.view` (both roles). Write routes (`POST /signing-keys`, `POST /signing-keys/:id/status`, `PATCH /signing-keys/:id/notes`) use `customers.write` (Owner Admin only). Enforced by the route permission via `assertActiveAuthorizedActor` + `assertPermission`. |
| Audit | Every mutation is audited with actor, type, target, reason, before/after state. |
| SQL injection | All queries use parameterized values (`$1`, `$2`, ...); the `id` and `signingKeyId` validators restrict to ULID-like strings or 1..120-char opaque strings. |
| Denormalization drift | None. `signingKeyStatus` is looked up live from `owner.signing_keys` on every list/get, never stored on `operational_records`. A status change on a signing key immediately propagates to every linked operation. |
| Migration safety | Forward-only additive migration. New table + new nullable column + 2 indexes. No rewrite of existing columns. No backfill needed. |
| Customer runtime | Untouched. The customer-side licensing module (`backend/src/modules/licensing/`) is unchanged. PDR-17 invariant preserved: the Owner app remains observational. |

## 6. Tests

| Suite | Tests | Result |
|---|---|---|
| `owner-licensing/backend/test/unit.test.ts` | 20 | passing |
| `owner-licensing/backend/test/domain-operations.test.ts` | 6 | passing |
| `owner-licensing/backend/test/audit-query.test.ts` | 40 | passing |
| `owner-licensing/backend/test/api.test.ts` (integration) | — | **deferred to CI** (requires `OWNER_TEST_DATABASE_URL`) |
| `owner-licensing/frontend/src/features/signing-keys/signing-keys-page.test.tsx` | 5 (new) | passing |
| `owner-licensing/frontend` (full suite) | 165 total (160 existing + 5 new) | passing |

Heavy integration tests (the `api.test.ts` suite that requires a disposable PostgreSQL database) are deferred to CI per the prompt's testing policy.

## 7. Status discipline

This decision is **decided and implemented**. The implementation is delivered on branch `arena/oq-74-signing-key-tracking` and is ready for human review. The OQ-74 registry row may be updated from "Open — decision" to "Decided — implementation delivered; CI verification and Product Owner acceptance outstanding."

This record does **not** close OQ-78 (signed revocation artifact), OQ-76 (clock rollback), or any other open question. It is bounded to the administrative tracking of signing keys and the UI safety column.
