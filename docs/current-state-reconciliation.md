# Vardena Current-State Documentation and Governance Reconciliation

| Field             | Value                                      |
| ----------------- | ------------------------------------------ |
| Audit date        | 2026-09-29                                 |
| Audited branch    | `main`                                     |
| Exact audited SHA | `34dddfd60d6ce2f9d4599bd05b440556a80aa847` |
| Repository        | `MR-AliEsmaeili/Vardena`                   |
| Change type       | Documentation and governance only          |

## 1. Purpose, authority, and method

This report reconciles the repository after Tasks 30–32 and frontend follow-up work without changing runtime behavior. It is the current cross-repository reference; dated task reports remain evidence of the state and claims made when those tasks closed.

The audit used this authority order:

1. accepted ADRs and explicit Owner Decisions;
2. current implementation, migrations, tests, generated OpenAPI types, and merged Git history;
3. current canonical contracts and registries;
4. current-state summaries and roadmaps;
5. historical task reports and reference material.

Implementation proves what exists; it does **not** accept a task, promote an ADR, close an Open Question, or authorize adjacent work. A roadmap describes future scope but does not prove implementation. A visual/reference artifact does not define production architecture.

The audit inspected the backend module/schema/API and frontend route/query/permission/state boundaries, the 37 ADR files and ADR index, `docs/open-questions.md`, Owner Decision records, Tasks 22 and 27–32, the MVP scope and roadmap, frontend standards and architecture audit, FE-UX-01 documents, the Dashboard reference, and the current source/tests. Historical records were not rewritten merely to describe today.

## 2. Repository State at the audited SHA

### 2.1 Merge evidence

| Work                               | Merge evidence                                                            | Current interpretation                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Task 30 accounting implementation  | PR #80, merge `016ecf09cdae7c64aa4774e857fd0a87e16099d1`                  | Implemented and merged; no separate Owner acceptance record found                                         |
| Task 31 reconciliation             | PR #81, merge `a3cf24c0`                                                  | Historical post-Task-30 reconciliation; superseded as the current repository-wide snapshot by this report |
| Account-nature frontend correction | PR #82, merge `a9f402af`                                                  | Merged implementation correction                                                                          |
| Frontend Standards v2.2            | PR #83, merge `3d5f69b5`                                                  | Active frontend rulebook                                                                                  |
| Dashboard visual reference         | PR #84, merge `9d8c6a8f`                                                  | Reference only; never production source or architecture                                                   |
| Initial Task 32 Dashboard          | PR #85, merge `88b50a5242b38032463f9bad71a3ee0b6b9420e6`                  | Historical initial implementation, later corrected                                                        |
| Corrective Task 32 Dashboard       | PR #86, merge `721aec5bb70d592990aae7a633c299bc6359a085`                  | Final merged implementation for current-state claims; explicitly supersedes PR #85 implementation         |
| FE-ARCH-01                         | PR #87, merge `35747ae2`                                                  | Current state-management assessment: no global store needed now                                           |
| FE-UX-01                           | PR #88, merge and audited HEAD `34dddfd60d6ce2f9d4599bd05b440556a80aa847` | Current UX/journey documentation; no production capability added                                          |

Merge and green CI are not silently relabeled `ACCEPTED`.

### 2.2 Verified implementation inventory

- Backend remains one NestJS modular monolith with nine registered modules: `health`, `identity`, `users`, `rbac`, `organization`, `inventory`, `documents`, `workflow`, and `accounting`.
- PostgreSQL/Prisma still uses eight schemas. The audited tree has **55 Prisma models**, **18 migrations**, **48 controllers**, **113 backend unit-spec files**, and **34 backend E2E-spec files**.
- The permission registry has grown from the older 134-code snapshot to **142 codes**: Task 30 added eight Accounting authorities, taking Accounting from 41 to 49 while the other module totals remain unchanged.
- The frontend has **20 test files** at this baseline and now includes the Task 32 Dashboard in addition to the accepted Task 22 read-only Accounting slice.
- No `audit`, `notifications`, `sales`, `purchasing`, `reporting`, `excel`, `print`, `customization`, `integration`, `sync`, `jobs`, or `treasury` module exists. Architectural decisions for some of those names are not implementations.
- The worker remains a startup-gated process without a durable dispatch loop. There is no transactional outbox, persistent jobs queue, or production Inventory→Accounting consumer.

## 3. Documentation Truth Matrix

