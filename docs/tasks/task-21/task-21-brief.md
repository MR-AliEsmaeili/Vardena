# Task 21 — Base Chart Governance & OQ-25 Resolution — Brief

- **Document type:** task brief — **DESIGN / GOVERNANCE ONLY (DOCUMENTATION ONLY)**
- **Date:** 2026-09-26
- **Task status:** **ACCEPTED (2026-09-26)** (the Agent does not self-accept)
- **Branch:** `arena/01a0de9b-vardena`
- **Baseline:** `main` @ `10797e1400fda6329ca481877f9bbf9eff850fcd`
- **Companion deliverables:**
  - [`task-21-investigation.md`](./task-21-investigation.md)
  - [`task-21-governance-baseline.md`](./task-21-governance-baseline.md)

> This brief authorizes **no implementation**. It does not promote an ADR, does
> not create schema/migrations/seed/API/DTO/permission/UI, does not close Task 19
> or Task 20, does not close OQ-41 or OQ-43, and does not self-accept Task 21.
> **Production changes in this task: NONE.**

---

## 1. Objective

Resolve the still-open **Base Chart governance/content decisions** inside **OQ-25**
to the extent they can be decided *safely and explicitly*, so that a future
Base Chart implementation task can proceed **without inventing accounting
semantics**.

Task 21 answers the governance questions:

> What exactly is Vardena's Base Chart, what content model does it carry, who
> governs it, how is it versioned, how is it adopted, what is copied into an
> organization's chart, and which parts remain organization-configurable?

Task 21 does **not** answer the *accounting-content* questions (the actual codes,
Persian titles, natures, mandatory list, role catalog). Those remain
expert-gated under OQ-25.

## 2. Scope (in)

Within OQ-25's remaining implementation-design surface, Task 21 works on
items **1–3** and defines only the *boundary/dependency* for item **4**:

1. **Base Chart content model** — the authoritative *conceptual fields* a Base
   Chart entry may/may not carry (not the values).
2. **Control-role governance contract** — what qualifies as a control role, who
   may introduce one, evidence required, how consumers bind, how role-backed
   mandatory accounts differ from mandatory chart accounts. Catalog stays OPEN.
3. **Per-level posting defaults** — the role of Base Chart / configuration-level
   posting defaults under the accepted leaf-only posting invariant.
4. **Account lifecycle / code validity boundary** — the explicit dependency
   boundary between OQ-25 and **OQ-36** (deactivation/deletion/code-reuse/history).
   Only the boundary is defined here; the policy stays with OQ-36.

Task 21 also defines the governance model for: Base Chart **definition vs
adoption vs ledger identity**, **adoption semantics** (copy vs reference, version
pinning, partial adoption), **mandatory-account semantics**, **organization
customization** classification, and the Base Chart **version lifecycle**.

## 3. Scope (out) — hard non-goals

Task 21 MUST NOT and does NOT:

- implement Base Chart tables, migrations, seed data, account templates in Prisma,
  adoption APIs/services, account imports;
- implement control-role tables/APIs, dimension tables/APIs, statutory reports,
  Iranian legal profile, a posting-rule engine, tax/inventory account mappings,
  an account-code-history producer, or any UI;
- create any production code, schema, migration, SQL, DTO, permission, frontend,
  or test requiring production implementation;
- **invent accounting content**: account codes, titles, natures, mandatory
  account lists, or a concrete control-role catalog;
- absorb, solve or close **OQ-41** (dimensions) or **OQ-43** (statutory);
- reopen, weaken, or contradict Task 19 (ODR-1/ODR-2/ODR-3) or Task 20
  (OD-20-1…OD-20-6);
- promote any ADR to Accepted, or self-accept Task 21.

## 4. Preserved accepted decisions (must not be reopened)

**Task 19:** ODR-1 Explicit Configuration Coherence · ODR-2 Accounting-owned
Chart Tree · ODR-3 Principal-bound Organization Authorization.

**Task 20:** OD-20-1 Base Chart mechanism/ownership · OD-20-2 consumer-first
control roles · OD-20-3 independent effective-dated control-role mapping ·
OD-20-4 pre-use code correction / post-use immutability · OD-20-5 leaf-only
posting / read-time aggregation · OD-20-6 line-level dimension boundary.

Task 21 is a **refinement of the still-open portions of OQ-25** built on top of
those decisions. It is not permission to reinterpret them.

## 5. Deliverables

| File | Purpose |
|---|---|
| `docs/tasks/task-21/task-21-brief.md` | This brief (scope/non-goals). |
| `docs/tasks/task-21/task-21-investigation.md` | Repository reading + per-question findings, evidence-based. |
| `docs/tasks/task-21/task-21-governance-baseline.md` | The governance conclusions, decision matrix, classification, and future-implementation contract. |

Also updated (documentation only): `docs/open-questions.md` (OQ-25 row narrowed),
`docs/accounting/task-index.md` (Task 21 registered + document history),
`docs/accounting/owner-decision-baseline.md` §6 (open-item pointers to Task 21).
No ADR is promoted or created.

## 6. Acceptance boundary

Task 21 finishes as **READY FOR REVIEW — NOT ACCEPTED**. The likely correct
outcome is **OQ-25 = substantially narrowed**, not fully resolved: concrete
accounting content (codes, titles, natures, mandatory list, role catalog) still
requires Owner/accountant approval and therefore stays OPEN.
