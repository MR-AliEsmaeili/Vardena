# Task 17 — Next-step recommendation

## Executive summary

**READY FOR REVIEW — documentation only. IMPLEMENTATION NOT AUTHORIZED.**

**Owner constraint: FREE-ONLY. Stimulsoft Reports.JS is REJECTED.** This revision replaces the prior unapproved draft’s commercial-tool consideration with a strictly free/open-source evaluation. No paid suite, paid runtime, subscription, mandatory cloud service or commercially restricted community edition is an adoption path. No dependency was installed or added.

Evidence classes follow the companion audit: **A** workbook observations (none: files unavailable); **B** repository-supported facts (upstream evidence explicitly distinguished from Vardena); **C** design recommendations; **D** unresolved Owner/verification gates. All proposals in this recommendation are C, not new Owner decisions; dependencies/blockers and approval requests are D. Existing contract claims are B.

Baseline: remote `main` and checkout both `09ab3daa9675e3ff29448c0788d79e428ff185ee`, checked 2026-09-24; working branch `arena/01a0d4af-vardena`. See [reporting-sample-audit.md](./reporting-sample-audit.md) for evidence, limitations and the 19-authority inventory.

**No Accounting Reporting implementation can start immediately under the current gates.** The exact next action is to obtain the missing Excel files and an evidence-linked owner approval for a narrow, non-statutory ledger-source slice. The first recommended implementation **after** that approval is **Task 17 first slice: Accounting-owned ledger movement read source**, not aggregation, a report platform, or electronic-books export. This is a proposed slice name, not a newly allocated task number or owner-approved task.

Task 17 is **not sufficient for the requested full A–D capability set**; that is intentional. Compatibility with the two named workbooks cannot be determined because neither workbook was accessible. Keep Task 17 bounded, split book semantics and output infrastructure, and do not stretch the definition on the assumption that two Excel layouts are merely different column selections.

Recommended direction: immutable ledger facts → Accounting-owned read sources (and later approved aggregation projections) → separately authorized shared Reporting pipeline → independent ordinary export/Print adapters or a fixed legal export profile. Do not create new posted vouchers to render aggregated books.

## Recommended task decomposition

These are **proposals requiring owner approval**, not amendments to the task index or closures of OQs. Sequencing is dependency-driven; small reviewable tasks should remain below the repository's approximately 600-line meaningful-diff guideline where practical.

| Capability / proposed work package                                | Owner and boundary                                                                                | Dependencies / disposition                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decision and sample completion                                    | Product/accountant/tax-legal owners; inspect both artifacts and record exact interim scope        | **Next action now.** No implementation authority inferred from this audit                                                                        |
| Task 17 ledger-source first slice                                 | Accounting; fixed module-owned read model over ledger-native columns                              | OQ-25/OQ-43 scoped approval, exact owner authorization, approved scope/consumer boundary                                                         |
| Remaining Task 17 movement/balance/trial-balance inputs           | Accounting-owned views; current period-turnover and intra-year derived opening/closing semantics  | Separate approved report meanings, grouping, sparse/dense behavior and reconciliation criteria                                                   |
| Shared Reporting foundation                                       | Reporting registry/execution, not a Report Builder                                                | Separately formalized task using ADR-0009; scope/permissions/limits/read-only DB role; no incidental platform in Task 17                         |
| Book Configuration and Aggregation foundation                     | Accounting-owned semantics/configuration plus derived sources                                     | Independent-document definition, day/Jalali/Gregorian bucketing, special documents, policy versioning and reproducibility; separate bounded task |
| Financial-statement classification/mapping foundation and reports | Accounting classification and P&L/balance-sheet semantics; Reporting presentation                 | OQ-25 roles/types/sections/signs, year-end treatment, OQ-23 and exact layouts; **outside current Task 17**                                       |
| Ordinary XLSX/CSV output                                          | Excel mechanism with a typed Reporting result contract                                            | Export permissions, limits, exact data representations, CSV dialect, artifact handling; separate task                                            |
| Professional Print                                                | Print providers/templates/preferences/rendering per ADR-0012                                      | HTML/CSS, approved localization, canonical PDF rendering, storage/download controls, audit and jobs where needed                                 |
| Durable report/artifact audit and heavy-job prerequisites         | Existing architecture's Audit/Jobs/storage concerns, not Accounting ledger writes                 | Separate approved foundations; current worker/event bus are insufficient for durable execution/history                                           |
| Iranian Electronic Books profile                                  | Accountant/tax/legal-approved profile; Accounting owns meaning; export adapter owns serialization | Official versioned specification, validated samples, money/calendar rules, immutable profile, preflight validation, provenance and retention     |
| Year-transition and further correction mechanisms, if required    | Accounting domain operations, not reporting                                                       | OQ-23/OQ-25/OQ-27 and contract §6.4/§15.4; reports consume resulting facts, never generate them                                                  |

