# Owner-side licensing system — architecture and release boundary (Phase 0 design)

> **Later PO policy update (2026-10-16):** see PDR-11 §21 and PDR-17's dated
> OQ-82/OQ-85 update. Owner roles are Owner Admin and License Operator; the
> former four-role text below is historical. Server replacement remains manual,
> pending auditable old-server decommission confirmation with 1h–7d configurable
> expiry (24h default), not remote shutdown. Owner controls infrastructure/trust;
> customers need no continuous Owner connection and MVP has no federated issuer.
> Existing observation/API descriptions below are implementation/design evidence,
> not proof the new sequence or expiry is implemented.

## Current product-policy reconciliation — 2026-10-15

[PDR-11 §§4.4, 9–10, 12, 15 and 20](../decisions/product/PDR-11-vardena-licensing-product-requirements.md)
and [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md)
supersede the product-policy deferrals below: permanent separate audit archive
with authorized/minimized sensitive access (OQ-77); emergency restriction versus
expiry and independent restricted customer-administrator recovery (OQ-78);
non-automatic-invalidation of existing licenses solely on key compromise (U-1);
no signed receipt for ordinary activation (OQ-84). Broader technical design and
implementation remain follow-ups, not newly approved production custody/issuance.
Manual Owner approval for each new customer-server installation/replacement,
operator-observed evidence labels, four roles and separation boundaries remain.
Owner dates must follow [the global Jalali-first date/time contract](../datetime.md)
§0; raw-ISO views are an evidenced implementation gap (PDR-11 §20.5).

## Current Phase 1 addendum — 2026-10-15 (supersedes historical proposals below)

Authority: [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md),
[implementation record](../tasks/licensing-owner-side-phase-1.md),
[setup and deployment](../../owner-licensing/README.md).
The Product Owner now selects a standalone Persian RTL web application at
`owner-licensing/`, dedicated PostgreSQL and independent SQL migrations,
credentials/build/deployment boundaries, durable actor-attributable audit and
single-operator role authorization without mandatory dual control. The Owner
store is the system of record, with no customer database connection or sync.
The original CLI-first/private-repository recommendations below are superseded
for this slice; they are retained as the **historical Phase 0 snapshot**, not
current deployment choices. GAP-1/GAP-2 were remediated in #157 and vectors in
#158/#159 before this task; no duplicate remediation is introduced.

Runtime: one small modular Node/Express/pg API and independent React/Vite UI.
Own numbered SQL/checksum-ledger migrations, not the customer Prisma chain.
Password hashes/first-login restriction and session revocation commit atomically
with durable audit. Permissions are checked using the authenticated current
user/session, never a client actor or hidden button. The Product Owner correction to PR #160 confirms Issuance Specialist customer/
audit reads and Support customer identity/status reads with a server-side field
allowlist; see the current PDR-17 matrix. Observer remains read-only and Admin
retains administrative operations. No audit purge exists; the explicit permanent-archive policy now supersedes
the former retention deferral without reconstructing historical option C. Cryptographic lifecycle operations remain unavailable.

Manual activation is an explicit authorized operator confirmation of issued →
activated, retaining actor, server time, reason and available evidence reference,
not a cryptographic customer receipt. Manual server replacement: specialist
manually deactivates/revokes the old lock; Administrator or Issuance Specialist
authorizes replacement for the same customer; specialist installs; authorized
Owner user records observed prior/new status with actor/time/reason. Emergency
old-server loss is allowed with an attributable authorized decision. No callback,
synchronization or old-server response is required. Additive migration
`002-manual-operations.sql` now persists these observations and exposes an
Owner-only API/UI. Direct SQL must store the same continuous history the
application writes, including both emergency steps before commit. Responses are
labeled operator-observed and not cryptographically verified. No signed protocol, customer callback or customer
schema change is involved. Server replacement is separate from OQ-83
client-device replacement. An abandoned non-terminal replacement cannot be
withdrawn: PDR-17 defines no cancellation transition and OQ-82 remains OPEN.
U-1 technical incident-response/custody design remains deferred under the
approved product policy; no production signer/key. No signed contract changes.
OQ-77/78/82/83/85 remain open for their outstanding scope; OQ-84 is now
product-decided by the separate documentation reconciliation, not this implementation.

