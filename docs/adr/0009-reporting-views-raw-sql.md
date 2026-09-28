# ADR-0009: Reporting via Module Views + Scoped Raw SQL

Status: Accepted
Date: 2026-09-10

## Context

Reporting is first-class (operational, financial, inventory, dashboards) and the
requirements explicitly forbid forcing complex reports through inefficient ORM
queries. At the same time, uncontrolled raw SQL scattered through the codebase
would destroy reviewability, security (injection), and the module-boundary
model; and storing report SQL in the database would defeat versioning and
AI-agent documentation rules.

## Decision

A three-tier data-access policy for reports (full design in
`docs/reporting-strategy.md`):

1. **Module-owned SQL views first.** Each module defines its reporting views in
   its own `data/`/`reports/` (view joins stay inside the owning schema). Views
   are versioned with the module and carry regression tests (fixture → expected
   output) so migrations cannot silently break reports.
2. **Parameterized raw SQL in the Reporting module** for cross-module reports
   that compose views — the only place raw SQL may reference multiple schemas.
   Identifiers come from the report-definition whitelist; values are always
   bound parameters.
3. **Prisma allowed** for simple single-table reports.

Supporting rules:

- **Report definitions are code** (registry in the reporting module): id,
  permission, source, columns, filter whitelist, limits. User _configurations_
  (saved filters, dashboards) live in Customization — definitions ≠ user config.
- One query pipeline (filter → group → sort → paginate → cap) serves UI,
  **Excel export** (via the Excel module), and **printable reports** (via the
  Print module's `Report:<id>` document type).
- Performance guardrails: per-report permission, row caps (5k UI / 50k export),
  query timeout with async-job escalation (Jobs module), read-only DB connection
  for report execution.

## Consequences

- Complex reports get the SQL they need, contained in two reviewable places
  (module views, reporting module).
- Module owners are accountable for their views' performance (indexes follow
  documented query patterns — database-strategy §11).
- Dashboards compose report widgets; no second query engine is needed.
- v1 grouping scope is single-column + group totals (OQ-10); heavier
  aggregations use purpose-built views — a pragmatic, extensible limit.
