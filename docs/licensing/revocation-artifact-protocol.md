# Signed revocation artifact — protocol design (`VREV1`)

- **Status:** **PROTOCOL DESIGN — normative for the implementation of OD-LIC-17.**
  Approved in direction by the Product Owner on 2026-10-20
  ([PDR-19 §10.3](../decisions/product/PDR-19-owner-side-issuance-decisions.md));
  this document is the protocol design that decision requires to exist **before**
  code.
- **Decision sources (binding):** **OD-LIC-17** (a separately versioned signed
  revocation artifact imported by the customer), **OD-LIC-16** (renewal and
  replacement remain `OWNER_ADMIN`-only), **OD-LIC-18** (duplicate import returns
  the historical result), **OD-LIC-19** (indefinite retention of exact bytes),
  **OD-LIC-11** (a full SHA-256 request digest confirmed over an independent
  channel before the private key is read), **OD-LIC-08** (air-gapped custody),
  **OD-LIC-10** (durable artifact store outside PostgreSQL).
- **Untouched contract:** `VLIC1`, `VLIC2`, `LICENSE_DOCUMENT_VERSION`, the
  canonical byte contract of [PDR-16](../decisions/product/PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md),
  every committed license vector, every signature and every existing customer
  verification rule. This is a **new** document type; it is not a `VLIC3` and it
  never appears inside a license payload.

---

## 1. Why a new artifact and not a license mutation

A license is signed **before** it is known whether it must later be revoked, so a
revocation cannot be encoded in the license's own bytes without re-signing the
license — which would overwrite the historical signed fact and violate
ADR-0046 Decision 1 (signed versions are retained, never rewritten). A separate
artifact is therefore the only shape that (a) can be produced after the fact,
(b) is independently verifiable offline, and (c) leaves every `VLIC2` byte and
vector unchanged.

Domain separation is structural, not conventional:

| Property | License | Revocation |
|---|---|---|
| Armored prefix | `VLIC2` | `VREV1` |
| File envelope `format` | `vardena-license` | `vardena-revocation` |
| Envelope payload key | `document` | `revocation` |
| Payload `v` | `2` | `1` |
| Payload `kind` | `SERVER_LICENSE_VERSION` | `SERVER_LICENSE_REVOCATION` |
| Signature input | canonical license payload | canonical revocation payload |

A parser for one type rejects the other **by prefix and by `kind`**, before any
signature is checked. There is no shared "any signed document" parser, and no code
path converts one into the other.

## 2. Encoding and signature

```
VREV1.<base64url(canonical revocation payload)>.<base64url(Ed25519 signature)>
```

- Signature algorithm: **Ed25519**, over the exact canonical payload bytes,
  identical to the license path (no pre-hash, no detached header).
- Trust: the **same** configured authority trust list the customer already uses for
  licenses (`LICENSE_SIGNING_PUBLIC_KEYS`, grammar `keyId:<material>` or bare key
  with a derived `sha256-<16 hex>` id, duplicate ids rejected). **No second signing
  key and no second trust list are introduced.** Using the same key is safe because
  the signed bytes are domain-separated by `kind` and the armor prefix.
- File envelope (primary transport):

```json
{
  "format": "vardena-revocation",
  "fileVersion": 1,
  "revocation": "VREV1.<payload>.<signature>",
  "keyId": "<trusted key id, optional hint>"
}
```

Unknown envelope keys are rejected. The envelope carries no authority; `keyId` is a
hint that must resolve to a trusted key **and** equal the signed `issuerKeyId`.

## 3. Canonical payload

Fixed order, fixed types, no optional-omission rules, no arrays, no free-form
objects. Every field is always present.

| # | Field | Type | Rule |
|---|---|---|---|
| 1 | `v` | integer | exactly `1` |
| 2 | `kind` | string | exactly `SERVER_LICENSE_REVOCATION` |
| 3 | `revocationId` | ULID string | unique identity of the revocation act; replay/idempotency key |
| 4 | `licenseId` | ULID string | the **targeted** license |
| 5 | `targetOperationId` | ULID string | the retained license-version operation id that existed when the revocation was authorized |
| 6 | `customerId` | ULID string | must equal the local license customer |
| 7 | `customerCode` | string | PDR-14 grammar; must equal the local customer code; never equal to `customerId` |
| 8 | `installationId` | ULID string | must equal **this** installation's identity |
| 9 | `effect` | string | exactly `LICENSE_ONLY` — targeted revocation only |
| 10 | `reason` | string | closed vocabulary: `NON_PAYMENT`, `CONTRACT_TERMINATION`, `FRAUD`, `KEY_COMPROMISE`, `ISSUED_IN_ERROR`, `COURT_ORDER`, `OTHER` |
| 11 | `reasonDetail` | string \| null | bounded ≤ 500 characters, no control characters, no key material patterns; required when `reason = OTHER`, optional otherwise |
| 12 | `issuerKeyId` | string | the trust-list id of the signing key; bound by the signature |
| 13 | `issuedAt` | string | ISO-8601 UTC instant ending in `Z` (the Owner-pinned authorization instant) |

