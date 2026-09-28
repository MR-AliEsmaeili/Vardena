# Task 21 — Base Chart Governance Baseline

- **Document type:** governance baseline — **DESIGN / GOVERNANCE ONLY (DOCUMENTATION ONLY)**
- **Date:** 2026-09-26
- **Task status:** **ACCEPTED (2026-09-26)** (the Agent does not self-accept)
- **Branch:** `arena/01a0de9b-vardena`
- **Baseline:** `main` @ `10797e1400fda6329ca481877f9bbf9eff850fcd`
- **Companions:** [`task-21-brief.md`](./task-21-brief.md) · [`task-21-investigation.md`](./task-21-investigation.md)
- **Canonical predecessors:** `owner-decision-baseline.md` §11 (ODR-1…ODR-3) and §12 (OD-20-1…OD-20-6); ADR-0026/0033/0034/0035/0036/0037.

> This baseline authorizes **no implementation** and invents **no accounting
> content**. It records governance conclusions and a content *model* so a future
> implementation task can proceed without inventing accounting semantics. It does
> not promote an ADR, close OQ-41/OQ-43, reopen Task 19/Task 20, or self-accept.

---

## 0. Classification legend

Every conclusion below is tagged with exactly one class:

| Tag | Meaning in this document |
|---|---|
| **OWNER DECISION (pending)** | A choice only the Owner/accountant may make; recorded as required, not made here. |
| **ARCHITECTURAL DECISION (proposed)** | An architecture/governance rule proposed by Task 21, pending acceptance. |
| **ACCOUNTING DOMAIN DECISION (proposed)** | A domain-governance rule proposed by Task 21, pending accountant acceptance. |
| **IMPLEMENTATION CONSTRAINT** | A binding consequence *already implied* by an accepted decision (ODR-*/OD-20-*/ADR/invariant); a future implementation must honour it. |
| **OPEN QUESTION** | Genuinely undecided; stays with OQ-25 (or a named OQ). |
| **INTERIM ASSUMPTION** | A fail-closed placeholder until the Owner decides; explicitly not a rule. |
| **DEFERRED** | Deliberately out of Task 21 scope (content, OQ-41, OQ-43, OQ-36, future consumer). |

Task 21 does **not** record any new `OWNER DECISION` as *made*; owner-level
choices appear as **OWNER DECISION (pending)**.

---

## 1. Base Chart definition (the three-layer boundary)

**Conclusion (IMPLEMENTATION CONSTRAINT, from OD-20-1 + ADR-0033 §1 + ADR-0031 §2):**

```text
Base Chart Template            (Vardena/Accounting-owned, versioned product/database asset)
        │  adoption  (explicit, permission-gated, ODR-3-bound, ODR-1-coherent)
        ▼
Organization-owned Chart / Accounts   (ordinary `accounts` rows, organization-scoped `Account.id`)
        │
        ▼
Ledger identity                 (LedgerEntry.accountId → Account.id only)
```

Binding rules:

1. The Base Chart template is an Accounting-owned product asset, **not** organization
   data and **not** ledger identity.
2. A future implementation **MUST NOT** store ledger postings, balances, or
   document lines against a Base Chart *template* identifier. Ledger/document
   references always resolve to the adopted organization-scoped `Account.id`.
3. Base Chart template versions exist **independently** of charts already adopted
   by organizations (OD-20-1).

---

## 2. Base Chart content model — included fields

Task 21 defines the *conceptual field set* a Base Chart entry may carry. **Values
are not defined here** (DEFERRED to accountant/domain approval under OQ-25). Every
field has a documented semantic reason; no field is added for convenience.

