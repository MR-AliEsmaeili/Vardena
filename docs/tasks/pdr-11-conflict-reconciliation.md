# PDR-11 §19 conflict reconciliation and §15 open-item audit

| Field | Value |
| --- | --- |
| Status | Reconciliation complete for the first licensing implementation slice (L-03); open items preserved and registered. **Corrected 2026-10-11** after the Product-Owner review of PR #137 (§0): CF-1/CF-2 and the concurrency evidence were re-stated against the fixed implementation. **Post-merge verification 2026-10-11 (§6):** PR #137 is merged at `345047a`; findings F-1…F-17 are in `docs/tasks/licensing-post-merge-reconciliation.md`; the new reason `license-binding-conflict` is pending ratification. No CF row was re-stated by that verification. **Merge-state correction 2026-10-12:** those fixes reached `main` only through PR #138, merge commit `d283744b4098346b6ef2e0b91922266f10cdabd1` (merge-commit CI green, run `38210710188`). `345047a` does **not** contain `license-binding-conflict` (`git grep license-binding-conflict 345047a -- backend/src` → no match); read `d283744` as the SHA where the refusal exists. Merged is still not Owner-accepted, and the reason is still pending ratification. See §14 of the reconciliation report and `docs/tasks/licensing-pr-138-post-merge-verification-and-l-04-readiness.md`. |
| Date | 2026-10-11 |
| Baseline inspected | `main` at `f27065149ffcb3b6d62929e418a8c6c1b4ce8fea` (merge of PR #136), plus the session branch `arena/5fd62737-vardena` |
| Authority order | accepted ADRs and Owner decisions → PDR-11 (product source) → current implementation, migrations, tests → canonical registries → historical reports |
| Authority | [ADR-0046](../adr/0046-signed-license-documents-and-version-lifecycle.md) · [design record](../licensing/version-model-and-file-exchange.md) · [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) §19.4 |
| Product policy | No open product question is decided here. Every genuinely unresolved item is registered as `OQ-74`…`OQ-85` and cross-referenced from PDR-11 §15. |

Method: every conflict in PDR-11 §19.2 was re-read against the code, migrations,
docs and registries on the baseline SHA; each row below states what was actually
changed (code, migration, doc, ADR) and what evidence supports the claim. Nothing
is reported as implemented unless it exists and a test covers it.

Classification used for each item:

- **CONFLICT** — two records state incompatible behaviour; the product text wins
  where it is approved, and the code/doc changed.
- **STALE DOC** — the record was simply out of date; it was corrected.
- **EXTENSION** — the approved requirement adds behaviour the old record never
  contradicted; it was added where a decision existed and deferred where not.
- **OPEN POLICY** — the question is genuinely undecided; it is preserved,
  registered, and the implementation fails closed around it.
- **PROCESS** — repository governance, not product behaviour.

## 0. Corrective review of the first slice (Product-Owner review of PR #137)

The first slice passed its own tests but two defects were found by review. Both
are fixed on the same branch/PR (no new PR) and both changed the claims this
document is allowed to make, so they are recorded here **before** the matrix.

### Defect 1 — a future-dated supersession invalidated the current license

- **Root cause.** The data layer stamped the predecessor with
  `superseded_at = <import instant>` and eligibility was defined as
  `superseded_at IS NULL`, so importing an overlapping successor that starts in
  2027 removed the license that is valid today. The non-overlapping-renewal case
  (which the matrix used as evidence) never exercised this path.
- **Fix.** Supersession is now two facts: `superseded_at` (when it was recorded)
  and `governs_until` (the successor's own `validFrom` — when the predecessor
  stops governing). Eligibility is `governs_until IS NULL OR governs_until > at`;
  the predecessor keeps governing until the hand-over and the successor takes
  over at its own start, half-open. A version is never governing after its
  successor's window begins, so the retained effective windows stay pairwise
  disjoint.
- **Evidence.** `license-import.service.spec.ts` › `future-dated supersession`
  (pinned clock, no sleeps: before / at / after the hand-over, the retired
  predecessor never returning, a failed successor import leaving state
  untouched, a second successor refused, an overlapping future-dated document
  refused); `license-import.e2e-spec.ts` › "keeps the governing license effective
  while a future-dated successor waits (CF-1)"; `license-version.spec.ts` (the
  two-instant rules and the disjoint-window invariant); the rehearsal's
  premature-retirement database.
- **Compatibility.** Non-overlapping renewals behave exactly as before (no
  supersession is recorded at all in that case), and legacy `VLIC1` codes keep
  their documented L-02 lifecycle.

### Defect 2 — concurrent imports could commit conflicting windows

- **Root cause.** The overlap/supersession check was a read in application code
  before the transaction. Two distinct documents (so no unique index applies)
  could both pass it and both commit windows that overlap. The
  `operation_id` / `document_hash` unique indexes protect replay, not window
  compatibility.