## Historical Phase 0 design (snapshot, not current implementation status)


**Status:** DESIGN PROPOSAL — Phase 0 only. Not implemented, not Product Owner
accepted, and not a decision record. Every product choice below that is marked
**OPEN** still requires explicit Product Owner approval; nothing here closes
OQ-77, OQ-78, OQ-82, OQ-83, OQ-84 or OQ-85.
**Baseline:** `main` @ `961a696fbff16893dc69f93d6409af5430790a6c` (verified
against `origin/main` on 2026-10-15; no open PR at task start, `main` CI green).
**Product sources:** [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md)
§§4, 11–13, 15, 16, 17.2 · [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) ·
[PDR-15 / OD-LIC-04](../decisions/product/PDR-15-client-device-licensing-and-replacement.md) ·
[ADR-0046](../adr/0046-signed-license-documents-and-version-lifecycle.md) Decision 9.
**Companion documents:** [protocol vector contract](./licensing-protocol-vectors.md) ·
[Phase 0 readiness report and decision table](../tasks/licensing-owner-side-phase-0-readiness.md) ·
[OQ-83 operational plan](../tasks/licensing-oq-83-operational-plan.md) §4.

## 1. Scope of this document

PDR-11 §4 requires an Owner-side system that manages customers and contracts,
issuance, license versions and signed updates, entitlements and capacity,
renewal, revocation and reactivation, server-installation replacement, status
tracking and audit history. **None of it exists.** ADR-0046 Decision 9 fixes only
the negative boundary — signing stays outside the product and the application
never stores, accepts or serves a private key. OQ-85 leaves the *location and
ownership* of that Owner system OPEN.

This document therefore designs the **separation boundary** that holds whichever
location the Product Owner chooses, and it records the gaps that must be closed
before any Owner implementation starts. It deliberately does not choose the
repository, the UI runtime, the database product or the operator role matrix;
those are tabulated as OPEN in the
[decision table](../tasks/licensing-owner-side-phase-0-readiness.md).

The existing customer-side Licensing module is **preserved**. Nothing here
proposes rewriting it, and no microservice or new network service is introduced
on either side (ADR-0001, PDR-11 §17.2 G-2).

## 2. Verified current state

Findings below were read from the repository at the baseline SHA, not from prior
reports or PR descriptions.

### 2.1 Implemented in Customer Vardena

| Capability | Evidence |
| --- | --- |
| `VLIC2` signed document parse + Ed25519 verify, file envelope and text transport through one pipeline | `backend/src/modules/licensing/domain/license-document.ts` |
| Legacy `VLIC1` code parse + verify (compatibility path) | `backend/src/modules/licensing/domain/license-code.ts` |
| Trusted authority key list with `keyId:<material>` grammar and derived bare-key ids | `parseTrustedLicenseKeys`, `splitTrustedKeyEntry`, `hashKeyMaterial` (same file) |
| Retained license versions, deterministic effective-version resolution, overlap/gap/supersession refusal | `backend/src/modules/licensing/application/license-import.service.ts` |
| `customerId` / `customerCode` / `customerName` validation and mismatch refusal | `backend/src/modules/licensing/domain/customer.ts` |
| Installation identity and binding conflict refusal | `backend/src/modules/licensing/application/installation-identity.service.ts` |
| Device enrollment `VDEA1`, replacement request `VDRQ1` canonical challenge, `VDRP1` verification and strict correlation | `backend/src/modules/licensing/domain/client-device.ts` |
| One-for-one atomic replacement, quota accounting, advisory + row locks, terminal cancel/expiry/replay | `backend/src/modules/licensing/data/client-devices.repository.ts` |
| Typed append-only licensing audit events | `licensing.license_audit_events` (`backend/prisma/schema/licensing.prisma`) |
| Permission-gated REST surface and Persian RTL device administration UI | `backend/src/modules/licensing/api/*`, `frontend/src` |

