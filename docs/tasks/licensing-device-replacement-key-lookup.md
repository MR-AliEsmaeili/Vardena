# Device replacement key lookup — stable refusal instead of a database error

**Type:** defect record · **Date:** 2026-10-16 ·
**Baseline:** `main` `c715a64cdfcbc866fe65613a0375a118e0024a8b`.
**Module:** Licensing (`ClientDevicesRepository.createReplacementChallenge`).
**Related:** [PDR-15](../decisions/product/PDR-15-client-device-licensing-and-replacement.md),
[client-device lifecycle](../licensing/client-device-lifecycle.md) §6 (stable
operation reasons) and §5 (the partial unique indexes), OQ-83 (remains OPEN).

## Defect

The "replacement key is already used by another pending request" guard read the
first replacement request of the installation in state `CHALLENGE`/`PENDING`
**without filtering by the requested key fingerprint**, and only then compared
that arbitrary row's fingerprint with the requested one:

```text
findFirst({ installationId, state IN (CHALLENGE, PENDING) })   // no keyFingerprint
then: existingRequest.keyFingerprint === input.keyFingerprint ? refuse : continue
```

With more than one pending request in flight, the query can return the *other*
request. The guard then passes, and the duplicate is rejected only by the
partial unique index
`uq_device_replacement_requests_active_key_fingerprint`
(`backend/prisma/migrations/20261022000000_licensing_client_device_lifecycle/migration.sql`).
The repository translates no Prisma unique violation on this path, so the caller
receives an unmapped 500 instead of the documented, Persian-localized
`replacement-device-key-used` reason. The invariant itself held (the index did
its job); the **API contract** did not.

Evidence: `backend/src/modules/licensing/data/client-devices.repository.ts`
(the `existingRequest` lookup and the insert immediately after it, which has no
`P2002` mapping); the neighbouring guards in the same method
(`existingDevice`, `pendingEnrollment`) filter by fingerprint correctly, so this
was an isolated slip.

## Fix

The fingerprint is now part of the lookup itself, so the decision no longer
depends on which row a non-deterministic query returned, and the stable reason
is produced before the database is touched. No other behaviour changes: a
request that reuses a key held by a pending request is still refused, and a
request with a genuinely new key still proceeds.

## Regression test

`backend/src/modules/licensing/data/client-devices.repository.spec.ts`
(deterministic, no database): a fake Prisma client returns "some other pending
request" whenever the lookup does **not** ask for the fingerprint, and fails the
insert the way PostgreSQL's partial unique index would. The test then asserts
that the caller sees a `DeviceLifecycleError` with reason
`replacement-device-key-used` — which fails on the pre-fix code, where the
duplicate reaches the insert and surfaces as a raw database error — and that the
recorded lookup actually carried the fingerprint. A second case proves an
unrelated pending request is not treated as a conflict.

The existing live PostgreSQL suite
(`backend/test/client-device-persistence-live.e2e-spec.ts`) already covers the
duplicate-key refusal and the quota engine; it is unchanged. It cannot pin this
defect deterministically, because the pre-fix failure depended on the row order
the unfiltered query happened to return.

## Scope

No schema change, no migration, no API or DTO change, no permission change and
no change to the replacement protocol or its vectors. This record decides no
OQ; the device/Grace interaction raised by the same audit is a separate,
undecided question recorded in
[the open decisions brief](licensing-open-decisions-brief.md) §1.