There is deliberately **no** `supersedesRevocationId`, no `reactivatesLicenseId`
and no `validUntil`: a revocation of a license is final. Restoring service requires
a **new license** produced by the normal issuance flow (OD-LIC-17), never a
reversal artifact and never a re-imported old license.

### 3.1 Canonicalization

The revocation payload uses the **same canonical JSON rules** as the license
contract — the rules are inherited from
[`version-model-and-file-exchange.md`](./version-model-and-file-exchange.md) §2.1
and restated here so this document is self-contained:

- one-line JSON, **no whitespace** between tokens;
- the key order of §3 exactly;
- strings are JSON strings with the license contract's escaping: non-ASCII emitted
  **raw** (UTF-8); `\b`, `\t`, `\n`, `\f`, `\r` for U+0008/09/0A/0C/0D; `\u00xx`
  with lowercase hex for the remaining U+0000–U+001F; `\"` and `\\`;
- `null` is the literal `null`;
- `issuedAt` is `Date.prototype.toISOString()` (millisecond precision, `Z`);
- no BOM, no trailing newline in the armored document body.

The revocation format has **its own vector set** (`docs/licensing/vectors/revocation/`)
and a canonicalization test that pins literal expected bytes. It does **not** add,
remove or regenerate a single file in the license corpus; the license corpus stays
byte-identical and CI's regeneration diff must remain clean.

## 4. Verification order (fail closed, first failure wins)

The customer performs these checks in order and changes **no** state until all pass:

1. Envelope: object, `format`, `fileVersion = 1`, no unknown keys, non-empty
   `revocation` string.
2. Armor: exactly three dot-separated segments, prefix `VREV1`, non-empty payload
   and signature, base64url decodable.
3. Signature: resolve the envelope `keyId` hint (if present) against the trust list;
   attempt verification against the resolved key or the whole trust list; unknown
   key → `unknown-key`, no valid signature → `signature`.
4. Payload: JSON object, `v`, `kind`, field set exactly §3 (unknown or missing field
   → `payload`), ULID grammar, `customerCode` grammar and `customerCode ≠ customerId`,
   reason vocabulary, `reasonDetail` bounds and `OTHER` requirement, `issuedAt`
   parseable and canonical (`toISOString()` round-trip).
5. **Canonical form**: re-canonicalizing the parsed payload must reproduce the
   signed bytes exactly. A payload that verifies but is not canonical is rejected
   (`payload`), mirroring the license rule.
6. `issuerKeyId` equals the id of the key that actually verified the signature
   (`key-mismatch`).
7. **Customer binding**: a local `licensing.customers` row with `id = customerId`
   must exist and its `customer_code` must equal `customerCode`
   (`wrong-customer`).
8. **Installation binding**: `installationId` must equal this deployment's
   self-installation identity (`wrong-installation`).
9. **Target binding**: the license `licenseId` must exist locally, belong to that
   customer **and** installation, and `targetOperationId` must be one of its
   retained versions (`unknown-target`).
10. **Staleness**: `issuedAt` must not be in the future beyond a documented
    10-minute transport tolerance (`future-dated`), and must not precede the
    targeted version's `issuedAt` (`stale-revocation`). A revocation does not
    expire; it may be applied arbitrarily late.
11. **Replay/idempotency** (§6).
12. **State change**: insert the revocation row, mark the license revoked and write
    the audit event in **one database transaction**.

Every rejection returns a stable machine reason and a bounded, secret-free message.
No partial state is written, and the supplied artifact is never stored on the
customer installation.

## 5. Target semantics — targeted revocation only

- Effect is **license-scoped**: exactly one `licensing.licenses` row and its
  versions stop conferring entitlement. Other licenses of the same customer, other
  installations, device enrollments and unrelated customer facts are unaffected.
- `effect = LICENSE_ONLY` is signed, so a future broader effect would be a new
  signed value and a new protocol decision, not an interpretation of this one.
- `targetOperationId` is **evidence of what was current when the revocation was
  authorized**, not a filter: a renewal imported *after* the revocation was issued
  must **not** resurrect the license. The customer therefore:
  - refuses to import any license artifact (`VLIC1` or `VLIC2`) whose `licenseId` is
    already revoked (`license-revoked`), including an exact replay of the original
    license and including a newer renewal or supersession;
  - treats a revoked license as not entitled in every read model, regardless of
    version order or dates.
- A **new license** (`licenseId` different) follows the normal issuance flow and is
  the only approved path back to service.

## 6. Replay, idempotency and conflict

| Situation | Result |
|---|---|
| Same `revocationId`, byte-identical payload, already applied | **idempotent success**: `alreadyApplied: true`, the original stored result is returned; no second row, no second audit event, no state change |
| Same `revocationId`, different payload | `conflicting-replay`; nothing changes. (Requires a valid signature over different bytes, so it implies key misuse or operator error; it is recorded as a security-relevant refusal.) |
| Different `revocationId`, license already revoked | `already-revoked` with the **original** `revocationId` and `revokedAt`; the later artifact does not overwrite history |
| Valid revocation for another license of the same customer | applies to **that** license only |
| Valid revocation for an unknown `licenseId`, unknown `customerId`, or a license of another installation | refused (§4 steps 7–9) |

