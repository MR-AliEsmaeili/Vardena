# Execution Report — Product Baseline, Decision Records, MVP Scope & Roadmap

Date: 2026-09-22 · Task type: **documentation & decision governance only**

> **Declarations (required by the brief):**
> - **No application implementation was performed.**
> - **No database changes were made.** (No schema, no migrations, no Prisma edits.)
> - **No unresolved decision was marked Accepted.** All new OQs are `Open`;
>   ADR-0029/0030 are `Proposed`.
> - **MVP and roadmap are proposals** until explicitly approved by the product
>   owner, Ali Esmaeili.

## 1. Files created

| File | Purpose |
|---|---|
| `docs/product/product-business-decision-baseline-v1.md` | Phase 1 — formal Product & Business Decision Baseline (35 sections) |
| `docs/decisions/product/README.md` | Phase 3 — product decision records master index |
| `docs/decisions/product/OQ-44-multi-device-offline-sync.md` | OQ record |
| `docs/decisions/product/OQ-45-license-expiry-behavior.md` | OQ record |
| `docs/decisions/product/OQ-46-customer-data-export-format.md` | OQ record |
| `docs/decisions/product/OQ-47-exchange-rate-and-multicurrency-rules.md` | OQ record |
| `docs/decisions/product/OQ-48-revaluation-and-fx-gain-loss.md` | OQ record |
| `docs/decisions/product/OQ-49-report-builder-mvp-depth.md` | OQ record |
| `docs/decisions/product/OQ-50-webhooks-and-api-surface.md` | OQ record |
| `docs/decisions/product/OQ-51-taxpayer-release-boundary.md` | OQ record |
| `docs/decisions/product/OQ-52-backup-rpo-rto-targets.md` | OQ record |
| `docs/decisions/product/OQ-53-disaster-recovery-and-restore.md` | OQ record |
| `docs/decisions/product/OQ-54-finalized-document-deletion-editing.md` | OQ record |
| `docs/decisions/product/OQ-55-branch-as-cost-center.md` | OQ record |
| `docs/decisions/product/OQ-56-two-book-accounting.md` | OQ record |
| `docs/decisions/product/OQ-57-marketplace-extension-security.md` | OQ record |
| `docs/decisions/product/OQ-58-public-release-vs-internal-only.md` | OQ record |
| `docs/decisions/product/OQ-59-product-family-vs-consolidation.md` | OQ record |
| `docs/decisions/product/OQ-60-mvp-acceptance-thresholds.md` | OQ record |
| `docs/decisions/product/OQ-61-crm-ticketing-timing-ownership.md` | OQ record |
| `docs/adr/0029-machine-api-access-model.md` | Proposed ADR — machine/API access |
| `docs/adr/0030-license-foundation.md` | Proposed ADR — license foundation |
| `docs/product/mvp-scope-proposal-v1.md` | Phase 4 — MVP scope proposal |
| `docs/product/development-roadmap-v1.md` | Phase 5 — staged roadmap |
| `docs/product/execution-report-v1.md` | This report |

## 2. Files updated

| File | Change |
|---|---|
| `docs/open-questions.md` | Registered OQ-44…OQ-61 (18 one-row entries pointing to full records in `docs/decisions/product/`) |
| `docs/adr/README.md` | Indexed ADR-0028 (was missing from the index table) + ADR-0029/0030 (Proposed) |

## 3. Existing files inspected (no changes)

`.vardena/project-context.md` · `.vardena/architecture-rules.md` ·
`.vardena/agent-rules.md` · `docs/architecture.md` · `docs/security.md` ·
`docs/database-strategy.md` · `docs/reporting-strategy.md` ·
`docs/integrations.md` · `docs/modules.md` (via search) ·
`docs/open-questions.md` · `docs/adr/README.md` · ADR-0026/0028 ·
`docs/accounting/domain-contract.md` (via search) ·
`docs/accounting/task-index.md` · `docs/architecture/domain/*` (via search) ·
repository root/docs structure.

## 4–7. Decision counts

| Category | Count | Detail |
|---|---|---|
| **Confirmed decisions (DECIDED)** | **40** | PD-01…PD-40 rows classified D or D-with-open-detail in PB-BASELINE §33 (core architecture, FaraPayam independence, deployment model, MVP modules, platform capabilities, data ownership, Excel export, security posture, commercial structure, trade-off policy, non-goals, etc.) |
| **Directional (DIRECTIONAL)** | **14** | PD-06 SaaS, PD-07 pricing numbers, PD-20 compliance detail, PD-21 taxpayer scope, PD-22 multi-DB, PD-23 branches, PD-31 LTS, PD-34 marketplace, PD-37 CRM, industry strategy, guided help, pen-test timing, LTS, product-family direction |
| **Assumptions (ASSUMED)** | **3** | Success-criterion *numbers* (PD-38), Report-Builder recommended level (inside OQ-49), roadmap-stage interim postures explicitly labeled "recommendation only" |
| **Open questions (registered)** | **18 new** | OQ-44…OQ-61 (plus 43 existing OQs referenced, not duplicated) |
| **Proposed ADRs** | **2** | ADR-0029, ADR-0030 |

