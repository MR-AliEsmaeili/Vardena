# ADR-0006: RBAC with Granular Permissions

Status: Accepted
Date: 2026-09-10

## Context

ERPs need fine-grained access control: a warehouse clerk may create receipts
but not view journals; an auditor should read everything without write rights.
Coarse roles ("user/admin") cannot express this. Permissions that exist only in
a database (free-text) are dangerous: they can be granted with no code actually
enforcing them.

## Decision

- **Model:** users → roles → permissions (RBAC), evaluated in the **backend
  only** (route guard + application-service check; frontend visibility is
  UX-only — AR-21).
- **Granular permission codes:** `Module.Entity.Action`
  (e.g. `Inventory.Receipt.View|Create|Edit|Delete`), with domain actions
  (`Post`, `Approve`, `Import`, `Export`, `Print`, `Sync`, `Manage`) defined per
  module.
- **Code registry is the source of truth:** each module registers its
  permissions in code (code, description); a sync step mirrors them into
  `rbac.permissions` for the admin UI. A permission no code checks cannot
  exist in the system.
- **Roles** are named, admin-managed sets of permissions; **users** hold roles.
  Permission evaluation is cached per session and invalidated on RBAC changes.
- The RBAC module exposes a public `hasPermission` service used by all other
  modules' guards/services.
- Denials are recorded via the Audit port for security review.

## Consequences

- Audit-grade authorization with a reviewable, complete permission catalog
  (every code maps to code that enforces it).
- New permissions require a code change + registry entry (slightly slower than
  free-text, deliberately — prevents phantom permissions).
- Seed role set is a business decision (OQ-14); the mechanism works with
  creator-defined roles from day one.
- Future ABAC needs (row-level/attribute conditions) would extend the
  evaluation service — an ADR at that time.
