# PDR-19: Owner-side license issuance — permission split, offline signing custody, installation identity and artifact storage

- **Date:** 2026-10-19
- **Authority:** Product Owner Ali Esmaeili, answering the four blocking questions B-1…B-4 of [the issuance assessment](../../tasks/licensing-owner-side-issuance-blocked-assessment.md) §4.
- **Status:** **Decided — product policy approved for D-1…D-4 below, and the two forks of §5 (F-1 limit model, F-2 configurable permission scope/default/revocation) were answered by the Product Owner the same day; §5 records the answers and their consequences. No implementation, schema, migration, endpoint, artifact or UI is claimed or authorized as delivered by this record.**
- **Decision ids:** **OD-LIC-07** (permission split and per-operator grants), **OD-LIC-08** (air-gapped signing custody and issuance flow), **OD-LIC-09** (installation identity registration), **OD-LIC-10** (signed-artifact storage).
- **Scope:** Owner-side issuance only. Changes no signed byte format, no canonicalization rule, no vector, no customer runtime behaviour and no `VLIC1`/`VLIC2` verification semantics.
- **Companions:** [PDR-14](./PDR-14-licensing-customer-code.md) · [PDR-16](./PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md) · [PDR-17](./PDR-17-owner-web-application-phase-1.md) · [PDR-18](./PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md) · [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) · [ADR-0048](../../adr/0048-owner-side-licensing-separation-boundary.md) · [open questions](../../open-questions.md)

---

## 0. Effect on the gate recorded in the assessment

The assessment gate was **`BLOCKED — PRODUCT OWNER DECISION REQUIRED`** on four
decisions. This record answers all four at product-policy level. The gate
therefore moves to:

> **`BLOCKED — TECHNICAL DESIGN REQUIRED`**.

**Update (2026-10-19, later the same day):** the two product forks this record
originally left open in §5 are now **answered** — F-1 is the hybrid optional
per-customer limit profile (§5.1) and F-2 is "every operator-eligible permission
configurable, fail-closed default, revocation blocks new signing requests only"
(§5.2). The data model is therefore fixed and technical design is the only
remaining gate.

That is a real change and not a formality. OD-LIC-08 in particular replaces the
"instant issuance" flow the assessment was written against with a four-step
offline-signing flow, and OD-LIC-07 introduces per-user permission grants, which
is a change to the approved two-role authorization model of PDR-17 rather than an
addition to it. Both need engineering design before code.

---

## 1. OD-LIC-07 — issuance permission split and per-operator configurable grants (B-1)

### Product Owner's instruction, transcribed

> یوزر مالک : در بخش صدور لایسنس – مالک تعیین کند که مشتری چه محدودیت هایی دارد
> مثلا (لیمیت یوزر – ماژول ها و... ) توسط مالک تعین شود . همچنین لایسنس های
> دائمی فقط توسط مالک باید تولید شود . یوزر دوم اپراتور مجوز بتواند لایسنس هایی
> بسازد که مالک محدودیت هایش را مشخص کرده . همچنین هر یوزری که در سیستم مالک
> وجود دارند باید در یوزر خود مالک قابلیت تعیین دسترسی کاربر دوم که اپراتور
> مجوز هست را داشته باشد که در آنجا تعیین کند اپراتور مجوز چه دسترسی هایی داشته
> باشد .

### What is decided

1. **Perpetual licenses are issued by `OWNER_ADMIN` only.** A time-limited grant
   (`validUntil` set) may be issued by an authorized `LICENSE_OPERATOR`. This is
   the assessment's B-1 **Option C** — the only listed option that concentrates
   friction on the irreversible case without adding the mandatory second-person
   approval PDR-17 forbids.
2. **The Owner (`OWNER_ADMIN`) determines the customer's limits** — user limit,
   modules and the other constraints the license contract supports.
3. **A `LICENSE_OPERATOR` may create licenses within what the Owner has
   established.** The exact mechanism is **§5 fork F-1**, not decided here.
4. **`OWNER_ADMIN` can configure, per user, which permissions a
   `LICENSE_OPERATOR` holds.** Owner-user administration therefore gains a
   per-user grant surface managed by `OWNER_ADMIN`.

### Consequences carried into design

- PDR-17's static matrix (`permissions(role)` returning a fixed list per role) is
  **superseded for `LICENSE_OPERATOR`**: that role's effective permissions become
  the intersection of the role and the explicit per-user grants. `OWNER_ADMIN` is
  not made configurable by this decision.
