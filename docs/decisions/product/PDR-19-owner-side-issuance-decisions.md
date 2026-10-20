# PDR-19: Owner-side license issuance — permission split, offline signing custody, installation identity and artifact storage

- **Date:** 2026-10-19 (§1…§5) · **amended 2026-10-20** (§6, OD-LIC-11…OD-LIC-14; §10, OD-LIC-15…OD-LIC-19)
- **Authority:** Product Owner Ali Esmaeili, answering the four blocking questions B-1…B-4 of [the issuance assessment](../../tasks/licensing-owner-side-issuance-blocked-assessment.md) §4.
- **Status:** **Decided — product policy approved for D-1…D-4 below; the two forks of §5 (F-1 limit model, F-2 configurable permission scope/default/revocation) were answered by the Product Owner on 2026-10-19; the four security-review decisions of §6 (**OD-LIC-11…OD-LIC-14**) were answered on 2026-10-20; and the five lifecycle decisions of §10 (**OD-LIC-15…OD-LIC-19**) were answered on 2026-10-20.** §5, §6 and §10 record the answers and their consequences. No implementation, schema, migration, endpoint, artifact or UI is claimed by this record; implementation evidence is tracked separately in the Owner-side issuance traceability matrix.**
- **Decision ids:** **OD-LIC-07** (permission split and per-operator grants), **OD-LIC-08** (air-gapped signing custody and issuance flow), **OD-LIC-09** (installation identity registration), **OD-LIC-10** (signed-artifact storage); **added 2026-10-20 (first round):** **OD-LIC-11** (request authenticity before signing — OQ-92), **OD-LIC-12** (default access of a new operator — OQ-93), **OD-LIC-13** (limit-profile reactivation — OQ-94A), **OD-LIC-14** (in-flight requests when a profile changes — OQ-94B); **added 2026-10-20 (second round):** **OD-LIC-15** (signing-key rotation), **OD-LIC-16** (renewal and replacement authorization), **OD-LIC-17** (signed revocation artifact), **OD-LIC-18** (duplicate signed-artifact import), **OD-LIC-19** (signed-artifact retention and recovery).
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

**Update (2026-10-20):** the technical design was delivered and then reviewed for
security and coherence, and that review raised three product questions which the
Product Owner answered the same day as **OD-LIC-11…OD-LIC-14** (§6). OQ-92, OQ-93 and
both parts of OQ-94 therefore have their decisions. The gate is **not** waiting on a
product decision arising from the security review; what remains is design approval and
the pre-existing open set of §7.

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
  wrongly issued grant is irrevocable in practice (§7, B-5 / OQ-78). Whether
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
designed and built. The remaining gate is **technical design only** (§7), plus the
unchanged open items.

---

## 6. OD-LIC-11…OD-LIC-14 — the security-review decisions, **answered by the Product Owner on 2026-10-20**

The technical design this record's gate asked for was delivered on 2026-10-19 and then
reviewed for security and coherence on 2026-10-20
([design §0 amendment table](../../tasks/owner-side-issuance-technical-design.md),
findings **RV-1/RV-2/RV-3**). That review corrected three defects on its own
authority and **stopped** on three questions that are product policy, recording them
as **OQ-92**, **OQ-93** and **OQ-94** (the last in two parts, A and B). The Product
Owner answered all of them on 2026-10-20. This section is the canonical record; the
design, the registry rows and the assessment are reconciled to it, not the reverse.

**Nothing in this section reopens OD-LIC-07…OD-LIC-10, F-1, F-2, readiness D-5, or
any ADR/PDR.** Each answer below stays inside the contract those records fixed.

### 6.1 OD-LIC-11 — request authenticity before signing (OQ-92)

**Product Owner's decision, transcribed.** انتخاب قطعی: **O-A — تأیید SHA-256 کامل از
مسیر مستقل.** Owner هنگام ایجاد درخواست `request_payload_sha256` کامل را محاسبه و به
اپراتور نمایش می‌دهد؛ مقدار تأیید باید دقیقاً ۶۴ رقم هگزادسیمال باشد و کوتاه‌سازی یا
حذف آن ممنوع است؛ اپراتور باید مقدار را از مسیری مستقل از فایل درخواست به محیط امضای
آفلاین منتقل کند؛ ابزار امضا باید **پیش از خواندن یا بارگذاری کلید خصوصی** digest را
اعتبارسنجی و مقایسه کند؛ مقدار غایب، نامعتبر، کوتاه‌شده یا نامطابق باید باعث رد
درخواست، خروجی غیرصفر و عدم خواندن کلید خصوصی شود؛ digest استخراج‌شده صرفاً از همان
فایل درخواست، مسیر مستقل محسوب نمی‌شود؛ `request_binding_sha256` همچنان برای کنترل
اتصال درخواست به payload مجوز هنگام ورود در Owner استفاده می‌شود و این مقدار با digest
کامل درخواست یکی نیست؛ ریسک باقیماندهٔ اتکای مسیر مستقل به صحت انتقال و رفتار اپراتور
باید مستند بماند. محدودیت: در این مرحله هیچ کلید جدیدی، قالب امضاشدهٔ جدیدی، تغییر
canonicalization، تغییر بردارها یا تغییر سمت مشتری ایجاد نشود.