| Area                   | Current implementation truth                                                                                                                                                                                             | Governance / future truth                                                                                                                                                                                      | Canonical evidence                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Architecture           | Modular monolith, one database, schema-per-module, REST/OpenAPI, API + startup-gated worker                                                                                                                              | No microservices, broker, second database, or new module without its gate/ADR                                                                                                                                  | Accepted ADR-0001/0002/0008/0014; `docs/architecture.md`                        |
| Identity               | Opaque server-side session cookie; login/logout/me; bootstrap administrator                                                                                                                                              | Session listing/revocation, self password change, forced first-login change, MFA and final session policy remain gaps/OQ-06/OQ-19                                                                              | ADR-0007; Identity source; `docs/security.md`                                   |
| RBAC                   | Granular registered permissions, no wildcard or role-name bypass; backend guard and application checks                                                                                                                   | Occupational role baselines and lifecycle policy remain OQ-14/OQ-20/OQ-21                                                                                                                                      | ADR-0006/0016; permission registries                                            |
| Organization isolation | Principal membership + deployment pin + module permission; foreign scope is 404; first-member bootstrap is bounded                                                                                                       | Single- versus multi-organization product posture remains OQ-01/OQ-22                                                                                                                                          | Task 19 acceptance; Organization services/tests                                 |
| Domains / master data  | Organization structures and flat Party master exist; Inventory item/unit/warehouse foundations exist                                                                                                                     | Party legal detail OQ-38, item/unit policy OQ-29/OQ-33, deletion/code reuse OQ-36 remain open                                                                                                                  | `docs/modules.md`; schemas/services                                             |
| Inventory              | Immutable movement ledger, balances, reservations, transfers, backend-supported balance sort includes `onHand`                                                                                                           | Full Inventory/Warehouse is MVP-required but incomplete; valuation/opening/rial/reporting behavior remains OQ-11/OQ-24 gated                                                                                   | ADR-0022; Inventory API/services; roadmap                                       |
| Documents              | Type registry, numbering, allocation ledger, relations implemented                                                                                                                                                       | Numbering extensions/gap policy remain OQ-12                                                                                                                                                                   | ADR-0023; Documents module                                                      |
| Workflow               | Versioned definitions, instances, transitions, approvals foundation implemented                                                                                                                                          | Product approval policies, delegation/escalation and separation rules remain OQ-13/OQ-26                                                                                                                       | ADR-0024; Workflow module                                                       |
| Accounting core        | Fiscal calendar, configurations, chart, vouchers, exact posting, immutable ledger, reversal, period enforcement, balance projection, and bounded reads exist                                                             | Year transition, posting rules, legal/statutory outputs, exports, and system posting remain gated                                                                                                              | Accounting source; task index; contract                                         |
| Account semantics      | Nature is exactly `DEBIT`, `CREDIT`, `DUAL`; Type is exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`; Type freezes on posted-ledger evidence; Nature does not forbid opposite-side postings                    | Contrary-nature policy and closing/carry-forward/report presentation remain future decisions                                                                                                                   | OD-29-01/02; Task 30 source/tests                                               |
| Detail foundation      | Organization-configurable Detail structure/version/tree, account→Level-1 Detail Group, one optional line `detailId`, posting-boundary validation, and confirmed atomic unlink exist                                      | This is **not** the full multi-dimension model described conceptually in the older contract. OQ-41 remains open for count, requirement modes, master-data binding, area policy, and future dimension reporting | OD-29-03; Task 30; Detail source/tests; OQ-41                                   |
| Posting / reversal     | Finalization is transactional; final ledger is immutable; reversal creates a new linked counter-document                                                                                                                 | Correction/replacement/adjustment policy and windows remain OQ-27; no source-module automatic posting                                                                                                          | Accounting repositories/services; Task 15/30                                    |
| Exact decimals         | Backend stores exact decimals and emits decimal strings. Dashboard presentation aggregation uses signed decimal-string/`BigInt` arithmetic and retains exact strings; chart-number conversion is display-coordinate only | Frontend-derived Dashboard summaries are presentation, never a new ledger/report authority or substitute backend                                                                                               | Accounting schema/read DTOs; Dashboard `kpis.ts`, `chart-series.ts`, formatters |
| Base Chart             | Versioned template/adoption **mechanism** exists; adoption copies into organization-owned Accounts                                                                                                                       | Concrete content, codes, titles, natures, mandatory set, and control-role catalog are absent and not MVP-required under OD-27-02                                                                               | Tasks 21/23/28/31; OQ-25                                                        |
| Reporting              | Accounting owns bounded ledger movement, Account Statement, General Ledger, Trial Balance, Chart Tree and balance reads                                                                                                  | No generic Reporting module, report builder, statutory/legal profile, export, print, or Statement Classification runtime exists                                                                                | Task 18 acceptance; OD-29-05; ADR-0009/0036                                     |
| Frontend               | Login/session, shell, organization selection, permission-aware navigation, four Accounting reads, Dashboard, centralized API/i18n/formatting                                                                             | No write-heavy ERP UI, global search results, approval decision Dashboard action, document-create shortcut, dark-mode decision, or global store                                                                | Frontend source; Standards v2.2; FE-ARCH-01; Task 32                            |
| Dashboard              | Real backend reads and honest per-widget states; corrected PR #86 is current                                                                                                                                             | It is a presentation over existing reads, not a Reporting module or Backend MVP gate                                                                                                                           | Task 32 report and source/tests                                                 |
| Security / platform    | Cookie sessions, rate limits, correlation IDs, fail-closed permissions, organization isolation, Docker/CI foundation                                                                                                     | Persistent Audit module, full hardening, backup surface, jobs/outbox, observability policy remain incomplete or decision-gated                                                                                 | `docs/security.md`; roadmap; code                                               |
| License                | No license schema/module/enforcement                                                                                                                                                                                     | ADR-0030 remains Proposed; OQ-45 remains open; enforcement is off/nonexistent                                                                                                                                  | ADR-0030; OQ-45                                                                 |
| FaraPayam              | Reference, compatibility, migration/testing input only                                                                                                                                                                   | It supplies no authoritative Vardena architecture, Base Chart content, legal fact, seed, or integration capability without explicit decisions                                                                  | OQ-04; Accounting contract provenance; Task 29/31                               |
| Treasury               | No module/schema/API/permission/UI                                                                                                                                                                                       | Strictly outside MVP / post-MVP                                                                                                                                                                                | MVP scope and roadmap                                                           |
| Purchasing             | No module/schema/API/permission/UI                                                                                                                                                                                       | Purchasing, Purchasing→Accounting, and Purchasing Reports are post-MVP; Warehouse Receipt/Issue remain Inventory MVP capabilities                                                                              | OQ-16; MVP scope and roadmap                                                    |

## 4. Accounting invariants and terminology

The following current invariants must not be weakened by summary documentation:

1. Ledger rows and finalized Accounting documents are authoritative and immutable; projections are rebuildable read optimizations.
2. Every finalized document balances exactly, using exact decimal arithmetic; amounts are not IEEE-754 business calculations.
3. Account Nature is a reporting orientation, not a prohibition on debit/credit usage. `DUAL` is first-class.
4. Account Type is independent of Nature and becomes immutable only when posted-ledger evidence exists. Draft/temporary references do not freeze Type, although they freeze the structural fields recorded by Task 30.
5. Posting is leaf-only; aggregation is read-time/report-time. Parent and child activity must not be double counted.
6. Reversal creates a new finalized counter-document and never edits the original.
7. The Task 30 Detail foundation is distinct from the older conceptual generic multi-dimension model. Documentation must not claim either that no Detail capability exists or that every conceptual dimension feature is implemented.
8. `Account.id` remains identity; code/history and controlled migration concepts are not implemented merely because Proposed ADRs describe them.
9. Statement Classification Option C is decided but not implemented; it is independent of Account Type, Nature, Chart, Detail, System Account, and Base Chart coding.
10. There is no MVP System Account concept or equivalent bypass flag.

### Base Chart three-way boundary

| Layer                            | State                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coding mechanism / configuration | Implemented: coding structures, configuration pins, template/version lifecycle, explicit copy adoption, leaf-only posting/read-time aggregation                                                                           |
| Concrete chart content           | Not loaded; not MVP-required; OQ-25/OQ-36 gated; no FaraPayam promotion                                                                                                                                                   |
| Validation and runtime semantics | Implemented only where source/tests prove it: code/pin/tree/postability/adoption validation plus Task 30 Nature/Type/Detail checks; future content, control-role, statutory, and classification validation is not implied |

## 5. Task 32 reconciliation

### 5.1 Historical versus current evidence

PR #85 is the historical initial Dashboard implementation. Its PR description and first implementation remain historical evidence and must not be used as the final behavior claim. PR #86 explicitly corrected and superseded that implementation. The current `docs/tasks/task-32-dashboard-ui/final-report.md` was updated by the corrective PR and describes the post-correction result; it is not evidence that every original PR #85 claim was correct when first merged.

No separate Owner acceptance record for Task 32 was found. Current status is therefore **IMPLEMENTED / MERGED / CORRECTED BY PR #86; ACCEPTANCE NOT RECORDED**.

### 5.2 Verified corrective behavior

- **Complete balances pagination:** `fetchAllAccountBalances` reads page 1, validates pagination metadata, then reads every remaining page sequentially up to the backend cap.
- **One cancellable query flow:** one TanStack Query owns the operation and forwards the same `AbortSignal` to every page request; there is no uncontrolled parallel fan-out.
- **Exact signed aggregation:** signed decimal strings are normalized and summed through scaled `BigInt`; no float is used for KPI financial results.
- **Cross-row chart aggregation:** period series aggregate all Account balance rows sharing the period before rendering.
- **Periods-with-turnover KPI:** the fourth KPI counts period buckets with turnover rather than claiming a postable-account metric unsupported by the read model.
- **Independent period permission:** Accounting-period reads require `Accounting.AccountingPeriod.View`, independently of balance permissions.
- **Widget state completeness:** loading, permission unavailable, missing scope, error/retry, empty, and success are distinguished where applicable; a disabled query is not an eternal loading state.
- **Inventory ordering:** the widget requests backend-supported `onHand:asc`; it does not claim an availability-alert ranking.
- **Formatting:** the corrective PR fixed repository formatting and retained central amount/quantity/date formatters.
- **Tests:** PR #86 records 19 frontend test files / 111 passing tests at that correction point, including pagination/cancellation, signed decimal, KPI, chart, permission, widget, ordering, table and URL-state coverage. Later audited HEAD contains 20 frontend test files after FE-ARCH-01.

### 5.3 Honest capability boundaries

- Workflow instances are display-only in the Dashboard. Approval decisions are not faked.
- Topbar global search has no results contract and must not invent one.
- `Alt+N` is not bound because no document-creation UI exists.
- Dashboard summaries are presentation over backend-owned read data, not authoritative frontend accounting.
- Dashboard reference HTML is visual/UX inspiration only; demo data, CDN dependencies, and implementation technique do not transfer authority.

## 6. Governance Reconciliation

### 6.1 OQ reconciliation

The registry contains OQ-01 through OQ-63 as Open and OQ-64 as Resolved. This audit closes none.

| OQ group                              | Current reconciliation                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-01 / OQ-22                         | Principal-bound organization isolation is implemented; deployment tenancy and branch/company product semantics remain Open                                                                  |
| OQ-02 / OQ-03                         | Current Persian/RTL UI and exact decimal storage do not decide final calendar, digit, locale, currency, or precision policy                                                                 |
| OQ-04                                 | FaraPayam contract remains unknown; reference evidence is not integration architecture/content authority                                                                                    |
| OQ-06 / OQ-14 / OQ-19 / OQ-20 / OQ-21 | Current sessions/RBAC/bootstrap behavior narrows facts but does not decide final security/session/role/lifecycle policy                                                                     |
| OQ-11 / OQ-23 / OQ-24 / OQ-27         | Existing posting, close, projection, and reversal mechanics do not decide opening/carry-forward, costing, final period policy, or correction windows                                        |
| OQ-16                                 | Remains Open with recorded post-v1 posture; Purchasing is not admitted to MVP                                                                                                               |
| OQ-25                                 | Remains Open. Mechanism/content split and Nature/Type decisions are settled only to their recorded extent; chart content/control-role/statutory questions remain                            |
| OQ-30 / OQ-38                         | Tax and statutory Party detail remain unresolved; no Sales implementation exists                                                                                                            |
| OQ-36                                 | Current deactivate/freeze behavior and Base Chart adoption do not decide deletion/code reuse/history policy                                                                                 |
| OQ-39 / OQ-42                         | No production source-module posting exists; delivery and posting mode remain hard gates                                                                                                     |
| OQ-40                                 | Financial-area foundation exists; multiplicity/grants/default/consolidation policy remains Open                                                                                             |
| OQ-41                                 | Task 30 implements a bounded first-class Detail hierarchy and line link. The broader count/requiredness/binding/area/reporting model remains Open; implementation does not close governance |
| OQ-43                                 | Legal architecture direction exists only as Proposed ADR-0036; every Iranian legal fact/layout remains validation-gated                                                                     |
| OQ-45                                 | No license implementation or expiry enforcement exists                                                                                                                                      |
| OQ-49                                 | No report-builder depth is decided and no generic Reporting module exists                                                                                                                   |
| OQ-54                                 | Dashboard/document reads do not decide finalized operational-document edit/delete policy                                                                                                    |
| OQ-62 / OQ-63                         | Write-time pin coherence is implemented; existing-row repair and legacy fallback policy remain Open                                                                                         |
| OQ-64                                 | Remains the sole Resolved row; Task 13 wired operational freeze as recorded                                                                                                                 |

The current registry text still contains dated statements that Task 30 Detail implementation was unauthorized or absent. Those statements are preserved as dated decision history where appropriate, but the current note must state that Task 30 subsequently implemented the bounded foundation without pretending OQ-41 is closed.

### 6.2 ADR reconciliation

There are 37 ADR files; ADR-0027 intentionally does not exist.

### Accepted — unchanged

- ADR-0001 through ADR-0016;
- ADR-0022, ADR-0023, ADR-0024, ADR-0025, ADR-0026, and ADR-0028.

### Proposed with substantial subject implementation

- ADR-0017 Inventory ledger;
- ADR-0018 Workflow foundation;
- ADR-0019 Document foundation;
- ADR-0020/0021 Organization scope/master data;
- ADR-0031 balance projection;
- ADR-0032 period-close enforcement;
- ADR-0034 leaf-only posting/read-time aggregation direction;
- ADR-0037 configuration boundary, now partially intersecting Task 30 Detail implementation.

Implementation does not promote these ADRs. Their mismatch remains an Owner governance decision need (OD-27-04), not an editorial status change.

### Proposed and not implemented as a complete capability

- ADR-0029 machine/API access;
- ADR-0030 license foundation;
- ADR-0033 account code history;
- ADR-0035 code-structure migration service;
- ADR-0036 legal profile/reporting architecture.

No new ADR is required for this documentation-only reconciliation, and no ADR status is changed.

### 6.3 Owner Decision reconciliation

| Decision set                          | Current status                           | Reconciliation                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-27-02                              | Decided                                  | MVP requires the Base Chart mechanism, not a concrete content set                                                                                                                                                     |
| OD-29-01..OD-29-06                    | Decided                                  | Task 30 implements the runtime portions of Nature, Type, Detail and no-System-Account decisions; OD-29-04 needs no runtime English-title feature; OD-29-05 Statement Classification remains decided but unimplemented |
| OD-20-1..OD-20-6 / Task 21 governance | Decided/accepted in their recorded scope | Mechanism/ownership, consumer-first roles, mapping direction, code lifecycle direction, leaf-only posting and line-level analytical direction remain authoritative; no unimplemented capability is inferred           |
| ODR-1..ODR-3                          | Decided and accepted in Task 19 scope    | Pin coherence, Accounting-owned Chart Tree and membership-bound organization isolation remain implemented; associated product OQs remain Open                                                                         |
| OD-27-01, OD-27-03, OD-27-04          | Pending                                  | Earlier-backlog acceptance, next implementation direction and ADR ratification require Owner action                                                                                                                   |
| OD-28-01..OD-28-06                    | Pending                                  | Base Chart lifecycle prerequisites, durable integration, posting mode, valuation, Sales model and legal-book specification remain gates                                                                               |

No pending decision is guessed, and no decided record is altered.

## 7. Meaningful Documentation Drift Log

| Severity      | Document / claim                                                                                                           | Current repository truth                                                                                                   | Reconciliation                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| HIGH          | Root/backend/project context counts: 52 models, 17 migrations, 46 controllers, 134 permissions                             | 55 models, 18 migrations, 48 controllers, 142 permissions after Task 30                                                    | Current summaries updated; dated snapshots remain historical                              |
| HIGH          | Root/roadmap/project context: “No other UI” / “no dashboards” after Task 22                                                | Dashboard exists and PR #86 is final merged correction                                                                     | Current summaries and roadmap addendum updated                                            |
| HIGH          | `docs/modules.md`, roadmap and task index: Detail/dimensions absent                                                        | Task 30 Detail hierarchy, account link and line allocation exist; generic multi-dimension design remains incomplete        | Current canonical summaries now make the bounded distinction                              |
| HIGH          | Task 31 current gate is post-Task-30 only                                                                                  | Current main also contains PRs #82–#88 and corrected Task 32                                                               | Task 31 preserved as history; this report and `STATE.md` are current                      |
| HIGH          | Product MVP proposal A-20 says Dashboard is “To build”/post-MVP                                                            | Dashboard is implemented, while still not a Backend MVP gate                                                               | Status corrected without changing MVP boundary                                            |
| MEDIUM        | Roadmap baseline/counts and frontend API inventory stop at Task 22                                                         | Baseline is now `34dddfd`; Dashboard consumes additional existing reads                                                    | Current-state addendum added; planning body kept historical                               |
| MEDIUM        | Accounting task index says Nature/Type/Detail implementation absent                                                        | Task 30 implemented the bounded approved decisions                                                                         | Current addendum added; older chronological evidence retained                             |
| MEDIUM        | Accounting contract implementation correction predates Task 30 and conceptual Detail text can be mistaken for exact schema | Task 30 chose a narrower concrete foundation (`detailId` and Level-1 group) than the full conceptual multi-dimension shape | Current correction note points to Task 30/OQ-41; original contract history preserved      |
| MEDIUM        | Frontend README layout omits Dashboard and Dashboard tests                                                                 | Dashboard is a first-class feature with API hooks, route, components, exact presentation helpers and tests                 | README updated                                                                            |
| MEDIUM        | Dashboard API comment says the frontend never recomputes beyond displaying backend values                                  | Current KPI/chart layer performs exact presentation aggregation across backend rows                                        | Recorded as documentation wording drift; no source comment changed in this docs-only task |
| LOW           | Historical Task 29/31 gates say later implementation was not authorized                                                    | Correct when written; later PR #80 and PR #86 changed implementation state                                                 | Preserved and explicitly dated/superseded for current-state use                           |
| INFORMATIONAL | Proposed ADRs describe shipped subjects                                                                                    | Status remains Proposed until Owner promotion/rejection                                                                    | No auto-promotion                                                                         |
| INFORMATIONAL | FaraPayam sources appear in Accounting research                                                                            | They remain comparative/provenance material only                                                                           | Explicit non-authority boundary retained                                                  |

## 8. Code ↔ Documentation Findings

### Confirmed implementation

- Task 30 Nature, Type, posted-ledger immutability, Detail hierarchy/link/validation/unlink, permissions, migration and focused tests exist.
- ODR-3 membership isolation and 404 non-disclosure are present across organization-scoped services.
- Inventory balance sorting supports the Dashboard's `onHand:asc` request.
- OpenAPI-derived frontend contracts and one Axios client remain the browser contract boundary.
- Dashboard Query keys carry organization and parameters; request cancellation is propagated.
- Frontend permission checks only suppress impossible/forbidden UX requests; backend authorization remains authoritative.
- Session/organization contexts remain narrow facades while TanStack Query owns server state; no global state dependency is installed.

### Contract gaps / future product decisions

- **CONTRACT GAP:** no global search result endpoint/read model; the topbar field cannot offer invented results.
- **CONTRACT GAP:** Dashboard workflow list data is not a complete approval-decision surface/read model.
- **CONTRACT GAP:** no frontend document-create surface, so `Alt+N` remains intentionally unbound.
- **CONTRACT GAP:** no persistent Customization/preferences API; Dashboard layout persistence is not backend-supported.
- **FUTURE PRODUCT DECISION:** dark mode, Jalali/date and digit policy, final permission-denied presentation, and global state introduction triggers remain governed by current standards/OQs.
- **FUTURE PRODUCT DECISION:** richer domain-specific error branching requires structured subcodes/contracts. The stable envelope's human-readable `message` is not canonical Persian UX copy and must not be parsed to infer a business rule.
- **CONTRACT GAP:** C-61's selected synchronous public application-service contract for Inventory → Accounting is not implemented. The in-memory event bus has no Accounting consumer and is not the selected posting path or a fallback; OQ-39 remains open for transaction/failure semantics. Sales → Accounting requires its own contract.
- **FUTURE PRODUCT DECISION:** Statement Classification taxonomy/runtime, Base Chart content, control roles, legal profiles, and report builder remain separately gated.

These are findings, not authorizations to modify backend, OpenAPI, schema, or frontend behavior.

## 9. Current Roadmap and Governance Gate

The Owner-directed MVP boundary remains:

- **MVP-required:** Foundation; Accounting Core/Completion; Full Inventory/Warehouse; Party/Customer; Sales; Sales→Accounting; Inventory→Accounting; bounded Reporting; Electronic Books/Tax Accounting/Iranian legal outputs, subject to their recorded decisions and validation gates.
- **Not MVP / post-MVP:** Treasury; Purchasing; Purchasing→Accounting; Purchasing Reports.
- Dashboard is implemented but remains outside the **Backend MVP completion gate**. Its existence does not admit a Reporting module or Customization platform.
- Base Chart mechanism remains required; concrete content remains not MVP-required.

The current governance gate remains **FOUNDATION IMPLEMENTED; NEXT PRODUCTION DIRECTION REQUIRES EXPLICIT OWNER AUTHORIZATION**. This audit does not create a task number. Potential work remains in the Future Task Candidate Register until the Owner selects and authorizes a bounded task with its dependencies and decisions.

## 10. Documentation Changes

Current canonical summaries were corrected rather than retroactively rewriting historical task reports:

- `STATE.md` — new dated current-state addendum at the exact audited SHA;
- `README.md`, `backend/README.md`, `.vardena/project-context.md` — current inventory/count/frontend corrections;
- `frontend/README.md` — Dashboard and current frontend capability map;
- `docs/modules.md` — Task 30 Accounting foundation distinction;
- `docs/architecture.md` — current frontend/Dashboard status pointer;
- `docs/accounting/task-index.md` and `docs/accounting/domain-contract.md` — current Task 30 correction pointer while preserving historical body;
- `docs/open-questions.md` — current Task 30/OQ-41 note without status change;
- roadmap/dependency/MVP documents — dated current-state addenda and Dashboard status correction;
- this report — current-state matrix, OQ/ADR reconciliation, Task 32 correction, and drift log.

## 11. Validation

The change set must pass:

- changed-path audit proving documentation-only scope;
- absence of changes under backend/frontend production source, Prisma schema/migrations, generated OpenAPI, package manifests and lockfiles;
- `git diff --check`;
- Markdown relative-link validation for changed Markdown files;
- terminology checks for Treasury/Purchasing/Base Chart/FaraPayam/Task 32 boundaries;
- repository inventory checks against the audited SHA;
- lightweight formatter/link checks; no expensive local backend E2E.

Validation result:

| Check                | Result                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audited baseline     | PASS — fetched `origin/main` and local `main` agreed on `34dddfd60d6ce2f9d4599bd05b440556a80aa847` when the audit began                                                        |
| Changed-path scope   | PASS — only Markdown/documentation paths; no production source, Prisma, migration, generated API, package manifest, lockfile, CI, Compose, or dependency change                |
| Whitespace           | PASS — `git diff --check`                                                                                                                                                      |
| Relative links       | PASS — repository script checked links in every changed Markdown file; zero missing targets                                                                                    |
| Markdown formatting  | PASS — the new reconciliation report passes Prettier; the frontend's complete existing `npm run format:check` passes after clean `npm ci` (215 packages, zero vulnerabilities) |
| Inventory            | PASS — 9 modules, 8 schemas, 55 models, 18 migrations, 48 controllers, 113 backend unit-spec files, 34 E2E-spec files, 20 frontend test files                                  |
| Heavy runtime suites | Intentionally not run — documentation-only task; GitHub CI is the authoritative full gate                                                                                      |

## 11A. Addendum — 2026-10-02: Inventory item master (C-47) decisions and dependency reconciliation

This dated addendum updates §§2–9 for current `main` without rewriting the
2026-09-29 audit body above. Exact baseline: `main` /
`4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107). Full record:
[`docs/tasks/c-47-owner-decision-and-dependency-reconciliation.md`](tasks/c-47-owner-decision-and-dependency-reconciliation.md).