- The existing guarantees must survive unchanged: explicit allowlist grants only,
  **no wildcard and no prefix expansion**, unknown actions deny, superseded
  four-role identifiers deny, every operation server-enforced and attributable.
  A per-user grant model that could widen access implicitly would violate OQ-75's
  "no new signing, custody, or recovery permission is inferred".
- `licenses.issue.perpetual` (or whatever the perpetual grant is named) is **not**
  in the configurable set, because §1.1 reserves perpetual issuance to
  `OWNER_ADMIN`. Granting it to an operator would contradict this record.
- A default grant policy for a newly created operator is required and is **not**
  decided here; the fail-closed reading is that a new operator holds no issuance
  grant until `OWNER_ADMIN` gives one.
- Grant changes are sensitive operations: they must be audited with actor,
  before/after state, reason and server time under the existing Owner audit
  model, and must not be editable or deletable from the UI.
- The existing `replacements.authorize` / `audit.archive` restriction to
  `OWNER_ADMIN` is unchanged.

---

## 2. OD-LIC-08 — air-gapped offline signing custody and the issuance flow (B-2)

### Product Owner's instruction, transcribed

> پیشنهاد من گزینه دوم: امضاکننده آفلاین و ایزوله (air-gapped) است؛ چون با تصمیم
> قبلی تو برای تبادل فایل آفلاین سازگارتر است و کلید خصوصی را از وب‌اپ و سرور در
> معرض شبکه جدا می‌کند.
> البته این گزینه یک تغییر واقعی در فرایند صدور ایجاد می‌کند:
> - وب‌اپ Owner اطلاعات مجوز را آماده می‌کند و درخواست امضا می‌سازد.
> - اپراتور فایل درخواست را به محیط امضای آفلاین منتقل می‌کند.
> - امضاکننده آفلاین پس از اعتبارسنجی درخواست، مجوز را امضا می‌کند.
> - فایل امضاشده به Owner برمی‌گردد و پس از اعتبارسنجی، ثبت و برای دانلود در
>   دسترس قرار می‌گیرد.

### What is decided

The custody option is **B — air-gapped offline signer**, and the issuance flow is
the four steps exactly as written:

| Step | Actor | Action |
|---|---|---|
| 1 | Owner web app | Prepares the license information and produces a **signing request** |
| 2 | Operator | Carries the request file to the offline signing environment |
| 3 | Offline signer | **Validates the request**, then signs the license |
| 4 | Owner web app | Receives the signed file back, **validates it**, then records it and makes it available for download |

### Consequences carried into design

- **The private key never reaches the Owner web process, its host, its
  configuration or its database.** This is a strengthening of ADR-0046 Decision 9
  and PDR-11 §4.4/G-3, and it makes readiness D-5's rejected Option C
  structurally impossible rather than merely discouraged: there is no
  `LICENSE_SIGNING_PRIVATE_KEY` in the Owner runtime to leak.
- **Issuance is no longer synchronous.** A "confirm → download immediately"
  single-request flow is not what was approved. The UI must model at least two
  distinct operator states (awaiting signature, and signed/recorded) and must
  never present an unsigned request as an issued license. Any screen that shows a
  license as issued before step 4 completes would be the false-success surface
  the assessment §5 ruled out.
- **Two validations are mandatory and neither may be skipped:** the offline
  signer validates the request before signing (step 3), and the Owner validates
  the returned artifact before recording it (step 4). Step 4's validation must
  use the real verification path the customer runtime uses, so the Owner never
  records an artifact a customer would refuse.
