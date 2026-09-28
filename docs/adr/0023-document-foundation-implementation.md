# ADR-0023: Document Foundation Implementation — Type Registry, Numbering, Relations

Status: Accepted (implemented by Task 8; ADR recorded during Task 9.6 hardening, 2026-09-13)
Date: 2026-09-13

## Context

ADR-0019 decides the document foundation: typed document tables rather than
one universal table, shared mechanics for numbering and relations, and
controlled cross-module references. It specified *what* the platform owns but
not the implementation binding: where document types are declared, how
numbers are allocated under concurrency without gaps or duplicates, how a
retry of an allocation behaves, and how documents reference each other
without cross-module foreign keys. Task 8 implemented it; Task 9.6 reviewed
its idempotency while hardening the inventory ledger (ADR-0022).

## Decision

1. **Four tables in schema `documents`.** `document_type_configs` (per
   organization configuration for a registered type), `numbering_series`
   (one run of serials per organization + document type + scope key, with
   strategy, zero-pad width, reuse policy and `last_value`),
   `numbering_allocations` (every number handed out, the allocation ledger)
   and `document_relations` (typed links between documents). No universal
   documents table; business documents get their own typed tables later.
2. **The type catalogue is code, not admin data.** A document type exists
   only if application code registers it in `DocumentTypeRegistry`
   (module + snake_case type, lifecycle kind, default numbering).
   `document_type_configs` overrides configuration for a registered type in
   an organization; it can never invent a type. Unknown types are 404/422,
   not lazily created.
3. **Allocation is a row-locked transaction.** Allocating takes
   `SELECT … FOR UPDATE` on the series row, increments `last_value`, and
   writes the allocation in the same transaction. Lost races serialise; no
   two callers receive the same serial. Gap policy (no reuse on rollback vs
   reuse) is an explicit per-series `reuse_policy`, not an accident.
4. **Allocations are idempotent on a caller reference.** Replaying an
   allocation with the same idempotency reference returns the stored
   allocation; a reference reused with different intent is rejected. As with
   inventory operations (ADR-0022), only caller-supplied intent participates
   — no server clock, no generated id.
5. **Relations are logical, not database FKs.** A relation binds
   `(source_module, source_type, source_id)` →
   `(target_module, target_type, target_id)` with a typed, registry-checked
   relation kind and optional copy semantics. There is deliberately no FK
   across module schemas (AR-07/08); allowed pairs are application rules
   checked by the service. Relations are append-only history with the
   platform's standard pagination.
6. **Mechanics are shared, ownership stays local.** Every business module
   owns its own document tables and lifecycle; the documents module supplies
   numbering, configuration and relations through public services and the
   registered `Document.*` permissions (ADR-0006/0016). It never reaches into
   a business table.
7. **Organization scoping is structural (ADR-0021).** Every foundation row
   carries `organization_id`; by-id actions are scoped and a cross-organization
   answer is 404. The optional deployment pin (ADR-0025) enforces single-org
   confinement on top.

## Consequences

- Adding a document type is a code registration plus configuration — not a
  schema change to a universal table and not an admin free-text field.
- Duplicate document numbers are impossible under concurrency (row lock +
  allocation ledger); number gaps under the no-reuse policy are accepted and
  auditable rather than hidden.
- Cross-module document integrity is application-enforced; an orphan relation
  is possible only through a service bug, mirroring the workflow binding
  trade-off in ADR-0024.
- Lifecycle actions (posting, cancellation, effects on inventory/accounting)
  are NOT part of this foundation; they ship with each business document
  module (workflow integration via ADR-0024).

## Links

- Implements: ADR-0019; shared idempotency rule: ADR-0022; logical-binding prior art: ADR-0024
- Scope: ADR-0021; RBAC: ADR-0006/0016
- Tests: `test/documents.e2e-spec.ts`, `test/documents-live.e2e-spec.ts` (locking, real Postgres in CI)
