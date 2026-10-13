# Vardena — Reporting Strategy

Status: Accepted (foundation) · Updated: 2026-10-05 (OQ-49 Owner decision noted) · ADR-0009

Reporting is a **first-class ERP capability**: operational, financial, and
inventory reports; dashboards; filters, grouping, sorting, pagination; Excel
export; printable reports; and easy future extension.

> **MVP scope (Owner decision, 2026-10-05 — OQ-49):** MVP = required
> **standard ERP reports** (Accounting, Inventory, Sales, Purchasing,
> Management per the final MVP report catalogue) plus **controlled
> customization only** — filters, date ranges, selectable permitted columns,
> sorting, limited (single-column) grouping, saved report configurations and
> Excel export. **No arbitrary SQL builder, unrestricted query designer,
> unrestricted formula engine, full BI designer or unrestricted drag-and-drop
> report designer in MVP.** This matches the architecture below; no Reporting
> module is implemented yet. Full record:
> `docs/decisions/product/OQ-49-report-builder-mvp-depth.md`.

## 1. Core Design Decisions

1. **Reports are code-defined, not DB-stored.** A report *definition* lives in
   the reporting module's code registry (versioned with the app, typed,
   testable). Storing report SQL in the database is rejected: it defeats
   review, versioning, and the AI-agent documentation rule (AG-07). User
   *configurations* of reports (saved filters, column order, dashboards) live
   in the Customization module — definitions ≠ user config.
2. **Data access is view-first.** Complex reports read **module-owned SQL
   views** (each module owns its reporting views in `data/`/`reports/`), not
   ORM-joined ORM queries. Prisma is fine for simple single-table reports.
   Raw SQL is allowed in the reporting module for cross-module reports —
   always parameterized (AR-11, ADR-0009).
3. **One pipeline, three outputs.** The same query pipeline serves: UI data
   (JSON pages), Excel export (delegated to the Excel module), and printable
   reports (delegated to the Print module via the `Report` document type).
4. **Permissions per report.** Every report carries a required permission
   (e.g. `Report.SalesByPeriod.View`); enforcement is backend (AR-21).

## 2. Report Definition Anatomy

A definition (code registry) specifies:

| Field | Meaning |
|---|---|
| `id` | stable kebab-case id (`inventory-stock-on-hand`) |
| `title` | localized label key (i18n, OQ-02) |
| `module` | owning domain (for permission prefix + view schema) |
| `permission` | required permission code |
| `source` | `view: <schema>.vw_x` · `raw: <parameterized SQL>` · `prisma: <simple spec>` |
| `columns[]` | key, label key, type (text/number/money/date/bool), align, sortable, groupable, summable (for group totals), default hidden? |
| `filters[]` | column, allowed operators (whitelist), default? |
| `defaults` | sort, page size |
| `limits` | row cap override (else global), async-threshold (rows/time) |
| `exports` | excel allowed?, print document type link? |

## 3. Query Pipeline

```
request (reportId, filters, sort, groupBy, page, pageSize)
  → permission check (backend)
  → parse & validate filters against the definition's whitelist (AR-24)
  → build parameterized SQL over the source (views/raw)
  → apply GROUP BY (if groupBy: single column in v1; see §Grouping)
  → ORDER BY (whitelisted columns only) + LIMIT/OFFSET (pageSize capped)
  → execute on read-only connection with query timeout
  → row cap enforcement; over threshold → return "async required"
  → respond { items, total, page, pageSize, columns meta }
```

- **Filter model:** `{ column, op, value }` with per-column operator
  whitelist: `eq, ne, gt, gte, lt, lte, between, in, like, notLike, isNull,
  notNull`. Temporal columns keep their explicit type: `BusinessDate` is a
  canonical Gregorian day (`date`), while an event `Instant` is UTC
  `timestamptz`. BusinessDates render Jalali-first under ADR-0044, with
  canonical Gregorian fallback outside the renderer's range; Instants resolve
  the organization's IANA zone before Jalali-first calendar rendering. OQ-02
  concerns numeral and broader localization policy, not this date/time distinction.
- **Sorting:** single or multi-column, direction whitelisted per column.
- **Counting:** `COUNT(*)` with the same WHERE (for `total`); expensive
  sources may declare `countStrategy: estimate` later (extension).