| Conceptual field | Included? | Semantic reason | Class |
|---|---|---|---|
| **template/version identity** (`template_id`, `version_number`, `status`) | Yes | OD-20-1 requires a *versioned* asset; identity + version + lifecycle state are the minimum to version and publish it. | IMPLEMENTATION CONSTRAINT |
| **level shape reference / parameterization** | Yes | Codes only exist relative to a level shape (digit lengths); ODR-1 requires code-shape coherence. A version binds to, or is parameterized by, a level shape. | IMPLEMENTATION CONSTRAINT |
| **node key + parent node key** (template-internal) | Yes | The chart is a tree (`parent_id` adjacency); template nodes need internal keys to express hierarchy *before* organization `Account.id`s exist. These are template-internal, never ledger identity. | IMPLEMENTATION CONSTRAINT |
| **account code / code segment** | Yes (field) / values DEFERRED | Adoption must produce a valid organization code (concatenated segments, §9.3). The field exists; the actual digits are content. | IMPLEMENTATION CONSTRAINT (field) · DEFERRED (values) |
| **account title** (Persian-capable) | Yes (field) / values DEFERRED | Accounts carry a Persian-capable `title`; the field exists, the titles are content. | IMPLEMENTATION CONSTRAINT (field) · DEFERRED (values) |
| **account nature** (`debit`/`credit`, closed list) | Yes (field) / values DEFERRED | `accountNature` is a decided closed list on `Account`; per-account assignment is content. | IMPLEMENTATION CONSTRAINT (field) · DEFERRED (values) |
| **is_postable default** | Yes | A per-node postability default (seeded from configuration `default_is_postable`), **hard-bounded by leaf-only** (OD-20-5): non-leaf nodes must be non-postable. | IMPLEMENTATION CONSTRAINT |
| **is_mandatory** | Yes (flag) / set DEFERRED | Governance flag whose *semantics* Task 21 defines (§5); the *set* of mandatory accounts is content. | ACCOUNTING DOMAIN DECISION (proposed, semantics) · DEFERRED (set) |
| **default activation state** (`is_active`) | Yes | Adoption must know whether a node is created active/inactive; default is `active` unless a version marks otherwise. | INTERIM ASSUMPTION (default active) |
| **control-role reference** (optional) | Optional, only if a role exists | Per OD-20-2/OD-20-3, a Base Chart entry MAY *optionally* point at an already-existing control role, but the authoritative association is produced as an **effective-dated mapping on adoption**, never as an `Account.control_role` column. Absent any approved role, the field is absent. | IMPLEMENTATION CONSTRAINT (shape) · OPEN (which roles) |

## 2a. Base Chart content model — excluded fields

The Base Chart template MUST NOT contain the following. Each exclusion cites the
accepted prohibition it derives from.

| Field deliberately excluded | Reason (accepted decision) | Class |
|---|---|---|
| organization-specific IDs | Template ≠ organization data; adoption creates the org identities (OD-20-1). | IMPLEMENTATION CONSTRAINT |
| organization-specific permissions | Authorization is organization/RBAC concern (ODR-3, ADR-0016), not template content. | IMPLEMENTATION CONSTRAINT |
| financial-area identity | Chart is organization-scoped; per-area applicability is OQ-40, deferred (no `financial_area_id` on accounts today). | IMPLEMENTATION CONSTRAINT · DEFERRED (OQ-40) |
| branch identity | Branch is an operational scope dimension, not chart structure (OQ-22/OQ-55; contract §12.4). | IMPLEMENTATION CONSTRAINT |
| dimension assignments | Dimensions are line-level analytical assignments (OD-20-6); content is OQ-41. | IMPLEMENTATION CONSTRAINT · DEFERRED (OQ-41) |
| balances | Template ≠ ledger; balances are derived projections keyed on `Account.id`. | IMPLEMENTATION CONSTRAINT |
| ledger entries | Template identities never become ledger references (OD-20-1). | IMPLEMENTATION CONSTRAINT |
| historical account identity / code history | Code history is producer-bound and organization-owned (OD-20-4, ADR-0033 §3/§5); a template is not a history producer. | IMPLEMENTATION CONSTRAINT |
| runtime audit identity | Template product audit ≠ organization runtime audit trail; the latter is created at adoption/use time. | IMPLEMENTATION CONSTRAINT |
| organization-specific custom accounts | Custom accounts are organization-owned post-adoption (§9), never template content. | IMPLEMENTATION CONSTRAINT |

---

## 3. Hierarchy and configurable levels

