# ADR-0026: Accounting Bounded Context — Module Boundary, Fiscal-Calendar Ownership and the System-Posting Contract

- **Status:** Accepted (accepted 2026-09-14 — the design decision from Task 10.1,
  before Task 10.2 writes any Accounting schema)
- **Date:** 2026-09-14
- **Accepted:** 2026-09-14
- **Refines / partially supersedes:** ADR-0020 §2 (fiscal-calendar ownership)
- **Implements:** nothing yet — this ADR gates the first Accounting migration

## Context

Task 10.1 had to fix the Accounting boundary before any accounting schema exists,
because a wrong accounting abstraction contaminates Inventory, Sales, Purchasing,
Treasury, Reporting, Tax, year closing and Audit. Three things were undecided and are
architecture, not accounting policy:

1. **Who owns the fiscal calendar.** ADR-0020 §2 and `docs/modules.md` (Organization
   entry) give fiscal years/periods to the **Organization** module;
   `docs/architecture/domain/accounting-domain-analysis.md` §1 and blueprint §9 give
   periods and the calendar to **Accounting**. Both cannot be true (AR-08: one owner per
   fact), and ADR-0020 is still Proposed.
2. **Where "financial area" (`حوزه مالی`) lives**, given that Organization already owns
   organizations/branches and that Iranian ERP practice treats financial areas and
   branches as separate concepts.
3. **Through which contract another module may cause an accounting effect**, now that
   ADR-0022 (idempotency ledger) and ADR-0023 (numbering, type registry, logical
   references) exist and ADR-0005 only says "events, Accounting maps them".

The full analysis is [`docs/accounting/domain-contract.md`](../accounting/domain-contract.md)
(AC-D-01…AC-D-35, AC-I-01…AC-I-22).

## Decision

1. **One `accounting` module, one `accounting` schema** (ADR-0008), owning: financial
   areas, fiscal years, accounting periods, the coding structure and chart of accounts,
   control-role mappings, detail dimensions/groups/items (floating details), accounting
   documents + lines + line dimension assignments, posting/finalization/correction,
   posting rules, the system-posting idempotency ledger and balance projections.
2. **Fiscal years, accounting periods and financial areas are Accounting-owned.** The
   module that enforces a rule owns the state the rule depends on: period/year status
   gates posting, so it cannot live in a module that neither validates nor posts
   (AR-04/AR-08). This follows the accepted precedent that numbering went to Documents
   (ADR-0023) and workflow definitions went to Workflow (ADR-0024) rather than to
   Organization as ADR-0020 §2 had planned. **Organization keeps** organizations,
   branches, departments, employees and parties; ADR-0020 §2's "fiscal calendar" clause
   is superseded when this ADR is accepted. Other modules read calendar/area data only
   through Accounting's public services (AR-07).
3. **A financial area is a bookkeeping scope, not a tenant and not a company.** Every
   accounting row carries `organization_id` (ADR-0021) and, where applicable,
   `financial_area_id`; documents belong to exactly one area. The chart of accounts and
   coding structure stay organization-scoped with area applicability. No second
   authentication/tenancy mechanism, no `company_id`, no consolidation, no inter-area
   settlement (OQ-22/OQ-31 remain the owners of multi-company).
4. **Accounting documents are typed tables composed with existing platform mechanics**:
   the Document Foundation for type registration, numbering and relations (ADR-0023) and
   the Workflow Foundation for review/approval (ADR-0024). Lifecycle is the Foundation's
   `draft` phase + `temporary`/`final` states — no `initial`, no `void`, no universal
   document table, no EAV, no JSONB ledger, no rules engine.
5. **One source-posting contract for every source module**: scope, financial area,
   source module/entity/id/operation, `operationKey`, business date, description and a
   validated accounting payload naming accounts **or control roles**. Idempotency uses an
   Accounting-owned posting-operation ledger keyed by `(organization_id, operation_key)`
   with `request_hash` over canonical client intent only — the ADR-0022 §3/§4 pattern,
   applied unchanged. Source modules never read or write `accounting.*`; Accounting never
   reads another module's tables (AR-07/AR-16).
6. **Delivery semantics stay open, and that is a gate.** The posting interface is
   delivery-agnostic (transactional subscription per ADR-0005 vs durable queue/outbox per
   AR-14). The event bus is in-memory only (ADR-0024 §9 gap), so **no production
   system-generated posting may be enabled before OQ-39 is resolved**.
7. **Organization isolation is inherited verbatim** (ADR-0021 §3/§4, ADR-0022 §8,
   ADR-0025): scope-qualified by-id reads answering 404 — never 403 — on mismatch,
   explicit `organizationId` on every list, the global deployment pin guard, and
   service-level re-checks. Accounting adds no isolation mechanism of its own.

## Consequences

- Task 10.2 (Fiscal Year + Financial Area Foundation) can be implemented against a fixed
  boundary; chart-of-accounts, dimension, document and reporting tasks follow the gates
  in `docs/accounting/domain-contract.md` §28.
- `docs/modules.md` (Organization + Accounting entries, event catalog) and
  `docs/architecture/domain/` pointers must be updated when Accounting is implemented
  (AG-07); the fiscal-calendar contradiction is now recorded instead of latent.
- Accounting becomes the authority for "may this be posted now", so period/year
  operations need their own granular permissions and audit trail (`Accounting.*` codes —
  contract §22). No wildcard, no single "Accounting Manager" role assumption (OQ-21/
  OQ-14).
- Policy that must not be invented stays open: OQ-39 (delivery durability), OQ-40
  (financial-area semantics/multiplicity), OQ-41 (detail-dimension requiredness), OQ-42
  (posting mode A/B defaults and approval authority), OQ-43 (Iranian statutory/e-ledger
  requirements), plus existing OQ-03/11/12/23/24/25/27/30/31.
- If this ADR is rejected, fiscal years/periods stay with Organization and Accounting
  must call Organization's public service for every posting validation — an extra
  cross-module read inside every posting transaction, and a split owner for the posting
  gate. That is the cost the decision avoids.

## Links

- Contract: [`docs/accounting/domain-contract.md`](../accounting/domain-contract.md)
- Builds on: ADR-0005 (events), ADR-0008 (schemas), ADR-0009 (reporting), ADR-0017/0022
  (ledger + idempotency), ADR-0019/0023 (documents), ADR-0018/0024 (workflow),
  ADR-0020/0021/0025 (scope)
- Design lineage: `docs/architecture/domain/accounting-domain-analysis.md`, D-03/D-11/
  D-12/D-19/D-20/D-21, AR-08/13/16
- Open questions: OQ-39 … OQ-43 (new), OQ-03/11/12/22/23/24/25/27/30/31 (existing)
