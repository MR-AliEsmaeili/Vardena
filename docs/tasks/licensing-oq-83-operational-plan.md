# OQ-83 historical customer-side implementation and populated-migration plan

> **Current MVP policy correction (2026-10-16):** PDR-15 §6 supersedes the prior
> automated customer self-service/signed-response replacement workflow: device
> replacement is manually managed by Owner Admin; keep the old device active
> until new-device activation, then atomically swap one-for-one without extra
> quota. This plan's VDRP1 issuer/companion requirements are not authorization
> for that old workflow to ship as MVP. Reconcile the existing code and evidence;
> do not invent a new signed artifact or claim policy compliance here.

> **Phase 1 Owner update (2026-10-15):**
> [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md) now
> selects the independent Owner web/PostgreSQL boundary. This does not implement
> the VDRP1 issuer, device companion/custody or close OQ-83. Manual server
> replacement is distinct from the client-device workflow below. Production
> signing is still disabled pending U-1; no additional signed format is created.


**Historical status (2026-10-15):** READY FOR REVIEW for the prior customer-side
signed-response implementation plan only — not Product Owner acceptance, not
operational completion, and not closure of OQ-83 or approval of the current
manual Owner Admin workflow.
**Baseline:** `main` at `a58fd19df0bcff76e594749d825ac8b37f95ba4f`
(verified against `origin/main` on 2026-10-15).  
**Authority:** [PDR-15 / OD-LIC-04](../decisions/product/PDR-15-client-device-licensing-and-replacement.md),
[PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md),
[PDR-14](../decisions/product/PDR-14-licensing-customer-code.md), and
[the existing implementation protocol](../licensing/client-device-lifecycle.md).
OQ-77/78/82/83/85 retain implementation/evidence follow-ups; OQ-84 is product-
closed (no separate signed ordinary activation receipt). See the current registry.

## 1. Bounded migration-verification change

The existing licensing rehearsal already built a populated L-02 database and
carried it through the retained-version, supersession, audit, and customer-code
migrations. It stopped at `20261020000000`; it therefore did not prove the
populated transition from the schema immediately before OQ-83 to
`20261022000000_licensing_client_device_lifecycle`.

The same rehearsal architecture now continues through the actual
`20261021000000` SQL, establishing the exact preceding Licensing schema. It
then adds a deterministic, representative pre-device-entitlement VLIC2 row,
customer/installation/license identity, entitlement, and audit history. The
signed artifact remains external by design—the application never persists raw
license bytes—so the fixture retains its exact deterministic artifact bytes in
the rehearsal and persists their real SHA-256 in `document_hash`, matching the
production storage contract.

Before applying the unmodified `20261022000000` SQL, the rehearsal takes a
JSONB snapshot of every existing row in these tables:

- `licensing.customers`;
- `licensing.installations`;
- `licensing.licenses`;
- `licensing.license_versions`;
- `licensing.license_version_entitlements`;
- `licensing.license_audit_events`.

After migration it verifies:

1. every pre-existing column value is identical, including customer ID/code,
   version lifecycle history, entitlement IDs, audit context, document version,
   authority key ID, and document hash;
2. the external fixture artifact still hashes to the retained document hash;
3. every pre-existing version has `device_limit IS NULL` and
   `device_limit_specified = false`—UNSPECIFIED, never inferred unlimited;
4. the new columns' PostgreSQL types, nullability, and default are exact;
5. all three lifecycle tables start empty and the three enum vocabularies are
   exact;
6. the lifecycle state checks, composite same-installation foreign keys, and
   relation-order unique indexes exist;
7. the partial pending-operation indexes exist with the intended states; and
8. PostgreSQL rejects a finite value without explicit presence and a negative
   explicit limit, while permitting signed unlimited and finite zero.

The historical migration and schema are not modified. The rehearsal uses a
uniquely named disposable local PostgreSQL database, refuses non-local admin
hosts and pre-existing database names, and is wired once into the backend CI
job as `Migration rehearsal (Licensing populated chain through OQ-83)`. It is
CI-only under the repository test-execution policy.

## 2. Existing operational capabilities

### 2.1 Customer-installation server

The merged vertical slice already provides:

- strict Ed25519 SPKI public-key parsing, a SHA-256 fingerprint, and detached
  proof verification (`backend/src/modules/licensing/domain/client-device.ts`);
- canonical, one-use enrollment and VDRQ1 replacement challenges bound to the
  installation, customer ID/code, license/effective version, device IDs, key,
  nonce, and expiry;