**Conclusion (IMPLEMENTATION CONSTRAINT):** The Base Chart MUST NOT introduce a
hardcoded four-level hierarchy. A Base Chart version is bound to (or parameterized
by) a level shape and cooperates with the existing configuration objects:

```text
Accounting Configuration ── Coding Structure Version ── Coding Structure Levels ── Account Tree
```

Invariants a future implementation must enforce:

1. **ODR-1 coherence preserved.** After adoption the organization's accounts pin a
   coherent `(coding_structure_version_id, accounting_configuration_id)` pair;
   incoherent pins are rejected (no silent fallback).
2. **Code-shape compatibility.** A Base Chart version's codes must be valid under
   the target level shape (digit lengths, depth ≤ `max_depth`, §9.3 prefix rule).

**Adoption-vs-configuration mechanism** (Task 21 §7 of the brief, options A/B/C):

- **Chosen invariant (ARCHITECTURAL DECISION, proposed): C — a compatibility
  validation is mandatory before adoption.** Adoption may not proceed unless the
  target configuration/coding-structure is compatible with the Base Chart version.
- Whether adoption **A** references an existing organization configuration or **B**
  creates/adopts a compatible one is **DEFERRED** to the implementation task,
  bounded by: it must never mutate an operationally frozen configuration
  (ADR-0028 §3) and must produce an ODR-1-coherent pin pair.

---

## 4. Adoption semantics

### 4.1 Copy, not reference — IMPLEMENTATION CONSTRAINT (from OD-20-1)

- Adoption **copies** template account definitions into organization-owned
  `Account` rows. The organization **owns** the resulting records.
- **Rejected:** any runtime dependency of organization accounts on mutable template
  rows. Organization accounts must remain fully functional and stable even if the
  template row later changes or the template version is superseded.

### 4.2 Version pinning / no silent mutation — IMPLEMENTATION CONSTRAINT

- An adoption is performed against exactly one **immutable, published** Base Chart
  version.
- A newer Base Chart version **MUST NOT** silently mutate an existing organization's
  chart. Rationale (documented, not assumed): adopted accounts are organization-owned
  (OD-20-1); an operationally used configuration is frozen (ADR-0028 §3); and the
  ledger is never rewritten by a chart change (I-3).
- Future upgrades are **explicit** migration/adaptation operations, never implicit
  synchronization (§8).
- Whether the *account row* records template provenance (which template version
  produced it) is a speculative column today (AR-29) → **OPEN**; if required later,
  it is provenance metadata only, never accounting identity.

### 4.3 Partial adoption — bounded

- **IMPLEMENTATION CONSTRAINT:** any adoption (full or partial) must preserve
  **ancestor-closure** (no adopted node without its ancestors, so the tree can never
  lose an ancestor under a report — §8.6/AR-13) and **mandatory-inclusion** (every
  account marked mandatory by the version must be present — §5).
- **OPEN QUESTION:** whether adoption is full-chart-only, selectable-subset, or
  staged beyond those invariants. Selectable subsets introduce accounting-consistency
  risks (missing role-backed accounts, broken statement structure) and require
  accountant approval. **Non-goal:** a generic chart designer.

---

## 5. Mandatory account semantics

Task 21 defines the *meaning* of `is_mandatory`, not the *list* (list = DEFERRED,
content, expert-gated).

**Minimal decided meaning (ACCOUNTING DOMAIN DECISION, proposed):** a mandatory
Base Chart account —

1. **must exist** in the organization chart after adoption (cannot be excluded);
2. **cannot be deleted** (aligns with freeze-over-delete already implemented);
3. **cannot be deactivated** while it remains mandatory.

**Explicitly not assumed (OPEN):** whether a mandatory account additionally cannot
be moved, cannot have its nature changed, or must remain structurally compatible —
these depend on which consumers exist and are left OPEN. **Titles remain editable**
(title is display, `Account.id` is identity — ADR-0033 §2). **Code change** stays
governed solely by OD-20-4 (mandatoriness adds no extra code rule).

