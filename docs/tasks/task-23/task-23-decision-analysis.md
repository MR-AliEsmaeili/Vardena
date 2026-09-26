# Task 23 — D-R-1 … D-R-7 Decision Analysis (Decision Analysis Gate)

- **Document type:** decision analysis / options brief — **READ-ONLY ANALYSIS, DOCUMENTATION ONLY**
- **Date:** 2026-09-27
- **Produced under:** the Repository Owner's *Task 23 Decision Analysis Gate* commission (analysis-only mode)
- **Recorded on:** branch `arena/01a0df43-vardena` (PR **#63**), by explicit Owner instruction; the analysis run itself modified nothing
- **Baseline inspected (original run):** `main` @ `b0d9337` (merge of PR #62) + the two Task 23 documents at `a5f35dd`
- **Re-baselined:** 2026-09-27 against `main` @ `1723d05` (*“docs: record Task 21 owner acceptance”*) — **documentation-consistency correction only**: the Task 21 status statements below were refreshed to the current authoritative state. No option, consequence, dependency, slice or decision class was redesigned; see the *Re-baseline note* immediately below the classification legend.
- **Companions:** [`task-23-draft-brief.md`](./task-23-draft-brief.md) · [`task-23-pre-implementation-report.md`](./task-23-pre-implementation-report.md)
- **Canonical predecessors:** `docs/accounting/owner-decision-baseline.md` §11 (ODR-1…ODR-3) / §12 (OD-20-1…OD-20-6); `docs/tasks/task-21/task-21-governance-baseline.md`; `docs/accounting/domain-contract.md`; ADR-0021/0025/0026/0028/0031/0033/0034/0035/0036/0037; `docs/open-questions.md`; `.vardena/architecture-rules.md`; `docs/security.md`

> **This document decides nothing.** It generates options and consequences for the
> seven unresolved decision requests raised by the Task 23 pre-implementation
> report. It contains **no recommendation, no ranking and no score**; every choice
> remains a Repository Owner act. It admits no task, accepts no task, promotes no
> ADR, closes no Open Question, invents no accounting content and changes no
> production code, schema, migration, permission, registry or frontend.

```text
Status:                 ANALYSIS ONLY — NO DECISION TAKEN
Production changes:     NONE
Schema/migration:       NONE
Registry changes:       NONE (task-index.md, STATE.md, open-questions.md,
                              owner-decision-baseline.md, all ADRs untouched)
ADR promotion:          NONE
OQ closure:             NONE (OQ-25 / OQ-36 / OQ-41 / OQ-43 / OQ-19 / OQ-21 / OQ-06 remain OPEN)
Task acceptance:        NOT PERFORMED
Task admission:         NOT PERFORMED
Implementation:         NOT PERFORMED
```

## Classification legend

Every substantive statement in this document carries exactly one class:

| Tag | Meaning here |
|---|---|
| **ACCEPTED DECISION** | Already decided and recorded (ODR-*, OD-20-*, an Accepted ADR). |
| **OWNER DECISION** | A choice only the Repository Owner may make. |
| **ARCHITECTURAL DECISION** | An architecture choice, ADR-gated under AR-29. |
| **ACCOUNTING DOMAIN DECISION** | A domain choice requiring accountant/domain approval. |
| **SECURITY DECISION** | A choice with an authorization/tenancy consequence. |
| **IMPLEMENTATION CONSTRAINT** | A binding consequence already implied by an accepted decision. |
| **OPEN QUESTION** | Genuinely undecided; stays with a named OQ. |
| **INTERIM ASSUMPTION** | A fail-closed placeholder; explicitly not a rule. |
| **DEFERRED** | Deliberately out of scope. |
| **AGENT OBSERVATION** | A technical finding by this analysis — **never** an accepted decision. |

## Re-baseline note — Task 21 status (2026-09-27)

**Task 21 is ACCEPTED.** **[ACCEPTED DECISION]** The authoritative record on `main` @ `1723d05` is
`docs/tasks/task-21/task-21-acceptance-record.md` (added by `1723d05`; it is on `main` but not in this PR branch's tree, which branched from `b0d9337` — read via `git show origin/main:docs/tasks/task-21/task-21-acceptance-record.md`):
*Decision: **ACCEPTED**, Date: 2026-09-26, Decision authority: Repository Owner, Review basis: final repository review **PASS**, Scope: governance/design documentation only.*
Corroborating current state: `STATE.md` §7 row 21 and §8 (**ACCEPTED (2026-09-26)**, current accepted work item), the `docs/accounting/task-index.md` status header (**Task 21: ACCEPTED (2026-09-26)**), the OQ-25 row of `docs/open-questions.md` (*“Task 21 note (2026-09-26) — **ACCEPTED GOVERNANCE BASELINE**; OQ-25 remains OPEN and substantially narrowed”*) and the `task-21-governance-baseline.md` header (**Task status: ACCEPTED (2026-09-26)**).

**What that acceptance does and does not do** (quoted/derived from the acceptance record — no reinterpretation):

| Point | State |
|---|---|
| Task 21 accepted by the Repository Owner | **Yes** — governance/documentation acceptance |
| Task 21 baseline decisions (content model boundary, template → adoption → organization Account → ledger identity, copy-not-reference, immutable published versions, no silent mutation, bounded partial adoption, mandatory-account semantics, consumer-first control roles, per-level `is_postable` bounded by leaf-only, customization classification, version lifecycle, OQ-36 boundary) | **Ratified as governance** — and they remain the boundary for Task 23 |
| Task 23 implementation authorized | **No** — *“No production implementation, schema, migration, API, DTO, permission, seed, frontend or test change is authorized by this acceptance alone.”* |
| **OQ-25** | **OPEN** (substantially narrowed) |
| **OQ-36 / OQ-41 / OQ-43** | **OPEN** |
| Base Chart content **values** | **NOT approved** by the acceptance |
| Account codes, Persian titles, natures, mandatory-account list, concrete control-role catalog | **Expert/Owner-gated**; no explicit later approving decision exists in the repository |
| Task 19 / Task 20 | remain **ACCEPTED and unchanged** |
| ADR-0033…0037 | remain **Proposed**; no ADR promoted |

**Residual documentation drift observed on `main` (reported, not corrected here — registry edits are not authorized by this correction):** while the acceptance record, `STATE.md`, the `task-index.md` header and the OQ-25 note all read ACCEPTED, four locations still carry pre-acceptance wording — `docs/accounting/task-index.md` §2 row 21, its §5 candidate-table row and its §9 history row, and `task-21-governance-baseline.md` §17 (“Final status: READY FOR REVIEW — NOT ACCEPTED”). **[AGENT OBSERVATION]** This analysis treats the acceptance record + `STATE.md` + the index header + the OQ-25 note as authoritative and flags the four stale locations for an Owner-side documentation sync.

---

## 0. Evidence baseline collected by this analysis

| Area | Verified fact | Path |
|---|---|---|
| Tenancy | All **13** accounting models carry `organization_id` NOT NULL, FK `RESTRICT`, scope-leading indexes | `backend/prisma/schema/accounting.prisma` |
| Global tables that exist | `rbac.{permissions,roles,role_permissions,user_roles}`, `users.users`, `identity.sessions` — **all in platform schemas; no business/domain schema holds a non-tenant table** | `backend/prisma/schema/{rbac,users,identity}.prisma` |
| ADR-0021 | **Status: Proposed.** Every master-data table org-scoped; only `organizations.code` is deployment-wide unique; cross-org reference → `404`; cross-schema FKs allowed | `docs/adr/0021-organization-scoped-master-data.md` |
| ADR-0025 | **Accepted.** Optional `DEPLOYMENT_ORGANIZATION_ID`; the global guard inspects **only** requests that *name* an organization; “routes that carry no organization id (login, health, users, RBAC…) pass through”; the pin is per process; one database shared by independently pinned deployments is **not supported** | `docs/adr/0025-single-organization-deployment-pin.md`, `backend/src/modules/organization/application/deployment-scope.guard.ts` |
| Authorization | `requireAllPermissions` is **organization-agnostic** (roles/permissions are deployment-global) and **returns early in system context** (no HTTP request in flight) | `backend/src/modules/rbac/application/authorization.service.ts:77-102` |
| ODR-3 chokepoint | `assertOrganizationInScope` = deployment pin → principal membership → `404`; **system context = trusted caller, “not reachable from HTTP”** | `backend/src/modules/organization/application/organizations.service.ts:297-345` |
| Permission doctrine | `Module.Entity.Action`; registry in code; *“a permission that no code checks cannot exist”*; a guarded route declaring nothing **fails closed (500)**; no wildcard/superuser (OQ-21) | `docs/security.md` §3, `backend/src/modules/accounting/domain/accounting-permissions.ts` |
| Bootstrap | **OQ-19 OPEN** — *“the first administrator is created out-of-band by the operator (seed/script in the system context) — no built-in bootstrap endpoint”* | `docs/open-questions.md` |
| Password policy | **OQ-06 OPEN** — the DTO enforces `MinLength(1)` only and deliberately no policy | `backend/src/modules/users/api/dto/user-request.dto.ts` |
| Account invariants | `uq(organization_id, code)`; `parent_id` RESTRICT; `ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS = [parentId, level, accountNature, isPostable]`; **`code` immutable from creation** (stricter than OD-20-4 — discrepancy D-2); `postable ⇒ leaf` enforced on both write paths | `backend/src/modules/accounting/domain/account.ts`, `data/accounts.repository.ts` |
| Lifecycle | No delete path exists: no `Accounting.Account.Delete` permission, no DELETE endpoint; `is_active` is the whole lifecycle (AC-D-08 freeze-never-delete) | `domain/accounting-permissions.ts`, contract §8.6 |
| Configuration | `AccountingConfiguration{status DRAFT/ACTIVE/SUPERSEDED, operationally_used_at}`; `CodingStructureVersion{draft/active/superseded, max_depth}` + levels `{digit_length, default_is_postable}` | `accounting.prisma`, ADR-0028 D1–D7 |
| Caps | `MAX_CODING_STRUCTURE_DEPTH = 8`, `MAX_ACCOUNT_CODE_LENGTH = 32`, `MAX_TREE_EDGES = 10_000` | `domain/coding-structure.ts`, `data/accounts.repository.ts:93` |
| Migrations | 16 applied, `20260910000000_init` → `20260926000000_organization_membership`; a populated-data **migration rehearsal** harness exists | `backend/prisma/migrations/`, `backend/prisma/rehearsal/` |
| CI | one `backend` job: prisma validate/generate, lint, typecheck, format, unit, build, `migrate deploy`, migration rehearsal, E2E incl. live `postgres:16` | `.github/workflows/ci.yml:41-143` |

---

## D-R-1 — Product-global Base Chart Template storage

### Current repository state
Every accounting table is tenant-scoped; the only non-tenant tables in the system live in platform schemas (`rbac`, `users`, `identity`). `organization.organizations` is the tenant root. ADR-0021 (Proposed) states the org-scoping rule; ADR-0025 (Accepted) adds an optional deployment pin that is a no-op for requests naming no organization. **[ACCEPTED DECISION / AGENT OBSERVATION]**

### Problem
OD-20-1 defines the Base Chart as an **Accounting-owned versioned product/database asset**, explicitly not organization data, whose versions *“may exist independently from charts already adopted by organizations.”* No structural home for such an asset exists inside a domain schema. **[OPEN QUESTION]**

### Why existing decisions do not fully answer it
- OD-20-1 fixes *ownership* and *identity separation*, not *storage boundary*. **[ACCEPTED DECISION]**
- ADR-0021 asserts org-scoping for *master data*; a product template is not master data, and the ADR is silent (and still Proposed). **[AGENT OBSERVATION]**
- AR-29 requires an ADR for a new cross-module/schema pattern. **[IMPLEMENTATION CONSTRAINT]**

### Repository evidence
`backend/prisma/schema/accounting.prisma` (tenancy header + all models); `backend/prisma/schema/base.prisma` (`schemas = [identity, users, rbac, organization, inventory, documents, workflow, accounting]`); `docs/adr/0021-…`, `docs/adr/0025-…`; `docs/adr/0037-…` §2–§4; `.vardena/architecture-rules.md` AR-29.

### Options

**Option A — Non-tenant tables inside the existing `accounting` schema**
- *Architecture:* smallest structural delta; ownership stays with Accounting (ADR-0026). Introduces the first non-tenant tables in a domain schema.
- *Domain:* matches OD-20-1 “Accounting-owned … database asset” literally.
- *Security:* no `organization_id` ⇒ **no row-level tenant boundary**; isolation rests entirely on the API surface (read-only for org users; writes gated by D-R-2). Risk class is *authority*, not *data* — template rows contain no tenant data.
- *Data model:* 4 tables (template, version, level, node); the adoption record stays tenant-scoped.
- *API:* organization-unscoped routes inside an otherwise fully org-scoped module — a reviewer-visible asymmetry; ADR-0025's guard passes them through untouched.
- *Migration:* one additive migration; no existing table changed.
- *Operational:* template data lives inside the tenant database → backup/restore couples product content to customer data; two deployments can drift.
- *Extensibility:* shipping v2 to customers becomes a per-deployment data migration.
- *Task 19–21 compatibility:* preserves ODR-1/2/3; OD-20-1 identity separation intact.
- *Enables:* DB-managed lifecycle, runtime authorship.
- *Prevents:* nothing structurally.
- *New decisions required:* ADR for non-tenant tables in a domain schema (AR-29); D-R-2 authority model.

**Option B — Dedicated product/catalog schema (new `@@schema`) or separate module boundary**
- *Architecture:* the non-tenant nature becomes explicit in the physical model; touches `base.prisma`'s `schemas` list (schema-per-module change → AR-29 ADR).
- *Domain:* keeps “product asset ≠ tenant data” visible; consistent with ADR-0026 bounded-context labelling.
- *Security:* same authority questions as A, but the boundary is greppable and auditable; cross-module reads must respect AR-07, so either Accounting owns the schema or it is consumed through a module API.
- *Data model:* same tables in another schema; the adoption record keeps a **cross-schema FK** (precedent: `inventory.* → organization.organizations`, `identity.sessions → users.users`).
- *API / Migration / Operational:* as A, plus a new schema in every migration/deploy path and in the rehearsal harness.
- *Extensibility:* cleanest future path to template distribution (dump/load one schema) and to a wider product catalog.
- *Compatibility:* preserves ODR-1/2/3, OD-20-1.
- *Enables:* separate backup/restore, separate grants, later extraction.
- *Prevents:* treating template data as tenant data.
- *New decisions required:* ADR (new schema + ownership); owning module (AR-07); D-R-2.

**Option C — Organization-scoped template storage**
- *Viability finding:* **conflicts with OD-20-1 / ADR-0037 §2 as written.** OD-20-1 says the template is Vardena-owned and that versions exist independently of adopted charts; per-organization storage makes the template tenant data that an organization could in principle author, collapsing “template” into “organization configuration”. **[AGENT OBSERVATION — not a decision]**
- *Narrower reading* (**C-replica**): rows are org-scoped **replicas** provisioned only by system context and never writable by org principals. Preserves OD-20-1's ownership in behaviour but not in structure, and duplicates the same content N times.
- *Security:* strongest tenant story — every row scoped, ADR-0025's guard applies unchanged, no new authority class needed.
- *Data:* N× duplication; silent version drift between organizations; “which orgs run v1?” becomes a scan.
- *Compatibility:* C (org-authorable) contradicts OD-20-1; C-replica does not, but requires accepting that the product asset has no single physical home.
- *New decisions required:* explicit Owner ruling on OD-20-1 compatibility; provisioning path (still D-R-2).

**Option D — Code-defined template versions mirrored into tables (registry pattern)**
- *Description:* versions declared as **code artifacts** (ADR-0023 §2 / permission-registry / document-type-registry pattern) and mirrored into tables at startup or by migration — exactly as `docs/security.md` §3 describes permissions: *“each module registers its permissions in code … a startup/migration sync mirrors the registry into `rbac.permissions`.”*
- *Architecture:* no runtime authoring surface; publishing a version = a reviewed code change + deploy (PR review becomes the approval gate).
- *Domain:* satisfies “versioned Accounting-owned asset”; the mirrored tables satisfy “database asset”, **but the Owner must confirm that a code-authored source is what OD-20-1 intended** — the option's only governance ambiguity.
- *Security:* **removes D-R-2's write-surface problem entirely** — no product-authority permission, no organization-unscoped write route, nothing to escalate to.
- *Data model:* mirrored tenant-free tables (or none, if adoption reads the registry directly); the adoption record stores a version identifier.
- *Migration:* the mirror sync must be idempotent and must never mutate a published version already adopted (Task 21 §4.2).
- *Operational:* template changes require a release; no hot-fix of accounting content.
- *Extensibility:* distribution is the release pipeline; per-customer templates become impossible without reopening.
- *Compatibility:* preserves ODR-1/2/3 and OD-20-1 identity separation; closest to contract §8.7's “vocabulary is code-defined” posture.
- *New decisions required:* Owner confirmation on OD-20-1; how accountant approval is evidenced in a PR (Task 21 §8).

### Comparison

| Dimension | A (accounting schema) | B (product schema) | C / C-replica | D (code registry) |
|---|---|---|---|---|
| New non-tenant table in a domain schema | Yes | Yes (isolated) | No | Yes (mirrored) or none |
| Row-level tenant boundary on templates | None | None | Full | None / N-A |
| Needs a new authority class (D-R-2) | Yes | Yes | C: yes · C-replica: no | No |
| OD-20-1 literal compatibility | High | High | C: conflicts · C-replica: partial | High on “versioned/owned”, ambiguous on “database asset” |
| Duplication / drift risk | None | None | N× | None |
| Distribution of a new version | Data migration | Schema dump/load | Per-org provisioning | Release |
| ADR required (AR-29) | Yes | Yes | Yes | Yes |
| Runtime authorship possible | Yes | Yes | Yes | No |

### Explicit answer to the Owner's question
> *Can a product-global Base Chart coexist with the current organization-bound Accounting architecture without introducing a hidden tenant/security bypass?*

**Technically yes, under enumerable conditions** — **[AGENT OBSERVATION]**, not a decision:
1. Template tables hold **no tenant data**, so the absence of `organization_id` removes no existing isolation guarantee.
2. Every **organization-scoped** effect (the adoption) still passes `assertOrganizationInScope` + permission; the ODR-3 chokepoint is untouched.
3. Organization-unscoped routes must **name no organization** — ADR-0025's guard then legitimately passes them, exactly as it already does for `users`/`rbac` routes (existing precedent, not a new bypass).
4. Writes must be gated by a **distinct, explicitly registered permission** — never a reused Accounting org permission, never a wildcard, never an unauthenticated route.
5. The residual risk is **authority scope, not data leakage**: in an unpinned multi-organization database a template writer influences the charts every organization later adopts. That new privilege class is exactly what D-R-2 must decide.

### Decision class
**ARCHITECTURAL DECISION** (ADR-gated, AR-29) + **OWNER DECISION** on the OD-20-1 reading for Options C/D.

### Blocking impact
Blocks all of Slice A (template storage/lifecycle) and therefore any adoption that reads a stored template. Does not block an adoption engine whose template source is settled later.

### Explicit non-decisions
Chooses no schema; authorizes no table; does not decide code- vs data-authored templates; decides no template content.

---

## D-R-2 — Who may author / approve / publish a Base Chart version

### Current repository state
- Permissions and roles are **deployment-global**: `rbac.roles` has no `organization_id`; `AuthorizationService` evaluates codes with no organization dimension.
- Organization access is a **separate** axis: `assertOrganizationInScope` (pin + membership), 404 on failure.
- Deployment-global admin surfaces already exist and are treated as normal: `users.controller.ts` (`Users.User.*`), `roles.controller.ts` / `permissions.controller.ts` (`Rbac.*`) — none names an organization, so ADR-0025's guard passes them.
- **No** platform-admin flag, **no** wildcard, **no** superuser; `is_super_admin` does not exist; system context bypasses both permission and scope checks and is **not reachable from HTTP**.
- **OQ-19 OPEN** (first-administrator bootstrap; out-of-band operator seed/script).
- Task 21 §8 — **now Owner-ratified as governance (Task 21 ACCEPTED 2026-09-26)** — classifies “who may approve/publish” as **OWNER DECISION (pending)** and states *“An agent may not approve content.”* The acceptance ratified the baseline *including* that pending item, so the authority itself is still undecided. **[OWNER DECISION — pending]**

### Problem
`Draft → Approved → Published → Superseded` implies at least two authorities (author, approver/publisher) over an artifact belonging to no organization. No principal model exists for “authority over a product asset”. **[OPEN QUESTION / SECURITY DECISION]**

### Why existing decisions do not fully answer it
ODR-3 answers *“may a principal reach organization X?”*; it says nothing about an object with no organization. Its non-goals forbid wildcard organization access and “a new authorization subsystem without repository evidence”. Deriving template authority from *any* organization membership would silently grant one tenant's member authority over all tenants' future charts. **[AGENT OBSERVATION]**

### Repository evidence
`authorization.service.ts:77-102`; `organizations.service.ts:297-345`; `deployment-scope.guard.ts`; `rbac.prisma` (`Role` has no `organization_id`); `docs/security.md` §3; `docs/open-questions.md` OQ-19/OQ-21; `docs/tasks/task-21/task-21-governance-baseline.md` §8.

### Options

**Option A — Organization-scoped authority**
- *Principal / AuthN / AuthZ:* existing session + permission + membership.
- *Scope:* forces an org-scoped template (couples to D-R-1 Option C) or grants cross-tenant influence from inside one tenant.
- *Security:* in unpinned multi-org mode this is a **privilege-escalation path by design** — org A's member edits what org B adopts. **[SECURITY DECISION — risk identified, not resolved]**
- *Compatibility:* conflicts with OD-20-1 ownership unless paired with D-R-1 Option C.
- *Audit:* fits existing `created_by/updated_by` conventions.

**Option B — Deployment/platform authority via ordinary RBAC on organization-unscoped routes**
- *Principal:* an ordinary authenticated user holding e.g. `Accounting.BaseChartTemplate.Configure` through a global role.
- *AuthZ:* no new subsystem — precisely the mechanism `Users.*` and `Rbac.*` already use; guard + service double-check (`docs/security.md` §3 layers 1–2).
- *HTTP reachability:* routes name no organization ⇒ ADR-0025's guard passes them; **ODR-3 is not weakened because no organization resource is touched**.
- *Security:* introduces a *new privilege class* (product authority) into a deployment-global role model; any holder affects all organizations. Mitigations available without bypasses: distinct permission codes for configure vs publish, mandatory audit columns + domain events, optionally refusing the route when `DEPLOYMENT_ORGANIZATION_ID` is unset.
- *Audit:* the **only** option producing a full HTTP audit trail (AR-23).
- *CI/bootstrap:* none required; grantable to the first administrator once OQ-19's out-of-band seed exists.
- *Extensibility:* natural home for a future template-administration UI.

**Option C — Product/bootstrap authority outside HTTP (system context: migration, seed, CLI)**
- *Principal:* none — `requireAllPermissions` and `assertOrganizationInScope` both early-return without a request context (documented trusted-caller posture).
- *Security:* no HTTP attack surface; authority becomes **operator/deploy authority**. Not a hidden bypass — it is the already-documented system-context posture and the same mechanism OQ-19 records — but the trust boundary moves to infrastructure, where RBAC audit does not reach.
- *Auditability:* weakest — no principal, no audit row unless the script writes one.
- *Extensibility:* ceiling — no runtime administration, no UI, without reopening.
- *Compatibility:* preserves ODR-3 trivially.

**Option D — Hybrid (read/draft over HTTP; approve/publish out-of-band or code-defined)**
- *Description:* HTTP surface for `View` (and possibly draft editing) under an ordinary permission; the **irreversible** transitions performed by system context/migration/registry sync (pairs naturally with D-R-1 Option D).
- *Security:* the escalation-relevant action leaves the HTTP surface; the audit gap is confined to publish events, which are release-time and visible in git history.
- *Domain:* matches Task 21 §8's “governance act … an agent may not approve content” most literally.
- *Complexity:* two authority mechanisms to document and test; risk of a half-built HTTP lifecycle if the boundary is imprecise.

### Comparison

| Dimension | A org-scoped | B platform RBAC | C system context | D hybrid |
|---|---|---|---|---|
| New authorization subsystem | No | No | No | No |
| Wildcard / superuser / `is_super_admin` needed | No | No | No | No |
| Unauthenticated endpoint needed | No | No | No | No |
| Cross-tenant influence from a tenant principal | **Yes** | No | No | No |
| HTTP audit trail for publish | Yes | Yes | No | Partial (git) |
| Requires a D-R-1 outcome | C-coupled | A/B | any | D-coupled |
| Runtime administration possible | Yes | Yes | No | Draft only |
| ODR-3 preserved | Only if the template is org-scoped | Yes | Yes | Yes |

**No option among A–D requires a wildcard permission, an `is_super_admin` flag, a hidden bypass or an unauthenticated system endpoint.** **[AGENT OBSERVATION]** Any variant that *did* (for example “template authority implicitly for every organization admin”, or “skip authorization because the object is global”) is a **security anti-pattern**, named here only to be excluded.

### Decision class
**SECURITY DECISION + OWNER DECISION** (the accepted Task 21 §8 records the approval authority as still pending).

### Blocking impact
Blocks every write path of Slice A. Does not block read-only template inspection, nor adoption if templates arrive via Option C/D.

### Explicit non-decisions
Names no permission code; does not decide whether publishing is an HTTP action; does not name the human approver; does not resolve OQ-19 or OQ-21.

---

## D-R-3 — Can a content-less Base Chart foundation be implemented?

### Current repository state
No template table, no adoption service, no seed, no accounting content anywhere (ADR-0037: “Implements: nothing”). OD-20-1's content boundary and Task 21 §14.2 forbid agent-invented content. Task 21 §14.1 gates implementation on acceptance **and** explicit content approval: **the acceptance limb is now satisfied (Task 21 ACCEPTED 2026-09-26), the content limb is not** — the acceptance record states that Base Chart content values are not approved by it and that it authorizes no production implementation.

### Problem
Whether *infrastructure* may precede *approved content*, and what the deliverable means if it may. **[OWNER DECISION]**

### Why existing decisions do not fully answer it
OD-20-1 defers content, not mechanism; Task 21 §14.1 couples both in one sentence, and Task 21's acceptance satisfied only the first limb. The coupling is a governance reading, not a technical necessity. **[AGENT OBSERVATION]**

### Repository evidence
`docs/adr/0037-…` §4 + “Current implementation boundary / non-goals”; Task 21 §14.1/§14.2; `docs/open-questions.md` OQ-25; AR-29/AR-31; `docs/accounting/task-index.md` §7.

### Options

**Option A — No implementation until production content is approved**
- Zero dead surface and zero speculative schema; the content decision drives the model shape.
- Delays every downstream capability; OQ-25 stays exactly where it is.
- Risk: the content-approval session has no executable target to validate against.

**Option B — Infrastructure only, no template rows at all**
- Produces tables/endpoints returning empty sets and an adoption endpoint that can only 404/422 in production — a **dead API surface** until content lands.
- Migration risk low (empty tables); **schema-shape risk real** — approved content may later need a field the model lacks, implying a second migration.
- Testing is only possible with fixtures, so in practice it collapses into Option C unless tests are omitted (which the draft's §15 forbids).

**Option C — Infrastructure + explicitly labelled technical fixtures (test-only)**
- Permits the full invariant matrix (immutability, ancestor closure, leaf-only, isolation, ODR-1 coherence) without asserting accounting truth.
- Containment requirements, all review-verifiable: fixtures live only under `backend/test/**` or `*.spec.ts`; no seed script, no migration inserts, nothing reachable from a production path; obviously synthetic values labelled `ILLUSTRATIVE — NOT PRODUCTION CONTENT`.
- Residual risk: a future task copies a fixture into a seed — a process risk, not a structural one.
- Narrows nothing in OQ-25: OQ-25 owns *values*, and fixtures are explicitly not values. **[IMPLEMENTATION CONSTRAINT]**

**Option D — Infrastructure + a provisional product template**
- **Governance conflict, stated as required:** OD-20-1 (“the actual list of accounts, codes, Persian titles, natures, postability … must be approved explicitly by accounting/domain experts”), ADR-0037 §4 (“No agent may invent that content”), Task 21 §14.2, AR-31/AG-09. A “provisional” production template is production accounting content by another name, and publishing it would pre-empt Task 21 §8's pending approval authority.
- Available only if **the Owner/accountant supplies and approves the content** — at which point it ceases to be provisional and satisfies Option A's precondition.

### Comparison

| Dimension | A wait | B empty | C fixtures | D provisional content |
|---|---|---|---|---|
| Dead API surface | None | Yes | Yes (until content) | No |
| Invariants testable | No | Barely | Yes | Yes |
| Content invented by agent | No | No | No (labelled non-content) | **Yes — governance conflict** |
| Schema rework risk after content approval | None | Medium | Medium | Low |
| Effect on OQ-25 | None | None | None | Would pre-empt it |
| Production value on day 1 | None | None | None | Full but unapproved |

### Decision class
**OWNER DECISION** (with an **ACCOUNTING DOMAIN DECISION** required for any content).

### Blocking impact
Determines whether Slices A/B may start at all; independent of the technical blockers D-R-1/D-R-2.

### Explicit non-decisions
Approves no content; neither narrows nor closes OQ-25; does not fix a fixture format.

---

## D-R-4 — Where mandatory semantics live after adoption

### Current repository state
`Account` has no mandatory marker and no provenance column. Deletion **does not exist** anywhere (no permission, no endpoint, AC-D-08 freeze-never-delete), so “cannot delete a mandatory account” already holds by construction. Deactivation (`disableAccount` → `setActive`) is permission-gated only. Task 21 §5's mandatory **semantics** are **ratified governance** — the Owner acceptance of Task 21 explicitly covers “mandatory-account semantics” — while the mandatory **list** stays unapproved content under OQ-25, and Task 21 §4.2/§8 still leave the account-level **provenance** question **OPEN**. (The baseline's own in-document label in §5 reads `ACCOUNTING DOMAIN DECISION (proposed)`; the acceptance commit did not re-label the section, and this analysis does not reinterpret it beyond the acceptance record's wording.)

### Problem
Rules 2–3 of Task 21 §5 (no delete / no deactivate while mandatory) are *post-adoption lifecycle* rules, yet the adopted row cannot currently know that it is mandatory. Task 21's acceptance ratified the **semantics** without deciding their **post-adoption representation**, so the question below is untouched by that acceptance. **[OPEN QUESTION]**

### Repository evidence
`domain/account.ts` (`ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS`, `isReferencedByDocumentLine` seam); `application/accounts.service.ts:608-629` (`enable/disableAccount → setActive`); `domain/accounting-permissions.ts` (no `Delete`); contract §8.6; Task 21 §5/§9/§4.2/§8; AR-29.

### Options

| | **A** `accounts.is_mandatory` | **B** provenance on `accounts` (`template_version_id`, `node_key`) | **C** separate mapping artifact (`base_chart_adopted_accounts`) | **D** adoption-time enforcement only |
|---|---|---|---|---|
| Enforces “cannot deactivate” | Yes (one boolean read in `setActive`) | Yes (join to template node) | Yes (join to mapping) | **No** |
| Enforces “cannot delete” | Yes — already true today | Yes | Yes | Already true today |
| Mandatory state legible after adoption | Yes | Yes (derived) | Yes | No |
| Template identity kept out of `accounts` | Yes | **No** — a template reference lands on a tenant row (Task 21 §4.2 calls this OPEN; must stay provenance-only, never identity) | Yes | Yes |
| Resolves something Task 21 left OPEN | No | **Yes** (account-level provenance) — an Owner-level act | No | No |
| Consistency with OD-20-3's “independent mapping, not a column on Account” | Column on Account | Columns on Account | **Mirrors the accepted pattern** | N/A |
| AR-29 speculative-column exposure | Column whose rule is ratified as governance but whose representation Task 21 left undecided | Two columns + cross-boundary FK | New table, `accounts` untouched | None |
| Enables upgrade diffing (D-R-5 C/D) | No | Yes | Yes | No |
| Migration | additive boolean, default false | 2 columns + FK + index | new table + FKs + uniques | none |
| Data risk | flag may drift from template truth | FK RESTRICT constrains template deletion (which does not exist) | mapping rows can orphan without FK guards | mandatory becomes advisory |
| Audit | flag change needs its own story | provenance immutable | mapping carries its own audit columns | n/a |

Additional findings **[AGENT OBSERVATION]**:
- Because **no deletion exists**, the practical enforcement gap today is *deactivation only*; the urgency of A–D depends on whether Task 23 exposes deactivation changes at all.
- Options B and C are the only ones able to answer “which adopted accounts came from version N?”, which D-R-5 Options C/D require.
- Option B's FK direction (tenant → product table) exists only under D-R-1 Options A/B; under Option D provenance must be a soft string reference.

### Decision class
**ACCOUNTING DOMAIN DECISION** (the mandatory **list/content** — still unapproved under OQ-25) + **ARCHITECTURAL DECISION** (the post-adoption **representation** — left OPEN by the accepted Task 21). The §5 *semantics* are Owner-ratified governance; this analysis decides nothing about either limb.

### Blocking impact
Blocks only the *enforcement* portion of Slice B; an adoption guaranteeing mandatory **inclusion** at write time needs none of A–D.

### Explicit non-decisions
Does not reinterpret or extend the accepted Task 21 §5; does not approve the mandatory-account list; does not decide provenance; does not decide whether deactivation guards belong to Task 23.

---

## D-R-5 — Non-empty organization, re-adoption and upgrade

### Current repository state
`uq_accounts_organization_id_code` guarantees collision on any duplicate code. `code` is immutable from creation; `parentId`, `level`, `accountNature`, `isPostable` freeze once a document line references the account. `AccountingConfiguration.operationally_used_at` freezes configuration after first operational use (ADR-0028). Accounts are never deleted. No adoption exists, so no current behaviour changes.

### Problem
Two questions are easily conflated: **(1) initial adoption into an organization that already holds accounts**, and **(2) template upgrade after an adoption**. Task 21 governs neither (§4.2 forbids silent mutation and requires explicit upgrades, but defines no mechanism). **[OPEN QUESTION]**

### Decisive technical findings **[AGENT OBSERVATION]**
- An upgrade can only ever **add** accounts. It cannot re-parent, re-level, re-nature or re-postable any account with ledger/document usage (`ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS`), and it can never change a code (immutable from creation — stricter than OD-20-4; discrepancy D-2).
- Adding a child under a **postable leaf** is refused by `planAccountPlacement`, and the parent's `isPostable` cannot be flipped after use. A v2 that deepens a subtree under an already-used leaf is therefore **structurally impossible** without an ADR-0035-class migration.
- Any “roll back an adoption” capability requires deletion, which does not exist (→ D-R-6).

### Options

**Option A — First adoption into an empty chart only** — simplest invariant; no collision logic; one transaction; idempotent via a unique constraint. Excludes every organization that already created accounts manually. Says nothing about upgrade.

**Option B — Adoption into a non-empty chart with merge logic** — requires a merge policy for code collisions, partial overlaps, custom accounts occupying template codes, and ancestors with different natures. Every collision class is an **accounting** decision; “skip existing” or “reuse existing” changes the meaning of the adopted chart. Post-use accounts cannot be adjusted, so a merge can produce a chart that is neither the template nor the original.

**Option C — Explicit upgrade from one adopted version to another** — requires provenance (D-R-4 B/C) to diff, plus a policy for added nodes (insertable), removed nodes (cannot delete → deactivate? mandatory?), changed titles (editable), changed natures/postability (frozen after use) and changed codes (impossible). Must never mutate silently (Task 21 §4.2) ⇒ an explicit, permissioned, audited operation with a dry-run report is implied. Interacts with `operationally_used_at` and OQ-36.

**Option D — Separate “initial adoption” and “upgrade” into different capabilities/tasks** — keeps the first delivery to one well-governed invariant and defers the diff/merge space, requiring only that the initial adoption record enough information not to foreclose upgrade. Leaves organizations with existing accounts unserved until later.

### Comparison

| Dimension | A empty-only | B merge | C upgrade | D split |
|---|---|---|---|---|
| New accounting decisions required | Minimal | **Many** (collision semantics) | Several (diff policy) | Minimal now, deferred later |
| Code-collision handling | Impossible by precondition | Central problem | Only for added nodes | Per sub-capability |
| Works with post-use immutability | Yes | Partially | Only additive | Yes |
| Needs provenance (D-R-4) | No | Helpful | **Yes** | For the upgrade half |
| Needs OQ-36 | No | Maybe | **Yes** (removed nodes) | Only for the upgrade half |
| Idempotency mechanism | unique constraint | application-level | version-pair guard | per capability |
| Rollback after commit | n/a (all-or-nothing tx) | hard (no deletion) | hard | n/a |
| Serves organizations with existing charts | No | Yes | Yes (after first adoption) | Later |

### Decision class
**ACCOUNTING DOMAIN DECISION** (collision/diff semantics) + **ARCHITECTURAL DECISION** (capability split).

### Blocking impact
Option A is the only variant needing no further decision. Whatever is chosen, the **uniqueness shape of the adoption record** (`uq(organization_id)` vs `uq(organization_id, template_version_id)` vs none) must be decided before a migration is written, because it silently encodes the policy.

### Explicit non-decisions
Defines no upgrade policy; decides no collision rule; does not endorse the interim “refuse if any account exists” assumption.

---

## D-R-6 — Which parts of OQ-36 actually block Base Chart implementation

OQ-36 as recorded covers: deactivation-vs-deletion sufficiency, deletion eligibility, soft vs hard, code reuse after deactivation, case sensitivity. The **implemented** posture is: no deletion at all, `is_active` only, plain unique indexes, codes never reused, case-sensitive comparison. Task 21 §10 nonetheless lists three prerequisites “needed from OQ-36 **before** Base Chart implementation”.

| OQ-36 item | Blocks template infrastructure (Slice A)? | Blocks initial adoption (Slice B)? | Blocks customization? | Blocks upgrade (Slice D)? | Blocks deletion/reuse? | Containment boundary that makes deferral safe |
|---|---|---|---|---|---|---|
| **1. Code reuse** | No — template codes are product data | No — adoption mints codes that never existed in that organization | No — no code-change path exists | **Yes** — a retired v1 code reappearing in v2 needs a rule | Yes | Task 23 exposes no code change, retirement or reuse |
| **2. Superseded codes** | No | No — nothing is superseded on first adoption | No | **Yes** | Yes | No account is ever superseded by Task 23 |
| **3. Deletion eligibility** | No | No — nothing is deleted; a failed adoption rolls back inside the transaction | No (no delete endpoint) | **Yes** — removed template nodes need a retirement rule | Yes | Task 23 adds no delete endpoint or permission; rollback is transactional only |
| **4. Unused adopted accounts** | No | No | Partially — “may an organization remove accounts adopted by mistake?” is a user-expectation gap, not a technical block | Yes | Yes | Task 23 states adopted accounts can only be deactivated, never removed |
| **5. Future code-history producer** | No | No — assigning a code at creation is not a code *change* | No | **Yes** if upgrade ever re-codes (currently impossible) | Partly | Task 23 creates no code-change operation (OD-20-4) |
| **6. `uq(organization_id, code)`** | No | No — the constraint is the desired backstop, strengthened not weakened | No | Yes (interacts with 1/2) | Yes | The unique index is untouched |

### Findings **[AGENT OBSERVATION]**
- **Technically, no OQ-36 item blocks Slice A or a bounded Slice B**, provided Task 23 explicitly excludes: deletion, code change, code reuse, account retirement, post-commit adoption rollback and template upgrade.
- **Governance-wise, Task 21 §10 still asserts the prerequisite — and it is now Owner-ratified governance, since the Task 21 acceptance covers the OQ-36 dependency boundary while leaving OQ-36 itself OPEN.** The residual blocker is therefore not technical: the Owner must either resolve the three items or record an explicit **bounded waiver** naming the excluded behaviours.
- OQ-36 becomes unavoidable the moment any **upgrade/re-adoption** capability enters scope — items 1, 2, 3 and 5 all activate simultaneously.

### Decision class
**OWNER DECISION** (resolve-or-waive) over a **DEFERRED (OQ-36)** area. OQ-36 is **not** closed by this analysis.

### Blocking impact
Hard-blocks Slice D (upgrade). Soft-blocks Slices A/B only through Task 21 §10's wording.

### Explicit non-decisions
Decides no deletion, retirement or reuse rule; closes nothing.

---

## D-R-7 — Partial adoption

### Definitions used here
- **Full adoption:** every node of the published version is created.
- **Subset adoption:** a caller-selected set, constrained by ancestor closure + mandatory inclusion.
- **Staged adoption:** an initially adopted subset that may later be extended toward the full version.

### Current repository state
Nothing exists. Task 21 §4.3 fixes the two invariants and leaves the shape **OPEN**, noting accounting-consistency risk and “non-goal: a generic chart designer”.

### The decisive technical finding **[AGENT OBSERVATION]**
Subset/staged adoption creates a **structural trap** that full adoption does not:

```text
Template:  1000 (non-leaf) ──> 1001 (leaf, postable)      [ILLUSTRATIVE — NOT PRODUCTION CONTENT]
Subset:    adopt 1000 only  ⇒  1000 is a LEAF in the organization chart
           ⇒ it may be made postable (leaf-only permits it)
           ⇒ the organization posts to 1000
Later:     adopt 1001       ⇒ 1000 becomes non-leaf ⇒ violates `postable ⇒ leaf`
           ⇒ `isPostable` is in ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS ⇒ cannot be flipped
           ⇒ the subtree can NEVER be completed
```

Evidence: `domain/account.ts` (`ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS`, `planAccountPlacement` refusing a postable parent), OD-20-5, contract §14. The trap is avoided only if omitted-branch parents are forced non-postable at adoption — itself a policy decision, since it renders part of the adopted chart unusable for posting until completed.

### Options

| Dimension | A full-only | B subset with ancestor closure | C staged | D full now, extension later |
|---|---|---|---|---|
| API complexity | One call, no selection payload | Selection payload + validation errors | B + completion operation + state | A now; new capability later |
| UX | “adopt the chart” | Chart picker UI (none exists) | Picker + progress semantics | Simple now |
| Accounting correctness risk | Lowest (chart as approved) | Medium — may lack accounts a statement structure assumes | Highest — chart meaning changes over time | Low now |
| Mandatory semantics | Trivially satisfied | Enforced per selection | Re-enforced at each stage | Trivially satisfied |
| Postability trap | Cannot occur | Occurs unless parents forced non-postable | **Occurs and can become permanent** | Cannot occur now |
| Idempotency / re-adoption | One-shot | One-shot per selection | Inherently multi-shot (→ D-R-5) | One-shot + later capability |
| Future upgrades | Version-to-version diff | Diff must also track never-adopted nodes | Diff over a moving baseline | Deferred |
| Customization interaction | Custom accounts beside the template | Custom accounts may occupy omitted template codes → later collision | Same, worse over time | Same as A |
| Migration complexity | None extra | Selection persisted or re-derivable | Selection + stage history | None now |
| New decisions required | None beyond §4.3 | Selection policy (accounting) | Selection + completion + postability policy | Deferred |

### Decision class
**ACCOUNTING DOMAIN DECISION** (whether a partial chart is accounting-acceptable) + **ARCHITECTURAL DECISION** (API shape).

### Blocking impact
Only Option A requires no new decision; B and C each need a selection policy and a resolution of the postability trap. The choice also determines whether the adoption record must persist a selection.

### Explicit non-decisions
Introduces no partial-adoption policy; does not decide whether omitted-branch parents are forced non-postable.

---

## 8. Cross-decision dependency graph

```text
D-R-1  storage boundary
  ├── D-R-2   (Option D removes the HTTP write surface entirely; A/B require it)
  ├── D-R-3   (whether an empty store is a deliverable at all)
  └── D-R-4   (Option B provenance FK only possible if templates are tables)

D-R-2  authority model
  └── (bootstrap / OQ-19 adjacency — see §10; must NOT be resolved by a bootstrap admin)

D-R-3  content gating
  └── D-R-7   (a content-less store makes subset selection untestable in practice)

D-R-4  mandatory representation
  ├── D-R-5   (upgrade diff needs provenance)
  └── D-R-6   (mandatory + retirement interact once deletion is decided)

D-R-5  adoption / upgrade scope
  └── D-R-6   (upgrade activates OQ-36 items 1, 2, 3, 5 simultaneously)

D-R-7  partial adoption
  ├── D-R-5   (completion is a form of re-adoption)
  └── D-R-4   (mandatory enforcement over an omitted set)
```

- **Independent:** D-R-3 (governance-only); D-R-2 once D-R-1 is settled.
- **Dependent:** D-R-4 (on D-R-1), D-R-5 (on D-R-4/D-R-7), D-R-6 (on D-R-5).
- **Safely deferrable with a bounded scope:** D-R-6 (conditions above), the upgrade half of D-R-5, D-R-7 Options B/C, D-R-4 if post-adoption enforcement is out of scope.
- **Implementation-blocking today:** D-R-1, D-R-2, D-R-3.
- **Future-feature only:** the upgrade half of D-R-5; D-R-7 B/C.

---

## 9. Task 23 slicing analysis (analysis only — no registry change)

| Slice | Content | Prerequisites | Decisions required | Independently implementable? | Main risks |
|---|---|---|---|---|---|
| **A — Template storage + lifecycle** | template/version/level/node persistence or registry; `draft→approved→published→superseded`; read surface | ADR for storage (D-R-1); authority model (D-R-2); content posture (D-R-3) | D-R-1, D-R-2, D-R-3 | Yes — no dependency on adoption | Dead surface until content; schema rework if the content shape differs |
| **B — Initial adoption (full, empty chart)** | `POST` adoption; ODR-1 coherence; ancestor closure; mandatory inclusion; leaf-only derivation; adoption record | Slice A (or templates provisioned out-of-band); an explicit exclusion list for D-R-6; the D-R-5 Option A precondition | D-R-5 (A), D-R-7 (A), D-R-4 only if lifecycle guards are in scope, D-R-6 waiver | Yes, once the template source is settled | Adoption-record uniqueness silently encodes policy; event volume on large charts |
| **C — Partial/subset adoption** | selection payload + persisted selection | Slice B; resolution of the postability trap | D-R-7 (B/C), D-R-4, possibly D-R-5 | No | Permanent structural trap; accounting-consistency risk |
| **D — Template upgrade** | version diff; additive application; retirement policy | Slice B; provenance; OQ-36 items 1/2/3/5 | D-R-5 (C), D-R-6 (resolve, not waive), D-R-4 (B or C) | No | Post-use immutability makes most diffs inapplicable; ADR-0035-class analysis needed |

Cross-cutting for every slice: one Prisma migration per slice (AR-10); the CI `backend` job as the authoritative gate; the rehearsal harness updated if a populated-data path is touched; a `task-index.md` §7 admission per task.

---

## 10. Special check — bootstrap administrator

A bootstrap administrator user was raised by the Owner separately. **It is not one of D-R-1…D-R-7 and nothing about it was implemented.** Findings relevant to keeping it out of the Base Chart authorization architecture:

| Concept | Does the repository distinguish it? | Evidence | Relationship to Base Chart authority |
|---|---|---|---|
| **Initial system administrator** | Yes, as an **OPEN question** — OQ-19: created out-of-band by the operator (seed/script in system context); no built-in bootstrap endpoint; no last-admin lockout protection | `docs/open-questions.md` OQ-19 | A Users/RBAC concern. It could later *hold* a template permission, but it must not *be* the authorization model |
| **Organization administrator** | Yes, concretely — membership (`organization.organization_memberships`) + `Organization.Membership.{View,Grant,Revoke}`, with one bounded exception (first grant into an empty organization) | ODR-3; PR #55; `organizations.service.ts` | Grants access **to one organization**; must never imply product authority (that is D-R-2 Option A's escalation path) |
| **Product-level Base Chart author/publisher** | **No — does not exist** | absence across `rbac`, `users`, `identity` and the Accounting permission registry | Exactly what D-R-2 must decide |

**Guardrails identified [SECURITY DECISION — for the Owner, not taken here]:**
1. Creating a bootstrap administrator must not become, silently, the answer to D-R-2. The two need separate decisions and separate records.
2. Under D-R-2 Option B the template permission must be a **distinct code granted deliberately** — not an implicit property of “the first user” and not bundled into an existing administrative role by default.
3. A trivial password passes current validation (`MinLength(1)`, `user-request.dto.ts`) **only because password policy is deliberately unimplemented under OQ-06 (OPEN)**. A permanently provisioned bootstrap principal holding deployment-global authority over product accounting content would combine three open items (OQ-06 weak credential, OQ-19 bootstrap, D-R-2 new authority class) in one account. Recorded as an observation, not a decision.
4. Usernames are `VarChar(64)` and unique (`uq_users_username`); a non-ASCII username is not structurally blocked by the schema. No claim is made about locale/normalization behaviour, which was not tested.

---

## 11. Consolidated security review

| Axis | Finding | Applies to |
|---|---|---|
| Authentication | Unchanged in every option; no unauthenticated endpoint is required anywhere | all |
| Authorization | Permissions are deployment-global today; granting any new code is inherently deployment-wide | D-R-1, D-R-2 |
| Organization isolation | Untouched: templates hold no tenant data; every organization-scoped effect still passes `assertOrganizationInScope` | D-R-1, D-R-5 |
| IDOR | Adoption must keep the 404-for-foreign-organization posture (AC-I-16); template ids are not tenant-sensitive, so the 404/403 policy for template reads is a separate, low-sensitivity choice | D-R-1, D-R-5 |
| Privilege escalation | The only genuine new risk is **product authority over all tenants' future charts** (D-R-2 A ≫ B ≫ C/D). No option requires wildcard/superuser/bypass | D-R-2 |
| Auditability | HTTP publish → full audit (B); system-context publish → operator-level only (C); code registry → git history (D) | D-R-2 |
| System vs organization authority | The repository already has both (system context, organization membership); it has **no** product-authority tier | D-R-1, D-R-2 |
| Bootstrap trust boundary | OQ-19 and OQ-06 are both OPEN and must not be silently consumed by a Base Chart decision | §10 |
| Anti-patterns explicitly excluded | wildcard permissions, `is_super_admin`, implicit bypass for “global” objects, unauthenticated provisioning endpoints, product authority derived from organization membership | all |

---

## 12. Consolidated data / migration review

| Option family | New tables | New columns on existing tables | FKs | Uniqueness | Migration order | Existing-data compatibility | Rollback |
|---|---|---|---|---|---|---|---|
| D-R-1 A/B | 4 template tables (+1 tenant adoption table) | none | template-internal + adoption → org/config/version (RESTRICT) | `uq(template,version)`, `uq(version,node_key)`, `uq(version,code)` | one additive migration after `20260926000000` | fully compatible (new tables only) | drop new tables while unused |
| D-R-1 C | same tables, all with `organization_id` | none | + organization FK on every table | uniques widen with `organization_id` | same | compatible | same |
| D-R-1 D | mirrored tables or none | none | soft version reference | idempotent sync key | migration + boot sync | compatible | re-run sync |
| D-R-4 A | — | `accounts.is_mandatory` boolean default false | none | none | after template tables | trivial backfill (all false) | drop column while unused |
| D-R-4 B | — | `accounts.template_version_id`, `accounts.template_node_key` | tenant → product FK (RESTRICT) | index on version | after template tables | nullable for pre-existing rows | drop columns |
| D-R-4 C | 1 mapping table | none | account + adoption + node | `uq(account_id)` | after the adoption table | no impact on `accounts` | drop table |
| D-R-5 A | — | — | — | `uq(organization_id)` on the adoption record | — | — | — |
| D-R-5 C/D | possibly an upgrade-run table | — | — | `uq(organization_id, template_version_id)` | later slice | — | — |

Repository-wide constraints applying to all of them: migrations are the only schema-change path (AR-10); a migration is never edited after apply (AR-08); no CHECK constraints for value lists (the next generated migration would drop them — `accounting.prisma` header); concurrency guards use `SELECT … FOR UPDATE`, never triggers (AR-11); the populated-data rehearsal harness must stay green.

---

## 13. Accounting-domain compatibility matrix

| Decision | D-R-1 | D-R-2 | D-R-3 | D-R-4 | D-R-5 | D-R-6 | D-R-7 |
|---|---|---|---|---|---|---|---|
| **ODR-1** coherence | preserved (adoption re-applies `planPinCoherence`) | n/a | n/a | n/a | preserved in all options | n/a | preserved |
| **ODR-2** chart ownership | preserved (no second Account master) | n/a | n/a | preserved | preserved | n/a | preserved |
| **ODR-3** principal-bound org auth | preserved in A/B/D; **C requires care** | **A is the risk option**; B/C/D preserve | n/a | n/a | preserved | n/a | preserved |
| **OD-20-1** template ≠ org ≠ ledger | A/B/D preserve; C conflicts with “product asset” | n/a | D conflicts on content | B places a template reference on a tenant row (provenance only — Task 21 §4.2 OPEN) | preserved | n/a | preserved |
| **OD-20-2/3** consumer-first roles, no `Account.control_role` | no role artifact in any option | n/a | no catalog | no role column | n/a | n/a | n/a |
| **OD-20-4** code lifecycle | n/a | n/a | n/a | n/a | **C/D collide with code immutability** | items 1/2/5 | n/a |
| **OD-20-5** leaf-only posting | n/a | n/a | n/a | n/a | additive upgrades only | n/a | **B/C create the postability trap** |
| **OD-20-6** dimensions | untouched | untouched | untouched | untouched | untouched | untouched | untouched |

The chain `Base Chart Template → explicit Adoption → organization-owned Account → LedgerEntry.accountId` is preserved by **every** option analysed; no option collapses two of those identities.

---

## 14. Final synthesis

### A. Decision matrix

| D-R | Core question | Decision class | Main dependency | Blocks what |
|---|---|---|---|---|
| **D-R-1** | Where does the product-global Base Chart live? | ARCHITECTURAL (ADR, AR-29) + OWNER (OD-20-1 reading) | none — root decision | Slice A entirely; shapes D-R-2 and D-R-4 |
| **D-R-2** | Who may author/approve/publish a version? | SECURITY + OWNER (Task 21 §8 pending) | D-R-1 | all template write paths |
| **D-R-3** | May infrastructure precede approved content? | OWNER (+ ACCOUNTING DOMAIN for content) | independent | whether Slices A/B start at all |
| **D-R-4** | Where does mandatory live after adoption? | ACCOUNTING DOMAIN (mandatory **list** unapproved; semantics ratified) + ARCHITECTURAL (representation OPEN) | D-R-1 | post-adoption enforcement; upgrade diffing |
| **D-R-5** | Non-empty chart, re-adoption, upgrade | ACCOUNTING DOMAIN + ARCHITECTURAL | D-R-4, D-R-7 | adoption preconditions; the whole upgrade capability |
| **D-R-6** | Which OQ-36 items truly block? | OWNER (resolve-or-waive) over DEFERRED | D-R-5 | Slice D hard; Slices A/B only via Task 21 §10 |
| **D-R-7** | Full vs subset vs staged adoption | ACCOUNTING DOMAIN + ARCHITECTURAL | D-R-4, D-R-5 | subset/staged capability; adoption API shape |

### B. Hard blockers vs bounded deferrals

**Hard blockers (no safe implementation without an Owner act):**
1. **Task 21 §14.1 content limb** — the acceptance limb is **satisfied** (Task 21 **ACCEPTED 2026-09-26**), but §14.1's second limb is not: Base Chart content is still unapproved, and the acceptance record states that it authorizes **no** production implementation, schema, migration, API, DTO, permission, seed, frontend or test change on its own. Task 23 implementation therefore still requires a separate explicit Owner act. *(Governance, not one of the D-Rs.)*
2. **Task 23 admission** — `task-index.md` §7 items 7 (acceptance criteria) and 8 (§2 row) unmet.
3. **D-R-1** — no storage boundary exists; AR-29 requires an ADR before any table.
4. **D-R-2** — no principal model exists for a non-organization-scoped write; building one silently would create a new authority tier.
5. **D-R-3** — without an Owner ruling, either nothing may be built or a dead surface is built deliberately.

**Can be deferred with a bounded scope:**
- **D-R-4** — if Task 23 exposes no deactivation/deletion guard changes (deletion is already impossible today).
- **D-R-5 upgrade half** — if only first adoption into an empty chart is in scope, and the adoption record's uniqueness shape is chosen deliberately.
- **D-R-6 items 1–6** — if Task 23 excludes deletion, code change, reuse, retirement, post-commit rollback and upgrade; the Owner must still resolve-or-waive Task 21 §10 explicitly.
- **D-R-7 Options B/C** — if full-version adoption only is in scope.

### C. Safe deferrals (may remain OPEN)

OQ-25 content values · OQ-36 (under the containment boundary in §D-R-6) · OQ-41 dimensions · OQ-43 statutory · account-level provenance (unless D-R-4 B/C is chosen) · control-role catalog (OD-20-2 consumer-first) · partial-adoption policy · upgrade policy · OQ-62/OQ-63 (pin-divergence repair, untouched by adoption).

### D. Cross-decision dependencies

See §8.

### E. Task 23 possible slices

See §9. No registry, index or task file was modified by this analysis.

### F. Owner Decision Packet

```text
D-R-1:
Choose the storage boundary for product-global Base Chart templates:
A  non-tenant tables inside the existing `accounting` schema
B  a dedicated product/catalog schema (or separate module boundary)
C  organization-scoped storage  (C = org-authorable — conflicts with OD-20-1 as written;
                                 C-replica = system-provisioned replicas only)
D  code-defined versions mirrored into tables (permission-registry pattern)
→ and: do you authorize a Proposed ADR recording whichever boundary you choose?

D-R-2:
Choose the authority model for the template lifecycle (Draft/Approved/Published/Superseded):
A  organization-scoped authority
B  deployment/platform authority via ordinary RBAC on organization-unscoped routes
C  system-context / out-of-band authority only (migration, seed, CLI)
D  hybrid (read/draft over HTTP; approve/publish out-of-band or code-defined)
→ and: who, in human terms, is the approver Task 21 §8 leaves pending?

D-R-3:
Choose the content posture:
A  no implementation until production Base Chart content is approved
B  infrastructure only, no template data at all
C  infrastructure + clearly labelled test-only technical fixtures
D  infrastructure + a provisional product template
    (only available if the Owner supplies and approves the content — an agent may not)

D-R-4:
Choose how mandatory survives adoption:
A  `accounts.is_mandatory` column
B  Base Chart provenance columns on `accounts`
C  separate adopted-account mapping artifact
D  enforce at adoption only; do not persist mandatory state
→ and: Task 21 §5's mandatory semantics are ratified by the Task 21 acceptance, but the **post-adoption representation** above is undecided — which of A–D applies?

D-R-5:
Choose the adoption precondition and the upgrade posture:
A  first adoption into an empty chart only
B  adoption into non-empty charts with merge logic
C  explicit version-to-version upgrade
D  split "initial adoption" and "upgrade" into separate capabilities/tasks
→ and: one adoption per organization, or many?

D-R-6:
Choose the OQ-36 posture for Task 23:
A  resolve the three Task 21 §10 prerequisites now
B  grant an explicit bounded waiver, on condition that Task 23 excludes
   deletion, code change, code reuse, account retirement, post-commit
   rollback and template upgrade
→ OQ-36 stays OPEN either way.

D-R-7:
Choose the adoption breadth:
A  full-version adoption only
B  subset selection with ancestor closure
C  staged adoption (subset now, completion later)
D  full adoption now; explicit extension mechanism decided later
→ if B or C: are omitted-branch parents forced non-postable at adoption?
   (otherwise the subtree can become permanently uncompletable once posted to)
```

**No recommendation, ranking or preferred option is attached to any entry above.** Every option is presented with its consequences so that the choice — and the reversal cost of the choice — remain the Repository Owner's.

---

## 15. Confirmations

- **No production code, TypeScript, Prisma schema, migration, SQL, seed, API, DTO, permission, production test or frontend file was created or modified** by the analysis or by recording it. The only artefact is this document.
- **No registry was modified:** `docs/accounting/task-index.md`, `STATE.md`, `docs/open-questions.md`, `docs/accounting/owner-decision-baseline.md` and every ADR are untouched. **No admission and no acceptance is implied.**
- **Task 19 (ODR-1…ODR-3) and Task 20 (OD-20-1…OD-20-6) were not reopened, weakened or reinterpreted.**
- **Task 21 was not accepted, re-accepted or modified by this document**; its status is reported exactly as found on `main` @ `1723d05` (**ACCEPTED (2026-09-26)**, governance/documentation acceptance only — see the *Re-baseline note*). That acceptance authorizes no Task 23 implementation.
- **OQ-25, OQ-36, OQ-41, OQ-43, OQ-19, OQ-21 and OQ-06 remain OPEN.** **No ADR was promoted** (ADR-0033…0037 remain Proposed).
- **No accounting content was invented:** no account code, Persian title, account nature, mandatory-account list, control-role catalog or statutory content appears here. The single structural example in §D-R-7 is labelled `ILLUSTRATIVE — NOT PRODUCTION CONTENT`.
- **The Agent takes no decision and does not self-accept.**
