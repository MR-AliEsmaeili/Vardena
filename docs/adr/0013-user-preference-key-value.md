# ADR-0013: User Preferences as Validated Key-Value

Status: Accepted
Date: 2026-09-10

## Context

Vardena must support user customization: table column visibility/order, saved
filters, dashboard layouts, themes, UI preferences, print preferences, report
preferences. A table per preference type is over-engineered for v1; an
unvalidated free-form KV store invites corruption and unbounded growth.
Requirements: extensible, not over-engineered, and *preference ≠ business data*.

## Decision

- **Single store** `customization.user_preferences`: (user_id, category, key) →
  JSONB value, `uq(user_id, category, key)`, `updated_at`.
- **Categories** (fixed set, extensible by code): `ui.table`, `ui.filters`,
  `ui.dashboard`, `ui.theme`, `ui.general`, `print`, `report`.
- **Code registry is the contract:** each category defines its allowed keys and
  a JSON schema for the value (in the Customization module, contributed by
  consuming features). The server **rejects unknown keys and schema-invalid
  values** (400) — the store cannot drift into arbitrary data.
- **v1 scope:** per-user only. Organization defaults and shared (role/team)
  saved filters are deferred (OQ-09) — the schema already tolerates a later
  `scope` column without breaking existing rows.
- **Boundary rule:** a preference must never change *business* behavior. If a
  setting changes what the system does (not just how it looks/behaves in the
  UI), it is a business rule and belongs in the business module (and likely an
  OQ). Examples of legitimate preferences: column order, saved filter presets,
  dashboard layout, theme, paper size, default report page size.

## Consequences

- New preference types = registry entry + schema (one small PR), no new tables.
- The server-side registry makes preferences safe for the UI to write blindly
  (client writes → server validates).
- Dashboard layouts, saved filters, and grid state are all *data* in this store
  (referencing report ids / entity filters) — the reporting strategy builds on
  it directly (reporting-strategy §5).
- Export/import of a user's preferences (machine migration) is a later
  extension (admin endpoint), not v1.