### Validate proposed capability A — Accounting Reporting Core

- **Journal Book:** a non-statutory final-ledger journal has a source basis. Legal journal layout, order/gaps and mandatory content are not approved. A draft/temporary-document list is not this ledger source.
- **General/Subsidiary Ledger:** account-filtered movements have a basis; approved account-level semantics and chart context are required. Do not hardcode “general = level 2” or infer level meanings from Persian names.
- **Account movement/balance:** remains inside Task 17's Accounting-source boundary. Balance filters must preserve cumulative semantics; filtering periods before computing an opening can change the answer.
- **Detailed/summary Trial Balance:** supported as candidate turnover/balance sources, not automatic authorization for 4/6/8-column variants or dimensions. Parent rollups must not sum already-rolled-up descendants twice. Detailed account rows are not floating-detail dimension reports.
- **Base Income Statement and Base Balance Sheet:** excluded until an independently approved classification/mapping foundation exists. Account nature and account code are not adequate classification authorities.

### Validate proposed capability B — Book Configuration and Aggregation

Daily, Persian monthly, Gregorian monthly, independent and combined output are **not existing authorities**. Treat them as separately approved Accounting semantics. Traceability, deterministic rebuilding and no double counting are necessary design invariants, not proof of legal compliance. This is not Task 16 settlement/allocation and not OQ-56 multi-company/two-book consolidation.

### Validate proposed capability C — Professional Output

Ordinary XLSX and CSV should have explicit column order/type contracts. RTL/Persian support, configurable page size/orientation, selected header/row columns, wrap, alignment, footer, separators and display precision belong to ordinary presentation preferences within approved allowlists. Do not allow preferences to alter money values or scope. Page totals require deterministic pagination and are distinct from filtered-dataset final totals; specify both before Print implementation. CSV has no merged cells, RTL sheet-view flag, paper settings or number-format metadata; text encoding, delimiter, quoting, digits and exact field order need their own decision.

### Validate proposed capability D — Iranian Electronic Books

Use a fixed, versioned, non-user-editable mandatory structure, with explicit pre-export validation and durable run/artifact provenance **only after official specification and owner approval**. This is independent of ordinary column choices/Print preferences. This recommendation supplies no legal column names, thresholds or filing rules.

## Recommended bounded scope

Keep **Accounting-owned sources and source reconciliation** inside Task 17. Do not add the absent Reporting platform merely to demonstrate an endpoint. A source-only deliverable can be reviewed/tested internally without shipping a report UI/API.

Book Configuration and Aggregation is **Accounting-domain-owned, delivered as a separate bounded foundation**. Why: deciding which economic facts participate, which documents remain independent, how reversals and year-transition entries are treated, and how totals are conserved affects accounting meaning. Selecting font, header visibility or paper orientation does not. Reporting owns execution/presentation, not those policy decisions. No new bounded-context service or database is justified.

Existing ADR-0028 AccountingConfiguration is the starting point for future configuration ownership. Its accepted version/freeze decisions must be reviewed before adding any typed book-policy configuration; do not overload chart levels or persist arbitrary JSONB rules. Whether book policy versions share that lifecycle is an owner/architecture decision, not settled here.

## Dependencies

Repository dependency evidence remains as described in the companion audit. The following are **implementation blockers**, not implementation authorization.

### Implementation blockers

