# OD-LIC-07…10 — Owner-side issuance technical design (PDR-19)

- **Date:** 2026-10-19
- **Author:** engineering (design only; Arena session on `arena/59ce3185-vardena`)
- **Status:** **DESIGN — nothing here is implemented.** No signer, key, permission,
  migration, endpoint, artifact, DTO or UI exists as a result of this document.
  It is the technical design the `BLOCKED — TECHNICAL DESIGN REQUIRED` gate of
  [PDR-19 §0](../decisions/product/PDR-19-owner-side-issuance-decisions.md) asks
  for, and it is written to be reviewed before any code is written.
- **Decision source (binding, not reopened):**
  [PDR-19](../decisions/product/PDR-19-owner-side-issuance-decisions.md) —
  **OD-LIC-07** (permission split + per-user operator grants, and §5.1/§5.2
  answering forks F-1/F-2), **OD-LIC-08** (air-gapped offline signer and the
  four-step flow), **OD-LIC-09** (controlled registration of `installationId`),
  **OD-LIC-10** (dedicated durable artifact store).
- **Baseline:** `main` = `8fc52eee9a213872cb6df969cf3d9be187e96b24` (PR #185).
  Work branch base `510aca58ffdc7cb31b5d0b295d561a4db5d330fb` (PR #184); PR #185
  touches only `frontend/src/ui/patterns/data-table.test.tsx` and
  `docs/frontend/loading-system.md`, so every reference below was verified against
  a tree that is identical for all Owner and licensing sources. The local clone is
  shallow, so `git merge-base origin/main HEAD` returns empty; comparisons are made
  against explicit SHAs.
- **Related records:**
  [issuance blocked assessment](./licensing-owner-side-issuance-blocked-assessment.md) ·
  [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) ·
  [PDR-16](../decisions/product/PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md) ·
  [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md) ·
  [PDR-18](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md) ·
  [ADR-0046](../adr/0046-signed-license-documents-and-version-lifecycle.md) ·
  [ADR-0048](../adr/0048-owner-side-licensing-separation-boundary.md) ·
  [version model and file exchange](../licensing/version-model-and-file-exchange.md) ·
  [protocol vectors](../licensing/licensing-protocol-vectors.md) ·
  [Owner-side architecture](../licensing/owner-side-system-architecture.md) ·
  [Phase 0 readiness](./licensing-owner-side-phase-0-readiness.md)

---

## 0. Scope

This design covers the Owner-side issuance path end to end: the per-user
permission model, the optional per-customer limit profile, the installation
identity, the signing-request artifact, the offline signer, the import and
validation of the returned artifact, the issuance ledger, the durable artifact
store and download, the transaction and failure behaviour, audit, the API
surface, the Persian RTL UI states, and the test plan.

It does **not** decide anything PDR-19 left open, and it does not change any
signed byte format, canonicalization rule, vector, `VLIC1`/`VLIC2` verification
semantics or customer runtime behaviour.

Two hard constraints shape the whole design and are verified in §1 rather than
assumed:

1. **The Owner cannot import customer code.** So the Owner needs its own
   canonicalizer, signer and verifier, and their conformance must be *proven*,
   not asserted.
2. **Issuance is not synchronous.** OD-LIC-08 inserts a human-mediated offline
   round trip between "the Owner decided" and "an artifact exists", so the design
   must model an intermediate state honestly and must make tampering during
   transport detectable.

---

## 1. Preflight — verified constraints

### 1.1 The separation boundary forbids reusing the customer's crypto module

| Fact | Source |
|---|---|
| "No imports from customer `backend/` or `frontend/`. No shared runtime package." | `owner-licensing/README.md` (Boundaries) |
| Phase 1 acceptance: "no customer imports/runtime/database/replication" | ADR-0048, Phase 1 acceptance addendum |
| PDR-16 **D-2(a)** `VECTORS_ONLY`: "No shared runtime package is created … No dependency is introduced from the customer runtime to an Owner-side application." | PDR-16 |
| The Owner UI image already enforces a source allowlist of exactly seven canonical date files | ADR-0048 date-source addendum; `owner-licensing/frontend/Dockerfile.dockerignore`; `scripts/stage-date-foundation.mjs` |
| `scripts/check-owner-isolation.py` currently fails only on **customer** artifacts/sources referencing Owner; it does not police the reverse direction | read in full |

**Consequence.** The Owner implements its own Ed25519 canonicalize/sign/verify
against the ratified byte contract of
[`version-model-and-file-exchange.md`](../licensing/version-model-and-file-exchange.md)
§2.1. This is precisely the situation PDR-16 D-2(a) and ADR-0048 Decision 6 were
written for: *"Conformance is proven by a published, deterministically regenerated
vector set verified by both sides in CI"*, and the vector design states *"The Owner
implementation later loads the same directory. Same files, both sides, one
contract."*

Reading `docs/licensing/vectors/*.json` as data is **not** a code import and does
not breach the boundary. It is the approved mechanism.

**Recommended CI addition (design proposal, not yet a gate):** extend
`scripts/check-owner-isolation.py` (or add a sibling) to fail when Owner source
imports from `../../backend` or `../../frontend`. Today nothing enforces the
reverse direction, and a future convenience import would otherwise pass silently.

### 1.2 Generated vectors alone cannot prove conformance

[`licensing-protocol-vectors.md`](../licensing/licensing-protocol-vectors.md) §5.1
distinguishes two roles:

| | Generated vector | Independent golden fixture |
|---|---|---|
| Purpose | drift detection | contract proof |
| Committed under | `docs/licensing/vectors/**` | literals in the test tree |
| **Cannot catch** | implementation and generator moving together | — |

A corpus the customer implementation generated cannot refute that implementation.
If the customer canonicalizer and its generator both moved, regeneration would stay
byte-identical, CI would stay green, and an Owner verifier matching those vectors
would be matching a **changed** contract while believing it conforms.

**Consequence — mandatory.** The Owner conformance suite must contain **both**:

1. a corpus run over `docs/licensing/vectors/**` (`canonical/CAN-01…09`,
   `valid/OK-*`, `invalid/BAD-*`, `keys/*`, `rotation/ROT-*`), asserting canonical
   bytes, signatures and the **stable refusal reason strings**; and
2. **independent golden literals pinned in the Owner test tree**, encoding §2.1's
   documented escaping and ordering rules directly — non-ASCII emitted raw,
   `\b\t\n\f\r` for `U+0008/09/0A/0C/0D`, `\u00xx` lowercase hex for the rest of
   `U+0000`–`U+001F`, `\"` and `\\`, declared key order, sorted `modules`/
   `features`, no inter-token whitespace, `toISOString()` instants, conditional
   `deviceLimit` omission.

Neither alone is sufficient. This is the concrete mitigation for risk **R-3**
("a second implementation produces different canonical bytes → all signatures fail
in the field"), which the Phase 0 readiness record rates High-probability without
vectors.

### 1.3 Test key material already exists and must stay quarantined

`docs/licensing/vectors/keys/authority-a.json` and `authority-b.json` contain a
committed Ed25519 key pair labelled *"TEST-ONLY authority A (never signed a real
license)"*. This is an approved fixture (instruction §6: a test key is permitted in
a fixture or isolated test environment with a clear boundary).

**Binding rules for this design:**

- The Owner test suite may use these fixtures, and must assert they are labelled
  TEST-ONLY, so a fixture cannot be silently promoted.
- **No production or staging key is ever generated by code, committed, or read
  from a fixture.** The offline signer takes its key from the operator in the
  offline environment only.
- The key material is not repeated in this document, in any PR description, in
  logs, in audit events or in error messages.
- If a real key is absent, the Owner fails closed with an explicit, secret-free
  error. It never auto-generates or fakes one.

### 1.4 Customer-side temporal refusals constrain the offline delay

Verified in `license-import.service.ts:567-582`: a document with
`validUntil !== null && validUntil <= now` is refused as **`expired-document`**
(422, nothing written). Future-dated documents remain importable and take effect
by date (ADR-0046 Decision 4); `not-yet-valid` is a scheduled-version verdict, not
an import refusal; `backdated-supersession` (422) refuses a supersession that would
rewrite governance already exercised.

**Consequence.** Because OD-LIC-08 puts an unbounded human delay between request
and signature, and another between signature and customer import, a **time-limited
license whose end passes before the customer imports it becomes permanently
unimportable**. The design must therefore surface the request's age and the
artifact's remaining import window, and must treat a stale request as an
operational condition rather than silently re-issuing. No automatic expiry of a
pending request is invented here — see §15.

### 1.5 Reusable Owner patterns

| Need | Existing pattern to reuse |
|---|---|
| Durable write-once file store | `FilesystemAuditArchiveStore` (`src/archive.ts`): `link`+`unlink`, `chmod 0o444`, file and directory `fsync`, read-back verification, hash-chained `manifest.json` |
| Strict request validation | `object()` rejects unknown fields; `text()`, `customerCode()`, `page()`, `queryText()` in `src/domain.ts` |
| Actor authorization | `assertActiveAuthorizedActor()` — active, valid role, not `must_change_password`, holds the permission, all re-checked under lock in the same transaction as the work |
| Audit | `audit()` in `src/db.ts`, append-only, `clock_timestamp()`, retention and incident metadata enforced by migration `004` triggers |
| Migration discipline | numbered immutable SQL, advisory lock, transaction, SHA-256 ledger (`src/migrate.ts`); refuses known customer schemas |
| IDs | ULID (`ulid` package), 26-char, already the actor/customer id type |
| Route shape | `route(method, path, permission, …)` in `src/app.ts`, with denial audited (e.g. `OPERATION_MUTATION_DENIED`) |
| Jalali dates | staged canonical date foundation; `src/lib/date-time.ts`; `ui/patterns/date-input.tsx` |

---

## 2. Which instant is "the issuance day"?

PDR-18 §1.2 fixes activation start to the issuance day, mandatory, not editable,
from **trusted server-side** time. OD-LIC-08 splits issuance across at least three
instants, so the design must pin one of them.

| Candidate | Verdict |
|---|---|
| The Owner request-creation instant | **Chosen.** It is the moment the Owner decides to issue, it comes from the Owner's own trusted server clock, and it is knowable and recordable before the artifact exists |
| The offline signer's signing instant | Rejected. The Owner cannot know it in advance, so the request digest of §3.4 could not cover the dates; and it would let the transport delay silently move a commercial validity start |
| The Owner import instant | Rejected. That is when the Owner *learns* the artifact exists, not when it decided to issue; it is also unbounded and operator-controlled |

**Rule.** At request creation the Owner pins, from its own server clock:

- `issuedAt` — the issuance instant, `toISOString()` form;
- `validFrom` — the canonical BusinessDate of that same server day, per
  `docs/datetime.md` and ADR-0044's Jalali-first policy, converted to the
  instant the signed contract expects;
- `validUntil` — the issuer's chosen end (or `null` for perpetual), strictly later
  than `validFrom`, matching `assertPayload`'s existing `validity` rule.

The offline signer **may not alter any date**. It validates them (§4) and signs
them as given. Because the request digest covers them (§3.4), an altered date is
detected at import.

**Consequence to surface in the UI, not to hide:** the artifact's `validFrom` will
be in the past by the time the customer imports it. That is normal and already
supported — a license may be imported after its `validFrom` — but the operator must
see the request's age so a stale time-limited request is re-created deliberately
rather than signed and refused as `expired-document` at the customer (§1.4).

Browser time is never a source of truth: the UI sends no date for `validFrom`, and
the server rejects a client-supplied one as an unknown field.

---

## 3. The signing-request artifact (new kind)

OD-LIC-08 step 1 needs a file the operator can carry. PDR-19 records that this is
a **new artifact kind** carrying an *unsigned* payload, so PDR-16's constraints
("no existing signed byte format is changed", "no new canonicalizer", "no
`VLIC3`") are not breached — the signed artifact remains exactly `VLIC2`.

### 3.1 Naming and envelope

Proposed prefix **`VLSR1`** (Vardena License Signing Request), following the
existing vocabulary pattern (`VLIC1`, `VLIC2`, `VDEA1`, `VDRQ1`, `VDRP1`). A
versioned JSON envelope, mirroring the `vardena-license` file envelope's shape so
both sides read it the same way:

```json
{
  "format": "vardena-license-signing-request",
  "fileVersion": 1,
  "request": "VLSR1.<base64url(canonical request payload)>"
}
```

- Unknown top-level keys are **rejected**, exactly as the license file envelope
  rejects them — the envelope carries no authority.
- The envelope is **unsigned**. It is a transport container, not a credential. It
  must never be described in the UI or the API as a license, and no response may
  report `signedArtifactProduced = true` for it.

### 3.2 Request payload

Deliberately flat and typed — the same discipline as `LicenseVersionPayload`, so
every field is validated before it can reach the signer. Field order below is the
canonical order:

| Field | Meaning |
|---|---|
| `v` | `1` — request format version |
| `kind` | `"SERVER_LICENSE_ISSUANCE_REQUEST"` |
| `requestId` | Owner-minted ULID; the Owner-side identity of this attempt |
| `operationId` | The **signed** replay identity that will appear in the `VLIC2` payload. Minted by the Owner at request creation, so the Owner can detect a duplicate before signing |
| `licenseId` | Owner-minted ULID |
| `customerId`, `customerCode`, `customerName` | Canonical wire order per PDR-14 / ADR-0046 L-06 addendum |
| `installationId` | The ULID registered under OD-LIC-09 (§5.3) |
| `status` | `"ACTIVE"` — the import pipeline refuses any non-`ACTIVE` payload (`not-active`), so nothing else is issuable |
| `validFrom`, `validUntil` | Pinned by §2; `validUntil` `null` = perpetual |
| `organizationLimit`, `userLimit` | Positive integer or `null` (unlimited), per `assertPayload` |
| `deviceLimit`, `deviceLimitSpecified` | Omission is **UNSPECIFIED** and grants no capacity, never unlimited (PDR-15 §4) |
| `modules`, `features` | Sorted, drawn only from the real catalog (§3.5) |
| `supersedesOperationId`, `renewsOperationId` | Mutually exclusive; omitted from canonical bytes when absent, following the established `deviceLimit` precedent |
| `requestedAt` | The Owner server instant the request was created |
| `requestedByUserId` | Attribution only. **Never** an authority: the signer does not trust it and the customer never sees it |

### 3.3 Canonicalization

The request payload is canonicalized by **the same Owner canonicalizer** that
produces the `VLIC2` canonical bytes, under the identical §2.1 rules. This is
deliberate: one implementation, one rule set, one conformance suite (§1.2). A
second, request-only canonicalizer would be exactly the drift PDR-16 forbids.

The request is **not** a signed format and is **not** added to the vector corpus.
Adding it would change the corpus CI regenerates and diff-checks, and PDR-16 says
no signed byte format changes. Request conformance is instead proven by the
round-trip test of §13.2.

### 3.4 Tamper-evidence across the human transport

OD-LIC-08 has a human carrying a file between two environments, so the design must
detect alteration without signing the request (the Owner holds no key — that is the
whole point of OD-LIC-08).

**Mechanism — digest pinning, no new signed field:**

1. At request creation the Owner computes the canonical bytes of the request
   payload and stores `request_payload_sha256` on the issuance record (§5.1).
2. The offline signer signs exactly the payload it was given.
3. At import the Owner extracts the payload from the returned `VLIC2` artifact,
   recomputes its canonical bytes, and **requires the digest to equal the stored
   `request_payload_sha256`**. Any difference — a changed limit, module, date,
   customer or installation — is refused with a distinct reason and nothing is
   recorded as issued.

This proves the signed artifact is the artifact the Owner asked for, using only a
hash the Owner can compute on both sides. It requires **no change to the signed
format**, so no vector, no `VLIC3` and no customer-side change.

**What it does not prove,** stated plainly: it cannot prove the request was not
*read* in transit. The request contains commercial terms (customer, limits,
modules, dates), so it is confidential business data on removable media. §15
records the transport-handling question rather than inventing a rule.

### 3.5 Module and feature catalog

The Owner needs `KNOWN_MODULE_CODES` (`accounting`, `documents`, `inventory`,
`organization`, `rbac`, `users`, `workflow` — `license-code.ts:81-89`) to validate
`modules`. Copying the list into Owner source is risk R-3 in miniature: it can
drift silently.

**Chosen approach.** Do **not** hand-copy. Derive the Owner's accepted catalog from
the **vector corpus**, which is shared data and already CI-regenerated: the Owner
test suite asserts that the set of module codes appearing across
`docs/licensing/vectors/**` equals the set the Owner implementation accepts. If the
customer catalog changes, vector regeneration changes the corpus, and the Owner
assertion fails — turning silent drift into a red build.

The Owner still holds its own literal list (it must, to validate at runtime), but
that list is now **pinned by a cross-check against shared data** rather than by
hope. An unknown module is refused server-side before any request is produced; the
UI never offers a module the catalog does not contain.

---

## 4. The offline signer

### 4.1 Packaging and isolation

The signer is a **standalone CLI in the Owner package**, never part of the Owner
HTTP surface and never reachable from it. Constraints it must satisfy:

- **No network path.** It reads a request file and a key from the operator's
  offline environment and writes an artifact file. It makes no call to the Owner
  API, the Owner database, or any customer system — preserving ADR-0048 Decision 3
  and PDR-11 §11.1.
- **Not in any deployable web image.** The Owner API image must not contain it, and
  a CI gate should assert that, mirroring `scripts/check-production-artifacts.py`'s
  existing assertion that the customer image contains no issuer.
- **Refuses to run where it should not.** The existing dev issuer refuses
  `NODE_ENV=production`; this signer is the *production* issuance tool, so the
  guard inverts: it must refuse to run when it detects it is inside the Owner API
  process or a networked service context, and must refuse a key supplied through
  the Owner runtime configuration.
- **Key from the operator, never persisted.** The private key is read from the
  operator's offline environment (a prompt or a path the operator supplies on that
  machine) and is never written to disk by the tool, never logged, never echoed,
  and never included in its output or exit messages.

### 4.2 Validation before signing (OD-LIC-08 step 3)

The signer **validates the request and refuses to sign an invalid one**. Checks,
all fail-closed:

1. Envelope shape and `fileVersion`; unknown top-level keys rejected.
2. Request payload schema; unknown fields rejected.
3. `customerId`/`customerCode` grammar and consistency per PDR-14 — the code is
   never derived from the name and never defaulted to the id.
4. `installationId` grammar (ULID).
5. Limits: positive integer or `null`; zero and negative refused.
6. Modules/features against the catalog; duplicates refused.
7. Dates: `validUntil === null` or strictly later than `validFrom`; `validFrom`
   not in the future relative to the signer's clock beyond a small documented
   transport tolerance; `requestedAt` not in the future.
8. `supersedesOperationId` and `renewsOperationId` mutually exclusive, and neither
   equal to this request's own `operationId`.
9. `status === "ACTIVE"`.

The signer **cannot** validate the commercial facts — whether this customer should
get these limits, or whether this installation identity is really that customer's
server. Those are Owner-record facts and human responsibilities; the signer only
guarantees that what it signs is well-formed and is what the request asked for.

### 4.3 Output

The signer writes the `VLIC2` artifact and the `vardena-license` file envelope with
the `keyId` of the key used, so the customer's trust-list lookup is addressable
(ADR-0046 Decision 7). It prints a SHA-256 of the artifact for the operator to
compare against what the Owner records at import — an out-of-band integrity check
that costs nothing and catches a corrupted transfer.

It writes **no** log containing the key, the raw private material, or a full
payload dump.

---

## 5. Data model

All tables in schema `owner`, additive migration `007-owner-license-issuance.sql`,
forward-only, no destructive rollback, safe on both a fresh and a populated
database, no backfill of invented facts.

### 5.1 `owner.license_issuances` — the issuance ledger

One row per issuance attempt, created at **request** time, so an interrupted
transport can never produce an unrecorded signature (Owner-side architecture §3.6
step 7).

| Column | Notes |
|---|---|
| `id` | ULID PK |
| `customer_id` | FK → `owner.customers(id)`, `NOT NULL` |
| `customer_code` | Denormalized snapshot, PDR-14 grammar, immutable — the code cannot change later, so the signed fact stays interpretable |
| `license_id` | ULID, unique — goes into the signed payload |
| `operation_id` | ULID, **unique** — the signed replay identity; the uniqueness constraint is what stops one request being signed and recorded twice |
| `installation_id` | FK → `owner.installation_identities(id)` (§5.3), `NOT NULL` |
| `license_kind` | `'PERPETUAL' | 'TIME_LIMITED'`, derived and checked against `valid_until IS NULL`, never entered independently |
| `valid_from`, `valid_until` | `timestamptz`; `valid_until IS NULL` ⇔ perpetual; CHECK enforces `valid_until > valid_from` when present |
| `organization_limit`, `user_limit` | `integer NULL`; CHECK `> 0` when not null |
| `device_limit`, `device_limit_specified` | The UNSPECIFIED-vs-unlimited distinction must be stored as two columns, exactly as the signed payload carries it — collapsing them into one nullable column would lose a signed fact |
| `module_entitlements`, `feature_entitlements` | `text[]`, CHECK for no duplicates and non-empty modules |
| `limit_profile_id` | FK → §5.2, **nullable** (F-1 hybrid: null means no ceiling was stored) |
| `signing_key_id` | FK → `owner.signing_keys(id)`, nullable until the artifact is imported, because the Owner does not know which key the offline signer used until the envelope says so |
| `protocol_version`, `file_format_version` | `'VLIC2'`, `1` — the format identity, so a future format change is explicit rather than implicit |
| `status` | The state machine of §9.1 |
| `request_payload_sha256` | The pinned digest of §3.4 |
| `request_file_name` | Safe filename for the request the operator downloaded |
| `requested_at`, `requested_by` | Server clock and actor |
| `signed_at`, `signed_by`, `imported_at`, `imported_by` | Nullable until those steps happen |
| `artifact_sha256`, `artifact_store_key` | Nullable until import; the only pointer to the stored file (§8) — never a client-supplied path |
| `created_at`, `updated_at` | `clock_timestamp()`, matching the existing convention |

**No JSONB column.** Instruction §4 forbids a vague all-purpose structure, and
every field above is a typed domain fact with its own constraint.

Immutability follows the existing pattern: identity, customer, license/operation
ids, dates, limits, entitlements and `request_payload_sha256` are frozen by a
`BEFORE UPDATE` trigger, mirroring `owner.immutable_operation_facts`. Only status
and the step timestamps/actors may advance, and only along §9.1's legal path.

### 5.2 `owner.customer_limit_profiles` — the optional ceiling (F-1 hybrid)

Exists because the Product Owner chose the hybrid: when a profile exists for a
customer, the operator is bounded by it.

| Column | Notes |
|---|---|
| `id` | ULID PK |
| `customer_id` | FK → `owner.customers(id)`, **unique** — at most one active ceiling per customer, so "which profile bound this issuance" can never be ambiguous |
| `organization_limit`, `user_limit` | `integer NULL`, CHECK `> 0` when not null; `NULL` means the profile places **no** ceiling on that dimension, which is different from `0` |
| `allowed_modules` | `text[]`, non-empty, no duplicates, catalog-validated |
| `perpetual_allowed` | `boolean NOT NULL DEFAULT false` — recorded so a profile can state that this customer may never receive a perpetual grant from an operator, which is the natural Owner-side use of the ceiling. `OWNER_ADMIN`-only perpetual issuance (OD-LIC-07) is unaffected and stays enforced by permission |
| `status` | `'ACTIVE' | 'RETIRED'` — retired profiles never bind a new issuance but must remain readable, because past issuances reference them |
| `created_by`, `updated_by`, `created_at`, `updated_at` | `OWNER_ADMIN` only |

**Binding rule.** At request creation, if an `ACTIVE` profile exists for the
customer, every requested limit must be within it: a requested cap must be `NULL`
only where the profile is `NULL`, and `<=` the profile's cap otherwise; requested
modules must be a subset of `allowed_modules`; and a perpetual request is refused
when `perpetual_allowed` is false. Refusal is a distinct, stable reason with the
profile's values in the safe error payload, so the operator sees *which* ceiling
blocked them.

If **no** `ACTIVE` profile exists, no ceiling is applied and the operator's entry
is bounded only by their granted permissions (§5.2 of PDR-19). The UI must show
which case is in force — an operator must not read "no profile" as "profile with no
ceiling".

The profile is an Owner-side ceiling on what may be signed. It is **not** a
customer entitlement, not a commercial contract record, and not a substitute for
PDR-18 §1's date rules.

### 5.3 `owner.installation_identities` — OD-LIC-09

Separate from `owner.operational_records.installation_reference`, which keeps its
existing meaning as an *observed* reference and must not be silently promoted to
signed identity.

| Column | Notes |
|---|---|
| `id` | ULID PK |
| `customer_id` | FK → `owner.customers(id)` |
| `installation_id` | The customer's server-generated ULID, validated against ULID grammar. Unique per customer |
| `source` | Where the value came from. Initial vocabulary: `'CUSTOMER_VARDENA_SCREEN'` (OD-LIC-09's "read from the customer's Vardena page"). Extensible by migration, never by client input |
| `source_detail` | Bounded free text, optional, control-character and secret-pattern rejected as migration `006` already does |
| `confirmed_by` | FK → `owner.users(id)` — the operator who confirmed it |
| `confirmed_at` | Server clock |
| `confirmation_evidence_ref` | Bounded optional reference, matching the existing `evidence_ref` convention |
| `status` | `'ACTIVE' | 'RETIRED'` |
| `created_by`, `created_at` | Immutable |

**The recorded source is a claim, never a proof.** ADR-0048 Decision 5 stands, so
no API response, UI label or audit event may describe this binding as
cryptographically verified. The residual risk PDR-19 §3 records is **not**
eliminated by this table: a transcription error still yields a validly signed
artifact bound to the wrong server.

**Confirmation flow (design).** Registration is a two-step UI act: enter the
identifier, then an explicit confirmation screen that displays the resolved
customer, the identifier, the source and the consequence of an error, and requires
a deliberate confirm. The confirmation is what `confirmed_by`/`confirmed_at`
record. Whether re-entry (typing it twice) is also required is a UX decision
proposed here as **yes for the first slice**, because it is the cheapest available
mitigation of a transcription error that cannot be undone.

An issuance may only reference an `ACTIVE` identity belonging to the **same
customer** as the license, enforced by a compound FK, so a cross-customer binding
is impossible at the schema level and not merely at the service level.

### 5.4 `owner.user_permission_grants` — F-2

| Column | Notes |
|---|---|
| `user_id` | FK → `owner.users(id)`, part of PK |
| `permission` | `text`, part of PK, CHECK against the exact known vocabulary — **no wildcard, no prefix, no pattern** |
| `granted_by` | FK → `owner.users(id)`, must be an `OWNER_ADMIN` |
| `granted_at` | Server clock |
| `revoked_by`, `revoked_at`, `revocation_reason` | Nullable; set together or not at all, by CHECK |

A row with `revoked_at IS NULL` is an active grant. Revocation is a **row update,
never a delete**, so the history of who had what survives — consistent with the
append-only discipline elsewhere in the Owner schema.

Only `LICENSE_OPERATOR` users may hold grants (§5.2 of PDR-19: `OWNER_ADMIN` is not
configurable), enforced by a trigger that also refuses a grant of the
perpetual-issuance permission to any operator.

**Effective permission resolution** becomes: for `OWNER_ADMIN`, the static role
set (unchanged); for `LICENSE_OPERATOR`, the static role set **intersected with**
active grants. Intersection, never union — a grant can narrow this role's access
but can never widen it beyond what PDR-17 already gives it, and can never add a
permission the role is ineligible for. That preserves OQ-75's "no new signing,
custody, or recovery permission is inferred" while implementing what the Product
Owner asked for.

Resolution happens **inside the same locked transaction** as the work, using the
existing `assertActiveAuthorizedActor` shape, so no stale decision is taken from a
session, a cookie or the frontend.

**Default for a new operator: fail-closed.** A newly created `LICENSE_OPERATOR`
gets **no issuance grant**. Non-issuance access follows the role until
`OWNER_ADMIN` narrows it.

---

## 6. Permission vocabulary

Proposed codes, following the existing `noun.verb` convention
(`customers.write`, `operations.record`, `replacements.authorize`):

| Code | Meaning | `OWNER_ADMIN` | `LICENSE_OPERATOR` (configurable) |
|---|---|---|---|
| `licenses.issue.time_limited` | Create a signing request for a time-limited license | yes | **yes**, fail-closed default |
| `licenses.issue.perpetual` | Create a signing request for a perpetual license | yes | **no — outside the configurable set** (OD-LIC-07) |
| `licenses.import` | Import and record a returned signed artifact | yes | **yes**, fail-closed default |
| `licenses.view` | List and inspect issuances | yes | **yes** |
| `licenses.download` | Download a stored artifact | yes | **yes** |
| `limit_profiles.manage` | Create/retire a customer limit profile | yes | **no** — the profile is the Owner's ceiling on the operator, so an operator must not be able to raise it |

Existing codes (`customers.view/write`, `users.manage`, `audit.view`,
`audit.archive`, `operations.view/record`, `replacements.authorize`) are unchanged
in meaning and become configurable for `LICENSE_OPERATOR` where that role is
eligible, per F-2.

Unknown codes deny. Superseded four-role identifiers continue to deny. Granting
`limit_profiles.manage` or `licenses.issue.perpetual` to an operator is refused by
the schema trigger **and** by the service, so the restriction does not depend on
one layer.

---

## 7. Transaction, atomicity and failure behaviour

### 7.1 The two-resource problem is real and is not claimed away

Instruction §8 is right that a PostgreSQL transaction cannot make a filesystem
write atomic. This design has **three** stores: the Owner database, the request
file handed to the operator, and the artifact store of §8. They are reconciled by
**ordering plus a recoverable staging state**, not by pretending one transaction
covers them.

**Request creation (step 1)** — one database transaction:
validate actor and permission → lock the customer row → resolve-or-create the
customer (PDR-14 code validation) → resolve the `ACTIVE` installation identity →
apply the limit profile if one exists → mint `operationId`/`licenseId` → pin dates
from the server clock (§2) → compute and store `request_payload_sha256` → insert
the issuance row as `REQUEST_PREPARED` → audit → commit. **Then**, outside the
transaction, serialize the request file and stream it to the operator.

The artifact handed to the operator is **derived entirely from the committed row**,
so it can always be regenerated byte-identically. If streaming fails, the row
exists and the operator re-downloads — no orphan file, no unrecorded request. The
row is not marked complete by a successful download; it stays `REQUEST_PREPARED`
until an artifact returns.

**Import (step 4)** — staged, then one database transaction:

1. Outside any transaction, write the uploaded artifact to a **staging path** in
   the artifact store (a temporary name, not the final write-once name).
2. Verify the signature with the Owner verifier against the trusted public keys
   (§8.3), parse the envelope, and require the payload digest to equal the stored
   `request_payload_sha256` (§3.4).
3. Require the artifact's `operationId` to match the issuance row being completed.
   A signature valid but not matching any prepared row is refused — the Owner does
   not adopt artifacts it did not request.
4. Only now open the transaction: lock the issuance row, re-check status and actor
   permission, promote the staged file to its final write-once name with read-back
   verification, update the row to `SIGNED_RECORDED` with `artifact_sha256`,
   `artifact_store_key`, `signing_key_id`, `signed_at` and `imported_by`, write the
   audit event, commit.
5. On any failure after staging, **delete the staged file** and leave the row
   untouched at `REQUEST_PREPARED`.

Because promotion happens inside the transaction's critical section and staging is
outside it, the failure modes are bounded: a crash before commit leaves a staged
file that a startup sweep and a periodic cleanup remove, and a row still at
`REQUEST_PREPARED` that can be completed by retry. **There is no state in which a
row says issued while no artifact exists, or an artifact exists while no row
records it.**

### 7.2 Failure and retry

| Failure | Result | Retry |
|---|---|---|
| Validation, permission, profile-ceiling or unknown-field refusal at step 1 | Nothing written; refusal audited | Correct and retry; a new `operationId` is minted only if the previous row is explicitly abandoned |
| Request file download fails | Row committed at `REQUEST_PREPARED` | Re-download; byte-identical |
| Signer refuses the request | No artifact; nothing changes in Owner | Fix the request via a new issuance row; the old one is abandoned explicitly, never silently reused |
| Artifact fails verification, digest match or `operationId` match at step 4 | Staged file deleted; row stays `REQUEST_PREPARED`; refusal audited | Re-import the correct artifact |
| Crash between staging and commit | Staged orphan; row unchanged | Sweep removes the orphan; re-import succeeds |
| Re-import of the **same** artifact for the **same** row already `SIGNED_RECORDED` | Idempotent: return the recorded result, change nothing, and say it is a replay | No second row, no second artifact |
| Concurrent imports of one row | Serialized by the row lock; the loser sees the winner's state and returns the recorded result | No duplicate |

**Retry must not mint a second license.** `operation_id` and `license_id` are
unique, so a duplicate insert fails at the database rather than at the service
layer alone — the same lesson ADR-0046's PR #138 addendum records for
`license-binding-conflict`, where a pre-check alone was not a sufficient guard.

A repeated **successful** import returns the historical result with an explicit
replay indicator and the current state separately, following the shape PDR-18 §5
approves. The exact response DTO is OQ-81's open contract and is **not** decided
here; §15 records it.

### 7.3 A new customer must not be orphaned by a failed issuance

Instruction §12.2 item 18. Creating the customer and creating the issuance row
happen in **one** transaction (§7.1), so a refusal leaves no orphan customer. If
the issuance is later abandoned, the customer remains — which is correct, because
a customer is a durable business record, not a by-product of one attempt. Nothing
in this design deletes customers, and no deletion path exists in the Owner API.

### 7.4 Revoked grant mid-flow

Per PDR-19 §5.2, revocation blocks **new** requests only. A prepared request stays
completable. The design narrows that window as far as the decision allows without
exceeding it:

- Only the request's **creator**, or an `OWNER_ADMIN`, may import it — so
  attribution stays exact and a different operator cannot complete someone else's
  in-flight issuance.
- The importer must still be authenticated, active, not under
  `must_change_password`, and hold `licenses.import`.
- If the creator's `licenses.import` grant was revoked between request and import,
  the import is **refused** — the Product Owner's decision preserves the *request*,
  not a permission the actor no longer holds. `OWNER_ADMIN` can still complete it,
  and the refusal is audited.
- Every completion records whether a relevant grant was revoked in between, so the
  accepted trade-off is visible in the audit trail rather than silent.

This is an engineering reading of the decision, flagged as such; it never widens
what the Product Owner approved.

---

## 8. Artifact store and download (OD-LIC-10)

### 8.1 Storage

A dedicated durable file store **outside PostgreSQL**, following the
`FilesystemAuditArchiveStore` pattern: write-once (`link` + `unlink`, `chmod
0o444`, file and directory `fsync`), read-back verification, and a hash-chained
manifest.

**Separate root, not the audit archive's.** Configured as
`OWNER_LICENSE_ARTIFACT_DIR`. License artifacts and audit bundles have different
retention, access and disclosure properties, and sharing one root would couple
their backup lifecycles and let one feature's access rule leak into the other. The
same caveat the README already records for `OWNER_AUDIT_ARCHIVE_DIR` applies: a
distinct filesystem path alone does not guarantee physical independence, and
provisioning a dedicated durable volume remains a deployment-owner requirement.

Fails closed with `503 ArtifactStorageUnavailable` when the directory is not
configured, mirroring `ArchiveStorageUnavailable`. A successful database write is
**never** reported as proof the artifact is durably stored.

Layout: `licenses/<ulid-prefix>/<issuance-id>.vardena-license.json`. The path is
computed **only** from the issuance id held in the database.

### 8.2 Download

- Requires `licenses.download` and the issuance to be `SIGNED_RECORDED`.
- Scoped by **issuance id**. The path is derived server-side from the stored
  `artifact_store_key`; **no part of it comes from client input**, so path
  traversal is impossible by construction rather than by filtering.
- Filename is the safe, stored `vardena-license` name; content type is
  `application/json`.
- Before serving, the stored file's SHA-256 is re-verified against
  `artifact_sha256`; a mismatch fails closed and is audited as a security incident
  under the existing `004` incident rules.
- Every retrieval is audited (instruction §9), without the artifact content.

### 8.3 Verifying the returned artifact — which keys does the Owner trust?

The Owner must verify a signature without holding a private key, and its
`signing_keys` table holds **no key material at all** (§1.3 of the assessment).
Verification therefore needs the **public** trust list.

**Design.** The Owner reads a public trust list from its own configuration,
`OWNER_LICENSE_TRUSTED_PUBLIC_KEYS`, using the **same grammar the customer uses**
(`keyId:<material>` or bare, derived id `sha256-<16 hex>`, duplicate ids rejected)
so a key id means the same thing on both sides and `signing_keys.id` can finally be
bound to something real. Public keys are not secret; storing them in configuration
is consistent with the customer runtime and with ADR-0046 Decision 7's "rotation is
a trust-list operation".

At import:

1. Resolve the envelope's `keyId` against the trust list. An unknown key is
   refused with a distinct reason — the Owner does not record an artifact its own
   trust list cannot explain, even if the signature is mathematically valid.
2. Verify the Ed25519 signature over the canonical payload bytes.
3. Require the resolved key id to reference an `owner.signing_keys` row whose status
   is `ACTIVE`. A key marked `COMPROMISED` or `REVOKED` **fails closed** —
   instruction §6's requirement, and the first thing that gives the OQ-74 metadata
   a real enforcement role instead of a decorative one.
4. Record `signing_key_id` from the **resolved** key, never from operator input.

Note the asymmetry this creates with OQ-74's policy: refusing to *record* a
compromised-key artifact on the Owner side does **not** invalidate licenses already
issued and imported by customers, which PDR-11 §4.4 forbids. Both hold: the Owner
stops issuing under a bad key; existing customer licenses are untouched.

The trust list is configuration, so changing it is a deployment act. That is
deliberate: rotation cadence and trust rollout are still U-1/OQ-74 open items, and
building a runtime key-administration surface would pre-empt them.

---

## 9. State machine

### 9.1 States

```
REQUEST_PREPARED ──import+verify ok──▶ SIGNED_RECORDED   (terminal)
        │
        └──explicit operator action──▶ ABANDONED          (terminal)
```

- `REQUEST_PREPARED` — the Owner decided and produced a request. **No artifact
  exists. This is never presented as an issued license.**
- `SIGNED_RECORDED` — a verified artifact is stored and downloadable. Terminal.
- `ABANDONED` — an explicit, reasoned, audited operator act. Terminal, and it never
  deletes the row, because the row is the record that a request was made.

No `PENDING_APPROVAL` state exists: PDR-17 forbids a pending-approval workflow, and
OD-LIC-08's round trip is a custody mechanism, not an approval step. No
cancellation, renewal, revocation or recovery state is defined, so none is
implemented — consistent with migration `002`'s existing discipline.

Renewal and supersession are **not** statuses. They are the `renewsOperationId` /
`supersedesOperationId` fields of a new issuance row, following PDR-18 §9 and
PDR-12. Whether an operator may create them at all is a permission question
(`licenses.issue.time_limited` plus the field), and the term-changing power of an
explicit supersession stays restricted per PDR-12 — §15 records that this needs an
explicit answer before an operator is given it.

### 9.2 Enforcement

Transitions are enforced by a `BEFORE UPDATE` trigger in the same style as
`owner.enforce_observed_transition`, so a direct SQL update cannot skip a state or
reach a terminal state illegally. Status may only advance along the arrows above;
`signed_at`/`imported_at` must be set together with `SIGNED_RECORDED` and must be
null otherwise; `artifact_sha256` and `artifact_store_key` likewise.

---

## 10. Audit events

All through the existing `audit()`, inside the same transaction as the state
change, append-only, server clock, actor from the locked session — never from
client input. No private key, no password, no session token, no raw signed payload,
no artifact content.

| Event | When | Outcome |
|---|---|---|
| `LICENSE_REQUEST_PREPARED` | step 1 committed | `SUCCESS` |
| `LICENSE_REQUEST_DENIED` | permission, validation, profile-ceiling or unknown-field refusal | `DENIED` → `security_incident` per the existing `004` rules where it is a permission denial |
| `LICENSE_REQUEST_ABANDONED` | explicit abandonment, with reason | `SUCCESS` |
| `LICENSE_ARTIFACT_IMPORTED` | step 4 committed; includes the resolved `signing_key_id` and whether a relevant grant was revoked in between | `SUCCESS` |
| `LICENSE_ARTIFACT_REJECTED` | bad signature, unknown or non-`ACTIVE` key, digest mismatch, `operationId` mismatch, malformed envelope | `FAILED` → security incident |
| `LICENSE_ARTIFACT_DOWNLOADED` | each retrieval | `SUCCESS` |
| `LICENSE_ARTIFACT_INTEGRITY_FAILURE` | stored digest mismatch at download | `FAILED` → security incident |
| `SIGNING_KEY_USED` | the key resolved at import | `SUCCESS` — satisfies instruction §9's "signing-key use at the audit level the project requires" without recording any key material |
| `CUSTOMER_CREATED_DURING_ISSUANCE` | a new customer created inside step 1 | `SUCCESS` |
| `LIMIT_PROFILE_CREATED` / `LIMIT_PROFILE_RETIRED` | §5.2 management | `SUCCESS` |
| `USER_PERMISSION_GRANT_CHANGED` | grant or revocation, with before/after and reason | `SUCCESS` |
| `INSTALLATION_IDENTITY_REGISTERED` | §5.3, with `source` and confirmation actor | `SUCCESS` |

Target types extend the existing audit filter vocabulary (`Customer`,
`OperationalRecord`, `User`, `AuditArchiveBatch`, `SigningKey`) with
`LicenseIssuance`, `CustomerLimitProfile` and `InstallationIdentity`. The audit
explorer's exact-match filters and its 50-row paging are reused unchanged; no audit
edit or delete endpoint is added, and the retention and archive rules of migration
`004` apply to these events without modification.

---

## 11. API surface

Under `/api/v1`, following the existing `route(method, path, permission, …)` shape,
JSON + `x-owner-request: 1` on mutations, Origin equal to the configured public
origin, no CORS.

| Method | Path | Permission |
|---|---|---|
| GET | `/license-issuances` | `licenses.view` — `page`, literal `search` ≤100 chars, optional `customerId`, `status`, `licenseKind`; 50-row pages with `hasNext` |
| POST | `/license-issuances/requests` | `licenses.issue.time_limited` or `licenses.issue.perpetual` per `licenseKind` |
| GET | `/license-issuances/:id` | `licenses.view` |
| GET | `/license-issuances/:id/request-file` | `licenses.view` — regenerate byte-identically from the committed row |
| POST | `/license-issuances/:id/abandon` | `licenses.view` + creator or `OWNER_ADMIN`; reason required |
| POST | `/license-issuances/:id/artifact` | `licenses.import` — multipart or JSON upload of the signed file |
| GET | `/license-issuances/:id/artifact` | `licenses.download` |
| GET/POST | `/customer-limit-profiles` | `limit_profiles.manage` |
| POST | `/customers/:id/limit-profile/retire` | `limit_profiles.manage` |
| GET/POST | `/installation-identities` | `licenses.view` / `licenses.issue.*` |
| PATCH | `/users/:id/permission-grants` | `users.manage` — explicit allowlist, no wildcard, audited |

Request bodies are validated with the existing `object()` allowlist, so **unknown
fields are rejected** (instruction §10). All queries are parameterized. No endpoint
accepts a file path, a key, a date for `validFrom`, or an actor id. Error responses
carry the existing `code` / bounded safe `message` / `correlationId` shape with
stable codes (`ValidationFailed`, `PermissionDenied`, `EntityNotFound`, `Conflict`,
`InvalidTransition`, plus the new `LimitProfileCeilingExceeded`,
`InstallationIdentityNotFound`, `ArtifactVerificationFailed`,
`RequestDigestMismatch`, `UnknownSigningKey`, `SigningKeyNotActive`,
`ArtifactStorageUnavailable`); technical detail goes to the secure log, never to the
client, and no error may reveal whether a private key exists.

The existing `operational-records/license-observations` path is **unchanged** and
stays what it is: an `OPERATOR_OBSERVED` record whose responses say
`cryptographicVerification = NOT_IMPLEMENTED`. It must not be repurposed to mean a
real issuance, and the two must be visually distinguishable in the UI (§12).

---

## 12. Persian RTL UI

Built on the existing primitives and patterns — `ui/patterns/*`, `owner-states`,
`api-error-alert`, `date-input`, `form-field`, the session/query conventions — with
no parallel design system and no duplicated component.

### 12.1 Issuance list

Columns: license id, customer (code + display name), kind (دائمی / مدت‌دار),
status, `validFrom`/`validUntil` in Jalali with Persian digits, main limits, and a
download control **only** for `SIGNED_RECORDED` rows. Search and pagination on the
existing 50-row pattern; loading and API-error states; no key material and no
artifact content shown. `REQUEST_PREPARED` rows must be labelled as awaiting
signature — never as issued.

### 12.2 Create form

- Existing-customer selection **or** in-flow creation, with PDR-14 code validation
  server-side as well as client-side.
- Installation identity: select an `ACTIVE` identity of the same customer, or
  register one — with the source recorded (`CUSTOMER_VARDENA_SCREEN`), the
  two-step confirmation of §5.3, and explicit copy stating that this is an
  attributed claim, not a verified binding.
- Perpetual vs time-limited; the end-date field is shown **only** for time-limited,
  and is empty and disabled for perpetual. No synthetic default expiry is ever
  pre-filled.
- `validFrom` is **displayed, not entered** — it is the server's issuance day
  (§2). The UI states this and sends no date for it.
- Organization and user caps, device limit with the UNSPECIFIED-vs-unlimited
  distinction made visible as three states rather than two.
- Module selection from the real catalog only (§3.5); the UI cannot offer a module
  the catalog does not contain.
- When an `ACTIVE` limit profile exists for the customer, its ceiling is shown and
  the inputs are constrained by it; when none exists, the UI says so explicitly.
- Perpetual is offered only to a user holding `licenses.issue.perpetual`.
- A summary review step, then an explicit final confirmation that names the
  consequence: the request will be produced for offline signing and **no license
  exists yet**.

### 12.3 Non-synchronous result states

Because issuance is not one click, the UI must not imply otherwise:

1. **Request produced** — download the `VLSR1` file, with operator instructions and
   a clear statement that nothing is issued yet.
2. **Awaiting signature** — the row's standing state; shows the request's age
   (§1.4) so a stale time-limited request is visible.
3. **Import** — upload the signed file; shows the verification result; on success
   offers the real download.
4. **Recorded** — downloadable, with `artifact_sha256` shown for out-of-band
   comparison against what the signer printed (§4.3).

Double-submit prevention, a visible pending state on every mutation, success
messages only after a real successful response, and comprehensible Persian errors
for permission, validation, profile-ceiling, unusable-key, digest-mismatch,
storage-unavailable and server failures. Accessibility, focus management, keyboard
navigation and responsive layout follow the existing Owner standards. No inert or
placeholder control: anything the backend cannot yet do is absent, not disabled
with a fake promise.

Jalali display with Persian digits for user-facing dates; ASCII canonical values at
the API and storage boundary, per the project-wide date contract and ADR-0048's
date-source addendum. The staged seven-file date foundation is reused; no second
calendar implementation and no customer app import.

---

## 13. Test plan

Tests assert the **real contract**, not status codes or the presence of buttons.
No assertion is weakened and no test is skipped to make a build green; where a test
cannot run for lack of infrastructure, that limitation is documented rather than
reported as a pass.

### 13.1 Conformance (the gate that makes a second implementation safe)

- Owner canonicalizer/signer/verifier over the whole `docs/licensing/vectors/**`
  corpus: canonical bytes, signatures, and the **stable refusal reason strings**
  for every `invalid/BAD-*` and `rotation/ROT-*` vector.
- **Independent golden literals pinned in the Owner test tree** covering §2.1's
  documented rules (§1.2). Required — the corpus alone cannot refute the customer
  implementation that generated it.
- Both run in CI. A divergence fails the build rather than surfacing in the field.

### 13.2 Round-trip and runtime compatibility (instruction §12.3)

- Owner request → signer fixture → Owner import → **the customer's real
  `parseLicenseDocument`/verification path** accepts the artifact. This is the
  proof that a customer runtime can read what the Owner produced, and it uses the
  real verifier, not a substitute. It runs as a **customer-side** test (the customer
  suite may read a fixture artifact; nothing is imported from Owner into customer
  runtime code) so the separation boundary holds.
- Digest round-trip: altering any field between request and artifact is detected at
  import.
- Envelope `keyId` resolution and the `sha256-<16 hex>` derived-id rule, including
  a bare-key entry.

### 13.3 Positive (instruction §12.1)

Perpetual for an existing customer · time-limited with a valid end · new customer
created in-flow · limits and modules present in the **signed payload**, not only in
the row · artifact download and structure · signature verification with the real
verifier · agreement of `customerCode`, license id, kind and limits between the row
and the artifact · retry without a duplicate license · re-download · audit
attributed to a valid actor · limit-profile ceiling binding · installation identity
provenance recorded.

### 13.4 Negative and security (instruction §12.2)

Unauthenticated · inactive user · missing permission · `must_change_password` ·
invalid or duplicate `customerCode` · nonexistent customer · invalid dates, end
before start, future start · negative, zero, out-of-range limits · unknown module ·
unknown signing key · key marked `COMPROMISED`/`REVOKED` · invalid signature ·
tampered artifact · digest mismatch · `operationId` mismatch · storage failure
mid-import · crash between staging and commit (orphan swept, row unchanged) ·
concurrent import of one row · double submit · path traversal and cross-issuance
download attempts · **no private key in any response, error, audit event or log** ·
unknown field · malformed JSON · failed operation leaves no false-success row ·
failed issuance leaves no orphan customer · revoked grant mid-flow (§7.4) ·
operator attempt to create a perpetual request · operator attempt to raise a limit
profile · grant of a non-configurable permission to an operator (refused by trigger
**and** service).

### 13.5 Environments

Fast static/unit checks locally; the Owner PostgreSQL integration suite
(`npm run test:integration` against a dedicated `owner_test` database), migration
idempotence for `001`–`007`, customer suites, image builds and vector regeneration
in GitHub Actions, per AGENTS.md and instruction §14. Migration safety is rehearsed
on a disposable PostgreSQL, not asserted from a fixture.

---

## 14. Migration and rollout

`007-owner-license-issuance.sql`, following the existing numbered immutable chain:

- Additive only; runs on a fresh **and** a populated `001`–`006` database; no
  backfill of invented facts; no rewrite of an applied file, so the `001`–`006`
  checksums in `public.owner_migrations` stay valid.
- Creates the four tables of §5, their constraints, indexes and triggers; extends
  the audit target-type vocabulary; commits with the ledger entry in one
  transaction under the existing advisory lock.
- **Runtime grants are deployment-specific and are not applied by the migration**,
  matching migration `002`'s closing note. The README's role-grant section must be
  extended with SELECT/INSERT/UPDATE on the new tables and USAGE/SELECT on their
  sequences, and must continue to withhold DDL and any DELETE on audit or on
  immutable facts.
- Order of delivery, each independently reviewable: **(1)** permission grants and
  effective-permission resolution + audit; **(2)** limit profiles; **(3)**
  installation identities; **(4)** Owner canonicalizer/signer/verifier with the
  conformance suite of §13.1–13.2 — mergeable before any endpoint exists, and the
  highest-risk piece, so it lands first; **(5)** issuance ledger, request creation
  and the signer CLI; **(6)** artifact store, import and download; **(7)** UI.
- Documentation updates land with the code they describe, never ahead of it:
  `owner-licensing/README.md` (API summary, security, role grants, the OD-LIC-10
  supersession note already added, and removal of "no signer … in this phase" only
  when a signer actually exists), PDR-17's matrix, and the OQ-74/75/90/91 rows.

---

## 15. What this design deliberately does **not** decide

Engineering may not settle these, and none may be inferred from silence:

| Item | Why it is not decided here |
|---|---|
| **U-1 / OQ-74** compromise policy, containment, provenance for issued-but-not-imported artifacts, rotation cadence, trust rollout | Still OPEN. OD-LIC-08 answers only *where the key lives*. §8.3's trust list is configuration precisely so no runtime key administration pre-empts U-1 |
| **OQ-78** revocation | OPEN. PO-78-01 is policy only. A wrongly issued perpetual license remains irrevocable in practice — risk **B-5**, unchanged and sharpened by OD-LIC-08 |
| **OQ-81** replay/receipt DTO | OPEN. §7.2 follows the shape PDR-18 §5 approves but does not fix the response schema or status code |
| Whether a pending request **expires** | §1.4 shows a stale time-limited request can become permanently unimportable, but no automatic expiry or timeout is invented. PDR-17 records that a comparable pending-confirmation period for replacements is configurable 1h–7d defaulting to 24h, and explicitly warns that its start/end semantics remain unspecified — so no analogy is applied here |
| Transport handling of the request file | §3.4 proves integrity, not confidentiality. The request carries commercial terms on removable media; the handling rule is an operational/security decision |
| Whether an operator may set `supersedesOperationId` or `renewsOperationId` at all | PDR-12 makes explicit supersession the **only** term-changing path and forbids reducing limits or entitlements on any path. Giving an operator that field is a product decision, not a schema detail |
| Whether `OWNER_ADMIN` is ever configurable | PDR-19 §5.2 records **not** — the Product Owner did not choose the option that would have made it so |
| Exact permission-code names | §6 proposes them following the existing `noun.verb` convention; OQ-75 requires the vocabulary to be explicit and tested before implementation, so the names are a review item |

---

## 16. Verification performed for this design

| Check | Method | Result |
|---|---|---|
| Owner cannot import customer code | `owner-licensing/README.md`, ADR-0048 Phase 1 addendum, PDR-16 D-2(a), `scripts/check-owner-isolation.py` read in full | Confirmed; §1.1 |
| Vectors consumable as data by a second implementation | `licensing-protocol-vectors.md` §5 rule 5 and §5.1 | Confirmed; §1.2 |
| Test-only key fixtures exist and are labelled | `docs/licensing/vectors/keys/*.json` | Confirmed; §1.3. Material not reproduced here |
| `expired-document` rule | `license-import.service.ts:567-582` | Confirmed; §1.4 |
| Refusal-reason vocabulary and HTTP classes | `license-version.ts:925-968` | Confirmed; §7.2 |
| Reusable Owner patterns | `src/archive.ts`, `src/domain.ts`, `src/db.ts`, `src/migrate.ts`, `src/app.ts`, migrations `002`/`004`/`006` | Confirmed; §1.5 |
| Payload field and limit rules | `license-code.ts:81-89`, `:365-447`; `license-document.ts:47-51`, `:77-118`, `:160-236`, `:307-330` | Confirmed; §3.2, §3.5 |
| `docs` link check | `python3 scripts/check-docs-links.py` | PASS, 0 broken |

No test was executed for this design, no code was written, and no capability is
claimed. A green documentation CI run is not evidence of issuance.