### 2.2 Present only as development/test tooling

- `backend/src/tools/development-license-authority.ts` — key-pair generation and
  `VLIC1`/`VLIC2` issuance. It is the **only** issuing code in the repository
  (ADR-0046 Decision 9).
- `backend/src/issue-development-license.ts` — the operator CLI, wired as
  `npm run license:keygen` / `npm run license:issue`.
- It parses no `VDRQ1`, evaluates no Owner replacement policy, retains no
  issuance record and emits no `VDRP1`. `VDRP1` artifacts exist in the test
  suite **solely** to verify the customer server
  ([OQ-83 plan §2.2](../tasks/licensing-oq-83-operational-plan.md)).

### 2.3 Absent on the Owner side

No Owner customer/contract record, no issuance ledger, no renewal workflow, no
revocation or reactivation instrument, no server-installation replacement, no
`VDRQ1` intake, no `VDRP1` signer, no operator identity or role model, no Owner
audit store, no Owner packaging or release channel. The path
`owner-licensing/` **does not exist** in the repository at the baseline SHA and
is only a candidate location — its existence would not by itself establish any
of the separations designed below.

### 2.4 Release-boundary defect found (must be fixed before any Owner work)

The customer production image **currently contains the license issuer**.

- `backend/tsconfig.build.json` sets `"include": ["src"]`, so both
  `src/issue-development-license.ts` and `src/tools/development-license-authority.ts`
  are compiled into `dist/`. The sibling `openapi:dump` script already proves
  `src/tools/` lands in `dist/tools/`.
- `backend/Dockerfile`'s `production` stage runs `COPY --from=build /app/dist ./dist`
  and copies `package.json`, so `dist/issue-development-license.js`,
  `dist/tools/development-license-authority.js` and the `license:keygen` /
  `license:issue` scripts all ship to the customer.
- The only protection is a **runtime** `config.nodeEnv === 'production'` throw in
  the CLI entrypoint. `generateAuthorityKeyPair()` itself has **no** environment
  guard and is importable from the shipped `dist/tools/` module.

Consequence: this violates the intent of PDR-11 §17.2 G-3 and the task red line
that Owner-only code must not enter the customer release package. It is a
**packaging** defect, not a signing defect — no private key ships, and
`LICENSE_SIGNING_PRIVATE_KEY` is never read by the application. It is recorded
here because "move the Owner code into a folder" cannot be claimed as a fix
while the existing issuer still travels inside the customer artifact.
Remediation options and their trade-offs are item **D-1** in the
[decision table](../tasks/licensing-owner-side-phase-0-readiness.md).

### 2.5 Contracts that must stay shared

These are the only Owner↔Customer contracts. They are **database-independent**
by construction: both sides exchange self-describing signed artifacts over
manual file/text transfer (PDR-11 §11.4), never a shared connection.

| Contract | Direction | Defined by |
| --- | --- | --- |
| `VLIC2` canonical payload + Ed25519 signature | Owner → Customer | `license-document.ts` |
| `vardena-license` file envelope (`fileVersion: 1`) | Owner → Customer | same |
| `VLIC1` legacy code | Owner → Customer | `license-code.ts` |
| Trusted authority public-key list and key-id grammar | Owner → Customer (out of band) | `parseTrustedLicenseKeys` |
| `VDEA1` enrollment challenge canonical bytes | Customer → Device | `client-device.ts` |
| `VDRQ1` replacement request artifact + envelope | Customer → Owner | same |
| `VDRP1` replacement response artifact + envelope | Owner → Customer | same |
| Identifier vocabularies (`customerId`, `customerCode`, `installationId`, `licenseId`, `licenseVersionId`, device ids, `operationId`) | both | `customer.ts`, `ID_PATTERN` |
| Stable refusal reasons | Customer → Owner (support correlation) | domain error classes |

Everything else — Owner schema, Owner UI, operator roles, issuance policy — is
Owner-private and must never become a customer dependency.