1. **Task 17 brief §7 / prompt STOP conditions:** OQ-25 and OQ-43 need resolution **or explicit approved interim postures for the exact slice**, followed by owner authorization. Both remain open today. Non-statutory labeling alone does not bypass this gate.
2. **Samples absent:** obtain both original workbooks, producer/settings and source data. Sample-derived requirements remain blocked. A repository-only ledger-source slice may proceed only if the owner explicitly approves it independently of sample compatibility; it must not claim to satisfy the files.
3. **Dependency statuses:** Task 12 remains ACCEPTED WITH FOLLOW-UP; its P1 real-PostgreSQL concurrency check is separate, not absorbed into Task 17. Task 13 remains IN PROGRESS (self-review); Task 14 READY FOR REVIEW — NOT ACCEPTED; ADR-0031/0032 Proposed. Re-read before implementation; do not equate merge with acceptance. Task 15 reversal exists, but acceptance is UNKNOWN in STATE §7.
4. **Only enable decided semantics:** OQ-02 localization, OQ-03 currency, OQ-11/OQ-23 calendar/opening, OQ-27 correction policy, OQ-40 area access and OQ-41 dimensions govern extensions. Exclude unresolved capabilities instead of implementing assumptions.
5. **No consumer platform yet:** source tests need not depend on Reporting, but live report execution does. Reporting requires separately authorized registry, permissions, read-only execution and resource limits; exports additionally need mechanism/artifact/audit support.
6. **Reproducible metadata:** titles are mutable; chart pins may diverge (OQ-62/63). Initially restrict the source to ledger-native fields or explicitly approve current-master enrichment. Do not redesign chart migration or historical snapshots incidentally.

## Recommended source of truth

Use immutable **LedgerEntry** rows, atomically derived from final voucher lines. AC §19.2 calls final document lines the originating fact; Task 17 brief §3 selects ledger as its reporting truth without creating a competing authority. Finalization and reversal both materialize ledger rows and balance deltas inside their respective transactions.

- Read stored organization, area, year, period, account, voucher/line IDs, serial text, dates and amounts; do not reconstruct these from other modules.
- Existing balance projections and derived/reconciliation views are **derived controls/accelerators**, not replacement truth. They are adequate only for their actual grain and semantics.
- Monthly/daily books cannot use period totals as their sole input: those totals lost source dates, voucher membership and the independent-document distinction.
- Account code/title enrichment must remain Accounting-local and explicitly scoped; historical naming needs an approved policy. Do not require cross-module SQL for organization labels: use the owning public contract or separately approved reporting boundary.
- Never use generic DocumentRelation to authorize financial allocation, source membership or amounts. ADR-0023 logical links can aid navigation; they do not define aggregation economics.

## Aggregation safety model

**Proposed invariants, not implemented or legally approved.** Aggregated entries can be views/read models without becoming posted vouchers. Prefer a purpose-built view/query initially; materialize only with demonstrated performance need and an approved maintenance contract.

1. Define eligible source set **S** using exact stored scope and an approved committed-snapshot/run policy. No draft/temporary lines. Define all inclusion/exclusion rules explicitly, especially special documents.
2. Partition **S = I ∪ G**, where **I** is independent membership, **G** aggregated membership and **I ∩ G = ∅**. Every eligible source line appears exactly once. Decide voucher-level versus line-level independence; recommended default for owner consideration is whole-voucher membership to avoid unexplained splits, not an implemented rule.
3. Group G by an approved fixed grain including scope, account identity and bucket identity (plus any dimensions/currency only when their authoritative models exist). Preserve fiscal year/period provenance; decide any output bucket crossing a period boundary explicitly. Calendar bucketing is an extra output dimension, never a substitute fiscal-period resolver.
4. Keep debit and credit totals separately: `Σ outputDebit = Σ S.debit`, `Σ outputCredit = Σ S.credit`. Do not net them away for convenience. Global balance is checked only for a complete balanced document selection; a single-account report need not balance.
5. Keep original and reversal facts; do not exclude an original just because `reversedByDocumentId` is now set. Any authorized net presentation must retain underlying turnover and lineage. Opening/closing/profit-close classification cannot come from free-text descriptions.
6. Output consists of grouped G plus unaggregated I, with deterministic unique sort tie-breakers and identities tied to policy/run version. Output ordinals are not voucher numbers and must never allocate accounting serials.
7. Every aggregate row must resolve to exact source ledger IDs and voucher/line IDs, directly or via a deterministic query against the same source set. A drill-through against today's unbounded ledger is not sufficient for a historical run.
8. Rebuild with the same source set + policy/calendar/profile versions yields the same row values/order. Timestamp or maximum ULID alone is not proof of a committed snapshot: in-flight/backdated transactions can break repeatability. Approve either a retained exact membership manifest or another transactionally sound snapshot strategy; do not prescribe a speculative storage table now.
9. If materialized, rebuild via a separate, scoped, permission-gated maintenance operation; atomically replace the derived slice and preserve prior audited artifact provenance. Report reads must not update balances, ledger, vouchers or configuration. Never append aggregate vouchers alongside source vouchers.
10. Reconcile row coverage, debit/credit totals and independent/group partition; reject unresolved classification or stale/mismatched projections according to the approved contract. Test leap dates, partial months, non-month fiscal periods, same-day multiple vouchers, corrections across periods, zero-net/nonzero-turnover, retries and late postings.