- **Fix.** The import transaction takes a `SELECT … FOR UPDATE` lock on the
  installation row **before** it reads, re-runs the same conflict evaluation
  (`evaluateImportConflicts`) inside that lock in READ COMMITTED, and refuses the
  import if the version it would retire is not the one the read-side pass
  resolved. The loser of a race gets the documented `409` reason and writes
  nothing (no version, entitlement, supersession stamp or `applied` audit event);
  a rejection audit row is written outside the transaction, as for every other
  rejection. The lock is a database row lock — multi-process by construction; a
  process-local mutex is explicitly not the mechanism.
- **Evidence.** `licensing-persistence-live.e2e-spec.ts` on real PostgreSQL:
  three rounds of two concurrent imports with the same window; two concurrent
  imports of the same document; two concurrent successors of one version
  (exactly one stamp, the loser refused); a **late** transaction failure
  (duplicated entitlement) rolling back customer/license/installation/version/
  audit; and the disjoint-window invariant plus the supersession pair re-asserted
  directly in SQL. Unit tests are **not** accepted as evidence for this defect.
- **Result.** The suite ran on GitHub CI and passed on the head of this branch
  (run `38164310367`, head `fae7f8c`; backend and frontend jobs green). The
  preceding run of the same branch (`38163440380`, head `8887dae`) already
  executed it and every operation-scoped assertion held — the loser's `409`, the
  winner's single version row, the loser's zero versions and zero `applied`
  events — but that run failed on one harness assertion which compared a count of
  the **whole** audit table (also carrying `rejected`, `unchanged` and
  `license.version.superseded` rows) with an applied-only baseline of `4`,
  reading `10` where it expected `6`. The check was replaced by the invariant it
  was meant to assert: **this installation's** applied events, in order, must
  gain exactly the winner's operation id, and a failure prints the
  installation's audit trail.
- **Why not `SERIALIZABLE` alone.** It answers with retryable serialization
  failures instead of the documented conflict reason; the row lock makes the
  semantics explicit and keeps the conflict machine-readable (design §3.4).

### Corrections to the matrix

- **CF-1** was marked RESOLVED on the strength of the non-overlapping renewal.
  The non-overlapping case was always correct; the *overlapping future-dated
  successor* was not. The row now states both and cites both.
- **CF-2** was marked RESOLVED for the same reason. A future-dated document that
  overlaps a version still governing is **still refused** (409
  `overlapping-range`) unless it declares an explicit signed supersession — a
  future start never excuses an overlap, and no general precedence rule was
  invented (PQ-5 → `OQ-80` stays open).
- The matrix and the design record no longer claim concurrency safety except
  where the live PostgreSQL suite proves it (§4).

## 1. Conflict matrix (CF-1 … CF-22)