## 3. Owner-side boundary design

### 3.1 Code location and release boundary

A folder is not a boundary. Four independent mechanisms are required, and each
is separately verifiable:

1. **Separate dependency graph.** The Owner system has its own package manifest
   and lockfile. It may *consume* the shared protocol module (§3.2) but the
   customer package must never depend on Owner code — the dependency arrow is
   one-way, so a customer install cannot resolve an Owner symbol.
2. **Separate build artifact.** The customer build must be provably free of
   Owner code. This needs a positive gate, not an intention: a CI step that
   inspects the built customer `dist/` and the production image and fails on any
   Owner-only path or on the presence of `generateAuthorityKeyPair` /
   `signLicenseDocument` call sites outside the shared protocol module.
   §2.4 shows the current build fails such a gate today.
3. **Separate release channel.** Owner and Customer are versioned, tagged and
   distributed independently. An Owner release never requires a customer
   release, and a customer release never carries Owner binaries.
4. **Separate execution context.** The Owner system never runs on a customer
   server, never opens a connection to a customer database, and never exposes a
   network endpoint that a customer installation calls. Exchange is file-based
   only (PDR-11 §11.4, §11.6, G-7).

The **protocol module** is the one deliberate exception to physical separation
and is the subject of item D-2 in the decision table.

### 3.2 Shared protocol module (the only shared code)

Canonicalization is currently defined implicitly by Node's `JSON.stringify`
inside `backend/src/modules/licensing/domain/`. A second implementation in
another language or runtime must reproduce those bytes exactly or every
signature fails. Two options exist:

- **Option A — extract a publishable protocol package.** Move the canonicalizers,
  payload types, identifier patterns, error-reason vocabulary and trusted-key
  parsing into a standalone package with no NestJS, no Prisma and no application
  imports. Customer backend and Owner system both depend on it. Byte-level
  agreement is then guaranteed by construction.
- **Option B — no shared code, only shared vectors.** Keep the canonicalizers
  where they are and publish the language-neutral vector set in
  [licensing-protocol-vectors.md](./licensing-protocol-vectors.md) as the
  conformance contract. Any Owner implementation proves itself against the
  vectors in CI.

**Technical recommendation:** Option B first, Option A only if the Owner system
is also TypeScript. Option A is an invasive refactor of an accepted, CI-verified
module and would touch the customer enforcement path; Option B is additive,
carries no customer-runtime risk, and is sufficient because the vector set is
machine-checkable. This is a recommendation, not a decision (item D-2).

### 3.3 Runtime, configuration and secret separation

| Concern | Customer side | Owner side |
| --- | --- | --- |
| Public keys | `LICENSE_SIGNING_PUBLIC_KEYS` (trust list, may hold several) | not needed for signing; needed to verify nothing — Owner *is* the authority |
| Private key | **never present** (G-3, ADR-0046 Decision 9) | HSM/KMS or controlled offline signer; item D-5 |
| Configuration source | customer `.env` / compose | Owner-only secret store, never a customer-readable file |
| Database | `licensing` schema in the customer PostgreSQL | Owner store; **no** shared instance, no replication, no foreign key across the boundary |
| Logs | must never contain a private key or a raw signed payload | same, plus operator identity on every issuance |
| Process | NestJS API + worker | separate process, separate host, separate credentials |

`.gitignore` currently lists only `.env` and `__pycache__/`. There is **no**
ignore rule for key material, so a stray `*.pem` / `*.key` / `*.p8` file is
committable today. Adding explicit ignore patterns plus a secret-scan gate is a
prerequisite for any Owner work, and is cheap enough to do first. It is
**Phase 0.5A** and needs **no product decision** — it is independent of OQ-85
(item D-1) and of the protocol-contract ratification (item D-2), and must not be
bundled with either.

### 3.4 Database boundary

The customer database already holds a **projection** of Owner facts:
`licensing.customers` carries `id`, `customer_code` and `display_name`;
`licensing.installations`, `licensing.licenses` and `licensing.license_versions`
carry the imported signed state. That projection is correct and must stay: the
customer server needs it to enforce locally while offline (PDR-11 §11.2, G-2).