## Output architecture

Preserve ADR-0009 and ADR-0012, rather than introducing a rival report engine in Accounting. Keep these layers separate (**C**, constrained by accepted contracts **B**):

1. **Accounting ledger/projections:** financial authority and rebuildable derived facts.
2. **Accounting-owned report semantics/read models:** fixed source shapes, calculations and reconciliation; contributes approved report definitions without owning the generic registry. ADR-0009 still places the code-defined registry in Reporting.
3. **Reporting query and permission enforcement:** registry, authorization, scope, filter/sort whitelists, pagination, limits and read-only execution.
4. **Output adapters:** Screen, XLSX, CSV, Print/PDF and Legal Electronic Books consume authorized typed results; libraries never select scope, calculate accounting, or determine compliance.
5. **Legal profiles and validation:** fixed versioned rules approved by domain/legal owners, separate from ordinary preferences and rendering engines; no mandatory column list is invented here.

No library model/template is imported into ledger/domain contracts. The layer diagram is conceptual, not a new universal document or report builder:

```text
Accounting ledger / approved module-owned derived source
    → authorized Reporting definition + scoped query pipeline
        → JSON data pages
        → ordinary Excel/CSV serialization (approved preferences)
        → Print typed provider → versioned HTML/CSS → PDF/browser print
        → separately approved legal profile → validation → fixed export
```

All channels must apply the same authorized source/filter semantics; output selection cannot bypass backend permission or organization/area scope. Ordinary UI pages, full filtered export totals and Print page totals have different boundaries and must be labeled correctly. A cap/timeout must not silently return a partial book as complete. Until a durable async runner exists, return the approved limit/unsupported response rather than inventing a queue.

Proposed run provenance for later approval: actor and scope, definition/policy/profile/template versions, normalized filters, source-set identity/cutoff semantics, output totals/row count, validation result, artifact digest, created time and download access history. This is audit metadata, not a second financial authority. Accounting reads remain read-only even when the separate artifact/audit mechanism records a generation operation.

Legal export validation must cover the approved ordered schema, required values/types, permitted codes/dates/precision, row constraints and reconciliation. No reordering, extra title rows, merged headings, optional summaries or footer may enter the legal file unless the authoritative profile allows them. None of those allowances is known from the unavailable samples.

Security requirements for later output tasks: permission re-check at download, scoped artifact identifiers, retention approval, formula-injection-safe untrusted text in XLSX/CSV, deliberate handling of leading zeros and values beyond spreadsheet numeric precision, escaped/allowlisted templates, no remote template resources or SQL/script execution, renderer isolation and resource ceilings. Do not “fix” legal data by silent rounding or changing mandatory values to satisfy an exporter.

### Normal output and print configuration coverage (C/D)

These are proposed mechanisms and tests, not verified output or legal requirements. Ordinary preferences may vary only within an approved report's allowlists; legal profiles bypass those preferences entirely.

