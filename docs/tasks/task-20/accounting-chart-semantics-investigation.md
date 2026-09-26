# Task 20 — Accounting Chart Semantics & Master Structure — Investigation

- **Document type:** investigation + architecture review — **DOCUMENTATION ONLY**
- **Date:** 2026-09-26
- **Status:** **READY FOR REVIEW — NOT ACCEPTED** (the Agent does not self-accept)
- **Branch:** `arena/01a0ddc4-vardena`
- **Baseline inspected:** `main` @ `3deb5a5d32641fa78438b9a96d9ca45f3558e707` (merge of PR #56), i.e. the repository state **after** Task 19 acceptance
- **Companion:** [`task-20-implementation-gate.md`](./task-20-implementation-gate.md)

> **Boundary.** This task implements nothing. No TypeScript, Prisma schema,
> migration, endpoint, DTO, permission, authorization rule, index, dependency,
> frontend or existing test was changed. It closes **no** Open Question, promotes
> **no** ADR, reopens **no** accepted task and reinterprets **no** Owner decision.
> Where the repository is ambiguous it is recorded; where it contradicts itself it
> is escalated; where an Owner decision is missing it is proposed.

**Evidence labels used throughout** (following `STATE.md` §1): *verified
implementation* = inspected static code/schema at the baseline above, not runtime
validation; *recorded* = a statement in an existing repository file; *Agent
inference* = explicitly labelled reasoning that is not itself repository evidence.

---

## 1. Executive Summary

Task 20 investigated the five requested domains (Base Accounting Structure,
Control Roles, POSTING vs AGGREGATION, Account Code History, Detail / Floating
Detail / Dimensions) against `main` after Task 19.

**Headline findings:**

1. **The mechanism layer is real; the content layer is empty.** Configurable
   levels, digit lengths, level kinds, per-level posting defaults, version
   pinning, the account tree, the ODR-1 coherence guard and the ODR-2 Chart Tree
   read surface are all *verified implementation*. The **Vardena base chart
   content, the control-role catalog, account code history and the dimension
   model do not exist in code at all** — zero tables, zero columns, zero
   services, zero seeds.
2. **Every one of the five domains is currently gated by an Owner/expert content
   decision that the repository explicitly refuses to invent** — OQ-25 (base
   chart content, control-role list and mandatory set, per-level posting policy,
   code-reuse and deactivation policy) and OQ-41 (dimensions). Both remain
   **OPEN** after Task 19 (`docs/tasks/task-19/task-19-acceptance-record.md` §6).
3. **The POSTING/AGGREGATION conflict recorded as D-1 survives Task 19
   unchanged and is now materialized in a shipped read model.** The Trial Balance
   / General Ledger roll-up CTE
   (`backend/src/modules/accounting/data/accounting-read-query.repository.ts`
   `account_rollup` → `trial_rows`) maps every posting account to itself **and**
   to every ancestor and then `SUM`s that mapping into one row per reported
   account. Today this is safe **only because** `postable ⇒ leaf` makes a
   non-leaf POSTING node unrepresentable. Relaxing that rule without ADR-0034 §4's
   separated own-vs-descendant measures would silently double count — a defect,
   not a configuration option.
4. **Account Code History currently has no producer.** `accounts.code` is
   immutable from creation, there is no pre-use edit path and no migration
   service, so a history store built today would hold exactly one row per account
   forever. Building the store before its producer would be speculative schema
   (AR-29).
5. **Nothing found contradicts the three accepted Task 19 decisions (ODR-1,
   ODR-2, ODR-3).** No finding in this investigation requires changing them. Two
   findings are recorded as *TASK-19 DEPENDENCY* (not defects, not reopenings):
   a future base chart must deliver a **coherent pin pair** or ODR-1 will
   correctly reject it, and any future base-chart adoption or role-mapping
   surface must pass through the ODR-3 membership chokepoint.
6. **One documentation-level shape ambiguity is escalated** (T20-C-1): the
   contract describes the control role both as a nullable `control_role` **column
   on the account** (§8.3) and as an **effective-dated mapping configuration
   object** (§8.7 / ADR-0037 §4). Both cannot be the same artifact. This is not
   resolved here.

**Gate outcome:** **BLOCKED — OWNER DECISION REQUIRED** (see §15 and the gate
document). Six Owner decisions are proposed in §13; five bounded future slices in
§14.

---

## 2. Repository Baseline

### 2.1 Governance sources read

`.vardena/agent-rules.md` · `.vardena/architecture-rules.md` (referenced) ·
`STATE.md` (§1–§11) · `docs/accounting/task-index.md` (§1–§9) ·
`docs/accounting/domain-contract.md` (§1.2, §2.3, §8, §9, §10, §11, §12.3/§12.4,
§13.6, §14, §15, §19, §25, §31) · `docs/accounting/owner-decision-baseline.md`
(Q1–Q22, I-1…I-3, D-1…D-13, O-1…O-12, §11 ODR-1…ODR-3) · `docs/open-questions.md`
· `docs/adr/README.md` · ADR-0033 / ADR-0034 / ADR-0035 / ADR-0036 / ADR-0037 ·
`docs/tasks/task-19/{accounting-chart-configuration-investigation.md,
task-19-implementation-gate.md, task-19-implementation-report.md,
task-19-acceptance-record.md}` · `docs/testing/test-execution-policy.md`.

### 2.2 Implementation inspected (read-only)

Paths below are relative to `backend/`; `accounting/…` means
`src/modules/accounting/…`.

| Area | Files inspected | State at baseline |
|---|---|---|
| Account model | `prisma/schema/accounting.prisma` (`model Account`, lines 320–403) | `id`, `organization_id`, `code VarChar(32)`, `title`, `parent_id`, `level`, `coding_structure_version_id`, `accounting_configuration_id`, `account_nature`, `is_postable`, `is_active`, audit columns. **No** `account_type`, `is_temporary`, `control_role`, dimension or code-history column. |
| Coding structure | `prisma/schema/accounting.prisma` (`CodingStructureVersion`, `CodingStructureLevel`), `accounting/domain/coding-structure.ts` | Versioned `draft→active→superseded`; `max_depth`, per-level `digit_length`, `title`, `default_is_postable`, nullable informational `level_kind`; caps `MAX_CODING_STRUCTURE_DEPTH = 8`, `MAX_ACCOUNT_CODE_LENGTH = 32` (code constants). |
| Accounting configuration + levels | `AccountingConfiguration` / `AccountingConfigurationLevel` (Task 11), `accounting/domain/accounting-configuration.ts`, `accounting/application/accounting-configurations.service.ts`, `accounting/data/accounting-configuration-usage.ts` | Versioned root, one ACTIVE per organization, `operationally_used_at` freeze marker (Task 13). |
| Account repository | `accounting/data/accounts.repository.ts` | Locked write transactions; placement + code + postability + **ODR-1 pin-coherence** re-check (`assertSnapshotCoherence`, lines 300–303, 468). |
| Accounts service | `accounting/application/accounts.service.ts` | Pre-flight validation, permissions, organization chokepoint. |
| Chart Tree (ODR-2) | `accounting/application/chart-tree.service.ts`, `accounting/api/chart-tree.controller.ts`, `accounting/api/dto/chart-tree.dto.ts` | Read-only, organization-scoped, fixed `code ASC` order, explicit `sort` rejected, reuses `AccountsRepository`; no balances, no invented classification. |
| Organization authorization (ODR-3) | `prisma/schema/organization.prisma` (`OrganizationMembership`), `migrations/20260926000000_organization_membership`, organization services | Composite PK `(user_id, organization_id)`; presence **is** the authorization; `assertOrganizationInScope` chokepoint. |
| Task 17 read layer | `accounting/domain/ledger-movement.ts`, `accounting/application/ledger-movements.service.ts`, `accounting/domain/account-statement.ts`, `accounting/application/account-statements.service.ts` | Read-only movement + statement surfaces over `accounting.ledger_entries`; statement is restricted to a **postable** account (service lines 130–135). |
| Task 18 read layer | `accounting/data/accounting-read-query.repository.ts`, `accounting/application/{general-ledger,trial-balance}.service.ts`, `accounting/domain/{general-ledger,trial-balance}.ts` | Shared read/query repository; GL + TB; TB rows carry an explicit `role: 'POSTING' \| 'AGGREGATION'`. |
| Trial Balance roll-up | `accounting/data/accounting-read-query.repository.ts` lines ~707–830 (and the twin count query ~882–925) | `posting_accounts` = `is_postable = true`; recursive `account_rollup` maps each posting account to itself and every ancestor; `trial_rows` `SUM`s over that mapping `GROUP BY report_account_id`; `role` = `CASE WHEN "isPostable" THEN 'POSTING' ELSE 'AGGREGATION' END`. |
| Ledger entry | `prisma/schema/accounting.prisma` (`LedgerEntry`), `accounting/domain/ledger-entry.ts`, `accounting/data/ledger-entries.repository.ts` | Insert-only; references `account_id`; stores `document_date` + `posting_timestamp` + resolved `fiscal_year_id`/`accounting_period_id`; **stores no account code**; `dimensionAssignments` is a typed domain seam always materialized as `[]` (repository lines 240–242). |
| Permissions | `accounting/domain/accounting-permissions.ts` | 38 distinct `Accounting.*` codes at this baseline. |
| Seeds / templates | `prisma/` | Contains `migrations`, `rehearsal`, `schema` only — **no seed script, no chart template artifact**. |

### 2.3 Negative findings (verified absences)

A repository-wide search for `control_role` / `controlRole`, dimension tables,
cost centre, project and code-history identifiers returns **no production model,
column, table, service or endpoint**. The only hits are comments recording the
deferral (`prisma/schema/accounting.prisma` header lines 30–50;
`accounting/domain/ledger-entry.ts` §"Deferred dimension seam (OQ-41)";
`accounting/data/ledger-entries.repository.ts` lines 240–242;
`accounting/domain/balance-projection.ts` lines 15 and 243). This confirms the
`owner-decision-baseline.md` §1 fact row ("Control roles, dimensions, floating
details, posting rules … are contract-only — not implemented") is still accurate
after Task 19.

---

## 3. Task 19 Boundary

Task 19 is **ACCEPTED (2026-09-26)**
(`docs/tasks/task-19/task-19-acceptance-record.md`). ODR-1 (Explicit
Configuration Coherence), ODR-2 (Accounting-owned Chart Tree) and ODR-3
(Principal-bound Organization Authorization) are **CLOSED** for Task 19 and are
not redesigned, extended or reopened here.

Two forward dependencies are recorded — **dependencies, not defects, and not
changes to Task 19**:

| Id | Type | Statement |
|---|---|---|
| **T20-T19-DEP-1** | TASK-19 DEPENDENCY | A future Vardena base structure must be delivered as a **coherent pin pair** (`coding_structure_version` and `accounting_configuration` describing the same level count and the same per-level digit lengths). ODR-1's `planPinCoherence` (`accounting/domain/account.ts` lines 440–462) rejects any account write whose two pins disagree. A base chart shipped as one side only would be correctly refused. No change to ODR-1 is implied or requested. |
| **T20-T19-DEP-2** | TASK-19 DEPENDENCY | Any future base-chart adoption operation, control-role mapping surface or dimension administration surface is organization-scoped and therefore must pass the ODR-3 chokepoint `OrganizationsService.assertOrganizationInScope` (membership → permission), preserving the accepted 404 isolation posture. No new bypass, wildcard or bootstrap exception may be introduced for them. No change to ODR-3 is implied or requested. |

Neither dependency requires a new ADR by itself. Both are constraints on future
work, recorded so a later implementer cannot "discover" them late and be tempted
to weaken Task 19.

---

## 4. Base Accounting Structure (Domain A)

### 4.1 Current Implementation

**A1 — what the repository represents as Group / General / Subsidiary / Detail.**

*Verified implementation:* those four names exist in exactly two places, neither
of them a hard-coded database semantic:

1. `accounting/domain/coding-structure.ts` — `ACCOUNT_LEVEL_KINDS = ['group',
   'general', 'subsidiary', 'detail']`, stored in the nullable
   `coding_structure_levels.level_kind` column. The schema comment is explicit:
   *"Informational label only … NOTHING derives behaviour from it"*, duplicates
   across levels are allowed and the list may be shorter than `max_depth`.
2. `coding_structure_levels.title` / `accounting_configuration_levels` titles —
   free organization-configured text (contract §8.1: level titles are
   organization configuration).

There are deliberately **no** `groups` / `generals` / `subsidiaries` / `details`
tables (schema header lines 24–27; contract §8.2 AC-D-07). The whole chart is one
`accounts` table using adjacency (`parent_id`) plus a derived integer `level`.

**A2 — supported capabilities.**

| Capability | State | Evidence |
|---|---|---|
| Configurable number of levels | **IMPLEMENTED** | `coding_structure_versions.max_depth` (1..8), `accounting_configuration_levels`; `MAX_CODING_STRUCTURE_DEPTH = 8` is a code constant, not policy |
| Level ordering | **IMPLEMENTED** | `level_index` (1-based, unique per version); every level `1..maxDepth` must exist before activation |
| Level names | **IMPLEMENTED** | `coding_structure_levels.title` (VarChar 200, Persian-capable) |
| Level codes / digit lengths | **IMPLEMENTED** | `digit_length` per level; total capped by `MAX_ACCOUNT_CODE_LENGTH = 32`; canonical code = concatenation (`accounting/domain/account-code.ts`) |
| Level kind | **IMPLEMENTED (informational only)** | nullable `level_kind` from a closed code list; no behaviour derives from it |
| Per-level posting default | **IMPLEMENTED** | `default_is_postable` (a default, overridable per account — contract §14 rule 4) |
| Parent/child relationships | **IMPLEMENTED** | `parent_id` self-FK `RESTRICT`; child `level` = parent `level` + 1; child code must extend the parent code by exactly the level's digit length (§9.3), validated on create and move |
| Depth limits | **IMPLEMENTED** | per-version `max_depth` + the code-constant cap of 8 |
| Version pinning | **IMPLEMENTED** | `accounts.coding_structure_version_id` and `accounts.accounting_configuration_id`, both NOT NULL; a new version never reinterprets existing accounts (§9.4) |
| Pin coherence | **IMPLEMENTED (new writes only)** | ODR-1 `planPinCoherence`, applied in service and re-applied inside the locked transaction; existing divergent rows are **not** repaired (OQ-62/OQ-63 OPEN) |
| Chart Tree read surface | **IMPLEMENTED** | ODR-2 `GET /api/v1/accounting/chart-tree` and `/:id` |
| **Vardena base/standard chart content** | **OWNER-DECIDED / NOT IMPLEMENTED** | Q2 + ADR-0037 §3; contract §1.2 non-goal 1; no seed script, no template artifact, no adoption endpoint |

**A3 — classification of Domain A parts.**

```text
IMPLEMENTED                     : configurable depth/ordering/titles/digit lengths/level kind,
                                  parent-child rules, depth caps, version pinning,
                                  ODR-1 coherence (new writes), ODR-2 chart tree read
IMPLEMENTED-PARTIAL             : pin coherence (writes guarded; pre-existing divergent rows unrepaired)
OWNER-DECIDED / NOT IMPLEMENTED : the Vardena base structure itself (Q2, ADR-0037 §3, D-5)
ADR-PROPOSED                    : ADR-0037 (configuration boundary) — Proposed
OPEN QUESTION                   : base-structure content, level/digit defaults, per-level posting
                                  policy (OQ-25); pin repair/legacy shape (OQ-62/OQ-63)
UNKNOWN                         : none in this domain — every question above resolved to one of
                                  the categories from repository evidence
```

### 4.2 Owner Decisions

**A4 — what "Vardena provides a base structure and the organization configures
it" actually means from repository evidence.**

The decision is **Q2** (`owner-decision-baseline.md` §2), elaborated by
**ADR-0037 §2/§3** (Proposed). From those sources, and from nothing else:

- Vardena owns accounting/control **semantics** — invariants, control roles,
  level mechanics, the shape of posting rules, reporting sources (ADR-0037 §2).
- The organization owns its **account structure** — levels, titles, digit
  lengths, accounts, role mappings — as versioned configuration data inside the
  supported model (ADR-0037 §2).
- The base structure must ship as **versioned configuration data or a template
  artifact** — explicitly **never** as per-customer code branches, **never** as
  hard-coded account rows in domain logic, and **never** as a seed that silently
  creates accounts in an existing organization (ADR-0037 §3).
- Its **content** — codes, Persian titles, level shape, role mappings — is
  **EXPERT-GATED under OQ-25** and is *not* decided (ADR-0037 §3; baseline D-5).

*Therefore:* "base structure" is currently a **delivery-shape commitment with no
content**. Nothing in the repository states which accounts, codes, titles, levels
or natures a Vardena base chart contains, and contract §1.2 non-goal 1 explicitly
refuses to define them. **The actual content of the Vardena base structure has
not been decided** → recorded as Owner Decision candidate **OD-20-1** (§13). This
investigation invents no part of it.

### 4.3 ADRs

| ADR | Status | Relevance to Domain A |
|---|---|---|
| **ADR-0037** | **Proposed** | §1 bounded configurable level count; §2 hybrid model; §3 base structure exists as a commitment, content expert-gated; §8 configuration may not violate invariants |
| ADR-0028 | Proposed (pre-existing) | Versioned configuration, single ACTIVE, operational freeze — the mechanism a base chart must respect |
| ADR-0035 | Proposed | Any later **re-coding** of an adopted chart is migration-service territory, not base-chart territory |
| ADR-0033 | Proposed | `Account.id` permanence — a base chart must not make a base code an identity |

No ADR is promoted, amended or created by this task.

### 4.4 Gaps

**A5 — would creating a standard/base chart conflict with existing invariants?**
Evaluated one by one; each row is an architectural consequence derived from cited
repository evidence, not a generic ERP assumption:

| Against | Conflict? | Reasoning and evidence |
|---|---|---|
| `Account.id` permanent identity | **No conflict, with one constraint** | Adopted accounts get their own organization-scoped ULIDs. The *template* node id must never leak into ledger references; ledger rows reference `account_id` only (`LedgerEntry`, ADR-0031 §2). Constraint: a template identifier, if kept, is provenance metadata — never an accounting identity (ADR-0033 §1). |
| Code semantics | **No conflict, with one constraint** | Codes are digits-only, unique per organization and composed from the pinned structure (§9.2/§9.3). A base chart's codes must be valid under the organization's chosen digit lengths; a base chart therefore cannot be shape-agnostic — it is bound to a level shape or must be parameterized by one. |
| Configuration pin coherence (ODR-1) | **Constraint — T20-T19-DEP-1** | Adoption must produce/consume a coherent `(coding_structure_version, accounting_configuration)` pair, or writes are rejected by `planPinCoherence`. |
| POSTING / AGGREGATION | **Constraint** | A base chart must not mark a node `is_postable = true` and then give it children: `planPostabilityChange` and the `parent_postable` placement rule refuse both directions (`accounting/domain/account.ts`). Postability in a base chart must be assigned leaf-last or derived from `default_is_postable`. |
| Organization isolation | **No conflict, with one constraint** | Adoption is an organization-scoped write and must pass the ODR-3 chokepoint (T20-T19-DEP-2). A global template table would be deployment-level, not organization-level, data — a new ownership question (part of **OD-20-1**). |
| Task 19 Chart Tree (ODR-2) | **No conflict** | The tree surface reads whatever accounts exist; adopted accounts appear automatically with no surface change. |
| Existing Account model | **No conflict for the accounts themselves** | Adoption creates ordinary `accounts` rows. *Provenance* (which template version produced this account) has **no column today** and AR-29 forbids adding one before a consumer exists. Whether provenance is required is part of **OD-20-1**. |
| Operational freeze (Task 13) | **Constraint** | A configuration marked `operationally_used_at` is never mutated in place (ADR-0028 §3). Adoption into an organization that has already posted must therefore create accounts, never rewrite the frozen configuration. |

No **contradiction** was found in Domain A. Every item above is a constraint or a
gap.

**A6 — the minimum future data model (documented, NOT implemented).** *Agent
inference, derived from the repository's own patterns (versioned configuration
per ADR-0028, typed rows per AR-29, no EAV/JSONB per ADR-0037 §7) — this is a
sketch for an Owner decision, not a design authorization:*

```text
Base chart template (Vardena-owned, deployment-level, versioned)
  template_version      : id, code, version_number, status(draft|active|superseded),
                          level_shape reference or parameterization, audit
  template_level        : template_version_id, level_index, title, digit_length,
                          default_is_postable, level_kind?
  template_node         : template_version_id, node_key, parent_node_key?, level,
                          code_segment, title(fa), account_nature, is_postable
  template_role_mapping : template_version_id, node_key, control_role   (Domain B — only if
                          control roles exist; otherwise omitted entirely)

Adoption (organization-scoped, audited, permission-gated, ODR-3 bound)
  adoption_record       : organization_id, template_version_id, adopted_at, actor,
                          resulting coding_structure_version_id + accounting_configuration_id
  (optional) accounts.template_node_key — provenance; ONLY if OD-20-1 decides provenance
                          is required, because AR-29 forbids a speculative column
```

Minimum invariants such a model must satisfy, all derived from existing rules:
adoption never mutates an existing chart (ADR-0037 §3); adoption produces a
coherent pin pair (ODR-1); no adopted node is postable-with-children (§14 rule 2);
adoption is refused or scoped explicitly when the target configuration is
operationally frozen (ADR-0028 §3); re-coding an adopted chart later is ADR-0035
territory, not adoption.

### 4.5 Risks

| Risk | Consequence | Mitigation recorded |
|---|---|---|
| Inventing base chart content | Violates AG-09/AR-31 and OQ-25's expert gate; ships an accounting opinion as product | Content stays with **OD-20-1**; nothing invented here |
| Base chart shipped as a Prisma seed | Contradicts ADR-0037 §3 ("never a seed that silently creates accounts in an existing organization") and there is no seed infrastructure today | Delivery shape is an explicit option in **OD-20-1** |
| Base chart bound to one level shape | An organization that configures a different digit shape cannot adopt it; ODR-1 rejects incoherent pins | Parameterization vs fixed shape is an explicit option in **OD-20-1** |
| Adding an `accounts` provenance column speculatively | AR-29 violation (no speculative columns before a consumer) | Provenance made an explicit sub-question of **OD-20-1** |

---

## 5. Control Roles (Domain B)

### 5.1 Current Implementation

**B1 — does any `control_role` model/field/table/service exist?**
**No.** *Verified implementation:* zero occurrences in `prisma/schema/*.prisma`
and zero production identifiers in `src/`. The only references are deferral
comments: `prisma/schema/accounting.prisma` header ("`control_role` (§8.7) and
coding-structure `reserved_ranges` (§9.1): both are posting-rule inputs whose
purpose vocabulary is OQ-25 → deferred with the posting task that consumes
them"). Classification: **OWNER-DECIDED / NOT IMPLEMENTED**.

**B2 — does any current code map standard business roles to Accounts?**
**No.** Posting (`accounting/application/posting.service.ts`,
`accounting/domain/posting.ts`) resolves accounts by `account_id` supplied on
document lines; posting readiness (`accounting/domain/posting-readiness.ts`)
checks existence/activity/postability and never a role. There is no
Inventory→Accounting posting rule (task-index §4: "Posting rules / account
mapping" is a Candidate blocked by OQ-24/OQ-25/OQ-30; contract §20.4 activation
gate). No report, DTO or permission names a role.

### 5.2 Owner Decisions

**B3 — which control roles are explicitly Owner-decided?**
**None individually.** What is decided is the *mechanism*:

- **Q4 / ADR-0037 §4:** the role vocabulary is **Vardena-standardized and
  code-defined** (adding a role is a code change, the ADR-0023 §2 pattern);
  organizations map **their own accounts** to those roles once, as
  **effective-dated, permission-gated, audited configuration**; posting rules and
  statutory profiles reference **roles, never free customer codes**.
- **Q4 / ADR-0037 §5:** mandatory-ness is **demand-driven** — a role becomes
  required when a shipped operation consumes it, not because a fixed list says so.

The *catalog* is explicitly not decided. Contract §8.7 lists `receivable`,
`payable`, `inventory`, `cogs`, `revenue`, `tax_payable`, `cash`, `bank`,
`opening_equity`, `retained_earnings`, `closing_clearing` and then states they are
**"placeholders from `accounting-domain-analysis.md` §2, not a decision"**, with
"the role list itself and which roles are mandatory are expert-gated" (OQ-25).
The example roles named in the Task 20 brief (Receivable, Payable, Cash, Bank,
Inventory, Sales, Expense) are therefore **not approved** by any repository
source, and this investigation does not approve them.

**B4 — mandatory / optional / conditionally required.**
Repository answer (ADR-0037 §5 + Q4): the only decided classification rule is
*conditional on an active operation*. There is **no** repository source declaring
any specific role mandatory, optional or conditional. Producing such a table here
would be invention (AG-09).

**B5 — architectural implications of "standard control roles mapped to
organization accounts; only active-operation-needed roles mandatory".** Derived
strictly from ADR-0037 §4/§5, contract §8.7 and AR-29:

1. **Consumer-first ordering.** Because a role becomes mandatory only when a
   shipped operation consumes it, and because AR-29 forbids speculative columns
   before a consuming operation exists, the repository's own rules imply the first
   role set should arrive **with** its first consumer (a posting rule, a
   year-transition document, or a control report) rather than as a standalone
   catalog. *This is the ordering question put to the Owner as **OD-20-2**; the
   inference is labelled, not asserted as a decision.*
2. **Two artifacts, not one.** A *role* (code-defined vocabulary) and a *mapping*
   (organization data: role → account, effective-dated, audited) are different
   artifacts with different lifecycles and different change-control (code change
   vs configuration change).
3. **Validation surface.** "Mandatory when consumed" means the mandatory check
   belongs to the **consuming operation's readiness/validation path**, not to
   account administration — otherwise creating a chart would fail for roles no
   shipped operation uses.
4. **Mapping targets must be postable.** *Agent inference:* a role used by an
   automated posting rule must resolve to an account a line may reference, and
   contract §14 rule 1 restricts lines to postable, active accounts. Whether a
   role may map to an AGGREGATION node for reporting-only purposes is undecided
   and belongs to **OD-20-3/OD-20-4**.
5. **Immutability interaction.** `is_postable` and structure are immutable after
   use (§8.4 rule 4); remapping a role after postings exist changes *future*
   behaviour only and must never rewrite history — effective dating (§8.7 "D-21")
   is the recorded mechanism for that.

**B6 — where should role mapping live?** Candidates derived from repository
architecture only:

| Candidate | Repository support | Tension |
|---|---|---|
| **Nullable `accounts.control_role` column** | Contract §8.3 lists `control_role` as a conceptual *account attribute* ("nullable, closed code-defined list") | Cannot express effective dating or a one-role-many-accounts / one-account-many-roles relationship; AR-29 blocks adding it before a consumer |
| **Separate effective-dated mapping relation** | Contract §8.7 + ADR-0037 §4: "a role mapping is configuration data with its own permission, audit trail and effective dating" | No table exists; ownership (accounting configuration version vs standalone) undecided |
| **Attribute of the accounting configuration version** | ADR-0028 versioning + operational freeze already model organization configuration | Freeze semantics would make remapping after first use impossible without a new version — may or may not be desired |
| **Another bounded model (e.g. owned by the consuming operation)** | AR-29 consumer-first posture | No consumer exists yet |

**Escalated ambiguity — T20-C-1 (CONTRADICTION, documentation level).** Contract
§8.3 describes `control_role` as a **nullable column on the account**, while
§8.7 and ADR-0037 §4 describe a role mapping as **effective-dated configuration
data with its own permission and audit trail**. A single nullable column cannot
carry effective dating or an audit trail, so the two descriptions cannot both be
literally implemented by the same artifact. This is **not resolved here**; it is
put to the Owner as **OD-20-4** and will require either an ADR-0037 amendment or
a contract precision before implementation.

### 5.3 Cross-module dependencies

**B7 — interaction check (documentation only; no integration designed here).**

| Module | State at baseline | Interaction with control roles |
|---|---|---|
| **Inventory** | Implemented (ledger, master data); Inventory→Accounting integration is a **Candidate blocked by OQ-24/OQ-25/OQ-30/OQ-39** (task-index §4; contract §20, activation gate §20.4) | The canonical first consumer named by the repository: automated inventory postings must resolve accounts by role, never by customer code (contract §8.7, D-12) |
| **Documents** | Implemented (Document Foundation, ADR-0019/0023); accounting vouchers use it | No role interaction today; document *types* are the ADR-0023 §2 code-defined precedent ADR-0037 §4 points at for role vocabulary |
| **Accounting Posting** | Implemented (`PostingService`, `finalizeChecked`) | Posting resolves `account_id` from lines; role resolution would be an input to a *posting rule*, upstream of posting, never inside ledger materialization |
| **Future Treasury / Cash Book / Bank Book** | Does not exist | Out of scope (§19 of the brief); would be a future consumer of cash/bank-type roles if the Owner defines them |
| **Future AR / AP** | Does not exist | Would be a future consumer of receivable/payable-type roles; subledger/reconciliation-account role is listed as a *reserved, deferred* seam in contract §8.3 |
| **Future Sales / Purchase** | Does not exist | Same pattern; no repository commitment |
| **Legal Adapter / Legal Profile** | Does not exist; ADR-0036 Proposed | ADR-0037 §4: statutory profiles reference **roles**, never free customer codes — so the role catalog is upstream of any legal book work (OQ-43) |

### 5.4 Gaps

```text
OWNER-DECIDED / NOT IMPLEMENTED : role vocabulary is code-defined (ADR-0037 §4);
                                  mapping is effective-dated configuration (§8.7);
                                  mandatory-ness is demand-driven (ADR-0037 §5)
OPEN QUESTION                   : the role catalog itself, the mandatory set,
                                  and whether a role may target a non-postable node (OQ-25)
CONTRADICTION                   : T20-C-1 — §8.3 column vs §8.7 effective-dated mapping
ADR-PROPOSED                    : ADR-0037 (§4/§5) — Proposed, not Accepted
```

### 5.5 Risks

| Risk | Consequence |
|---|---|
| Adopting the §8.7 example list as the catalog | Ships an unvalidated accounting opinion; contract explicitly calls them placeholders (AG-09 violation) |
| Building the role table before a consumer | AR-29 speculative-schema violation; a role set with no consumer cannot be validated and cannot be "mandatory when consumed" |
| Resolving T20-C-1 silently by picking a shape | AG-17 violation; would pre-empt an ADR-0037 amendment |
| Letting an integration hard-code account codes while roles are pending | Exactly the failure mode D-12/§8.7 exists to prevent; recorded as a review rule for any future integration task |

---

## 6. POSTING vs AGGREGATION (Domain C)

### 6.1 Current invariant

**C1 — the exact current invariant.** *Verified implementation*, three
cooperating rules:

1. **`is_postable` is a validated stored account attribute**, never inferred from
   a level name or a code prefix (`accounts.is_postable`; contract §14 rule 1).
2. **`postable ⇒ leaf`, enforced in both directions:**
   - `planPostabilityChange({isPostable, hasChildren})` returns
     `'postable_with_children'` — setting `is_postable = true` on an account with
     children is refused (`accounting/domain/account.ts` ~line 520);
   - the placement check returns `'parent_postable'` — creating the first child of
     a postable account is refused (`accounting/domain/account.ts` ~line 270,
     message at ~line 491: *"A postable account cannot have children: posting to
     both a parent and its children would double-count its rollup"*).
   Both are re-applied inside the locked repository transaction
   (`accounting/data/accounts.repository.ts`).
3. **Postability is immutable after use** — changing `is_postable` on an account
   with lines is refused (§8.4 rule 4 / §14 rule 5), so a historical rollup cannot
   silently change meaning.

A leaf may still be non-postable (§14 rule 3): the rule is `postable ⇒ leaf`, not
`postable ⇔ leaf`.

### 6.2 Current implementation of the semantic role

**C2 — can an account currently be both POSTING and AGGREGATION?** **No.**
The role is derived, total and mutually exclusive: `is_postable = true` ⇒ POSTING
(and, by rule 2, childless), `false` ⇒ AGGREGATION. Task 18 makes this explicit
in the read model: `accounting/data/accounting-read-query.repository.ts` emits
`CASE WHEN "isPostable" THEN 'POSTING' ELSE 'AGGREGATION' END AS "role"` and
`accounting/domain/trial-balance.ts` types it as
`role: 'POSTING' | 'AGGREGATION'`. Invariant **I-2 holds today** — by a stricter
rule than I-2 itself requires (`owner-decision-baseline.md` §3 I-2 repository
status; ADR-0034 §6).

### 6.3 Future Owner decision

**C3 — what does the Owner decision actually say about posting at a
higher/non-leaf level?** Q5 (`owner-decision-baseline.md` §2) says: the last
configured level is postable **by default**; **configuration may allow posting at
another level**; posting must preserve integrity and must not create parent/child
double counting; and it must be reconciled with Invariant 2.

ADR-0034 (Proposed) §3 permits a non-leaf POSTING node **only together with** §4
(separated own vs descendant measures) and §5 (explicit validation rules), and §6
states plainly: the conflict with AC-D-19 rule 2 / AC-I-09 is **recorded, not
resolved**; today's rule **stays in force**; enabling non-leaf posting requires
**superseding** contract §14 rule 2 and AC-I-09 and **amending** §8.5, via an
accepted ADR amendment plus its own implementation task.

**Therefore the Owner decision authorizes a *model*, not an implementation.**
Task 20 confirms discrepancy **D-1** is unchanged after Task 19 and neither
relaxes nor strengthens `postable ⇒ leaf`.

### 6.4 Reporting implications

**C4 — what would change if non-leaf posting were eventually supported.**
*Verified implementation evidence, followed by consequences:*

The Task 18 roll-up is a recursive mapping, not a filtered sum
(`accounting/data/accounting-read-query.repository.ts`, TB query and its twin
count query):

```sql
posting_accounts AS (SELECT "id" FROM scoped_accounts WHERE "is_postable" = true),
account_rollup AS (
  SELECT p."id" AS posting_account_id, p."id" AS report_account_id FROM posting_accounts p
  UNION ALL
  SELECT ar.posting_account_id, parent."id"
    FROM account_rollup ar JOIN scoped_accounts current_node ON …
    JOIN scoped_accounts parent ON parent."id" = current_node."parent_id"
),
trial_rows AS (SELECT ar.report_account_id …, SUM(activity.*) … GROUP BY ar.report_account_id, …)
```

Each posting account contributes to **itself and to every ancestor**, and every
`report_account_id` becomes **one row with one undifferentiated set of measures**.

| Affected area | Consequence of relaxing `postable ⇒ leaf` without ADR-0034 §4 |
|---|---|
| Parent/child hierarchy | A node would be simultaneously a posting destination and the parent of posting destinations — the exact shape I-2 forbids |
| **Trial Balance** | A non-leaf POSTING node appears once as `posting_account_id = report_account_id` (its own postings) **and** receives all descendants' activity through the recursive branch; the `SUM … GROUP BY report_account_id` merges them into a single row labelled `POSTING`. **Own postings and descendant rollup become indistinguishable — double counting against any consumer that also reads the children's rows.** |
| **General Ledger** | The same `posting_accounts` / `account_rollup` construction is used, so the same merge occurs on the GL surface |
| **Account Statement** | `AccountStatementsService` refuses non-postable accounts and reads that account's **own** ledger rows only (service lines 130–135). A non-leaf POSTING node would therefore report **own-only** on the statement while the Trial Balance reports **own + descendants** for the same account — two different numbers for one account across two accepted surfaces, with no disclosure |
| Aggregation semantics | Contract §8.5's "a non-postable account's movement is the rollup of its descendants" becomes incomplete: it defines no measure for a *postable* account that also has descendants |
| Posting validation | `planPostabilityChange` and the `parent_postable` placement rule would both need a replacement rule set (ADR-0034 §5: which transitions, when, and what happens to descendants) |
| Balance projection | The projection key is `(organization, area, year, period, account)` (ADR-0031; `accounting/domain/balance-projection.ts`) and stores per-account own activity; it does not encode own-vs-descendant, so a rollup consumer of the projection inherits the same ambiguity |
| Reporting read models | Every rollup surface would have to declare its inclusion rule ("own", "descendants", or "own + descendants, declared") per ADR-0034 §4/§7 |

**C5 — can non-leaf posting be introduced without violating POSTING XOR
AGGREGATION?** *Yes in principle, and only under ADR-0034's own conditions.*
I-2 forbids a node being *simultaneously* an aggregation of its children **and**
an independent posting destination whose postings fold into that same
aggregation. If the read model keeps **own postings** and **descendant rollup**
separately addressable and every total declares which it is (ADR-0034 §4), the
node has one semantic role at a time in each reported measure and I-2 is not
violated. Without that separation, relaxation violates I-2 immediately.

**C6 — minimum architecture required before such a feature could ever be
implemented** (recorded, not authorized; from ADR-0034 §4/§5/§6 + the code
evidence above):

1. An **accepted ADR amendment** superseding contract §14 rule 2 (AC-D-19) and
   AC-I-09 and amending §8.5 — ADR-0034 is only **Proposed**.
2. An **explicit stored role attribute** (or a documented mapping from
   `is_postable`) so the role is not inferred from the presence of children.
3. **Separated own-vs-descendant measures** in every rollup read model — at
   minimum the TB and GL CTEs above, plus a decision for the Account Statement's
   own-only semantics and for the balance projection.
4. **Explicit validation rules**: which role transitions are allowed and when
   (before/after first use, §8.4 rule 4), and what happens to descendants when a
   parent becomes POSTING.
5. **Report disclosure** of the inclusion rule on every affected surface.
6. **Denial-path tests** (AG-06/AG-13) for every refused transition, plus
   regression tests proving no double counting.
7. A **policy answer** for which levels a business may post to (OQ-25, O-3).

**Contradiction status.** No *code-level* contradiction exists: the implementation
is internally consistent and strictly stronger than I-2. The contradiction is
documentation-level and already registered as **D-1** (Q5 "may allow posting at
another level" vs AC-D-19/AC-I-09). Task 20 confirms it is unchanged and
escalates it as **OD-20-5**.

### 6.5 Risks

| Risk | Consequence |
|---|---|
| Relaxing `postable ⇒ leaf` as "just a validation change" | Silent double counting in two accepted read surfaces (TB, GL) and a silent own-vs-rollup divergence with the Account Statement |
| Treating Q5 as authorization | ADR-0034 §6 explicitly keeps AC-D-19/AC-I-09 in force; acting on Q5 alone would bypass the ADR lifecycle |
| Adding a role column "for later" | AR-29 speculative schema; also risks two sources of truth with `is_postable` |

---

## 7. Account Code History (Domain D)

### 7.1 Current implementation

| Question | Answer | Evidence |
|---|---|---|
| **D1** — does an `AccountCodeHistory` model exist? | **No.** | No model in `prisma/schema/accounting.prisma`; no migration under `prisma/migrations/`; no domain/service file |
| **D2** — does the repository preserve historical codes? | **No — and it does not need to today.** | One code per account, immutable; no historical row anywhere stores a code (`LedgerEntry`, `AccountingDocumentLine`, `AccountBalanceProjection` all key on `account_id`) |
| **D3** — can an Account's code currently change? | **No.** | `accounting/domain/account.ts`: "There is therefore NO code field on the update path"; `UpdateAccountDto` has no `code`; `PATCH /api/v1/accounting/accounts/:id` documents "The code is immutable"; contract §8.3 |
| **D4** — how are historical reports expected to resolve `Account.id` + date → historically valid code? | **Decided as a rule, not implemented.** | `owner-decision-baseline.md` §4: `Report Date → Account.id → Historical Code Resolution → Report`; Q18 (Decision D); ADR-0033 §4. Today every read surface renders the **current** code (`a."code"` in the Task 18 SQL; `accountCode` in TB/GL/statement rows), which is *vacuously* correct because a code never changes |

Classification: **OWNER-DECIDED / NOT IMPLEMENTED** (baseline discrepancy **D-3**).

### 7.2 ADR-0033

**Status: Proposed.** Alignment with the implementation:

| ADR-0033 clause | Implementation alignment |
|---|---|
| §1 `Account.id` is the permanent identity | **IMPLEMENTED** — document lines, ledger rows, projection key, opening logic all resolve by id |
| §2 `code` is a business/display identifier, never a semantic source | **IMPLEMENTED** — the tree comes from `parent_id`; the code prefix is only its proof (§9.3); no classification is inferred from a code range |
| §3 a code is a time-scoped fact; retain every code with its validity | **NOT IMPLEMENTED** |
| §4 historical resolution rule (as-at code, with current-code mapping available) | **NOT IMPLEMENTED** |
| §5 opening identity keys on `Account.id` | **IMPLEMENTED** (ADR-0031 §4; Task 17B D2) |
| §6 pre-use code change permitted in principle | **NOT IMPLEMENTED — repository is stricter** (baseline D-2) |
| §7 deletion vs deactivation | **PARTIALLY IMPLEMENTED — repository is stricter**: freeze-over-delete for every account, no delete endpoint, no `Accounting.Account.Delete` (baseline D-4) |
| §8 integrations reference accounts by id | **No integration exists** to violate it |

### 7.3 Historical reporting implications

**D5 — interactions.**

| Surface | Interaction | Consequence of adding code history |
|---|---|---|
| Ledger history | Stores `account_id`, `document_date`, `posting_timestamp`, resolved `fiscal_year_id` / `accounting_period_id`; **no code** | History is purely **additive**; no ledger row is touched (Invariant I-3 already structurally protected: the ledger repository is insert-only) |
| Trial Balance | Joins `accounts` for `a."code"`/`a."title"` | Becomes an as-at resolution site; also a *sorting* site — TB sorts by `accountCode`, so as-at codes change ordering. Requires an explicit decision, not a silent switch |
| General Ledger | Same join | Same |
| Account Statement | Echoes the account's code in the scope/rows | Same |
| Chart Tree (ODR-2) | Fixed `code ASC` order is part of the contract | *Agent inference:* the chart tree is a **current-structure** surface; as-at rendering there would change an accepted ordering contract. Whether the chart tree ever becomes as-at is undecided |
| Legal Adapter / Legal Profile | Does not exist; ADR-0036 §5 forbids using `Account.code` as permanent identity | A profile must consume the resolution seam, never cache a code as a key |
| Future code migration (ADR-0035) | §4: a migration preserves `Account.id` and changes only the code representation/**history** | **Code history is a hard prerequisite of the migration service**, not an optional companion |

**D6 — where should code history live?** Options derived from repository
evidence only:

| Option | Repository support | Problem |
|---|---|---|
| Additional columns on `Account` (e.g. `previous_code`) | none | Cannot represent n codes with validity; ADR-0033 §3 requires *every* code with its validity |
| **Separate historical relation** (account_id, code, valid-from/valid-to or fiscal-year scope, audit) | ADR-0033 §3's wording ("retain every code an account has carried with its validity"); the repository's typed-table posture (AR-29, no EAV/JSONB) | Validity granularity (date range vs fiscal-year vs configuration version) is **undecided**; interaction with `uq_accounts_organization_id_code` and the never-reuse rule is **explicitly not decided** (ADR-0033 Consequences; baseline O-1; OQ-25/OQ-36) |
| Derive from an audit/event log | Audit module is referenced by ADR-0035 §7 but persistent audit storage is "the Audit module's concern" and no such reporting-grade query surface exists | Not queryable as an as-at resolution source today |

No option is chosen here.

**D7 — prerequisites for a future Account Code History implementation**
(assembled from ADR-0033, ADR-0035, OQ-25, OQ-36, OQ-62/OQ-63, and OQ-52/OQ-53
via ADR-0035 §3):

1. **A producer must exist.** *Verified implementation:* no code can change today.
   A history store shipped now would contain exactly one row per account
   permanently. The producer is either (a) the pre-use code edit (baseline D-2,
   ADR-0033 §6 — not implemented, not authorized) or (b) the Code Structure
   Migration Service (ADR-0035 — not implemented, not authorized, and itself
   blocked by ADR-0030/OQ-45 licensing and OQ-52/OQ-53 backup/restore).
2. **ADR-0033 resolved through the repository's ADR lifecycle** (currently
   Proposed).
3. **A decision on whether a pre-use code edit writes history** — ADR-0033 §3
   leaves this open explicitly.
4. **A decision on code reuse of a superseded code** and on how history coexists
   with `uq_accounts_organization_id_code` and the never-reuse rule — baseline
   **O-1**, governed by **OQ-25/OQ-36**, both OPEN.
5. **A decision on which read surfaces resolve as-at, and their default** —
   changing TB/GL/statement rendering or ordering is a public behaviour change to
   accepted Task 17B/18 surfaces and needs its own Owner decision.
6. **OQ-62/OQ-63 posture** — ADR-0035 §2 requires preflight to detect pin
   divergence; both remain OPEN after Task 19 (which guards new writes only).
7. **OQ-52/OQ-53** are relevant only through the migration service (ADR-0035
   §3's Recovery/Backup Point stage), not to a history store itself.

*OQ-52/OQ-53 relevance check:* relevant **indirectly** (migration-service
dependency), not as a direct prerequisite of a code-history table.

### 7.4 ADR-0035 dependency

ADR-0035 (Proposed) is the **only sanctioned path** for a post-use code change
(§1), binds an 11-stage pipeline (§2), forbids rewriting economic ledger history
(§4), rebuilds rather than edits derived data (§5), makes reconciliation a gate
(§6), and **excludes level-count migration** (§8, Q20). It records its own
unresolved dependencies: ADR-0033 §3 (code history), ADR-0030/OQ-45 (licensing —
no `license` schema/module exists, enforcement OFF), OQ-52/OQ-53, OQ-62/OQ-63,
and the Audit module.

**Net:** ADR-0035 depends on code history, and code history's only durable
producer is ADR-0035. The Owner must break the ordering explicitly →
**OD-20-4** (§13).

### 7.5 Risks

| Risk | Consequence |
|---|---|
| Shipping a history table with no producer | Speculative schema (AR-29); an unexercised, untestable store; false impression that Q18 is satisfied |
| Switching read surfaces to as-at rendering silently | Changes accepted Task 17B/18 output and TB ordering without an Owner decision |
| Treating `code` as a join/cache key anywhere | ADR-0033 Consequences: "caching 'the account code' as a key becomes a defect" |
| Deciding code reuse implicitly through a unique-index choice | Pre-empts OQ-25/OQ-36 (baseline O-1) |

---

## 8. Detail / Floating Detail / Dimensions (Domain E)

### 8.1 Current implementation

**E1 — what exists today.**

| Concept | State | Evidence |
|---|---|---|
| Detail dimensions | **NOT IMPLEMENTED** | No `accounting_detail_dimensions` / `_groups` / `_items` / line-assignment table in `prisma/schema/accounting.prisma`; no migration |
| Account ↔ dimension links | **NOT IMPLEMENTED** | none |
| Management fields on accounts | **NOT IMPLEMENTED** | `Account` carries no analytical column |
| Cost centres | **NOT IMPLEMENTED** | no model anywhere in `prisma/schema/*.prisma` |
| Projects | **NOT IMPLEMENTED** | no model anywhere |
| Branches | **IMPLEMENTED as Organization master data** (`organization.prisma` `model Branch`) and, per contract §12.4, a **document-header scope column** — *not* an accounting dimension | `owner-decision-baseline.md`; OQ-22/OQ-55 posture: "Branch is an operational scope dimension only … no ledger presence until decided" |
| Detail entities / floating details | **NOT IMPLEMENTED** | contract §11 is contract-only (AC-D-15) |
| Ledger dimension seam | **SEAM ONLY** | `accounting/domain/ledger-entry.ts` defines an optional `LedgerDimensionAssignment` type and `dimensionAssignments` on the entry input; `accounting/data/ledger-entries.repository.ts` lines 240–242 materialize it as `[]` with the comment "OQ-41 is unresolved: no dimension model exists" |
| Balance projection | **Deliberately dimension-free** | `accounting/domain/balance-projection.ts` line 15: "Branch, currency, detail dimensions are NOT part of the base key"; line 243: "already excludes dimensions / branch by construction" |

**E2 — generic EAV / giant JSONB / universal dimension table?** **None exists.**
*Verified by inspection:* `prisma/schema/accounting.prisma` contains no
JSON/JSONB column for dimensions and no polymorphic attribute-value table. This
is consistent with ADR-0037 §7, contract §10.6 and
`configurability-architecture.md` §5.2, all of which forbid both shapes. **Recorded
as a fact:** the repository has neither an EAV, nor a giant JSONB dimension blob,
nor a universal dimension table.

### 8.2 Owner decisions

- **Q6:** Vardena must support **both** tree-based Detail Accounts **and**
  Floating Detail Accounts; exact usage configurable (contract §11.2 AC-D-15:
  "the contract does not force an organization to choose"). **Mechanism
  CONFIRMED, implementation GAP** (baseline D-12).
- **Q7:** a configurable **general dimension model** (cost centre, project,
  branch, counterparty, …) with a configured count under a code-defined cap,
  typed item tables, optional logical master-data binding, and a per-(account,
  dimension) `requirement ∈ required | optional | forbidden`; **never** a giant
  EAV and **never** a giant JSONB for ledger dimensions (ADR-0037 §7;
  AC-D-11…AC-D-14, AC-I-18).
- The examples named in the brief (Cost Center, Project, Branch) are **uses** of
  dimensions, explicitly *not* a finalized list: contract §11.3 states "Cost
  centre and project are **uses** of dimensions. Whether they exist as master
  data in Vardena, and whether they must be bound, is EXPERT-GATED (OQ-41, and
  OQ-22 for departments as dimensions)."

### 8.3 Domain ownership

**E3 — conceptual difference between account hierarchy and management
dimensions, from repository evidence** (contract §10.1, §11.1–§11.3):

| | Account hierarchy | Management dimension |
|---|---|---|
| Location | Nodes of the `accounts` tree | Outside the tree |
| Identity/code | Part of the account code, prefix-constrained by the parent (§9.3) | Its own code inside its dimension (§10.2) |
| Nature | Each account has `account_nature` | A floating detail has **no nature of its own**; it takes the side of the line it appears on (§11.1 rule 3) |
| Combination | One account per combination → code explosion (§11.2) | One item, reusable across any compatible account |
| Aggregation | Parent rollup via `parent_id` (§8.5) | `GROUP BY` over the typed assignment table (§10.7) |
| Posting relevance | A line references exactly one account | A line may carry ≤ 1 item per dimension, bounded by N (§10.6 rule 3/5) |

**E4 — where does Floating Detail belong?** Repository evidence, not generic ERP
knowledge: contract §11.1 rule 4 defines a floating detail as *"a row in
`accounting_detail_items` with FKs to its dimension (and optional parent item),
an optional master-data binding (§10.5), area applicability (§11.4) and
`is_active`"*. Contract §11.3 excludes it from being the Party, the Branch, the
Employee/Warehouse/Item, a cost centre/project by definition, or an EAV
attribute, and states that a binding "does not transfer ownership".

**Conclusion (repository-derived):** Floating Detail belongs to the
**Accounting-owned dimension model**, not to the Chart structure and not to
Party/master data; master data may be *bound* logically (module + type + ULID,
never a cross-module FK — §10.5, AR-07/AR-08). Nothing here is decided beyond
what the contract already states.

### 8.4 Data-model implications

**E5 — should dimensions affect …?** Only documented consequences; no decision:

| Surface | Repository-stated consequence |
|---|---|
| **Ledger entries** | The domain seam already exists (`dimensionAssignments`), currently always empty. Whether assignments are **persisted on the ledger row** or only on the document line is **not decided anywhere**: contract §10.6 specifies the *document-line* child table `accounting_document_line_details`; no ledger-side table is specified. *This is a real open data-model question* → **OD-20-6** |
| **Posting** | Validation at composition **and again at finalization** (§10.6 rules 1–5): only attached dimensions assignable, every `required` present, no `forbidden` present, ≤ 1 item per dimension per line, item active and area-applicable (AC-I-18) |
| **Reporting** | `GROUP BY` over the typed assignment table joined to lines/documents (§10.7) — detail ledger, dimension trial balance, counterparty statement, project cost report |
| **Trial Balance** | Account-keyed today. A "dimension trial balance" is named in §10.7 as a *future report*, and Task 18's TB has no dimension axis. Extending it is a new surface decision, not an automatic consequence |
| **Account Statement** | Account-keyed, one postable account (Task 17B D1). Dimension filtering/grouping would be an extension requiring its own decision |
| **Balance projection** | Explicitly excludes dimensions from the key by construction; dimension-level balances would require either ledger-native aggregation (the Task 18 D5 posture: `accounting.ledger_entries` is authoritative) or a **new projection key**, which is a schema + rebuild-semantics decision (ADR-0031 §6) |

### 8.5 Risks

| Risk | Consequence |
|---|---|
| Implementing dimensions before OQ-41 answers | Count, per-dimension requirement defaults, master-data binding rules, item governance and area applicability would all be invented (AG-09) |
| Reaching for JSONB or EAV under schedule pressure | Direct violation of ADR-0037 §7, contract §10.6 and `configurability-architecture.md` §5.2 |
| Adding a dimension axis to the balance projection without a rebuild story | Breaks ADR-0031's rebuildable-projection invariant and AC-I-19 reconciliation |
| Treating Branch as an accounting dimension | Contradicts OQ-22/OQ-55's recorded posture (branch is a scope dimension with no ledger presence until decided) and contract §12.4 (branch on the header, not the line) |

### 8.6 Open dimension decisions (E6)

OQ-41 (count; per-dimension requirement defaults; which dimensions must bind to
master data; who may define dimensions and items; item sharing across accounts of
different nature; per-area item scoping) · OQ-22 / OQ-55 (branch/department as
accounting dimensions) · and the **ledger-vs-line persistence question and
projection-key question** identified in §8.4, which no existing OQ states
explicitly → carried into **OD-20-6**.

---

## 9. Cross-Domain Invariants

| Invariant | Verdict | Evidence / qualification |
|---|---|---|
| **Identity** — `Account.id` is permanent identity | **HOLDS — IMPLEMENTED** | `LedgerEntry.accountId`, `AccountingDocumentLine.accountId`, `AccountBalanceProjection` key, opening logic; no historical row stores a code |
| **Historical code** — `code` is a business/display identifier with historical semantics | **PARTIAL** | "Business/display identifier, not identity" **holds**; "historical semantics" is **not implemented** (D-3). Vacuously satisfied today because a code can never change |
| **Posting** — POSTING XOR AGGREGATION | **HOLDS — by a stricter rule** | `postable ⇒ leaf` enforced on both write paths and re-checked in the locked transaction; TB/GL materialize the role explicitly. D-1 (Q5 vs AC-D-19) remains a recorded documentation conflict |
| **Configuration** — coding structure and accounting configuration must remain coherent | **HOLDS for new writes; PARTIAL overall** | ODR-1 `planPinCoherence` (level count + per-level digit length) applied at root create, child create and move, re-applied in the locked transaction. Pre-existing divergent rows are **not** repaired; **OQ-62/OQ-63 remain OPEN** |
| **Organization isolation** — permission ≠ organization membership; Principal-bound authorization intact | **HOLDS** | `organization_memberships` + `assertOrganizationInScope` chokepoint; 404 isolation preserved; membership administration bound after PR #55, with only the bounded first-grant bootstrap exception. Nothing in Task 20 touches it; OQ-01/OQ-22/OQ-19 remain OPEN |
| **Ledger** — ledger history is never rewritten by chart configuration changes | **HOLDS** | Ledger repository is insert-only; accounts pin their configuration version and a new version never reinterprets them (§9.4); `operationally_used_at` freezes a used configuration (Task 13); no code is stored on any historical row |
| **Reporting** — Task 18 surfaces consume Accounting truth and are not a second Account master | **HOLDS** | TB/GL/statement read `accounting.ledger_entries` and join `accounting.accounts`; the ODR-2 Chart Tree reuses `AccountsRepository`; no Reporting module, no duplicated account table, no `/api/v1/reports` |

---

## 10. OQ Impact

Only OQs actually relevant to Task 20 are listed. **No OQ is closed, narrowed or
reclassified by this task.**

| OQ | Current repository status | Why it matters to Task 20 | Can Task 20 proceed without closing it? | Required Owner decision |
|---|---|---|---|---|
| **OQ-25** | **OPEN** (annotated by Task 17C; unchanged by Task 19) | Gates base-chart content, the control-role list and mandatory set, per-level posting policy, deactivation guards and code-reuse policy — i.e. Domains A, B, C and D content | **Yes — the investigation proceeds; implementation cannot** | Yes — see OD-20-1, OD-20-2, OD-20-3, OD-20-5 |
| **OQ-41** | **OPEN** | Gates the entire dimension model (count, requirement defaults, binding, governance, area applicability) — Domain E | Yes for investigation; no for implementation | Yes — see OD-20-6 (bounded scope question only; content stays with OQ-41) |
| **OQ-36** | **OPEN** | Code reuse after deactivation and whether deletion is ever allowed — interacts with code history (baseline O-1) and Q21/D-4 | Yes | Folded into OD-20-4 as a dependency |
| **OQ-62** | **OPEN** (explicitly kept open by ODR-1) | Pre-existing divergent pins are unrepaired; a base-chart adoption or a migration preflight must handle them | Yes | No new decision proposed by Task 20 — the existing OQ owns it |
| **OQ-63** | **OPEN** | LEGACY fallback shape; same preflight concern | Yes | No new decision proposed |
| **OQ-01** | **OPEN** | Tenancy product question; ODR-3 decided the security invariant, not the product model | Yes — Task 20 introduces no tenancy change | No |
| **OQ-22** | **OPEN** | Branch as scope vs accounting dimension — directly relevant to Domain E's boundary | Yes | No new decision proposed; feeds OD-20-6 as a dependency |
| **OQ-19** | **OPEN** | Referenced by Task 19 for out-of-band bootstrap provisioning; relevant only because any future administration surface inherits the ODR-3 posture | Yes | No |
| **OQ-43** | **OPEN** (LEGAL VALIDATION REQUIRED) | Legal profiles consume control roles (ADR-0037 §4) and the code-resolution seam (ADR-0036 §5); otherwise out of Task 20 scope | Yes | No |
| **OQ-45 / OQ-52 / OQ-53** | **OPEN** | Reach Task 20 only through ADR-0035's licensing and Recovery/Backup-Point stages, i.e. as prerequisites of the code-migration producer for Domain D | Yes | No — recorded as dependencies of Future Slice C/E |

**OQ-52/OQ-53 relevance verdict:** relevant **indirectly only** (via ADR-0035
§3), not as direct Task 20 blockers. **OQ-62/OQ-63 relevance verdict:** relevant
to Domains A and D as preflight/adoption dependencies.

---

## 11. ADR Impact

**No ADR status is changed, promoted or self-accepted by this task.** All five
Accounting ADRs created by Task 17C remain **Proposed**, consistent with the
repository's recorded convention (`docs/tasks/task-19/task-19-acceptance-record.md`
§6: "Task acceptance is separate from ADR acceptance").

| ADR | Status | Implementation alignment | Dependencies | Adoption required before implementation? | Amendment required? |
|---|---|---|---|---|---|
| **ADR-0033** — Account identity & code history | **Proposed** | §1/§2/§5 **aligned and implemented**; §3/§4 **not implemented**; §6/§7 repository is **stricter** | ADR-0035 (the producer), OQ-25/OQ-36 (reuse), the read surfaces that would resolve as-at | **Yes** — a code-history schema task must not precede ADR resolution | **Not identified.** One item is *undecided inside* the ADR (whether a pre-use edit enters history, §3) — that is an Owner decision (OD-20-4), which may then need an ADR addendum |
| **ADR-0034** — POSTING XOR AGGREGATION | **Proposed** | §1/§2/§6 **aligned** (the shipped rule is stricter); §3/§4/§5 **not implemented** | Contract §14 rule 2 (AC-D-19), AC-I-09, §8.5; OQ-25 (policy content) | **Yes**, and more: ADR-0034 §6 itself requires an **accepted ADR amendment superseding AC-D-19/AC-I-09 and amending §8.5** before non-leaf posting may exist | **Yes, if and only if** the Owner chooses to enable non-leaf posting (OD-20-5). If the Owner keeps `postable ⇒ leaf`, ADR-0034 needs no amendment — only a recorded decision that §3 stays dormant |
| **ADR-0035** — Code structure migration | **Proposed** | Nothing implemented; Invariant I-3 already structurally protected | ADR-0033 §3, ADR-0030/OQ-45, OQ-52/OQ-53, OQ-62/OQ-63, Audit module | **Yes** | **Not identified** |
| **ADR-0037** — Configuration boundary | **Proposed** | §1/§2/§8 **mechanism implemented**; §3 (base structure) **not implemented**; §4/§5 (control roles) **not implemented**; §6/§7 (detail/dimensions) **not implemented** | OQ-25 (base content, roles), OQ-41 (dimensions), OQ-22/OQ-55 | **Yes** for any of §3–§7 | **Likely yes for §4** — the T20-C-1 shape ambiguity between contract §8.3 (`control_role` column) and §8.7/ADR-0037 §4 (effective-dated mapping) must be settled by an amendment or a contract precision (OD-20-3) |
| ADR-0036 — Legal reporting architecture | Proposed | Out of Task 20 scope except as a consumer of roles and the code seam | OQ-43 | n/a here | n/a here |

---

## 12. Implementation / Decision Drift Matrix

Classification vocabulary (exactly one per row): `IMPLEMENTED`,
`IMPLEMENTED-PARTIAL`, `OWNER-DECIDED / NOT IMPLEMENTED`, `ADR-PROPOSED`,
`OPEN QUESTION`, `CONTRADICTION`, `UNKNOWN`.

| # | Area | Owner Decision | ADR | Current Implementation | Drift | Risk | Required Action |
|---|---|---|---|---|---|---|---|
| 1 | Configurable level count / titles / digit lengths / level kind | Q1 | ADR-0037 §1 | `coding_structure_versions/_levels` + `accounting_configuration_levels`, caps 8 / 32 | **IMPLEMENTED** | Low | None |
| 2 | One-table chart, adjacency + level, code-prefix proof | AC-D-06/07 (contract) | — | `accounts` with `parent_id` + `level`; placement + code validation | **IMPLEMENTED** | Low | None |
| 3 | Version pinning; a new version never reinterprets existing accounts | Q8 | ADR-0028, ADR-0035 §9 | Both pins NOT NULL; §9.4 behaviour | **IMPLEMENTED** | Low | None |
| 4 | Dual-pin explicit coherence | ODR-1 | ADR-0037 (noted) | `planPinCoherence` at 3 write boundaries + locked re-check | **IMPLEMENTED-PARTIAL** (new writes only; existing divergence unrepaired) | Medium | None in Task 20; repair stays **OQ-62/OQ-63** |
| 5 | Accounting-owned Chart Tree read surface | ODR-2 | ADR-0009 (consumption) | `GET /chart-tree`, `/chart-tree/:id` | **IMPLEMENTED** | Low | None |
| 6 | Principal-bound organization authorization | ODR-3 | — | `organization_memberships` + `assertOrganizationInScope` | **IMPLEMENTED** | Low | None; future surfaces must reuse it (T20-T19-DEP-2) |
| 7 | **Vardena base/standard chart** | Q2 | ADR-0037 §3 (**Proposed**) | **Nothing** — no seed, no template, no adoption path | **OWNER-DECIDED / NOT IMPLEMENTED** (baseline D-5) | High | **OD-20-1**; content stays OQ-25 |
| 8 | Base chart **content** (codes, Persian titles, level shape) | — | — | none | **OPEN QUESTION** (OQ-25) | High | Expert/Owner decision; never invented by an agent |
| 9 | **Control role vocabulary** (code-defined) | Q4 | ADR-0037 §4 (**Proposed**) | **No column, no table, no service** | **OWNER-DECIDED / NOT IMPLEMENTED** | High | **OD-20-2** (sequencing) |
| 10 | Control role **catalog + mandatory set** | — | — | none | **OPEN QUESTION** (OQ-25) | High | Expert/Owner decision |
| 11 | Control role **mapping artifact shape** | Q4 (mechanism) | ADR-0037 §4 vs contract §8.3 | none | **CONTRADICTION** (T20-C-1: column vs effective-dated mapping) | Medium | **OD-20-3**; likely ADR-0037 amendment or contract precision |
| 12 | Role-driven automated posting (Inventory etc.) | Q4 (roles referenced by posting rules) | contract §20.4 gate | none | **OPEN QUESTION** (OQ-24/OQ-25/OQ-30/OQ-39) | Medium | Out of Task 20 scope; recorded as the likely first consumer |
| 13 | `postable ⇒ leaf` (POSTING XOR AGGREGATION today) | I-2 | ADR-0034 §1/§6 | Enforced both directions + locked re-check; role surfaced in TB/GL | **IMPLEMENTED** (stricter than I-2 requires) | Low | Do not modify |
| 14 | Non-leaf POSTING ("post at another level") | Q5 | ADR-0034 §3/§4/§5 (**Proposed**) | Unrepresentable | **CONTRADICTION** (baseline **D-1**, unchanged) | High | **OD-20-5**; if enabled, an accepted ADR amendment superseding AC-D-19/AC-I-09 + amending §8.5 first |
| 15 | Own-vs-descendant separated measures in rollups | Q5 / I-2 via ADR-0034 §4 | ADR-0034 §4 (**Proposed**) | Not present — TB/GL sum own + descendants into one row per reported account | **OWNER-DECIDED / NOT IMPLEMENTED** | High (only if #14 is ever relaxed) | Prerequisite of #14 |
| 16 | `Account.id` permanent identity | I-1 | ADR-0033 §1 | id-based references everywhere | **IMPLEMENTED** | Low | None |
| 17 | `code` immutable from creation | (repository stricter than Q3) | ADR-0033 §6 | No code on the update path | **IMPLEMENTED-PARTIAL** vs Q3 (baseline **D-2**, repository stricter) | Low | None unless OD-20-4 authorizes a pre-use edit |
| 18 | **Account code history + as-at resolution** | Q18 / I-1 | ADR-0033 §3/§4 (**Proposed**) | **No model, no migration, no resolution** | **OWNER-DECIDED / NOT IMPLEMENTED** (baseline D-3) | High | **OD-20-4** |
| 19 | Code structure migration service | Q19 / I-3 | ADR-0035 (**Proposed**) | Nothing; I-3 structurally protected | **OWNER-DECIDED / NOT IMPLEMENTED** (baseline D-7) | High | Blocked by ADR-0030/OQ-45, OQ-52/OQ-53, ADR-0033 §3 |
| 20 | Deletion of provably unused accounts | Q21 | ADR-0033 §7 | Freeze-over-delete for **all** accounts | **IMPLEMENTED-PARTIAL** vs Q21 (baseline **D-4**, repository stricter) | Low | Out of Task 20 scope; needs its own task + OQ-36 |
| 21 | Tree detail + floating detail both supported | Q6 | ADR-0037 §6 (**Proposed**) | Contract-only | **OWNER-DECIDED / NOT IMPLEMENTED** (baseline D-12) | Medium | **OD-20-6** (scope), OQ-41 (content) |
| 22 | Configurable typed dimension model, never EAV/JSONB | Q7 | ADR-0037 §7 (**Proposed**) | No tables; ledger seam always `[]`; no EAV, no JSONB (verified absence) | **OWNER-DECIDED / NOT IMPLEMENTED** | Medium | **OD-20-6** (scope), OQ-41 (content) |
| 23 | Dimension persistence: document line vs ledger row; projection key | — | contract §10.6 specifies the line table only | Line table absent; projection key excludes dimensions by construction | **OPEN QUESTION** (not stated by any existing OQ) | Medium | Raised as part of **OD-20-6** |
| 24 | Branch as accounting dimension | — | contract §12.4, §11.3 | Branch = Organization master data + document-header scope | **OPEN QUESTION** (OQ-22/OQ-55) | Low | No new decision proposed |
| 25 | Reporting consumes Accounting truth; no second Account master | ODR-2 / Q15 / Q16 | ADR-0009 | TB/GL/statement/chart-tree all read Accounting models | **IMPLEMENTED** | Low | None |

No row is classified `UNKNOWN`: every question raised by the brief resolved to a
documented category from repository evidence.

---

## 13. Proposed Owner Decisions

Only decisions genuinely required by the findings above. Nothing already settled
is re-litigated, and no content that is expert-gated under OQ-25/OQ-41 is
pre-empted — where the answer is accounting content, the decision asked for is
**who decides and in what form**, not the content itself.

---

### OD-20-1 — Vardena Base Chart: delivery form, adoption semantics and content authority

**Question:** In what artifact form is the Vardena base Accounting structure
delivered, what exactly happens when an organization adopts it, and who supplies
its content?

**Why it matters:** Q2 commits Vardena to providing a base structure; ADR-0037 §3
constrains its *form* but explicitly leaves its *content* expert-gated. Nothing
exists in code. Without this decision no base-chart task can be scoped, and any
agent attempting one would have to invent accounting content (AG-09/AR-31).

**Repository evidence:** `owner-decision-baseline.md` Q2 + D-5; ADR-0037 §3;
contract §1.2 non-goal 1; `backend/prisma/` contains no seed script and no
template artifact; ODR-1 `planPinCoherence`; ADR-0028 operational freeze.

**Options:**
- **A — Versioned template data owned by Vardena at deployment level** (template
  version + levels + nodes tables), adopted into an organization by an explicit,
  permission-gated, audited, ODR-3-bound operation that creates ordinary
  `accounts` rows and a coherent pin pair. Never touches an existing chart.
- **B — A reviewable, versioned file artifact** (e.g. a documented, checksummed
  data file under `docs/` or `backend/prisma/`), imported by the same explicit
  operation; no template tables in the database.
- **C — Defer the base chart entirely** until a consuming need exists
  (Inventory→Accounting integration or the first customer onboarding), keeping
  Q2 as a recorded commitment with no delivery date.

**Recommended option:** **A**, with content deferred to a separate
accountant-approved deliverable.

**Reason:** ADR-0037 §3 requires "versioned configuration data or a template
artifact", explicitly forbids a silent seed and forbids hard-coded rows in domain
logic. Option A matches the repository's existing versioned-configuration pattern
(ADR-0028) and keeps adoption auditable and organization-scoped, which ODR-1 and
ODR-3 both require. Option B is acceptable but has no existing import/review
machinery; Option C is safe but leaves Q2 unfulfilled indefinitely.

**Impact:** New Accounting-owned tables (template + adoption record), one
adoption operation with a new granular permission and denial-path tests, and a
decision on whether `accounts` carries template provenance (AR-29 forbids the
column until a consumer exists). No change to existing accounts, no migration of
existing charts, no ledger effect.

**Dependencies:** OQ-25 (content) · ADR-0037 adoption · ODR-1 coherent pin pair
(T20-T19-DEP-1) · ODR-3 chokepoint (T20-T19-DEP-2) · ADR-0028 freeze semantics ·
ADR-0035 for any later re-coding.

---

### OD-20-2 — Control Role foundation sequencing: consumer-first or foundation-first

**Question:** Should the first control roles be introduced **together with their
first consuming operation**, or as a standalone role foundation ahead of any
consumer?

**Why it matters:** ADR-0037 §5 makes mandatory-ness demand-driven ("a role
becomes required when a shipped operation consumes it"), and AR-29 forbids
speculative schema before a consumer exists. Those two rules together imply an
ordering that has never been decided explicitly, and the answer determines
whether a "Control Role Foundation" task may exist at all.

**Repository evidence:** ADR-0037 §4/§5; contract §8.7 (AC-D-09) and its explicit
"placeholders, not a decision"; `prisma/schema/accounting.prisma` header
("deferred with the posting task that consumes them"); task-index §4 rows for
control roles and posting rules; contract §20.4 activation gate.

**Options:**
- **A — Consumer-first.** No role table until the first consuming operation
  (most likely Inventory→Accounting posting rules) is authorized; roles ship
  inside that task, limited to the roles that operation consumes.
- **B — Foundation-first.** Ship the role vocabulary + mapping artifact now with
  an expert-approved catalog, mandatory-ness enforced later by consumers.
- **C — Hybrid.** Ship the *mapping mechanism* now with an **empty** code-defined
  catalog, so organizations can map nothing until a role is added by a code change.

**Recommended option:** **A**.

**Reason:** It is the only option consistent with both ADR-0037 §5 and AR-29 as
written, and it avoids shipping a catalog that OQ-25 has not validated. Option B
requires the expert catalog first (OQ-25) and risks an unvalidated accounting
opinion; Option C ships machinery with no behaviour and no test subject.

**Impact:** Under A, there is **no Control Role task** until a posting-rule /
integration task is authorized; §14's Future Slice B becomes conditional. Under B
or C, an expert-approved catalog must precede implementation.

**Dependencies:** OQ-25 (catalog, mandatory set) · OQ-24/OQ-30/OQ-39 (integration)
· OD-20-3 (mapping shape) · ADR-0037 adoption.

---

### OD-20-3 — Control Role mapping artifact shape (resolves contradiction T20-C-1)

**Question:** Is a control role an **attribute of the account** (contract §8.3's
nullable `control_role` column) or a **separate effective-dated, audited mapping
object** (contract §8.7 / ADR-0037 §4)?

**Why it matters:** The two repository statements cannot both describe the same
artifact: a nullable column cannot carry effective dating or its own audit trail.
Whichever is chosen determines the schema, the permission set, the audit surface
and whether one account may hold several roles over time.

**Repository evidence:** contract §8.3 (attribute table row: "`control_role` |
nullable, closed code-defined list | §8.7 (D-12)") vs contract §8.7 ("a role
mapping is configuration data with its own permission, audit trail and effective
dating") and ADR-0037 §4 (same wording); `prisma/schema/accounting.prisma` header
defers `control_role` as a *column*.

**Options:**
- **A — Effective-dated mapping relation** (role, account, valid-from/valid-to,
  audit, permission-gated), with contract §8.3's column row corrected to a
  pointer.
- **B — Nullable column on `accounts`**, with contract §8.7's effective dating
  reduced to audit-log history and ADR-0037 §4 amended.
- **C — Mapping owned by the accounting configuration version** (roles resolved
  per configuration version, frozen with it).

**Recommended option:** **A**.

**Reason:** §8.7 and ADR-0037 §4 are the more specific and more recent statements
and are the ones the Owner decision Q4 refers to; a relation also supports
remapping after use without rewriting account rows, which the immutability rules
(§8.4 rule 4) make attractive. Option C couples role changes to configuration
versioning and the operational freeze, which would make remapping impossible
after first use — likely undesirable, but it is the Owner's call.

**Impact:** Either a new mapping table (A/C) or a new account column (B), plus
the contract/ADR text correction; no ledger effect either way. A also requires
deciding whether a role may target a non-postable node.

**Dependencies:** OD-20-2 (sequencing) · OQ-25 (catalog) · ADR-0037 amendment or
contract precision · contract §8.3/§8.7 alignment.

---

### OD-20-4 — Account Code History: activation trigger and pre-use edit semantics

**Question:** Does Account Code History ship **before** any producer of a code
change exists, and does a *pre-use* code edit (if ever authorized) write a history
row?

**Why it matters:** There is a circular dependency in the repository: ADR-0035
(migration service) requires code history (ADR-0033 §3), while code history's
only durable producer after first use is that same migration service. Meanwhile
`accounts.code` is immutable from creation, so a history store built today would
hold exactly one row per account forever — speculative schema under AR-29.
ADR-0033 §3 also leaves the pre-use question explicitly undecided.

**Repository evidence:** ADR-0033 §3/§4/§6 and its Consequences ("whether a
superseded code may be re-issued is **not decided here**"); ADR-0035 §1/§3/§4;
baseline D-2, D-3, D-7, O-1; OQ-25/OQ-36 OPEN; `accounting/domain/account.ts`
("NO code field on the update path"); the Task 18 read SQL rendering `a."code"`
and sorting by it.

**Options:**
- **A — Producer-first.** No code-history table until either the pre-use code
  edit or the migration service is authorized; history ships inside that task.
- **B — Store-first.** Ship the history table + as-at resolution seam now,
  back-filled with each account's single current code, so later producers are
  purely additive.
- **C — Pre-use edit first, then history.** Authorize a bounded pre-use code edit
  (reference check: no document line, no ledger entry; validated against the
  pinned versions; permission-gated; audited) and let it be the first producer,
  with an explicit answer on whether it writes history.

**Recommended option:** **A**, with **C** as the preferred first producer when the
Owner wants to unblock the chain.

**Reason:** A honours AR-29 and avoids an untestable store. C is the smallest
real producer and is already recorded as a permitted relaxation (Q3, ADR-0033 §6),
whereas the migration service is blocked by licensing (ADR-0030/OQ-45) and
backup/restore (OQ-52/OQ-53) that are outside Accounting's control. B is the only
option that ships history with nothing to record.

**Impact:** Under A/C: one additive migration when the producer lands, an as-at
resolution seam, and an explicit decision on which read surfaces resolve as-at
(changing TB/GL/statement rendering or ordering is a public behaviour change to
accepted surfaces). Under any option, the **code-reuse** question (OQ-25/OQ-36,
baseline O-1) and the interaction with `uq_accounts_organization_id_code` must be
answered before the schema is fixed.

**Dependencies:** ADR-0033 adoption · ADR-0035 (and its ADR-0030/OQ-45,
OQ-52/OQ-53 blockers) · OQ-25/OQ-36 · OQ-62/OQ-63 (migration preflight) · Task
17B/18 read-surface behaviour.

---

### OD-20-5 — Non-leaf posting: keep `postable ⇒ leaf`, or open the ADR-0034 amendment path

**Question:** Does Vardena keep `postable ⇒ leaf` as a permanent product rule, or
does it open the ADR-0034 §3/§4/§5 path toward configurable non-leaf posting?

**Why it matters:** D-1 is an unresolved normative conflict between Q5 ("posting
at another level") and contract §14 rule 2 / AC-I-09. It has now persisted across
Task 17C, Task 18 and Task 19. The shipped Trial Balance and General Ledger
roll-up would merge a non-leaf POSTING node's own postings with its descendants'
into a single undifferentiated row, and the Account Statement would report
own-only for the same account — so relaxation without ADR-0034 §4 is a
double-counting defect, not a configuration option. Leaving the conflict open
also leaves every future chart task ambiguous.

**Repository evidence:** `owner-decision-baseline.md` Q5 + I-2 + D-1; ADR-0034
§3/§4/§5/§6; contract §14 rule 2, §8.5, AC-I-09;
`accounting/domain/account.ts` (`planPostabilityChange`, `parent_postable`);
`accounting/data/accounting-read-query.repository.ts` (`account_rollup` /
`trial_rows`); `accounting/application/account-statements.service.ts` lines
130–135.

**Options:**
- **A — Keep `postable ⇒ leaf` permanently.** Record ADR-0034 §3 as a dormant
  model; D-1 is resolved by declaring the stricter rule the product rule.
- **B — Open the amendment path.** Authorize a future ADR amendment superseding
  AC-D-19 rule 2 / AC-I-09 and amending §8.5, with ADR-0034 §4's separated
  own-vs-descendant measures as a hard prerequisite, and a separate implementation
  task afterwards.
- **C — Leave D-1 open.** Status quo; every future chart/report task must keep
  re-reading the conflict.

**Recommended option:** **A** for now, with **B** reachable later by an explicit
new Owner decision.

**Reason:** No repository source identifies a concrete business need for non-leaf
posting; the strict rule already satisfies I-2; and the cost of relaxation is a
change to two accepted read surfaces plus a new measure model. Choosing A costs
nothing and removes a standing ambiguity; B can be re-opened whenever a real need
appears. C is the only option that preserves the current risk.

**Impact:** Option A: documentation only (a recorded decision; D-1 reclassified by
the Owner, not by an agent). Option B: an ADR amendment, an explicit role
attribute, separated measures in TB/GL (and a decision for the statement and the
balance projection), report disclosure, new validation rules and denial-path
tests.

**Dependencies:** ADR-0034 status · contract §14/§8.5/AC-I-09 · OQ-25 (per-level
posting policy, baseline O-3) · Task 18 read surfaces.

---

### OD-20-6 — Dimension foundation boundary: first-slice scope and dimension-level aggregation

**Question:** If and when a dimension foundation is authorized, (a) does the first
slice include floating-detail items, line assignment and posting validation
together, and (b) are dimension assignments persisted on the **document line
only** or also on the **ledger entry**, and is dimension-level aggregation
**ledger-native** or a **new projection key**?

**Why it matters:** Contract §10.6 specifies only the *document-line* child table,
while `accounting/domain/ledger-entry.ts` carries an optional
`dimensionAssignments` seam on the **ledger** contract and
`accounting/domain/balance-projection.ts` excludes dimensions from the projection
key by construction. No repository source states which side is authoritative for
dimension reporting. OQ-41 asks about dimension *content and governance*, not
about this persistence/aggregation boundary — so the question is genuinely
unowned.

**Repository evidence:** contract §10.1–§10.7, §11.1–§11.4 (AC-D-11…AC-D-15,
AC-I-18); ADR-0037 §6/§7; `accounting/domain/ledger-entry.ts` "Deferred dimension
seam (OQ-41)"; `accounting/data/ledger-entries.repository.ts` lines 240–242;
`accounting/domain/balance-projection.ts` lines 15 and 243; Task 18 D5
(`accounting.ledger_entries` authoritative, the projection derived and
rebuildable); OQ-41, OQ-22/OQ-55 OPEN.

**Options:**
- **A — Line-only persistence, ledger-native aggregation.** Assignments live on
  document lines (contract §10.6); dimension reports aggregate from lines joined
  to ledger entries; the projection stays dimension-free.
- **B — Ledger-side persistence.** Assignments are also materialized on (or
  alongside) ledger entries so ledger reads need no document join; the domain seam
  becomes real.
- **C — Line persistence plus a separate dimension projection** with its own
  rebuild semantics under ADR-0031.

**Recommended option:** **A** as the first slice, leaving B/C as later
performance decisions.

**Reason:** A is the only option the contract already specifies (§10.6), it
matches Task 18's accepted "ledger is authoritative, projections are derived"
posture (D5), and it avoids a second monetary/analytical truth. B duplicates
line data onto immutable ledger rows and must be justified by a measured need; C
adds a projection whose rebuild semantics and reconciliation gates (AC-I-19) are
significant work.

**Impact:** Scope of the first dimension task; whether `ledger_entries` gains a
dimension child table; whether the balance projection key changes. No effect on
existing behaviour until a dimension task is authorized.

**Dependencies:** **OQ-41** (count, requirement defaults, binding, item
governance, area applicability — content) · OQ-22/OQ-55 (branch/department) ·
ADR-0037 §6/§7 adoption · ADR-0031 (if a projection is added) · Task 18 D5
posture.

---

## 14. Future Implementation Slices

Proposed boundaries only. **None is authorized by this document**, and each still
requires `docs/accounting/task-index.md` §7 admission (objective, scope,
non-goals, dependencies, blocking OQs, required ADRs, acceptance criteria, index
entry). The set is deliberately *not* assumed to be five tasks: Slice B is
conditional on OD-20-2, and Slice E may never exist.

### Future Slice A — Base Chart Structure

| Field | Content |
|---|---|
| **Purpose** | Deliver the Q2 base structure as versioned template data plus an explicit, audited, organization-scoped adoption operation |
| **Dependencies** | **OD-20-1**; OQ-25 (content, expert-approved); ADR-0037 adoption; ODR-1 coherent pin pair; ODR-3 chokepoint; ADR-0028 freeze semantics |
| **Inputs** | An accountant-approved template (codes, Persian titles, level shape, natures, postability) supplied as reviewable data |
| **Outputs** | Template tables (or artifact), an adoption operation + granular permission, an adoption audit record |
| **Data ownership** | Template = Vardena/deployment-level; adopted accounts = the organization's, inside Accounting |
| **Migration impact** | Additive migration for template/adoption tables; **no migration of existing charts** (re-coding is ADR-0035) |
| **Security impact** | New write surface: must reuse `assertOrganizationInScope`; must not create a wildcard or bootstrap-style exception |
| **Reporting impact** | None directly — adopted accounts appear in the existing Chart Tree, TB and GL surfaces |
| **Open decisions** | Template content (OQ-25); provenance column yes/no (AR-29); adoption into an already-posting organization |
| **Risk** | High if content is invented; low if content arrives as an expert-approved artifact |

### Future Slice B — Control Role Foundation *(conditional on OD-20-2)*

| Field | Content |
|---|---|
| **Purpose** | Introduce the code-defined role vocabulary and the organization role→account mapping |
| **Dependencies** | **OD-20-2** (sequencing), **OD-20-3** (artifact shape, resolving T20-C-1); OQ-25 (catalog + mandatory set); ADR-0037 adoption/amendment; a consuming operation if OD-20-2 = A |
| **Inputs** | Expert-approved role catalog; the consuming operation's requirements |
| **Outputs** | Role vocabulary in code; mapping artifact; permissions; mandatory-role validation inside the consuming operation |
| **Data ownership** | Vocabulary = Vardena (code); mappings = organization configuration inside Accounting |
| **Migration impact** | Additive (mapping table or account column) |
| **Security impact** | New configuration write surface; granular permission + denial-path tests; ODR-3 bound |
| **Reporting impact** | None initially; later statutory profiles consume roles (ADR-0036/ADR-0037 §4) |
| **Open decisions** | Catalog; mandatory set; whether a role may target a non-postable node; effective-dating semantics |
| **Risk** | High if the §8.7 placeholder list is adopted as the catalog |

### Future Slice C — Account Code History

| Field | Content |
|---|---|
| **Purpose** | Make `Account.id → {historical codes, current code}` reconstructable and give reports an as-at resolution seam |
| **Dependencies** | **OD-20-4**; ADR-0033 adoption; a producer (pre-use edit or ADR-0035 migration service); OQ-25/OQ-36 (code reuse, baseline O-1) |
| **Inputs** | Validity-granularity decision; code-reuse decision; the list of read surfaces that resolve as-at |
| **Outputs** | History relation + additive migration; resolution function; explicit read-surface behaviour |
| **Data ownership** | Accounting |
| **Migration impact** | Additive; must not alter `ledger_entries`, document lines or projections (Invariant I-3) |
| **Security impact** | Read-only expansion; existing permissions likely sufficient |
| **Reporting impact** | **Material** — as-at codes change TB/GL/statement rendering and TB ordering; requires an explicit decision, not a silent switch |
| **Open decisions** | Validity granularity; reuse; interaction with `uq_accounts_organization_id_code`; default rendering per surface |
| **Risk** | High if shipped without a producer (speculative schema) or if read behaviour changes silently |

### Future Slice D — Detail / Dimension Foundation

| Field | Content |
|---|---|
| **Purpose** | Implement the Q6/Q7 typed dimension model (dimensions, groups, items incl. floating details, per-(account, dimension) requirement, line assignment, posting validation) |
| **Dependencies** | **OD-20-6**; **OQ-41**; OQ-22/OQ-55; ADR-0037 §6/§7 adoption; AC-I-18 |
| **Inputs** | OQ-41 answers (count, defaults, binding, governance, area applicability) |
| **Outputs** | Typed dimension/group/item tables, line-assignment child table, composition + finalization validation, `GROUP BY` reporting foundation |
| **Data ownership** | Accounting owns dimensions and items; master-data bindings are logical only and transfer no ownership (§10.5/§11.3) |
| **Migration impact** | Several additive tables; **no EAV, no JSONB** (ADR-0037 §7) |
| **Security impact** | New configuration + assignment surfaces; granular permissions + denial-path tests; ODR-3 bound |
| **Reporting impact** | New dimension reports; TB/statement stay account-keyed unless separately decided; projection key unchanged under OD-20-6 option A |
| **Open decisions** | Everything in OQ-41; ledger-vs-line persistence and aggregation basis (OD-20-6) |
| **Risk** | Medium-high — the largest schema surface of the five |

### Future Slice E — Future Posting Semantics *(only if OD-20-5 = B)*

| Field | Content |
|---|---|
| **Purpose** | Enable configurable non-leaf POSTING without double counting |
| **Dependencies** | **OD-20-5 = B**; an **accepted** ADR amendment superseding AC-D-19 rule 2 / AC-I-09 and amending contract §8.5; ADR-0034 §4/§5; OQ-25 (per-level policy) |
| **Inputs** | The amended contract text; the declared inclusion rule per report |
| **Outputs** | Explicit role attribute (or documented mapping); separated own-vs-descendant measures in TB/GL; statement + projection decisions; new validation rules; report disclosure; denial-path and no-double-count regression tests |
| **Data ownership** | Accounting |
| **Migration impact** | Possibly a role column; read-model rewrite is the bulk of the work |
| **Security impact** | None new |
| **Reporting impact** | **Highest of all slices** — changes the meaning of every rollup surface |
| **Open decisions** | Which levels may post (OQ-25); transition rules; descendant handling |
| **Risk** | Highest; must never be attempted as "just a validation change" |

---

## 15. Final Decision Gate

**Verdict: BLOCKED — OWNER DECISION REQUIRED.**

Measured against the twelve READY criteria:

| # | Criterion | Met? | Note |
|---|---|---|---|
| 1 | Scope bounded | Partially | Each domain can be bounded, but none has a decided scope |
| 2 | Required Owner decisions already exist | **No** | Six decisions are missing (OD-20-1…OD-20-6) |
| 3 | No unresolved architecture contradiction | **No** | D-1 (non-leaf posting) and T20-C-1 (role artifact shape) are unresolved |
| 4 | Required ADRs appropriately resolved | **No** | ADR-0033/0034/0035/0037 all **Proposed**; ADR-0034 additionally requires an amendment before its §3 may be used |
| 5 | No silent change to Task 19 | Yes | Two forward dependencies recorded; no change requested |
| 6 | No unresolved security/tenant boundary | Yes | ODR-3 chokepoint exists and would be reused |
| 7 | Data ownership clear | Partially | Clear for dimensions/code history; **unclear** for base-chart templates and role mappings |
| 8 | Migration strategy understood | Partially | Additive-only is clear; base-chart adoption and code-history back-fill are undecided |
| 9 | Historical accounting integrity protected | Yes | Ledger insert-only, id-keyed, version-pinned; no proposed slice rewrites history |
| 10 | Testing strategy defined | Partially | The repository's policy is defined (`docs/testing/test-execution-policy.md`); per-slice test design awaits scope |
| 11 | Cross-module ownership explicit | Partially | Accounting ownership is clear; the first control-role **consumer** is undecided |
| 12 | No dangerous invariant left implicit | **No** | The own-vs-descendant measure semantics behind D-1 remain implicit until OD-20-5 |

The strongest applicable blocker is the absence of Owner decisions: the ADR work
in criterion 4 cannot even be scoped until OD-20-1…OD-20-6 are answered.
Blockers are itemized in [`task-20-implementation-gate.md`](./task-20-implementation-gate.md).

---

## 16. Known Limitations

1. **Static inspection only.** All implementation claims are read-only code and
   schema inspection at `main` @ `3deb5a5`. No runtime behaviour was exercised.
2. **No tests executed.** Per the brief's §20 and
   `docs/testing/test-execution-policy.md`, this documentation-only task ran only
   `git diff --check` and static documentation/reference validation. **No unit,
   E2E, live-PostgreSQL, migration-rehearsal or CI-equivalent run is claimed**,
   and no existing test was modified.
3. **Two SQL surfaces read, not profiled.** The double-counting analysis in §6.4
   is derived from reading the TB/GL CTEs; it was not demonstrated by execution
   (and cannot be, because `postable ⇒ leaf` makes the shape unrepresentable
   today). It is labelled as an analysis of a *hypothetical* relaxation.
4. **Shallow local history.** `STATE.md` §2 records the clone as shallow; PR and
   commit references are transcribed from repository records, not re-derived from
   local ancestry.
5. **No legal claim.** Nothing here validates any Iranian statutory requirement;
   OQ-43 remains OPEN and untouched.
6. **Content deliberately absent.** No base-chart account, no control role, no
   dimension and no code-history schema is proposed as content. Where the brief
   listed examples (Receivable/Payable/Cash/Bank/Inventory/Sales/Expense; Cost
   Center/Project/Branch), the repository classifies them as placeholders or
   uses — they are treated as such and approved by nothing here.
7. **Agent inference is labelled, not authoritative.** Every inference in §4.6,
   §5.2 item 1 and item 4, §7.3 (chart-tree as-at remark) and §8 is marked and may
   be overruled by the Owner.