The Owner database is the **system of record** for the commercial relationship —
customer, contract, entitlement grant, issuance history, operator decision. The
customer projection is authoritative only for *what this installation may do
right now*.

Rules that follow, and that no Owner design may weaken:

- The Owner system never writes to a customer database and never reads one.
- A customer projection row never flows back as an Owner fact. Owner identity
  resolution during issuance reads the **Owner** record, not fields carried in
  an inbound `VDRQ1` ([OQ-83 plan §4](../tasks/licensing-oq-83-operational-plan.md)
  step 3; task red line: never trust request-supplied identity).
- `customerId` and `customerCode` are Owner-minted. The customer side already
  refuses a mismatch as `customer-code-mismatch` (409, nothing written) and never
  infers or fabricates a code (PDR-14). Renewal or replacement must never move a
  customer identity to another customer; the explicit audited transfer operation
  is the only rebinding path.
- No shared migration history. Owner migrations are a separate chain and must
  never appear in `backend/prisma/migrations`.

### 3.5 Signing-key custody

The mechanism already implemented is a trust **list**, which is the right shape
for rotation and must be reused rather than replaced:

- entries are `keyId:<material>` or a bare key; a bare key receives the
  deterministic id `sha256-<first 16 hex of SPKI DER>` (`hashKeyMaterial`);
- duplicate ids are rejected at configuration load;
- several keys may be trusted at once, so a new signer can be rolled out before
  it is used;
- an artifact naming an untrusted key is refused with a distinct reason;
- already-imported versions stay effective without re-verification, so ordinary
  rotation cannot invalidate a valid perpetual license (ADR-0046 Decision 7).

What is **not** decided and must not be guessed: the production custody model
(HSM vs KMS vs air-gapped offline signer), operator access control, dual
control, rotation cadence, and the emergency policy for a confirmed compromise
(PDR-11 §4.4 **U-1**, §15.1). `LICENSE_SIGNING_PRIVATE_KEY` as an environment
variable is a **development** convenience and is explicitly rejected as a
production custody model. Item D-5.

### 3.6 Issuance, renewal and versioning

Issuance must produce exactly the artifact the customer already verifies — no
new format, no new field invented for Owner convenience:

1. Resolve the customer, contract and target installation from the **Owner**
   record. `customerId` and `customerCode` are explicit, valid and distinct;
   neither is derived from `customerName` nor defaulted to the other (PDR-14).
2. Determine the grant: `status`, `validFrom`, `validUntil` (`null` = perpetual,
   exclusive end), `organizationLimit`, `userLimit`, `deviceLimit`, module and
   feature entitlements. An omitted `deviceLimit` means **UNSPECIFIED** and
   grants no device capacity — it is never unlimited by absence (PDR-15 §4).
3. Mint a fresh `operationId`. It is the replay identity; the customer refuses a
   second application of the same one.
4. For a renewal that overlaps a retained version, set `supersedesOperationId`
   to the version being retired. Explicit supersession is the **only** path that
   may change the term, and it may not reduce `organizationLimit`, `userLimit`
   or any granted entitlement (PDR-12 / OD-LIC-01). An unnamed overlap is
   refused by the customer as `overlapping-range`.
5. A renewal starting after a lapse is **not** an ordinary import: the customer
   refuses it and requires the dedicated audited gap-recovery operation
   (PDR-13 / OD-LIC-02). The Owner system must model that as a distinct,
   explicitly authorized operation, never as a default renewal.
6. Canonicalize, sign with an active trusted key, record `keyId`, and export the
   `vardena-license` file envelope (primary) with the bare artifact available as
   the text fallback (PDR-11 §11.3, G-8).
7. Persist the issuance record **before** handing the artifact to an operator,
   so an interrupted export cannot produce an unrecorded signature.