**Four distinct requirement sources — must not be conflated (ACCOUNTING DOMAIN
DECISION, proposed):**

| Concept | Trigger | Validated where |
|---|---|---|
| **Mandatory Base Chart content** | The Base Chart version marks the account mandatory | Adoption governance |
| **Organization-required accounts** | An organization's own policy | Organization configuration (out of Base Chart) |
| **Control-role requirements** | A concrete active consumer needs a role-backed account (demand-driven, OD-20-2) | The consuming operation's readiness/validation path |
| **Statutory requirements** | Legal/statutory obligation | Legal Profile only (OQ-43/ADR-0036) — **out of scope** |

---

## 6. Control roles — governance contract (no catalog)

Per OD-20-2 (consumer-first) and OD-20-3 (effective-dated mapping), Task 21 defines
the governance contract and **introduces no roles**.

**ACCOUNTING DOMAIN / ARCHITECTURAL governance (proposed):**

1. **What qualifies as a control role:** a semantic account classification that a
   concrete, approved Accounting *consumer* (a posting rule, reconciliation,
   reporting, settlement, or integration flow) resolves accounts by — instead of by
   a free organization code (contract §8.7 D-12).
2. **Who may introduce one:** only together with a concrete approved consumer and
   explicit accounting/domain approval; the role vocabulary is code-defined (the
   ADR-0023 §2 pattern), so adding a role is a reviewed code change, not runtime data.
3. **Evidence required:** the consuming operation's requirement documented, plus
   accountant/domain approval of the role's semantics and mandatoriness.
4. **How a consumer binds:** through the **independent effective-dated
   Account↔Control-Role mapping** (OD-20-3), never `Account.control_role`.
5. **Base Chart optional reference:** a Base Chart entry MAY optionally reference an
   *already-existing* role; on adoption this produces a mapping, not a column. Absent
   any approved role, no reference exists.
6. **Role-backed mandatory ≠ mandatory chart account:** a role-backed account is
   required *when its consuming operation is active* (demand-driven) and is validated
   in the consumer's path; a mandatory chart account is required by Base Chart
   governance at adoption. Different trigger, different validation site (§5).

**OPEN QUESTION:** the concrete role catalog and mandatory set stay OPEN. Task 21
does **not** approve Cash, Bank, Accounts Receivable, Accounts Payable, Inventory,
Tax, Sales, or any other role — common ERP practice is not converted into Vardena
policy without approval and a real consumer.

---

## 7. Per-level posting defaults

**Conclusion (IMPLEMENTATION CONSTRAINT, from OD-20-5 + existing implementation):**

- `is_postable` is an **explicit per-account Base Chart property**, seeded from the
  **configuration-level `default_is_postable`** and **hard-bounded by the leaf-only
  invariant**: any node with children must be non-postable.
- A Base Chart therefore can **never** produce the contradiction
  `parent postable AND child postable` (`postable ⇒ leaf`, enforced both directions).
- **No exceptions.** Non-leaf posting is not introduced. Any future non-leaf posting
  requires a new explicit architecture decision reopening/superseding ADR-0034.
- **Task 18 reporting logic is unchanged** — parent totals stay read-time roll-ups
  over leaf postings.

---

## 8. Version lifecycle and upgrades

**Lifecycle (ARCHITECTURAL DECISION, proposed) — fits the ADR-0028 versioning
pattern:**

```text
Draft → Approved → Published → Superseded
```

| Question | Conclusion | Class |
|---|---|---|
| Who may approve/publish | Accounting/domain expert + product owner (a governance act, §7 future-task rule). An agent may not approve content. | OWNER DECISION (pending) |
| Are published versions immutable | **Yes.** A published version never changes; a change is a new version. | ARCHITECTURAL DECISION (proposed) |
| Is an adopted version historically identifiable | The adoption record references the published version; account-level provenance is **OPEN** (AR-29). | IMPLEMENTATION CONSTRAINT (adoption record) · OPEN (account provenance) |
| Is upgrade automatic or explicit | **Explicit.** No silent synchronization (§4.2). | IMPLEMENTATION CONSTRAINT |
| Is upgrade allowed after operational use | Only via a controlled migration/adaptation that never silently mutates organization accounts (ADR-0028 freeze; ADR-0035 for any code change; I-3). | IMPLEMENTATION CONSTRAINT |
| Does upgrade require a compatibility/migration plan | **Yes.** | ARCHITECTURAL DECISION (proposed) |

