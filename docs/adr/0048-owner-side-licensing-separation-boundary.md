# ADR-0048: Owner-side licensing separation boundary

- **Status:** **Proposed — awaiting explicit Product Owner approval.** Not
  Accepted. This ADR does **not** decide **OQ-85** (Owner-side system ownership
  and location), **U-1** (signing-key compromise policy), **U-5** (Owner role
  permissions), OQ-77, OQ-78, OQ-82 or OQ-84, and it authorizes **no**
  implementation. It records the separation boundary that holds whichever
  location the Product Owner chooses, so that AR-29 is satisfied before any
  deployment-topology or security-architecture change is built.
- **Date:** 2026-10-15
- **Authority:** [ADR-0046](./0046-signed-license-documents-and-version-lifecycle.md)
  Decision 9 (issuance boundary) and Decision 7 (rotation as a trust-list
  operation) · [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md)
  §§4, 11–13, 17.2 (G-2, G-3, G-7, G-8, G-10) · [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) ·
  [PDR-15 / OD-LIC-04](../decisions/product/PDR-15-client-device-licensing-and-replacement.md) §3 ·
  ADR-0001 (modular monolith, not microservices) · ADR-0008 (single database,
  schema per module — scoped to the customer product).
- **Design detail:** [`docs/licensing/owner-side-system-architecture.md`](../licensing/owner-side-system-architecture.md) ·
  [`docs/licensing/licensing-protocol-vectors.md`](../licensing/licensing-protocol-vectors.md) ·
  [`docs/tasks/licensing-owner-side-phase-0-readiness.md`](../tasks/licensing-owner-side-phase-0-readiness.md)

## Context

PDR-11 §4 requires an Owner-side licensing system. None exists. ADR-0046
Decision 9 fixes only the negative boundary — signing stays outside the product
and the application never stores, accepts or serves a private key — while OQ-85
leaves the Owner system's location and ownership OPEN. Two facts make the
boundary urgent rather than theoretical: the development issuer already ships
inside the customer production image (`tsconfig.build.json` includes all of
`src`; the Dockerfile `production` stage copies `dist/`), guarded only by a
runtime `NODE_ENV` check; and the canonical byte contract is implicit in Node's
`JSON.stringify`, so a second implementation has nothing to conform to.

## Decision (proposed)

1. **Four mechanisms, not a folder.** Owner/Customer separation is established
   by a one-way dependency graph, a separately built artifact, a separate
   release channel and a separate execution context. A directory name or a
   module rename establishes none of them.
2. **The customer artifact is provably clean.** A CI gate inspects the built
   customer `dist/` and the `production` image and fails on any Owner-only module
   and on the development issuer. A parallel secret-scan gate fails on key
   material anywhere in the repository, artifacts, fixtures or logs.
3. **No network path in either direction.** The Owner system never runs on a
   customer server, never connects to a customer database and never exposes an
   endpoint a customer installation calls. Exchange is signed files over manual
   transport (PDR-11 §11.4), so no customer server requires internet (§11.1).
4. **Two databases, one-way projection.** The Owner store is the system of
   record for customer, contract, grant and issuance history. The customer
   `licensing` schema remains a projection authoritative only for what that
   installation may do now. No shared instance, replication, cross-boundary
   foreign key, or Owner table in `backend/prisma/migrations`.
5. **Request fields are claims, never identity.** Owner issuance and replacement
   decisions resolve `customerId`, `customerCode`, installation, license and
   effective version from the Owner record. An inbound `VDRQ1` is verified and
   checked against that record; it is never the source of truth.
6. **The signed contract is shared; everything else is Owner-private.** The only
   shared items are the artifact formats, canonicalization rules, identifier
   vocabularies, trusted-key grammar and stable refusal reasons. Conformance is
   proven by a published, deterministically regenerated vector set verified by
   both sides in CI.
7. **The customer server stays the final authority.** An Owner approval never
   substitutes for customer-side signature, correlation, expiry, replay and
   quota validation (G-2). No Owner response enlarges a customer entitlement.
8. **The existing Licensing module is preserved.** No rewrite, no microservice
   and no new network service on either side (ADR-0001).

## Consequences

- Remediation of the shipped issuer and the missing secret hygiene becomes a
  prerequisite that does **not** depend on OQ-85 and should not wait for it.
- Publishing vectors requires ratifying the measured escaping behaviour as
  normative text. That preserves every already-issued artifact; choosing a
  different rule would instead be a format change needing a versioned `VLIC3`
  and a U-8 decision.
- Until OQ-78 exists there is **no revocation instrument**, so a wrongly issued
  perpetual license cannot be withdrawn — the strongest argument for dual control
  on high-impact operations, which §4.3 permits but does not mandate.
- U-1 gates production key generation: the compromise policy determines whether
  a key hierarchy and revocation instrument are needed at all.
- Acceptance criteria for the boundary are enumerated in the design document §6
  and are testable, so "separated" becomes a claim CI can refute.
- Rejected alternatives: Owner code inside `backend/` as a separate build target
  (places Owner code in the customer's own source tree and build graph — the
  condition already shown to be unsafe); an "Owner mode" of the customer
  application (violates the approved direction and puts the signer adjacent to
  customer data); a customer→Owner network callback (violates §11.1 and G-7).
