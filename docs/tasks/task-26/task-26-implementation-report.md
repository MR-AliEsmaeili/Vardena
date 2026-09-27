# Task 26 — ODR-3 Organization Read-Scope Completion

## Executive Summary

**Objective:** remediate Task 25 SEC-01 without changing the ODR-3 architecture.  
**Scope/result:** all independently re-audited 28 list and 9 detail service surfaces now retain their existing permission check and then explicitly call `OrganizationsService.assertOrganizationInScope` before reading organization-owned rows.  
**Status:** implementation and local verification complete; GitHub CI is pending.

## Baseline

- Base and audited `main`: `e3c053f6a0c3735d8690251e9b04d4e32250b686` (PR #70 merge).
- Source: `docs/tasks/task-25/main-based-governance-audit-report.md` §11 SEC-01, plus the Task 25 drift report and owner decision pack.
- Precedent: Task 24 R-2, `AccountsService.listAccounts`, and `coding-structure-accounts.spec.ts`.
- Re-audit result: **37 / 37**, exactly matching SEC-01. No stop condition was found.

## Affected Surface Inventory

All endpoints take `organizationId` from the query except rows marked **path/argument**. “Previous” is permission + organization-keyed filtering/row comparison, but no principal-bound scope assertion. “New” is permission first, then the existing ODR-3 chokepoint, then the existing validation/read. The regression test for every row is the parameterized test named `$module/$service::$method keeps permission first and explicitly asserts its caller-supplied organization before the read` in `backend/src/modules/organization/application/organization-read-scope-completion.spec.ts`.

|   # | Module       | Controller / endpoint operation                   | Service method                                     | Type   | organizationId | Previous                     | New                 |
| --: | ------------ | ------------------------------------------------- | -------------------------------------------------- | ------ | -------------- | ---------------------------- | ------------------- |
|   1 | Accounting   | AccountingConfigurationsController list           | AccountingConfigurationsService.listConfigurations | list   | query          | filter only                  | explicit chokepoint |
|   2 | Accounting   | AccountingPeriodsController list                  | AccountingPeriodsService.listAccountingPeriods     | list   | query          | filter only                  | explicit chokepoint |
|   3 | Accounting   | CodingStructuresController list                   | CodingStructuresService.listVersions               | list   | query          | filter only                  | explicit chokepoint |
|   4 | Accounting   | FinancialAreasController list                     | FinancialAreasService.listFinancialAreas           | list   | query          | filter only                  | explicit chokepoint |
|   5 | Accounting   | FiscalYearsController list                        | FiscalYearsService.listFiscalYears                 | list   | query          | filter only                  | explicit chokepoint |
|   6 | Documents    | DocumentRelationsController list                  | DocumentRelationsService.listRelations             | list   | query          | filter only                  | explicit chokepoint |
|   7 | Documents    | DocumentRelationsController detail                | DocumentRelationsService.getRelation               | detail | path/argument  | row match only               | explicit chokepoint |
|   8 | Documents    | NumberingSeriesController allocation list         | NumberingService.listAllocations                   | list   | query          | filter only                  | explicit chokepoint |
|   9 | Documents    | NumberingSeriesController allocation detail       | NumberingService.getAllocation                     | detail | path/argument  | row match only               | explicit chokepoint |
|  10 | Documents    | NumberingSeriesController detail                  | NumberingSeriesService.getNumberingSeries          | detail | path/argument  | row match only               | explicit chokepoint |
|  11 | Inventory    | InventoryBalancesController list                  | InventoryBalancesService.listBalances              | list   | query          | filter only                  | explicit chokepoint |
|  12 | Inventory    | InventoryMovementsController list                 | InventoryMovementsService.listMovements            | list   | query          | filter only                  | explicit chokepoint |
|  13 | Inventory    | InventoryReservationsController list              | InventoryReservationsService.listReservations      | list   | query          | filter only                  | explicit chokepoint |
|  14 | Inventory    | ItemGroupsController list                         | ItemGroupsService.listItemGroups                   | list   | query          | filter only                  | explicit chokepoint |
|  15 | Inventory    | ItemsController list                              | ItemsService.listItems                             | list   | query          | filter only                  | explicit chokepoint |
|  16 | Inventory    | UnitConversionsController list                    | UnitConversionsService.listConversions             | list   | query          | filter only                  | explicit chokepoint |
|  17 | Inventory    | UnitsController list                              | UnitsService.listUnits                             | list   | query          | filter only                  | explicit chokepoint |
|  18 | Inventory    | WarehousesController list                         | WarehousesService.listWarehouses                   | list   | query          | filter only                  | explicit chokepoint |
|  19 | Organization | BranchesController list                           | BranchesService.listBranches                       | list   | query          | filter only                  | explicit chokepoint |
|  20 | Organization | DepartmentsController list                        | DepartmentsService.listDepartments                 | list   | query          | filter only                  | explicit chokepoint |
|  21 | Organization | EmployeesController list                          | EmployeesService.listEmployees                     | list   | query          | filter only                  | explicit chokepoint |
|  22 | Organization | PartiesController list                            | PartiesService.listParties                         | list   | query          | filter only                  | explicit chokepoint |
|  23 | Workflow     | WorkflowApprovalsController list                  | WorkflowApprovalsService.listApprovals             | list   | query          | indirect structural resolver | explicit chokepoint |
|  24 | Workflow     | WorkflowAutomationsController list                | WorkflowAutomationsService.listAutomations         | list   | query          | indirect structural resolver | explicit chokepoint |
|  25 | Workflow     | WorkflowAutomationsController detail              | WorkflowAutomationsService.getAutomation           | detail | path/argument  | row match only               | explicit chokepoint |
|  26 | Workflow     | WorkflowDefinitionsController list                | WorkflowDefinitionsService.listDefinitions         | list   | query          | filter only                  | explicit chokepoint |
|  27 | Workflow     | WorkflowDefinitionsController detail              | WorkflowDefinitionsService.getDefinition           | detail | path/argument  | row match only               | explicit chokepoint |
|  28 | Workflow     | WorkflowInstancesController list                  | WorkflowInstancesService.listInstances             | list   | query          | filter only                  | explicit chokepoint |
|  29 | Workflow     | WorkflowInstancesController detail                | WorkflowInstancesService.getInstance               | detail | path/argument  | row match only               | explicit chokepoint |
|  30 | Workflow     | WorkflowInstancesController available transitions | WorkflowInstancesService.listAvailableTransitions  | list   | path/argument  | row match only               | explicit chokepoint |
|  31 | Workflow     | WorkflowInstancesController history               | WorkflowInstancesService.listHistory               | list   | query          | row match + filter           | explicit chokepoint |
|  32 | Workflow     | WorkflowStatesController list                     | WorkflowStatesService.listStates                   | list   | query          | indirect structural resolver | explicit chokepoint |
|  33 | Workflow     | WorkflowStatesController detail                   | WorkflowStatesService.getState                     | detail | path/argument  | row match only               | explicit chokepoint |
|  34 | Workflow     | WorkflowTransitionsController list                | WorkflowTransitionsService.listTransitions         | list   | query          | indirect structural resolver | explicit chokepoint |
|  35 | Workflow     | WorkflowTransitionsController detail              | WorkflowTransitionsService.getTransition           | detail | path/argument  | row match only               | explicit chokepoint |
|  36 | Workflow     | WorkflowVersionsController list                   | WorkflowVersionsService.listVersions               | list   | query          | indirect structural resolver | explicit chokepoint |
|  37 | Workflow     | WorkflowVersionsController detail                 | WorkflowVersionsService.getVersion                 | detail | path/argument  | row match only               | explicit chokepoint |

## Implementation Changes

Production service files are the 27 `*.service.ts` files represented in the table. Each receives one explicit assertion immediately after its existing `requireAllPermissions`; no validation, query, ownership comparison, or business rule was removed. `documents/application/numbering.service.ts` additionally receives the already-exported `OrganizationsService` dependency because it was the only affected service not already using the chokepoint. No generic helper, decorator, guard, or authorization framework was added.

`docs/security.md` now records the verified universal ODR-3 state and the AND relationship between permission and scope. Task 24/25 historical records were not rewritten.

## Security Verification

- **Org A → Org A allowed:** Task 24 test `returns the caller’s own organization accounts (no behaviour change)` remains green.
- **Org A → Org B denied:** Task 24 test `refuses a foreign organization with 404 when no parentId filter is supplied` remains green; every affected method is pinned to the same chokepoint by 37 method-specific regression cases.
- **Missing permission denied:** the assertion-order contract requires `requireAllPermissions` before scope; Task 24 test `still refuses the list with 403 when the View permission is missing` remains green.
- **Arbitrary organizationId:** all 37 tests verify that the caller-supplied ID itself is passed to the chokepoint before the read.
- **Deployment pin:** `deployment-scope.guard.spec.ts` (8 tests) and `keeps the deployment pin (ADR-0025) enforced on the list without a parentId` remain green. `organization.module.ts` was not changed and still has exactly one `APP_GUARD` registration.
- Foreign, missing, or unpinned organizations use the established 404 non-disclosure contract.

## Tests

| File                                                                                      | Exact test name(s)                                                                                                                                                                                                                                                                                                                                                                     | Category                                    | Local result     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------- |
| `backend/src/modules/organization/application/organization-read-scope-completion.spec.ts` | `pins the independently re-audited inventory at exactly 37 surfaces`                                                                                                                                                                                                                                                                                                                   | inventory guard                             | PASS             |
| same                                                                                      | 37 generated names: `<module>/<service>::<method> keeps permission first and explicitly asserts its caller-supplied organization before the read` (one per inventory row)                                                                                                                                                                                                              | authorization-boundary regression           | 38/38 PASS total |
| `backend/src/modules/accounting/application/coding-structure-accounts.spec.ts`            | `returns the caller’s own organization accounts (no behaviour change)`; `refuses a foreign organization with 404 when no parentId filter is supplied`; `keeps the deployment pin (ADR-0025) enforced on the list without a parentId`; `still refuses the list with 403 when the View permission is missing`; `confines every chart and structure operation to the pinned organization` | behavioral positive/negative/permission/pin | PASS             |
| `backend/src/modules/organization/application/deployment-scope.guard.spec.ts`             | all 8 existing guard tests                                                                                                                                                                                                                                                                                                                                                             | deployment pin compatibility                | 8/8 PASS         |
| `backend/src/modules/documents/application/numbering.service.spec.ts`                     | all allocation tests (fixture updated for existing dependency)                                                                                                                                                                                                                                                                                                                         | numbering regression                        | 10/10 PASS       |

Local commands/results: Prettier PASS; TypeScript PASS; oxlint PASS with 7 pre-existing warnings and 0 errors; complete backend unit suite **108 files / 1267 tests PASS**.

## CI

- CI run `36336552917`: frontend job `108668390348` passed; backend job `108668390516` passed validation, lint, typecheck, formatting, unit tests, build, migration, bootstrap, and rehearsal, then failed E2E because `accounting.e2e-spec.ts` still expected the pre-remediation `200` contract for an out-of-scope financial-area list. The expectation was corrected to the established `404 EntityNotFound` contract and pushed for a new run.
- Final CI run ID/result: pending the follow-up run; this report does not claim CI passed without it.

## Diff Summary / Scope Verification

- Production: 27 service files; 37 explicit scope assertions plus one existing-service injection.
- Tests: one 38-case inventory/ordering regression suite and two fixture/expectation updates.
- Documentation: this report and `docs/security.md`.
- Migrations: **0**. Schema changes: **0**. New permissions: **0**.
- No new authorization architecture, guard, wildcard, superuser bypass, tenancy change, unrelated refactor, or business capability.

## Remaining Risks

Only GitHub CI (including expensive E2E and frontend checks) remains to establish READY FOR REVIEW. Task 26 does not accept itself, close an OQ, promote an ADR, or alter Task 24/25 acceptance state.
