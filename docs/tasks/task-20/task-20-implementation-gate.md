# Task 20 — Implementation Gate

- **Document type:** implementation decision gate — **DOCUMENTATION ONLY**
- **Date:** 2026-09-26
- **Task status:** **READY FOR REVIEW — NOT ACCEPTED** (the Agent does not self-accept)
- **Gate recommendation:** **READY FOR REVIEW**
- **Branch:** `arena/01a0de02-vardena`
- **Baseline:** `main` @ `1efa3f386e40d7ee1bc0a8f55f11120cd971ddaf` (post-Task-20 investigation merge)
- **Investigation:** [`accounting-chart-semantics-investigation.md`](./accounting-chart-semantics-investigation.md)

> This gate authorizes **no implementation**. It does not promote an ADR, does not
> close an Open Question, does not reopen Task 19 and does not mark Task 20 as
> accepted. Production changes in this task: **NONE**.

---

## 1. Gate verdict

```text
READY FOR REVIEW
```

The previous Task 20 gate was blocked because OD-20-1…OD-20-6 were missing. The
Owner has now supplied those decisions explicitly. This document records the new
state and keeps implementation deferred.

---

## 2. Decision-resolution matrix

| Decision | Status | Documentation consequence | Implementation consequence |
|---|---|---|---|
| **OD-20-1 — Base Accounting Chart** | **RESOLVED** | Base Chart is a versioned Accounting-owned database/product template asset; explicit adoption creates organization-owned Account identities; template ids never become ledger references. Content remains accountant/domain-approved, not agent-invented. | Deferred: no template table, migration, seed, adoption service, API or account content. |
| **OD-20-2 — Control Roles** | **RESOLVED** | Consumer-first strategy; no speculative generic catalog. A role appears only when a concrete approved consumer justifies it. | Deferred: no role table, enum, seed catalog, migration, API or service. |
| **OD-20-3 — Control Role Artifact Shape** | **RESOLVED** | Authoritative Account↔Control Role association is an independent effective-dated mapping. `Account.control_role` is explicitly rejected as the primary architecture. | Deferred until a real consumer requires roles; exact physical schema remains future-task design. |
| **OD-20-4 — Account Code History** | **RESOLVED** | `Account.id` is permanent identity; `Account.code` is business-facing address. Controlled pre-use code correction is permitted; after accounting use code is immutable. History is producer-bound. | Deferred: no pre-use edit operation, history table, fake seed history, or report behavior change. |
| **OD-20-5 — POSTING vs AGGREGATION** | **RESOLVED — D-1 CLOSED** | `POSTING = leaf-only`; `AGGREGATION = reporting/read-time roll-up`. Existing `postable ⇒ leaf` and Task 18 roll-ups remain authoritative. | No implementation required; non-leaf posting would require a new explicit future architecture decision. |
| **OD-20-6 — Dimensions** | **RESOLVED** | Initial dimension model is transaction-line-level analytical assignment; aggregation happens through Accounting/read logic for concrete consumers. No ledger-entry dimension identity, no arbitrary columns, no generic JSONB, no speculative projection. | Deferred: no dimension tables, catalogs, migrations, APIs, UI, reports or projections. |

---

## 3. READY-criteria assessment

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Scope is bounded | **PASS** | Task 20 is documentation/decision resolution only. Future implementation slices remain explicit and deferred. |
| 2 | Required Owner decisions exist | **PASS** | OD-20-1…OD-20-6 are recorded as DECIDED in `owner-decision-baseline.md` §12 and reflected in ADR-0033/0034/0035/0037, OQ rows and this gate. |
| 3 | No unresolved architecture contradiction blocks review | **PASS** | D-1 resolved by OD-20-5; T20-C-1 resolved by OD-20-3. |
| 4 | Required ADRs appropriately updated | **PASS for documentation review** | ADR-0033/0034/0035/0037 were amended to record the decisions; all remain **Proposed** because Task 20 does not promote or accept ADRs. |
| 5 | No silent change to Task 19 | **PASS** | ODR-1/ODR-2/ODR-3 unchanged. Dependencies T20-T19-DEP-1 and T20-T19-DEP-2 remain future constraints only. |
| 6 | No unresolved security/tenant boundary introduced | **PASS** | Future organization-scoped surfaces must reuse the accepted ODR-3 membership chokepoint. |
| 7 | Data ownership clear enough for review | **PASS** | Base Chart template = Accounting-owned product asset; adopted accounts = organization-owned; control-role mappings/dimensions/code history = future Accounting surfaces. |
| 8 | Migration strategy understood | **PASS for this task** | No migration in Task 20. Future migrations are additive and producer/consumer-driven. |
| 9 | Historical accounting integrity protected | **PASS** | No ledger/account/schema change; OD-20-4 and OD-20-5 preserve id-keyed ledger and leaf-only postings. |
| 10 | Testing strategy defined | **PASS** | Documentation-only verification limited to static checks; heavy E2E explicitly not run. |
| 11 | Cross-module ownership explicit | **PASS** | Control roles are introduced by real consumers; dimensions aggregate through Accounting/read layer for concrete reporting consumers. |
| 12 | No dangerous invariant left implicit | **PASS** | Leaf-only posting and read-time aggregation are explicit; role mapping shape is explicit; dimensions are line-level analytical assignments. |

