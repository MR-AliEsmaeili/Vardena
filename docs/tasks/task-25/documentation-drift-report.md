# Task 25 — Documentation Drift Report

**Audited `main` commit:** `80944ce112dc16fd834585f8a4c2d83906547480` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

> Severity vocabulary (task spec §7): **CRITICAL** (documentation says a security control is
> enforced but code does not enforce it) · **HIGH** (a task documented as Accepted with no
> acceptance record; a factually wrong security-relevant record) · **MEDIUM** (an inventory omits
> an implemented module / stale structural claim) · **LOW** (stale comment or wording, no
> behavioural impact) · **INFORMATIONAL**.
>
> **Only DR-06 and DR-05 are corrected by Task 25.** Everything else is recorded for an
> Owner-approved follow-up; Task 25 may not edit accepted governance records or production
> behaviour.

---

## DR-01 — CRITICAL

| Field | Content |
|---|---|
| **Document** | `docs/security.md` §3 (“Organization membership boundary (ODR-3, Task 19)”) |
| **Claim** | “every organization-scoped read and write passes through `OrganizationsService.assertOrganizationInScope` (deployment pin → principal → membership), so a caller without a membership row gets **404**” |
| **Actual repository state** | **28 `list*` methods and 9 `get*` methods never reach that chokepoint.** They accept a caller-supplied `organizationId` and either filter by it (lists) or compare `row.organizationId !== organizationId` (details) with no membership assertion. Full enumeration: audit report §11 SEC-01 |
| **Evidence** | `accounting/application/{accounting-configurations,accounting-periods,coding-structures,financial-areas,fiscal-years}.service.ts`; `documents/application/{document-relations,numbering,numbering-series}.service.ts`; `inventory/application/{inventory-balances,inventory-movements,inventory-reservations,item-groups,items,unit-conversions,units,warehouses}.service.ts`; `organization/application/{branches,departments,employees,parties}.service.ts`; `workflow/application/workflow-*.service.ts`. Contrast with the compliant `accounts.service.ts::listAccounts`, `accounting-balances.service.ts::listBalances`, `chart-tree.service.ts::list`, `ledger-movements.service.ts::listMovements`, `general-ledger`/`trial-balance` (via `resolveAccountingReportScope`), `document-types`, `numbering-series::listNumberingSeries`, `base-chart-adoptions` |
| **Severity** | **CRITICAL** — documentation asserts an enforced security control that the code does not enforce on those surfaces |
| **Required correction** | Two separate acts, both Owner-gated: (a) **F6/F5** — an Owner-approved implementation task extending the accepted ODR-3 chokepoint to those surfaces (contract change 200/empty-page → 404, exactly like Task 24 R-2); (b) **F1** — until (a) lands, `docs/security.md` §3 must state the actual coverage instead of “every”. **Task 25 performs neither**: (a) is production capability (prohibited) and (b) edits an accepted security record, which is Owner decision **D-10** |

---

## DR-02 — HIGH

| Field | Content |
|---|---|
| **Document** | `docs/tasks/task-24/task-24-scope-design-gate.md` §F-3 and `docs/tasks/task-24/task-24-implementation-report.md` §0 row 3 / §8 |
| **Claim** | “**No global pin guard exists** (`app.module.ts` registers no `APP_GUARD`)” … “the spec comment that claims one is wrong” … “the absent global pin `APP_GUARD`” |
| **Actual repository state** | A global pin guard **is** registered: `backend/src/modules/organization/organization.module.ts:81` → `{ provide: APP_GUARD, useClass: DeploymentOrganizationScopeGuard }`. `OrganizationModule` is imported by `AppModule` (`backend/src/app.module.ts:27`), and a Nest `APP_GUARD` provider declared in any imported module applies application-wide. The guard checks the pin against `organizationId` in the body, the query string and the decorator-marked path param, answering 404 on mismatch |
| **Evidence** | `backend/src/modules/organization/organization.module.ts:78-81`; `backend/src/modules/organization/application/deployment-scope.guard.ts` (its own header states “Registered globally (`APP_GUARD`) by OrganizationModule”); `backend/src/app.module.ts` |
| **Severity** | **HIGH** — a security-relevant governance record states the opposite of the code, and it is quoted downstream (`docs/roadmap/backend-mvp-roadmap.md` §6.1 “plus the F-3 stale spec comment”; `docs/roadmap/future-task-candidates.md` C-06). A future agent could “fix” a non-problem by registering a second guard, or could wrongly conclude the deployment pin is unenforced on the HTTP surface |
| **Required correction** | **F1** — retract F-3 in both Task 24 documents and in the two roadmap references, recording that the original spec comment was correct. Consequential nuance to record with it: the pre-Task-24 `listAccounts` gap bypassed the pin only at the *service* layer; on the HTTP surface with a pin configured the guard already refused a foreign `organizationId`. Task 24's R-2 fix and its tests remain valid and are unaffected. **Owner decision D-02** (it edits a merged governance record of a not-yet-accepted task) |