**What is decided.**

- **O-A is the mechanism**, exactly as design §4.4 documented it: an out-of-band
  confirmation of the full request digest, checked by the offline signer **before** it
  reads or loads the license private key.
- **The confirmation value is 64 lowercase hex — the complete SHA-256.** Shortening,
  truncating, abbreviating or omitting it is **forbidden**. This closes the
  shortening sub-question of OQ-92 definitively and in the restrictive direction.
- **The channel must be independent of the request file.** A digest extracted from the
  request file itself — or from anything derived from it — is **not** an independent
  path and must be refused. This closes the channel sub-question at the level of a
  testable rule rather than a list of approved media.
- **Both digests survive, with different jobs.** `request_payload_sha256` (whole
  request) is the pre-signature control; `request_binding_sha256` (the `VLIC2`
  projection) remains the import-time binding control. They are **not** the same value
  and must never be used interchangeably — confusing them was defect RV-2.
- **O-B is not adopted.** No Owner-held request-signing key is authorized by this
  decision.

**Reason and operational consequence.** The review established that the signer's nine
validation checks are structural, so a well-formed but *substituted* request passed
all of them and was signed with the authority key — including nulling `validUntil`,
which converts a time-limited request into a perpetual license and crosses the
boundary OD-LIC-07 reserves to `OWNER_ADMIN` with no key and no Owner access. Refusal
at Owner import cannot protect the customer, because an artifact handed to the
customer directly verifies against `LICENSE_SIGNING_PUBLIC_KEYS` without the Owner's
import path ever running, and OQ-78 makes a signed artifact irrevocable in practice.
Detection therefore has to happen before the key is used. The operational cost is
accepted and is real: **one manual out-of-band confirmation per issuance**, and a
64-hex transcription.

**Security constraints (binding).**

- **No new key, no new signed format, no canonicalization change, no vector change, no
  customer-side change.** `VLIC2`, the PDR-16 D-2(b) canonical byte contract, the
  corpus and the separation boundary are untouched. The request artifact stays
  **unsigned**.
- The license private key never reaches the Owner web process, its host, its
  configuration or its database (OD-LIC-08 unchanged), and the Owner still holds no
  key — O-A adds a *displayed hash*, not a credential.
- The signer validates before it reads or loads the key, and on any refusal the key
  must not have been read at all.
- The residual risk **must remain documented**: O-A depends on the integrity of the
  independent channel and on operator behaviour, so it fails against an attacker who
  controls both the file and the out-of-band value (a compromised or colluding
  operator). No option removes this, because a human moves the file in every option.
  Documenting it is a condition of the decision, not an optional note.

**Permitted / forbidden.**

| Permitted | Forbidden |
|---|---|
| Displaying the full 64-hex digest in the Owner UI, selectable and printable | Embedding the confirmation value in the request file, or deriving it from that file |
| Carrying it on printed paper, second media, or by voice | Any shortened, truncated or "friendly" confirmation code |
| The signer refusing and exiting non-zero without reading the key | Signing first and verifying later; verifying only at Owner import |
| Printing both digests in signer output (neither is secret) | Any log, exit message or output containing key material or a full payload dump |

**Required conformance tests.** Positive round trip (an untampered request confirms
and the resulting artifact's binding digest matches); tampered request refused with
the key **not loaded** (asserted by the key not being read, not merely by the exit
code) for each of design §3.6's T-1…T-9; absent, empty, malformed, case-varied and
shortened digest entries all refused; a digest read from the request file itself
refused; a forged artifact for tampered terms refused at import, recorded nowhere as
issued, and served by no path — including the download route, a re-import, and the
customer's **real** verifier.

**Dependencies and unresolved.** Closes OQ-92's decision. Does **not** touch
U-1/OQ-74 (key compromise, rotation, trust rollout), OQ-78 (revocation), or the
confidentiality of the request file in transport, which design §15 still records as
an operational/security handling question. O-B remains documented as the stronger
option and would need a **new** decision if ever wanted.

### 6.2 OD-LIC-12 — default access of a newly created operator (OQ-93)

**Product Owner's decision, transcribed.** انتخاب قطعی: **R1 — بدون Grant صریح،
دسترسی مؤثر صفر است.** ساخت اپراتور به‌خودی‌خود برای او Grant فعال ایجاد نمی‌کند؛
بدون Grant فعال و صریح، مجوز مربوطه رد می‌شود؛ وجود نقش یا صلاحیت پایه به‌تنهایی
مجوز دسترسی مؤثر نیست؛ دسترسی مؤثر همچنان از اشتراک صلاحیت نقش و Grant فعال به دست
می‌آید و Grant هرگز نمی‌تواند صلاحیت نقش را گسترش دهد؛ Grant لغوشده دسترسی نمی‌دهد
ولی سابقهٔ لغو و عامل آن برای ممیزی حفظ می‌شود؛ مجوزهای صدور، صدور دائمی و مدیریت
پروفایل سقف طبق ماتریس صلاحیت و قواعد مجزای خود بررسی می‌شوند؛ `OWNER_ADMIN` نباید
به‌اشتباه تحت مدل Grant اپراتور قرار گیرد؛ این تصمیم نباید دسترسی فعلی `OWNER_ADMIN`
را بدون تصمیم صریح تغییر دهد.

**What is decided.** **R-1**, the strict reading: a newly created `LICENSE_OPERATOR`
has an **empty effective permission set**. Operator creation writes **no** grant rows.
The four permissions the role holds today in `owner-licensing/backend/src/domain.ts:33-38`
(`customers.view`, `audit.view`, `operations.view`, `operations.record`) become
**eligible but not effective** — an `OWNER_ADMIN` must grant each one explicitly
before the operator can use it.

**R-3 is rejected.** The design's engineering recommendation (seeding the four
baseline permissions as explicit active grant rows at creation) is **not adopted**.
Design §5.4's R-1/R-3 open question and §6.2's "open question" row are closed by this
decision in favour of R-1, and the matrix test of design §13.5 is no longer
parameterized.

