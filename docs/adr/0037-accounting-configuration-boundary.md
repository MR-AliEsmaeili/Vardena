# ADR-0037: Accounting Configuration Boundary — Vardena Base Structure + Standard Control Roles + Organization Configuration, Bounded by Invariants

- **Status:** Proposed (Owner decisions Q1/Q2/Q4/Q6/Q7/Q17 recorded 2026-09-25 —
  Task 17C, documentation only; **not Accepted**, no self-acceptance)
- **Date:** 2026-09-25
- **Implements:** nothing. No base/template chart, control-role table, dimension
  table, configuration endpoint, permission, seed or migration is added by this ADR.
- **Owner source:** [`docs/tasks/task-17/task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md)
  Q1, Q2, Q4, Q6, Q7, Q17 (Decision D)
- **Register:** [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (rows Q1/Q2/Q4/Q6/Q7/Q17, discrepancies **D-5**, **D-12**)
- **Builds on:** ADR-0028 (configuration foundation: versioned root, single ACTIVE,
  operational freeze), ADR-0026; contract §8.1, §8.7 (AC-D-09), §9.1 (AC-D-10),
  §10 (AC-D-11…AC-D-14), §11 (AC-D-15), §25;
  [`configurability-architecture.md`](../architecture/domain/configurability-architecture.md) §1/§2;
  AR-29/AR-31, AG-09; OQ-25 (content), OQ-41 (dimension policy), OQ-22/OQ-55

## Context

The Owner confirmed the hybrid model the repository already decided in mechanism —
Vardena owns accounting/control semantics, the organization owns its account
structure — and added two things the repository does **not** have: (a) Vardena ships a
**standard/base Accounting structure** (Q2), and (b) **Control Roles are Vardena
standardized**, with only the roles that active Accounting operations require being
mandatory (Q4). Today: depth/level titles/digit lengths/postability defaults are
configurable and version-pinned (`coding_structure_versions` + `_levels`,
`accounting_configurations` + `_levels`, `MAX_CODING_STRUCTURE_DEPTH = 8`,
`MAX_ACCOUNT_CODE_LENGTH = 32`), but there is **no** template chart, no seeded
structure, no `control_role` column or mapping table (the schema comment defers both
`control_role` and `reserved_ranges`), and no dimension/floating-detail table
(contract-only, OQ-41). Contract §1.2 non-goal 1 explicitly refused to define account
codes, titles or a chart template — so Q2 is a new commitment, recorded as
discrepancy D-5, whose *content* stays expert-gated.

## Decision

1. **Configurable, bounded level count (Q1).** The number of accounting code levels is
   **never hardcoded to four**; `گروه / کل / معین / تفصیلی` is level *vocabulary*, not
   four tables or a constant (§8.1/AC-D-06). An organization configures level count,
   titles, digit lengths, `level_kind` labels and per-level posting defaults inside a
   **controlled Vardena-supported structure**: code-defined architecture caps
   (`max_depth ≤ 8`, total code length ≤ 32) and the version/pinning rules of ADR-0028
   and contract §9.4. Configurable ≠ unlimited arbitrary hierarchy; raising a cap is a
   code change with an ADR note, not customer configuration (§9.1).
2. **Hybrid model (Q2).** Vardena defines accounting/control **semantics**
   (invariants, control roles, level mechanics, posting rules shape, reporting sources);
   the organization owns its **account structure** (levels, titles, digit lengths,
   accounts, role mappings) as versioned configuration data.
3. **A Vardena base Accounting structure exists and is configurable (Q2).** Vardena
   provides a standard/base structure that an organization adopts and then configures.
   It must ship as **versioned configuration data or a template artifact** — never as
   per-customer code branches, never as hardcoded account rows in domain logic, and
   never as a seed that silently creates accounts in an existing organization. Its
   **content** (which codes, which Persian titles, which level shape, which role
   mappings) remains EXPERT-GATED under **OQ-25** and is *not* decided here
   (discrepancy D-5: nothing of it exists in the repository today).
4. **Control Roles are Vardena-standardized (Q4, confirming AC-D-09).** The role
   vocabulary is code-defined (adding a role is a code change, the ADR-0023 §2
   document-type pattern); organizations map **their own accounts** to those roles
   once, as effective-dated, permission-gated, audited configuration; posting rules and
   statutory profiles reference **roles, never free customer codes**.
5. **Mandatory-ness is demand-driven (Q4).** Only roles required by **active**
   Accounting operations are mandatory for an organization: a role becomes required
   when a shipped operation consumes it (a posting rule, a year-transition document, a
   control report), not because a fixed list says so. Which roles those are, and the
   role list itself, stay EXPERT-GATED under OQ-25 until the consuming operation is
   authorized — no role is invented by this ADR (AR-31/AG-09).
6. **Detail accounts: both kinds (Q6, confirming AC-D-15/§11.2).** Tree-based detail
   accounts (the deepest configured level of the account tree) **and** floating detail
   items (`تفصیلی شناور` — outside the tree, one identity, no nature of its own,
   combinable with any compatible account) are both supported; which an organization
   uses, and where, is configuration — not a product fork and not a either/or default.
7. **Dimensions: configurable, typed, capped (Q7, confirming AC-D-11…AC-D-14).** A
   general dimension model (cost center, project, branch, counterparty, …) with a
   configured count under a code-defined cap, typed item tables, optional logical
   master-data binding, and a per-(account, dimension) `requirement` ∈
   `required | optional | forbidden` validated on the line (AC-I-18). **Never** a giant
   EAV structure and **never** a giant JSONB blob for ledger dimensions
   (`configurability-architecture.md` §5.2, contract §10.6, AR-29). The per-dimension
   default policy, count and binding rules remain **OQ-41**.
8. **Configurability principle (Q17, Decision D).** The Accounting Core stays
   standardized, safe and integrity-preserving; a Configuration Layer provides high
   flexibility; and configuration may **not** violate: the domain invariants
   (contract §25, AC-I-01…AC-I-22), authorization (ADR-0016, AR-21/AR-22, no wildcard —
   OQ-21), auditability (contract §23, AR-23), tenant isolation (ADR-0021/ADR-0025,
   AC-I-01/16) or data integrity (AR-13, AC-I-05/06/07/11/15). A configuration that
   would violate one is **refused by validation**, not merely discouraged by
   convention. *High configurability does not mean unrestricted configurability*: where
   the supported vocabulary cannot express a need, that is a product gap to design
   (`configurability-architecture.md` §2 anti-pattern guard), never a hole to open —
   no free-form scripts, expressions, user SQL or per-customer logic in configuration.

## Consequences

- Everything above that is *mechanism* already exists and is unchanged
  (configurable levels/digit lengths/postability defaults, versioning + pinning,
  single ACTIVE, operational freeze). Everything that is *content or new capability*
  (base structure, control roles and their mappings, dimensions, floating details)
  remains an unimplemented candidate in
  [`docs/accounting/task-index.md`](../accounting/task-index.md) §4, each needing its
  own task per §7 — this ADR authorizes none of them.
- OQ-25 stays OPEN (role list, mandatory roles, base-structure content, per-level
  posting policy, deactivation guards, statutory layouts); OQ-41 stays OPEN (dimension
  count/defaults/binding); OQ-22/OQ-55 stay OPEN (branch/department as dimensions).
- A future base-structure delivery must be reviewable as data: versioned, documented,
  Persian-titled, mapped to control roles, and adoptable without editing an
  organization's existing chart (ADR-0035 governs any later re-coding).
- Control roles and dimensions widen the *configuration* surface, not the ledger: no
  speculative column may be added before a consuming operation exists (AR-29) — the
  reason `control_role` and `reserved_ranges` are still absent from the schema.
- Risk recorded: a customer request for "custom level semantics", "a custom invariant
  switch" or "a formula field on accounts" is refused by §8 and must be answered with a
  product-gap analysis, not a configuration extension.

## Links

- Register: [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md)
- Contract: [`docs/accounting/domain-contract.md`](../accounting/domain-contract.md) §8.1, §8.7, §9.1, §10, §11, §25, §31 addendum
- Configurability: [`docs/architecture/domain/configurability-architecture.md`](../architecture/domain/configurability-architecture.md) §1/§2/§4
- Evidence: `backend/prisma/schema/accounting.prisma` (schema header: `control_role`
  and `reserved_ranges` deferred), `backend/src/modules/accounting/domain/coding-structure.ts`
  (`MAX_CODING_STRUCTURE_DEPTH`, `MAX_ACCOUNT_CODE_LENGTH`),
  `backend/src/modules/accounting/domain/accounting-configuration.ts`
- Related: ADR-0028, ADR-0034 (posting/aggregation), ADR-0035 (code migration),
  ADR-0036 (legal profiles consume roles), OQ-25, OQ-41