### Merge evidence added

| Work | Merge evidence | Current interpretation |
|---|---|---|
| C-46 warehouse master hardening | PR #104, merged 2026-10-01 | Implemented reconnaissance + regression hardening; **no Owner acceptance record** |
| C-47 item-master preflight investigation | PR #106, merged 2026-10-02 | Documentation/investigation only |
| C-47 item-master defect fixes + regression hardening | PR #107, merge `4cf481efa2de5ca9863d9d434c2ab707de23301a`, CI green | Implemented and merged; **no Owner acceptance record — merge + green CI is not acceptance of the item master** |

### Owner decisions recorded 2026-10-02

| Decision | Subject | Outcome | Registry effect |
|---|---|---|---|
| **OD-C47-01** | OQ-29 quantity precision and conversion | **Option A** — fixed four fractional decimals; reject results not exactly representable; no rounding/truncation; effective-dated factor versions; historical versions and interpretation data preserved | OQ-29 **PARTIALLY RESOLVED, stays OPEN** |
| **OD-C47-02** | OQ-33 item taxonomy/capabilities | **Option D** governance rule only; **Option A explicitly not approved**; the eight-kind + per-item capability model is *frozen*, not *confirmed* | OQ-33 **stays OPEN** |
| **OD-C47-03** | Barcode policy | **Option A** — optional; organization-scoped uniqueness; two active items must not collide; cross-organization reuse allowed; multiple formats, no strict symbology; no multi-barcode support | New **OQ-65 OPEN** for the deactivated-item reuse and comparison semantics |
| **OD-C47-04** | OQ-36 item deletion/code reuse | **Option C** — physical deletion only for never-referenced items; referenced items never physically deleted; history and organization-scoped identity preserved; **code reuse left OPEN** | OQ-36 **PARTIALLY RESOLVED, stays OPEN** |