| ID | Classification | Affected records / code | Resolution | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| CF-1 | CONFLICT | ADR-0045 (was 0036) Decision 6; `uq_licenses_installation_current`; `licenses.repository.activate()` | The single-current-license model is replaced by retained versions under one license; the partial unique index is dropped by migration. Two cases, both required: (a) a **non-overlapping** future-dated renewal is retained without touching the governing version; (b) an **overlapping future-dated successor** (explicit signed supersession) is retained and leaves the governing version in force until the successor's own `validFrom` — supersession is recorded (`superseded_at`) separately from when governance ends (`governs_until`). Fixed in the corrective review (§0 Defect 1); case (a) alone had been cited as evidence and was insufficient. | ADR-0046 Decision 4 (corrected); design §3.1–§3.3, §11; migrations `20261014000000_…` + `20261015000000_licensing_supersession_governs_until`; `license-import.service.spec.ts` › future-dated supersession (pinned clock); `license-import.e2e-spec.ts` › CF-1 case; `license-version.spec.ts`; rehearsal premature-retirement database | **RESOLVED** (corrected: both timelines proven, disposition unchanged) |
| CF-2 | CONFLICT | ADR-0045 Decision 7 step 5; `license-activation.service.ts` | A not-yet-valid signed document is no longer refused at import: it is validated, retained and becomes effective at its own `validFrom`. Effective-version resolution reports `not-yet-valid` only when nothing else covers or has ended. Being future-dated does **not** waive the overlap rule: a future-dated document whose window overlaps a version that still governs is refused (409 `overlapping-range`) unless it declares an explicit signed supersession — and when it does, the predecessor keeps governing until that start (§0 Defect 1). | ADR-0046 Decisions 4–5 (corrected); design §3.2–§3.3; `license-version.spec.ts`; `license-import.service.spec.ts` (future-dated supersession, refused overlapping future document); `license-import.e2e-spec.ts` | **RESOLVED** (corrected: the "future-dated" path no longer rests on the non-overlapping renewal) |
| CF-3 | CONFLICT | ADR-0045 Decision 4 (`VLIC1` text code as delivery) | Signed **files** are the primary transport (versioned envelope carrying a `VLIC2` artifact); text is the same artifact without the envelope. Both enter one verification pipeline, so text is not a weaker path. Legacy `VLIC1` codes still import. | ADR-0046 Decision 1; design §2; `license-document.spec.ts`, `license-import.e2e-spec.ts`, frontend file+text tests | **RESOLVED** (import path) |
| CF-4 | OPEN POLICY | ADR-0030 (licensing vs authentication); ADR-0045 Decision 12; `docs/security.md`; frontend UX §4 | Full revocation is **not implemented**. The conflict (revocation stops System Administrator login vs "license state never ends a session") is preserved as an Owner decision and registered; the design records only the binding constraint that recovery must not depend on an ordinary licensed session. | ADR-0046 §8; OQ-78; no code path added | **OPEN** — registered `OQ-78` |
| CF-5 | CONFLICT / EXTENSION | ADR-0045 Decision 1 + Consequences ("restoring a backup restores the identity and its license") | Import never creates, recreates or adopts an installation identity: a document for an unknown installation is rejected and leaves no installation row. A database restore without the identity material cannot silently become the previous installation — it fails binding. Recovery stays an Owner-side process. | design §7; `license-import.service.spec.ts` ("wrong installation"); live e2e (no installation row created) | **RESOLVED** for the import path; restore semantics documented |
| CF-6 | EXTENSION | ADR-0045 Decision 1 (ULID identity, no key material) | Installation **id** and installation **identity key** are designed as separate facts; the key is **not implemented** because its storage depends on the backup-encryption design (U-2) and its loss path on the replacement workflow (U-9/PQ-3). Blocker recorded, not guessed. | design §7; ADR-0046 Decision 8; OQ-78 (recovery) · OQ-82 (replacement) | **PARTIALLY RESOLVED** — design recorded, implementation blocked and documented |
| CF-7 | EXTENSION | ADR-0045 Consequences ("revocation not implemented") | Signed offline revocation/reactivation remains unimplemented and is gated. The **import pipeline** it will reuse (operation id, binding, replay, retention, audit) now exists and is tested. | ADR-0046; design §§4–5, §13 | **PARTIALLY RESOLVED** — foundation implemented, revocation slice gated by `OQ-78` |
| CF-8 | EXTENSION | ADR-0045 Consequences (rotation only while both keys are listed) | Ordinary rotation no longer threatens valid licenses: signature verification happens **only at import**, so already-retained versions stay effective regardless of the key list. Trusted keys may carry key ids; an untrusted hint is rejected with its own reason. | ADR-0046 Decision 7; design §2.3; `license-document.spec.ts` (rotation cases); `license-version.spec.ts` | **RESOLVED** for import; emergency policy stays `OQ-74` |
| CF-9 | OPEN POLICY | OQ-45 (Owner decision 2026-10-05: Grace → Read-Only); frontend UX contract §4 | No Grace quantity, duration, outage rule or override authority is invented. The slice adds no expiry enforcement and does not change `EXPIRED` semantics; version selection only changes which version governs. | ADR-0046 Decision 4; design §3.2/§13; OQ-45 unchanged and re-cross-referenced | **OPEN (unchanged)** — `OQ-45` |
| CF-10 | OPEN POLICY | OQ-53; `docs/operations/backup-and-restore.md` §3; PDR-11 §10.1/§10.3 | Restore stays licence-unblocked: import adds no check to any backup, export or restore path, and none of these paths consults licensing at all. The recovery process for full revocation stays undecided. | ADR-0046 Decision 8; design §8; `docs/operations/backup-and-restore.md` annotation; OQ-78 | **OPEN (unchanged)** with the constraint recorded |
| CF-11 | OPEN POLICY | ADR-0030 `SUSPENDED`; `licensing` enum; refusal path | Audited: no write path can persist a non-`ACTIVE` status (activation/import refuses `EXPIRED`/`SUSPENDED`), so `SUSPENDED` is currently unreachable in data. No status value is rewritten or mapped by the migration (values copied verbatim); the mapping decision is registered. | migration (verbatim copy); design §1; `license-import.service.spec.ts` (`not-active`); OQ-79 | **OPEN** — registered `OQ-79`, matrix row preserved |
| CF-12 | CONFLICT / OPEN POLICY | ADR-0045 Decision 6 (`changed: false` idempotency) | Duplicate semantics are defined **by operation type**: a `VLIC2` operation id is rejected on re-application (409, no state change) while a repeated legacy `VLIC1` code keeps its documented idempotent no-op. The asymmetry is documented and the policy question is registered. | ADR-0046 Decision 3; design §5; import service tests, e2e duplicate cases; OQ-81 | **PARTIALLY RESOLVED** — behaviour defined, policy scope registered |
| CF-13 | STALE DOC | `docs/adr/README.md` index row for ADR-0030 | The index said *Proposed* while the ADR file says *Accepted for L-01; extended by ADR-0036 (L-02)*. The index now matches the file. | `docs/adr/README.md` | **RESOLVED** |
| CF-14 | STALE DOC / PROCESS | two files numbered 0036 (licensing, legal reporting) | The licensing record — the one **not** registered in the index — was renumbered to **ADR-0045** (next free id; ADR-0027 stays unused). Decision text unchanged; a renumbering note was added; the former path keeps a pointer file so historical links do not break; live references were updated; historical task/acceptance records were not rewritten. | `docs/adr/0045-…md`, `docs/adr/0036-…md` (pointer), ADR index, `docs/licensing-architecture.md`, `docs/decisions/product/README.md` | **RESOLVED** |
| CF-15 | STALE DOC | `docs/decisions/product/README.md` index | PDR-10 exists as a file and had no index row; the row was added with its real status (C-62 Owner decisions, accounting). | `docs/decisions/product/README.md` | **RESOLVED** |
| CF-16 | STALE DOC | `docs/current-state-reconciliation.md` (licensing rows: "No license schema/module/enforcement") | A dated addendum records the verified current state (L-01/L-02 foundation, and this slice), leaving the historical audit at its audited SHA intact. | `docs/current-state-reconciliation.md` §addendum | **RESOLVED** |
| CF-17 | STALE DOC / DESIGN | `licensing.*` schema vs PDR-11 §14 conceptual entities | The mapping is documented (`License` → `licensing.licenses`, `LicenseVersion` → `licensing.license_versions`, `AuditEvent` → `licensing.license_audit_events`). Schema change was limited to what the design proved necessary: separating license identity from versions so several versions can belong to one license. | design §1; `prisma/schema/licensing.prisma`; migration | **RESOLVED** |
| CF-18 | PROCESS | `.vardena/agent-rules.md` AG-09/AG-07; `docs/open-questions.md` | The Product Owner has now authorized registration. New identifiers were allocated only after checking the central registry and the repository for the next free id (`OQ-73` is taken; `OQ-74`…`OQ-85` are new). Each registered row carries its PDR-11 source id. No id is duplicated or invented out of order. | `docs/open-questions.md` (Open table + log); this document §2 | **RESOLVED** |
| CF-19 | OPEN POLICY | `docs/licensing-architecture.md`; ADR-0030 (CRM deferred); OQ-61 | The Owner-side issuance **boundary** is fixed: signing stays outside the product, no private key is stored or served by the application, and the repository's CLI issuer refuses `NODE_ENV=production`. Where the Owner-side system lives, and CRM/billing, remain out of scope and registered/cross-referenced. | ADR-0046 Decision 9; design §10; `src/tools/development-license-authority.ts`; OQ-85 (cross-ref OQ-61) | **PARTIALLY RESOLVED** — boundary fixed, home undecided (`OQ-85`) |
| CF-20 | STALE DOC | `docs/licensing-architecture.md` ("signed offline files … DEFERRED"); `docs/adr/0030-license-foundation.md` status line; `docs/modules.md` §Licensing | The owning documents now describe the implemented signed-file import, the version model, replay protection and the audit trail, and list exactly what remains deferred; ADR-0030's status line points at ADR-0045/ADR-0046 instead of the renumbered 0036. | `docs/licensing-architecture.md`; `docs/adr/0030-license-foundation.md`; `docs/modules.md` | **RESOLVED** |
| CF-21 | STALE DOC | `license-activation.service.ts` comments (mentions a `revoked` lifecycle) | The stale comments are gone with the service: the import pipeline's comments, the design record and ADR-0046 state the real vocabulary (`ACTIVE`/`EXPIRED`/`SUSPENDED`, `UNLICENSED`, revocation unimplemented). | backend source; design §1–§4 | **RESOLVED** |
| CF-22 | PROCESS | AG-02 branch naming | The session branch is fixed by the environment (`arena/5fd62737-vardena`) and is the only branch touched; the repository's `feat/…` convention could not be used for this session, exactly as PDR-11 §19.2 CF-22 recorded. One concern (licensing reconciliation + slice) per branch, per PR. | branch history; PR description | **RESOLVED (documented process deviation)** |