- **A new artifact kind is introduced: the signing request.** It is Owner-internal
  transport for an *unsigned* payload, not a signed license, so PDR-16's
  constraints ("no existing signed byte format is changed", "no new
  canonicalizer", "no `VLIC3`") are not breached — but its format, grammar,
  versioning and validation rules are undefined and are engineering design work.
  It must carry no private key material and must be unambiguous about what it
  authorizes, so a request cannot be silently altered between steps 2 and 3.
- **Where the offline signer lives is engineering design, not product policy.**
  ADR-0048's separation boundary and the CI gates that assert the customer
  artifact contains no issuer both constrain the answer; the signer must not
  become a customer-side capability and must not ship in a customer image.
- **Replay and concurrency:** the same request signed twice, the same signed
  artifact imported twice, and two operators preparing requests for one
  installation must all be handled explicitly. `operationId` is the existing
  replay identity (ADR-0046 Decision 3) and the customer already refuses a second
  application of the same one; the Owner side must not create a second recorded
  issuance from a repeated import. OQ-81's replay-response contract remains OPEN
  and is not decided here.
- **This decision does not close U-1/OQ-74.** Air-gapped custody answers *where
  the key lives*; it does not answer the compromise policy, containment,
  provenance for issued-but-not-imported artifacts, rotation cadence, or how a
  new public key reaches customer trust lists before first use (`ROT-01…ROT-06`).
  OQ-74 stays OPEN.
- Risk **B-5 is unchanged and now sharper**: an offline signer makes issuance
  slower but does not make a wrongly issued perpetual license revocable. OQ-78
  remains OPEN and PO-78-01 authorizes no implementation.

---

## 3. OD-LIC-09 — installation identity registration (B-3 / OQ-90)

### Product Owner's instruction, transcribed

> ثبت کنترل‌شده توسط اپراتور؛ شناسه از صفحه Vardena خوانده شود و منبع و تأیید
> ثبت گردد.

### What is decided

**Controlled operator registration.** The `installationId` is read by the
operator from the customer's Vardena page, and **both the source and the
confirmation are recorded**.

### Consequences carried into design

- This is the assessment's B-1 **Option B**, strengthened by a provenance and
  confirmation requirement — it is *not* a permission to trust operator free
  text. The value must be validated against the real identifier grammar (the
  customer's `installationId` is a server-generated ULID) and rejected otherwise.
- **The recorded source is a claim, not a proof.** ADR-0048 Decision 5 stands:
  request fields are claims, never identity. Recording that the operator read the
  value from the customer's Vardena page makes the act attributable; it does not
  make the binding cryptographically verified, and no response may say otherwise.
- The residual risk the assessment named is **not eliminated**: a transcription
  error still yields a validly signed artifact bound to the wrong server, and the
  signature cannot detect that. The confirmation step is the mitigation, so its
  exact shape (explicit acknowledgement, re-entry, display-back of the resolved
  customer/installation, or a combination) is engineering design and must be
  deliberate rather than incidental.
- **Correction after issuance is not addressed by this decision** and there is
  still no revocation instrument (OQ-78 OPEN). What happens when a wrong identity
  is discovered after signature is therefore an open operational question, not a
  solved one.
- `owner.operational_records.installation_reference` keeps its existing meaning as
  an *observed reference*. It must not be silently promoted to signed identity;
  whether the new authoritative value lives beside it or replaces its role in the
  issuance path is engineering design.
- OQ-90's registry row moves from "no decision" to "product direction decided,
  design open". It is **not closed**.

---

## 4. OD-LIC-10 — signed-artifact storage and re-download (B-4 / OQ-91)

### Product Owner's decision

**Option B** of the assessment's B-4: retain the signed artifact in a **dedicated
durable file store outside PostgreSQL**, following the pattern already built for
the Owner audit archive.

### Consequences carried into design

- **This reverses an approved persistence constraint.** `owner-licensing/README.md`
  states "No arbitrary metadata JSON, customer secrets, contact/CRM/billing data
  or **raw signed artifacts**". That clause is superseded for signed license
  artifacts by this decision and the README must be corrected in the same change
  that implements it, so the documentation never claims a constraint the code
  violates. The rest of the clause (no arbitrary metadata JSON, no customer
  secrets, no CRM/billing data) is **unchanged**.
- The referenced pattern is the existing `FilesystemAuditArchiveStore`:
  write-once (`link` + `unlink`, `chmod 0o444`, file and directory `fsync`),
  read-back verification, and a hash-chained manifest, on a path outside
  PostgreSQL. Reusing it is a design starting point, not an approval to share one
  storage root with the audit archive — license artifacts and audit bundles have
  different retention, access and disclosure properties.
- **A readable archive of signed customer licenses is a disclosure surface even
  though it cannot be forged.** It exposes customer identities, limits, modules
  and terms. Access must be permission-gated, every retrieval attributable and
  audited, and the store must sit inside the Owner backup lifecycle deliberately
  rather than by accident.
- Download must be **license-id-scoped and server-controlled**: the file path is
  never taken from client input, so path traversal is impossible by construction,
  and the filename and content type match the real `vardena-license` format.
- Retention, backup and restore of the artifact store are **not decided here**.
  Note that PDR-18 §3 removes WORM as an MVP requirement, and that a filesystem
  path alone does not guarantee physical independence — the same caveat the README
  already records for `OWNER_AUDIT_ARCHIVE_DIR` applies.
- Because the artifact is retained, a lost file is re-downloadable. That does
  **not** create a re-issuance path: replacing a grant still follows PDR-18 §9
  (renewal) or PDR-12 (explicit supersession), never a re-signed copy with new
  dates.
- OQ-91's registry row moves from "no decision" to "product direction decided,
  design open". It is **not closed**.

---

## 5. The two forks — **answered by the Product Owner on 2026-10-19**

§5 was originally recorded as two undecided forks, with the warning that
implementation of the affected data model must not start on a guess. The Product
Owner answered both the same day. The original options are kept so the choice is
auditable; the answers and their consequences control.

### 5.1 F-1 — **answered: hybrid (option C)**

**Decision.** The grant-profile model is **optional per customer**:

- **When `OWNER_ADMIN` has defined a limit profile for a customer**, the operator
  is bounded by it and may not exceed it. Over-limit issuance is then
  structurally impossible, not merely forbidden.
- **When no profile exists for that customer**, the operator enters the limits at
  issuance time, bounded by the permissions `OWNER_ADMIN` granted that operator
  under §5.2.

**Consequences carried into design.**

- A new domain entity exists: a per-customer limit profile (organization cap, user
  cap, allowed modules, and any other constraint the license contract supports),
  with its own validation, lifecycle and audit. It is Owner-authored; an operator
  never creates or edits one.
- **Two validation paths and two UI states are required**, and the UI must make
  visible which one is in force, because the operator's freedom differs between
  them. An operator must not be able to mistake "no profile" for "profile with no
  ceiling".
- **Absence of a profile means "no stored ceiling", not "issuance forbidden".**
  This reading is taken from the wording of the option the Product Owner selected
  ("اگر نساخت، اپراتور در حد permissionهای خودش آزادانه وارد می‌کند"). It is
  recorded here explicitly because the alternative reading would have blocked
  issuance for every customer without a profile.
- The residual risk is **not** eliminated: for a customer with no profile, an
  operator may enter limits up to whatever their granted permissions allow, and a
  wrongly issued grant is irrevocable in practice (§6, B-5 / OQ-78). Whether
  `OWNER_ADMIN` wants a policy of "every customer must have a profile before an
  operator may issue" is an operational choice this record does **not** make, and
  no such rule may be inferred.
- The profile is an Owner-side ceiling on what an operator may sign. It is **not**
  a customer entitlement, **not** a commercial contract record, and **not** a
  substitute for the PDR-18 §1 date rules — contract dates stay separate from
  activation validity.

### 5.2 F-2 — **answered: every operator-eligible permission is configurable; fail-closed default; revocation blocks new requests only**

**Decision (scope).** `OWNER_ADMIN` may configure **every `LICENSE_OPERATOR`-eligible
permission per user**, including the existing `customers.view`, `operations.view`,
`operations.record` and `audit.view`, not only the new issuance permissions.
`LICENSE_OPERATOR` effective access therefore becomes the intersection of the role
and that user's explicit grants.

**Decision (default).** **Fail-closed:** a newly created operator holds **no
issuance grant** until `OWNER_ADMIN` explicitly gives one.

**Decision (revocation).** A grant may be revoked, and **revocation blocks only
new signing requests**. A signing request already produced is **not** invalidated
by a later revocation, and the operator may still import and record the signed
artifact that comes back.

**Consequences carried into design.**

- The static `permissions(role)` model of PDR-17 is replaced for
  `LICENSE_OPERATOR` by role ∩ explicit per-user grants. `OWNER_ADMIN` is **not**
  configurable (§1.1 reserves perpetual issuance to that role, and PDR-17 gives
  it Owner-admin decision authority); the Product Owner did not choose the option
  that would have made it configurable.
- The perpetual-issuance permission remains **outside** the configurable set, so
  no grant can give an operator the power §1.1 reserves to `OWNER_ADMIN`.
- The guarantees that must survive unchanged: explicit allowlist grants only, **no
  wildcard and no prefix expansion**, unknown actions deny, superseded four-role
  identifiers deny, server-enforced on every request, and attributable. A
  per-user grant model that could widen access implicitly would violate OQ-75's
  "no new signing, custody, or recovery permission is inferred".
- Grant and revocation are sensitive operations: audited with actor, before/after
  state, reason and server time, and not editable or deletable from the UI.
- **Accepted trade-off, recorded verbatim so it is never silently re-decided:**
  the revocation choice leaves a window in which a user who **no longer holds the
  issuance permission can complete an issuance**, and that issuance is
  irrevocable in practice because OQ-78 remains OPEN. The Product Owner selected
  this option with that consequence stated in the option text. It is a deliberate
  acceptance, not an oversight, and it does **not** license weakening any other
  control: the importing actor must still be authenticated, active, not under
  `must_change_password`, and attributable, and the revocation must be visible in
  the audit trail of the completed issuance.
- Which actor may import a returned artifact when the original grant has been
  revoked is **engineering design**, not product policy. The fail-closed reading
  adopted in the design is that only the request's creator (or an `OWNER_ADMIN`)
  may complete it, so attribution stays exact.

### 5.3 What §5 no longer blocks

With F-1 and F-2 answered, the data model is fixed: the issuance ledger, the
optional per-customer limit profile, and the per-user grant table may now be
designed and built. The remaining gate is **technical design only** (§6), plus the
unchanged open items.

---

## 6. What remains open after this record

| Item | Status |
|---|---|
| **U-1 / OQ-74** signing-key compromise, containment, rotation cadence, trust rollout, provenance for issued-but-not-imported artifacts | **OPEN.** OD-LIC-08 answers *where the key lives*, nothing else |
| **OQ-75** Owner permission mapping | **Advances, does not close.** OD-LIC-07 sets the direction and §5.2 fixes the configurable scope, the fail-closed default and the revocation semantics; the exact permission-code vocabulary and its implementation evidence remain |
| **OQ-78** revocation and recovery | **OPEN.** Unchanged. PO-78-01 remains policy-only |
| **OQ-81** replay/receipt contract | **OPEN.** Directly relevant to OD-LIC-08 steps 3–4 |
| **OQ-85** Owner infrastructure operational evidence | **OPEN.** A new artifact store and an offline signer both add deployment surface |
| **OQ-90** installation identity | **Direction decided (OD-LIC-09); design open; not closed** |
| **OQ-91** artifact storage | **Direction decided (OD-LIC-10); design open; not closed** |
| **F-1, F-2** above | **ANSWERED 2026-10-19 — see §5.1 and §5.2.** No longer blocking |
| Signing-request artifact format, offline signer packaging and isolation, issuance ledger schema, migration numbering, download authorization, UI states | **Engineering design delivered 2026-10-19** (documentation only, nothing implemented): [`owner-side-issuance-technical-design.md`](../../tasks/owner-side-issuance-technical-design.md) — `VLSR1` request envelope and payload, digest pinning for tamper-evidence across the human transport, which instant is "the issuance day", signer packaging/validation, the four new tables, the permission vocabulary, staged-then-transactional import, the separate `OWNER_LICENSE_ARTIFACT_DIR` store, the state machine, audit events, API and Persian RTL UI states, and the conformance test plan. Awaiting review |

---

## 7. Recording discipline

This record transcribes the Product Owner's answers and derives only their stated
consequences. It claims no implementation, no test, no CI evidence and no
acceptance. Where a reading was needed to make a consequence explicit, it is
labelled as a reading or moved to §5 rather than asserted as a decision. Nothing
here closes an OQ, promotes an ADR, or authorizes a change to any signed byte
format, canonicalization rule, vector or customer runtime behaviour.

## 8. Related records

- [Owner-side issuance blocked assessment](../../tasks/licensing-owner-side-issuance-blocked-assessment.md) — the four questions this record answers
- [Owner-side issuance technical design](../../tasks/owner-side-issuance-technical-design.md) — the engineering design this record's gate asks for (documentation only)
- [PDR-17](./PDR-17-owner-web-application-phase-1.md) — two-role model and permission matrix (superseded for `LICENSE_OPERATOR` by OD-LIC-07)
- [PDR-18](./PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md) — §1 issuance dates, §9 renewal, §11 PO-78-01
- [PDR-16](./PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md) — canonical bytes and `VECTORS_ONLY`
- [PDR-12](./PDR-12-license-term-supersession.md) — explicit supersession, the only term-changing path
- [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) — Decisions 1, 3, 6, 7, 9
- [ADR-0048](../../adr/0048-owner-side-licensing-separation-boundary.md) — Decisions 4, 5; separation boundary
- [Owner-side Phase 0 readiness](../../tasks/licensing-owner-side-phase-0-readiness.md) — D-5, D-6, R-2, R-3, R-8
- [Open questions registry](../../open-questions.md) — OQ-74, OQ-75, OQ-78, OQ-81, OQ-85, OQ-90, OQ-91
