# Task 28 — ADR Reconciliation Matrix

**Audited `main` HEAD Commit:** `ff4b9f24d1c3797712c88fcd61432c3c315dbf4f` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

> **Governing Principles (Prompt §9):**
> 1. No ADR is promoted, demoted, renumbered, moved, or rewritten by this audit.
> 2. Statuses below are transcribed verbatim from each ADR's `Status:` line in `docs/adr/`.
> 3. Task acceptance does NOT promote an ADR, and ADR acceptance does not accept an implementation task.
> 4. **ADR-0027 does not exist.** The gap is deliberate and recorded; the identifier must not be filled or reused.
> 5. Total ADR files in repository: **37**.

---

## 1. Complete ADR Inventory and Alignment

| ADR | Title | Current Status (verbatim) | Implementation Evidence (on `main`) | Owner Acceptance Status | Promotion Required? | Blocks Next Implementation Gate? | Audit Classification |
|---|---|---|---|---|---|---|---|
| **0001** | Modular Monolith (Not Microservices) | Accepted | 9 modules under `backend/src/modules/` with `api/application/domain/data`; single deployable NestJS app (`app.module.ts`) | ACCEPTED | NO | NO | **CONSISTENT** |
| **0002** | Technology Stack (Fixed Set) | Accepted | NestJS 12, TypeScript 6, Prisma 7, PostgreSQL (`backend/package.json`); React 19, Vite, Tailwind, shadcn (`frontend/package.json`) | ACCEPTED | NO | NO | **CONSISTENT** |
| **0003** | Legacy ERP Isolation via Adapter Layer | Accepted | Boundary preserved; no direct integration in core domain modules | ACCEPTED | NO | NO | **CONSISTENT** (Boundary decision) |
| **0004** | Outbox Pattern for External Synchronization | Accepted | Architecture accepted; no outbox table (`sync.outbox_events`) or worker loop yet built | ACCEPTED | NO | YES (for Phase 4 system posting) | **CONSISTENT** (Architectural pattern) |
| **0005** | Domain Events for Inventory → Accounting | Accepted | In-memory `DomainEventBus` exists; cross-module subscriptions deferred to Phase 4 | ACCEPTED | NO | YES (for Phase 4 integration) | **CONSISTENT** (Architectural pattern) |
| **0006** | RBAC with Granular Permissions | Accepted | `modules/rbac/**`, 134 permissions registered, database mirror, zero wildcards | ACCEPTED | NO | NO | **CONSISTENT** |
| **0007** | Server-Side Opaque Sessions | Accepted | `identity/domain/session-token.service.ts` (256-bit opaque, SHA-256 stored hash), idle/absolute timeout, session revocation | ACCEPTED | NO | NO | **CONSISTENT** |
| **0008** | Single Database, Schema per Module, ULIDs | Accepted | 8 PostgreSQL schemas (`identity, users, rbac, organization, inventory, documents, workflow, accounting`), ULIDs in `kernel/ids/ulid.ts` | ACCEPTED | NO | NO | **CONSISTENT** |
| **0009** | Reporting via Module Views + Scoped Raw SQL | Accepted | Accounting owns bounded read queries (`accounting-read-query.repository.ts`); zero generic EAV/report builder persistence | ACCEPTED | NO | NO (Phase 2 design baseline) | **CONSISTENT** |
| **0010** | DB-Backed Job Queue (No External Broker) | Accepted | Kernel `JobsRegistry` stub present; no `jobs` schema or background worker active | ACCEPTED | NO | NO (Phase 5 evaluation) | **CONSISTENT** |
| **0011** | Excel Import Workflow | Accepted | Not implemented (Phase 2C candidate) | ACCEPTED | NO | NO | **CONSISTENT** |
| **0012** | Print Template System | Accepted | Not implemented (Phase 2D candidate) | ACCEPTED | NO | NO | **CONSISTENT** |
| **0013** | User Preference Key-Value | Accepted | Not implemented (no `customization` schema) | ACCEPTED | NO | NO | **CONSISTENT** |
| **0014** | OpenAPI Contract | Accepted | OpenAPI generated under `/api/docs`, Swagger DTOs in controllers | ACCEPTED | NO | NO | **CONSISTENT** |
| **0015** | Backend Foundation Conventions | Accepted | Standard error envelope `{code, message, details?, correlationId}`, pagination, correlation IDs | ACCEPTED | NO | NO | **CONSISTENT** |
| **0016** | RBAC Enforcement and Evaluation | Accepted | Route `AuthorizationGuard` + service `requireAllPermissions`, DB lookup per request, no caching | ACCEPTED | NO | NO | **CONSISTENT** |
| **0017** | Inventory Ledger as Source of Truth | Proposed | **IMPLEMENTED** (`inventory.inventory_movements`, `inventory_balances`, migration `20260911020000_inventory_core`) | PENDING OWNER DECISION | YES (OD-27-04) | NO | **IMPLEMENTATION AHEAD OF GOVERNANCE** |
| **0018** | Bounded, Versioned Workflow | Proposed | **IMPLEMENTED** (`modules/workflow/**`, migration `20260912010000_workflow_foundation`) | PENDING OWNER DECISION | YES (OD-27-04) | NO | **IMPLEMENTATION AHEAD OF GOVERNANCE** |
| **0019** | Document Foundation and Relations | Proposed | **IMPLEMENTED** (`modules/documents/**`, migration `20260912000000_documents_foundation`). Overlaps with Accepted ADR-0023 | PENDING OWNER DECISION | YES (OD-27-04) | NO | **IMPLEMENTATION AHEAD OF GOVERNANCE** |
| **0020** | Organizational Scope and Master Data | Proposed | **IMPLEMENTED** (organization-scoped rows, `assertOrganizationInScope`, deployment pin) | PENDING OWNER DECISION | YES (OD-27-04) | NO | **IMPLEMENTATION AHEAD OF GOVERNANCE** |
| **0021** | Organization-Scoped Master Data | Proposed | **IMPLEMENTED** (`organization.{organizations, branches, departments, employees, parties}`, migration `20260911000000_*`) | PENDING OWNER DECISION | YES (OD-27-04) | NO | **IMPLEMENTATION AHEAD OF GOVERNANCE** |
| **0022** | Inventory Core Ledger | Accepted | `inventory/application/inventory-movements.service.ts`, ledger tables, balances, reservations | ACCEPTED | NO | NO | **CONSISTENT** |
| **0023** | Document Foundation Implementation | Accepted | `documents/application/document-types.service.ts`, numbering series, allocations, typed relations | ACCEPTED | NO | NO | **CONSISTENT** |
| **0024** | Workflow Foundation | Accepted | `workflow/application/workflow-definitions.service.ts`, versioning, states, transitions, instances | ACCEPTED | NO | NO | **CONSISTENT** |
| **0025** | Single-Organization Deployment Pin | Accepted | `DeploymentOrganizationScopeGuard` registered as global `APP_GUARD` in `organization.module.ts:81`; `assertDeploymentOrganizationPin` | ACCEPTED | NO | NO | **CONSISTENT** |
| **0026** | Accounting Bounded Context | Accepted | `modules/accounting/**`, owns fiscal calendar, accounts, vouchers, ledger; zero cross-module DB reads | ACCEPTED | NO | NO | **CONSISTENT** |
| **0028** | Accounting Configuration Foundation | Accepted | `accounting_configurations`, versioned roots, single ACTIVE configuration, operational freeze marker | ACCEPTED | NO | NO | **CONSISTENT** |
| **0029** | Machine/API Access Model | Proposed | Not implemented (Phase 7+ candidate) | PENDING OWNER DECISION | NO | NO (Post-MVP) | **CONSISTENT (Future Concept)** |
| **0030** | License Foundation | Proposed | Not implemented (Phase 7+ candidate) | PENDING OWNER DECISION | NO | NO (Post-MVP) | **CONSISTENT (Future Concept)** |
| **0031** | Balance Projection | Proposed | **IMPLEMENTED** (`account_balance_projections`, Task 12 slice, rebuild service, live-DB E2E) | PENDING OWNER DECISION | YES (OD-27-04) | NO | **IMPLEMENTATION AHEAD OF GOVERNANCE** |
| **0032** | Accounting Period Close Enforcement | Proposed | **IMPLEMENTED** (`AccountingPeriodsService.closePeriod`, locked period posting check, Task 14) | PENDING OWNER DECISION | YES (OD-27-04) | NO | **IMPLEMENTATION AHEAD OF GOVERNANCE** |
| **0033** | Account Identity and Code History | Proposed | Clarified by Task 20 OD-20-4; pre-use code correction not yet implemented | PENDING OWNER DECISION | NO | YES (for Phase 1B) | **CONSISTENT (Design Formalized)** |
| **0034** | Posting versus Aggregation Accounts | Proposed | Clarified by Task 20 OD-20-5; leaf-only posting enforced in code | PENDING OWNER DECISION | YES (OD-27-04) | NO | **CONSISTENT** |
| **0035** | Account Code Structure Migration | Proposed | Clarified by Task 20 OD-20-4; code migration service explicitly not authorized | PENDING OWNER DECISION | NO | NO (Post-MVP / Not Authorized) | **CONSISTENT (Explicit Non-Goal)** |
| **0036** | Legal Reporting Architecture | Proposed | Bounded read query foundation exists; statutory adapter/formats pending OQ-43 | PENDING OWNER DECISION | NO | YES (for Electronic Books) | **CONSISTENT (Architecture Only)** |
| **0037** | Accounting Configuration Boundary | Proposed | Task 20 decisions OD-20-1..3/6 recorded; Task 23 implemented Base Chart mechanism; content pending OQ-25 | PENDING OWNER DECISION | NO | YES (for Phase 1A adoption gate) | **CONSISTENT (Mechanism Merged)** |
| **0038** | Installation Bootstrap of Pinned Deployment Organization | Proposed | **IMPLEMENTED** (`OrganizationsService.ensureDeploymentOrganization`, `system-administrator-bootstrap.service.ts`, PR #72) | PENDING OWNER DECISION | YES (OD-27-04) | NO | **IMPLEMENTATION AHEAD OF GOVERNANCE** |

---

## 2. Summary Statistics

- **Total ADR files in repository:** 37
- **Accepted ADRs:** 22 (ADR-0001..0016, ADR-0022..0026, ADR-0028)
- **Proposed ADRs:** 15 (ADR-0017..0021, ADR-0029..0038)
- **Implementation Ahead of Governance (Proposed but Implemented in Code):** 8 ADRs (ADR-0017, 0018, 0019, 0020, 0021, 0031, 0032, 0038)
- **Proposed and Not Yet Implemented (Future / Gated Concepts):** 7 ADRs (ADR-0029, 0030, 0033, 0034, 0035, 0036, 0037)
- **Deliberate Numbering Gap:** ADR-0027 (Deliberately empty; must not be filled or reused).