- **Parameterization:** every value bound as a parameter; `IN` lists
  parameter-expanded with bound elements; no dynamic identifier (column/table)
  from user input — identifiers come from the definition whitelist only.

## 4. Grouping (v1 scope)

- v1: **single-column grouping** with totals for summable numeric/money columns
  (group rows + group-total row), plus sorting within groups. This covers the
  common ERP needs (by warehouse, by customer, by period).
- Ad-hoc multi-dimensional grouping/pivots and arbitrary aggregation builders
  are **later extensions** (design reserved: the pipeline's GROUP BY step is
  already a SQL-building stage; extending it does not change the definition
  contract). Register usage demand as OQ if it blocks a real report — until
  then, express such reports as purpose-built views (a view *can* pre-aggregate).
- Heavy/periodic aggregations (e.g. trial balance by period) belong in
  **materialized views maintained by the owning module** (e.g. Accounting's
  balances), refreshed in-transaction where cheap or by scheduled jobs where not
  (Jobs module). Documented per module.

## 5. Dashboards

- A dashboard = **layout of report widgets** (+ optional KPI blocks referencing a
  report with fixed filters), defined by the user via the Customization module
  (category `ui.dashboard`), referencing report ids + saved filter sets.
- Rendering: each widget calls the standard report data endpoint (same
  permission enforcement per widget). No separate dashboard query engine —
  dashboards compose, they don't duplicate.
- KPIs are report queries returning a single value (type `kpi` column set).
- Refresh: manual + optional short TTL cache per widget (config); no implicit
  long-lived caches of financial data (correctness first).

## 6. Excel Export & Printing

- **Export:** `GET /api/v1/reports/{id}/export` runs the pipeline (no page
  limit, row cap applied — default 50k) and streams XLSX through the Excel
  module (sheet name from report, headers/labels from the definition, number
  formatting per column type). Permission: the report's permission +
  `Excel.Export` module capability. Over cap → async job (Jobs) with
  notification on completion (AG-06 test: cap behavior).
- **Printing:** reports with `exports.print` get a Print document type
  (`Report:<reportId>`) with a default template; user print preferences
  (paper, template choice) come from Customization (`print` category).
  Printable *documents* (invoices, receipts) are Print's separate concern via
  module `documents/` providers (ADR-0012).

## 7. Performance Rules

- **Row caps:** UI default 5k rows, hard 50k; `pageSize` ≤ 500 (AR-24 caps).
- **Query timeout** per report execution (config, default 10 s) → over-limit
  responses with an "run as async job" affordance.
- **Async heavy reports:** execute via Jobs (worker), progress/completion via
  Notifications, result cached as an artifact (Excel module) with the same
  permission-gated download.
- **Read-only connections** for report execution (separate pool role without
  write grants — enforces the read-only contract at the DB level).
- **No ORM-forcing:** if a report needs a join, aggregation, or window function,
  it lives in a module view or parameterized raw SQL in the reporting module —
  never a hand-built Prisma monster (AR-11, ADR-0009).
- Read replicas: not assumed (single-node on-premise v1); the data-access layer
  is abstracted enough (source = view name) that a replica connection string is
  a deployment change, not an architecture change (note for cloud path).

## 8. New Report Checklist

1. Where is the data? → ensure a module-owned view exists (add it in the owning
   module, with a regression test: fixture rows → expected view output).
2. Define the report in the registry (id, permission, columns, filters, limits).
3. Permission registered in the module registry (AR-22) + guard + denial test.
4. Export/print enabled only if requested (and labeled).
5. `docs/modules.md` updated (report list per module) — AG-07.
6. Performance: verify against the documented dataset size (e.g. 100k rows) for
   the dominant filters; index additions go with the view (database-strategy §11).

## 9. Testing Conventions (AG-06)

- **View regression tests:** every module view has a test (seed fixtures →
  assert view output) that runs in CI — migrations must not silently break
  reporting.
- **Pipeline tests:** filter whitelist enforcement, sort whitelist, pagination
  math, row-cap behavior, async-threshold trigger.
- **Permission tests:** report access denial paths per report type (spot-checked
  per module).
- **Export tests:** generated XLSX structure for a small fixture set (headers,
  types, caps).
