# C-47–C-54 — Inventory/Warehouse Dependency Review and Owner-Decision Recording

| Field                                    | Value                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                                   | **READY FOR REVIEW — NOT ACCEPTED**                                                                                                                                                                                                                     |
| Date                                     | 2026-10-02 (UTC)                                                                                                                                                                                                                                        |
| Inspection baseline                      | `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107)                                                                                                                                                                                  |
| Type                                     | Documentation, governance and dependency reconciliation only                                                                                                                                                                                            |
| Production code / schema / tests changed | **NONE**                                                                                                                                                                                                                                                |
| Scope                                    | Record the 2026-10-02 Owner decisions (OQ-29 Option A, OQ-33 Option D, PDR-01 barcode, OQ-36 item-scope Option C); reconcile C-47 status; review C-47–C-54 dependencies. **No warehouse operational implementation is started, authorized or implied.** |

## 1. Purpose and method

This report executes a documentation/governance task with three parts: (1)
record explicit Owner decisions in the canonical OQ registry and the product
decision records; (2) reconcile the C-47 (item master) status accurately —
merged PR + green CI is **not** Owner acceptance; (3) review the Roadmap and
Dependency Matrix for candidates C-47 through C-54, verifying the exact current
scope and status of every named prerequisite OQ from the registry itself rather
than from identifiers or memory.

Sources read in full or checked against current `main`:
`.vardena/{project-context,architecture-rules,agent-rules}.md`, `STATE.md`,
`docs/open-questions.md`, `docs/decisions/product/` (README + OQ-54 record),
`docs/roadmap/{backend-mvp-roadmap,backend-mvp-dependency-matrix,future-task-candidates}.md`,
`docs/current-state-reconciliation.md`,
`docs/tasks/c-47-item-master-preflight-investigation.md`,
`docs/tasks/c-47-item-master-readiness-hardening-report.md`,
`docs/accounting/task-index.md` (§7 gate), ADR-0022/0023/0024, and the
Inventory implementation surface (`backend/src/modules/inventory/**`,
`backend/prisma/schema/inventory.prisma`).

### Read-only inspection commands executed

```text
git status --short; git log -1 --oneline
gh pr list --state merged --limit 20 (merge evidence for the audited span)
grep -RniE 'OQ-(11|24|29|33|36|39|42|54)|C-4[7-9]|C-5[0-4]|barcode|بارکد' docs STATE.md .vardena
grep -RniE 'opening|material.?request|receipt|issue|kardex' backend/src/modules backend/prisma/schema
sed/grep over backend/src/modules/inventory/{domain,application,api} and inventory.prisma
```

No test, build, typecheck, lint, Prisma, server, E2E, live-PostgreSQL,
migration or migration-rehearsal command was executed. Per the work order and
`docs/testing/test-execution-policy.md`, only fast documentation consistency
checks were run locally (§8).

## 2. Owner decisions recorded (2026-10-02)

All four decisions are recorded in `docs/decisions/product/` (decision
register) with the registry rows in `docs/open-questions.md` updated to point
at them. **No OQ is fully resolved**; each decision is scoped to exactly what
the Owner answered.

| Decision                                  | Content (essence)                                                                                                                                                                                                                                                                                                                                                                   | Record                                                              | Registry effect                                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ-29 — Option A**                      | Fixed quantity precision of four fractional decimal places (`numeric(18,4)`); conversion results not exactly representable at that precision are **rejected** — no rounding, no silent truncation; factor changes only via effective-dated versions; historical versions and prior-transaction interpretation data preserved                                                        | `docs/decisions/product/OQ-29-quantity-precision-and-conversion.md` | OQ-29 row stays **OPEN**: global-vs-item-specific precedence/scope (incl. item-specific-over-global override, reverse-pair derivation) not answered                                                                                                            |
| **OQ-33 — Option D**                      | New item kinds or capability flags may be introduced **only** when a concrete need has been identified and accepted through the project's decision/governance process                                                                                                                                                                                                               | `docs/decisions/product/OQ-33-item-taxonomy-and-capabilities.md`    | OQ-33 row stays **OPEN**: **Option A is NOT approved**; the Owner has not confirmed the eight-kind list + per-item capability model — that confirmation remains OPEN                                                                                           |
| **Barcode policy — Option A (confirmed)** | Barcode optional; uniqueness enforced within an organization; two **active** items in one organization must not share a barcode; different organizations may use the same barcode; multiple formats supported with **no strict symbology validation** unless separately approved; **no multi-barcode-per-item** support; no production code/schema change in the documentation task | `docs/decisions/product/PDR-01-item-barcode-policy.md`              | Unresolved lifecycle detail registered as **OQ-65** (Open): reuse of a deactivated item's barcode; re-enable conflicts; comparison/normalization semantics. The active-scoped uniqueness wording must not be read as deciding reuse                            |
| **OQ-36 — Option C (item scope)**         | Physical deletion permitted **only** when the item has never been referenced by any operational, ledger or historical record; referenced items must not be physically deleted; history and organization-scoped identity constraints preserved                                                                                                                                       | `docs/decisions/product/OQ-36-item-deletion-and-code-reuse.md`      | OQ-36 row stays **OPEN**: code reuse after physical deletion of a never-referenced item (and after deactivation), case sensitivity, soft-delete posture, non-item master data and the Task 21 §10 account-scoped Base Chart prerequisites are **not** answered |

Implementation evidence and follow-up questions are linked inside each record
(quantities/conversion code and tests, item-kind/capabilities code, permissions
registry, schema constraints, CI runs of PR #107). Current `main` already
conforms to OQ-29 Option A (the decision approves previously interim
fail-closed behavior); the PDR-01 uniqueness rule and the OQ-36 Option C
eligibility rule are **decided but not implemented** — no schema, endpoint,
permission or test change was made in this task.

## 3. C-47 status reconciliation

- The C-47 item-master hardening slice (defect fixes D-1…D-3, regression
  coverage G-1…G-17) is **merged** as PR #107 into `main` @ `4cf481e`, with
  green CI including the live-PostgreSQL suites (runs `36991377976`,
  `36992098706`; register also cites `36992935996`).
- **Merged and CI-green is not Owner acceptance** (roadmap rule 0.1.2; STATE.md
  §6). No Owner acceptance record exists for C-47 or for the hardening PR.
  C-47 therefore remains **NOT ACCEPTED**.
- After the 2026-10-02 decisions, C-47's blocker set is narrowed but not
  cleared: still open are the **OQ-33 taxonomy/capability confirmation**
  (Option A explicitly not approved), **OQ-36 code-reuse/case policy**, the
  **OQ-65 barcode lifecycle** detail, and the **OQ-29
  global-vs-item-specific precedence** subquestion. The decided-but-unimplemented
  policies (barcode uniqueness enforcement; item deletion eligibility) are
  implementation gaps that require a separately authorized bounded task.
- The Future Task Candidate Register C-47 row and the Dependency Matrix §3 row
  were updated to this exact state; nothing in them claims acceptance.

## 4. Prerequisite OQ verification (registry-verbatim scope and status)

Verified from `docs/open-questions.md` on current `main` — not inferred from
identifiers.

| OQ                            | Exact scope (registry wording, condensed)                                                                                                                                                                | Current status                                                                                                                                                                                                                                                     | Relevance to C-47–C-54                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ-11**                     | Ledger behavior specifics: double-entry chart structure, period close/reopen rules, **opening balance import**, cost accounting method for inventory (standard/moving avg/weighted)                      | **OPEN** — shape fixed by the accounting contract (Task 10.1); policy (opening import, costing method) remains open                                                                                                                                                | Blocks **C-48** (opening policy) and **C-49** (accounting opening + valuation)                                                                                               |
| **OQ-24**                     | Inventory valuation and stock policy: costing method (moving weighted average / FIFO / standard), how returns/adjustments/negative stock affect cost, **whether negative stock is permitted at all**     | **OPEN** — ledger records quantity and (where known) unit cost; method is configuration consuming the ledger; negative stock defaults to **reject** until decided (per-item/warehouse override fields exist as implementation posture, `negative-stock-policy.ts`) | Blocks **C-48, C-49, C-51, C-52, C-53, C-54** (rial flows, valuation, stock settings, rial Kardex)                                                                           |
| **OQ-39**                     | Durable integration semantics for system-generated accounting: transactional in-process subscription vs durable queued/outbox delivery; rejected-posting semantics; which events must never be lost      | **OPEN** — no production system-generated posting; in-memory event bus only (ADR-0024 §9 accepted gap)                                                                                                                                                             | Blocks the **rial/accounting-effect halves of C-51/C-52** and C-22 (Inventory → Accounting)                                                                                  |
| **OQ-42**                     | System-generated posting policy: Mode A (directly final) vs Mode B (draft + accounting authority finalize); default; approval authority; segregation of duties; rejection meaning; backlog governance    | **OPEN** — mechanism decided (AC-D-27/28); interim assumption: nothing system-posted until OQ-39 + mapping rules; Mode B recorded as the safer default (assumption, not rule)                                                                                      | Blocks activation of system posting in **C-51/C-52** rial flows; C-22/C-23                                                                                                   |
| **OQ-54**                     | Finalized document deletion/editing policy: cancel-only vs edit-until-posted vs per-type configuration; visibility of canceled documents; numbering gaps (OQ-12); cancel approval coupling (OQ-13/OQ-26) | **OPEN** — cancel-only/visible/audited is a **recommendation, not decided**; record: `docs/decisions/product/OQ-54-finalized-document-deletion-editing.md`                                                                                                         | The register's blocking OQ for **C-50** ("as applicable"); its own record also names warehouse receipts/issues, so it equally gates the document lifecycles of **C-51/C-52** |
| OQ-29 / OQ-33 / OQ-36 / OQ-65 | See §2                                                                                                                                                                                                   | Partially decided / open as above                                                                                                                                                                                                                                  | C-47 completion; C-48–C-52 inherit the decided OQ-29 Option A quantity rule                                                                                                  |
| OQ-12 / OQ-13 / OQ-26         | Numbering gap policy; approval states (incl. negative stock mention); approval policy content                                                                                                            | **OPEN** (mechanisms exist: Document Foundation numbering; Workflow single-level approvals)                                                                                                                                                                        | Investigation inputs for **C-50** (numbering gaps, approval coupling), not structural blockers                                                                               |
| OQ-49                         | Report Builder MVP depth                                                                                                                                                                                 | **OPEN** — builder not admitted; bounded reports are not blocked by it                                                                                                                                                                                             | Blocks only a generic builder under **C-54**; bounded Kardex/reports are gated by OQ-24 instead                                                                              |

## 5. Candidate-by-candidate dependency matrix (C-47–C-54)

Readiness vocabulary: `BLOCKED` (gated by open OQ/ADR decisions) · `READY TO
INVESTIGATE` (investigation can start; implementation still gated) ·
`IMPLEMENTATION CANDIDATE` (decisions collected; a bounded task can be
authorized). None of the rows below authorizes anything.

| Candidate                                           | Current status & evidence                                                                                                                                                                                                                                                                                                      | Upstream dependencies (exist?)                                                                                                                                                                                                  | Blocking OQs / ADRs                                                                                                                                                                                                                                                                   | Readiness                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C-47 Product/item master completion**             | Master implemented + hardened (PR #106 preflight, PR #107 hardening: `docs/tasks/c-47-item-master-preflight-investigation.md`, `docs/tasks/c-47-item-master-readiness-hardening-report.md`, STATE.md §17); Owner decisions recorded 2026-10-02 (§2); barcode uniqueness + deletion eligibility decided but **not implemented** | Inventory master, unit/conversion contract — **implemented** (items/groups/units/conversions/warehouses + movement ledger, ADR-0022 Accepted)                                                                                   | Open: OQ-33 confirmation, OQ-36 code reuse/case, OQ-65, OQ-29 precedence. ADR-0022 Accepted                                                                                                                                                                                           | **BLOCKED for completion** (remaining open subquestions + unimplemented decided policies); the merged hardening awaits Owner review — **NOT ACCEPTED**. A bounded implementation follow-up is justified once the outstanding decisions are collected (§7) |
| **C-48 Opening quantity**                           | NOT PRESENT as an operational flow — no opening document; the movement vocabulary deliberately has no `opening` type (initial loads post as `inbound`; a distinct type is a designed follow-up: `backend/src/modules/inventory/domain/movement-type.ts`)                                                                       | Product/warehouse master + movement ledger — **implemented**; quantity rule now decided (OQ-29 Option A)                                                                                                                        | **OQ-11** (opening policy), **OQ-24** (costing/negative stock); OQ-23 interplay for accounting opening linkage noted in code                                                                                                                                                          | **BLOCKED**                                                                                                                                                                                                                                               |
| **C-49 Opening rial**                               | NOT PRESENT                                                                                                                                                                                                                                                                                                                    | C-48 (opening quantity), Accounting core — **implemented**; valuation — absent                                                                                                                                                  | **OQ-11, OQ-24, OQ-25** (register); OQ-25's MVP-scope sub-question is decided (OD-27-02: content not required) but valuation/mapping inputs are not; system-posted rial effects would additionally need OQ-39/OQ-42                                                                   | **BLOCKED**                                                                                                                                                                                                                                               |
| **C-50 Material Request**                           | NOT PRESENT — no material-request code anywhere in `backend/src` / Prisma (verified by grep)                                                                                                                                                                                                                                   | Documents Foundation (types, numbering, allocation ledger, relations — **implemented**, ADR-0023 Accepted); Workflow (definitions/instances/approvals — **implemented**, ADR-0024 Accepted); Inventory master (**implemented**) | **OQ-54 as applicable** (finalized-document lifecycle/cancel policy — OPEN); investigation inputs: OQ-13/OQ-26 (approval coupling), OQ-12 (numbering gaps). No accounting effect is inherent to a request document, so OQ-39/OQ-42/OQ-24 do not structurally gate the document itself | **READY TO INVESTIGATE** — verified; see §6                                                                                                                                                                                                               |
| **C-51 Warehouse Receipt quantity/rial**            | Quantity core **implemented** (movement posting, conversion resolution — CI-proven end-to-end by PR #107 live suites); full operational document flow **absent** (no receipt document; movement-type vocabulary has no document-flavoured types by design)                                                                     | Inventory movement ledger — **implemented**; valuation boundary — absent                                                                                                                                                        | **OQ-24, OQ-39, OQ-42** (register, rial side); **OQ-54** for the document lifecycle (per OQ-54's own record naming warehouse receipts); ADR-0022 Accepted; ADR-0017 Proposed                                                                                                          | **BLOCKED** (rial/accounting + lifecycle policy). The quantity-side foundation is CI-proven, so a quantity-only slice could become investigable once the OQ-54 sub-decision is prepared — after C-50                                                      |
| **C-52 Warehouse Issue quantity/rial**              | Same shape as C-51 (issue side)                                                                                                                                                                                                                                                                                                | Same as C-51                                                                                                                                                                                                                    | Same as C-51                                                                                                                                                                                                                                                                          | **BLOCKED**                                                                                                                                                                                                                                               |
| **C-53 Inventory stock/settings management**        | Balance core **implemented** (balances, reservations, `Available = Quantity − Reserved`); full stock-management/settings scope absent; per-item/warehouse negative-stock override fields exist as implementation posture                                                                                                       | Movement → balance — **implemented**                                                                                                                                                                                            | **OQ-24** (register: rial stock + whether negative stock is permitted at all); OQ-13 mentions negative stock policy as well                                                                                                                                                           | **BLOCKED**                                                                                                                                                                                                                                               |
| **C-54 Quantity/rial Kardex and inventory reports** | NOT PRESENT as reports (verified: no Kardex/report code; Accounting owns the only read surfaces)                                                                                                                                                                                                                               | Inventory read models (movements/balances exist); reporting pipeline — not present as a module; ADR-0009 Accepted architecture                                                                                                  | **OQ-24** (rial Kardex/valuation), **OQ-49** (blocks only a generic builder — bounded reports are not blocked by it)                                                                                                                                                                  | **BLOCKED** (rial/valuation). A bounded quantity-only movement/Kardex report is structurally possible over existing movements, but the operational flows (C-51/C-52) that give Kardex its business meaning come first                                     |

## 6. C-50 evaluation as the next investigation

**Verified finding: C-50 is the next dependency-ready candidate, as a bounded
investigation only.**

- Every structural dependency is implemented **and** its ADR is Accepted
  (Documents ADR-0023, Workflow ADR-0024, Inventory Core ADR-0022); the
  register already classifies C-50 `READY TO INVESTIGATE`, and this review
  confirms it against code.
- The blocking policy question is **OQ-54** — verified OPEN, with
  cancel-only/visible/audited recorded as a _recommendation_, not a decision.
  Its actual dependencies (from the record itself) are OQ-13 (approval
  coupling), OQ-27 (corrections, only once accounting effects exist), OQ-12
  (numbering gaps), OQ-43 (statutory retention, not inherent to an internal
  request document) and OQ-36 (master-data deletion, adjacent).
- A C-50 investigation must therefore: establish the twelve gate determinations
  (roadmap §5.3 rule), design the Material Request document against the
  Documents Foundation (type, numbering scope, relations), decide whether
  Workflow approvals apply, and **prepare the OQ-54 (and OQ-13/OQ-26/OQ-12)
  decision packs for the material-request scope without selecting options** —
  exactly the pattern C-47's preflight used for OQ-29/OQ-33.
- Implementation of C-50 remains gated until those decisions land; this task
  does not open that investigation, it identifies it as the next
  dependency-ready one.

## 7. Bounded C-47 implementation follow-up — justified?

**Assessment: yes, a bounded C-47 implementation follow-up is justified — but
only after the outstanding Owner decisions are collected**, and only through
the candidate-register promotion rule (it is not authorized by this document).

Already collected (2026-10-02): OQ-29 Option A (requires **no** code change —
current behavior conforms; at most, in-task source comments describing the
behavior as "interim/pending sign-off" would be re-worded by that future task),
PDR-01 barcode policy and OQ-36 Option C eligibility (both create
implementation obligations, below).

Still outstanding before the follow-up is fully specified:

1. **OQ-65** — barcode reuse-after-deactivation and comparison semantics (decides
   the constraint shape: plain vs partial unique index, re-enable handling);
2. **OQ-36** — code-reuse and case-sensitivity policy (decides whether deletion
   releases the item code, and the comparison rule the uniqueness checks use);
3. **OQ-33** — taxonomy/capability confirmation (decides whether any kind/flag
   delta rides along; Option A was explicitly not approved, so the
   confirmation cannot be assumed).

Expected bounded scope of that follow-up (for sizing only, not authorization):
organization-scoped barcode uniqueness over active items' non-null barcodes
with tests; an item delete endpoint + permission implementing the
never-referenced eligibility rule with a reference check spanning
operational/ledger/historical records; any approved taxonomy delta; OpenAPI
and generated-type synchronization; the optional OpenAPI-drift CI check
recommended by the C-47 hardening report (tooling decision). No receipt/issue/
opening/material-request capability belongs in it.

## 8. Verification matrix (fast, documentation-only — as executed)

| Check                                                          | Result                                                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Changed-path audit                                             | PASS — only Markdown/documentation paths; zero changes under `backend/`, `frontend/`, Prisma schema/migrations, generated types, manifests, CI, Compose                              |
| `git diff --check` (whitespace)                                | PASS                                                                                                                                                                                 |
| Relative-link validation on every changed/new Markdown file    | PASS — zero missing targets                                                                                                                                                          |
| Terminology/consistency greps                                  | PASS — no "accepted" claim for C-47/PR #107 anywhere added; OQ-33 Option A nowhere recorded as approved; OQ-36 code-reuse nowhere inferred; Treasury/Purchasing boundaries untouched |
| Heavy suites (E2E / live PostgreSQL / migrations / rehearsals) | **Intentionally not run** — documentation-only task; GitHub CI remains the authoritative gate                                                                                        |

## 9. Non-goals (honored)

No implementation of warehouse receipt, warehouse issue, opening balances,
material request, stock/settings or Kardex/reporting was begun or authorized;
no production code, schema, migration, API, generated type, permission or test
was changed; no OQ was falsely closed; no ADR was promoted; no acceptance was
recorded for C-47, its hardening PR, or this document.

## 10. Conclusion

Four Owner decisions are now recorded in the canonical registries (OQ-29
Option A — partial; OQ-33 Option D — partial, Option A explicitly NOT approved;
PDR-01 barcode policy — decided, enforcement pending; OQ-36 Option C for items
— partial, code reuse open; OQ-65 registered). C-47 remains **NOT ACCEPTED**
and blocked on its remaining open subquestions. Among C-48–C-54, every
candidate except **C-50 (Material Request)** is blocked by open OQs —
principally OQ-11/OQ-24 (openings, valuation, negative stock) and
OQ-24/OQ-39/OQ-42 (rial flows, durable integration, posting mode). **The next
dependency-ready candidate is the C-50 Material Request investigation**,
followed by a bounded C-47 implementation follow-up once OQ-65, OQ-36
code-reuse and the OQ-33 confirmation are collected.

**READY FOR REVIEW — NOT ACCEPTED.**