## 2. §15 open-item audit (Workstream B)

Disposition of every PDR-11 §15 item. "Registered" means a row now exists in
`docs/open-questions.md` with the PDR-11 source id; "answered by" names the
existing Owner decision or design record that settles it.

| Item | Question | Disposition | Blocks the first slice? |
| --- | --- | --- | --- |
| U-1 | Emergency signing-key compromise policy | **OPEN — registered `OQ-74`.** Ordinary rotation is answered by design (CF-8); the compromise policy is a security decision and is not invented. | No — only signing-key emergency handling |
| U-2 | Exact backup cryptographic design | **Design item, deferred with the blocker recorded.** It gates the installation identity key (CF-6), not import. | No |
| U-3 | Exact file formats and protocols | **Answered for server license versions by the design** (ADR-0046, design §2/§11). Revocation/reactivation/receipt/device formats stay open with their slices. | No |
| U-4 | Precise state machines | **Answered for license versions and revocations-by-import** (design §3/§5). Replacement, device and Owner-side status machines stay open. | No |
| U-5 | Detailed Owner role permissions | **OPEN — registered `OQ-75`.** Owner-side system is out of this slice. | No |
| U-6 | Clock-rollback thresholds and edge cases | **OPEN — registered `OQ-76`.** No rollback detection is implemented; thresholds are not invented. | No |
| U-7 | Audit schema and retention | **Schema answered** (typed `license_audit_events`, design §9); **retention and sensitive-data policy OPEN — registered `OQ-77`.** | No |
| U-8 | Backward compatibility / versioning rules | **Answered** (payload `v`, envelope `fileVersion`, legacy `VLIC1` acceptance, migration of existing data). | No |
| U-9 | Offline replacement failure recovery | **OPEN — registered `OQ-82`** (server replacement) and `OQ-83` (client device). The slice implements no replacement. | No |
| PQ-1 | Grace stage at subscription expiry | **OPEN (unchanged) — `OQ-45`.** Re-cross-referenced; no behaviour added. | No |
| PQ-2 | Restricted mode vs OQ-45 Read-Only, module detail | **OPEN (unchanged) — `OQ-45`.** | No |
| PQ-3 | Full revocation and recovery; restore rule | **OPEN — registered `OQ-78`.** The restore rule stays as recorded (G-9) and import adds no gate. | No (revocation slice only) |
| PQ-4 | `SUSPENDED` mapping | **OPEN — registered `OQ-79`.** Audit performed (see CF-11); no lossy migration. | No |
| PQ-5 | Overlapping or gapped subscription versions | **OPEN — registered `OQ-80`.** Interim, fail-closed design: overlap rejected unless explicitly superseded by the signed document; gaps allowed (design §3.3). | No — the interim rule is deterministic and grants nothing extra |
| PQ-6 | Quota effect of device replacement | **OPEN — registered `OQ-83`.** No device licensing implemented. | No |
| PQ-7 | Owner-side system ownership and location | **OPEN — registered `OQ-85`, cross-referencing `OQ-61`.** | No |
| PQ-8 | Duplicate-operation rule scope | **OPEN — registered `OQ-81`.** Per-operation-type behaviour defined and documented (CF-12). | No |
| PQ-9 | Activation receipts for ordinary activation | **OPEN — registered `OQ-84`.** No receipts implemented; import responses are not receipts. | No |

