# Task 20 — Accounting Chart Semantics & Master Structure — Acceptance Record

**Status:** **ACCEPTED (2026-09-26)**

**Acceptance type:** **Documentation-only governance acceptance**

**Acceptance authority:** Owner-authorized Formal Acceptance Sync

**Merged decision-resolution work:** PR [#58](https://github.com/MR-AliEsmaeili/Vardena/pull/58) — `docs: resolve Task 20 owner decisions`, merged into `main` in `10797e1400fda6329ca481877f9bbf9eff850fcd` on 2026-09-26.

**Record type:** documentation/governance only. This acceptance record introduces no production code, TypeScript, Prisma schema, migration, SQL, API endpoint, DTO, permission, authorization behavior, frontend, dependency, or production-test change.

---

## 1. Acceptance basis

The merged repository state is the source of truth. This record accepts the bounded
Task 20 decision-resolution work recorded in:

- [`accounting-chart-semantics-investigation.md`](./accounting-chart-semantics-investigation.md)
- [`task-20-implementation-gate.md`](./task-20-implementation-gate.md)
- [`owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md) §12
- [`task-index.md`](../../accounting/task-index.md),
  [`open-questions.md`](../../open-questions.md), [`STATE.md`](../../../STATE.md),
  and the Task 19 [acceptance record](../task-19/task-19-acceptance-record.md) /
  [implementation report](../task-19/task-19-implementation-report.md)
- [ADR-0033](../../adr/0033-account-identity-and-code-history.md),
  [ADR-0034](../../adr/0034-posting-versus-aggregation-accounts.md),
  [ADR-0035](../../adr/0035-account-code-structure-migration.md),
  [ADR-0036](../../adr/0036-legal-reporting-architecture.md), and
  [ADR-0037](../../adr/0037-accounting-configuration-boundary.md)

Task 20 was a documentation-only investigation, Owner-decision-resolution, and
governance task. It did not implement a production capability. The earlier gate's
**READY FOR REVIEW** verdict is the pre-acceptance gate state; this record is the
formal acceptance synchronization authorized by the Owner.

---

## 2. Accepted Owner Decisions

The following six Owner Decisions were resolved and are authoritative as recorded in
`owner-decision-baseline.md` §12. This acceptance records them without reinterpreting
or expanding them.

| Decision | Accepted authoritative outcome | Implementation boundary preserved |
|---|---|---|
| **OD-20-1 — Base Chart** | The Base Chart is a versioned, Accounting-owned database/product asset adopted explicitly into an organization. Template identity never becomes organization ledger/account identity. | Actual account codes, Persian titles, natures, mandatory accounts, statutory structure, and other chart content remain **OPEN**; no template, adoption, seed, API, or schema was implemented. |
| **OD-20-2 — Control Roles** | Control roles are consumer-first: a role is justified only by a concrete approved consumer. | The concrete role catalog and mandatory set remain **OPEN**; no generic role catalog was invented or implemented. |
| **OD-20-3 — Control Role Association** | The future Account↔Control Role association is an independent effective-dated mapping. | It is not `Account.control_role`; no mapping, schema, table, or API was implemented. |
| **OD-20-4 — Account Code History** | Controlled correction may occur before accounting use; after accounting use, `Account.code` is immutable. History is producer-bound. | No speculative code-history implementation, history table, or code-edit producer was created. Code reuse/validity questions remain under existing OQ-25/OQ-36 governance. |
| **OD-20-5 — POSTING vs AGGREGATION** | `POSTING = leaf-only`; `AGGREGATION = reporting/read-time roll-up`. Parent nodes do not receive duplicate activity; Task 18 hierarchy roll-up remains valid. | No mixed semantics or four-level hierarchy was introduced. The existing configurable-level architecture remains authoritative. **D-1 is resolved** by this decision. |
| **OD-20-6 — Dimensions** | Dimensions are transaction-line-level analytical assignments, with Accounting/read-layer aggregation when a concrete reporting consumer requires it. | Dimensions are not `LedgerEntry` identity, arbitrary ledger columns, generic JSONB, EAV, or a speculative projection. No dimension capability was implemented. |

---

## 3. Explicit non-implementation and deferred scope

Task 20 implemented **no production capability**. In particular, it did not add:

- Base Chart content, a template table, an adoption operation, or seed data;
- a control-role catalog, `Account.control_role`, an effective-dated mapping, or a
  consumer integration;
- a pre-use code-edit operation, account-code-history table, or code migration
  service;
- non-leaf posting, parent-level duplicate postings, or a reporting workaround for
  mixed POSTING/AGGREGATION semantics;
- dimensions, dimension catalogs, ledger columns, JSONB/EAV storage, APIs, UI,
  reports, or projections; or
- any production TypeScript, Prisma, migration, SQL, API, DTO, permission,
  authorization, frontend, dependency, or production-test change.

Deferred content and governance questions remain **OPEN**. Future implementation
requires separately authorized tasks; this acceptance does not define or authorize
Task 21 work.

---

## 4. Open Questions and ADR status

This acceptance does not close, reclassify, or silently convert partially resolved
questions into resolved questions. The following remain **OPEN** as applicable:

- **OQ-25** — narrowed only by the Task 20 mechanism/sequencing decisions; Base
  Chart content, concrete role catalog/mandatory set, posting defaults, code-history
  details, and related chart governance remain open.
- **OQ-41** — narrowed only by the line-level-dimension boundary; dimension content,
  defaults, bindings, governance, and area applicability remain open.
- **OQ-43**, **OQ-62**, **OQ-63**, **OQ-01**, and **OQ-22** — unchanged by Task 20.
- **OQ-36** and every other unrelated OPEN question — unchanged.

ADR-0033, ADR-0034, ADR-0035, ADR-0036, and ADR-0037 remain **Proposed** unless
and until their own governance process changes their status. Acceptance of Task 20
does **not** automatically accept, promote, or implement ADR-0033…0037.

---

## 5. Task 19 integrity

Task 19 remains **ACCEPTED** and unchanged. Task 20 does not reopen, reinterpret,
weaken, replace, or add an authorization path to any accepted Task 19 decision:

- **ODR-1 — Explicit Configuration Coherence**
- **ODR-2 — Accounting-owned Chart Tree**
- **ODR-3 — Principal-bound Organization Authorization**

Future Task 20-derived implementation must continue to respect the accepted ODR-1
coherence rule and ODR-3 organization-authorization chokepoint. This acceptance does
not modify the Chart Tree implementation.

---

## 6. Acceptance-sync verification

Lightweight documentation-only verification was performed for this synchronization:

| Check | Result |
|---|---|
| `git diff --check` | **PASS** |
| Task 20 source and acceptance paths | **PASS** — investigation, gate, and this acceptance record exist. |
| OD-20-1…OD-20-6 references | **PASS** — each is consistently recorded as authoritative/decided; D-1 is resolved by OD-20-5. |
| Deferred-capability claims | **PASS** — no positive implementation or content-decision claim for `Account.control_role`, dimensions, or the Base Chart. |
| Task 19 integrity | **PASS** — Task 19 remains accepted; ODR-1/ODR-2/ODR-3 are unchanged. |
| Production-path audit | **PASS** — this acceptance-sync diff is documentation/governance files only. |
| Heavy E2E / live PostgreSQL suite | **NOT RUN** — intentionally out of scope for this documentation-only acceptance; CI remains the authority for production execution where applicable. |

---

## 7. Acceptance statement

**Task 20 — Accounting Chart Semantics & Master Structure: ACCEPTED.**

The six Owner Decisions are formally recorded as authoritative. Task 20 is accepted
as documentation-only decision-resolution work; it implements no deferred capability,
reopens neither Task 19 nor its accepted decisions, closes no broader Open Question,
and promotes no ADR. Any future implementation requires a separately authorized task.