**Reason and operational consequence.** R-1 is the maximally fail-closed reading and
is the one that makes "no permission is inferred" literally true for every permission,
not only the issuance ones — the strongest available form of OQ-75's guarantee. Its
consequence is accepted and must be **surfaced, not softened**: a newly created
operator can do **nothing at all** — not even open the customer list — until
`OWNER_ADMIN` grants permissions one by one. Operator provisioning therefore becomes
a two-person, two-step act (create the user, then grant), and a provisioning gap
presents as an operator who appears broken rather than as an error message. The Owner
UI must make this legible: an operator with no grants needs a visible empty state
naming the missing grants, and the admin surface must show which permissions each
operator actually holds.

**Security constraints (binding).**

- Effective access stays `eligible(role) ∩ active grants` — **intersection, never
  union**. A grant can narrow but can **never widen**: it cannot exceed the role's
  eligibility, and eligibility is a closed list.
- `OWNER_ADMIN` is **not** placed under the grant model, appears in no grant table,
  and its access is **unchanged** by this decision. A trigger refuses any grant row
  naming an `OWNER_ADMIN`.
- Perpetual issuance (`licenses.issue.perpetual`) and `limit_profiles.manage` remain
  **ineligible** for `LICENSE_OPERATOR` under OD-LIC-07 and F-2, and are governed by
  their own matrix rules — R-1 does not make them grantable.
- A revoked grant confers nothing, but the revocation history and the revoking actor
  are preserved for audit; revocation is a row update, never a delete.

**Permitted / forbidden.**

| Permitted | Forbidden |
|---|---|
| `OWNER_ADMIN` granting any eligible permission explicitly, per user | Any implicit, seeded, default or role-derived effective permission for an operator |
| Denying by absence of a row | Treating role membership or eligibility as access |
| Revoking, and re-granting the same row afterwards with the full sequence visible | Deleting a grant row to revoke; wildcard, prefix or pattern grants |
| Refusing an ineligible grant at trigger **and** service | Letting a forced ineligible row become effective (intersection must still deny) |

**Required conformance tests** (for the future implementation stage — none written by
this record): fresh operator with **no** grant (denied on every permission) · active
grant (allowed) · revoked grant (denied, history retained) · revoke-then-re-grant
(allowed again, sequence visible) · **inactive user** holding an active grant (denied)
· `must_change_password` (denied on sensitive actions) · attempt to grant an
ineligible or unknown permission (refused at trigger and service) · **no-widening
guarantee** asserted over every generated combination (effective ⊆ eligible) ·
`OWNER_ADMIN` unaffected by the grant model · operator attempt at perpetual issuance
denied at all four independent layers.

**Dependencies and unresolved.** Closes OQ-93's decision. The **exact permission-code
vocabulary** remains open under OQ-75 (design §6 proposes names; OQ-75 requires the
vocabulary to be explicit and tested before implementation). PDR-17's static matrix
documentation must be updated when this is implemented, since OD-LIC-07 already
superseded it for `LICENSE_OPERATOR` and R-1 now removes the role's implicit
baseline. The F-2 revocation trade-off recorded in §5.2 is **unchanged**.

### 6.3 OD-LIC-13 — reactivating a retired limit profile (OQ-94A)