- trusted-key verification and strict correlation for VDRP1 responses;
- installation/device allocation locks, one-for-one atomic replacement,
  terminal cancellation/expiry/replay behavior, and retained audit/history
  (`backend/src/modules/licensing/data/client-devices.repository.ts`);
- permission-specific REST endpoints and a Persian RTL administration surface
  that transports only public keys, challenges, detached signatures, and
  signed files.

The UI deliberately does not generate or retain a device identity. It has no
private-key field and cannot turn pasted public material into proof of
possession. A normal browser profile also does not, by itself, establish the
approved platform custody, backup/non-exportability, device binding, and
reinstallation behavior for a persistent licensed-device identity.

### 2.2 Development issuer

`backend/src/issue-development-license.ts` and
`backend/src/tools/development-license-authority.ts` issue development/test
VLIC1/VLIC2 server-license artifacts. They do **not** parse VDRQ1, evaluate an
Owner replacement policy, retain an issuance record, or emit VDRP1. The test
suite creates VDRP1 fixtures solely to verify the customer server. It is not an
operational issuer.

## 3. Proposed device-client boundary (requires approval before implementation)

### Recommended deployment model

Use a small installed companion application or platform agent on each client
device, not the ERP browser page as private-key owner. It communicates only
with the local customer Vardena API and the administrator-mediated file flow;
it is not a new network service or microservice.

A pure protocol library may be shared with that client for fixed canonical
formats and error vocabulary, but the private-key adapter must remain in the
client boundary. Whether this client and shared library live in this repository,
a separate repository, or an existing deployable not yet present is a Product
Owner/deployment decision.

### Key custody

- Generate Ed25519 locally with a cryptographically secure platform API.
- Prefer a non-exportable key protected by the OS keystore/TPM/Secure Enclave
  where the selected platform supports it.
- Return only canonical DER SPKI Base64URL and detached signatures.
- Never send private-key bytes to the ERP API, administrator UI, Owner tooling,
  logs, telemetry, crash reports, or backup unless a separately approved secure
  recovery policy explicitly requires it.
- Treat key loss/reinstallation as device replacement; do not silently clone an
  identity or reuse a retained device key.

### Enrollment and replacement workflow

1. Client creates or opens its protected key and exports public SPKI.
2. Administrator submits that public key through the existing UI/API.
3. Server returns the canonical short-lived challenge.
4. Client shows installation/customer/purpose context, signs the exact UTF-8
   bytes, and returns only the detached signature.
5. Server performs its existing one-use, binding, license, and quota checks.
6. For replacement, the new client signs the VDRQ1 challenge. The administrator
   exports the resulting signed request and later imports the Owner response.
7. Expired/cancelled/stale/replayed results are terminal for that operation. The
   client discards operation state and starts a fresh server challenge; it does
   not retry a stale signature under new identifiers.
8. A failed response never tells the client to invalidate the old device. Only
   the server's successful atomic completion is authoritative.

## 4. Proposed Owner-side VDRP1 issuer boundary (requires OQ-85 decision)

### Recommended deployment model

Place issuance in an Owner-controlled security boundary outside every customer
installation. It may be an isolated operator CLI for the first controlled
phase or an Owner application later, but it must not be added to the customer
Vardena runtime. Choosing its repository, application ownership, and long-term
system of record is part of OQ-85 and is not decided here.

### Validation and signing flow

1. Parse the file envelope or text VDRQ1 with strict size, version, exact-key,
   Base64URL, canonical-JSON, and Ed25519 checks.
2. Verify the new device's detached signature over the exact request bytes.
3. Resolve the authoritative Owner record for customer ID/code, installation,
   license, effective version, and old/new device/request identities. Never
   trust request fields as the Owner system of record.
4. Apply an approved operator/issuance policy and ensure the request is not
   cancelled, expired, already decided, or superseded by a newer request.
5. Generate a unique response operation ID and bounded issue/expiry instants,
   canonicalize the exact implemented VDRP1 payload, and sign it with an active
   authority key whose public half is already trusted by the customer server.
6. Retain an auditable issuance record containing request hash, response hash,
   key ID, operator, decision, reason, timestamps, and policy result—never the
   authority private key.
7. Export the signed response through the existing offline file/text transport.
   The customer server remains the final authority for correlation, replay, and
   atomic device exchange.

### Authority-key handling

- Keep production signing keys outside ordinary application/database access;
  use an approved HSM/KMS or controlled offline signer.
- Identify every response by `keyId`; distribute/rotate trusted public keys
  before using a new signer.
- Never use the repository's development private-key environment variable as a
  production custody model.
