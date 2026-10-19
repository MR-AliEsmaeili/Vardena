# Owner-side license issuance and customer allocation — repository verification and blocked-decision assessment (2026-10-19)

**Type:** documentation and dependency assessment only. **No runtime, schema,
migration, endpoint, permission, signer, key, artifact kind, DTO or UI change is
made or authorized by this document.**

**Gate decision:** **`BLOCKED — PRODUCT OWNER DECISION REQUIRED`** for real
Owner-side license issuance. Four independent decisions are outstanding
(§4 B-1…B-4). Each is blocking on its own; none can be inferred from an
existing record without inventing a security or product rule.

> **Superseded 2026-10-19, same day — the Product Owner answered all four.**
> The gate above is the state this assessment was written in and is kept as the
> record of why nothing was implemented. The answers are canonical in
> [PDR-19](../decisions/product/PDR-19-owner-side-issuance-decisions.md) as
> **OD-LIC-07** (perpetual grants `OWNER_ADMIN`-only, time-limited grants for an
> authorized `LICENSE_OPERATOR`, and per-user operator permissions configured by
> `OWNER_ADMIN` — superseding PDR-17's static matrix for that role),
> **OD-LIC-08** (**air-gapped offline signer**, B-2 Option B, with the four-step
> prepare → carry → sign → import-and-record flow, so issuance is *not*
> synchronous and the private key never reaches the Owner web process),
> **OD-LIC-09** (B-3 controlled operator registration of `installationId` read
> from the customer's Vardena page, with **source and confirmation recorded**)
> and **OD-LIC-10** (B-4 Option B, a dedicated durable artifact store outside
> PostgreSQL, superseding this README-quoted "no raw signed artifacts" clause for
> license artifacts).
>
> **The gate is now `BLOCKED — TECHNICAL DESIGN REQUIRED`, plus two product forks
> PDR-19 §5 records as undecided:** **F-1** whether "licenses whose limits the
> Owner has specified" means a persisted per-customer grant profile or operator
> entry bounded by per-user permission (different schemas, different UIs,
> different guarantees), and **F-2** the exact configurable permission set and
> its default for a new operator. OD-LIC-08 also introduces a **new artifact
> kind** — the signing request — whose format, grammar, versioning and
> validation are undefined; it is Owner-internal transport for an *unsigned*
> payload, so PDR-16's "no new canonicalizer / no `VLIC3`" constraints are not
> breached, but it must be designed before it can be built.
>
> Everything in §5 below ("what was deliberately not done") remains correct and
> in force: nothing was implemented, and no answer in PDR-19 retroactively makes
> an unsigned request an issued license. §6's ready-to-implement list is now
> resequenced by OD-LIC-08, because step 2 of that list is no longer a single
> synchronous transaction but a two-artifact offline round trip. U-1/OQ-74,
> OQ-75, OQ-78, OQ-81 and OQ-85 all remain OPEN; OQ-90 and OQ-91 gained a
> product direction and are not closed.
>
> **Second update (2026-10-19):** the Product Owner also answered the two forks
> PDR-19 §5 originally left open — F-1 is the hybrid optional per-customer limit
> profile, F-2 is "every operator-eligible permission configurable, fail-closed
> default, revocation blocks new signing requests only" — and the engineering
> design the gate asks for is delivered as
> [`owner-side-issuance-technical-design.md`](./owner-side-issuance-technical-design.md)
> (documentation only; nothing implemented). The gate is therefore
> `BLOCKED — TECHNICAL DESIGN REQUIRED` **awaiting review of that design**, with no
> product decision outstanding except the items its §15 lists as deliberately
> undecided.


**Baseline:** `main` = `510aca58ffdc7cb31b5d0b295d561a4db5d330fb` (merge of PR
#184). CI on that push commit (run `39298247056`) completed `success`. Local
branch `arena/59ce3185-vardena` started at the same SHA. One unrelated PR was
open at the start (#185, customer frontend table loading).

**Why this is a report and not an implementation:** the requested capability is
real end-to-end issuance — a signed artifact an actual customer runtime accepts.
Every path to it runs through a decision this repository has explicitly recorded
as *not made*, and in two cases has explicitly recorded as *forbidden to guess*.
Implementing around them would produce exactly the false-success surface the
instruction rules out: a button that mints a signature nobody authorized, under
a permission nobody granted, with a key nobody decided how to hold, naming an
installation nobody can prove exists.

---

## 1. Phase A — what actually exists on `main`

### 1.1 The signed protocol contract is complete and usable

This part is **not** a blocker. The format the customer runtime verifies is
fully specified, implemented, ratified and vector-covered:

| Item | Verified fact | Source |
|---|---|---|
| Artifact | `VLIC2.<base64url(canonical payload)>.<base64url(signature)>` | `backend/src/modules/licensing/domain/license-document.ts:49` |
| File envelope | `{ "format": "vardena-license", "fileVersion": 1, "document": "VLIC2.…", "keyId": … }`; envelope carries no licensing fact and unknown top-level keys are rejected | `license-document.ts:47-48`, `serializeLicenseFile` at `:321` |
| Signature | Ed25519 over the canonical payload bytes | ADR-0046 Decision 1 |
| Canonicalization | Ratified as normative: declared key order, sorted `modules`/`features`, raw UTF-8 non-ASCII, exact `U+0000`–`U+001F` escaping, no inter-token whitespace, `toISOString()` instants, conditional `deviceLimit` omission | [PDR-16 D-2(b)](../decisions/product/PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md); `docs/licensing/version-model-and-file-exchange.md` §2.1 |
| Conformance corpus | Deterministic vectors in `docs/licensing/vectors/` (`canonical/CAN-01…09`, `valid/OK-*`, `invalid/BAD-*`, `keys/*`, `rotation/ROT-*`), regenerated and diffed in CI | PDR-16 D-2(a) `VECTORS_ONLY`; `.github/workflows/ci.yml` (`npm run license:vectors` + `git diff --exit-code docs/licensing/vectors`) |
| Trust list | `LICENSE_SIGNING_PUBLIC_KEYS`, entries `keyId:<material>` or bare; bare keys get a derived id `sha256-<16 hex>`; duplicate ids rejected; several keys trusted at once | `license-document.ts:160-236` (`parseTrustedLicenseKeys`, `hashKeyMaterial`) |
| Public key format | Ed25519, PEM or base64 DER (SPKI) | `license-code.ts:99` (`parsePublicKey`) |
| Private key format | base64 DER (PKCS8), supplied by the operator, never persisted by the application | `backend/src/tools/development-license-authority.ts:44-62` |
| Working issuer | `issueLicenseFile` / `issueLicenseDocument` produce a real, verifiable artifact today | `development-license-authority.ts:246-275` |
| Payload semantic validation | Shared by issuing and verification (`assertPayload`): limits must be a positive integer or `null`; `validUntil` must be strictly later than `validFrom`; modules must be known and non-repeating | `license-code.ts:401-447` |
| Module catalog | `accounting`, `documents`, `inventory`, `organization`, `rbac`, `users`, `workflow` | `license-code.ts:81-89` (`KNOWN_MODULE_CODES`) |
| Perpetual vs time-limited | Already expressible: `validUntil = null` means perpetual, the end is exclusive | `license-document.ts:88-90`; ADR-0046 Decision 2 |

The existing issuer refuses `NODE_ENV=production`
(`backend/src/issue-development-license.ts:58-61`) and is asserted absent from
the built customer `dist/` and the real customer production image by CI
(`scripts/check-production-artifacts.py`, `scripts/check-owner-isolation.py`).

### 1.2 The Owner application is deliberately observational

| Area | Verified state | Source |
|---|---|---|
| Permissions | Exactly eight: `customers.view`, `customers.write`, `users.manage`, `audit.view`, `audit.archive`, `operations.view`, `operations.record`, `replacements.authorize`. **No issuance permission exists.** | `owner-licensing/backend/src/domain.ts:5-38` |
| Roles | Two: `OWNER_ADMIN`, `LICENSE_OPERATOR`; unknown/superseded roles receive `[]` | `domain.ts:3`, `:20-38` |
| License routes | `POST /api/v1/operational-records/license-observations` records an **externally observed** issuance. No `/licenses` route, no issuance route, no download route. | `owner-licensing/backend/src/app.ts:768-783`; route inventory |
| Every response | States `cryptographicVerification = NOT_IMPLEMENTED`, `signedArtifactProduced = false`, `customerServerContacted = false` | `owner-licensing/README.md` (API summary); `src/operations.ts` |
| Operation kinds | `LICENSE`, `SERVER_REPLACEMENT` only. No cancellation, renewal, revocation or recovery state is defined, so none is implemented. | `domain.ts:316`; `migrations/002-manual-operations.sql` |
| Signed-license validity | **Deliberately not modelled in Owner.** `observed_validity_end` is "the validity end the OPERATOR RECORDED having seen, and nothing more"; `recordedOn` is derived from `created_at`, never an issuance date. | `owner-licensing/backend/migrations/005-contract-and-activation-dates.sql` (header comment) |
| Artifact storage | **"No arbitrary metadata JSON, customer secrets, contact/CRM/billing data or raw signed artifacts."** | `owner-licensing/README.md:148-149` |
| Frontend | A license **observation** form (`recordLicenseObservation`). No issuance form, no artifact, no download control. | `owner-licensing/frontend/src/features/operations/operation-forms.tsx:107-122` |
| Local checks on this baseline | `npm run lint` 0 warnings/0 errors; `npm run typecheck` clean; `npm test` 72 tests passed (4 files) | executed 2026-10-19 in `owner-licensing/backend` |

### 1.3 `owner.signing_keys` holds no key material — this is the single most misread fact in this area

Migration `006-signing-key-tracking.sql` and `src/signing-keys.ts` (PR #181,
OQ-74) are frequently mistaken for signing capability. They are not:

- The table columns are `id`, `label`, `status`, `status_detected_at`,
  `status_reason`, `evidence_ref`, `notes`, `created_at`, `updated_at`,
  `created_by`, `updated_by`. **There is no public-key column, no private-key
  column, no algorithm column and no key-format column**
  (`grep -n "public_key\|private_key\|key_material\|algorithm" 006-signing-key-tracking.sql` → no match).
- The migration header states its own scope: *"OQ-74: administrative metadata
  only. No keys, signatures, trust rollout or automatic license invalidation."*
- `id` is an **opaque operator-chosen label**, 1–120 characters, and the column
  `CHECK` plus `signingKeyId()` (`domain.ts:365-373`) *reject* anything
  containing `PRIVATE KEY`, `-----BEGIN `, `VLIC1`, `VLIC2`, `VDEA1`, `VDRQ1`
  or `VDRP1`. The schema is built to make key material unstoreable.
- `src/signing-keys.ts:20-24` states it directly: *"The Owner app is
  observational (PDR-17: cryptographic issuance is 'not implemented' here) …
  The customer runtime remains the authority for actual signature
  verification."*

**Consequence for issuance:** an Owner `signing_key_id` is not cryptographically
bound to anything. It cannot be resolved to a public key, cannot be checked
against the customer's `LICENSE_SIGNING_PUBLIC_KEYS` trust list, and cannot
select a private key. Issuance needs a real key identity; the existing column is
a review label. Conflating them would let an operator record a key that does not
exist, or sign with a key the customer does not trust, and both would look
successful.

### 1.4 Product decisions that ARE settled and must be honoured as-is

These need no further approval and constrain any future implementation:

| Decision | Content | Source |
|---|---|---|
| License types | Perpetual and time-limited; `validUntil = null` is perpetual, never a synthetic default expiry | ADR-0046 D-2; `license-document.ts:88-90` |
| Activation start | Equals the issuance day, **mandatory and not editable**; past and future starts are prohibited; a signed artifact claiming either is rejected | [PDR-18 §1.2](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md), §1 "Temporal and issuance constraints" |
| Trusted time | Issuance day comes from the canonical trusted **server-side** business-date policy, never a client-supplied date or browser clock | PDR-18 §1; `docs/datetime.md` §0 |
| Activation end | Set independently by the issuer; must satisfy the existing interval convention and be **later than** the activation start | PDR-18 §1.3; enforced by `assertPayload` (`validUntil <= validFrom` → `validity` error) |
| Contract dates ≠ validity dates | Commercial contract start/end are separate administrative data, may legitimately precede issuance, and never rewrite technical validity | PDR-18 §1.1/§1.4; `migrations/005` |
| Customer code | PDR-14 grammar, case-sensitive, unique; `customerId` and `customerCode` both explicit and valid; never derived from `customerName`, never defaulted to each other | [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md); ADR-0046 L-06 addendum; `owner-licensing/backend/src/domain.ts` (`customerCode`) |
| No second approver | No mandatory second-person approval and no pending-approval workflow | PDR-17 "Approved boundary" |
| Immediate issuance | Consistent with the above: a confirmed operation either fully succeeds or must not claim success | PDR-17; instruction §3.5 |
| Owner boundary | Standalone app, own database/credentials/migrations, no customer import/replication/cross-boundary FK, no customer→Owner callback, no microservice, no CRM/accounting/billing | ADR-0048 Phase 1 acceptance addendum; PDR-17 |
| Installation identity | Import never creates, recreates or adopts an installation identity; the document must name an identity that already exists | ADR-0046 Decision 6 |
| Device limit | Omission is **UNSPECIFIED** and grants no device capacity; never unlimited by absence | PDR-15 §4; `development-license-authority.ts:238-241` |
| Calendar/UI | Persian/Jalali-first, Persian digits for ordinary Iranian-facing presentation; canonical API/protocol values stay ASCII | PDR-17; ADR-0048 date-source addendum; AGENTS.md |

PDR-18 §1.2 and §1.3 therefore already answer the date half of the requested
form. The blockers below are not about dates.

---

## 2. Phase B — why the four gates fire

The instruction's §5 gate asks two questions before sensitive implementation:
is there an explicit issuance permission, and is the cryptographic contract
sufficient for real issuance? Both answers are no, for recorded reasons. Two
further blockers were found during verification that the instruction did not
anticipate.

---

## 3. Evidence that guessing is explicitly forbidden

This is not a case of silent absence that engineering may fill:

- **OQ-75 registry row:** *"**No new signing, custody, or recovery permission is
  inferred**; exact mapping must be explicit and unknown actions deny."*
- **PDR-11 §4.2:** *"Exact permissions for each role are **OPEN** (§15, U-5)."*
- **PDR-11 §15 U-5:** *"No inferred signing or recovery grants."*
- **PDR-17:** *"Define and test the exact endpoint/permission mapping **before**
  implementation."* Its approved matrix lists *"Cryptographic issuance, signed
  receipt, deactivation proof, client-device replacement, revocation/recovery"*
  as **not implemented** for both roles.
- **Phase 0 readiness D-6:** *"Do **not** build a permission matrix before U-5
  is answered; guessing it produces a matrix that has to be unwound."* And:
  *"**Product Owner approval required?** **YES — U-5 is an explicit Owner
  decision.**"*
- **Phase 0 readiness D-5:** *"**U-1 must be answered before any production key
  is generated**, because the compromise policy determines whether a key
  hierarchy and revocation instrument are needed at all."* And: *"**Product
  Owner approval required?** **YES — blocking.**"*
- **ADR-0048** (three separate places): *"no operational signer or signed
  lifecycle protocol is authorized"*; *"U-1 gates production key generation"*;
  *"This boundary grants no new key custody or signing design."*
- **PDR-17:** *"Compatible incident response/custody/trust design remains
  deferred: **no production key generation, custody implementation or
  signer**."*
- **`owner-licensing/README.md`:** *"No key custody or U-1 compromise response
  is implemented. **No production signer is permitted in this phase.**"*
- **OQ-85 registry row:** *"**No production issuer, custody, remote access or
  deployed-service claim is made.**"*

---

## 4. The four blocking decisions

### B-1 — Which permission authorizes issuance, and which role holds it?

**Blocking question.** Real issuance needs an explicit, server-enforced
permission. None exists (§1.2). `customers.write` and `operations.record` must
not be reused as issuance authority: `operations.record` is held by
`LICENSE_OPERATOR` and today authorizes only *observations* whose responses say
`signedArtifactProduced = false`; silently widening it would grant signing
authority through a permission whose recorded meaning is the opposite, and would
change `LICENSE_OPERATOR`'s effective power without any approval.

**Evidence.** `domain.ts:5-38`; PDR-17 matrix; OQ-75 row; PDR-11 §15 U-5;
D-6 above.

**Options.**

| Option | Content | Security consequence |
|---|---|---|
| **A** | New `licenses.issue` granted to `OWNER_ADMIN` only | Smallest blast radius; consistent with `replacements.authorize` being admin-only. Removes issuance from the routine operator role, which may conflict with PDR-17's prose that a License Operator "may perform license operations such as issuance … within explicit granted permissions". |
| **B** | New `licenses.issue` granted to both roles | Matches PDR-17's prose about the operator role. Any operator account becomes able to mint an artifact that is **irrevocable in practice** (B-5), with no second approver permitted (PDR-17). |
| **C** | Split: `licenses.issue` (time-limited) for both roles, a separate `licenses.issue.perpetual` for `OWNER_ADMIN` only | Concentrates friction on the irreversible case; this is D-6's "B as the target" without adding mandatory dual control. Needs two permissions and two UI affordances. |
| **D** | Reuse `operations.record` | **Not recommended.** Contradicts the recorded meaning of the permission and OQ-75's "no new signing … permission is inferred" by achieving the same result implicitly. Listed only so the rejection is on the record. |

**Also required with any option:** whether issuing a *renewal* and issuing a
*first* license are the same permission. PDR-18 §9 (OD-LIC-06) gives renewals
distinct semantics (`renewsOperationId`, boundary hand-over), and PDR-12 gives
explicit supersession distinct term-changing power. A single `licenses.issue`
would authorize all three.

**Files affected once decided:** `owner-licensing/backend/src/domain.ts`
(`Permission`, `permissions()`), `src/app.ts` (routes + denial audit),
`migrations/007-*.sql` if a DB-level guard is wanted, `src/bootstrap.ts`,
frontend `features/permissions/use-permissions.ts`, plus
`owner-licensing/README.md` and the PDR-17 matrix.

---

### B-2 — Where does the Owner hold the private key, and who may use it?

**Blocking question.** U-1 / OQ-74 is OPEN and explicitly gates production key
generation. There is no approved custody mechanism, and **the only mechanism
this codebase actually supports is the one the record rejects for production.**

The dev issuer reads `LICENSE_SIGNING_PRIVATE_KEY` from the environment
(`issue-development-license.ts:81-85`). Phase 0 readiness D-5 evaluates exactly
that as Option C and records it **"Rejected: this is the development model;
PDR-11 §4.4 and the OQ-83 plan both explicitly reject it as production
custody."** So an Owner signer wired to an environment variable is not a
conservative default — it is a recorded rejection. D-5's remaining options are
A (cloud KMS/HSM with per-operator IAM) and B (air-gapped offline signer), and
D-5 recommends B first, moving to A. Neither is decided, and each implies a
different Owner deployment shape, a different API boundary, and a different
answer to "can the Owner web process sign at all".

Note the structural consequence of Option B: an air-gapped signer means the web
application **cannot** sign inside the request. "Confirm and download the file"
would become "produce a signing request, have a human carry it to the signer,
import the signed artifact" — a different product flow from the one requested,
and one that must be chosen deliberately rather than discovered later.

**Evidence.** PDR-11 §4.4 and §15 U-1; §21 row 8 (`OPEN`); OQ-74 row; D-5;
ADR-0048; `owner-licensing/README.md` "No production signer is permitted in
this phase"; §1.3 above (no key material can be stored in Owner).

**Options.**

| Option | Content | Security consequence |
|---|---|---|
| **A** | Cloud KMS/HSM, per-operator IAM, signing call from the Owner API | Key never exportable; access logged; rotation managed. Requires a new outbound network path from Owner (conflicts with a fully air-gapped issuance process), a vendor dependency and cost. U-1 must still be answered, because the compromise policy determines whether a key hierarchy and a revocation instrument are needed at all. |
| **B** | Air-gapped offline signer; Owner prepares an unsigned issuance request and imports the signed artifact | Strongest isolation; no network attack path; matches the already-mandated offline file exchange. Changes the product flow (no synchronous download); single-machine availability risk; physical security becomes the control; harder dual control. |
| **C** | Environment variable / file on the Owner application host | **Explicitly rejected as production custody** by D-5 and PDR-11 §4.4. Listed only to record the rejection. It is also the model that makes a compromised Owner host a license-forgery primitive. |
| **D** | Defer: do not enable issuance until U-1 is answered | Zero new risk. The capability stays unavailable, as it is today. |

**Sub-questions that must be answered with the option:** who may trigger a
signature (a role, or the issuance process only — PDR-11 §13.2 says no role
gets routine key access beyond the issuance process); rotation cadence and how a
new public key reaches customer trust lists **before** first use
(`ROT-01…ROT-06`); whether the Owner `signing_keys.id` label becomes bound to a
real trust-list key id (`sha256-…` derived or explicit `keyId:`) so a key can be
validated as ACTIVE and compatible before signing; and what "fail closed" means
operationally when no usable key is configured.

**Files affected once decided:** a new Owner signing module and its
configuration boundary (`src/config.ts`), `owner-licensing/backend/.env.example`,
`README.md` (production/deployment + role-grant sections), CI secret handling,
and — if the artifact is produced outside the request — the whole flow in §11 of
the instruction.

---

### B-3 — What is the authoritative source of `installationId` at issuance?

**Blocking question, found during verification; not anticipated by the
instruction.** A `VLIC2` payload cannot be built without an `installationId`,
and it is not a free label:

- `assertPayload` validates it as an identifier (`license-code.ts:405`).
- ADR-0046 Decision 6: *"Import never creates, recreates or adopts an
  installation identity; the document must name the identity that already
  exists."* A wrong or invented value therefore produces an artifact the
  customer **refuses**, or worse, one that binds a license to the wrong server.
- The real identity is a server-generated ULID in `licensing.installations`,
  owned by the customer backend; no client, cookie, header or request can choose
  or influence it (`backend/src/modules/licensing/domain/installation.ts:1-30`).

The Owner has no authoritative copy of it:

- `owner.operational_records.installation_reference` is `varchar(200)` with a
  permissive shape check `^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$`
  (`migrations/002-manual-operations.sql`). That grammar admits hostnames,
  URLs and free text; it is **not** the ULID grammar, and the column is
  documented as an *observed reference*.
- Migration `005` states that customer-side signed-license validity "is owned by
  the customer runtime and is deliberately **NOT** modelled here".
- ADR-0048 Decision 5: *"Request fields are claims, never identity."* The
  Owner-side design §3.6 step 1 says to "resolve the customer, contract and
  target installation from the **Owner** record" — but no Owner record holds a
  verified installation identity to resolve.

So there is a genuine hole between "the Owner must resolve the target
installation from its own record" and "the Owner's record holds only an
operator-typed reference". It cannot be closed by validation alone, and it
cannot be closed by trusting operator input, because the failure mode is a
**validly signed artifact bound to the wrong server** — the signature cannot
detect that.

**Options.**

| Option | Content | Consequence |
|---|---|---|
| **A** | Add an authoritative Owner installation-identity model (own table, ULID-validated, one active identity per customer server, lifecycle tied to the existing replacement observations) and issue only against it | Correct and auditable; the Owner record becomes the system of record ADR-0048 D-4 already describes. Requires a new migration, a new identity model, and a decision on how an identity is *first* established in Owner (operator transcription of what the customer server reports? an intake artifact?) — which is itself unapproved. |
| **B** | Require the operator to enter the exact customer `installationId`, validate it as a ULID, and record it as a claim | Small change; but a transcription error still yields a validly signed, wrongly bound artifact. Would need a confirmation step and a correction story, and there is no revocation instrument (B-5). |
| **C** | Derive the installation from an existing license observation's `installation_reference` | **Not viable.** The column's grammar does not guarantee a ULID, and reusing an observed reference as signed identity is precisely what ADR-0048 D-5 forbids. |
| **D** | Defer issuance until an installation-intake contract exists | Zero new risk; capability stays unavailable. |

**Related and unasked:** PDR-18 §1.2 fixes the activation start to the issuance
day. For a *first* license this means the customer server must already have
self-provisioned its identity before issuance, and the operator must have
obtained it out of band. That ordering is consistent with
`installation.ts` ("that is precisely the value an operator must quote to obtain
a license"), but no approved Owner flow captures it. The answer to B-3 should
state where that value comes from.

---

### B-4 — May the Owner store the signed artifact, and how is re-download served?

**Blocking question, found during verification.** The requested capability needs
a real downloadable file and (per instruction §7) "the information needed to
re-download a valid artifact, according to the existing storage policy". The
existing storage policy says the opposite:

> *"No arbitrary metadata JSON, customer secrets, contact/CRM/billing data or
> **raw signed artifacts**."* — `owner-licensing/README.md:148-149`

Meanwhile ADR-0048 Decision 4 makes the Owner store *"the system of record for
customer, contract, grant and issuance history"*. Those two statements are in
tension for this feature, and the tension is unresolved: "issuance history" can
mean the *facts* of an issuance (dates, limits, key id, operation id, artifact
hash) or the *artifact itself*. The choice determines whether a download button
can exist at all, and whether a lost file is recoverable.

**Options.**

| Option | Content | Consequence |
|---|---|---|
| **A** | Store facts + SHA-256 of the artifact only (mirrors the customer side, which persists `documentHash` and never the armored document) | Consistent with the current README wording and with `license-document.ts`'s own persistence rule. **No re-download is possible**; a lost file requires re-issuance, which under PDR-18/OD-LIC-06 is a renewal or supersession, not a copy. The instruction's §11.1 download button then works once, at issuance time only. |
| **B** | Store the artifact in a dedicated durable file store outside PostgreSQL (the pattern already built for the audit archive: `OWNER_AUDIT_ARCHIVE_DIR`, write-once `0o444`, `fsync`, read-back-verified, hash-chained manifest) | Enables controlled re-download and matches existing Owner infrastructure. Requires an explicit reversal of the README's "no raw signed artifacts" rule, a new storage root, a retention/backup decision, and a threat assessment: a readable archive of signed licenses is a disclosure surface (customer identities, limits, terms) even though it cannot be forged. |
| **C** | Store the artifact in the database | Simplest; contradicts the README rule and puts signed customer grants inside the same backup lifecycle as everything else. Also the largest disclosure surface per backup copy. |

**Also required with any option:** the download authorization rule (license id
only, never a client-supplied path — the instruction §10 is right that path
traversal must be impossible by construction), the filename and content type,
and whether a re-download is an audited event (instruction §9 asks for it "if
possible under the current audit policy"; `owner.audit_events` supports it).

---

### B-5 — Risk the Product Owner must accept explicitly, not a question

Recorded here because it changes the weight of B-1 and B-2 rather than adding a
fifth gate.

A signed artifact is **irrevocable in practice today**. There is no revocation
instrument: OQ-78 remains OPEN, and PO-78-01 (PDR-18 §11) permits offline
revocation of a perpetual license as *policy* while stating plainly that *"No
implementation, schema, migration, endpoint or artifact type is authorized or
claimed by this section."* Phase 0 readiness D-6 draws the conclusion: *"a
signed artifact is irrevocable in practice today: there is no revocation
instrument (OQ-78), so a wrongly issued perpetual license cannot be withdrawn —
which is the strongest argument for dual control"* — and PDR-17 forbids
mandatory second-person approval. Risk R-8 in the same record is logged as
**"Unmitigated by design; blocked on Owner decision."**

So enabling one-click perpetual issuance (instruction §3.1, §3.5) creates an
irreversible commercial grant with no withdrawal path and no second pair of
eyes. That combination is a product risk decision, not an engineering detail.
Option C in B-1 is the only listed mitigation that does not violate PDR-17's
no-mandatory-second-approver rule.

---

## 5. What was deliberately NOT done

Each of these would have made the PR look further along while making the system
less trustworthy:

1. **No signer, no key handling, no `LICENSE_SIGNING_PRIVATE_KEY` reader in
   Owner.** Blocked by B-2; the only available mechanism is a recorded
   rejection. No key was generated, no test key was placed where it could be
   mistaken for a production one, and no key material appears in this document.
2. **No issuance endpoint and no issuance permission.** Blocked by B-1 and by
   OQ-75's "no new signing … permission is inferred". No wildcard, no implicit
   grant, no reuse of `operations.record` or `customers.write`.
3. **No `007-*.sql` migration.** Every column an issuance ledger would need
   (installation identity, artifact storage, key binding) depends on B-2/B-3/B-4.
   Writing the table first would lock in answers that are not made.
4. **No issuance UI, no download button, no license list presenting
   observations as issued licenses.** Instruction §11 forbids a placeholder or
   inert control, and §11.1's "download the real file" cannot be honoured. A
   list built on `/operational-records?kind=LICENSE` would render
   `OPERATOR_OBSERVED` rows — whose own responses say
   `signedArtifactProduced = false` — in a screen labelled "licenses", which is
   the exact false-success surface the instruction rules out.
5. **No duplicated module catalog or second canonicalizer in Owner.** PDR-16
   D-2(a) chose `VECTORS_ONLY`: no shared runtime package, no dependency from
   Owner to the customer runtime. Copying `KNOWN_MODULE_CODES` into Owner
   without an approved conformance path is risk R-3 (a second implementation
   producing different bytes → every signature fails in the field). An
   issuance-input validator wired to nothing would also be dead code, which the
   instruction forbids.
6. **No test written against a mocked signer.** Instruction §12.3 is explicit
   that a substitute verifier is not sufficient, and §12 forbids claiming an
   unrunnable test as proof. There is no key, so there is no honest positive
   test to write yet.

---

## 6. What becomes implementable immediately once B-1…B-4 are answered

Recorded so the answer converts to work without another assessment round. In
dependency order, with the settled decisions of §1.4 already fixed:

1. **Issuance ledger** (`007-*.sql`, additive, fresh- and populated-database
   safe, no backfill of invented facts): license identity, customer FK,
   `customer_code`, license type derived from `validUntil IS NULL`, technical
   `valid_from`/`valid_until`, limits and module/feature entitlements, signing
   key id + protocol/format version, lifecycle status, server-side issuance
   instant and issuing actor, `operationId`, artifact digest and storage
   reference per B-4. Reuses the existing append-only audit and the
   `clock_timestamp()` convention.
2. **Server-side issuance operation**: strict allowlist validation (the existing
   `object()` helper already rejects unknown fields), customer resolve-or-create
   under lock with PDR-14 code validation, payload construction exactly per
   §1.1, signature per B-2, verification of the produced file with the real
   verifier before any success response, then record + audit in one
   transaction. Instruction §8's two-resource atomicity problem (PostgreSQL
   transaction vs. a file write) is real and must be designed with staging plus
   cleanup, not claimed away — the Owner audit archive already demonstrates the
   write-once/read-back-verified pattern to follow.
3. **Download**: license-id-scoped, server-controlled, no client-supplied path,
   safe filename, correct content type, audited.
4. **Persian RTL UI**: list with search/pagination on the existing 50-row
   pattern, create form with existing-customer selection and in-flow creation,
   perpetual vs time-limited with the end-date field shown only when
   time-limited, organization/user caps, module selection from the real catalog,
   a summary review step, explicit final confirmation, Jalali dates via the
   staged canonical date foundation, double-submit prevention, pending state,
   success only on a real successful response.
5. **Tests**: the instruction's §12.1/§12.2 lists are directly writable once a
   real key exists in an isolated test fixture, and §12.3 is satisfiable by
   feeding the Owner-produced artifact to the customer's real
   `verifyLicenseDocument` path plus the published vectors — no mocked verifier.

None of this is started, because each item embeds an answer to B-1…B-4.

---

## 7. Verification performed for this assessment

| Check | Command / method | Result |
|---|---|---|
| Baseline SHA | `git rev-parse origin/main`; `gh api repos/MR-AliEsmaeili/Vardena/commits/main` | `510aca58ffdc7cb31b5d0b295d561a4db5d330fb`, both agree |
| CI on baseline | `gh api …/actions/runs?branch=main` | run `39298247056` `completed / success` |
| Open PRs | `gh pr list --state open` | #185 only (unrelated, customer frontend) |
| Owner lint | `npm run lint` in `owner-licensing/backend` | 0 warnings, 0 errors (18 files, 96 rules) |
| Owner typecheck | `npm run typecheck` | clean |
| Owner unit tests | `npm test` | 72 passed / 4 files (`unit`, `domain-operations`, `audit-query`, `signing-keys`) |
| Key-material absence | `grep -n "public_key\|private_key\|key_material\|algorithm" owner-licensing/backend/migrations/006-signing-key-tracking.sql` | no match |
| Issuance permission absence | `owner-licensing/backend/src/domain.ts:5-38` read directly | eight permissions, none for issuance |
| Issuance route absence | route inventory of `src/app.ts` | no `/licenses`, no issuance, no download route |

**Not run (deliberately, per AGENTS.md and the instruction §14):** heavy Owner
integration (`npm run test:integration`, needs a dedicated `owner_test`
PostgreSQL), customer backend/frontend suites, Docker image builds, vector
regeneration, migration deployment. Nothing in this document is a claim about
those. No integration or E2E test was executed locally.

---

## 8. Registry effect

Two genuinely ambiguous items found in §4 had **no** open-question row, so they
are registered per AG-09 (a stable id, referenced from the affected docs, no
invented rule, no adopted assumption):

- **OQ-90** — authoritative installation identity for Owner-side issuance (B-3).
- **OQ-91** — Owner-side signed-artifact storage and re-download policy (B-4).

No existing row changed status. **OQ-74, OQ-75, OQ-78 and OQ-85 all remain
OPEN.** No decision is attributed to the Product Owner by this document.

---

## 8.3 Addendum — security and coherence review of the technical design (2026-10-20)

**Status after this addendum: `BLOCKED — TECHNICAL DESIGN REQUIRED`, awaiting design
approval. Still nothing is implemented.**

The technical design this assessment's gate asked for was delivered in
[`owner-side-issuance-technical-design.md`](./owner-side-issuance-technical-design.md)
and then reviewed for security and internal coherence. The review **corrected three
defects in the design document itself**; it did not add capability, and it did not
change any decision recorded in this assessment or in PDR-19.

**RV-1 (High) — the request was authenticated only after signing.** The offline
signer's nine validation checks were all **structural**, so a well-formed but
substituted request passed every one of them and was signed with the authority key.
The design's §3.6 now models ten alterations (T-1…T-10), including re-targeting
another real customer, replacing `installationId` with another valid ULID, raising
limits, adding modules, and **nulling `validUntil` — which converts a time-limited
request into a perpetual license and crosses the boundary B-1 / OD-LIC-07 reserves to
`OWNER_ADMIN`, using no key, no credential and no Owner access**. The assessment's
B-1 finding was about *who may authorize*; RV-1 is the transport-side counterpart:
*how does the signer know it is signing what the Owner authorized*. Refusal at Owner
import was insufficient, because a valid authority signature already exists
(OQ-78 OPEN ⇒ irrevocable in practice) and an artifact handed **directly to the
customer** verifies against `LICENSE_SIGNING_PUBLIC_KEYS` without the Owner's import
path ever running. Detection therefore moved **before the private key is read**
(design §4.2 check 10).

**RV-2 (Blocking defect) — the tamper check could never pass.** The design compared
the *request* payload's canonical bytes against the *`VLIC2`* payload's. The two have
different field sets (`v` 1 vs 2, `kind` `SERVER_LICENSE_ISSUANCE_REQUEST` vs
`SERVER_LICENSE_VERSION`, request-only `requestId`/`requestedAt`/`requestedByUserId`/
`deviceLimitSpecified` vs signed-only `issuedAt`), so the digests differ for an
**untampered** round trip and every legitimate import would have been refused.
Fail-closed, so not a security hole — but it would have surfaced only in integration,
and the obvious "fix" would have been to weaken the one control standing between the
operator's file and the authority key. Replaced by two digests with two jobs. A
related factual error was corrected: `supersedesOperationId` is **always present** in
the canonical bytes and is *not* omitted like `deviceLimit`; verified against
`canonicalizeLicenseVersion` (`license-document.ts:272-303`) and a census of all 23
corpus files, which also showed all six `VLIC2` vectors carry all 18 fields and
**none** exercises the omission rules — an independent reason the golden literals of
design §13.2 are required, and a concrete instance of readiness risk **R-3**.

**RV-3 (High) — two self-contradictions in the data model.** `user_permission_grants`
claimed intersection semantics (PDR-19 §5.2) while also stating that non-issuance
access "follows the role until `OWNER_ADMIN` narrows it", which is union and silently
reverses the decided mechanism for the four permissions the role holds today. That
sentence is withdrawn. And `customer_limit_profiles` declared `customer_id` **unique**
while also declaring a `RETIRED` status whose history "must remain readable, because
past issuances reference them" — under a column-level `UNIQUE` only one row per
customer can ever exist, so a retired profile can never be replaced and the only
recovery from a mistaken retirement is a data fix that leaves every future issuance
for that customer **unbounded**, since F-1's no-profile branch is the more permissive
one. Corrected to a partial unique index on `status = 'ACTIVE'`. Design §6 is now a
definitive matrix for both roles and every permission, and the three grant states (no
row / active / revoked) are defined separately.

**Three questions the review raised are Product Owner decisions and were stopped, not
chosen:** **OQ-92** (adopt an Owner-held *request-signing* key — design §4.4 option
O-B, documented as stronger but requiring a new key in the Owner web process, a second
signed format and a custody policy while U-1/OQ-74 is OPEN; and what the acceptable
out-of-band channel is, and whether the confirmation value may ever be shortened),
**OQ-93** (the default effective access of a new operator's four existing permissions
— R-1 vs R-3), and **OQ-94** (limit-profile lifecycle — may retirement be permanent,
and should a profile change block an in-flight request). Engineering adopted only what
existing decisions already permit: the out-of-band digest confirmation of design §4.4
**O-A**, which needs **no new key, no signed-format change, no canonicalization
change, no vector change and no customer-side change**.

**Unchanged by this addendum:** every finding and gate in §§1–8 above; all four PDR-19
decisions and both fork answers; the signed `VLIC2` format, canonicalization rules,
vectors and separation boundary. No signer, key, permission, migration, endpoint,
artifact, DTO or UI exists. **No OQ was closed.**

---

## 9. Related records

- [ADR-0046 — signed license documents and version lifecycle](../adr/0046-signed-license-documents-and-version-lifecycle.md) (Decisions 1, 2, 6, 7, 9)
- [ADR-0048 — Owner-side licensing separation boundary](../adr/0048-owner-side-licensing-separation-boundary.md) (Decisions 4, 5; Phase 1 acceptance addendum)
- [PDR-11 — licensing product requirements](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) (§§4.2, 4.4, 13.2, 15 U-1/U-5, 21)
- [PDR-14 — licensing customer code](../decisions/product/PDR-14-licensing-customer-code.md)
- [PDR-16 — canonical byte contract and conformance vectors](../decisions/product/PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md)
- [PDR-17 — Owner web application Phase 1](../decisions/product/PDR-17-owner-web-application-phase-1.md) (role matrix; "no production key generation, custody implementation or signer")
- [PDR-18 — commercial dates and lifecycle decisions](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md) (§§1, 9, 11)
- [Owner-side system architecture](../licensing/owner-side-system-architecture.md) (§§2.4, 3.5, 3.6)
- [Version model and file exchange](../licensing/version-model-and-file-exchange.md) (§2.1 canonical bytes, §2.3 trust list)
- [Owner-side Phase 0 readiness](./licensing-owner-side-phase-0-readiness.md) (D-5, D-6, R-2, R-3, R-7, R-8)
- [OQ-74 signing-key compromise response](./licensing-oq-74-signing-key-compromise-response.md)
- [OQ-78 revocation and recovery assessment](./oq-78-revocation-recovery-assessment.md)
- [Open questions registry](../open-questions.md) (OQ-74, OQ-75, OQ-78, OQ-85, OQ-90, OQ-91)
- [Owner licensing README](../../owner-licensing/README.md)