**Product Owner's decision, transcribed.** انتخاب قطعی: **فعال‌سازی مجدد همان پروفایل
بازنشسته مجاز است.** فعال‌سازی مجدد باید عملیات صریح و مجاز باشد؛ قبل از فعال‌سازی
مجدد، قید حداکثر یک پروفایل `ACTIVE` برای هر مشتری باید رعایت شود؛ اگر پروفایل فعال
دیگری برای مشتری وجود دارد، فعال‌سازی مجدد نباید قید یکتایی را دور بزند؛ عامل، زمان،
پروفایل هدف و نتیجهٔ عملیات باید مطابق الگوی ممیزی Owner ثبت شوند؛ تاریخچهٔ
بازنشستگی و فعال‌سازی مجدد نباید حذف یا بازنویسی شود؛ این تصمیم به معنای مجاز بودن
هم‌زمان چند پروفایل فعال برای یک مشتری نیست؛ معنای نبود پروفایل همچنان طبق تصمیم
موجود باقی می‌ماند — «سقف ذخیره‌نشده» به معنی ممنوعیت صدور نیست.

**What is decided.** A `RETIRED` profile may be **reactivated** — `RETIRED → ACTIVE`
on the *same row*, as an explicit, authorized operation. This replaces the design's
original "retire-plus-create" as the recovery path, and design §5.2's statement that
retired rows are terminal is corrected accordingly.

**Reason and operational consequence.** The review found that F-1's no-profile branch
is the *more permissive* one, so retirement **widens** operator freedom; combined with
a column-level `UNIQUE(customer_id)` it made a mistaken retirement unrecoverable
inside the product. Reactivation removes that trap: an `OWNER_ADMIN` who retires a
profile in error can restore **exactly** the same ceiling, with the same values,
rather than authoring a new row and hoping to retype it correctly. Because the same
row is restored, the ceiling that past issuances reference is unchanged, and
`license_issuances.limit_profile_id` snapshots stay meaningful.

**Security constraints (binding).**

- **At most one `ACTIVE` profile per customer, enforced before the reactivation takes
  effect.** If another profile for that customer is already `ACTIVE`, reactivation
  must **fail** — it may not bypass, defer or silently retire the other one. The
  partial unique index of design §5.2 (`UNIQUE (customer_id) WHERE status = 'ACTIVE'`)
  enforces this at the database level on the `UPDATE` itself, so the guarantee does not
  rest on the service layer alone; the service must still refuse first with a clear
  reason.
- **Reactivation is not concurrent multiplicity.** This decision does **not** permit
  two `ACTIVE` profiles for one customer at any instant.
- **History is never deleted or rewritten.** The retirement and the reactivation both
  remain visible, with actor, server time, target profile and outcome, following the
  Owner audit pattern. Status transitions are recorded; the ceiling values are not
  restated as new facts.
- **The ceiling columns stay immutable.** Reactivation restores the *same* ceiling; it
  is not a way to edit a profile. Changing a ceiling remains retire-plus-create, and a
  reactivated profile's `organization_limit`, `user_limit`, `allowed_modules` and
  `perpetual_allowed` are byte-identical to what they were before retirement.
- **Absence semantics unchanged.** "No stored ceiling" still does **not** mean
  "issuance forbidden" (F-1, §5.1), and no "profile required before issuance" rule may
  be inferred from this decision.
- Authorization stays `limit_profiles.manage`, which is `OWNER_ADMIN`-only and
  **ineligible** for `LICENSE_OPERATOR` — an operator can never reactivate the ceiling
  that bounds them.

**Permitted / forbidden.**

| Permitted | Forbidden |
|---|---|
| Explicit `RETIRED → ACTIVE` on the same row, by an authorized actor | Reactivating while another profile for that customer is `ACTIVE` |
| Auditing actor, time, target profile and outcome | Deleting or rewriting the retirement/reactivation history |
| Restoring the identical ceiling values | Editing ceiling values as part of reactivation |
| Retiring again afterwards (transitions may repeat) | Two concurrently `ACTIVE` profiles; inferring "profile required" from absence |

**Required conformance tests.** Reactivate a retired profile with no other active
profile → succeeds, same values, audited · reactivate while another profile is
`ACTIVE` → refused by the service **and** by the unique index, nothing changed ·
ceiling columns unchanged across retire→reactivate (attempt to edit them is refused) ·
an issuance created before retirement still references the same `limit_profile_id`
afterwards · a `LICENSE_OPERATOR` attempt to reactivate → denied · history of a
retire→reactivate→retire sequence fully visible · audit row carries actor, server
time, target and outcome.

**Dependencies and unresolved.** Closes OQ-94A. Interacts with OD-LIC-14 below: a
reactivation, like a retirement, does not retroactively change a request already in
flight. Migration `007` must allow the `RETIRED → ACTIVE` transition in whatever
status trigger it defines — the design's original trigger wording forbade it and must
be corrected at implementation time.

### 6.4 OD-LIC-14 — requests in flight when a profile changes (OQ-94B)