**Non-goal:** building an upgrade engine. The future implementation must never
silently mutate organization accounts because a product template changed.

---

## 9. Organization customization (post-adoption)

The organization owns its chart after adoption and may customize within the accepted
invariants. Classification (Allowed / Conditionally allowed / Forbidden / Not yet
decided). "Pre-use / post-use" refers to whether a document line references the
account (`isReferencedByDocumentLine`).

| Customization | Classification | Basis |
|---|---|---|
| Add custom accounts | **Allowed** (must satisfy ODR-1 coherence, `postable ⇒ leaf`, code validity, ancestor exists) | Organization owns chart; existing create rules |
| Rename titles | **Allowed** | `title` always editable; identity is `Account.id` (ADR-0033 §2) |
| Deactivate accounts | **Conditionally allowed** — allowed for non-mandatory, non-in-use-role-backed accounts; **forbidden** for mandatory (§5) and for role-backed accounts a live consumer depends on | Freeze-over-delete; §5; OD-20-2 |
| Move accounts (reparent) | **Conditionally allowed pre-use** (bounded by leaf-only, §9.3 prefix, ODR-1); **forbidden post-use** | `parentId`/`level` immutable after use |
| Change code | **Conditionally allowed pre-use** (OD-20-4, valid under pinned shape, uniqueness/reuse rules); **forbidden post-use**; *currently the repository is stricter (immutable from creation)* | OD-20-4; ADR-0033 §3/§4; repository |
| Change nature | **Conditionally allowed pre-use**; **forbidden post-use** | `accountNature` immutable after use |
| Change postability | **Conditionally allowed pre-use** (bounded by leaf-only); **forbidden post-use** | `isPostable` immutable after use; OD-20-5 |
| Attach future control roles | **Not yet decided** (no role exists yet); when roles exist → via effective-dated mapping (OD-20-3), consumer-first | OD-20-2/OD-20-3 |
| Attach future dimensions | **Not yet decided / Deferred (OQ-41)** | OD-20-6; OQ-41 |

**Guard (IMPLEMENTATION CONSTRAINT):** no customization may silently invalidate
ODR-1 coherence, leaf-only posting, historical `Account.id` identity, future
control-role consumers, or mandatory Base Chart semantics.

---

## 10. Account lifecycle / code validity boundary (vs OQ-36)

Task 21 defines only the **boundary**; it does not duplicate or override OQ-36.

| Stage | Rule | Class |
|---|---|---|
| Before accounting use | Bounded correction permitted (pre-use code correction, structural edits) per OD-20-4 and existing pre-use editability. | IMPLEMENTATION CONSTRAINT |
| After accounting use | Code and structural fields immutable (OD-20-4; ADR-0035 is the only post-use re-coding path). | IMPLEMENTATION CONSTRAINT |
| Deactivation | Base Chart governance forbids deactivating a mandatory account and an in-use role-backed account (§5, §9). | ACCOUNTING DOMAIN DECISION (proposed) |
| Deletion | Belongs to **OQ-36**; Task 21 decides nothing new. Mandatory/role-backed accounts must never be hard-deleted (freeze-over-delete). | DEFERRED (OQ-36) |
| Code reuse | **OQ-36** posture (codes currently never reused) is not overridden here. | DEFERRED (OQ-36) |

**Prerequisites Task 21 needs from OQ-36 before Base Chart implementation:**

1. Code-reuse policy for superseded codes and its interaction with
   `uq_accounts_organization_id_code` (baseline O-1).
2. Deletion eligibility (if any) for *unused adopted* accounts (soft vs hard).
3. How a future code-history producer (OD-20-4 / ADR-0035) coexists with the
   never-reuse rule.

---

## 11. Base Chart vs statutory chart

