# ADR-0008: Single Database, Schema per Module, ULIDs

Status: Accepted
Date: 2026-09-10

## Context

The modular monolith (ADR-0001) needs a database topology that (a) is trivial to
operate on-premise, (b) makes module ownership visible and enforceable, and (c)
keeps the door open to per-module service extraction. "One schema for
everything" hides coupling; "one database per module" is premature distribution
at this scale.

## Decision

- **One PostgreSQL database (`vardena`), one schema per module** (`identity`,
  `users`, `rbac`, `inventory`, `accounting`, … plus `core`, `sync`, `jobs`,
  `excel`, `print`, `customization`, `integration`, `audit`, `notifications`).
- Prisma with **one schema file per module** under `prisma/schema/` — the file
  boundary mirrors the ownership boundary; Prisma models are private to their
  module (AR-07/02).
- **Ownership rules:** a schema is written only by its owning module; the single
  documented exception is the kernel appending `core.domain_events` in any
  transaction (event mechanism). Cross-module reads happen via module-owned
  views (reporting) or public services (application-level) — never via
  cross-schema table access (database-strategy §1).
- **Primary keys: ULIDs** (`text(26)`), generated in the kernel, assigned in
  the application layer — sortable, string-friendly, no central generator,
  sharding-safe.
- **Migrations are the only schema-change path** (expand → migrate → contract
  for risky changes); migrations must be backward-compatible across the deploy
  window (database-strategy §14).

## Consequences

- Ownership is visible in the database itself; boundary violations are
  reviewable (and later CI-checkable) by schema prefix.
- Extraction of module X ≈ giving X its own database + its schema's FKs already
  respect module boundaries (cross-module references are logical, documented).
- Single-node operations remain simple (one backup unit — though OQ-17 RPO/RTO
  still needs business targets).
- Cross-module *reports* join views inside the reporting module's queries,
  keeping joins out of business code (ADR-0009).