**Product Owner's decision, transcribed.** انتخاب قطعی: **درخواست موجود با snapshot
زمان ساخت قابل تکمیل می‌ماند.** بازنشستگی، جایگزینی یا فعال‌سازی مجدد پروفایل،
درخواست موجود را صرفاً به دلیل تغییر پروفایل خودکار متوقف نمی‌کند؛ درخواست از
`limit_profile_id` و مقادیر snapshot ثبت‌شده در زمان ساخت خود استفاده می‌کند؛ تغییر
بعدی پروفایل نباید سابقهٔ سقف اعمال‌شده بر درخواست قدیمی را بازنویسی کند؛
درخواست‌های جدید باید بر اساس وضعیت و پروفایل جاری ارزیابی شوند؛ این تصمیم به معنای
مجاز بودن تغییر payload درخواست پس از ساخت، دور زدن بررسی تمامیت، یا نادیده گرفتن
سایر کنترل‌های امنیتی و وضعیت درخواست نیست؛ رفتار درخواست در جریان باید از رفتار
درخواست جدید و از قواعد replay/supersession تفکیک شود.

**What is decided.** The ceiling is evaluated **once, at request creation**, and the
request keeps completing against that snapshot. A later retirement, replacement or
reactivation of the profile does **not** automatically stop an existing request. New
requests are evaluated against the **current** profile state.

This **confirms** the rule design §5.2 had adopted as an engineering analogy to F-2's
revocation semantics, and promotes it from "engineering reading, may be changed" to a
recorded product decision. The design's §15 open item on this point is closed.

**Reason and operational consequence.** The OD-LIC-08 round trip takes hours or days,
during which the Owner has no way to reach the signer. Invalidating in-flight requests
on a profile change would destroy work already authorized and already possibly signed
offline, with no recovery path — the same shape of problem F-2 resolved the same way
for permission revocation. The consequence is accepted and must stay visible: **for a
bounded window, an issuance can complete against a ceiling that no longer applies.**
Because the artifact is irrevocable in practice (OQ-78 OPEN), that completion is
final. The window is narrowed by the fact that the snapshot is exactly what the signer
confirms and what the Owner verifies at import, so it cannot be used to smuggle
*different* terms through.

**Security constraints (binding).**

- This decision does **not** permit altering a request payload after creation. The
  immutable-facts trigger of design §5.1 still freezes identity, dates, limits,
  entitlements and **both** digests.
- It does **not** bypass the integrity controls of OD-LIC-11: the signer's
  out-of-band digest check and the Owner's `request_binding_sha256` comparison both
  still apply, unchanged, to an in-flight request.