| Requirement                                  | Proposed free mechanism / ownership                                                                                                     | Limit or required acceptance evidence                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen / configurable columns                | Planned React UI renders approved typed results; Vardena owns whitelisted visible/orderable columns and preferences                     | Not a generic builder; hidden unauthorized data must not reach the browser                                                                                        |
| Ordinary XLSX                                | Conditional ExcelJS adapter maps ordered typed columns, sheet RTL, width, wrap, font name, alignment and `numFmt`                       | Gate maintenance first; test actual file types/styles in Excel/LibreOffice; print setup is metadata, not a renderer                                               |
| CSV exact stable order                       | Conditional Papa Parse with explicit ordered fields/arrays; Vardena owns encoding/BOM, delimiter, newline and canonical decimal strings | CSV does not carry styles/RTL/fonts or preserve cell typing; define formula-injection policy without silently altering legal values                               |
| Persian/RTL and fonts                        | `lang="fa"`, `dir="rtl"`, controlled bidi isolation for Latin IDs, local reviewed Persian font in HTML/PDF                              | Test mixed digits/codes/punctuation, glyph shaping, PDF embedded font and extracted text; workbook font name is not font embedding                                |
| Portrait/landscape; A3/A4/A5 and other sizes | Print preference allowlist → CSS `@page` and Chromium PDF options/custom dimensions                                                     | Test units, orientation and printable area; native printer may override hints or not support a size                                                               |
| Margins and selected header fields           | Vardena-approved metadata fields, CSS/renderer margins                                                                                  | Headers must not expose unauthorized metadata; browser default URL/date header may differ                                                                         |
| Selected row columns                         | Same approved column keys/order as the source contract                                                                                  | Reflow/overflow tested; selecting columns never changes accounting totals or membership                                                                           |
| Word wrap and text/numeric alignment         | CSS table cell layout; XLSX alignment/wrap settings                                                                                     | Long Persian descriptions and unbreakable codes need explicit overflow/page-break tests                                                                           |
| Thousands separators and decimal precision   | Exact Vardena presentation formatter; XLSX display number formats where representation is safe                                          | Never round accounting or coerce Decimal strings through JS Number; display precision decision separate from storage; reconcile displayed totals                  |
| Footer configuration; report title/metadata  | Versioned escaped/allowlisted HTML/CSS templates and approved fields                                                                    | Chromium header/footer templates have separate styling/font context; no script/calculation logic there                                                            |
| Repeated table headers                       | Semantic `thead` / print CSS; XLSX `printTitlesRow` where appropriate                                                                   | Test actual renderer/version with multipage tables, long rows and page breaks; not an automatic guarantee                                                         |
| Page numbering                               | Chromium header/footer pageNumber/totalPages; permitted XLSX header/footer codes                                                        | Browser-native numbering differs; fixed PDF is canonical                                                                                                          |
| Page-level totals                            | Vardena-controlled page composition/row membership after fixed layout measurement; exact summation outside library templates            | **Not supplied automatically by CSS, Puppeteer or CSV.** Needs a separately scoped, deterministic pagination algorithm and tests; postpone if it cannot be proven |
| Final-page/final report totals               | Exact full filtered-dataset totals rendered once as final content                                                                       | Do not repeat a final total in every `tfoot`; handle final page overflow and totals-only page; page sums reconcile to final total                                 |
| Preview                                      | HTML preview for convenience; authenticated generated-PDF preview for canonical pagination                                              | Native print dialog is not programmatically controllable; HTML preview alone is not proof of PDF page boundaries                                                  |

**D:** Approve expected behavior when a row is taller than a page, whether page totals include split rows, and whether totals refer to the full filtered report or selected print pages. Do not promise page-level totals until those decisions and pagination evidence exist. Fixed page size, pinned fonts/renderer and immutable source/configuration versions are required for reproducible pagination. Where byte-identical PDFs are needed, volatile timestamps/metadata must also be controlled; semantic reproducibility is not automatically byte reproducibility.

## Free-tool strategy

### Build versus use free libraries versus compose

| Option                                                             | Evaluation (C)                                                                                                                         | Verdict                                                                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build all infrastructure internally, including OOXML/PDF internals | Maximum control but large security, encoding, typography, pagination and maintenance burden; still needs fonts/browser platforms       | Do not build general file-format/rendering engines; own contracts, orchestration and validation                                                  |
| Delegate to an all-in-one free library                             | No evaluated candidate supplies every output and correct accounting/legal semantics; a suite cannot replace missing domain authorities | Do not delegate domain or compliance; no single-tool selection                                                                                   |
| Compose Vardena-owned logic with narrow free libraries             | Fits existing module/output boundaries and permits replaceable adapters                                                                | **Conditional preferred direction only if every selected artifact is free, compatible, maintained and tested.** Not approval to add dependencies |