- Emergency compromise, revocation, and grandfathering remain governed by the
  existing open signing-key policy; this plan does not decide them.

Customer-side cancellation is already safe even if the Owner produces a late
response: import rejects the terminal request and leaves the old device active.
Whether and how cancellation is synchronized into the Owner system is an
operational policy decision, not a reason to weaken server correlation.

## 5. Security risks and required tests

| Risk                                                   | Required evidence before operational use                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Exportable, cloned, or browser-profile-lost device key | Platform key-storage threat model; non-exportability/custody tests; reinstall and key-loss replacement test                  |
| Canonical-byte mismatch across implementations         | Shared protocol vectors for UTF-8 bytes, SPKI, Base64URL, request hash, VDRQ1, and VDRP1 across server/client/issuer         |
| Malicious or malformed offline files                   | Fuzz/negative tests for size, exact keys, encoding, signature, unknown key, expiry, and all correlation fields               |
| Duplicate issuance or replay                           | Durable unique response operation/request decision; repeated export/import and concurrent operator tests                     |
| Stale Owner data                                       | Refuse mismatched customer code, installation, license/effective version, old/new device, and superseded request             |
| Signing-key compromise or misuse                       | HSM/KMS access controls, dual control if approved, key rotation drill, public-key rollout test, incident runbook             |
| Partial replacement or lockout                         | End-to-end failure injection proving old device remains active until customer-server commit                                  |
| Missing operational evidence                           | Staging pilot with real client custody, trusted keys, offline transfer, cancellation, expiry, replay, rotation, and recovery |

## 6. Product Owner decisions required

No implementation of the two operational components should start until the
applicable choices are recorded:

1. **Device deployment:** supported platforms and whether the device client is
   an installed companion, another existing application, or a separately
   distributed agent; repository ownership and update channel.
2. **Device key lifecycle:** required keystore strength/non-exportability,
   whether any encrypted backup/recovery is permitted, and the approved behavior
   when a device key is lost. Replacement is the current safe default; this
   proposal does not invent a recovery grant.
3. **Owner system boundary (OQ-85):** isolated CLI versus Owner application,
   repository/location, system of record, operator roles, and approval policy.
4. **Production authority custody:** approved HSM/KMS/offline model, operator
   controls, rotation cadence, and emergency compromise policy. Existing open
   signing-key questions remain open.
5. **Owner issuance lifecycle:** whether a request needs single or dual approval,
   denial/cancellation synchronization, response validity bounds, and recovery
   procedure after an interrupted issuance.
6. **Audit retention:** policy is decided: append-only; retain each event at least
   three years from its occurrence; unresolved security incidents are excluded from
   automatic deletion; the previously approved permanent separate archive remains.
   Three years is not a purge deadline. Archive/access/retention implementation is
   still OQ-77 and is not decided by OQ-83.

## 7. Phased implementation plan and acceptance criteria

### Phase 0 — decisions and protocol vectors

- Record decisions 1–5 above without closing unrelated OQs.
- Publish language-neutral enrollment/VDRQ1/VDRP1 vectors generated from the
  current canonical server implementation.
- **Accept when:** platforms, custody, issuer boundary, authority controls, and
  approval policy are explicit; every implementation verifies the same vectors.

### Phase 1 — device-client proof of concept

- Implement the approved platform keystore adapter and enrollment/replacement
  signer behind a narrow client interface.
- No production distribution or key recovery is implied.
- **Accept when:** private key is non-exported under the approved model; network
  and logs contain only public key/signature; expiry, cancellation, stale
  challenge, reinstall, and key-loss tests pass.

### Phase 2 — controlled Owner issuer

- Implement strict VDRQ1 verification, authoritative lookup/policy checks,
  durable issuance audit, protected signing, and exact VDRP1 output in the
  approved Owner boundary.
- **Accept when:** golden/negative vectors, role checks, duplicate/replay tests,
  key rotation, interrupted-operation recovery, and audit completeness pass.

### Phase 3 — staging end-to-end pilot

- Use a real client keystore and non-production authority keys to exercise
  enrollment, full quota, deactivation, request transfer, approval, import,
  cancellation, expiry, tampering, replay, concurrent license cutover, and
  failed completion.
- **Accept when:** server inventory/audit is authoritative, quota never grows
  during replacement, and the old device stays active on every failed path.

### Phase 4 — operational readiness review

- Approve deployment, monitoring, support, backup/recovery, key rotation and
  incident runbooks; retain CI and staging evidence for exact releases.
- **Accept when:** Product Owner and independent security/repository review
  accept the evidence. Only then may OQ-83 closure be considered separately.
