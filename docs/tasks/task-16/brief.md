# Task 16 — Initial Brief

## Status

NOT YET READY FOR IMPLEMENTATION SPECIFICATION

At bootstrap baseline, Task 16 was NOT YET FORMALLY DOCUMENTED. Implementation status: UNKNOWN — REQUIRES REPOSITORY VERIFICATION. This file creates an initial record, not approval or implementation authorization.

## Purpose

Establish the initial repository record for Task 16. The exact scope must be derived from current repository implementation, existing Accounting contracts, existing ADRs, existing task history and owner-confirmed decisions. No unverified chat information is approved scope. The existence of Task 15 reversal does not establish what Task 16 must do.

## Repository Evidence Reviewed

Inspection baseline: `79d69e1fa2450749302a24c2688869e9378643f0` on `arena/01a0d3e5-vardena`, initially clean. Local history is shallow. Read-only GitHub metadata confirms default `main`, PR #33 merged at baseline, and no PR for this bootstrap branch. PR descriptions were not used as approval evidence.

- `README.md`, `backend/README.md`, `.vardena/project-context.md`, `.vardena/agent-rules.md`, `.vardena/architecture-rules.md` — onboarding/workflow and stale-summary findings.
- `docs/accounting/task-index.md`, `docs/task-10.4-implementation-report.md`, `docs/task-10.5-implementation-report.md`, `docs/task-10.7-implementation-report.md`, `docs/task-10.8-implementation-report.md`, Task 11–14 reports listed in STATE.md — historical claims, not fresh runtime proof.
- `docs/accounting/domain-contract.md` (especially §4, §7, §13, §15, §16, §19, §28), `configuration.md`, `lock-order-matrix.md` and `task-11-mark-operationally-used-decision-note.md` in the same directory; `docs/open-questions.md`.
- `docs/adr/README.md` and ADR decision/status inventory in STATE.md; relevant ADR-0021 through 0026, 0028, 0031 and 0032. No ADR for Task 16 found. Existing Proposed statuses preserved.
- `backend/prisma/schema/accounting.prisma`, `base.prisma`, `identity.prisma`, `users.prisma`, `rbac.prisma` and other schema model inventories; `backend/prisma/migrations/` including reversal migration `20260923000000_accounting_document_reversal/migration.sql`.
- `backend/src/modules/accounting/api/accounting-documents.controller.ts`, `application/accounting-documents.service.ts`, `application/posting.service.ts`, `data/accounting-documents.repository.ts`, `domain/accounting-document.ts`, `domain/document-reversal.ts`, `domain/money.ts`, `domain/accounting-period.ts`, `domain/accounting-configuration.ts`, `domain/accounting-permissions.ts` (paths in this bullet after the first are relative to the Accounting module).
- `backend/src/modules/identity/application/auth.guard.ts`, `backend/src/modules/rbac/application/authorization.guard.ts`, `authorization.service.ts` in that directory, `backend/src/modules/organization/application/deployment-scope.guard.ts`.
- Test inventory and selected cases: `backend/src/modules/accounting/domain/document-reversal.spec.ts`, `backend/test/accounting-documents-live.e2e-spec.ts`, `backend/test/accounting-period-lifecycle-live.e2e-spec.ts`; `backend/vitest.config.ts`, `backend/vitest.config.e2e.ts`, `backend/package.json`, `.github/workflows/ci.yml`.

Inspection was static and targeted, not exhaustive testing or independent approval. See STATE.md for exact historical references and preservation register.

## Related Existing Modules

Relationships below are potential dependencies for investigation, **not Task 16 scope**.

| Module | Relevant path | Relationship to Task 16 | Verification status |
|---|---|---|---|
| Accounting | `backend/src/modules/accounting/`, `backend/prisma/schema/accounting.prisma` | Existing fiscal/document/posting/reversal contracts to analyze; actual Task 16 change UNKNOWN | Registered module, schema and code verified statically |
| Documents | `backend/src/modules/documents/` | Accounting uses shared phase/type and numbering mechanics; whether Task 16 touches them UNKNOWN | Registered module and interfaces verified |
| Organization | `backend/src/modules/organization/` | Existing organization scope/pin is a constraint on future analysis | Registered module, scope guard verified |
| Identity, Users, RBAC | `backend/src/modules/{identity,users,rbac}/` | Existing authentication and permission model; Task 16 permissions UNKNOWN | Registered modules, guard/evaluation/password/token code and schemas inspected |
| Inventory, Workflow | `backend/src/modules/inventory/`, `backend/src/modules/workflow/` | Existing platform modules; any Task 16 interaction UNKNOWN | Registered modules/schema/controller inventory verified; no new integration inferred |

## Related Existing Contracts

Paths abbreviated `accounting/…` below mean `backend/src/modules/accounting/…`.

