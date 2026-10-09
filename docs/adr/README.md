# Architecture Decision Records (ADRs)

## What an ADR Is

An ADR records a **significant architectural decision**: its context, the
decision, and its consequences. ADRs are the tie-breaker when docs and code
disagree (AG-01/AG-17).

## When an ADR Is Required (AR-29)

Any of the following ⇒ ADR first (or in the same PR):

- adding/renaming/removing a **module**;
- changing **cross-module communication** patterns (new event contract semantics,
  new extension-point mechanism);
- introducing a **new major dependency** or technology (AR-30);
- changing the **database topology** (schemas, engines, replication);
- changing **deployment topology** (new processes/services, brokers, external
  infrastructure);
- changing **security architecture** (auth mechanism, authorization model,
  session/token design);
- changing **outbound integration architecture** (new sync mechanisms, adapters
  contract);
- anything that would invalidate an existing ADR.

Routine implementation decisions (a new endpoint, a new table inside an existing
module, a UI component) do **not** require an ADR — they require normal docs
updates (AG-07).

## Format

```markdown
# ADR-NNNN: <Title>

Status: Proposed | Accepted | Superseded by ADR-xxxx
Date: YYYY-MM-DD

## Context

(What forces this decision. 2–6 sentences.)

## Decision

(What we decide, stated plainly. Include alternatives briefly if short.)

## Consequences

(Bullet list: what becomes easier/harder, follow-up work, risks.)
```

Keep ADRs **short** (≤ ~60 lines). If it needs more, it belongs in `docs/`.

## Rules

- ADRs are **immutable once Accepted**: never edit history — supersede with a new
  ADR that references the old one (`Status: Superseded by ADR-NNNN`).
- Numbering is sequential, never reused.
- An architecture change in a PR **without** an ADR must be rejected/reverted
  (AG-07, AG-15).
- ADRs that resolve open questions link the `OQ-xx` ids.

## Index