Decision records: `docs/decisions/product/PDR-01…PDR-04` and
`docs/decisions/product/OQ-65-barcode-lifecycle-and-reuse.md`. **No production
code, schema, migration, API, generated type, permission or test was changed by
the decision-recording task.**

### Truth-matrix deltas (§3)

- **Domains / master data:** the item/unit/conversion master is implemented and
  regression-hardened; the barcode **policy** is now decided while the barcode
  **constraint does not exist** — `inventory.items.barcode` is a nullable
  `varchar(64)` with no unique index and no application uniqueness check
  (`backend/prisma/schema/inventory.prisma`,
  `backend/src/modules/inventory/application/items.service.ts`). Deletion is
  still entirely absent (no DELETE route, no `*.Delete` permission, no
  `deleted_at`).
- **Inventory:** the ledger remains quantity-only — `InventoryMovement` has no
  cost column — and there is deliberately **no `opening` movement type**
  (`backend/src/modules/inventory/domain/movement-type.ts`). Inventory has
  registered **no** document type; only Accounting uses the Documents type
  registry.

### OQ reconciliation delta (§6.1)

| OQ | Reconciliation after 2026-10-02 |
|---|---|
| OQ-29 | Partially resolved (OD-C47-01) and **still Open**: per-unit entry precision, global-vs-item-specific precedence, reverse-pair derivation, the exactness boundary for future consumers, valuation precision and back-dated-version authority are unanswered |
| OQ-33 | **Still Open and explicitly unconfirmed.** OD-C47-02 supplies a change-governance rule only; the Owner withheld confirmation of the eight kinds and the per-item capability model |
| OQ-36 | Partially resolved (OD-C47-04) and **still Open**: code reuse after physical deletion, case-sensitivity policy, soft-vs-hard delete shape, the reference-proof obligation, the delete permission/audit model, and cross-entity scope. Task 21 §10 Base Chart prerequisites remain unsatisfied |
| OQ-65 | **New, Open.** Barcode lifecycle/reuse and comparison semantics; blocks only the barcode-uniqueness candidate |
| OQ-11 / OQ-24 / OQ-39 / OQ-42 / OQ-69 / OQ-70 / OQ-71 / OQ-72 | **Open after C-61.** OQ-11 remains the Accounting opening/import question. OQ-24 remains open for broader costing/Accounting policy; OD-VAL-17 decides physical negative inventory is rejected for MVP, although legacy Item/Warehouse allow overrides remain in code as a documented discrepancy (C-61 package). PO-02 selects synchronous Inventory → Accounting integration; OQ-39 transaction/refusal/retry/failure semantics and OQ-42 mode/approval remain open. OQ-69 auditor sufficiency, OQ-70 Purchase Return variance policy, OQ-71 Accounting correction behavior and OQ-72 system-origin authority remain open within their PDR-09 scopes. These posting questions do not gate quantity-only flows. |
| OQ-54 | Unchanged and Open; verified to govern the lifecycle of Material Request, Warehouse Receipt/Issue and the opening documents |

