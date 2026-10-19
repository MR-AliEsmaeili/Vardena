# OQ-78 — revocation, recovery and lifecycle: repository verification and gap assessment (2026-10-19)

**Type:** documentation and dependency assessment only. **No runtime, schema, migration, endpoint, artifact kind, DTO or generated-client change is made or authorized by this document.**

**Registry status:** OQ-78 **remains OPEN**. Recording decision PO-78-01 does not resolve it (see [PDR-18 §11](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md#11-po-78-01--offline-revocation-of-a-perpetual-license-oq-78-2026-10-19)).

**Gate decision:** **`BLOCKED — PRODUCT DECISION REQUIRED`** for OQ-78 implementation. The questions that block it are in §5 and are limited, specific and answerable. Preparatory design may follow the answers; implementation may not start before them.

**Baseline:** `main` = `df494c22b4c0daa3b4ea285939ada3a43c799eec` (merge of PR #182, OQ-88 renewal protocol, merged 2026-10-19T12:13:45Z). No other open pull request existed at the start of this work.

---

## 1. Phase A — repository verification

### 1.1 `main` and merge state

| Item | Verified fact | Source |
|---|---|---|
| `main` SHA | `df494c22b4c0daa3b4ea285939ada3a43c799eec` (local `main`, `origin/main` and `gh` agree) | `git rev-parse`, `gh pr view 182` |
| Latest licensing merges | PR #182 OQ-88 renewal (`df494c2`); PR #181 OQ-74 signing-key tracking (`8cd9b53`); PR #180 OD-LIC-06 design; PR #176 C11 pin | `gh pr list --state merged` |
| CI on `df494c2` (push) | run `39250424498`: `classify`, `docs`, `backend`, `frontend`, `generated-api-client`, `ci-gate` — all `success` | `gh api …/check-runs` |
| CI on `8cd9b53` (push) | run `39214547967` — `success` | `gh api …/actions/runs` |
| Open PRs at start | none | `gh pr list --state open` |

The OQ-88 renewal protocol (PR #182) is on `main`. The OQ-74 metadata slice (PR #181) is on `main`. Neither is OQ-78 work.

### 1.2 Documents read from `main`

Read in full or in the sections relevant to licensing: `docs/open-questions.md`; `PDR-11` (§§9, 10, 20, 21, 22); `PDR-18` (§§1–10); `licensing-oq-74-signing-key-compromise-response.md`; `oq-81-idempotent-replay-technical-design.md`; `licensing-requirements-evidence-matrix.md`; `STATE.md` (§§32–52 and the closing OQ-88 entry); plus `docs/licensing/version-model-and-file-exchange.md` §§8, 13; `docs/tasks/licensing-open-decisions-brief.md` §3; `docs/tasks/licensing-owner-side-phase-0-readiness.md` (R-7, D-6); `docs/decisions/product/README.md`.

### 1.3 Code and test state for OQ-78, OQ-74 and OQ-81

Presence of a document or test is not proof of implementation. The table records what the code does and what the tests cover.

| Area | Code state (verified in source) | Test state (verified by grep of specs) | Conclusion |
|---|---|---|---|
| **OQ-78 revocation** | No revocation artifact kind. `LICENSE_DOCUMENT_KIND = 'SERVER_LICENSE_VERSION'` (`backend/src/modules/licensing/domain/license-document.ts:51`). No revocation state, table, permission or endpoint. Owner `operationKinds` = `LICENSE`, `SERVER_REPLACEMENT` only (`owner-licensing/backend/src/domain.ts:316`). Owner comment: no cancellation state is defined (`domain.ts`, manual observation vocabulary, ~line 305). | No spec mentions a revocation operation. | **Not implemented.** Matrix F2–F5 are correct. |
| **Non-ACTIVE status on import** | The import pipeline refuses any payload whose `status !== 'ACTIVE'` with reason `not-active` (`backend/src/modules/licensing/application/license-import.service.ts:553–555`). Parsers accept `ACTIVE | EXPIRED | SUSPENDED` (`license-document.ts:624`, `license-code.ts:288`). | No spec exercises the `not-active` import refusal (grep finds it only in `client-devices.repository.spec.ts`, as `license-not-active`). | **Correction to the brief.** `licensing-open-decisions-brief.md` §3 says a signed `SUSPENDED` document "already results in BLOCKED". In the current code it is parsed and then refused at import, so it is never persisted and never produces BLOCKED. `BLOCKED` is reachable only through domain evaluation (`license.ts` `evaluateLicense`, `status !== 'ACTIVE'`), with no persisted writer. The domain behaviour is covered by `license-grace.spec.ts:72–78` and `licensing-grace.spec.ts:137`. |
| **Perpetual licenses** | `validUntil = null` never reaches `expired`; no revocation path exists, so a wrongly issued perpetual license cannot be withdrawn (R-7 in the Phase 0 readiness record, still correct). | Grace tests cover finite expiry. | Confirmed gap (the subject of PO-78-01). |
| **Grace/Read-Only** | Implemented for natural expiry only (`license.ts` `evaluateLicense`; ADR-0049). Revocation outcome (`status` inactive) maps to `BLOCKED`, which gets no Grace — matching PDR-18 §4.2. | `license-grace.spec.ts`, `licensing-grace.spec.ts`, `authorization-readonly.spec.ts`. | Reusable: a revocation that sets an inactive status already yields the outcome PDR-18 §4 requires. The distinct *reason* is not stored (see §3, area 4). |
| **Restricted recovery access** | None. Login does not reference licensing (`backend/src/modules/identity/application/authentication.service.ts` has no licensing reference). Licensing gate is a frontend stage after the session (`frontend/src/app/layouts/license-gate.tsx`). `Licensing.*` is exempt from the license filter (`isPlatformPermission`), so an authenticated holder of `Licensing.License.Activate` can import in every access mode. | `licensing-rbac.integration.spec.ts`. | Partly reusable (the exemption and the bootstrap path exist); the independent recovery surface, session model and its permission boundary do not exist. |
| **Session revocation (identity)** | `session-revocation.consumer.ts` revokes a user's sessions on `User.Disabled` and password reset. It is not triggered by any licence event. | `password-transition.spec.ts` (identity). | Pattern exists; no licence trigger. |
| **OQ-74 (signing keys)** | Administrative metadata, status and compromise-review labels are on `main` (PR #181; `owner-licensing/backend/src/signing-keys.ts`, migration `006`). It is explicitly *not* cryptographic proof, key custody, generation or trust rollout (OQ-74 record). Customer trust is still the static `LICENSE_SIGNING_PUBLIC_KEYS` list (`docs/licensing/version-model-and-file-exchange.md` §2.3). | `signing-keys.test.ts`, `api.test.ts` (Owner); customer `license-document.spec.ts` (rotation). | Metadata done; custody, containment and trust-rollout design remain open (U-1). |
| **OQ-81 (replay)** | v2 duplicate operation or hash is refused as `duplicate-operation` with no receipt (`license-version.ts:1420–1423`). No durable receipt, no replay envelope. | `duplicate-operation` asserted in `license-import.service.spec.ts` and `license-version.spec.ts` (refusal only). | Gap confirmed. Design only (`oq-81-idempotent-replay-technical-design.md`); replay DTO still an open question. |

---

## 2. PO-78-01 — recorded decision (Phase B summary)

- **Canonical location:** [PDR-18 §11](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md). The PDR-18 scope line points to it.
- **Cross-references:** OQ-78 row and a dated reconciliation entry in [`docs/open-questions.md`](../open-questions.md); row F2 (plus F3–F5 status wording and an addendum) in [`licensing-requirements-evidence-matrix.md`](licensing-requirements-evidence-matrix.md) §F; index row in [`docs/decisions/product/README.md`](../decisions/product/README.md).
- **Identifier:** `PO-78-01` is used as instructed; no other identifier was created.
- **Effect:** only F2 changes status (from *Open — decision* to *Product policy decided; implementation open*). OQ-78 stays OPEN.

---

## 3. Phase C — OQ-78 gap split (product decided vs technical gap)

Each row: approved product decision → code evidence → real gap → files → dependencies → acceptance test → status. "Product" means a Product Owner decision is needed; "Technical" means engineering design under an existing decision.

**1. Independent authentication and restricted-recovery session**
- *Product decision:* PDR-11 §10.3 — the System Administrator enters a restricted license/recovery interface via the approved identity process, independently of ordinary commercial login; no general commercial access.
- *Code evidence:* no restricted surface; login not licence-aware; licence gate is post-session UI only (§1.3).
- *Real gap:* the mechanism is undefined. Whether "independent" means a separate credential, a separate session scope or a second factor is not specified. OQ-06 defers MFA.
- *Files:* `backend/src/modules/identity/application/authentication.service.ts`, `auth.guard.ts`, `frontend/src/app/layouts/license-gate.tsx`.
- *Dependencies:* OQ-06 (MFA), OQ-19 (administrator safety), OQ-14 (roles). **Product question Q4 (§5).**
- *Acceptance:* with commercial login refused by licence, the recovery surface alone is reachable; wrong/absent credentials refused and audited; commercial routes still denied.
- *Status:* **not implemented; product question open.**

**2. Access scope of the recovery path**
- *Product decision:* PDR-11 §10.3 and §10.4 — view state and restriction reason; import valid Owner artifacts through approved validation; essential backup/recovery; no commercial access; importing a cancellation file does not restore ordinary access.
- *Code evidence:* when inactive, `filterLicensedPermissions` removes every non-`Licensing.*` code (`licensing.service.ts`, `isPlatformPermission` exemption). The import route needs `Licensing.License.Activate`. `GET /license/current` needs no permission.
- *Real gap:* the existing filter already blocks commercial routes in an inactive state, which is the desired effect. The gap is that the recovery *set* is not a defined permission group (import of revocation/reactivation artifacts needs a new permission code, e.g. `Licensing.License.Revoke`/`Reactivate`, plus a reason field). The reason text shown to the user is not stored.
- *Files:* `backend/src/modules/licensing/domain/licensing-permissions.ts`, `application/licensing.service.ts`, `api/license-state.view.ts`.
- *Dependencies:* area 1; OQ-75 is Owner-side only and does not decide customer roles.
- *Acceptance:* a holder of only `Licensing.License.Activate` cannot apply a revocation; revocation import requires the new permission(s) plus `Activate`; blocked state exposes only the approved recovery set.
- *Status:* **technical design, after product answers.**

**3. Revocation operation contract, validation and state transitions**
- *Product decision:* PO-78-01 items 1–3, 5–7; PDR-11 §10.5 (binding to the licence and operation), §10.7 (operation identity), §10.6 (reactivation requires a new valid Owner-signed file).
- *Code evidence:* none. No revocation kind, no revocation state, no reactivation.
- *Real gap:* artifact format and kind; binding fields (licence id, installation id, customer code, operation id, action revoke/reactivate, issued-at); verification with the trusted key set; state machine ACTIVE → REVOKED → ACTIVE (restored) with retained history; behaviour for unknown licence, foreign customer or installation, and an artifact older than the current state.
- *Files (expected, not authorized):* `backend/src/modules/licensing/domain/license-document.ts`, `license-version.ts`, `application/license-import.service.ts`, `data/licenses.repository.ts`, `prisma/schema/licensing.prisma`, an additive migration, `docs/licensing/vectors/` (new vectors only), `owner-licensing/backend/src/domain.ts` (new Owner operation kind).
- *Dependencies:* ADR (OQ-78 recommendation C3 requires an ADR before implementation); OQ-74 (trust, §4); OQ-81 (replay, §6); §5 questions 1, 2, 3.
- *Recommendation:* a **new signed artifact kind** for revocation/reactivation. Do **not** reuse `status = SUSPENDED` for this: that would conflate an emergency stop with the legacy `SUSPENDED` vocabulary that OQ-79 classifies only from evidence.
- *Acceptance:* byte-stable canonical vectors for the new kind; existing `CAN-01…CAN-09` and `OK/BAD/ROT` vectors unchanged; a foreign-licence revocation refused with nothing written.
- *Status:* **not implemented; blocked on product questions and ADR.**

**4. Separation of natural expiry, termination, cancellation, revocation and emergency stop**
- *Product decision:* PDR-18 §4 — termination uses natural-expiry Grace (14×24 h UTC); cancellation, revocation and emergency revocation share one *operational* outcome (inactive, no Grace) while their reasons, actors and audit events stay distinct.
- *Code evidence:* `evaluateLicense` gives `BLOCKED` for any non-ACTIVE status with no Grace (`license.ts`). There is no stored *reason* other than `inactiveReason = 'status'`, and no actor/event for a revocation.
- *Real gap:* (a) no revocation reason or event; (b) **contract termination has no signed instrument at all** (L-18.8 is blocked on OQ-78). It is unresolved whether termination is expressed as a signed earlier `validUntil` (which would yield natural-expiry Grace automatically) or as a terminal revocation (which yields no Grace). **§5 question 5.**
- *Files:* `domain/license.ts`, `api/license-state.view.ts`, the audit allowlist in `license.repository.ts`.
- *Acceptance:* revocation → `BLOCKED` and no Grace at the boundary; termination → Grace then Read-Only (if question 5 selects the expiry representation); each path writes a distinct typed event.
- *Status:* **outcome mapping reusable; reason/event and termination representation open.**

**5. Reactivation of the same licence versus reissuance**
- *Product decision:* PDR-11 §10.6 and OQ-78 — reactivation of the same licence keeps its original dates and restores the previous status subject to revalidation; a separate reissue after recovery need not preserve dates; reactivation alone does not renew an expired subscription.
- *Code evidence:* none.
- *Real gap:* how "previous status" and the retained version chain interact with a revocation that occurred mid-term (see §5 question 1 and question 5 on coverage). Whether the revocation consumes or pauses coverage is not specified.
- *Dependencies:* areas 3 and 6; PDR-13 (post-gap recovery) if a lapse results.
- *Acceptance:* reactivation of the same identity keeps `validFrom`/`validUntil` byte-equal; a reissued identity is treated per the answer to §5 question 5.
- *Status:* **product question open (§5 Q1, Q5).**

**6. Audit of operations and prevention of repeated side effects**
- *Product decision:* PO-78-01 item 4 (cause, actor, time, result and history recorded in the Owner system under the approved audit model); PDR-18 §5 (replay returns the historical result, marked, not re-applied).
- *Code evidence:* customer typed events exist for import, transfer, recovery, reduction and devices (`licensing.license_audit_events`). Owner archive exists (OQ-77). No revocation event type on either side. v2 duplicates are refused without a receipt (OQ-81 gap).
- *Real gap:* new event types (customer and Owner); idempotent handling of a replayed revocation after a later reactivation (must not revoke again, and must not restore 50→… style prior state — same pattern as OQ-81 §4.2).
- *Dependencies:* OQ-81 (§6), OQ-77 (archive coverage for new types).
- *Acceptance:* one `revoked` event per applied operation; replay adds no event and does not change current state.
- *Status:* **technical; replay envelope needs product approval (§5 Q6).**

**7. Invalid, foreign, expired or unauthorized files; failure and recovery after failure**
- *Product decision:* PDR-11 §10.10 (no blanket fail-open/closed; invalid artifacts rejected without accepting their claimed authority); PDR-11 §10.6 (offline server stays in its previous state until a valid file is imported).
- *Code evidence:* import rejections for signature, installation, customer and status exist and are audited for verified documents (`rejectVerified`). One-transaction writes and rollback exist (`licenses.repository.ts`).
- *Real gap:* no revocation-specific rejections; no rule for the **validity window of the revocation file itself** (does a revocation expire?) and for **ordering** (revocation arriving before its licence is imported). §5 questions 2 and 3.
- *Acceptance:* invalid/foreign/unauthorized revocation changes nothing and writes a rejection row; failure mid-transaction leaves the prior state; retry after a lost response does not double-apply.
- *Status:* **technical design after §5 Q2/Q3.**

**8. Protection of customer data and Owner/customer separation**
- *Product decision:* PO-78-01 item 6 (no automatic deletion); PDR-11 §10.2; PO-78-01 item 8 (Owner/customer separation remains).
- *Code evidence:* no deletion path exists in licensing; Owner keys are kept out of the customer artifact (`scripts/check-production-artifacts.py`, `scripts/check-owner-isolation.py`, CI image checks). Customers verify with public keys only.
- *Real gap:* no test yet proves that a revocation leaves users, roles, business data and documents untouched; the Owner must not gain customer-database access for revocation.
- *Acceptance:* before/after snapshot of users, permissions and business tables is identical after a revocation and after a reactivation; isolation checks still pass with the new artifact kind.
- *Status:* **acceptance test to write; no code gap identified beyond that.**

**9. Negative, concurrency, retry and offline tests**
- *Existing base:* `license-limit-concurrency.spec.ts`, live-PostgreSQL import and device suites, `license-grace.spec.ts`, OQ-88 A1–A17 renewal cases.
- *Real gap:* no test covers revocation, reactivation, concurrent revoke/import, retry after timeout, or offline verification with a missing or rotated trust key.
- *Status:* **acceptance list to write with the design; executed only in CI (heavy suites are not run locally by policy).**

---

## 4. Phase D — OQ-74 dependency assessment

The question is whether the OQ-78 protocol depends on an unresolved decision about:

| # | Topic | Dependent? | Evidence | Effect on OQ-78 | Product decision unresolved? |
|---|---|---|---|---|---|
| D1 | Trust in the public key and key rotation | **Yes** | Customer trust is the static `LICENSE_SIGNING_PUBLIC_KEYS` list (`version-model-and-file-exchange.md` §2.3); no rotation mechanism; OQ-74 tracks metadata only. PO-78-01 item 3 requires the issuer's authority to be checked, so a revocation is verified by the same trust set. | A revocation signed by a key the installation does not yet trust is refused until a trust update arrives. Offline timing therefore matters. | Operational and technical (trust-rollout design). Partly a product question on whether a trust update is a precondition (see D5). |
| D2 | Key-compromise event and validity of previously issued files | **Yes — the sharpest dependency** | OQ-74 decided: no automatic invalidation of issued licences solely because of compromise. PO-78-01 item 7: no trust in an invalid or compromised key. These two are in tension for *revocation* and *reactivation* artifacts: a forged revocation signed with a compromised key would be a denial of service; a forged reactivation would restore access. | Whether a revocation or reactivation signed by a key later declared compromised still takes effect. | **Yes — a product/security trade-off (§5 Q3).** |
| D3 | Provenance and status of an artifact issued but not yet imported | **Yes** | PDR-11 §20.4 lists it as an open OQ-74 item. A revocation for a licence the customer never imported has no local target. | Unknown-licence revocation: refuse or retain. Ordering affects whether a later import of that licence must be refused. | Mixed: ordering/retention is a product question (§5 Q2); provenance checks are technical. |
| D4 | Issuance, validation and revocation of new files | **Yes** | Owner-side issuance exists (`owner-licensing`); a revocation issuer tool does not. Owner custody is U-1 (open). `development-license-authority.ts` refuses production. | No production revocation can be signed until custody is designed. | Technical and operational (OQ-74 U-1). |
| D5 | Offline recovery where key trust or file provenance cannot be proven | **Yes** | PO-78-01 item 2: local effect only after a validated file. If validation is impossible offline, the revocation has no effect and the wrongly issued perpetual licence keeps working. | This is the core residual risk of PO-78-01 and must be stated to the Product Owner, not resolved by engineering. | **Yes — §5 Q3 and the fail-closed/fail-open wording of PDR-11 §10.10.** |

**Conclusion for D:** the OQ-78 protocol *format* can be drafted without resolving OQ-74, because the existing signature verification and trusted-key boundary are reused. The OQ-78 *acceptance criteria for compromise and offline recovery* cannot be written until §5 questions 2 and 3 are answered and OQ-74's custody and trust-rollout design exists. Nothing in this assessment converts "no blanket invalidation" into a new rule.

---

## 5. Phase E — OQ-81 dependency assessment

**Does OQ-78 depend on the Replay contract?** **Yes.** A revocation or reactivation is an operation with an identity. A retried success must not revoke or reactivate a second time, and the response must show the historical result separately from the current state.

**Approved policy (not an open question):** PDR-18 §5 and PDR-11 §10.8 — a successful duplicate returns the original result, marked as replay, not re-applied, with the current state reported separately.

**Still open:** the response envelope and status code (OQ-81 technical design §4.2). The design's smallest proposal is that first-application responses stay unchanged and a replay returns a marked historical receipt plus a separately named current-state field.

**Stop point (per Phase E):** any OQ-78 API for revocation or reactivation needs a response shape. If it reuses the proposed envelope, that is a public contract change and must be approved first. This document does not turn the proposal into a DTO, envelope or status code.

**Replay question (§5 Q6):**

| Option | Shape | Consequence |
|---|---|---|
| A | HTTP 200; top-level current-state fields as today; additional `replay: true` and a nested `historicalResult` (frozen receipt). | Matches the design proposal. Clients that read top-level fields see current state, as they should. Requires the receipt table (additive migration). |
| B | HTTP 200; top-level fields are the historical result; `replay: true`; current state under `currentState`. | Keeps historical data in the familiar place, but a client reading top-level fields may mistake it for current state, which PDR-18 §5 forbids. **Not recommended.** |
| C | HTTP 409 `already-applied` with a pointer to the operation and no historical body. | Simplest, but it does not return the historical result that PDR-18 §5 requires. **Not compatible with approved policy** unless the Product Owner revises §5. |

**Recommendation:** Option A, subject to Product Owner approval of the envelope. Until approved, no replay envelope is implemented for any licensing operation, including the existing transfer, recovery and reduction routes.

---

## 6. Phase F — implementation readiness

**Decision: `BLOCKED — PRODUCT DECISION REQUIRED`** for OQ-78 implementation.

Reason: PO-78-01 settles *whether* offline revocation of a perpetual licence is permitted. It does not settle the following, which cannot be decided by engineering without changing product behaviour or security posture.

**Product Owner questions (limited, answerable):**

1. **Revocation scope within a version chain.** When a licence identity is revoked, which versions are affected?
   - (a) The whole licence identity: all retained versions and any scheduled renewal. *Consequence:* simplest; reactivation must restore the chain explicitly.
   - (b) Only the version governing at the revocation instant; scheduled successors stay on file. *Consequence:* a successor could still take effect after a revocation, which may be unwanted.
   - *Recommendation:* (a), because a revocation of a wrongly issued perpetual licence should not leave a scheduled successor active.

2. **Validity and ordering of a revocation file.**
   - 2a. Does a revocation file expire? (a) No — it is monotonic and applies whenever imported; (b) Yes, after N days. *Consequence of (b):* a customer can wait out the window. *Recommendation:* (a).
   - 2b. A revocation arrives for a licence not yet imported. (a) Refuse it, so the Owner must import in order; (b) retain it and refuse the later import of that identity. *Consequence:* (b) fails closed against a wrongly issued licence that arrives late. *Recommendation:* (b), if the Owner accepts that a retained revocation may block a later valid import of the same identity.

3. **Compromise and offline validity (PO-78-01 item 7 versus OQ-74).** If a signing key is later declared compromised:
   - (a) Revocations and reactivations signed by any key still in the installation's trust list take effect. The compromise is handled by trust-list removal only, so a forged reactivation signed before removal could still restore access. *Consequence:* consistent with OQ-74, but leaves a window.
   - (b) Only artifacts signed under the current key generation take effect after a declared compromise. *Consequence:* needs an Owner key-generation model in OQ-74 U-1 before it can be built.
   - *Recommendation:* decide after the OQ-74 custody design; until then, no compromise-specific acceptance criteria are written.

4. **Recovery credential.** PDR-11 §10.3 says "independently of ordinary commercial login" using "the approved administrator identity/authentication process".
   - (a) The existing System Administrator account and its normal credentials, with the recovery permission; (b) a separate credential or second factor for the recovery surface; (c) defer until OQ-06 (MFA) is decided.
   - *Consequence:* (b) adds an identity lifecycle the product does not yet have. *Recommendation:* (b) if "independent" is meant literally; otherwise (a) with explicit audit.

5. **Coverage after a revocation, and contract termination.**
   - 5a. After a revocation, does the lapsed interval count as a post-gap lapse (PDR-13) when a new identity is later issued? (a) Yes, the same recovery operation applies; (b) No, a revocation is terminal and a new identity is a separate commercial decision. *Recommendation:* (a), so that PDR-13 controls remain the only route.
   - 5b. Contract termination: (a) a signed earlier `validUntil` (natural-expiry Grace follows, per PDR-18 §4.1); (b) a terminal revocation (no Grace). *Consequence:* (a) reuses the expiry path; (b) gives no Grace. *Recommendation:* (a), which matches PDR-18 §4.1 literally.

6. **Replay response envelope for revocation and reactivation (§5 above).** Option A, B or C. *Recommendation:* A.

**Preparatory work allowed now:** none beyond this document. The next step after the answers is an ADR and technical design for the revocation artifact, followed by acceptance tests (§3, areas 1–9). Implementation, schema changes, migrations and endpoint changes are not authorized.

---

## 7. Tests and verification

| Item | Status |
|---|---|
| Local heavy test suites (backend unit, live PostgreSQL, E2E, migrations, Docker) | **Not run.** Policy: heavy suites run only in GitHub Actions. |
| Local light checks | Listed in the PR evidence after execution (`git diff --check`, `python3 scripts/check-docs-links.py`). |
| Revocation acceptance tests | **None exist.** The §3 list is a requirement set to test, not a passing test. |
| CI for the documentation PR | Reported in the PR description for its exact final head. A green documentation PR does not mean OQ-78 is complete or accepted. |

---

## 8. Related records

- [PDR-18 §11 — PO-78-01](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md)
- [PDR-11 §§10, 20, 21](../decisions/product/PDR-11-vardena-licensing-product-requirements.md)
- [OQ-74 record](licensing-oq-74-signing-key-compromise-response.md) · [OQ-81 design](oq-81-idempotent-replay-technical-design.md) · [Evidence matrix](licensing-requirements-evidence-matrix.md)
- [Open-decisions brief §3](licensing-open-decisions-brief.md) (contains the `SUSPENDED → BLOCKED` statement corrected in §1.3) · [Phase 0 readiness R-7](licensing-owner-side-phase-0-readiness.md)
