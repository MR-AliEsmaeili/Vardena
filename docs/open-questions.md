# Vardena — Open Questions

Status: Living document · Updated: 2026-09-10

Rules for this file (AG-09): business rules and genuinely ambiguous architecture
are **never invented**. Each item gets a stable id (`OQ-xx`), is referenced from
the docs that are affected, and carries the *temporary assumption* used until it
is resolved (clearly labeled as an assumption, not a rule). When resolved, the
entry moves to "Resolved" with a date and a link to the deciding ADR (if
applicable), and affected docs are updated in the same change.

Format: **id · area · question · impact · assumption (if any) · owner**

## Open

| id | Area | Question | Impact | Assumption until resolved | Owner |
|---|---|---|---|---|---|
| OQ-01 | Tenancy | Is each Vardena deployment single-organization (on-premise), or must one instance serve multiple organizations? | Schema-wide (`organization_id`), authorization scoping, isolation guarantees, cloud path | Single organization per deployment (no `organization_id` in v1 schemas) | Product |
| OQ-02 | Localization | Primary UI language(s)? Jalali (Persian) calendar primary? Number/date display format (Persian digits)? | i18n dictionary, Day.js setup, formatters, report labels, print templates | UI text centralized in i18n dict; DB stores ISO 8601 UTC; display defaults to Gregorian/en until decided | Product |
| OQ-03 | Money | Which currencies (IRR only? RMT? multi-currency)? Decimal precision per currency? | Money columns, display, accounting ledger | `numeric(18,2)` columns; currency field on ledger tables; display precision not hardcoded | Product/Finance |
| OQ-04 | Integration | FaraPayam legacy ERP: service contract (REST/SOAP?), auth mode, data model, sync scope (which entities), cadence, direction (in/out/both), bootstrap import scope | Integration adapter, sync design, bootstrap import | Adapter is a stub exercising the port with mocked fixtures; no real calls | Product + legacy ERP vendor |
| OQ-05 | Integration | Iranian Taxpayer System: which flows (e-invoices? returns? which document types)? Submission vs status polling? Credentials & sandbox? | Taxpayer adapter, sales/accounting events to outbox | Not implemented; outbox pattern already supports adding it | Product |
| OQ-06 | Security | Deployment TLS posture on local networks? Session policies (idle/absolute lifetimes, concurrent session max)? MFA required for any role? Self-service password reset channel? | Session config, cookie flags, login flow, notifications | HTTPS recommended; idle 30 min / absolute 12 h / concurrent sessions allowed; MFA deferred; admin-initiated reset only | Product/IT |
| OQ-07 | Integration | Payment services: which providers, flows (online receipts? refunds?), reconciliation model? | Payment adapter, sales module flows | Not implemented | Product |
| OQ-08 | Storage | Generated artifacts (PDFs, import files): local volume in v1 (assumed) — S3-compatible object store later? Retention period? | Print/Excel storage ports, backup, cloud path | Local Docker volume, 30-day retention (config) | Product/IT |
| OQ-09 | Customization | Do organization-level defaults/preferences (vs per-user) matter in v1? Shared saved filters (per role/team)? | Customization schema (scope column), UI | Per-user preferences only in v1 | Product |
| OQ-10 | Reporting | v1 grouping scope: is single-column grouping + totals sufficient, or are multi-dimensional ad-hoc groupings required at launch? | Reporting pipeline (GROUP BY stage) | Single-column grouping + group totals; complex aggregations via purpose-built views | Product |
| OQ-11 | Accounting | Ledger behavior specifics: double-entry chart structure, period close/reopen rules, opening balance import, cost accounting method for inventory (standard/moving avg/weighted)? | Accounting module design, inventory valuation events | Double-entry; journals immutable; cost method undecided — inventory valuation reports deferred until decided | Product/Finance |
| OQ-12 | Numbering | Business document numbering rules (invoice no., receipt no., journal no.): per-type sequences? prefix/year scopes? gap policy? | Numbering service, unique constraints, imports | No auto-numbering invented; document numbers accepted from user input (unique per scope) until decided | Product/Finance |
| OQ-13 | Domain | Approval workflows: do inventory movements / sales documents / journals need approval states? Negative stock allowed per policy? | State machines in Inventory/Sales/Accounting, permissions (`*.Approve`) | No approval states in v1 (direct create with permission); negative stock disallowed by default (per-item policy field reserved) | Product |
| OQ-14 | Security | Initial role set (Admin, Accountant, Warehouse, Sales, Auditor…?) and per-role permission baselines; auditor role separation from admin? | RBAC seed data, admin UI | No seed roles invented; role management UI works with empty/creator-defined roles | Product |
| OQ-15 | Product | Notification channels beyond in-app (email? SMS via Iranian gateways?) and which events notify whom; sales→inventory stock mutation workflow (does issuing an invoice move stock automatically?) | Notifications module channels, Sales/Inventory workflow | In-app only in v1; stock movement on sales manual until workflow decided | Product |
| OQ-16 | Scope | Is Purchasing in the initial release, or v1.1? (Requirements imply it via purchase→receipt→journal.) | Module roadmap, inventory receipt sources | Purchasing = planned (post-v1); manual inventory receipts cover the gap | Product |
| OQ-17 | Operations | Backup RPO/RTO targets; audit/financial data retention & archival policy; on-premise upgrade process expectations (auto-migrate on start vs manual)? | Ops runbook, audit storage, deploy pipeline | Daily logical backup, no RPO/RTO committed; retention = deployment config; `prisma migrate deploy` on release (expand-migrate-contract for risky changes) | Product/IT |

## Resolved

(None yet — resolved entries are kept here with date + deciding ADR, then
propagated to the affected docs.)
