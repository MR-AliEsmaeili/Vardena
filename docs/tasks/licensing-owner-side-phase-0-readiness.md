# Owner-side licensing system — Phase 0 readiness report and open-decision table

**Status:** READY FOR REVIEW of the design. **Not** Product Owner acceptance,
**not** implementation authorization, and **not** closure of any OQ.
**Baseline SHA:** `961a696fbff16893dc69f93d6409af5430790a6c`
**Baseline verification:** `origin/main` fetched on 2026-10-15 resolves to
exactly the expected SHA — **no drift**, so no re-baselining was needed. No open
PR existed at task start; `main` CI was green (run `38704831986`, the merge of
PR #155). The eight most recent merged PRs are #155, #154, #153, #152, #151,
#150, #149 and #146; #147 and #148 are CLOSED without merging.
**Companion documents:** [Owner-side architecture](../licensing/owner-side-system-architecture.md) ·
[protocol vector contract](../licensing/licensing-protocol-vectors.md) ·
[OQ-83 operational plan](./licensing-oq-83-operational-plan.md) ·
[ADR-0048 (Proposed)](../adr/0048-owner-side-licensing-separation-boundary.md).

## 1. What Phase 0 was and was not

Phase 0 is technical design and decision preparation. This change is
**documentation only**: no application code, no migration, no schema, no signed
format and no test gate is modified. Nothing here authorizes building the Owner
application or the device client.

## 2. Findings from the actual repository

Full evidence in [architecture §2](../licensing/owner-side-system-architecture.md).
Summary, each item read from the tree at the baseline SHA:

1. **Customer side is substantially built.** `VLIC1`/`VLIC2` parse and verify,
   trusted-key list with rotation, retained versions with deterministic
   effective-version resolution, overlap/gap/supersession refusal,
   `customerId`/`customerCode` validation, installation binding, `VDEA1`/`VDRQ1`/`VDRP1`
   device protocol, atomic one-for-one replacement, quota accounting under
   advisory + row locks, typed audit, permission-gated API and Persian RTL UI.
2. **Owner side is entirely absent.** No customer/contract record, no issuance
   ledger, no renewal workflow, no revocation or reactivation instrument, no
   server replacement, no `VDRQ1` intake, no `VDRP1` signer, no operator model,
   no Owner audit store, no Owner packaging.
3. **`owner-licensing/` does not exist.** Verified absent. It is a candidate
   path only, and creating it would not by itself deliver any separation.
4. **The only issuer is development tooling** — `backend/src/tools/development-license-authority.ts`
   and `backend/src/issue-development-license.ts`. It parses no `VDRQ1` and
   emits no `VDRP1`.
5. **NEW DEFECT (GAP-1): the development issuer ships inside the customer
   production image.** `backend/tsconfig.build.json` includes all of `src`, so
   both files compile into `dist/`; `backend/Dockerfile`'s `production` stage
   runs `COPY --from=build /app/dist ./dist` and copies `package.json`, so
   `dist/issue-development-license.js`, `dist/tools/development-license-authority.js`
   and the `license:keygen` / `license:issue` scripts all reach the customer.
   The only guard is a **runtime** `NODE_ENV === 'production'` throw in the CLI
   entrypoint; `generateAuthorityKeyPair()` has no environment guard at all and
   is importable from the shipped module. No private key ships and the
   application never reads `LICENSE_SIGNING_PRIVATE_KEY`, so this is a
   **packaging** defect rather than a key-leak — but it means the claim "Owner
   code is not in the customer package" is **false today** and must be remediated
   before any Owner work, not after.
6. **NEW DEFECT (GAP-2): no secret hygiene gate.** `.gitignore` lists only
   `.env` and `__pycache__/`. There is no ignore rule for key material and no
   secret-scan step in `.github/workflows/ci.yml`.
7. **NEW GAP (GAP-3): the canonical byte contract is not language-neutral.**
   Measured on Node 22: the implementation emits non-ASCII **raw**, does not
   escape `<`, `>`, `&`, `/`, `U+007F`, `U+2028` or `U+2029`, and escapes other
   C0 controls as `\u00xx` in **lowercase**. Python's default `json.dumps`
   escapes all non-ASCII; Go escapes `<>&` and `U+2028/9`. The exposure is
   narrow but real: `customerName` is the only signed field with no charset
   restriction (`assertValidCustomerName` trims and length-checks 1..200 only),
   and this is a Persian-first product. `VDEA1`/`VDRQ1`/`VDRP1` carry no
   free-text field, so their canonical bytes are ASCII-only and unambiguous.
   Detail and the compatibility-preserving fix in
   [vectors §2](../licensing/licensing-protocol-vectors.md).
8. **NEW GAP (GAP-4): no published conformance vectors.** Tests generate
   artifacts with the same canonicalizer that verifies them — self-consistency,
   not a contract.
9. **NEW GAP (GAP-5): no signed refusal artifact.** `VDRP1` supports
   `decision: 'APPROVE'` only. A denial is an Owner-internal record; the customer
   request simply expires.
10. **DOC DRIFT (GAP-6):** `version-model-and-file-exchange.md` §2.1's canonical
    `VLIC2` example predates OQ-83 and omits `deviceLimit`. Prose §11 covers the
    field, so this is documentation drift, not a code defect.
11. **Interop trap identified:** `requestHash` is SHA-256 of the **armored
    `VDRQ1` artifact string**, not of the decoded payload
    (`client-devices.repository.ts`, `sha256(artifact)`). Also, two different
    digest conventions coexist: the device `publicKeyFingerprint` is the **full**
    64-hex SHA-256 of the SPKI DER, while the trusted-key id from
    `hashKeyMaterial` is `sha256-<first 16 hex>`. Both are correct; conflating
    them is the most likely second-implementation bug.
12. **Database boundary is already coherent.** The customer `licensing` schema
    holds a *projection* of Owner facts (`customers`, `installations`,
    `licenses`, `license_versions`, entitlements, audit, devices, challenges,
    replacement requests). That projection is required for offline local
    enforcement and must stay; it is not the Owner system of record.
13. **CI scope:** a `.md`-only change set classifies as `docs` and runs only the
    link-check job (`scripts/ci-classify-scope.py`, `scripts/check-docs-links.py`).
    Any change under `backend/` runs the full backend job including PostgreSQL
    rehearsals — which is why the vector generator work is a later phase, not
    this one.

## 3. Open-decision table

For each item: the recorded decision and its source, what remains OPEN, the real
options, their trade-offs and security consequence, the technical
recommendation, and whether explicit Product Owner approval is required.

**Approving the Owner-side separation direction does not approve any item below.**

### D-1 — Owner repository location, ownership and release boundary

- **Recorded:** signing stays outside the product; no private key is stored,
  accepted or served by the application; the dev CLI is the only issuer and
  refuses `NODE_ENV=production` (ADR-0046 Decision 9). Guardrails G-2, G-3.
  PDR-15 §3 explicitly does **not** decide OQ-85.
- **OPEN:** whether the Owner system is part of Vardena or a separate
  Owner-controlled tool; which repository; who owns the data; relation to
  CRM/ticketing ownership (**OQ-85**, cross-referencing **OQ-61**). Also open:
  how GAP-1 is remediated.
- **Options:**
  - **A. Separate private repository.** Strongest boundary; customer repo
    physically cannot resolve Owner code; independent release and access control.
    *Cost:* the shared protocol must be published as a package or duplicated
    against vectors; two CI systems; harder cross-cutting protocol change.
    *Security:* best — a customer-repo compromise cannot reach Owner code or keys.
  - **B. `owner-licensing/` in this repository, excluded from the customer
    build.** One place to change the protocol; shared CI. *Cost:* separation
    depends entirely on build configuration and gates, which is precisely what
    GAP-1 proves is currently not enforced; a public repository would also
    expose Owner business logic. *Security:* weaker — same repo, same
    credentials, same history; one mistake in `tsconfig`/`Dockerfile` re-leaks it.
  - **C. Separate build target inside `backend/`.** *Rejected as a serious
    option:* it puts Owner code inside the customer deployable's own source tree
    and build graph, which is the condition GAP-1 already shows is unsafe.
- **Recommendation:** **A**, a separate private repository, **and** treat the
  release boundary as four mechanisms (dependency graph, build artifact, release
  channel, execution context) rather than as a folder — see
  [architecture §3.1](../licensing/owner-side-system-architecture.md). Regardless
  of A or B, GAP-1 and GAP-2 must be remediated **first**, because they are
  defects in the customer artifact that exist independently of where Owner code
  eventually lives: add key-material ignore patterns and a secret-scan gate, and
  add a CI gate that fails when the built customer `dist/` or the `production`
  image contains the issuer.
- **Product Owner approval required?** **YES** — OQ-85 is an OPEN product
  decision and cannot be inferred. GAP-1/GAP-2 remediation is a defect fix in the
  customer package and needs only normal implementation authorization.

### D-2 — Shared protocol module vs vectors-only

- **Recorded:** formats are fixed by the implemented canonicalizers; PDR-11 §15
  U-3/U-8 leave format evolution OPEN; §16 item 2 defers the container/canonical
  form/trusted-key distribution design.
- **OPEN:** whether a shared code artifact exists at all, and whether the
  escaping rules of GAP-3 are ratified as written.
- **Options:**
  - **A. Extract a publishable protocol package** (canonicalizers, payload types,
    identifier patterns, error vocabulary, trusted-key parsing; no NestJS, no
    Prisma). *Pro:* byte agreement by construction. *Con:* invasive refactor of
    an accepted, CI-verified module that sits on the customer enforcement path;
    needs a package registry and versioning discipline.
  - **B. Vectors only.** *Pro:* purely additive, zero customer-runtime risk,
    machine-checkable, works across languages. *Con:* a second implementation can
    still diverge on a case no vector covers.
- **Recommendation:** **B first**, and A only if the Owner system turns out to be
  TypeScript (in which case D-1 Option A still allows a shared internal package).
  Ratify the measured escaping behaviour as normative text rather than changing
  it — that preserves every already-issued artifact. If instead a different
  escaping rule is wanted (e.g. RFC 8785 JCS), that is a **format change**
  requiring a versioned `VLIC3` and a U-8 decision, and must not be done
  silently inside vector work.
- **Product Owner approval required?** **YES for the ratification wording** (it
  becomes normative contract text) and **YES** if any format change is desired.
  Publishing vectors themselves is implementation work.

### D-3 — Owner UI architecture and expert-system runtime

- **Recorded:** PDR-11 §4.2 requires multiple users with RBAC; §13 approves four
  role *categories*; ADR-0001 fixes Modular Monolith and forbids microservices
  for the product; the task forbids a new network service on the Owner side
  created to route around architecture.
- **OPEN:** the runtime and UI shape for the Owner system, and whether it needs a
  UI at all in the first controlled phase.
- **Options:**
  - **A. Operator CLI only, first phase.** *Pro:* smallest attack surface, no
    auth/session/UI layer, fastest to audit, matches the existing dev-issuer
    ergonomics, and the offline file protocol needs no server. *Con:* poor for
    non-technical staff; no concurrent-operator controls beyond the filesystem
    and database; weak for a support desk.
  - **B. Owner web application (own deployable, own auth).** *Pro:* usable by
    specialists, supports the role matrix and audit properly. *Con:* a full
    application to secure — authentication, sessions, RBAC, audit, backup — all
    outside the customer product's tested code; larger surface.
  - **C. Reuse the customer Vardena application in an "Owner mode".**
    *Rejected:* violates the approved direction outright (no Owner code in the
    customer runtime or package) and would place the signer adjacent to customer
    data.
- **Recommendation:** **A now, B later** — CLI for the first controlled issuance
  phase (which is what [OQ-83 plan §4](./licensing-oq-83-operational-plan.md)
  already anticipates: "an isolated operator CLI for the first controlled phase
  or an Owner application later"), then a web application once the role matrix
  (D-6) is decided, since building RBAC before the permissions are known is
  speculative. Whatever is chosen, it must be a **separate deployable with its
  own database and its own credentials**, and must not expose an endpoint that a
  customer installation calls.
- **Product Owner approval required?** **YES** — this is a deployment-topology and
  tooling choice with cost and staffing consequences (AR-29 also applies).

### D-4 — Owner data model and source of truth

- **Recorded:** PDR-11 §14 lists conceptual entities (Customer/Contract, License,
  LicenseVersion, ServerInstallation, ReplacementRecord, ClientDevice, AuditEvent)
  and states they do **not** prescribe schema, tables or storage; the existing
  `licensing.*` tables are explicitly not a design commitment (CF-17). PDR-14
  makes `customerId` internal identity, `customerCode` the stable business code
  and `customerName` a non-identity display name never overwritten by ordinary
  import. PDR-11 §4.5 requires Owner status corrections to preserve previous
  value, new value, timestamp, actor and reason.
- **OPEN:** the Owner database product and schema; whether contracts, billing and
  CRM live in it (CRM/billing are out of scope per PDR-11 §17.1 and OQ-61 is
  OPEN); Owner audit retention (OQ-77 / U-7).
- **Options:**
  - **A. Dedicated Owner PostgreSQL, own schema, own migration chain.** *Pro:*
    matches the team's existing competence and tooling; strong constraints; easy
    to keep append-only audit. *Con:* another database to operate and back up.
  - **B. Reuse the customer schema shape in an Owner database.** *Pro:* familiar
    models. *Con:* invites accidental coupling and the false idea that the two
    databases synchronize; CF-17 warns the existing tables are not a commitment.
  - **C. File-based / spreadsheet ledger.** *Rejected:* cannot enforce unique
    `operationId`, cannot prevent duplicate issuance under concurrent operators,
    and cannot carry attributable audit — all hard requirements (G-5, G-6).
- **Recommendation:** **A**, with these invariants: the Owner store is the system
  of record for customer, contract, grant and issuance history; the customer
  `licensing` projection is authoritative only for what that installation may do
  now; **no** shared instance, replication or cross-boundary foreign key; **no**
  Owner table in `backend/prisma/migrations`; identity resolution during issuance
  reads the Owner record and never trusts inbound `VDRQ1`/`VLIC` fields; durable
  unique constraints on `operationId` and `responseOperationId` so duplicate
  issuance is impossible at the database level, not only in application logic.
- **Product Owner approval required?** **YES** for the product/ownership question
  (OQ-85, OQ-61) and for retention (OQ-77). The invariants above restate
  decisions already recorded and need no new approval.

### D-5 — Production signing-key custody, rotation and compromise

- **Recorded:** PDR-11 §4.4 — the private key stays in a secure Owner
  environment, only the authorized issuance process may access it, it is never
  distributed to customer servers, and ordinary rotation must not invalidate
  valid perpetual licenses. §13.2 — no role grants routine key access beyond the
  issuance process. G-3. ADR-0046 Decision 7 — rotation is a trust-list
  operation and already-imported versions stay effective without re-verification.
  The trust-list mechanism (`keyId:<material>`, derived bare-key ids, duplicate-id
  rejection, multiple simultaneous keys) is **implemented and should be reused**.
- **OPEN:** the custody technology; operator access control and dual control;
  rotation cadence; and **U-1** — the emergency policy for a confirmed
  compromise (revoke, grandfather, or another process). PDR-11 §15.1 says U-1
  requires a separate Owner decision **before** implementing signing-key handling.
- **Options:**
  - **A. Cloud KMS/HSM with per-operator IAM and audit.** *Pro:* key never
    exportable, access is logged, rotation is a managed operation. *Con:* the
    Owner signer needs network access to the KMS, which conflicts with a fully
    air-gapped issuance process; vendor dependency; cost.
  - **B. Air-gapped offline signer (dedicated machine, key on encrypted media,
    human-mediated file transfer).** *Pro:* strongest isolation and a natural fit
    with the already-mandated offline file protocol (§11.4); no network attack
    path. *Con:* operationally slow, single-machine availability risk, physical
    security becomes the control, harder dual control.
  - **C. Environment variable / file on the application host.** *Rejected:* this
    is the development model; PDR-11 §4.4 and the OQ-83 plan both explicitly
    reject it as production custody.
- **Recommendation:** **B for the first controlled phase**, moving to **A** if
  issuance volume or the number of authorized specialists grows — B is the only
  option that needs no new network path and matches the offline exchange that is
  already the mandated transport. Roll the new public key into customer trust
  lists **before** first use (ROT-01…ROT-06 vectors). **U-1 must be answered
  before any production key is generated**, because the compromise policy
  determines whether a key hierarchy and revocation instrument are needed at all
  — and revocation is itself OQ-78, currently unimplemented.
- **Product Owner approval required?** **YES — blocking.** U-1 is explicitly an
  Owner security decision that gates implementation.

### D-6 — Expert roles and issuance/replacement approval policy

- **Recorded:** PDR-11 §13 approves four role *categories* — Owner System
  Administrator, License Issuance Specialist, Read-only Observer, Support
  Specialist with limited access — and states the purpose column is descriptive
  only and must be confirmed under U-5. §4.3 — second-person approval is **not**
  mandatory; role-based authorization and auditability are. §13.1 — every
  role-based action is attributable and audited.
- **OPEN:** **U-5**, the exact operation-level permission for each role, and the
  scope of "Support Specialist with limited access". Also open as a policy
  choice: whether replacement issuance should nevertheless require dual control
  even though §4.3 does not mandate it.
- **Options:**
  - **A. Single-operator issuance with full attribution.** *Pro:* matches §4.3
    exactly, operationally simple. *Con:* one compromised or careless specialist
    can issue or approve a replacement; no second pair of eyes on an
    irreversible signed artifact.
  - **B. Dual control for high-impact operations only** (perpetual grants,
    unlimited limits, device replacement, any term change via supersession).
    *Pro:* §4.3 does not forbid it — it only declines to make it mandatory
    everywhere; concentrates friction where the commercial risk is. *Con:* needs
    a pending-approval state and a second operator, so it is real work.
  - **C. Dual control everywhere.** *Con:* §4.3 explicitly says it is not
    required, and it would make routine renewal painful.
- **Recommendation:** **A as the floor, B as the target** — implement full
  attribution first (it is mandatory and cheap), and adopt dual control for the
  four high-impact cases once the role matrix is decided. Do **not** build a
  permission matrix before U-5 is answered; guessing it produces a matrix that
  has to be unwound. Note that a signed artifact is **irrevocable in practice**
  today: there is no revocation instrument (OQ-78), so a wrongly issued perpetual
  license cannot be withdrawn — which is the strongest argument for B.
- **Product Owner approval required?** **YES — U-5 is an explicit Owner decision.**

### D-7 — Device-client platform and device private-key custody

- **Recorded:** PDR-15 §2.1/§2.2 (OD-LIC-04) — a device is identified by its own
  key, never by IP or hostname; the private key stays on the device and the
  server retains only public key and fingerprint. The implemented design states
  the external client generates the pair and protects it in platform-appropriate
  secure storage, and that the browser UI is an orchestration surface that never
  generates, receives or persists a device private key. §2.10 — replacement works
  without the old device or its key.
- **OPEN:** supported platforms; whether the client is an installed companion,
  another existing application, or a separately distributed agent; repository
  ownership and update channel; required keystore strength and non-exportability;
  whether any encrypted backup/recovery of a device key is permitted; behaviour on
  key loss (replacement is the current safe default).
- **Options:**
  - **A. Installed desktop companion per platform, OS keystore / TPM / Secure
    Enclave, non-exportable key.** *Pro:* strongest custody, matches PDR-15's
    intent, survives browser profile loss. *Con:* N platform builds, a
    distribution and update channel, and real support cost.
  - **B. Browser-held key via WebCrypto (non-extractable `CryptoKey`).**
    *Pro:* no installation, no update channel. *Con:* the implemented design
    already records that a normal browser profile does **not** establish approved
    platform custody, backup/non-exportability, device binding or reinstallation
    behaviour; clearing a profile silently destroys a licensed device identity.
  - **C. Server-generated key delivered to the device.** *Rejected outright:*
    violates PDR-15 §2.2 — the private key must never transit the server.
- **Recommendation:** **A**, with key loss treated as **replacement** (never a
  silent clone or reuse of a retained device key), and **no** encrypted key
  backup/recovery in the first phase — introducing one creates a second secret
  that needs its own custody policy, and PDR-15 already provides a safe path
  (replacement) without it. Platform list and repository ownership are Owner
  decisions.
- **Product Owner approval required?** **YES** — OQ-83 Phase 1 is explicitly
  gated on it, and it drives cost and support commitments.

### D-8 — Signed refusal artifact for a denied replacement

- **Recorded:** the implemented `VDRP1` payload carries `decision: 'APPROVE'`
  only, and `canonicalizeDeviceReplacementResponse` throws `malformed-response`
  for any other value. The customer treats a pending request as terminally
  expired or cancelled without needing a signed denial. PDR-15 §2.13/§2.14
  require only that offline completion await a valid signed response and that
  cancellation be durable and non-replayable.
- **OPEN:** whether a denial should be a signed artifact at all.
- **Options:**
  - **A. No signed refusal (status quo).** *Pro:* no format change; a denial is
    Owner-internal and the customer request expires on its own, which is already
    safe and already tested. *Con:* the customer's administrator gets no
    machine-readable "denied" — only eventual expiry — so support must explain it
    out of band.
  - **B. Add a `DENY` decision to `VDRP1`.** *Pro:* explicit, auditable outcome
    on both sides. *Con:* **changes a signed contract the customer already
    validates**; requires a customer-side parser change, new tests, new vectors
    and a migration of expectations — and the current parser *rejects* any
    non-`APPROVE` value as malformed, so old customers would refuse a denial.
  - **C. Separate `VDRD1` denial format.** *Pro:* leaves `VDRP1` untouched, so no
    existing verification weakens. *Con:* a new format is a U-3/U-8 design item
    and needs its own versioning, vectors and import path.
- **Recommendation:** **A now** (do nothing — the expiry path is safe and already
  verified), and revisit only if support volume shows administrators genuinely
  need a machine-readable denial. If it is later wanted, prefer **C** over B,
  because B weakens a currently strict validator. This must not be added
  unilaterally for issuer convenience.
- **Product Owner approval required?** **YES** if any change is wanted; **no**
  approval needed to keep the status quo.

### D-9 — Owner interaction with customer-side cancellation and expiry, offline

- **Recorded:** PDR-11 §11.6 and G-7 — an Owner-side change never executes
  automatically on an offline server. §4.5 — the Owner's recorded status may be
  unconfirmed or out of sync. PDR-15 §2.14 — cancellation is durable and a
  cancelled request cannot be replayed or completed by importing its earlier
  response. The [OQ-83 plan §4](./licensing-oq-83-operational-plan.md) already
  records that customer-side cancellation is **safe even if the Owner produces a
  late response**, because import rejects the terminal request and leaves the old
  device active, and that whether cancellation is synchronized into the Owner
  system is an operational policy decision, not a reason to weaken server
  correlation.
- **OPEN:** whether the Owner system should learn about customer-side
  cancellation/expiry at all, and if so how, given there is no reverse channel.
- **Options:**
  - **A. No synchronization; Owner records stay possibly stale.** *Pro:* zero new
    mechanism; already safe because the customer server is authoritative and
    refuses a response for a terminal request. *Con:* an Owner specialist may
    spend effort issuing a response that will be rejected; the Owner ledger
    overstates pending demand.
  - **B. Inbound status file from the customer** (a signed or unsigned "these
    requests are cancelled/expired" export carried back over the same offline
    channel). *Pro:* the Owner ledger becomes closer to reality; no network path.
    *Con:* a **new artifact format** (U-3/U-8), new import surface on the Owner
    side, and it must never become an authorization input — the Owner must still
    resolve identity from its own record.
  - **C. Network callback from customer to Owner.** *Rejected:* violates §11.1
    (no internet requirement) and G-7.
- **Recommendation:** **A for the first phase**, with the Owner UI/CLI surfacing
  a clear warning that a response may be rejected because the customer request
  has since expired or been cancelled, and with the Owner ledger marking an
  issued response as *issued, not confirmed applied* until evidence arrives.
  Confirmation of application is itself a **receipt** question — **OQ-84** — and
  must not be answered here. Adopt B only if stale-ledger cost is demonstrated.
- **Product Owner approval required?** **YES** for B (new format, U-3/U-8).
  A is the status quo and needs no new approval.

### D-10 — Gated items that Phase 0 must not design around

These are OPEN product questions whose answers change the Owner design
materially. Each is recorded here so the dependency is explicit; **none is
answered or narrowed by this work.**

| OQ | Subject | Effect on Owner design | Status |
| --- | --- | --- | --- |
| **OQ-77** | Licensing audit retention periods and sensitive-data treatment (U-7) | Determines Owner ledger retention, purge behaviour and which fields must be redacted or hashed. The customer typed audit table already stores identifiers, outcome, bounded reason and hash only — never a raw document, signature or key — and implements **no** purge; that is a technical default, not a retention decision. | OPEN — do not guess |
| **OQ-78** | Full revocation, recovery and reactivation while login is blocked | No revocation state, file or import path exists anywhere. The Owner system's most consequential power — withdrawing a wrongly issued license — **does not exist yet**, which is why D-6 recommends dual control and why D-5 says U-1 must be answered before generating a production key. | OPEN — do not design around |
| **OQ-82** | Server-installation replacement recovery detail | PDR-11 §4.1 requires the Owner system to manage server-installation replacement, but no request/response format, state machine or receipt exists. Device replacement (OQ-83) is **not** server replacement and must not be presented as covering it. | OPEN — separate slice |
| **OQ-84** | Signed activation receipts beyond replacement | Determines whether the Owner ever receives proof that an issuance was applied. D-9's "issued, not confirmed applied" state is a direct consequence of this being OPEN. | OPEN |
| **OQ-85** | Owner-side system ownership and location | Gates D-1, D-3 and D-4. The fixed part is only the negative boundary of ADR-0046 Decision 9. | OPEN — the central question of this phase |
| **OQ-61** | CRM/ticketing timing and ownership | Cross-referenced by OQ-85; determines whether customer/contract data belongs in the Owner licensing system or elsewhere. | OPEN |

## 4. Security risk matrix

| # | Risk | Likelihood | Impact | Mitigation designed here | Residual |
| --- | --- | --- | --- | --- | --- |
| R-1 | Owner code or the dev issuer reaches a customer deployment | **Occurred** (GAP-1) | High — an issuer on a customer host is a license-forgery primitive if a key is ever present | Positive CI gate on built `dist/` and the `production` image; separate dependency graph and release channel (D-1) | Low after gate; **not yet remediated** |
| R-2 | Production private key committed, logged or shipped | Low | **Critical** | Secret-scan gate + key-material ignore patterns (GAP-2); HSM/air-gapped custody (D-5); key never in artifact, log or fixture | Low, but U-1 unanswered means no compromise response exists |
| R-3 | Second implementation produces different canonical bytes → all signatures fail | **High** without vectors | High — total interop failure, discovered in the field | Normative escaping rule + published vectors + CI regeneration gate (GAP-3/4) | Low after vectors; **vectors not yet published** |
| R-4 | Owner trusts request-supplied identity and issues to the wrong customer | Medium | **Critical** — identity/`customerCode` transfer between customers | Owner record is the sole source of truth; request fields are claims to be checked; customer independently refuses `customer-code-mismatch` and `license-binding-conflict` | Low |
| R-5 | Duplicate issuance / double-signed response | Medium | High — two valid artifacts for one operation | Durable unique `operationId` / `responseOperationId` constraints at the database level; customer replay refusal already implemented and tested | Low |
| R-6 | Stale Owner data drives a wrong approval | **High** | Medium | Owner ledger marks responses *issued, not confirmed applied*; D-9 warning; customer correlation and expiry checks are the real gate | Medium — inherent to offline, and OQ-84 is OPEN |
| R-7 | Wrongly issued perpetual license that cannot be withdrawn | Medium | **High** | Dual control for high-impact operations (D-6); explicit `validUntil` review before signing | **High until OQ-78 exists** — there is no revocation instrument |
| R-8 | Signing-key compromise with no agreed response | Low | **Critical** | None available — **U-1 is OPEN** | **Unmitigated by design; blocked on Owner decision** |
| R-9 | Device private key exportable, cloned, or lost with a browser profile | Medium | Medium | Platform keystore, non-exportable, key loss = replacement (D-7) | Medium until platform chosen |
| R-10 | Malicious or malformed offline file | Medium | Medium | 65 536-byte bound before parsing, exact-key envelope checks, strict base64url round-trip, canonical-SPKI check, fail-closed parsing — all already implemented | Low; negative vectors will prove it |
| R-11 | Partial replacement strands a customer | Low | High | One transaction under installation row lock + device advisory lock; before/after active count must be equal; failure leaves the old device `ACTIVE` — implemented and live-tested | Low |
| R-12 | Owner system becomes a network service customers depend on | Low | **Critical** — breaks §11.1 offline guarantee | No inbound or outbound network path between the two sides; file transport only; acceptance criterion 9 | Low |

## 5. Phased plan for later implementation

Each phase needs its own authorization. **No phase is authorized by this
document.**

**Phase 0 — this change (documentation only).** Design, gap analysis, decision
table, risk matrix, Proposed ADR-0048. *Accept when:* Product Owner has read the
decision table and answered D-1, D-5 and D-6 at minimum.

**Phase 0.5 — customer-package remediation (small, independent, no Owner code).**
Fix GAP-1 and GAP-2: key-material ignore patterns, a secret-scan CI step, and a
CI gate asserting the built customer `dist/` and `production` image contain no
issuer. Ratify the normative escaping text and correct the §2.1 `deviceLimit`
omission (GAP-3 documentation part, GAP-6). *Accept when:* the gate fails on a
deliberately reintroduced issuer and passes on `main`; every existing artifact
still verifies; no behaviour change. **This phase does not depend on OQ-85 and
should not wait for it** — it fixes a defect that exists today.

**Phase 1 — protocol vectors.** Deterministic generator inside the backend test
tree reusing the real canonicalizers and real reason strings; committed vector
set; customer conformance test; CI regeneration gate. *Accept when:* both the
existing customer suite and the new conformance test pass on the exact head, and
regeneration is byte-identical. Touches `backend/`, so it runs full backend CI.

**Phase 2 — controlled Owner issuer (CLI).** Strict `VDRQ1` verification, Owner
record resolution, policy checks, durable dedupe, protected signing, exact
`VDRP1` output, auditable issuance record, offline export. *Gated on:* D-1, D-3,
D-4, D-5 (incl. U-1), D-6 (incl. U-5). *Accept when:* golden and negative
vectors, role checks, duplicate/replay tests, key-rotation drill,
interrupted-operation recovery and audit completeness all pass.

**Phase 3 — device client proof of concept.** *Gated on:* D-7. *Accept when:* the
private key is non-exported under the approved model, network and logs carry only
public key and signature, and expiry/cancellation/stale-challenge/reinstall/key-loss
tests pass.

**Phase 4 — staging end-to-end pilot.** Real client keystore, non-production
authority keys, full offline transfer both directions. *Accept when:* server
inventory and audit are authoritative, quota never grows during replacement, and
the old device stays `ACTIVE` on every failed path.

**Phase 5 — operational readiness review.** Deployment, monitoring, support,
backup/recovery, key rotation and incident runbooks. *Accept when:* Product Owner
and independent security review accept the evidence. Only then may OQ-83 and
OQ-85 closure be considered, separately.

## 6. Verification of the Owner-code and private-key claim

The task requires an explicit statement, with evidence, that Owner code and any
production private key are absent from the customer package.

- **Production private key in the customer package: VERIFIED ABSENT.** The
  application reads only `LICENSE_SIGNING_PUBLIC_KEYS`
  (`backend/src/kernel/config/app-config.ts`); `LICENSE_SIGNING_PRIVATE_KEY` is
  read solely by `backend/src/issue-development-license.ts`, which is a CLI
  entrypoint never invoked by `dist/main.js` or `dist/worker.js`. No private key
  is committed: the repository contains no key material and `.env` is gitignored.
  This change adds no key material of any kind.
- **Owner code in the customer package: NOT VERIFIED — and currently FALSE.**
  The development license issuer **is** compiled into `dist/` and **is** copied
  into the `production` image (GAP-1, §2.5). No *Owner-side system* code exists
  to leak, but the issuing capability does ship. The claim cannot be made until
  Phase 0.5 adds the positive gate. It is reported here as **NOT VERIFIED**
  rather than asserted.
- **This change introduces no Owner code and no key material**, so it does not
  worsen either position.

## 7. Tests actually run for this change

- `scripts/check-docs-links.py` — the repository's own documentation gate, run
  locally (deterministic, stdlib-only, no database, no build). This is the only
  job a `.md`-only change set triggers in CI via `scripts/ci-classify-scope.py`.
- `scripts/tests` unit tests for the CI helper scripts — stdlib only.
- No backend, frontend, PostgreSQL, E2E, migration-rehearsal or Docker test was
  run locally, per `docs/testing/test-execution-policy.md` and the task's
  FAST-LOCAL rule. No test or gate was weakened, skipped or removed.
- The canonicalization measurements in §2 finding 7 of this report and in
  [vectors §2.2](../licensing/licensing-protocol-vectors.md) were produced with
  plain `node -e` against the documented wire shape — no dependency install, no
  build, no repository code executed.
- CI must be checked on the exact PR head SHA; a green run is **not** Product
  Owner acceptance and **not** operational readiness.

## 8. Remaining risks and next execution step

**Remaining risks:** R-1 (unremediated packaging defect), R-3 (no vectors yet),
R-7 and R-8 (no revocation instrument, no compromise policy — both blocked on
Owner decisions), R-6 (inherent to offline exchange until OQ-84).

**Known deficiencies that prevent a READY status for implementation:** GAP-1 and
GAP-2 are live defects in the customer package; GAP-3 and GAP-4 mean no second
implementation can be built conformantly today; D-5/U-1 and D-6/U-5 are
explicitly blocking per PDR-11 §15.1.

**NEXT EXECUTION STEP (recommended):** Product Owner answers **D-1** (OQ-85
repository location and release boundary), **D-5** (production key custody plus
the U-1 compromise policy) and **D-6** (the U-5 role matrix floor), and
authorizes **Phase 0.5** — the customer-package remediation and normative
escaping text — which is independent of OQ-85 and fixes a defect that exists on
`main` today. Phase 1 (vectors) can then proceed without further product
decisions. Phase 2 must not start until D-1, D-3, D-4, D-5 and D-6 are recorded.
