# Task 25 — Owner Decision Pack

**Audited `main` commit:** `80944ce112dc16fd834585f8a4c2d83906547480` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

> **This document makes no decision on the Owner's behalf.** Every `Owner decision` field reads
> **PENDING**. Options are presented with their architectural impact; the “recommended framing”
> is a way of *asking* the question, not an answer. No approval is fabricated, implied or
> pre-selected. Nothing in this pack authorizes implementation.

---

## D-01 — ODR-3 list-scope completion (security)

| Field | Content |
|---|---|
| **Topic** | Extending the accepted ODR-3 principal-binding chokepoint to the organization-scoped read surfaces that bypass it |
| **Current State** | 28 `list*` and 9 `get*` service methods accept a caller-supplied `organizationId` and never call `assertOrganizationInScope`. With no `DEPLOYMENT_ORGANIZATION_ID` configured (the default — the variable is in neither `.env.example` nor `docker-compose.yml`), a permission holder in Org A can read Org B's rows on those surfaces. `docs/security.md` §3 claims the opposite |
| **Evidence** | Audit report §11 SEC-01 (full enumeration); drift report DR-01/DR-03; contrast with the compliant `accounts.service.ts::listAccounts` (Task 24 R-2) |
| **Options** | **(a)** One bounded correction task covering all 37 surfaces, reusing the existing chokepoint (Task 24's shipped pattern: one statement per method + regression tests; no schema, no new permission, no new endpoint). **(b)** Phased: Accounting-first (the 5 accounting surfaces), then inventory/organization/workflow/documents. **(c)** Accept the risk under an explicit, documented single-organization + pin-configured deployment posture, and correct `docs/security.md` to match reality. **(d)** Defer |
| **Architectural impact** | None structural — it *restores* the accepted ODR-3 invariant. It **does** change an observable API contract on the affected endpoints (200-with-foreign-rows / empty page → **404**). The accepted frontend consumes `financial-areas`, `fiscal-years`, `accounting-periods` and `organizations` as scope pickers, so the change is user-visible and regression-sensitive. Precedent: Task 24's R-2 made exactly this trade on one endpoint with explicit approval |
| **Recommended decision framing** | “Do I approve a bounded, schema-free security correction that makes 37 organization-scoped read surfaces answer 404 for organizations the principal is not a member of — accepting the contract change — and in one task or phased?” |
| **Owner decision** | **PENDING** |

---

## D-02 — Retract Task 24 finding F-3 (factually wrong security record)

| Field | Content |
|---|---|
| **Topic** | A merged governance record states that no global deployment-pin `APP_GUARD` exists; one does |
| **Current State** | `task-24-scope-design-gate.md` §F-3 and `task-24-implementation-report.md` §0/§8 say “No global pin guard exists”; `organization/organization.module.ts:81` registers `{ provide: APP_GUARD, useClass: DeploymentOrganizationScopeGuard }`, applied globally via `AppModule`. The roadmap (§6.1) and candidate register (C-06) repeat the error |
| **Evidence** | Drift report DR-02; `organization.module.ts:78-81`; `deployment-scope.guard.ts` header; `app.module.ts:27` |
| **Options** | **(a)** Correct all four places in a documentation-only follow-up, recording that the original spec comment was right and that the pre-Task-24 gap bypassed the pin only at the service layer. **(b)** Correct only the roadmap/candidate register and annotate the Task 24 documents as historical. **(c)** Leave as-is until Task 24 is accepted or rejected |
| **Architectural impact** | None. Documentation only. Risk of *not* correcting: a future agent registers a redundant guard, or mis-sizes the ODR-3 remediation |
| **Recommended decision framing** | “Do I approve a documentation-only retraction of F-3, and in which documents?” |
| **Owner decision** | **PENDING** |

---

## D-03 — ADR governance backlog (seven ADRs Proposed while implemented)

| Field | Content |
|---|---|
| **Topic** | ADR-0017, 0018, 0019, 0020, 0021, 0031, 0032 are **Proposed** while their subjects are implemented and merged |
| **Current State** | Each carries “Proposed (needs accept/reject)”; the implementations exist in `main`. Some overlap with Accepted ADRs on the same ground (0017↔0022, 0018↔0024, 0019↔0023, 0020↔0025). ADR-0031 and 0032 are tied to Tasks 12 and 14, both of which are themselves unaccepted |
| **Evidence** | ADR reconciliation matrix §1–§2; `docs/architecture/domain/domain-blueprint.md` §21 names the gate |
| **Options** | **(a)** Run the §21 accept/reject gate as one documentation task covering all seven. **(b)** Accept/reject individually, coupling 0031/0032 to the Task 12/14 acceptance decisions (D-07/D-06). **(c)** Supersede the overlapping Proposed ADRs by the Accepted ones and record the supersession explicitly. **(d)** Leave as recorded backlog |
| **Architectural impact** | None on code. It decides whether the architecture record is authoritative for behaviour that already ships |
| **Recommended decision framing** | “How do I clear an ADR backlog where the code shipped first — one gate, individual gates, or explicit supersession?” |
| **Owner decision** | **PENDING** |

---

## D-04 — Acceptance decision: Bootstrap System Administrator (PR #64)

| Field | Content |
|---|---|
| **Topic** | Merged, CI-green, no acceptance record |
| **Current State** | IMPLEMENTED BUT NOT ACCEPTED. Idempotent post-migration command provisions the real user + ordinary `System Administrator` role through ordinary RBAC rows; invoked by Compose and by CI. No endpoint, no wildcard, no organization bypass. **Forced password change is not implemented**; OQ-19 (self-disable, self-role-removal, last-administrator lockout) remains OPEN |
| **Evidence** | `backend/src/bootstrap/system-administrator-bootstrap.service.ts`; `bootstrap-system-administrator-live.e2e-spec.ts`; CI step in run `36323517204`; `docs/tasks/bootstrap-system-administrator/implementation-report.md`; `docs/security.md` §3 |
| **Options** | **(a)** ACCEPT as-is, recording OQ-19 as still open. **(b)** ACCEPT conditionally on a follow-up for forced first-login password change. **(c)** CHANGES REQUIRED. **(d)** Defer |
| **Architectural impact** | None new — it is already in `main` and in the CI pipeline. The decision only settles the governance record |
| **Recommended decision framing** | “Does the shipped provisioning mechanism satisfy me as an accepted capability while OQ-19's administrator-safety questions stay open?” |
| **Owner decision** | **PENDING** |

---

## D-05 — Acceptance decisions: Task 23, Task 24 R-2, Backend MVP roadmap (PR #69)

| Field | Content |
|---|---|
| **Topic** | Three merged, CI-green work items with no acceptance record |
| **Current State** | **Task 23** (PR #66): Base Chart template + explicit adoption **mechanism**; four invariants verified by this audit; **no content**. **Task 24 R-2** (PR #67): account-list scope correction; verified; its findings F-2/F-3 are respectively under-scoped and wrong (D-01/D-02). **PR #69**: the Backend MVP roadmap, self-declared READY FOR REVIEW |
| **Evidence** | Implementation/acceptance matrix rows 23, 24, roadmap; audit report §10 |
| **Options** | **(a)** Accept all three. **(b)** Accept Task 23 and the roadmap; hold Task 24 until D-01/D-02 are settled, since its own findings are being restated. **(c)** Accept Task 24 (the code is correct and well-tested) and record the F-2/F-3 corrections separately. **(d)** CHANGES REQUIRED on any of them. **(e)** Defer |
| **Architectural impact** | None new. Accepting Task 23 does **not** authorize Base Chart content and closes no OQ; accepting the roadmap authorizes no implementation |
| **Recommended decision framing** | “Which of these three do I accept now, and does Task 24's acceptance wait on the correction of its own F-2/F-3 findings?” |
| **Owner decision** | **PENDING** |

---

## D-06 — Governance status of Tasks 13, 14 and 15

| Field | Content |
|---|---|
| **Topic** | Three merged Accounting capabilities with unresolved or absent governance records |
| **Current State** | **Task 13** (PR #31, merged): recorded “IN PROGRESS (self-review)” — a label outside the permitted vocabulary; its rehearsal is not a CI step (D-08). **Task 14** (PR #32, merged): READY FOR REVIEW — NOT ACCEPTED; ADR-0032 Proposed. **Task 15** (PR #33, merged): **no brief, no review, no report, no acceptance record at all** — only a `STATE.md` §7 row |
| **Evidence** | `STATE.md` §7 rows 13–15; `docs/accounting/task-index.md` header; `docs/task-13-implementation-report.md`; `docs/task-14-implementation-report.md`; for Task 15 only migration `20260923000000_*` and `domain/document-reversal.ts` |
| **Options** | **(a)** Adjudicate each with a valid outcome (ACCEPTED / CHANGES REQUIRED), reconstructing a Task 15 record from repository evidence. **(b)** Record all three as “historical — merged, acceptance not pursued” and move on. **(c)** Adjudicate 13/14 and leave 15 as historical. **(d)** Defer |
| **Architectural impact** | None on code. Task 15's reversal capability is load-bearing for OQ-27 and for any future correction policy, so an absent record is a real traceability gap |
| **Recommended decision framing** | “Do I adjudicate these three retroactively, or explicitly close them as historical merged work?” |
| **Owner decision** | **PENDING** |

---

## D-07 — Task 12: invalid review label and the open P1 concurrency item

| Field | Content |
|---|---|
| **Topic** | BOOT-OQ-02 — Task 12's recorded outcome is “ACCEPTED WITH FOLLOW-UP”, which `STATE.md` §6 explicitly forbids as a review outcome |
| **Current State** | The Accounting task index quotes the legacy label; the Task 12 reports retain READY FOR REVIEW / CHANGES REQUIRED; ADR-0031 is Proposed; the **P1 real-PostgreSQL independent-connection concurrency verification remains open** (PGlite is not equivalent) |
| **Evidence** | `docs/accounting/task-index.md` §6/§8; `docs/task-12-{implementation,remediation}-report.md`; `docs/task-12-final-review-fa.md`; `STATE.md` §6/§7 and BOOT-R-02/BOOT-R-04 |
| **Options** | **(a)** Record ACCEPTED plus a separately tracked non-blocking follow-up (permitted only *after* a valid ACCEPTED decision). **(b)** Record CHANGES REQUIRED until P1 is verified on real PostgreSQL. **(c)** Leave the historical label quoted and mark the outcome permanently UNKNOWN. In all cases the historical text is preserved, never rewritten |
| **Architectural impact** | The balance projection is a derived, rebuildable read optimization (Task 18 D5); it is not a second monetary truth. The open item is concurrency confidence, not correctness of the ledger |
| **Recommended decision framing** | “Which valid outcome does Task 12 receive, and is the P1 concurrency verification a blocker or a tracked follow-up?” |
| **Owner decision** | **PENDING** |

---

## D-08 — Should the Task 13 operational-freeze rehearsal run in CI?

| Field | Content |
|---|---|
| **Topic** | Test/CI coverage for a merged, unaccepted capability |
| **Current State** | `npm run test:operational-freeze-rehearsal` exists (`backend/prisma/rehearsal/task-13-operational-freeze`) and is **not** a CI step; only the Task 11 migration rehearsal runs in CI |
| **Evidence** | `.github/workflows/ci.yml`; `backend/package.json`; drift report DR-08 |
| **Options** | **(a)** Add it as a CI step (cost: additional minutes on every PR against a 20-minute job budget). **(b)** Run it on demand before any change touching configuration freeze. **(c)** Leave as-is and record the gap |
| **Architectural impact** | None. CI configuration only |
| **Recommended decision framing** | “Is the operational-freeze invariant worth permanent CI minutes, or is on-demand execution enough?” |
| **Owner decision** | **PENDING** |

---

## D-09 — Accounting domain-contract header (BOOT-R-10)

| Field | Content |
|---|---|
| **Topic** | `docs/accounting/domain-contract.md` still presents itself as Proposed / not implemented and labels ADR-0026 Proposed |
| **Current State** | ADR-0026 is **Accepted** (2026-09-14) and the contract's foundation/document/posting/read layers are implemented, several of them under accepted tasks |
| **Evidence** | Drift report DR-07; `docs/adr/0026-accounting-bounded-context.md`; `README.md` line 87 |
| **Options** | **(a)** Correct the header in a bounded documentation task, stating precisely which contract sections are implemented and which remain candidates. **(b)** Add a dated “current state” note without touching the historical header. **(c)** Leave as-is |
| **Architectural impact** | None. The contract's binding clauses are unchanged either way; this is a status-presentation question, and no silent status promotion is acceptable |
| **Recommended decision framing** | “How do I want the contract header to express ‘binding contract, partially implemented’ without promoting anything?” |
| **Owner decision** | **PENDING** |

---

## D-10 — `docs/security.md` §3 wording pending the SEC-01 fix

| Field | Content |
|---|---|
| **Topic** | The security document asserts universal chokepoint coverage that does not exist yet |
| **Current State** | §3: “every organization-scoped read and write passes through `assertOrganizationInScope`”. 37 surfaces do not |
| **Evidence** | Drift report DR-01; audit report §11 SEC-01 |
| **Options** | **(a)** Correct the wording now to state the actual coverage plus the known gap, then restore the absolute statement when D-01 lands. **(b)** Leave the wording and rely on D-01 landing quickly. **(c)** Correct the wording *and* state the pin-dependent mitigation explicitly (the global `APP_GUARD` closes the class only when `DEPLOYMENT_ORGANIZATION_ID` is configured) |
| **Architectural impact** | Documentation only — but it is the document a future agent trusts when deciding whether a new organization-scoped endpoint needs its own scope call |
| **Recommended decision framing** | “Do I want the security document to describe the target invariant or the current reality while the gap is open?” |
| **Owner decision** | **PENDING** |

---

## Decisions explicitly NOT requested here

The following remain governed by their existing records and are **not** reopened by Task 25:
Modular Monolith / Vertical Slice architecture, the organization isolation *model*, ODR-3 itself,
the Documents ownership model, Workflow Foundation decisions, Inventory Movement → Balance,
ledger immutability, leaf-only posting, the Base Chart template/adoption model, read-time
aggregation, all Task 20 decisions (OD-20-1…OD-20-6), all Task 21 governance, the MVP scope
boundary (including Treasury and Purchasing as POST-MVP), and every OQ answer.

## Summary

| Decision | Class | Blocks the recommended next gate? |
|---|---|---|
| D-01 ODR-3 list-scope completion | F6 / F5 | **YES — it *is* the next gate** |
| D-02 Retract F-3 | F1 | No (but should accompany D-01) |
| D-03 ADR backlog (7 ADRs) | F3 | No |
| D-04 Bootstrap SysAdmin acceptance | F2 | No |
| D-05 Task 23 / Task 24 / roadmap acceptance | F2 | Partially — a clean baseline is preferable before the next task |
| D-06 Tasks 13/14/15 status | F2 | No |
| D-07 Task 12 outcome + P1 | F2 / F7 | No |
| D-08 Freeze rehearsal in CI | F7 | No |
| D-09 Contract header | F1 | No |
| D-10 `security.md` wording | F1 | No (but it is the honest interim state) |

**Total Owner decisions required: 10. All PENDING.**