Additional answers recorded (not §15 items): `docs/operations/backup-and-restore.md`
§3 keeps "restore is never blocked by license state"; `docs/security.md` keeps
licensing/authentication independence; the pinned deployment-organization
provisioning deferral is unchanged.

## 3. Scope guards honoured

- Test/training/sandbox entitlements: **not touched** (PDR-11 §17.1).
- CRM, billing, payments, pricing, contract termination: **not touched**
  (PDR-11 §17.1, §4.1).
- No environment variable, role, administrator, username or frontend state
  bypasses licensing (G-1); the import endpoint requires an ordinary RBAC
  permission, and the licensing capability itself remains the single documented
  bootstrap exception under `isPlatformPermission` (ADR-0030/ADR-0045, unchanged).
- No destructive automatic action on capacity or entitlement reduction (G-4): the
  slice performs no deactivation, deletion or correction, and reports no capacity
  conflict it cannot honour.
- Restore is not blocked (G-9): no licensing check exists on any restore path.
- Normal operation requires no internet (PDR-11 §11.1): import is fully local.

## 4. Delivered evidence on this branch (`arena/5fd62737-vardena`)

Written after the matrix above was committed; every path below exists on the
branch. Local runs cover the fast suites; the database-backed suites and the
migration rehearsal run on GitHub CI (this session has no PostgreSQL server),
and GitHub CI on the exact PR head is the authoritative evidence. Run
**`38164310367` on head `fae7f8c`** is the corrective-review evidence (backend
and frontend green, including `Migrate test database`, `Migration rehearsal
(Licensing version model and import)` and `E2E tests (incl. live-DB suites)`);
the temporal directive ran the same steps **green in run `38169257077` on head
`df41f73`** (§5), so the live-DB evidence of §5 is from the temporal rule's own
head and not from an earlier SHA. The JUnit-style failure inventory step was
skipped in both runs because nothing failed.

