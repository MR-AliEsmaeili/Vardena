# Client-device licensing and replacement protocol (OQ-83)

**Status:** customer-server implementation merged and CI-verified; external client and Owner issuer remain operational dependencies, 2026-10-15 · Product policy: [PDR-15 / OD-LIC-04](../decisions/product/PDR-15-client-device-licensing-and-replacement.md) · canonical product requirements: [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) §§7–8, 12, 15.2.

This is a vertical slice inside the existing Licensing module. It adds no Owner-side
issuer, no application synchronization, no server-installation replacement and no
general activation receipt. It reuses the persistent installation identity, validated
`customerId`/owner-assigned `customerCode`, trusted Ed25519 license-authority keys,
permission registry, append-only licensing audit events and effective signed license
version. The design does not promote or replace ADR-0046.

## 1. Authority and compatibility

The effective signed `LicenseVersion` is the only source of device capacity. The
installation server counts its own retained device records in the same transaction
that registers, deactivates or replaces a device. The browser cannot choose a limit,
installation, customer, license version, registration status or replacement result.

A finite device limit is a non-negative integer; signed `null` means unlimited, using
the established `LicenseLimit` convention. A VLIC1 or previously issued VLIC2 artifact
that does not contain the new signed `deviceLimit` is **UNSPECIFIED**, not zero and not
unlimited. It remains verifiable/importable using its original canonical bytes; device
registration is blocked until a signed version explicitly supplies the entitlement.
The API exposes `deviceLimitSpecified` separately from `deviceLimit` so the two states
cannot be conflated. Existing license rows are backfilled as unspecified. No customer
entitlement is inferred from a missing field.

The canonicalizer includes `deviceLimit` only when it was present in the signed
payload. The development issuer accepts an explicit finite `--devices N` or
`--devices unlimited`; omitting the option preserves UNSPECIFIED and grants no device
capacity. Verification of an older VLIC2 document uses the legacy canonical shape
(without the field); all signature, key-hint, customer, installation, validity,
operation and entitlement checks remain unchanged.

## 2. Device identity and local key custody

- The external client-device application is responsible for generating the Ed25519
  key pair and protecting the private key in platform-appropriate secure storage. It
  sends only the public SPKI key and detached proof to the Vardena server.
- The Persian RTL administrator UI is an orchestration surface: it accepts the public
  key, displays/copies/downloads the canonical challenge and accepts the device's
  signature. It does not generate, receive, persist or manage device private keys.
- The server verifies a detached signature made by the public key over a
  server-issued, canonical enrollment challenge. It stores the public key and
  SHA-256 fingerprint, not a hardware address, hostname or private key.
- A device ID and operation ID are server-generated. The challenge binds both to the
  existing installation, current signed `licenseId`/effective version, persisted
  customer ID, owner-assigned customer code, target public-key fingerprint, nonce,
  purpose and expiry.
- The challenge is short-lived. Expired, consumed, superseded-version or
  cross-installation challenges cannot activate anything. Challenge creation does
  not consume quota; finalization rechecks quota under the installation lock.

## 3. Lifecycle and state transitions

```text
EnrollmentChallenge: PENDING ──valid device proof + active signed entitlement + room──► CONSUMED
                    └─────────expiry─────────────────────────────────────────────────► EXPIRED

ClientDevice:        ACTIVE ──explicit administrator deactivation────────────────────► DEACTIVATED
                    ACTIVE ──valid replacement completion (one transaction)─────────► REPLACED

ReplacementRequest: CHALLENGE ──valid new-device proof──────────────────────────────► PENDING
                    CHALLENGE ──expiry──────────────────────────────────────────────► EXPIRED
                    PENDING ──valid, correlated authority-signed response───────────► COMPLETED
                    PENDING ──explicit cancellation────────────────────────────────► CANCELLED
                    PENDING ──expiry────────────────────────────────────────────────► EXPIRED
```

Every device, challenge, replacement request and audit event is retained. Deactivation
is not replacement: it does not create a new device, retire a replacement request, or
silently change another device. A pending replacement must be explicitly cancelled
before its old device can be deactivated. At most one unexpired pending replacement
exists for an old device in one installation. A request for another old device is a
different scope.

Only `ACTIVE` devices consume quota. A pending replacement leaves the old device
active and consumes exactly one slot. Completion updates the old device to `REPLACED`,
creates the new `ACTIVE` device, completes the request and writes both sides of the
audit history in one database transaction under the installation row lock and the
shared device-allocation advisory lock. Its before/after active count must be equal.
A failed response never deactivates the old device or creates a partial new record.

Ordinary registration requires a specified signed entitlement and available quota.
For finite limit `L`, registration is allowed only while `activeDeviceCount < L`;
`null` with `deviceLimitSpecified=true` is unlimited. If the current license has no
signed device limit, registration fails with stable `device-entitlement-unspecified`.
A finite zero limit allows no new registrations. Deactivation remains available to
resolve overage even when the current license is expired or over quota.

If an imported signed version reduces device capacity below current active use, the
existing §8.6 path reports structured `device-capacity` details and writes no version.
It does not auto-deactivate. Under PDR-15 §2.15, the administrator may either
explicitly deactivate selected devices and retry the same signed artifact, or resolve
the conflict through the existing authorized, audited reduction-resolution flow. The
generic flow applies the signed version but never changes device rows; ordinary
enrollment remains blocked while active usage is at or above the finite limit. No retry
consumes the operation ID before the import succeeds.

## 4. Signed offline replacement exchange

### 4.1 Request

The customer server creates a replacement challenge for an existing active device and
new device public key. The new device signs the exact canonical payload, which includes:

