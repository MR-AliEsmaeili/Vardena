# Task 27 — Owner Decision Pack

**Audited `main` commit:** `cb521f4ba2662f4a4cdac7864cf0c712b6bba816` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

> This decision pack contains ONLY decisions that require explicit Product Owner or Repository Owner authorization.
> The agent does not decide on behalf of the owner or manufacture acceptance.

---

## Decision ID: OD-27-01

**Topic:** Formal Acceptance of Merged Work Backlog (Bootstrap Admin, Task 23, Task 24, Task 25, Task 26)

**Why this matters:**
Under repository governance rules (STATE.md §1/§6), `MERGED !== ACCEPTED`. Several significant capabilities have been merged into `main` with green GitHub CI runs across the full test suite, but have not yet received formal Owner Acceptance records. Clear acceptance establishes an unchallengeable baseline for downstream tasks.

**Current repository evidence:**
1. **Bootstrap System Administrator (PR #64, PR #72 / commit `cb521f4`):** Idempotent provisioning of `مدیر`, RBAC permissions mirror, ADR-0025 pinned organization creation, and ordinary ODR-3 membership. CI green.
2. **Task 23 Base Chart Mechanism (PR #66 / commit `7754aaa`):** Templates, versions, levels, node hierarchy, and explicit copy-on-adoption. 17 unit/E2E test files green in CI.
3. **Task 24 Account Scope R-2 (PR #67 / commit `2aae5fb`):** Organization-scoped list enforcement on `AccountsService.listAccounts`. CI green.
4. **Task 25 Governance Audit (PR #70 / commit `e3c053f`):** Governance audit, comment correction in `organization-permissions.ts`. CI green.
5. **Task 26 ODR-3 Read Scope (PR #71 / commit `e7fe80d`):** Scope assertion across all 37 SEC-01 read surfaces. CI run `36337732631` green.

**Options / decision space:**
- **Option A (Recommended):** Formally accept all five merged work items (Bootstrap Admin, Task 23, Task 24, Task 25, Task 26) based on verified green CI and Task 27 reconciliation evidence.
- **Option B:** Formally accept Task 23, Task 25, and Task 26; request targeted follow-up documentation for Bootstrap Admin or Task 24 before formal acceptance.
- **Option C:** Hold acceptance and specify required adjustments.

**Dependency:** None. All code is already merged and validated in CI.

**What remains blocked:** Formal status tracking; closure of Phase 0 governance milestone.

**What becomes actionable after decision:** Phase 0 is formally closed; all downstream implementation tasks build on an accepted baseline.

---

## Decision ID: OD-27-02

**Topic:** Base Chart Content Specification and Loading Authorization (OQ-25)

**Why this matters:**
The Base Chart *mechanism* (Task 23) is fully operational in `main`, but contains **0 template nodes** (content is not implemented). Standard chart accounts (Asset, Liability, Equity, Revenue, Expense) cannot be adopted into tenant organizations until the standard chart content artifact is approved. Automated accounting postings (from future Inventory or Sales flows) require adopted accounts.

**Current repository evidence:**
- `backend/src/modules/accounting/application/base-chart-adoptions.service.ts` supports template version publishing and adoption.
- `backend/prisma/migrations/` contains 0 seed rows for template nodes.
- `docs/open-questions.md` OQ-25 remains OPEN.
- Task 20 established the four structural invariants: Group (2 digits), General/Kol (2 digits), Subsidiary/Moein (2-3 digits), Detail/Tafsili (3 digits); leaf-only posting; copy-on-adoption.

**Options / decision space:**
- **Option A:** Approve standard Iranian SME Base Chart content artifact (codes, Persian names, account natures, postability flags) and authorize a Phase 1A implementation task to load it via the Task 23 mechanism.
- **Option B:** Defer Base Chart content loading until after the Full Inventory / Warehouse module (Phase 3A) design gate is established.
- **Option C:** Require organizations to construct charts manually without a standard pre-packaged Base Chart template in v1 MVP.

**Dependency:** OQ-25 domain decision; Task 23 mechanism (already merged).

**What remains blocked:** Pre-packaged standard chart adoption for new organizations; automated accounting journal integrations (Phase 4).

**What becomes actionable after decision:** Immediate execution of Phase 1A (Base Chart Content Loading) with 0 migrations and 0 schema changes.

---

## Decision ID: OD-27-03

**Topic:** Selection of Next Implementation Gate

**Why this matters:**
With Task 26 merged and all 37 read surfaces secured, the repository is ready to begin the next active development phase. Selecting the next gate sets the priority for the subsequent implementation task.

**Current repository evidence:**
- **Foundation & Security:** Fully in place (ODR-3 complete across 37 surfaces; global pin guard active; bootstrap admin functional).
- **Accounting Core:** Fully in place (vouchers, ledger, balance projection, reversal, read queries, Base Chart mechanism).
- **Inventory Core:** Master data and physical movement ledger in place; full operational warehouse flows (opening balances, material requests, receipt/issue workflows) pending.
- **Sales & Integrations:** Not yet started; gated by Phase 3/4.
- **Reporting:** Bounded Accounting read APIs exist; Report definition pipeline (ADR-0009) pending.

**Options / decision space:**
- **Candidate 1 (Phase 1A — Accounting Base Chart Content):** Load approved chart content through the Task 23 adoption mechanism. Sizing: Small (content JSON/fixture + API loading rehearsal).
- **Candidate 2 (Phase 3A — Full Inventory / Warehouse Operational Flow):** Begin operational warehouse coding, product master enhancements, and opening quantity flows. Sizing: Medium/Large (investigation gate first).
- **Candidate 3 (Phase 2A — Reporting Foundation Design Gate):** Establish code-defined report registry over existing Accounting/Inventory read queries per ADR-0009. Sizing: Medium (design gate).
- **Candidate 4 (Phase 6.2 / 6.3 — Security, Audit & Identity Completion):** Implement Audit module port/persistence and Identity session management. Sizing: Medium.

**Dependency:** Owner priority decision.

**What remains blocked:** Downstream development sequencing.

**What becomes actionable after decision:** Creation and execution of the selected task brief.

---

## Decision ID: OD-27-04

**Topic:** Ratification and Adoption of Implemented-Ahead-of-Governance ADRs

**Why this matters:**
8 ADRs in `docs/adr/` are marked `Proposed`, yet their corresponding capabilities have already been implemented, tested, and merged into `main`. Formally ratifying them aligns repository documentation with reality.

**Current repository evidence:**
- `ADR-0017` (Inventory Ledger as Source of Truth) $\rightarrow$ Implemented in Task 9.5
- `ADR-0018` (Bounded, Versioned Workflow) $\rightarrow$ Implemented in Task 9
- `ADR-0019` (Document Foundation and Relations) $\rightarrow$ Implemented in Task 8
- `ADR-0020` (Organizational Scope and Master Data) $\rightarrow$ Implemented in Task 6 / 19
- `ADR-0021` (Organization-Scoped Master Data) $\rightarrow$ Implemented in Task 6 / 19
- `ADR-0031` (Accounting Balance Projection) $\rightarrow$ Implemented in Task 12
- `ADR-0032` (Accounting Period Close Enforcement) $\rightarrow$ Implemented in Task 14
- `ADR-0038` (Installation Bootstrap of Pinned Deployment Organization) $\rightarrow$ Implemented in PR #72

**Options / decision space:**
- **Option A:** Formally promote all 8 ADRs to `Accepted` in a dedicated governance synchronization task.
- **Option B:** Promote ADR-0020, 0021, 0031, 0032, and 0038 to `Accepted`; clarify ADR-0017/0018/0019 in relation to ADR-0022/0023/0024.
- **Option C:** Maintain current `Proposed` status in the ADR registry while acknowledging implementation status in reports.

**Dependency:** None.

**What remains blocked:** Formal closure of documentation backlog.

**What becomes actionable after decision:** ADR registry consistency.