The Owner side applies the same table to its own import (OD-LIC-18): the first
registered result is historical fact and a duplicate returns it.

## 7. Owner-side flow

1. **Authorize and prepare.** An `OWNER_ADMIN` selects a `SIGNED_RECORDED` issuance,
   enters `reason` and optional `reasonDetail`, and the backend mints
   `revocationId`, pins `issuedAt`, derives `licenseId`, `targetOperationId`,
   `customerId`, `customerCode`, `installationId` **from the stored issuance row**
   (never from client input), and builds the canonical payload.
2. **Two digests, two jobs** (identical discipline to OD-LIC-11):
   - `request_payload_sha256` — SHA-256 over the canonical revocation payload,
     displayed in full 64-hex in the Owner UI, carried to the offline signer over a
     channel **independent of the request file**, and validated **before the private
     key is read or loaded**;
   - `request_binding_sha256` — SHA-256 over the *projection the signer must
     produce*, computed by the Owner at preparation and re-computed from the signed
     artifact at import. For the revocation artifact the projection is identical to
     the payload except that `issuerKeyId` must equal the resolving key id; the
     Owner checks that field and the signature, then compares the recomputed
     canonical digest.
3. **Request artifact**: `vardena-revocation-request` / `fileVersion: 1` /
   `request: "VRRQ1.<base64url(canonical payload)>"`. It is unsigned, is never
   described as a revocation, and carries no key material.
4. **Offline signer**: validates the envelope, payload, and the out-of-band digest
   **before touching the key**, signs the canonical payload with the same authority
   key, and writes the `vardena-revocation` envelope plus the printed digests.
5. **Import**: verify envelope, trust list, signature, canonical form, key status
   (`signing_keys.status = ACTIVE`), binding digest, `revocationId` and target
   identity against the stored operation; archive the **exact bytes**; advance the
   revocation operation to `SIGNED_RECORDED`; audit.
6. **Duplicate import** returns the historical result (OD-LIC-18) and creates no
   second archive entry.
7. **Download**: authorization-gated, server-derived path, digest re-verified before
   serving, access audited.

Owner-side authorization: preparing and importing a revocation is
`OWNER_ADMIN`-only. There is no operator grant for it (OD-LIC-16's separation of
term-changing authority is applied by analogy and recorded as a restriction, not as
an invented permission code). Downloads of revocation evidence are `OWNER_ADMIN`-only
as well.

## 8. Persistence

**Customer** (`licensing` schema, additive migration):

- `licensing.license_revocations`: `revocation_id` (PK), `license_id`,
  `installation_id`, `customer_id`, `target_operation_id`, `reason`,
  `reason_detail`, `issuer_key_id`, `issued_at`, `imported_at`, `imported_by`,
  `artifact_sha256`, `canonical_payload_sha256`; unique on `license_id` (one
  revocation per license) and on `revocation_id`.
- `licensing.licenses` gains `revoked_at` and `revocation_id` (nullable, set
  together, never cleared). Revocation is never a delete and never rewrites a
  version.

**Owner** (`owner` schema): a `license_revocations` ledger mirroring the issuance
ledger (identity, target, reason, digests, status, archive key, actors, timestamps)
with the same immutability trigger and staged states.

## 9. Audit events

| Side | Event | When |
|---|---|---|
| Owner | `LICENSE_REVOCATION_REQUEST_PREPARED` | request committed |
| Owner | `LICENSE_REVOCATION_REQUEST_DENIED` | permission, target-state or validation refusal |
| Owner | `LICENSE_REVOCATION_ARTIFACT_IMPORTED` | verified artifact archived and recorded |
| Owner | `LICENSE_REVOCATION_ARTIFACT_REJECTED` | signature/key/binding/state refusal |
| Owner | `LICENSE_REVOCATION_ARTIFACT_DOWNLOADED` | authorized retrieval |
| Customer | `REVOCATION_IMPORTED` | revocation applied |
| Customer | `REVOCATION_REJECTED` | refusal with its stable reason |

Audit records never contain key material, the artifact body or free-form customer
data beyond the bounded `reason`/`reasonDetail` already displayed to the operator.

## 10. What this protocol does **not** do

- It does not change `VLIC2`, its canonicalization, its vectors, its signature or
  any customer license-acceptance rule.
- It does not make a revoked license "expired": revocation is its own state and is
  never approximated by a date or a status rewrite.
- It does not permit reactivation, un-revocation, or re-signing an old license.
- It does not add a network revocation service, a customer callback or an online
  trust lookup.
- It does not decide the **policy** of when revocation is justified; it fixes the
  mechanism, the evidence and the failure behaviour (OD-LIC-17).