---

## DR-03 — HIGH

| Field | Content |
|---|---|
| **Document** | `docs/tasks/task-24/task-24-scope-design-gate.md` (finding **F-2** / proposal **R-5**), `docs/roadmap/backend-mvp-roadmap.md` §6 + §6.1, `docs/roadmap/future-task-candidates.md` C-06 |
| **Claim** | The remaining ODR-3 list-scope gap consists of **four** surfaces: `financial-areas`, `fiscal-years`, `accounting-periods`, `coding-structures` |
| **Actual repository state** | The same class exists on **37** surfaces across five modules (28 list + 9 detail) — the four named ones plus `accounting-configurations.listConfigurations`, all eight inventory list surfaces, all four organization master-data list surfaces, two documents list surfaces, nine workflow list surfaces, and nine detail surfaces in documents/workflow |
| **Evidence** | See DR-01 evidence; enumerated in audit report §11 SEC-01 |
| **Severity** | **HIGH** — the recorded remediation scope is ~11% of the real one, so a task sized from it would leave the majority of the exposure in place |
| **Required correction** | **F1** now (restate F-2/R-5/C-06 with the full surface list), then **F5/F6** (size the remediation task against 37 surfaces). **Owner decision D-01** |

---

## DR-04 — MEDIUM

| Field | Content |
|---|---|
| **Document** | `docs/tasks/task-24/task-24-scope-design-gate.md` §1 bucket **C** (“Governance-state drift”) |
| **Claim** | “Task 23 is merged in `main` but has **no row in `STATE.md` §7 and no row in `docs/accounting/task-index.md` §2**, and no Task 23 acceptance record exists. Task 24 itself is not admitted to the task index at all.” |
| **Actual repository state** | PR **#68** (*docs: synchronize governance state after Task 24*, merged `c654be9`) added both: `docs/accounting/task-index.md` §2 now carries row **23** and row **24** with PR/merge/CI evidence, and `STATE.md` §7 carries Task 23 and Task 24 rows. The *acceptance-record* half of the claim is still true — **no acceptance record exists for either** |
| **Evidence** | `docs/accounting/task-index.md` §2 rows 23 and 24 (lines 60–61) and its header; `STATE.md` §7 Task 23 / Task 24 rows |
| **Severity** | **MEDIUM** — a structural claim about the governance record that is now stale; the security-relevant half of the bucket is unchanged |
| **Required correction** | **F1** — annotate the gate document that the index/STATE rows were supplied by PR #68, while the missing acceptance records remain open (D-04/D-05). Task 25 does not edit the merged gate document |

---

## DR-05 — MEDIUM (corrected by Task 25)

| Field | Content |
|---|---|
| **Document** | `STATE.md` §8 (“Current Task”) |
| **Claim** | “There is **no active implementation task selected** … **No Task 25 is defined or selected here.**” and “`main` … is **READY FOR NEXT MAIN-BASED AUDIT**” |
| **Actual repository state** | Task 25 — Main-Based Governance Closure exists, is executing against `main` @ `80944ce`, and has produced `docs/tasks/task-25/*` |
| **Evidence** | this directory; `STATE.md` §8 as written before this task |
| **Severity** | **MEDIUM** |
| **Required correction** | **F1 — DONE.** `STATE.md` §8 now records Task 25 as **READY FOR REVIEW — NOT ACCEPTED**, preserving the prior text as history. No prior status was rewritten |

---

## DR-06 — LOW (corrected by Task 25)

| Field | Content |
|---|---|
| **Document** | `backend/src/modules/organization/domain/organization-permissions.ts` — the `MEMBERSHIP` doc comment |
| **Claim** | “Granting deliberately does **NOT** require the GRANTOR to already be a member of the target organization … The permission is the authority, exactly as `Rbac.UserRole.Assign` is …” |
| **Actual repository state** | PR **#55** (merged `6a69bc6`, part of the ACCEPTED Task 19) made membership administration organization-bound: `listMembers` / `grantMembership` / `revokeMembership` all call `authorizeMembershipAdministration`, which runs the deployment pin and the acting principal's own membership assertion. The only exception is granting the FIRST member of an organization with an empty membership set |
| **Evidence** | `organization/application/organization-memberships.service.ts` (class doc + all three methods); `docs/security.md` §3 table; `STATE.md` §8 PR #55 paragraph; `organization-memberships.service.spec.ts` (17 tests) |
| **Severity** | **LOW** — no behavioural impact; the comment is the last artifact asserting the superseded rule |
| **Required correction** | **F1 — DONE (Workstream F).** The comment now describes the shipped rule plus the single bootstrap exception. **Comment-only**: no import, permission, code string, export or formatting change; `git diff --check` clean |