Backdated documents: the customer refuses a supersession that would rewrite
governance already exercised before the import instant
(`backdated-supersession`, 422). Whether the Owner may authorize retroactive
documents at all is **OQ-86**-adjacent and remains an Owner decision; the
interim fail-closed behaviour is not a permission.

### 3.7 Device replacement intake and `VDRP1` issuance

Inbound `VDRQ1` handling, in order. Every step is fail-closed:

1. **Transport.** Accept the `vardena-device-replacement-request` envelope or
   the bare text artifact; both decode to the same signed bytes. Enforce the
   `DEVICE_REPLACEMENT_MAX_FILE_BYTES` (65 536) bound before parsing.
2. **Device proof.** Verify the new device's detached Ed25519 signature over the
   exact canonical request bytes, using the SPKI public key carried in the
   request. The Owner never receives, and must never accept, a private key.
3. **Authoritative resolution.** Look up the Owner record for
   `customerId`/`customerCode`, `installationId`, `licenseId`,
   `licenseVersionId`, `oldDeviceId`, `newDeviceId`. The request's own fields
   are **claims to be checked against the Owner record, never the source of
   truth.** A request whose claims do not match is refused, not corrected.
4. **Policy.** Apply the approved operator policy: is the customer and contract
   in a state that permits replacement, is the named license version still the
   governing one, is this old device eligible, is there a newer superseding
   request, has this request already been decided.
5. **Deduplication.** Enforce a durable unique constraint over the request
   identity so a repeated intake cannot produce two responses, and a unique
   `responseOperationId` so a re-issue is detectable. Concurrent operators must
   not both sign.
6. **Signing.** Build the `VDRP1` payload with the exact implemented field set
   (`responseOperationId`, `keyId`, `requestId`, `challengeId`,
   `requestOperationId`, `requestHash`, `installationId`, `customerId`,
   `customerCode`, `licenseId`, `licenseVersionId`, `oldDeviceId`,
   `newDeviceId`, `publicKeyFingerprint`, `decision: 'APPROVE'`, `issuedAt`,
   `expiresAt`), canonicalize, and sign with an active authority key whose
   public half is **already** in the customer's trust list. `requestHash` is the
   SHA-256 of the exact request artifact. Issue/expiry instants must fall inside
   both the retained request window and the governing license validity, or the
   customer will refuse the response.
7. **Record.** Retain request hash, response hash, `keyId`, operator identity,
   decision, reason, timestamps and policy result. Never the private key, never
   a raw device private key, never more public material than the fingerprint
   needs for support correlation.
8. **Export.** Emit the response envelope for offline transfer. The customer
   server remains the final authority on correlation, replay and the atomic
   device exchange — an Owner approval is **not** a substitute for customer-side
   validation (task red line; PDR-11 G-2).

Note the implemented `VDRP1` carries `decision: 'APPROVE'` only. There is **no
signed refusal artifact**: a denial is an Owner-internal record and the customer
request simply expires. Whether a signed denial is needed is a genuine gap and
is item D-8 — it must not be added unilaterally, because it changes a signed
contract the customer already validates.

### 3.8 Offline exchange

No customer server may be required to reach the internet (PDR-11 §11.1). The
exchange is therefore a **file protocol with human transport**, and the design
has to treat that as a first-class channel rather than a degraded one:

- every artifact is self-describing (`format`, version) and self-verifying
  (signature over canonical bytes), so it needs no accompanying metadata file;
- every artifact carries its own `operationId`/`responseOperationId`, so
  duplicate delivery over an unreliable channel is harmless — the customer
  refuses the replay and changes nothing;
- expiry is signed into the artifact, so a stale file found on a USB drive
  cannot be applied late;
- the envelope is **not trusted** and contributes no licensing fact, so a
  renamed or re-wrapped file gains nothing (G-8);
- transfer integrity is not assumed: a truncated or corrupted file must fail
  parsing, not partially apply.

What the Owner side needs and does not have: a bounded intake format for the
inbound request file, an operator-visible summary of what is being approved
(customer, installation, old device, new key fingerprint, license version) so a
human decision is informed, and an export naming convention that lets an
operator match a response to a request without opening either. None of these
may become a network protocol.