- It does **not** override any other security or state control — permission checks
  (including §7.4's revoked-grant rule), actor validity, key trust and status
  (`signing_keys` must be `ACTIVE`), the §9.1 state machine, or the artifact store's
  digest re-verification.
- It does **not** rewrite history: `limit_profile_id` and the snapshot values recorded
  at creation are never updated to reflect a later profile change, so an audit can
  always answer "which ceiling bound this issuance".
- **In-flight behaviour is distinct from both new-request behaviour and the
  replay/supersession rules.** A new request is evaluated against the current profile;
  a replayed import returns the recorded result without re-evaluating the ceiling; and
  supersession/renewal remain PDR-12 / PDR-18 §9 paths, not profile-change paths.

**Permitted / forbidden.**

| Permitted | Forbidden |
|---|---|
| Completing an existing request against its creation-time snapshot | Auto-cancelling or auto-invalidating a request because a profile changed |
| Evaluating **new** requests against the current profile state | Rewriting `limit_profile_id` or the snapshot values afterwards |
| Refusing an in-flight request for any *other* control (permission, key, digest, state) | Using the snapshot rule to alter a payload, bypass a digest check, or skip a permission check |
| Recording the profile change in the audit trail next to the issuance | Treating an in-flight request as a new one, or as a replay/supersession |

**Required conformance tests.** Request created under a profile → profile retired →
import still succeeds and the row keeps the original `limit_profile_id` · request
created under a profile → profile replaced by a stricter one → the in-flight import
still succeeds against the snapshot, while a **new** request for the same terms is
refused by the stricter ceiling · request created with **no** profile → a profile is
created afterwards → the in-flight request still completes unbounded, and a new
request is bounded · snapshot values never mutated by any profile operation ·
replayed import of an already-recorded artifact returns the recorded result without
re-evaluating the ceiling · an in-flight request still refused by a revoked
`licenses.import` grant (§7.4), an unknown or non-`ACTIVE` signing key, and a binding
digest mismatch.

**Dependencies and unresolved.** Closes OQ-94B. Depends on OD-LIC-13's reactivation
being a status transition on the same row, so that "the profile changed" has a precise
meaning. Does not resolve OQ-78 (revocation) or the pending-request expiry question,
which design §15 still records as open: an in-flight request may remain completable
indefinitely, and the only temporal backstop today is the customer-side
`expired-document` refusal.

### 6.5 What §6 changes in the gate

With OD-LIC-11…OD-LIC-14 recorded, **OQ-92, OQ-93 and both parts of OQ-94 have their
product decisions**. The technical design's three stopped items are unblocked, and the
design can be reconciled and approved on its own merits. The gate recorded in §0 is
therefore no longer waiting on a product decision from the security review; what
remains is the pre-existing open set of §7 (U-1/OQ-74, OQ-75's vocabulary, OQ-78,
OQ-81, OQ-85, OQ-90, OQ-91) plus the design-level items §15 of the design still
lists. **No implementation is authorized or claimed by this section.**


## 7. What remains open after this record

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
| **OQ-92** request authenticity before signing | **ANSWERED 2026-10-20 — OD-LIC-11 (§6.1).** O-A with the full 64-hex digest over an independent channel; O-B **not** adopted; shortening forbidden |
| **OQ-93** default access of a new operator | **ANSWERED 2026-10-20 — OD-LIC-12 (§6.2).** **R-1**: no grant row, effective access empty. R-3 rejected |
| **OQ-94A** limit-profile reactivation | **ANSWERED 2026-10-20 — OD-LIC-13 (§6.3).** Reactivating the same retired row is allowed, never two `ACTIVE` at once |
| **OQ-94B** in-flight requests on profile change | **ANSWERED 2026-10-20 — OD-LIC-14 (§6.4).** Existing request completes on its creation-time snapshot; new requests use current state |
| **OD-LIC-15** signing-key rotation | **DECIDED 2026-10-20 (§10.1).** Controlled, auditable **manual** rotation; routine vs emergency distinguished; no new trust bootstrap and no claim that an existing installation trusts a new key before that key is installed and verified there |
| **OD-LIC-16** renewal and replacement authorization | **DECIDED 2026-10-20 (§10.2).** Both are **`OWNER_ADMIN`-only** in the backend; an operator cannot set or manipulate `renewsOperationId` / `supersedesOperationId`, including through direct API calls |
| **OD-LIC-17** signed revocation artifact | **DECIDED 2026-10-20 (§10.3) — direction B, a separately versioned artifact (`VREV1`).** Protocol design required before code and delivered in [`revocation-artifact-protocol.md`](../../licensing/revocation-artifact-protocol.md). `VLIC2` is unchanged |
| **OD-LIC-18** duplicate signed-artifact import | **DECIDED 2026-10-20 (§10.4).** Return the **historical result of the first successful registration**; no second issuance, operation, assignment, archive entry or issuance audit event; authorization is still checked first; the semantic fingerprint excludes mutable display metadata |
| **OD-LIC-19** signed-artifact retention and recovery | **DECIDED 2026-10-20 (§10.5).** **Indefinite** retention of the exact original bytes in the durable filesystem archive, explicit staged states, documented backup/restore with integrity verification, no WORM requirement, no automatic deletion |
| Signing-request artifact format, offline signer packaging and isolation, issuance ledger schema, migration numbering, download authorization, UI states | **Engineering design delivered 2026-10-19** (documentation only, nothing implemented): [`owner-side-issuance-technical-design.md`](../../tasks/owner-side-issuance-technical-design.md) — `VLSR1` request envelope and payload, digest pinning for tamper-evidence across the human transport, which instant is "the issuance day", signer packaging/validation, the four new tables, the permission vocabulary, staged-then-transactional import, the separate `OWNER_LICENSE_ARTIFACT_DIR` store, the state machine, audit events, API and Persian RTL UI states, and the conformance test plan. Awaiting review |

---

## 8. Recording discipline

This record transcribes the Product Owner's answers and derives only their stated
consequences. It claims no implementation, no test, no CI evidence and no
acceptance. Where a reading was needed to make a consequence explicit, it is
labelled as a reading or moved to §5 rather than asserted as a decision. Nothing
here closes an OQ, promotes an ADR, or authorizes a change to any signed byte
format, canonicalization rule, vector or customer runtime behaviour.

## 9. Related records

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


---

## 10. OD-LIC-15…OD-LIC-19 — the lifecycle decisions, **answered by the Product Owner on 2026-10-20**

This round answers the five remaining lifecycle questions that stood between the
approved design and a complete Owner-side lifecycle: key rotation, renewal and
replacement authority, a signed revocation instrument, duplicate-import behaviour
and artifact retention/recovery. It is recorded here **before** the implementation
that depends on it, per the repository's decision-first discipline.

Nothing in this section reopens §1…§6, F-1/F-2, readiness D-5, or any ADR/PDR. In
particular, **no `VLIC2` payload, canonicalization rule, signature rule or golden
vector changes**. The only new signed artifact authorized is the *separately
versioned* revocation artifact of §10.3, and it is explicitly **not** a `VLIC2`
license and never a substitute for one.

### 10.1 OD-LIC-15 — signing-key rotation is controlled and manual

**Product Owner's decision.** The rotation of the license signing key is a
**controlled manual operation**, not an automated one and not a feature of the
Owner web application.

**What is decided.**

- Rotation is a documented, auditable, manual procedure performed by the
  responsible Owner operators in the offline environment. It keeps the private
  signing key outside the Owner web application, the source repository, the
  customer application and every customer artifact.
- **No production private key is ever generated by CI or committed as part of a
  repository change.** This restates ADR-0046 Decision 9 and PDR-11 §4.4; it is not
  relaxed by anything here.
- A rotation record contains at minimum: the **key identifiers** involved, their
  **activation and deactivation instants**, the **responsible actors**, the
  rollout evidence, and whether the rotation is **routine** or an **emergency
  response** to suspected compromise. The existing `owner.signing_keys` metadata
  table is the Owner-side home for the identifiers and their `ACTIVE` /
  `COMPROMISED` / `REVOKED` status; it still holds **no key material**, and its
  `id` remains an operator-assigned label until it is bound to a real trusted
  public key through the configured trust list.
- Routine rotation and emergency response are **distinct procedures** with
  different urgency, evidence and blast-radius. A suspected compromise additionally
  requires the containment decisions that remain **U-1/OQ-74 OPEN**: this section
  decides the *shape of rotation*, not the compromise-response policy.
- **A rotation procedure must not claim that existing customer installations trust
  the new public key** until that public key is actually installed and verified on
  them. Rotation changes what the signer uses; it changes customer trust only when
  the customer's trust list is updated and the installation restarted/verified.
- **No new trust-bootstrap mechanism is invented.** The customer runtime trusts a
  configured list of Ed25519 public keys (`LICENSE_SIGNING_PUBLIC_KEYS`, grammar in
  `license-document.ts`: `keyId:<material>` or a bare key with a derived
  `sha256-<16 hex>` id; duplicate ids rejected). There is no online key service, no
  key transparency log and no signed key-rotation certificate. The approved manual
  procedure is therefore: (1) generate the new key pair offline,
  (2) distribute the **public** key to every customer installation that must trust
  it, (3) update each customer's configured trust list and verify the new key is
  present/usable **before** it signs a real license, (4) register the key in the
  Owner trust list, (5) begin signing under the new key id, (6) keep the old public
  key trusted for as long as artifacts signed with it may still be imported,
  (7) record the rotation evidence. If a given customer runtime cannot accept the
  new public key without an application deployment, that is a **deployment
  constraint to be scheduled**, not a reason to weaken verification.

**Compatibility boundary (reported, not invented).** The current customer runtime
supports *multiple simultaneously trusted public keys* (`toTrustedKeys` /
`parseTrustedLicenseKeys`) but has **no runtime key-administration endpoint and no
automatic distribution**. Rotation is therefore operationally coupled to a
configuration redeploy of each customer installation. This is compatible with the
approved manual procedure, and it is recorded so nobody mistakes the Owner-side
`signing_keys` row for a customer-side trust change.

**Forbidden by this decision.** Automatic key rotation; key generation in CI; a
private key inside any web application, image, log, database or archive bundle; a
claim that a key is trusted by a customer before that customer's trust list has
been updated and verified; a second signing key introduced to avoid this
procedure.

### 10.2 OD-LIC-16 — renewal and replacement are `OWNER_ADMIN`-only

**Product Owner's decision.** Both operations are **`OWNER_ADMIN`-only**, enforced
in the backend for UI and direct API requests alike.

**What is decided.**

- An ordinary `LICENSE_OPERATOR` must **not** be able to create a renewal or a
  supersession, and must not be able to set, manipulate or smuggle
  `renewsOperationId` or `supersedesOperationId` — in a request body, in a stored
  request snapshot, in a replayed import or in any other path.
- Both fields are **structurally absent** from the operator-visible issuance
  request contract: the backend rejects them on a request prepared by any actor
  other than an `OWNER_ADMIN`, and the UI never offers them. Hiding the control is
  not the control; the refusal is server-side and tested through direct API calls.
- The policy is enforced at the **backend service layer and in the database
  constraints that already exist**; it is not derived from a UI flag, a role claim
  in the browser, or a client-supplied actor field.
- Existing replay, lineage (`supersedes`/`renews` target resolution),
  `customer`/`customerCode` binding and signed-artifact validation rules are
  **unchanged**. A renewal or replacement can only be expressed by a new issuance
  request prepared by an `OWNER_ADMIN`.
- The **public DTO and the signed payload contract do not change**: the fields
  already exist in `VLIC2` (OD-LIC-06, PDR-18 §9). What changes is who may populate
  them.

**Consequence, stated plainly.** Under OD-LIC-07 an operator may still issue an
ordinary time-limited license; only *term-changing* operations are reserved. This
matches the existing customer-side rule that a renewal extends the named version
rather than replacing it, and it does not alter PDR-12's supersession semantics by
one byte.

### 10.3 OD-LIC-17 — a separately versioned signed revocation artifact

**Product Owner's decision.** **Option B**: introduce a **separately versioned,
signed revocation artifact** that the customer imports. This is the first
authorized *new signed format* in the licensing protocol. It is deliberately not a
change to `VLIC2`.

**What is decided.**

- The revocation instrument is a distinct artifact type and version with explicit
  **domain separation** from license issuance artifacts. It can never be parsed as
  a license and a license can never be parsed as a revocation.
- It carries a unique revocation operation identity with defined replay and
  idempotency behaviour; the exact payload and canonicalization are fixed by the
  protocol design required below.
- It targets an **existing license** by identifiers the customer runtime already
  stores, with customer/`customerCode` binding verified before any state changes.
- It carries a **reason**, the **issuer/key identifier**, an **issue instant** and
  enough evidence to audit the decision on both sides.
- **Default effect is targeted revocation only**: it revokes exactly one license
  (one installation-bound commercial right). It does **not** disable other licenses,
  other versions, the installation itself, device enrollments, or any unrelated
  customer fact.
- **The revoked license cannot be reactivated by replaying or re-importing the old
  license artifact.** Continued service requires a replacement grant following the
  normal new-issuance flow — i.e. an explicitly new signed artifact from a new
  Owner-side operation, not a resurrection of the revoked one.
- Failure behaviour is fail-closed and explicit: malformed, unsigned, wrongly
  signed, untrusted-key, wrong-customer, unknown-target, stale/replayed-conflicting
  and already-applied artifacts never silently succeed and never partially apply.
- The vendor is **required to publish and review the protocol design before
  implementation**, covering every bullet above plus UI/import flow, persistence,
  audit events and error reporting.

**What is not authorized.** Changing `VLIC2`; adding a revocation field to a
license payload; making revocation a `VLIC3`; re-signing an old license to "undo" a
revocation; deleting license history; a network revocation service or customer
callback (ADR-0048 Decision 3 stands).

**Protocol design requirement, satisfied before coding.** The design is
[`docs/licensing/revocation-artifact-protocol.md`](../../licensing/revocation-artifact-protocol.md).
It is normative for the implementation and preserves PDR-16's canonical-byte
contract by defining the revocation payload as a **new** typed document with its
own canonicalization profile fixed by its own golden vectors — never by editing
the license corpus.

### 10.4 OD-LIC-18 — duplicate signed-artifact import returns the historical result

**Product Owner's decision.** A duplicate import returns the **historical result of
the first successful registration**.

**What is decided.**

- A duplicate import must **not** create a second issuance, a second operation, a
  second customer/installation assignment, a second archive entry, or an audit
  event that represents a new issuance. The first registration stays the only
  issuance fact.
- The response is the original persisted outcome, rendered in a form compatible
  with the existing API contract, plus an explicit indication that this was a
  replay rather than a new registration.
- The **operation identity** and the existing semantic-fingerprint rules of OQ-81
  are preserved: the same operation id from the same artifact is a replay; a
  different artifact claiming the same operation id is a **conflict**, not a
  replay, and is refused.
- **Authorization is checked before the replay response is returned.** A caller
  who lacks `licenses.import`, is disabled, or must change password receives the
  denial, never a historical record. A replay is not an authorization bypass.
- Mutable display metadata (for example a customer's display name or a
  human-entered note) is **not** part of the semantic fingerprint, because a
  legitimate later edit to a name must not turn a replay into a conflict.
- If the existing public response contract could not express the historical result
  without a DTO change, the implementation must stop and report that conflict.
  In this repository the import endpoint is introduced by this same work, so the
  contract is defined once, here, and no published DTO is altered.

### 10.5 OD-LIC-19 — indefinite retention, backup and recovery of signed artifacts

**Product Owner's decision.** **Indefinite retention**, with backup and recovery
testing.

**What is decided.**

- The **exact original bytes** of every registered signed license artifact and
  every registered signed revocation artifact are stored in the approved durable
  filesystem archive, **separate from PostgreSQL**. A historical artifact is never
  regenerated and presented as the original.
- Downloads are authorization-gated (`licenses.download` / `OWNER_ADMIN` for
  revocation evidence as defined by the protocol) and every access is auditable
  under the established policy. The database holds integrity metadata
  (SHA-256, size, store key) and a stable reference to the Owner operation.
- **Backup and restore procedures are documented**, including integrity
  verification after restore. Recovery from a missing or corrupt artifact file, and
  from an inconsistent database/archive state, is implemented and tested.
- PostgreSQL and the filesystem are **not** claimed to be one atomic transaction.
  Registration uses **explicit staged states** and a recoverable reconciliation
  step; no response ever claims durability that was not verified.
- **Indefinite retention means no automatic deletion policy** for these artifacts.
  It does **not** add a WORM requirement (PDR-18 §3 already removed WORM from the
  MVP).
- Secrets, private signing keys, credentials and unrelated customer data are
  **never** included in archive bundles or artifact downloads.

### 10.6 Registry effect

OD-LIC-15…OD-LIC-19 are product decisions. They do **not**, by themselves, close
the OQ rows they touch: OQ-74 (compromise/rotation rollout), OQ-75 (vocabulary
evidence), OQ-78 (revocation policy and local effect), OQ-81 (replay contract),
OQ-91 (artifact storage evidence) remain **OPEN for implementation and conformance
evidence**. OQ-85 and OQ-90 are untouched. What changes is that **no product
decision is missing** for the Owner-side lifecycle phases A–E and the revocation
protocol of phase F; the remaining blockers are implementation, evidence and the
explicitly listed open questions in §7 and in the design's §15.