| Artifact | What it is | Where it ran |
| --- | --- | --- |
| `backend/prisma/migrations/20261014000000_licensing_version_model_and_import/` | Non-lossy backfill of every license row into retained versions + version entitlements + typed audit trail; drops the L-02 single-current partial index | GitHub CI (`prisma migrate deploy`) |
| `backend/prisma/migrations/20261015000000_licensing_supersession_governs_until/` | Corrective migration (§0 Defect 1): adds the hand-over instant, backfills it from the recorded successor (repairing prematurely retired versions) or from the recorded instant, and constrains the two instants to be set together | GitHub CI (`prisma migrate deploy` + rehearsal) |
| `backend/prisma/rehearsal/licensing-version-model/rehearse.mjs` (`npm run test:licensing-version-rehearsal`) | Fixture rehearsal over a disposable database: populated pre-migration shape through the migration, asserting preserved statuses/ids/hashes/limits/windows, moved entitlements, one eligible version per licensed installation, retained superseded history, the new unique guards, and fail-closed refusal of data the model cannot represent | GitHub CI (`Migration rehearsal (Licensing version model and import)`) |
| `backend/src/modules/licensing/domain/license-document.ts` + `license-document.spec.ts` | `VLIC2` artifact, versioned file envelope, trusted-key rotation with key ids, canonicalization, strict payload validation, transport decode | local unit run (14 tests) |
| `backend/src/modules/licensing/domain/license-version.ts` + `license-version.spec.ts` | Half-open windows, eligibility at an instant, the two supersession instants, deterministic effective-version resolution, the single conflict authority (`evaluateImportConflicts`), the temporal refusal of a supersession that would remove already-exercised governance (`supersessionRewritesPastGovernance`, OQ-86), latest-ended/earliest-future classification, and the disjoint-window invariant over a mixed retained set | local unit run (33 tests) |
| `backend/src/modules/licensing/application/license-import.service.ts` + `license-import.service.spec.ts` | The single 10-stage pipeline: transport → verify → bind → payload → lifecycle → replay → supersession → overlap → **locked transaction that re-runs the conflict evaluation** → state; rejection order and audit events; the future-dated-supersession timeline on a pinned clock (no sleeps), the hand-over boundary at the import instant, the refused backdated supersession with full rollback, the still-allowed correction of an already-ended version, and the two surviving legacy paths | local unit run (31 tests) |
| `backend/src/modules/licensing/data/licenses.repository.ts` | The import transaction: per-installation `FOR UPDATE` lock (the one documented raw statement), in-transaction evaluation, guarded supersession stamp writing both instants, audit rows in the same transaction | local typecheck + lint; behaviour proven by the live suites and the rehearsal |
| `backend/test/license-import.e2e-spec.ts` | Route-level end-to-end over the real pipeline with in-memory stores: file/text/legacy transports, restart persistence, duplicate 409, overlap 409 then explicit supersession (future-dated, clock-independent), the refused backdated supersession, foreign installation, stranger key, malformed bodies, 401/403 | local e2e run (13 tests) |
| `backend/test/licensing-persistence-live.e2e-spec.ts` | Live PostgreSQL: identity and versions across restarts, column/leak audits, audit-event sequence, foreign-installation rejection, as-of future resolution, the refused backdated legacy replacement (nothing written, only a rejection audited), a duplicate refused inside the transaction with nothing written, a **late** failure rolling back every earlier write, and the concurrency suite (§0 Defect 2: three same-window races, a same-document race, competing successors, the disjoint-window invariant and the supersession pair re-asserted in SQL) | GitHub CI runs `38164310367` (head `fae7f8c`) and `38169257077` (head `df41f73`, after the temporal rule), step `E2E tests (incl. live-DB suites)` — the only accepted evidence for Defect 2 |
| `backend/test/licensing-activation.e2e-spec.ts` | L-02 compatibility contract against the new store (`/license/activate` alias, the documented rejections, idempotent repeat, and the temporal refusal of a backdated replacement — the one rejection this directive changed, registered as OQ-86) | local e2e run (verified against `createLicensingStores`) |
| `frontend/src/features/licensing/*` + `license-import.test.tsx` | File-first import (file picker primary, paste fallback), 409/422 classification apart from transport failures, gate releases only after the canonical re-read, dashboard renewal card showing the scheduled version | local frontend run (11 tests) |