### 3.9 Packaging and independent release

| Property | Customer Vardena | Owner system |
| --- | --- | --- |
| Artifact | `backend/Dockerfile` `production` image + frontend build | Owner-only artifact, separate pipeline |
| Contents gate | CI asserts absence of Owner code **and** of the dev issuer (§2.4) | CI asserts absence of customer application code except the shared protocol module |
| Secrets | public trust list only | signer access via approved custody, never in the artifact |
| Versioning | product release | Owner-internal release; artifact format versions are the shared contract |
| Distribution | customer deployment | Owner-controlled only; never published to a customer-readable channel |

The **artifact format version** (`VLIC2`, `vardena-license` `fileVersion: 1`,
`VDRQ1`, `VDRP1`, `DEVICE_REPLACEMENT_FILE_VERSION: 1`) is the compatibility
contract and is versioned independently of both release trains. Changing it is a
PDR-11 §15 U-8 backward-compatibility question and is **not** permitted for
implementation convenience.

## 4. Information flow

```text
        OWNER SECURITY BOUNDARY                     CUSTOMER BOUNDARY
  (Owner-controlled host; never a customer server)   (on-premise, may be offline)

  ┌───────────────────────────────┐                 ┌────────────────────────────┐
  │ Owner system of record        │                 │ Customer Vardena           │
  │  customers / contracts        │                 │  licensing schema          │
  │  grants / issuance ledger     │                 │   (projection of Owner     │
  │  operator roles + audit       │                 │    facts; local authority  │
  └──────────────┬────────────────┘                 │    for enforcement)        │
                 │                                  └───────┬──────────▲─────────┘
                 │ resolve identity,                        │          │
                 │ evaluate policy                          │ import   │ device
                 ▼                                          │ + verify │ enrollment
  ┌───────────────────────────────┐                         │          │ (VDEA1)
  │ Signing authority             │                         │          ▼
  │  custody: HSM/KMS/offline     │                 ┌────────────────────────────┐
  │  private key NEVER leaves     │                 │ Client device              │
  │  this boundary                │                 │  own Ed25519 key pair      │
  └──────────────┬────────────────┘                 │  private key NEVER leaves  │
                 │                                  └───────┬────────────────────┘
                 │ sign VLIC2 / VDRP1                       │ signs canonical
                 ▼                                          │ challenge bytes
        ════════════════════════════════════════════════════╪═══════════════
          OFFLINE TRANSFER CHANNEL — file / USB / text      │
          no network path, no customer internet required    │
                                                            ▼
   Owner ──► VLIC2 license file (envelope or text) ──► customer import ──► verify
                                                            signature against
                                                            LICENSE_SIGNING_PUBLIC_KEYS
                                                            ──► retain version ──► enforce

   Customer ──► VDRQ1 request file ──► Owner intake ──► verify device proof
              ──► resolve Owner record ──► policy + dedupe ──► sign VDRP1
              ──► export response file ──► customer import ──► verify trusted key,
              correlation, expiry, replay ──► atomic one-for-one replacement

   Trust list (authority PUBLIC keys) ──► distributed out of band, ahead of use
```

Two invariants the diagram encodes and no implementation may break:

- **Arrow direction of trust.** The customer validates everything inbound; the
  Owner validates everything inbound. Neither side trusts the other's transport.
- **No reverse channel.** Nothing flows from a customer database into the Owner
  system of record automatically. A `VDRQ1` is a *request to be checked*, and
  Owner-side status is updated manually from information available
  (PDR-11 §4.5) — an Owner-side change never executes automatically on an
  offline server (§11.6, G-7).

## 5. Technical gaps

Ordered by whether they block Owner implementation.

