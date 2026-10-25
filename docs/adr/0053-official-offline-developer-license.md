# ADR-0053: Official offline Developer License

- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision owners:** Vardena maintainers
- **Related:** ADR-0030, ADR-0045, ADR-0046, ADR-0048, ADR-0050

## Context

Vardena had two things that looked superficially useful for development but neither was an official Developer License:

1. `LICENSE_PROVIDER=local-development` creates synthetic configuration state. It is intentionally not signed, persisted, transferable, or acceptable as an official license.
2. `backend/src/issue-development-license.ts` issued commercial VLIC1/VLIC2 payloads, required a commercial customer, accepted a private key through an environment variable, and printed generated private material. It also relied on `NODE_ENV` as a production guard.

Using either mechanism as a Developer License would blur commercial identity, require a fabricated customer, or make environment naming an authorization decision. A real offline capability must preserve the existing Ed25519/import/enforcement architecture while being unambiguously non-commercial.

## Decision

### 1. A separate signed artifact

Adopt **VDEV1**, envelope format `vardena-developer-license`, version 1. Its signed payload has fixed `kind=DEVELOPER_LICENSE_VERSION` and `licenseType=DEVELOPER`, an explicit non-commercial `developerId`/`developerName`, exactly one backend-owned `installationId`, finite `validFrom`/`validUntil`, positive organization/user limits, module/feature entitlements, status, `operationId`, `licenseId`, optional explicit `supersedesOperationId`, `issuerKeyId`, and `issuedAt`.

VDEV1 and VLIC2 use the same audited Ed25519 armor primitive but different prefixes and canonical payloads. A signature valid for one protocol cannot be interpreted as the other. VLIC2 signed bytes are unchanged.

VDEV1 requires `deviceLimit=0`. The current VDEA1 device protocol is commercially customer-bound; inventing a customer for Developer Licenses is forbidden. A positive developer-device quota requires a future, separately domain-separated protocol decision.

### 2. Explicit deployment policy and separate trust

The customer backend accepts VDEV1 only when both are configured:

- `DEVELOPER_LICENSES_ENABLED=true`;
- `DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS=<keyId:Ed25519-public-key>`.

The default is disabled in **every** `NODE_ENV`. Commercial and developer trust key IDs and Ed25519 public-key material must be disjoint at startup. `LICENSE_SIGNING_PUBLIC_KEYS` never implicitly trusts VDEV1.

This is installation policy, not authentication. The existing `Licensing.License.Activate` permission remains required for the official import route.

### 3. Same import, persistence, and enforcement authority

VDEV1 enters through the existing authenticated activation/import endpoint. The pipeline verifies format, key identity, signature, payload, installation, issue/validity dates, status, replay and retained-version conflicts before calling the existing locked transactional repository.

The persistence model stores `license_type` and a mutually exclusive holder:

- `COMMERCIAL`: required `customer_id`, no developer holder;
- `DEVELOPER`: no `customer_id`, required `developer_id` and `developer_name`.

A database check constraint enforces this. No `licensing.customers` row is created for a developer. Commercial and developer history cannot be mixed on one installation. Existing operation/document hash replay constraints, supersession rules, capacity reduction checks, audit events, backend entitlement evaluation, RBAC, organization/data boundaries, and Grace/Read-Only behavior remain authoritative.

### 4. Offline issuer and key custody

The repository tool is rebuilt as the official Developer License issuer and remains in `dist-tools`, excluded from customer production `dist` and Docker images. It:

- reads a private key only from a named protected file;
- validates POSIX mode or Windows NTFS DACL fail-closed;
- generates keys only inside an existing protected directory;
- uses exclusive `wx` file creation and never overwrites;
- never accepts the private key through environment variables;
- never prints private material or the signed license artifact;
- validates every input, signs, verifies the result with the derived public key, then writes;
- keeps private keys out of Git, databases, frontend, logs, APIs, and runtime configuration.

The Windows Licensing Workbench exposes this tool as a separate Developer License operation. It does not route developer issuance through Owner Licensing and does not create a commercial customer.

## Compatibility

- Existing VLIC1 and VLIC2 documents and their canonical bytes remain supported.
- Existing database rows migrate to `COMMERCIAL` through a non-destructive default.
- Commercial issuance, renewal, replacement, transfer, revocation, and recovery semantics are unchanged.
- `local-development` remains a visibly separate `LOCAL_DEVELOPMENT` evaluated type; it is not upgraded or renamed.

## Consequences

### Positive

- Official developer capability is offline and installation-bound.
- Customer and developer trust are auditable, explicit, and fail closed.
- No synthetic commercial customer or hidden bypass exists.
- Existing backend limits and entitlement enforcement apply.
- Issuance does not require the Owner service or a network connection.

### Costs and limits

- Operators must distribute a dedicated public key to each approved installation before import.
- Each VDEV1 artifact binds one installation. A second installation requires independent issuance.
- Replacements keep the existing `developerId`; VDEV1 does not invent an unaudited holder-transfer operation.
- VDEV1 is finite and bounded; perpetual/unlimited Developer Licenses are not supported.
- VDEV1 cannot enroll client devices until a future developer-specific device protocol is approved.
- The existing VREV1 revocation artifact remains commercial-customer-bound; VDEV1 has no separate signed revocation artifact in version 1.
- Key compromise/rotation remains an operational public-trust rollout task; this change does not create a central activation or revocation network.

## Rejected alternatives

- Reusing VLIC2 optional fields: changes/ambiguously repurposes a ratified commercial contract.
- Fabricating a commercial customer: corrupts holder semantics and reporting.
- Trusting `NODE_ENV=development` or `local-development`: environment labels are not signed authorization.
- Embedding a private key or issuer endpoint in the backend/frontend: creates a customer-accessible signing oracle.
- Removing installation checks for convenience: enables uncontrolled multi-installation replay.