```text
format = "VDRQ1"
requestId, challengeId, operationId
installationId, customerId, customerCode
licenseId, licenseVersionId
oldDeviceId, newDeviceId
publicKey, publicKeyFingerprint
nonce, issuedAt, expiresAt
```

The server verifies the device proof and retains the request, signature and hash. It
exports a primary JSON file envelope and a text fallback containing the **same**
`VDRQ1` signed artifact. The file/text value carries no private key. The Owner-side
issuer is not built here.

The challenge/request binds to the effective signed LicenseVersion at creation. When a
later lifecycle read or operation observes that the effective version or installation
binding has changed, it marks the still-pending enrollment/replacement operation
`EXPIRED` and records a typed audit event. In particular, the export endpoint will not
return a request bound to the old version; the administrator must start a new request.
Expiry never deactivates the old device, and the request/history remains retained.

### 4.2 Response and completion

The authority returns a detached Ed25519-signed `VDRP1` response. Its signed payload
binds the exact request ID, challenge/operation IDs and request SHA-256, plus installation,
customer ID/code, license/effective version, old/new device IDs, public-key fingerprint,
decision, issue time and expiry. The customer server accepts a response only when:

- the signature verifies with an already trusted license-authority public key (no
  unsigned or alternate-key fallback);
- the response is an approval, well-formed, not expired, and its issue/expiry window
  is within the retained signed request and governing license validity;
- all correlation and binding fields match the one pending request byte-for-byte;
- the request has not been cancelled, expired or completed and the response operation
  has never been applied;
- the installation is still bound to the same validated customer ID and code and the
  bound signed license version still governs.

The signed response is imported from the actual file or pasted text through the same
verification path. A response retry after successful completion is rejected as a
replay. A cancelled request remains unusable even if a matching valid response is later
presented. A new request requires a new nonce, request ID and operation ID.

This protocol-specific evidence does not answer OQ-84 and does not introduce signed
receipts for ordinary license/device activation.

## 5. Persistence, concurrency and audit

The additive Licensing migration adds the optional signed limit and its
`deviceLimitSpecified` marker to retained versions; append-only client-device,
enrollment-challenge and replacement-request rows; typed device/replacement audit
context; uniqueness constraints for installation-scoped operation IDs, key fingerprints
and response IDs; checks for state/timestamp consistency; and a partial unique index for
one valid pending replacement per old device. Historical device rows are never hard
deleted. The migration backfills every pre-field license version as UNSPECIFIED and
does not rewrite its signed hash or document bytes.

Device allocation uses the same installation row lock and device advisory-lock key as
the L-04 usage check. License import takes that same device lock before counting usage,
so a concurrent registration cannot commit against an outdated quota. Replacement holds
one installation transaction across old-device retirement, new-device activation,
request completion, and audit writes. The quota snapshot uses the Licensing module's
own records; no other module reads or owns the device table.

Typed events include direct activation, deactivation, replacement requested,
replacement cancelled, replacement completed, and rejected/expired operations. They
record actor, source, installation, operation/request/device IDs, time, outcome, stable
reason and artifact hash where applicable. They never store/log raw payloads or private
keys. Public keys are persisted only on the device/request records and are not returned
in the ordinary inventory or written into audit detail; the fingerprint is safe for
support correlation.

## 6. Authorization and API surface

Explicit permissions, checked at the route and application-service boundary:

| Permission                             | Surface                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `Licensing.Device.View`                | Inventory and device/replacement history                  |
| `Licensing.Device.Activate`            | Create/complete ordinary enrollment challenge             |
| `Licensing.Device.Deactivate`          | Explicit deactivation                                     |
| `Licensing.Device.Replace`             | Create signed replacement request and retrieve its export |
| `Licensing.Device.CancelReplacement`   | Cancel a pending replacement                              |
| `Licensing.Device.CompleteReplacement` | Import and apply a signed replacement response            |

The API is versioned under `/api/v1/license/devices`. DTOs use strict validation,
stable operation reasons, and generated OpenAPI client types. The client does not claim
success until the authoritative inventory query is re-read. The Persian RTL UI is a
real permission-gated surface over those APIs, not a mock or local quota authority.

## 7. Verification matrix

Domain tests cover canonical bytes, Ed25519 public-key validation and proof, strict
response signatures, file/text equivalence, response tampering, expiry, request-hash
mismatch and cross-binding. Focused application tests assert the exact permission is
rechecked before installation state is touched for each operation; controller tests
assert exact route permissions and both auth guards. The OpenAPI contract test covers
all ten routes, success-response schemas, quota DTO fields, history, challenge and
replacement-export contracts; the generated TypeScript API client carries the same
routes and schemas. Frontend state tests cover server-authoritative quota and inventory,
challenge/proof flows, offline exchange and import, explicit deactivation/cancellation,
success feedback and permission-based hiding of writes.

The dedicated live PostgreSQL test covers signed-quota concurrency, retained inventory
and audit, cancellation/replay refusal, atomic one-for-one replacement, explicit
deactivation, and cross-table key-use exclusion. The populated licensing migration
rehearsal now carries representative retained VLIC1/VLIC2 history through the exact
pre-OQ-83 schema and the unmodified `20261022000000` SQL, proving preservation of old
fields and hashes, UNSPECIFIED backfill semantics, and the resulting constraints and
indexes. Both are registered in GitHub Actions and are **not run locally**. See the
bounded evidence and operational plan in
[`docs/tasks/licensing-oq-83-operational-plan.md`](../tasks/licensing-oq-83-operational-plan.md).
These tests do not replace Product Owner review or exact-head CI verification. Full
database, migration-rehearsal, Docker, PostgreSQL and E2E suites are CI-only under
`docs/testing/test-execution-policy.md`.