| # | Gap | Blocks Owner work? | Note |
| --- | --- | --- | --- |
| GAP-1 | Dev license issuer ships inside the customer production image (§2.4) | **Yes** | Packaging defect; guard is runtime-only and `generateAuthorityKeyPair` is unguarded. Fix = **Phase 0.5A**, needs no product decision and is independent of OQ-85 |
| GAP-2 | No `.gitignore` rule or CI secret-scan for key material | **Yes** | Only `.env` and `__pycache__/` are ignored today. Fix = **Phase 0.5A**, same gating as GAP-1 |
| GAP-3 | Canonical byte contract is not language-neutral ([vector doc §2](./licensing-protocol-vectors.md)) | **Yes** | JSON escaping rules are implicit in Node's `JSON.stringify`. Fixing this is **Phase 0.5B**, gated on the explicit Product Owner decision **D-2(b)**; nothing is ratified yet |
| GAP-4 | No published conformance vectors for `VLIC2`/`VDRQ1`/`VDRP1` | **Yes** | Tests self-generate artifacts with the same canonicalizer they verify. Fix = **Phase 1**, gated on **D-2(a)** and on GAP-3 being ratified first |
| GAP-5 | No signed refusal artifact; `VDRP1` supports `APPROVE` only | No — needs a decision | Item D-8; changes a signed contract, so not unilateral |
| GAP-6 | `docs/licensing/version-model-and-file-exchange.md` §2.1 canonical example omits `deviceLimit` | No | Example shows the pre-OQ-83 shape; prose §11 covers the field. Documentation drift only — but it edits the same normative §2.1 block, so its correction travels with **Phase 0.5B** (D-2(b)), not with Phase 0.5A |
| GAP-7 | No Owner intake bound / operator summary / export naming convention for offline exchange | Yes, for Phase 2 | §3.8 |
| GAP-8 | Revocation, reactivation and server-installation replacement instruments do not exist in any form | Yes, but gated | OQ-78 and OQ-82 are OPEN; **must not** be designed around here |
| GAP-9 | Owner audit retention and sensitive-data treatment undefined | Yes, but gated | OQ-77 / PDR-11 U-7 OPEN |
| GAP-10 | Owner role permission matrix undefined | Yes, but gated | PDR-11 U-5 OPEN; only the four role *categories* are approved |

GAP-8, GAP-9 and GAP-10 are **not** design work this phase may complete: each is
an OPEN product question, and inventing an answer would violate PDR-11 §17.2
G-10 and the task's prohibition on closing OQs by inference.

## 6. Acceptance criteria for the boundary

These are the criteria a future Owner-side PR must satisfy. They are stated now
so that "separated" is a testable claim rather than an assertion.

1. A CI gate inspects the built customer `dist/` and the `production` image
   layer and fails on any Owner-only module and on the development issuer.
2. A CI secret-scan gate fails the build on private-key material in the
   repository, in any artifact, in any fixture and in any log.
3. No Owner path appears in `backend/prisma/migrations`; the two migration
   chains are separately rooted.
4. The customer test suite passes with **no** Owner package installed.
5. The Owner test suite passes with **no** customer database reachable and no
   customer application code imported except the shared protocol module.
6. Both sides verify the identical published vector set
   ([licensing-protocol-vectors.md](./licensing-protocol-vectors.md)) in CI.
7. `LICENSE_SIGNING_PRIVATE_KEY` is not read by any code path in the customer
   artifact, and the production custody model is the approved one (item D-5),
   not an environment variable.
8. Every Owner issuance and every replacement decision is attributable to a
   named operator and retained (PDR-11 §12.7, §13.1, G-5).
9. No Owner operation opens a network connection to a customer installation, and
   no customer operation requires outbound internet.
10. A demonstrated replay of an already-applied artifact changes no state on
    either side.

## 7. What this document does not do

It does not choose the Owner repository or its ownership (OQ-85), the Owner UI
runtime, the Owner database product, the operator permission matrix (U-5), the
production key custody model or compromise policy (U-1), the device-client
platform, the revocation or reactivation design (OQ-78), the server-installation
replacement design (OQ-82), or signed receipts for ordinary activation (OQ-84).
It authorizes no implementation. The phased plan and the decision table are in
[the Phase 0 readiness report](../tasks/licensing-owner-side-phase-0-readiness.md).