| ADR                                                                            | Title                                                                                                       | Status                                                                       |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [0001](./0001-modular-monolith.md)                                             | Modular monolith (not microservices)                                                                        | Accepted                                                                     |
| [0002](./0002-technology-stack.md)                                             | Technology stack (fixed set)                                                                                | Accepted                                                                     |
| [0003](./0003-legacy-erp-adapter-isolation.md)                                 | Legacy ERP isolation via adapter layer                                                                      | Accepted                                                                     |
| [0004](./0004-outbox-pattern.md)                                               | Outbox pattern for external synchronization                                                                 | Accepted                                                                     |
| [0005](./0005-domain-events-inventory-accounting.md)                           | Domain events for Inventory → Accounting                                                                    | Superseded by ADR-0041 for internal posting                                    |
| [0006](./0006-rbac-granular-permissions.md)                                    | RBAC with granular permissions                                                                              | Accepted                                                                     |
| [0007](./0007-server-side-sessions.md)                                         | Server-side opaque sessions                                                                                 | Accepted                                                                     |
| [0008](./0008-single-database-module-schemas.md)                               | Single database, schema per module, ULIDs                                                                   | Accepted                                                                     |
| [0009](./0009-reporting-views-raw-sql.md)                                      | Reporting via module views + scoped raw SQL                                                                 | Accepted                                                                     |
| [0010](./0010-db-backed-job-queue.md)                                          | DB-backed job queue (no external broker)                                                                    | Accepted                                                                     |
| [0011](./0011-excel-import-workflow.md)                                        | Validated Excel import workflow                                                                             | Accepted                                                                     |
| [0012](./0012-print-template-system.md)                                        | Printing template system                                                                                    | Accepted                                                                     |
| [0013](./0013-user-preference-key-value.md)                                    | User preferences as validated key-value                                                                     | Accepted                                                                     |
| [0014](./0014-openapi-contract.md)                                             | OpenAPI as the single API contract                                                                          | Accepted                                                                     |
| [0015](./0015-backend-foundation-conventions.md)                               | Backend foundation conventions                                                                              | Accepted                                                                     |
| [0016](./0016-rbac-enforcement-and-evaluation.md)                              | RBAC enforcement and evaluation (no permission cache in v1)                                                 | Accepted                                                                     |
| [0017](./0017-inventory-ledger-as-source-of-truth.md)                          | Inventory ledger as source of truth + materialized balances                                                 | Proposed                                                                     |
| [0018](./0018-bounded-versioned-workflow.md)                                   | Bounded, versioned workflow configuration (no engine)                                                       | Proposed                                                                     |
| [0019](./0019-document-foundation-and-relations.md)                            | Document foundation: typed tables, shared mechanics, controlled relations                                   | Proposed                                                                     |
| [0020](./0020-organizational-scope-and-master-data.md)                         | Organizational scope, the Organization module and master-data ownership                                     | Proposed                                                                     |
| [0021](./0021-organization-scoped-master-data.md)                              | Organization-scoped master data (every master-data row carries `organization_id`)                           | Proposed                                                                     |
| [0022](./0022-inventory-core-ledger.md)                                        | Inventory Core — movement ledger, idempotent posting, availability policy                                   | Accepted                                                                     |
| [0023](./0023-document-foundation-implementation.md)                           | Document Foundation implementation — type registry, numbering, relations                                    | Accepted                                                                     |
| [0024](./0024-workflow-foundation.md)                                          | Workflow foundation — reusable platform capability                                                          | Accepted                                                                     |
| [0025](./0025-single-organization-deployment-pin.md)                           | Optional single-organization deployment pin (`DEPLOYMENT_ORGANIZATION_ID`)                                  | Accepted                                                                     |
| [0026](./0026-accounting-bounded-context.md)                                   | Accounting bounded context — module boundary, fiscal-calendar ownership, system-posting contract            | Accepted                                                                     |
| [0028](./0028-accounting-configuration-foundation.md)                          | Accounting configuration foundation — versioned root, single ACTIVE, operational freeze                     | Accepted                                                                     |
| [0029](./0029-machine-api-access-model.md)                                     | Machine/API access model — licensed API keys on the RBAC permission model                                   | Proposed                                                                     |
| [0030](./0030-license-foundation.md)                                           | License foundation — minimal, non-punitive, enforcement-off                                                 | Proposed                                                                     |
| [0031](./0031-balance-projection.md)                                           | Accounting balance projection — rebuildable turnover-only materialization                                   | Proposed                                                                     |
| [0032](./0032-accounting-period-close-enforcement.md)                          | Accounting period close — in-transaction enforcement, gate placement and the reopen exception               | Proposed                                                                     |
| [0033](./0033-account-identity-and-code-history.md)                            | Account identity and account code history — `Account.id` is permanent, `code` is a business identifier      | Proposed                                                                     |
| [0034](./0034-posting-versus-aggregation-accounts.md)                          | Posting accounts are leaf accounts; aggregation is read-time roll-up                                        | Proposed                                                                     |
| [0035](./0035-account-code-structure-migration.md)                             | Accounting code structure migration — controlled, licensed, audited; never rewrites economic ledger history | Proposed                                                                     |
| [0036](./0036-legal-reporting-architecture.md)                                 | Legal reporting architecture — Accounting Core → Legal Adapter / Legal Profile                              | Proposed                                                                     |
| [0037](./0037-accounting-configuration-boundary.md)                            | Accounting configuration boundary — Base Chart, consumer-first control roles, and line-level dimensions     | Proposed (Task 20 OD-20-1…OD-20-3/OD-20-6 recorded; implementation deferred) |
| [0038](./0038-installation-bootstrap-of-the-pinned-deployment-organization.md) | Installation bootstrap of the pinned deployment organization and the administrator's ordinary membership    | Proposed                                                                     |
| [0039](./0039-inventory-valuation-foundation.md)                                | Inventory valuation foundation — value on the existing ledger, cost-optional operations, bounded repricing  | Proposed                                                                     |
| [0040](./0040-operational-document-edit-boundary-and-side-effect-transparency.md) | Operational document edit boundary, side-effect transparency and the negative-inventory invariant (OQ-54)   | Proposed                                                                     |
| [0041](./0041-synchronous-inventory-accounting-application-contract.md)         | Synchronous Inventory → Accounting application contract                                                   | Accepted (PO-02, 2026-10-07)                                                 |
| [0042](./0042-datetime-calendar-architecture.md)                        | One date/time model — UTC instants, calendar days, a configurable calendar (OQ-02 remaining localization; OQ-73 resolved) | Accepted (PO-02, 2026-10-09) |