The registry still contains no Resolved row other than OQ-64. This addendum
closes no OQ and promotes no ADR.

### Governance gate (§9) after this addendum

Unchanged in substance: **FOUNDATION IMPLEMENTED; NEXT PRODUCTION DIRECTION
REQUIRES EXPLICIT OWNER AUTHORIZATION.** The reconciliation identifies **C-50
(Material Request)** as the next dependency-ready candidate **for investigation
only**, and records that a bounded C-47 implementation follow-up (barcode
uniqueness, item deletion) is justified in principle but blocked by OQ-65 and the
OQ-36 reuse question. No candidate in C-48…C-54 is ready for implementation.

## 11B. Addendum — 2026-10-05: Product & architecture governance re-baseline

The Owner recorded a product-decision batch on 2026-10-05 (canonical records:
`docs/decisions/product/` — re-baseline note in its README; index record
[PDR-06](decisions/product/PDR-06-initial-usable-product-v1.md)). Deltas
against the dated statements above, which stand as history:

- **OQ-54 is RESOLVED** (Option B — edit until Accounting Post, then
  cancel/correct only; side-effect transparency; negative-inventory hard
  block; OD-54-01…11). The §6.1-era row "OQ-54 … remains Open" is superseded.
  Backend contract: **ADR-0040 (Proposed)** + `document-architecture.md`
  §6/§6.1; frontend contract:
  `frontend/ux/document-editing-and-system-alerts.md`. No implementation
  exists or is authorized.