Existing OQs intentionally **not** duplicated: OQ-39/42 (system posting),
OQ-25/43 (chart/statutory), OQ-24 (valuation), OQ-27 (corrections),
OQ-22/31 (branch/multi-company), OQ-02/03 (locale/currency precision),
OQ-12 (numbering), OQ-16/32 (purchasing/payroll), OQ-05 (taxpayer scope),
OQ-17 (retention), OQ-04 (FaraPayam contract), OQ-41 (dimensions).

## 8. MVP scope summary

- **A (operational, 27 features):** accounting core (fiscal years, coding
  structure, chart, manual vouchers, atomic posting/ledger), inventory
  (items/units/warehouses/opening/receipts/issues), sales (parties, minimal
  invoice, print), reporting (inventory/sales/minimal P&L, Report Builder at
  OQ-49 level, dashboard, Excel export), backup/restore customer surface,
  license *foundation* (enforcement-off), security hardening.
- **B (platform foundation, 12):** RBAC, documents, workflow, outbox,
  jobs, notifications, customization, print, OpenAPI, compose deployment,
  license record, machine-access foundation (post-MVP build).
- **C (excluded, 18):** purchasing, payroll, taxpayer adapter, offline sync,
  multi-currency ops, webhooks/public API, marketplace, SaaS, CRM/ticketing,
  two-book, allocation, impersonation (prohibited), license *enforcement*, etc.
- **D (decision-dependent, 10):** system posting (OQ-39/42), dimensions
  (OQ-41), builder depth (OQ-49), P&L layout (OQ-25/43), cancel/edit policy
  (OQ-54), locale (OQ-02), tax fields (OQ-30), backup targets (OQ-52/53),
  license record (ADR-0030), opening balances (OQ-11).
- **E (post-MVP candidates):** listed set in MVP-SCOPE §6.
- **8 acceptance gates (G1–G8)** tied to PB §30 and OQ-60 numbers.

## 9. Roadmap summary

Ten dependency-ordered stages, no invented dates: **0** decision/governance
closure → **1** platform stabilization (license foundation, update pipeline)
→ **2** accounting core (policy-gated gaps) → **3** inventory ⇄ accounting
integration (OQ-39 durability ADR) → **4** sales + taxpayer readiness →
**5** report builder → **6** MVP hardening & pilot readiness (G1–G8) →
**7** post-MVP modules → **8** commercial operations (enforcement, public
posture) → **9** advanced offline/enterprise/SaaS readiness. Each stage lists
objective, capabilities, dependencies, exit criteria, risks, non-goals, and
gating OQ/ADR decisions.

## 10. Blocking vs non-blocking decisions

**Blocking (before MVP scope ratification / Stage 0):**
OQ-49 (Report Builder depth), OQ-60 (acceptance thresholds), ADR-0029 +
ADR-0030 ratification, OQ-54 + OQ-02 + OQ-45 (interim or full) for stage
entry, and the pre-existing OQ-39/OQ-42/OQ-25/OQ-43 chain for Stages 2–3.

**Non-blocking (later-stage or strategic):** OQ-44, OQ-46, OQ-47, OQ-48,
OQ-50, OQ-51 (Stage-4 gate only), OQ-52/OQ-53 (Stage-6 gate), OQ-55, OQ-56,
OQ-57, OQ-58, OQ-59, OQ-61.

## 11. Risks discovered (beyond PB §34)

- The **ADR index gap**: ADR-0028 existed but was absent from
  `docs/adr/README.md` — governance drift (fixed in §2 above).
- **Owner-bottleneck batching** across 18 OQs — mitigated by a single
  Stage-0 consolidated decision session using each OQ's "Questions requiring
  product owner confirmation" section as the agenda.
- **ADR-0027 numbering gap** (0027 absent, 0028 used): recorded here; the
  "sequential, never reused" rule reads as a skip, so 0029/0030 were issued
  rather than back-filling 0027 — owner may regularize if desired.

## 12. Items requiring direct approval from Ali Esmaeili

1. Ratify PB-BASELINE v1 (status → Accepted, or amend).
2. Ratify MVP-SCOPE v1 and ROADMAP v1.
3. **OQ-49** — Report Builder MVP depth (recommendation: level B).
4. **OQ-60** — acceptance numbers, P0/P1 definitions, gates vs measures.
5. **ADR-0029** — machine/API access model (Proposed → Accepted).
6. **ADR-0030** — license foundation, enforcement-off (Proposed → Accepted).
7. **OQ-45** — license expiry/termination behavior (can be interim for
   Stage 1).
8. **OQ-54** — document cancel/edit posture (interim acceptable for Stage 4).
9. **OQ-02** — UI language/calendar (blocks A-26 UX baseline).
10. Stage-2/3 gates when reached: OQ-23/25/27/41 (Stage 2), OQ-39 + its ADR,
    OQ-42/24/29/30 (Stage 3).
11. Later-stage gates: OQ-51 (Stage 4), OQ-52/53 (Stage 6), OQ-46/58/61
    (Stage 8), OQ-44/47/48/50/55/56/57/59 (post-MVP/strategic).