---

## 4. OQ / ADR status after resolution

| Artifact | Previous status | New status | Reason |
|---|---|---|---|
| **OQ-25** | OPEN | **OPEN — narrowed by OD-20-1…OD-20-5** | Mechanism/sequencing/shape resolved; content remains open: Base Chart accounts, concrete role catalog/mandatory set, per-level leaf posting defaults, code reuse/history details, deletion guards, statutory layouts. |
| **OQ-41** | OPEN | **OPEN — narrowed by OD-20-6** | Initial persistence/aggregation boundary resolved; count/defaults/binding/governance/area applicability remain open. |
| **OQ-36** | OPEN | OPEN | Still owns code reuse/deletion policy interactions. |
| **OQ-62/OQ-63** | OPEN | OPEN | Task 20 does not repair legacy pin divergence or fallback shape. |
| **ADR-0033** | Proposed | **Proposed — amended** | Records OD-20-4 producer-bound history and pre-use/post-use code boundary. |
| **ADR-0034** | Proposed | **Proposed — amended** | Records OD-20-5 and resolves D-1 as leaf-only posting/read-time aggregation. |
| **ADR-0035** | Proposed | **Proposed — amended** | Records that code history cannot be shipped speculatively before a producer. |
| **ADR-0037** | Proposed | **Proposed — amended** | Records OD-20-1/2/3/6 for Base Chart, consumer-first roles, effective-dated mapping and line-level dimensions. |

No ADR is promoted to Accepted by Task 20.

---

## 5. Task 19 integrity

Task 19 is not reopened, rewritten, weakened or replaced.

- **ODR-1 Explicit Configuration Coherence** remains accepted.
- **ODR-2 Accounting-owned Chart Tree** remains accepted.
- **ODR-3 Principal-bound Organization Authorization** remains accepted.

Task 20 only carries forward two constraints for future work:

```text
T20-T19-DEP-1: future Base Chart adoption/configuration must produce a coherent
               coding_structure_version + accounting_configuration pair.

T20-T19-DEP-2: future Base Chart, Control Role and Dimension surfaces must respect
               the ODR-3 organization authorization chokepoint.
```

---

## 6. Explicit non-scope

Task 20 does not implement or authorize:

- Base Chart template tables/content/adoption operation/seed data
- control-role table, enum, catalog, mapping table, service or API
- pre-use account-code edit operation or account-code-history table
- non-leaf posting, own-vs-descendant balances or double-counting workarounds
- dimension tables/catalogs/APIs/UI/report endpoints/projections
- production code, Prisma schema, migrations, SQL, DTOs, permissions, services,
  repositories, frontend, runtime configuration or tests

---

## 7. Verification performed

| Check | Result |
|---|---|
| `git diff --check` | **PASS** |
| Documentation reference/status review | **PASS** — OD-20-1…OD-20-6 trace through Task 20 docs, owner baseline, affected ADRs, domain contract, OQ rows, task index and STATE. |
| D-1 status review | **PASS** — current authoritative docs resolve D-1 as leaf-only posting/read-time aggregation. |
| Control-role artifact review | **PASS** — final architecture is effective-dated mapping; `Account.control_role` is only mentioned as a rejected artifact. |
| Task 19 integrity review | **PASS** — ODR-1/ODR-2/ODR-3 not modified. |
| Production/schema/migration/test path audit | **PASS** — documentation-only diff. |
| Heavy E2E / live PostgreSQL | **NOT RUN** — intentionally omitted for this documentation-only task. |

---

## 8. Gate recommendation

```text
READY FOR REVIEW
```

The Owner will perform acceptance separately.
