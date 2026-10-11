# PDR-11 §19 conflict reconciliation and §15 open-item audit

| Field | Value |
| --- | --- |
| Status | Reconciliation complete for the first licensing implementation slice (L-03); open items preserved and registered |
| Date | 2026-10-11 |
| Baseline inspected | `main` at `f27065149ffcb3b6d62929e418a8c6c1b4ce8fea` (merge of PR #136), plus the session branch `arena/5fd62737-vardena` |
| Authority order | accepted ADRs and Owner decisions → PDR-11 (product source) → current implementation, migrations, tests → canonical registries → historical reports |
| Authority | [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) · [design record](../../licensing/version-model-and-file-exchange.md) · [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) §19.4 |
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

## 1. Conflict matrix (CF-1 … CF-22)

| ID | Classification | Affected records / code | Resolution | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| CF-1 | CONFLICT | ADR-0045 (was 0036) Decision 6; `uq_licenses_installation_current`; `licenses.repository.activate()` | The single-current-license model is replaced by retained versions under one license. A future-dated document is imported and retained without replacing the governing version; the partial unique index is dropped by migration. | ADR-0046 §1/§4; migration `20261014000000_licensing_version_model_and_import`; `license-import.service.spec.ts`; live e2e | **RESOLVED** |
| CF-2 | CONFLICT | ADR-0045 Decision 7 step 5; `license-activation.service.ts` | A not-yet-valid signed document is no longer refused at import: it is validated, retained and becomes effective at its own `validFrom`. Effective-version resolution reports `not-yet-valid` only when nothing else covers or has ended. | ADR-0046 Decisions 4–5; design §3.2; `license-version.spec.ts`, `license-import.service.spec.ts` | **RESOLVED** |
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
| CF-20 | STALE DOC | `docs/licensing-architecture.md` ("signed offline files … DEFERRED") | The owning document now describes the implemented signed-file import, the version model, replay protection and the audit trail, and lists exactly what remains deferred. | `docs/licensing-architecture.md` | **RESOLVED** |
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