Two limits are explicit and are not claimed as done: the live suites and the
rehearsal have not executed locally (no PostgreSQL in this session), so
`migrate deploy`, the rehearsal and the live concurrency assertions are CI-only
evidence — green on the PR heads of this branch (`df41f73`'s rule in run
`38169257077`; `fae7f8c` in run `38164310367`) and not reproducible in this
session; and `frontend/src/api/generated/vardena-api.d.ts` was not regenerated
(`npm run api:types` boots the API and needs a database; the frontend declares
the two licensing response shapes verbatim in `src/api/contracts.ts` because
the controllers' inline return types emit no OpenAPI schema, as documented
there).

Concurrency is claimed only for what the live suite proves. No unit test, no
in-memory store and no in-process lock is offered as evidence that two
concurrent imports of one installation cannot commit incompatible windows.

## 5. Temporal directive (2026-10-11): a supersession may not hand over in the past

Product-Owner directive: resolve the remaining ambiguity between a signed
license's `validFrom`, the successor's import instant and the predecessor's
`governsUntil`; do not invent a product policy; keep the behaviour fail-closed
and register the question if the records do not settle it.

**What the records settle (and what they don't).** PDR-11 §3.2 settles only the
*future-dated* renewal ("the current version remains valid until its own end
date … the new version becomes effective according to its own start date").
§3.4 hands overlapping or gapped versions to PQ-5 → **OQ-80**, which fixes
overlap/adjacency/gap handling but says nothing about backdating; §15 has no
item for it, and no Owner decision covers it. ADR-0046's consequences and the
domain header of `license-version.ts` claimed the past was protected ("every
import after the correction satisfies the disjoint-window invariant by
construction", `governsUntil` "never earlier than the import that recorded it")
while `supersessionCeaseInstant`'s own rationale accepted a retroactive
successor as a bounded cost — an internal contradiction, not a policy. So the
question is **registered for the first time as OQ-86** and the behaviour is
fail-closed.

**Chosen interim behaviour (technical, fail-closed, no schema change).** The ONE
authority (`evaluateImportConflicts`, run as the read-side pre-check and again
inside the import transaction under the installation row lock) refuses a
supersession whose hand-over would remove governance the retired version
ALREADY exercised before the import instant: `backdated-supersession` (**422**,
nothing written, the operation id stays unused so the same document can be
re-issued). The predicate is the exported
`supersessionRewritesPastGovernance(target, candidate, at)` — the removed
interval `[max(target.validFrom, min(candidate.validFrom, currentEnd)),
min(currentEnd, at))`, with `currentEnd` the target's effective end before the
stamp. Everything else keeps its documented behaviour, deliberately:

- a hand-over **at or after** the import instant is not the past (the
  predecessor governs up to the hand-over — the future-dated renewal of §3.2);
- a target that **had already ended** by its own `validUntil` is still a valid
  correction: the stamp records the supersession and the effective window does
  not move (the documented "correction of an expired or scheduled version");
- a backdated document that **retires nothing** (first license, gap-filling
  renewal) is untouched: gaps stay `expired`-until-start (OQ-80) and no policy
  was added;
- `superseded_at` (recorded) and `governs_until` (hand-over) stay two separate
  facts, both set together; nothing about them was redefined;
- the concurrency protection is unchanged (row lock + in-transaction
  re-evaluation; the new rule is evaluated on both passes like every rule).

**Behaviour that changed with this rule (and only this):** a signed document
whose supersession would have rewritten a past instant is now refused instead of
applied (the same-start "correction" that retired a version from its own start —
which erased the predecessor's entire governance — is the clearest case), and
the legacy `VLIC1` replacement of a version that still governs is refused for
the same reason (its L-02 default window starts in 2020 and the L-02 lifecycle
gate refuses a code whose window has not started). The legacy path keeps two
working shapes, both covered by tests: a **renewal by adjacency** (the code
starts at or after the end of the version it follows — no supersession recorded)
and the documented duplicate/idempotency behaviour. These consequences are part
of the OQ-86 question for the Owner; no data migration is needed to lift or
narrow the rule because it is a rule, not a constraint.

**Files.** `backend/src/modules/licensing/domain/license-version.ts`
(`supersessionRewritesPastGovernance`, rule 6 of the single authority, updated
header/rationale comments), `application/license-import.service.ts`
(`backdated-supersession` in the rejection taxonomy — 422, **not** in
`CONFLICT_REASONS` — plus the three stable message variants),
`backend/prisma/schema/licensing.prisma` (comment only; **no migration**),
`docs/licensing/version-model-and-file-exchange.md` (§3.1/§3.3/pipeline table),
`docs/adr/0046-…` (Consequences addendum), PDR-11 §19.4,
`docs/open-questions.md` (OQ-86), `STATE.md §32`. `OQ-80 stays Open` and no
other OQ row was changed.

**Tests added (deterministic, no sleeps).** `license-version.spec.ts`: the
predicate's case table (past/at/future hand-over, ended target, scheduled
target, retired target's tail) and the authority's refusal + the two allowed
neighbours, for both the explicit and the implicit (legacy) intent.
`license-import.service.spec.ts` (pinned clock): a hand-over exactly at the
import instant (audit trail unchanged, predecessor governs the millisecond
before); a successor one millisecond before the import instant refused with the
full rollback asserted (no version, no stamp, identical state projection, only a
`license.import.rejected` audit row, operation id reusable for a re-issue);
a correction of an already-ended version still applied with the predecessor's
effective window unchanged and the gap still `expired`; the legacy backdated
replacement refused; the legacy adjacency renewal applied (no supersession) with
the re-apply refusals; and the retained-but-no-longer-governing legacy duplicate.
`license-import.e2e-spec.ts`: the overlap/escape-hatch case re-dated to a
clock-independent future window (and now asserting the scheduled hand-over), plus
an HTTP case where a past start that retires nothing is accepted and the
backdated supersession is refused (422, `details.reason`, byte-identical state).

**Evidence boundary.** Local: the unit suites above, the hermetic e2e suite and
the frontend suite; `prisma validate`/`prisma generate` cannot run in this
session (the schema engine is not cached and cannot be downloaded — the change
is comment-only), and no PostgreSQL exists locally, so the live-DB suite and the
migration rehearsal remain CI-only evidence on the exact head.

**Evidence on the exact head.** GitHub CI run **`38169257077` on head
`df41f73`** (this branch) is green: the backend job ran `Prisma validate`,
`Prisma generate`, lint, typecheck, format check, unit tests, build, `Migrate
test database` (both new migrations applied by `prisma migrate deploy`),
`Bootstrap system administrator`, `Migration rehearsal (Licensing version model
and import)` and `E2E tests (incl. live-DB suites)` — that last step is where
`backend/test/licensing-persistence-live.e2e-spec.ts` executed the reworked
legacy-refusal case and the concurrency suite, so the PostgreSQL concurrency
evidence and the temporal refusal's live behaviour are from this head; the
frontend job is green in the same run. Local evidence in this session: backend
unit `147 files / 1958 passed` (the pre-rule baseline of the same tree was 1950),
hermetic e2e `27 files passed / 24 skipped (51)`, `388 passed / 226 skipped` of
614 tests (the live files are `skipIf`-guarded and did **not** run locally),
frontend `56 files / 397 passed`,
`npm run format:check` clean and oxlint 0 errors / 1 pre-existing warning. The
`prisma validate`/`prisma generate` and live-DB rows above are therefore CI-only
and are claimed only for head `df41f73`.

## 6. Post-merge verification (2026-10-11)

Scope: `main` at `345047abec5a6af6760b05ad36b570ee5ed3a5f9` (the PR #137 merge; PR head `2ecd8396f0edcc1c34b3724c79cd767b3401c96d`). Full record: [docs/tasks/licensing-post-merge-reconciliation.md](licensing-post-merge-reconciliation.md).

| Finding | Class | Status |
| --- | --- | --- |
| F-1 — renewal re-binds an existing `licenseId` to another customer (applied) | Important | Fixed on the fix branch: `license-binding-conflict` (409, nothing written); pending PO ratification |
| F-2 — `licenseId` owned by another installation surfaces as an unmapped database error (500) | Important | Fixed on the fix branch: same reason, decided under the installation lock |
| F-3 — non-superseding backdated overlap accepted; as-of `ambiguous`; ADR-0046 D4 wording differs | Important | Open — OQ-86 / OQ-80 Owner decision; decision brief `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` |
| F-4 — installation `customerId` overwritten by any applied import | Important | Open — Owner question (decision brief Q4) |
| F-5 — generated client lacked `/license/import` | Important | Fixed: regenerated; the import 200 response now has a schema (`LicenseImportResultDto`) — 2026-10-12 |
| F-6 — `GET /license/current` (and `POST /license/activate`) has no OpenAPI response schema | Important | Partially fixed: import done; the other two open |
| F-18 — two installations claim one unused license identifier; surfaced as an unmapped FK error | Important | Fixed (2026-10-12): primary-key arbitration in a plain `INSERT`; loser refused as `license-binding-conflict` in the transaction; live cases |
| F-7 — no CI drift check for the generated client | Important | Open — process follow-up |
| F-8 — issuer cannot target an existing `licenseId` | Important | Open — Owner question (decision brief Q3) |
| F-9 — CLI flags in `licensing-architecture.md` wrong | Minor | Fixed (documentation) |
| F-10…F-11, F-13…F-14 | Minor | Open (test gap, observation, operational, environment) |
| F-12 — documented constant initial administrator password | Blocker for any non-development deployment; pre-existing | Open — Owner/security; outside this slice |
| F-15…F-17 | No issue | — |

No CF row was re-stated by this verification, and no OQ status changed.

