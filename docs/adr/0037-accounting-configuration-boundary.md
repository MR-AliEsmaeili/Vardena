# ADR-0037: Accounting Configuration Boundary — Base Chart, Consumer-First Control Roles, and Line-Level Dimensions

- **Status:** Proposed — Task 17C is accepted, but this ADR remains Proposed pending its separate adoption/implementation gate. **Task 20 Owner Decisions OD-20-1, OD-20-2, OD-20-3 and OD-20-6 are recorded here as authoritative documentation updates; Task 20 does not self-accept this ADR** (2026-09-26).
- **Date:** 2026-09-25; amended 2026-09-26 by Task 20 decision resolution (documentation only).
- **Implements:** nothing — no base/template chart, control-role table/catalog, mapping table, dimension table, configuration endpoint, permission, seed or migration is added or authorized.
- **Owner source:** Task 17C Q1/Q2/Q4/Q6/Q7/Q17; **Task 20 OD-20-1…OD-20-3 and OD-20-6**. Canonical register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) §12.
- **Builds on:** ADR-0028, ADR-0026, ADR-0016, ADR-0021/0025; ADR-0033/0034/0035; contract §8.1, §8.7, §9.1, §10, §11, §25; [`configurability-architecture.md`](../architecture/domain/configurability-architecture.md) §1/§2/§4; AR-29/AR-31, AG-09; OQ-25 (content), OQ-41 (dimension content), OQ-22/OQ-55.

## Context

The Owner confirmed the hybrid boundary: Vardena owns accounting/control semantics and product templates; organizations own their adopted chart/accounts and configuration inside that supported model. Task 20 resolved the remaining Task 20 ambiguities without authorizing implementation: the Base Chart is an Accounting-owned versioned product/database asset adopted explicitly into each organization; control roles are introduced consumer-first and mapped through an independent effective-dated relation; dimensions initially attach analytically at transaction/document-line level and aggregate through the Accounting/read layer when a concrete consumer requires it.

## Decision

1. **Configurable, bounded level count (Q1).** Accounting levels are not hardcoded to four; level count, titles, digit lengths, `level_kind` labels and per-level posting defaults are versioned configuration bounded by code-defined caps.
2. **Hybrid ownership model (Q2 / OD-20-1).** Vardena defines accounting/control semantics and owns the reusable **Base Accounting Chart template** as a versioned Accounting product/database asset. Adoption is an explicit, permission-gated organization operation that creates organization-owned `Account` identities.
3. **Template identity never becomes ledger identity (OD-20-1).** Template node identifiers are provenance/product-template identifiers only. Ledger/document references for an organization always use the adopted organization-scoped `Account.id`. Future Base Chart versions may exist independently from charts already adopted by organizations.
4. **Base Chart content is not decided here (OD-20-1).** The mechanism and ownership model are decided; the actual list of accounts, codes, Persian titles, natures, postability and any role mappings require explicit accounting/domain content approval. No agent may invent that content.
5. **Control roles are consumer-first (OD-20-2).** Vardena does not create a speculative generic control-role catalog. A role is introduced only when a concrete approved consumer needs that semantic role, such as Inventory → Accounting integration, reconciliation, reporting or settlement logic. The role's semantics must be justified by that consumer.
6. **Control-role assignment shape (OD-20-3).** The authoritative association between an account and a control role is an independent effective-dated mapping, conceptually `AccountControlRoleAssignment(account_id, control_role_id, effective_from, effective_to, audit metadata)`. This preserves Account identity and supports historical interpretation, reassignment, effective dating and auditability.
7. **Rejected role artifact (OD-20-3).** The final architecture is **not** a nullable `Account.control_role` column as the primary artifact. Contract text that formerly listed `control_role` as an account attribute is read as a pointer to the future assignment relation, not as schema authorization.
8. **Detail accounts and floating details (Q6).** Tree-based detail accounts and floating detail items are both supported mechanisms. Exact usage remains configuration and future implementation scope.
9. **Dimensions (Q7 / OD-20-6).** Dimensions are initially transaction-line-level analytical assignments. They are not `LedgerEntry` identity, do not widen ledger entries with arbitrary dimension columns, and are never a generic JSONB/EAV payload. Dimension-aware aggregation/reporting is performed through Accounting/read logic when a concrete reporting consumer requires it; a separate projection architecture requires its own justified future decision.
10. **Configurability principle (Q17).** Configuration may not violate accounting invariants, authorization, auditability, tenant isolation or data integrity. Unsupported needs are product gaps, not openings for scripts, user SQL, per-customer logic, giant JSONB or EAV.

## Current implementation boundary / non-goals

The existing mechanism (configurable levels/digit lengths/default postability, versioning, pinning, single ACTIVE, operational freeze, ODR-1 coherence, ODR-2 Chart Tree, ODR-3 organization chokepoint) is unchanged. The Base Chart template/adoption operation, control-role vocabulary/mapping, dimensions and floating details remain unimplemented and require future tasks admitted through `docs/accounting/task-index.md` §7. Task 20 creates no table, enum, seed, catalog, API, service, projection, permission or UI.

## Consequences

- **OQ-25 remains OPEN** for base-chart content, the concrete role catalog/mandatory set and other chart-governance content. OD-20-1/2/3 resolve only mechanism, sequencing and artifact shape.
- **OQ-41 remains OPEN** for dimension count/defaults/binding/governance/area applicability. OD-20-6 resolves only the initial persistence/aggregation boundary.
- Future Base Chart adoption must produce an ODR-1 coherent `(coding_structure_version, accounting_configuration)` pair and pass the ODR-3 membership chokepoint.
- Future control-role implementation must arrive with a real consumer and use an effective-dated assignment relation, not `Account.control_role`.
- Future dimensions must start from typed line-level assignments; ledger-column widening, generic JSONB and speculative projections are rejected unless a later approved consumer-driven task reopens the architecture.

## Links

- Register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (D-5, D-12, OD-20-1…OD-20-3, OD-20-6) · Contract: [`domain-contract.md`](../accounting/domain-contract.md) §8.1, §8.7, §9.1, §10, §11, §25, §31/§32 addenda · Configurability: [`configurability-architecture.md`](../architecture/domain/configurability-architecture.md) §1/§2/§4
- Evidence: `backend/prisma/schema/accounting.prisma` (no control-role/dimension/code-history production model), `backend/src/modules/accounting/domain/coding-structure.ts`, `backend/src/modules/accounting/domain/accounting-configuration.ts`, `backend/src/modules/accounting/domain/ledger-entry.ts`
- Related: ADR-0028, ADR-0033, ADR-0034, ADR-0035, ADR-0036, OQ-25, OQ-41