- **OQ-49 is DECIDED** (standard reports + controlled customization; no
  unrestricted designer). Still no Reporting module exists.
- **OQ-65**: the reuse half is decided (barcode never reusable within the
  organization — OD-65-01); comparison semantics stay OPEN and C-55 stays
  blocked.
- **OQ-45** (Grace → Read-Only shape), **OQ-46** (Business Export Excel ≠
  technical full backup), **OQ-51** (taxpayer Stage 2 post-MVP), **OQ-53**
  (restore is admin-only, runbook-driven) are partially decided; **OQ-52**
  reconfirmed OPEN (no RPO/RTO numbers); **OQ-47** deferred ("do nothing for
  now"); OQ-41 Detail Dimensions and OQ-59 Product Family deferrals recorded.
- **MVP completion definition re-based** (PDR-06): "MVP complete" = the
  end-to-end usable **Initial Usable Product / V1**, not "backend code
  complete". OQ-60's numeric thresholds remain OPEN.
- The registry's Resolved table now contains OQ-64, OQ-66 **and OQ-54**.

This addendum changes no production code, promotes no ADR, accepts no merged
work and authorizes no implementation. STATE.md §21 is the task record.

## 12. Final Conclusion

The repository contains a materially broader current implementation than the pre-Task-30 roadmap snapshots: Task 30 added Account Nature/Type and a bounded Detail foundation, Task 32 added a real Dashboard, and PR #86—not PR #85—is the final merged Dashboard behavior. None of those facts closes the remaining OQs, promotes Proposed ADRs, admits Treasury/Purchasing to MVP, turns FaraPayam into architecture, supplies Base Chart content, or authorizes a new production task.

**READY FOR REVIEW**

## Later date/time audit addendum (2026-10-09)

The 2026-09-29 findings above are retained as a dated snapshot. They predate
Owner-accepted ADR-0042 and resolution of OQ-73 on 2026-10-09. Under the current
contract, BusinessDates are canonical Gregorian PostgreSQL `date` values with
organization-calendar user input/display (Jalali by default); Instants remain
UTC `timestamptz` values rendered in the organization's valid IANA zone and
calendar. Accordingly, the earlier OQ-02 row's wording about the calendar being
undecided and the earlier future-decision bullet about Jalali/date policy are
superseded only for this generic date/time contract. OQ-02 remains open for
primary UI language, Persian-numeral preference, and broader localization.

The current date/time audit traces the implementation paths in this change from
the 2026-10-09 `main` baseline (`9438eb7`) through DTOs, domain, persistence,
queries, API declarations and frontend consumers. Its non-test lint/typecheck/
format evidence is reported with the delivery; tests and PostgreSQL rehearsal
must be verified through GitHub CI on the exact final SHA. The aggregate-only,
read-only migration report is
`backend/prisma/rehearsal/business-date-validity-windows/audit.sql`; it emits
counts, not row IDs or business payloads. Neither fixture rehearsal nor code
inspection establishes what values exist in a customer/production database.
The baseline check found the original migration-110 comment about verbatim
instant storage was not supported by the standard Inventory input/persistence
path; the comment has now been corrected in this PR to describe the legacy
organization-zone parse followed by UTC-day carrier persistence. Alternate
writers and actual historical data remain uninspected, so no customer-data
safety claim is made. See ADR-0042, `docs/datetime.md`,
`docs/open-questions.md` OQ-73, and the date/time pull request for current scope
and limitations.
