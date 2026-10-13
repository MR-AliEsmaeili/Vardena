# ADR-0020: Organizational Scope, the Organization Module and Master-Data Ownership

Status: Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21)
Date: 2026-09-11

## Context

`docs/open-questions.md` OQ-01 assumes one organization per deployment, but the
repository never decided how organizational structure (branch, department), the fiscal
calendar, cross-module configuration (numbering, taxes, workflow versions) or
master-data ownership (parties, employees) are modeled. `docs/modules.md` currently
gives customers to Sales and suppliers to Purchasing — which duplicates an entity (one
supplier is often also a customer) and makes cross-module counterparty reporting
impossible (AR-08). Configuration without an owner would fragment across modules, and
the kernel must stay technical (AR-06).

## Decision

1. **Scope model:** one organization per deployment (OQ-01 assumption); **branch** is a
   first-class scope column on documents, movements, journals and stock balances;
   **departments** are organizational master data; warehouses belong to exactly one
   branch. Branches are **not** legal entities or separate books. Multi-company and
   multi-tenancy stay deferred (each needs its own ADR; no speculative columns).
2. **New `organization` module** (schema `organization`) owning:
   - organization settings and the organization structure (branches, departments,
     employees as minimal reference data);
   - the **fiscal calendar** (fiscal years and periods) used by posting/reporting;
   - **cross-module configuration**: numbering series, tax definitions, required-field
     policy, effective-dated settings;
   - **workflow definitions and versions** (ADR-0018) and **custom-field definitions**
     (governed JSONB, `docs/architecture/domain/configurability-architecture.md` §5);
   - **party master data** (customers/suppliers as one party with capability flags,
     plus contacts, addresses, bank accounts).
   Other modules read this data **only** through the module's public application
   services (AR-07) and never read its tables.
3. **Commercial ownership stays with the operational modules:** Sales owns price lists,
   sales documents and customer-specific commercial settings; Purchasing owns supplier
   price lists and purchasing documents; both reference `party_id`. The corresponding
   `docs/modules.md` entries (customers/suppliers ownership) are updated as part of
   accepting this ADR.
4. **Master-data lifecycle** follows `docs/architecture/domain/master-data-strategy.md`
   §7: disable/archive before delete; soft delete only for unreferenced records;
   accounting dimensions are never deleted; used configuration is never edited in place.
5. **Historical integrity:** documents/journals/movements store both the reference
   (id) and the values they used (snapshots) plus the configuration version where
   applicable, so history is never reinterpreted by later configuration changes.

## Consequences

- One place answers "how does this business work?" (calendar, numbering, workflow,
  taxes, scope) with one permission namespace and one audit trail.
- Party duplication disappears; receivable/payable reporting per counterparty becomes
  possible; Sales/Purchasing specialize without owning identity.
- `docs/modules.md`, `docs/database-strategy.md` (schema table) and the module map gain
  the `organization` module; schema `organization` is added by its own first migration
  (after this ADR is accepted and the gate items are resolved).
- Everything depending on the organization scope (`branch_id`) must be present from the
  first ERP migration — adding it later would mean rewriting historical facts.
- Rejected alternatives: configuration in `kernel/` (AR-06 violation), per-module
  configuration ownership (inconsistent versioning/scoping), nullable `company_id`
  everywhere "for the future" (speculative, AR-29 forbids architecture-by-anticipation).

## Links

- Design: `docs/architecture/domain/master-data-strategy.md` §2/§5,
  `docs/architecture/domain/configurability-architecture.md` §3.
- Related: OQ-01, OQ-22, OQ-25, OQ-31, OQ-32, AR-06/07/08/09, ADR-0018, ADR-0019.