| Contract | Verified current evidence / boundary |
|---|---|
| Accounting documents | `AccountingDocument`/lines in `backend/prisma/schema/accounting.prisma`; contract §12/§15. Domain phases draft → temporary → final; DB stores these values in `state`. Final edits are restricted; no Task 16-specific relationship defined |
| Posting | `accounting/application/posting.service.ts` delegates ordinary finalization to repository `finalizeChecked`; ledger, balance projection, configuration marker and operation evidence are transactionally maintained. Contract §15.5/§16.4; no runtime proof claimed |
| Reversal | `accounting/domain/document-reversal.ts`, service `reverseDocument`, repository `reverseChecked`, reversal migration: new Final counter-document with debit/credit inverted, typed links and reason, permission check, operation key replay; original gets reversal link/audit update. Number allocation precedes repository transaction; do not claim all effects share one transaction |
| Fiscal periods / close | `accounting/domain/accounting-period.ts`, repository scope locks, contract §7; open/closed/sealed, posting requires open scope; existing permission/reason-gated reopen exception described in ADR-0032. OQ-23 policy still open |
| Operational freeze | `docs/accounting/configuration.md`, OQ-64 resolution, `markConfigurationsUsedByDocumentInTx` in document repository: distinct configurations pinned by posted accounts, marker inside transaction. This is not an allocation freeze contract |
| Organization isolation | Explicit organization-scoped lookups and optional deployment pin; ADR-0021/0025 and guard. Full tenant membership authorization is NOT FOUND; not equivalent to multi-tenant security |
| Permissions | `accounting/domain/accounting-permissions.ts` includes `Accounting.Document.Reverse`; route and service checks; RBAC union of role permissions. Task 16 permission requirements UNKNOWN |
| Idempotency | Accounting operation unique `(organizationId, operationKey)`, kind/hash comparison and stored-result replay (`accounting.prisma`, service replayOrReject, posting service); mismatched intent rejected. Task 16 replay contract UNKNOWN |
| Decimal handling | `accounting/domain/money.ts`: exact decimal strings/BigInt arithmetic, numeric(18,2), precision rejection; currency/FX policy remains OQ-gated |
| Settlement / allocation | No approved Task 16 contract found in inspected task records or Accounting schema. Allocatable amount, eligibility, currency compatibility and relationship invariants: UNKNOWN — owner/repository analysis required |

The domain-contract header still says Proposed/no implementation and calls ADR-0026 Proposed, whereas ADR-0026 records Accepted and code exists. STATE.md BOOT-R-10 records this discrepancy; bootstrap does not rewrite either source.

## Repository Verification Checklist

Checked means the area was inspected statically, **not** that tests passed or a final implementation specification is ready.

- [x] Current Accounting Document model inspected
- [x] Existing posting behavior inspected
- [x] Existing reversal behavior inspected
- [x] Fiscal Period rules inspected
- [x] Freeze and close rules inspected
- [x] Organization isolation rules inspected
- [x] Existing permission model inspected
- [x] Existing idempotency conventions inspected
- [x] Existing Decimal handling inspected
- [x] Existing accounting tests inspected
- [x] Existing relevant ADRs inspected
- [x] Current branch and PR state inspected

## Preliminary Investigation Topics

**PRELIMINARY TOPICS — NOT APPROVED SCOPE**

- Settlement or allocation domain modeling
- Relationship between accounting documents
- Allocatable amount calculation
- Document status eligibility
- Organization and currency compatibility
- Atomicity and concurrency
- Idempotency and replay behavior
- Permission enforcement
- Auditability
- Interaction with posting, reversal, freeze, and period close

These are investigation topics only, not requirements or an instruction to build settlement/allocation.

## In Scope

To be determined after repository inspection and owner confirmation.

## Out of Scope

To be determined after repository inspection and owner confirmation.

## Open Questions

- **BOOT-OQ-03 (OPEN — owner decision required):** What is Task 16's actual objective, approved boundaries and acceptance basis? No pre-bootstrap formal record was found in `docs/accounting/task-index.md` or task documentation. Without that record none of the preliminary topics can become scope.
- **BOOT-OQ-01 (REQUIRES OWNER CONFIRMATION):** Where should any required future ADR be recorded? Existing rules require `docs/adr/`; the requested new convention names `docs/decisions/ADR-*.md`. Resolve before creating a new decision record.
- Relevant existing unresolved policy questions are OQ-03/23/27/47/48/62/63 (`docs/open-questions.md`); their applicability to Task 16 must be established, not assumed. OQ-64 is already resolved and is not newly reopened here.

No Task 16-specific business rules have been owner-confirmed in this bootstrap.

## Risks and Dependencies

- Approved Task 16 scope/prompt is missing: blocks implementation specification (STATE.md BOOT-R-08).
- Historical review status is incomplete/conflicting: Task 12 legacy label versus reports; Tasks 13–15 merged is not proof of acceptance (BOOT-R-02/03).
- Existing README/onboarding and reversal comments are stale, so contracts, actual code and status evidence must be distinguished (BOOT-R-01/07/10).
- Task 12 real-PG concurrency follow-up is recorded open; no new test or CI execution here (BOOT-R-04).
- Existing deployment-pin limitation and raw-SQL partial-index constraint require attention if future approved scope interacts with them (BOOT-R-05/06). No Task 16 migration requirement is established.

These are verified gaps/dependency candidates, not new business requirements.

## Next Step

Review this initial brief, resolve Open Questions, confirm the actual Task 16 scope, and prepare the final implementation prompt. Implementation is NOT AUTHORIZED by the bootstrap.