---

## DR-07 — LOW (pre-existing, recorded as BOOT-R-10)

| Field | Content |
|---|---|
| **Document** | `docs/accounting/domain-contract.md` (header) |
| **Claim** | Header still presents the contract as Proposed / not implemented and labels ADR-0026 Proposed |
| **Actual repository state** | ADR-0026 is **Accepted** (2026-09-14) and the contract's foundation, document, posting/ledger and read layers are implemented and partly accepted (Tasks 10.x, 11, 17A/17B/18) |
| **Evidence** | `docs/adr/0026-accounting-bounded-context.md` (Status: Accepted); `README.md` line 87 already describes the layers as implemented |
| **Severity** | **LOW** — ambiguous to new readers; no behavioural impact |
| **Required correction** | **F1** — clarify the header in a separate documentation task; no silent status promotion. **Owner decision D-09** |

---

## DR-08 — INFORMATIONAL

| Field | Content |
|---|---|
| **Document** | `.github/workflows/ci.yml` vs `STATE.md` §2 (“Testing and CI inventory”) |
| **Claim** | “The operational-freeze script is available but is not a configured CI step” (`STATE.md` already says this — so this is a *gap*, not a contradiction) |
| **Actual repository state** | Confirmed: `npm run test:operational-freeze-rehearsal` exists (`backend/prisma/rehearsal/task-13-operational-freeze`) and is **not** a CI step; only the Task 11 migration rehearsal runs in CI |
| **Evidence** | `.github/workflows/ci.yml` step list; `backend/package.json` scripts |
| **Severity** | **INFORMATIONAL** (documentation is accurate; the coverage gap is real) |
| **Required correction** | **F7** — Owner decides whether the Task 13 rehearsal becomes a CI step (**D-08**). Relevant because Task 13 itself is merged-but-not-accepted |

---

## DR-09 — INFORMATIONAL

| Field | Content |
|---|---|
| **Document** | `STATE.md` §2, §9 (BOOT-OQ-04) |
| **Claim** | “Required branch-protection checks: **UNKNOWN — REQUIRES OWNER CONFIRMATION**” |
| **Actual repository state** | Still UNKNOWN. A workflow job existing is not proof that branch protection requires it; this audit has no read access to protection settings and did not guess |
| **Evidence** | `.github/workflows/ci.yml`; BOOT-OQ-04 |
| **Severity** | **INFORMATIONAL** (documentation is accurate about its own uncertainty) |
| **Required correction** | **F2** — Owner records the actual required checks |

---

## DR-10 — INFORMATIONAL

| Field | Content |
|---|---|
| **Document** | this audit and `STATE.md` §2 |
| **Claim** | Historical commit ancestry and historical CI outcomes |
| **Actual repository state** | The local checkout is **shallow** (`.git/shallow` present, 1 reachable commit). Historical SHAs, PR numbers and CI run ids are transcribed from GitHub metadata (`gh pr list`, `gh run list`) and existing records, not re-derived from local history |
| **Evidence** | `git rev-list --count HEAD` = 1; `gh pr list --state all` output (PRs #30–#69) |
| **Severity** | **INFORMATIONAL** |
| **Required correction** | none — recorded as a limit of this audit |

---

## Summary

| Severity | Count | Corrected by Task 25 | Left as Owner-gated follow-up |
|---|---|---|---|
| CRITICAL | 1 | 0 | DR-01 |
| HIGH | 2 | 0 | DR-02, DR-03 |
| MEDIUM | 2 | 1 (DR-05) | DR-04 |
| LOW | 2 | 1 (DR-06) | DR-07 |
| INFORMATIONAL | 3 | 0 | DR-08, DR-09, DR-10 |
| **Total** | **10** | **2** | **8** |

**Deliberately not corrected here, and why:** DR-01/DR-03 require production change (prohibited by
the task); DR-02/DR-04 edit merged governance records belonging to a not-yet-accepted task
(Owner's call); DR-07 edits an Accounting contract header (its own separate documentation gate);
DR-08/DR-09 require an Owner/infrastructure decision; DR-10 is a stated limit. Each is carried in
the [Owner Decision Pack](./owner-decision-pack.md).