**IMPLEMENTATION CONSTRAINT + OUT OF SCOPE (OQ-43):**

```text
Vardena Base Chart   ≠   Iran statutory reporting profile
```

- Legal/statutory concerns remain authoritative under **ADR-0036 / OQ-43**.
- A Base Chart may be *designed to support* future statutory reporting, but Task 21
  invents/hardcodes **no** legal requirement and makes **no** legal compliance claim.
- Statutory content lives in a versioned, expert-approved Legal Profile that consumes
  Core read sources — never inside the Base Chart or `backend/src/modules/accounting/`.

---

## 12. Decision matrix

| Topic | Current state | Task 21 conclusion | Status | Class | Future implementation impact |
|---|---|---|---|---|---|
| Base Chart ownership | OD-20-1 | Versioned Accounting-owned template; template ≠ org ≠ ledger | **Decided (predecessor)** | IMPLEMENTATION CONSTRAINT | Never store ledger against a template id |
| Base Chart definition/layering | Open | Template → adopted org accounts → ledger identity | **Narrowed** | IMPLEMENTATION CONSTRAINT | Adoption creates org-owned `Account.id`s |
| Base Chart content **model (fields)** | Open | Field set fixed with reasons (§2/§2a) | **Narrowed** | IMPLEMENTATION CONSTRAINT | Implement exactly these fields; no convenience fields |
| Base Chart content **values** | Open | Not decided; expert-gated | **Open** | DEFERRED | Must be accountant-approved before build |
| Configurable levels / no 4-level hardcode | Configurable (implemented) | Version bound to a level shape; adoption compatibility-validated (C) | **Narrowed** | IMPLEMENTATION CONSTRAINT (+ DEFERRED A/B) | ODR-1-coherent pins; no four-level assumption |
| Adoption = copy vs reference | Open | **Copy**; org owns records; no mutable-template dependency | **Narrowed** | IMPLEMENTATION CONSTRAINT | Adoption writes ordinary `accounts` rows |
| Version pinning / no silent mutation | Open | Immutable published version; explicit upgrades only | **Narrowed** | IMPLEMENTATION CONSTRAINT | New template version never mutates adopted chart |
| Partial adoption | Open | Ancestor-closure + mandatory-inclusion required; shape otherwise open | **Narrowed** | IMPLEMENTATION CONSTRAINT + OPEN | No generic chart designer |
| Mandatory account **semantics** | Open | Must-exist / no-delete / no-deactivate-while-mandatory | **Narrowed** | ACCOUNTING DOMAIN DECISION (proposed) | Enforced at adoption + lifecycle |
| Mandatory account **list** | Open | Not decided | **Open** | DEFERRED | Accountant-approved |
| Control roles (governance) | Consumer-first (OD-20-2/3) | Governance contract defined; catalog OPEN | **Narrowed** | ARCH/DOMAIN governance (proposed) | Role via effective-dated mapping only |
| Control-role catalog | Consumer-first | No roles introduced | **Open** | OPEN | Arrives with a real consumer |
| Posting defaults | Open (OD-20-5 invariant) | `is_postable` explicit, config-defaulted, leaf-bounded | **Narrowed** | IMPLEMENTATION CONSTRAINT | No parent+child postable; Task 18 unchanged |
| Account customization | Open | Classification table (§9) | **Narrowed** | IMPLEMENTATION CONSTRAINT + OPEN | Cannot break ODR-1/leaf-only/identity |
| Version lifecycle | Open | Draft→Approved→Published→Superseded; published immutable | **Narrowed** | ARCHITECTURAL DECISION (proposed) | Explicit upgrade + migration plan |
| Code history / validity | OD-20-4 + OQ-36 | Boundary only; prerequisites listed | **Boundary defined** | IMPLEMENTATION CONSTRAINT + DEFERRED (OQ-36) | Producer-bound; OQ-36 decides reuse/deletion |
| Statutory profile | OQ-43 | Base Chart ≠ statutory profile | **Out of scope** | DEFERRED (OQ-43) | No legal content in Base Chart/Core |
| Dimensions | OQ-41 | Out of scope | **Out of scope** | DEFERRED (OQ-41) | Line-level assignments (OD-20-6) |

