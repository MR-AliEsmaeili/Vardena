# ADR-0048: Owner-side licensing separation boundary

- **Status:** **Accepted for the Phase 1 separation boundary by the Product
  Owner instruction (2026-10-15); see addendum.** Historical Phase 0 proposal: This ADR does **not** decide **OQ-85** (Owner-side system ownership
  and location), **U-1** (signing-key compromise policy), **U-5** (Owner role
  permissions), OQ-77, OQ-78, OQ-82 or OQ-84. The historical proposal authorized
  no implementation; the addenda below accept the separation boundary and a
  later observation-only Owner record. It records the separation boundary that holds whichever
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

## Product-policy reconciliation — 2026-10-15 (no technical boundary change)

[PDR-11 §§4.4, 9–10, 12, 15 and 20](../decisions/product/PDR-11-vardena-licensing-product-requirements.md)
and [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md) now
record explicit product policies for permanent separate audit archive (OQ-77),
restricted customer-administrator recovery (OQ-78), no signed ordinary activation
receipt (OQ-84), and no automatic invalidation of existing licenses solely on
key compromise (U-1/OQ-74). Earlier statements below that these product choices
are undecided are historical. Technical security/incident response, archive and
recovery design remain outstanding; **no production signer or new protocol is
authorized**. Preserve four Owner roles and manual Owner approval for every
new customer-server installation/replacement. Manual observations remain
attributable, not cryptographically verified operations.

The global [date/time policy](../datetime.md) §0 includes Owner Licensing and
licensing/recovery/audit/history views. Applying it must preserve independent
builds and reuse the centralized foundation, not add per-screen conversion or
cross-boundary application imports. No storage or signed-byte contract changes.

## Phase 1 acceptance addendum — 2026-10-15

The Product Owner's Phase 1 instruction accepts the separation boundary for this
slice: standalone Owner web application in `owner-licensing/`, dedicated
PostgreSQL/database credentials and independent numbered SQL migrations, no
customer imports/runtime/database/replication, independent deployables and positive
artifact checks. **Accepted for this boundary only**; the original Proposed
wording below remains historical context and does not defer these new choices.
[PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md) records
approved single-operator RBAC/audit, manual activation/server-replacement policies
and the Product Owner-corrected permission matrix: specialist customer/audit
reads and Support identity/status-only customer reads enforced by field allowlists.
No role grants routine key access, no dual control is added, and U-1 stays deferred.
OQ-77's exact option C wording is unavailable: durable audit viewing without purge.
No OQ is closed and no operational signer or signed lifecycle protocol is authorized.

## Observation-only addendum — 2026-10-15

A later Owner-only slice records manually observed activation and same-customer
server-replacement facts in the Owner database. That is an attributable
observation, not acceptance of a signed protocol, a customer callback, or a
production signer. Confirmation kind remains `OPERATOR_OBSERVED`. OQ-77, OQ-78,
OQ-82, OQ-83, OQ-84, OQ-85 and U-1 stay open.
The implementation uses the established `pg`/Argon2/TypeScript ecosystem with a
small Express modular API instead of copying the customer's Nest auth module
graph; SQL migrations avoid coupling Owner's store to customer Prisma codegen.
Historical packaging defects here were fixed by #157; #158/#159 delivered vectors.


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

- Remediation of the shipped issuer and the missing secret hygiene (**Phase 0.5A**)
  is a prerequisite that depends on neither OQ-85 nor D-2 and should not wait for
  either: it changes no canonicalization wording, no signed format and no vector.
- Publishing vectors requires the canonical escaping behaviour to be ratified as
  normative text first (**Phase 0.5B**, decision **D-2(b)**) and requires choosing
  the conformance mechanism (**D-2(a)**). Both are Product Owner approvals this
  ADR does **not** make and does **not** anticipate; the wording in the vector
  design document is a *proposal*, and until it is ratified the behaviour is an
  undocumented artefact of Node's `JSON.stringify`. Ratifying it as written
  preserves every already-issued artifact; choosing a different rule is a format
  change needing a versioned `VLIC3` and a U-8 decision. Phase 0.5A and Phase 0.5B
  must not be bundled into one change.
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