Full license/capability/maintenance comparison and primary evidence are in [the audit's free/open-source findings](./reporting-sample-audit.md#freeopen-source-tool-findings). Core licenses were verified as MIT/Apache-2.0 (with a separate OFL font candidate); complete deployment-bundle compatibility is not yet cleared. Vardena is currently private/UNLICENSED, not a project with an established open-source license. A compatible permissive library does not require Vardena itself to become open source, but notices and other license obligations must be preserved.

### Proposed smallest composition — no selection or installation yet

- **Screen:** existing planned React stack and Vardena report contracts; no reporting-suite dependency.
- **XLSX:** evaluate **ExcelJS (MIT)** first for sheet styles/RTL and print settings, but its older release/activity makes maintenance/security review a hard blocker. **SheetJS CE (Apache-2.0)** is a legitimate commercially usable OSS alternative for data interchange, not a free-trial license; do not assume Pro styling/template capabilities exist in CE. Do not select both by default. If neither passes, defer styled XLSX and research a free alternative, not a paid upgrade.
- **CSV:** **Papa Parse (MIT)** is the conditional bounded-output candidate. Its parser's streaming support must not be confused with an unbounded-memory streaming writer. Larger outputs need a separately evaluated permissive streaming writer or bounded Vardena serialization with exact dialect tests; do not hand-wave this limit.
- **Print/PDF:** preserve ADR-0012's HTML/CSS → self-hosted Chromium worker path. **Puppeteer (Apache-2.0)** is the preferred driver candidate; **Playwright (Apache-2.0)** is an alternative, especially if separately justified for browser testing. Choose one production driver. Never make a hosted browser subscription a prerequisite. Exact Chromium binary/third-party license and supported Node-version checks remain mandatory.
- **Browser light print:** CSS print media/native printing is sufficient as a basic mechanism. **react-to-print (MIT)** is optional React convenience, not a server renderer, print designer, or native dialog controller.
- **PDF primitives:** **pdf-lib, PDFKit and jsPDF (MIT)** are evaluated but not selected for canonical Print. They may be reconsidered only for a demonstrated narrow need, after maintenance/RTL/font/layout tests and an architectural justification; they must not create a parallel layout/calculation engine.
- **Persian fonts:** locally hosted **Vazirmatn (OFL-1.1)** is a candidate, subject to exact font-variant/notice/embedding review. Do not assume system fonts exist on the worker/customer machine. No CDN or paid font is required by the proposed design.
- **Legal Electronic Books:** Vardena-owned fixed profile/validation plus whichever approved free serializer matches the official format. It must not inherit ordinary user column choices or a library's idea of legal compliance. Format is not established by the absent samples.

### Free-tool adoption gates (D)

Before any future task selects a dependency, require:

1. Exact version/source/hash, top-level and transitive license inventory, browser binary and font notices, commercial/self-hosted redistribution compatibility with Vardena; no paid runtime, mandatory account/cloud/subscription, commercial restriction or hidden usage quota. Unknown artifact terms → **LICENSE UNCLEAR — OWNER REVIEW REQUIRED**, not assumed compatibility.
2. Maintainer/release responsiveness, unresolved security advisories, supply-chain provenance and a feasible update path. Popularity and `archived: false` are insufficient. SheetJS's outdated npm mirror must not be mistaken for its official current distribution; do not blindly suppress advisory warnings.
3. NestJS/ESM/Node >=22.12 compatibility and planned React/Vite integration. Browser automation runs in the server worker, never as a browser-side API to a database. No frontend implementation exists yet.
4. License and functional tests on the exact free edition. No paid-only chart/designer/template or styling feature may become a required component. Document permitted fallbacks explicitly.
5. Golden fixtures: XLSX OOXML types/order/styles/leading zeros/date values/precision; CSV exact bytes/order/quoting/Unicode/formula safety; PDF Persian glyphs/bidi, embedded fonts, text extraction, repeated headers and all page-total edge cases. No library automatically guarantees any of these.
6. Resource limits, output caps, deterministic source membership, retry/error behavior and scoped artifact/download audit. Render templates with escaped allowlisted fields, no arbitrary scripts, SQL, remote URLs or user-controlled local-file reads. Block renderer egress/SSRF, keep browser sandboxing, set CPU/memory/time ceilings, clean temporary artifacts and use isolated contexts. Pin fonts/browser revisions and test upgrades.
7. ADR/dependency justification under AR-29/30; separately authorized implementation task; ownership stays with Vardena. Data/permission/aggregation/accounting/legal validators must be independently testable without any output library installed.

**C:** Library lock-in stays low only if adapters accept Vardena-owned versioned DTOs and have contract tests. HTML/CSS reduces proprietary template coupling but still depends on browser pagination behavior; OOXML outputs require cross-viewer tests. A no-cost license does not remove engineering, hosting, patching or operations costs. If these gates fail, no hybrid implementation is authorized.

## Rejected paid-tool strategy

**Stimulsoft Reports.JS — REJECTED by explicit Owner instruction.** No recommendation, installation, adapter, license purchase, free trial, architecture dependency or future migration path is proposed for it. This intentionally removes the earlier unapproved draft's candidate language.

Also **REJECTED**: paid reporting suites, subscription services, cloud-only reporting services, tools with commercial runtime licenses, noncommercial-only “community” tools, source-available tools without compatible free commercial-use rights, and paid SheetJS Pro capabilities. Optional paid services offered alongside a genuinely permissive OSS project do not disqualify the OSS core, but none may be required, recommended as a fallback, or included in the deployment.

This Owner constraint does not close OQ-25/OQ-43 or authorize reporting implementation. It constrains future tool selection; ledger authority, module boundaries and acceptance rules remain unchanged.

## Proposed next implementation task

**Conditional task:** “Task 17 first slice — Accounting-owned final-ledger movement source, non-statutory, source-only.”

**Start condition:** repository-recorded owner authorization covering the exact source contract and Task 17 §7 gates. **Current condition: NOT MET.** There is no safe interpretation that “implementation after this audit” means automatic permission to code.

Proposed minimal deliverable after approval:

- One fixed Accounting-owned source contract/view under the existing module, one row per `LedgerEntry`, without duplication or derived book entries.
- Ledger-native columns only for the initial slice: ledger identity; stored organization/area/year/period/account; voucher and voucher-line identity, serial text and line ordinal; debit/credit exact amounts; line description; business date and posting timestamp. These are **proposed internal columns**, not approved legal headers or an Excel sample reconstruction.
- No account-title/code join, correction-header join or hierarchy rollup in this first slice unless explicitly included in the approved contract; existing IDs preserve later composition without schema invention.
- Document required scope predicates, fixed allowed filters and stable sort tie-breakers for the future consumer. No executable public endpoint, Report registry/platform or permissions installed merely as dormant scaffolding. A source view exposes organization columns but **does not itself prove access control**: any later consumer must enforce the backend scope and report permission before querying it.
- Fixture-based reconciliation and read-only/negative scope tests through the authorized internal query boundary. If establishing that boundary would require an unapproved service/platform, stop and obtain that additional task definition instead.
- If a SQL view is selected, add its migration only in that later authorized implementation; no new voucher/projection columns or speculative configuration tables. If review concludes the view is only an unnecessary alias over a single table, retain the fixed typed source contract and justify simple data access under ADR-0009. The approved task must choose one mechanism before coding.

This slice minimizes rework because it supplies ledger identities/scope/exact amounts usable by all later consumers without choosing calendar aggregation, legal columns, statement categories or a vendor engine. It does **not** deliver a usable end-user report by itself.

## Explicit non-goals

No production code in this audit. No current authorization for schema, migrations, APIs, tests, controllers, services, repositories, workers or reporting implementation. The conditional first slice also excludes:

- XLSX/CSV/Print/PDF, Electronic Books, book policies or aggregation;
- new posted vouchers, period transitions, opening/carry-forward, closing or P&L closing operations;
- P&L/balance-sheet classification or statutory trial-balance layouts;
- Report Builder, user SQL/expressions/joins, semantic entity registry or dashboards;
- new currency, FX, dimensions, branch allocation or user-area grants;
- Task 16 financial settlement/allocation or generic DocumentRelation financial authority;
- EAV, universal document tables, arbitrary JSONB configuration, microservices, Redis, another database or speculative persistence;
- changing owner decisions, clearing OQ-25/OQ-43, accepting earlier tasks or absorbing Task 12's P1 follow-up.

## Acceptance criteria for the next task

These are **proposed future criteria, not tests run by this audit**:

1. Approved bounded brief identifies source mechanism, exact columns/filters/sort/scope, intended consumer and explicit non-statutory status; OQ-25/OQ-43 interim/resolution approvals and owner authorization linked.
2. One source row per ledger entry; exact identity/amount/date/traceability equality. Fixtures include manual/system postings and actual reversal path. Draft/temporary documents have no source rows; reversed originals are not suppressed.
3. Exact debit/credit sums reconcile to the ledger and, at the existing projection grain, to Task 12 semantics. No float conversion, rounding, accidental join duplication, silent truncation or new accounting writes.
4. Stored fiscal membership preserved across partial periods and year boundaries; DATE and posting timestamp remain distinct. No implied opening carry or daily/monthly bucketing.
5. Negative organization/foreign area/year/period/account tests prove the approved consumption boundary cannot leak scope; parameterized values and whitelisted identifiers. View-only delivery explicitly documents that raw view access is not user authorization.
6. Stable ordering with unique tie-breaker, agreed limits for consumers and documented query-plan/performance evidence on a representative dataset (Reporting strategy suggests 100k rows). No unapproved index additions or generic optimization platform.
7. Execution changes no ledger/document/account/period/projection state; no maintenance calls on read. Any migration rehearsal is disposable and tests view semantics and schema drift without changing financial data.
8. Run backend formatting, lint, typecheck, unit tests, build, Prisma validation and relevant live-PostgreSQL/migration/view tests as applicable; record actual commands/results and any unavailable gate. Do not borrow historical passing results.
9. This ledger-source slice introduces no output dependency; future output tasks must independently clear every free-tool/license/maintenance/security gate above.
10. Evidence report states shipped scope versus deferred consumers; dependency states preserved; human review requested. Only the authorized reviewer/owner may accept implementation.

## Owner decisions required

### OQ-25 — do not close from these samples

For full closure, the accountant must confirm outstanding coding-level count/titles/digit lengths, mandatory control-role vocabulary/mappings, per-level eligibility defaults, nonzero-balance deactivation policy, structural migration governance, required dimensions and statutory layouts identified in `docs/open-questions.md`:42. Statement work additionally requires approved account-type/temporary classifications, mappings, signs and subtotals. Reconcile OQ-62/63 where legacy configuration pins matter; do not hide divergence with code-prefix inference.

For the proposed first slice, a **narrow interim posture** can explicitly approve ledger-native, non-statutory source fields and exclude all of those classifications/layouts. It is not closure of OQ-25.

### OQ-43 — do not close from appearance or filenames

Accountant + tax/legal owner must identify current authoritative rules, applicable taxpayer groups and effective periods, official export template/profile version, exact field order/types/date and currency conventions, numbering/gaps, chronological timing/delay limits, treatment of opening/closing/P&L close/independent/correction entries, permitted aggregation, branch obligations, immutability, submission/amendment and retention/audit requirements. Distinguish electronic books from electronic invoices/Taxpayer System and Article 169 reporting; one profile does not resolve every topic in OQ-43 (`docs/open-questions.md`:60).

Keep a versioned decision record citing authoritative sources and named owner confirmation. If only one legal profile is validated, record that bounded decision while unrelated OQ-43 requirements remain open. A non-statutory ledger-source interim approval must explicitly exclude compliance/export claims; it is not legal approval of a file layout.

### Immediate review request

1. Supply both workbooks and their provenance/settings/source-document examples.
2. Confirm whether to complete sample analysis first or authorize an independently bounded repository-only source slice, without claiming sample compatibility.
3. Accountant/product approve the exact OQ-25 interim scope; accountant/tax/legal approve the OQ-43 interim posture; architecture/reviewer confirm dependency-state handling and source mechanism.
4. Approve decomposition before assigning follow-on task numbers. Leave current brief, index and STATE statuses unchanged until actual owner decisions exist.
5. Preserve the now-explicit free-only constraint. Before any output-tool adoption, confirm distribution/notice obligations, exact free editions and maintenance gates; do not re-open paid alternatives. Resolve any **LICENSE UNCLEAR — OWNER REVIEW REQUIRED** finding without selecting that artifact in the meantime.

## Change and verification record

Only `docs/tasks/task-17/reporting-sample-audit.md` and this file are revised; they remain the two untracked documentation additions relative to HEAD. No need to change `brief.md`, `docs/accounting/task-index.md` or `STATE.md`: their existing blocked status is still correct. Baseline/HEAD hash above identifies inspected code; it is not a new implementation commit. No commit or push is required for this documentation handoff.

Checks: Git identity/status and repeated remote-main comparison; repeated workbook searches; static repository/schema/migration/dependency inspection; upstream license-text/README/API/release research; local Markdown path/required-section/scope/free-only checks; `git diff --check` plus untracked-file whitespace checks. Workbook inspection blocked by unavailable files. No backend tests, build, Prisma validation, package installation, dependency scanner or live database checks executed. No production implementation was performed. **No paid tool or dependency of any kind was added.**