---

## 13. OQ-25 before / after

- **Before Task 21:** OQ-25 OPEN, narrowed by OD-20-1…OD-20-5 (mechanism/sequencing/
  shape) — still OPEN for Base Chart content, control-role catalog/mandatory set,
  per-level posting defaults, code reuse/history details, deactivation/deletion
  guards, statutory layouts.
- **After Task 21:** OQ-25 **substantially narrowed, remains OPEN.** Now additionally
  governed by Task 21: the Base Chart content *model* (field set), adoption semantics
  (copy / version-pinning / partial-adoption bounds), mandatory-account *semantics*,
  per-level posting-default role, version lifecycle, customization classification, and
  the OQ-36 boundary. Still **OPEN** (and the reason OQ-25 cannot be closed):
  - Base Chart content **values** — codes, Persian titles, natures, the mandatory
    account list (expert-gated).
  - The concrete **control-role catalog** and mandatory set (consumer-first; no
    consumer yet).
  - Extended mandatory restrictions (move / nature / structural compatibility) that
    depend on future consumers.
  - Deletion/code-reuse policy (**OQ-36**) and account-level template provenance.
  - Concrete Base Chart content approval, which is outside this governance acceptance.

OQ-25 is therefore **not** marked resolved.

---

## 14. Future implementation contract

### 14.1 What Task 22 or a future implementation task MAY implement

*Only after this governance baseline is accepted **and** the required content is
explicitly approved by the Owner/accountant, and only through a task admitted to
`docs/accounting/task-index.md` §7:*

- A versioned Base Chart template store (template version + level shape + nodes),
  as an Accounting-owned product/database asset.
- An explicit, permission-gated, ODR-3-bound **adoption operation** that **copies**
  template definitions into organization-owned `accounts`, producing an
  ODR-1-coherent `(coding_structure_version, accounting_configuration)` pair and
  respecting `postable ⇒ leaf`, ancestor-closure, and mandatory-inclusion.
- An **adoption record** referencing the immutable published template version.
- Enforcement of the mandatory-account semantics (§5) and the customization guards
  (§9).
- A control-role mapping surface **only** when a concrete approved consumer arrives,
  using the effective-dated mapping (OD-20-3).

### 14.2 What a future implementation task MUST NOT invent

Unless explicitly approved by the Owner/accountant, a future agent MUST NOT invent:

- account **codes**;
- account **titles**;
- account **nature** assignments;
- **mandatory account lists**;
- a **control-role catalog**;
- **statutory requirements** or any legal compliance claim;
- **dimension semantics** (OQ-41).

It also MUST NOT: store ledger against a template id; make organization accounts
depend on mutable template rows; silently mutate an adopted chart on a template
upgrade; introduce non-leaf posting; add `Account.control_role`; add speculative
columns (AR-29); or hardcode a four-level hierarchy.

---

## 15. Task 19 / Task 20 integrity

- **Task 19:** ODR-1, ODR-2, ODR-3 are **not** reopened, weakened, or contradicted;
  Task 21 depends on them (coherence, chart ownership, membership chokepoint).
- **Task 20:** OD-20-1…OD-20-6 are **not** reinterpreted; Task 21 refines only the
  portions of OQ-25 those decisions left explicitly open.

## 16. Verification

`git diff --check` → clean (documentation-only). Repository consistency checks in
[`task-21-investigation.md`](./task-21-investigation.md) §4 all PASS. No ADR
promoted; no production/schema/migration/API/DTO/permission/test/frontend change.

## 17. Final status

**ACCEPTED (2026-09-26)** by the explicit Repository Owner record in
[`task-21-acceptance-record.md`](./task-21-acceptance-record.md). This acceptance
is documentation/governance only and authorizes no production implementation.

**OQ-25 remains substantially narrowed, not resolved.** Concrete accounting
content still requires separate Owner/accountant approval; OQ-36, OQ-41 and OQ-43
remain OPEN.
