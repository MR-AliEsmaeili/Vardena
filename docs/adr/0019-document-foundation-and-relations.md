# ADR-0019: Document Foundation — Typed Tables, Shared Mechanics, Controlled Relations

Status: Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21)
Date: 2026-09-11

## Context

Vardena will hold many document types (quotation, order, invoice, return, receipt,
issue, transfer, adjustment, journal voucher) in several modules. Two failure modes
are common in ERPs: (a) every document type re-implements numbering, status history
and relations, which then drift; (b) one universal `documents` table with JSONB lines,
which cannot enforce invariants and makes reporting painful.
`docs/architecture/domain/document-architecture.md` evaluates four options; business
flows must also vary per customer without hard-coding one process.

## Decision

1. **Typed, module-owned document tables.** Each document type is a real table with
   typed columns and FKs in its owning module's schema (AR-07/08/09). There is no
   shared `documents` table and no class-table inheritance.
2. **A common document contract** every type follows: `document_number`,
   `document_date`, `status`, `branch_id`, party/currency where applicable, stored
   totals, posting stamps, cancellation stamps, AR-12 columns; lines carry item,
   entered quantity/unit, base quantity, prices, discounts, tax snapshot and the
   typed dimensions (warehouse/location/lot/serial/cost centre/project).
3. **Shared mechanics, not shared data:** a numbering service (configuration-driven
   series, allocated inside the write transaction), an append-only
   `document_transitions` history (per ADR-0018) and a quantity-aware
   `document_links` table.
4. **Document relations use a closed kind list** (`reference`, `derive`, `fulfill`,
   `settle`, `reverse`, `transfer_of`) with **line-level quantity rows**, so partial
   fulfilment and remaining quantities are computable in SQL. Cross-module links are
   **logical (module + type + id)**, never database FKs across module schemas; the
   creating service enforces integrity inside its transaction.
5. **Cancellation and reversal:** unposted documents are cancelled (kept, excluded
   from open reports); posted documents are neutralized by counter-documents linked
   with `reverse` and are never edited (AR-13). The policy details (window, approval,
   cross-period rules) are expert-gated (OQ-27).
6. **Which relations exist automatically is configuration** (ADR-0018 automation
   bindings); which relations are _legal_ is code.

## Consequences

- Type safety, per-type validation and plain-SQL reporting are preserved; shared
  mechanics give uniform behaviour (numbers, history, links) without coupling schemas.
- Partial fulfilment reports ("ordered vs delivered vs invoiced") are queries over
  relation rows, not counter columns that drift.
- Cross-module referential integrity for links is application-enforced; an orphan
  link is possible only through a bug, and a periodic integrity report detects it.
- Adding a document type is a checklist (contract + permissions + transitions +
  relations + print provider), not a framework change.
- The alternative (universal document table / JSONB lines) is explicitly rejected and
  must not be reintroduced as a shortcut.

## Links

- Design: `docs/architecture/domain/document-architecture.md`
- Related: ADR-0018 (workflow), AR-03/04/07/08/10/13, OQ-12 (numbering), OQ-27
  (correction policy).
