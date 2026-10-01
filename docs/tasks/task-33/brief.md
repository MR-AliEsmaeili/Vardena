# Task 33 — Inventory / Warehouse Master Completion

**Status:** MVP REQUIRED · implementation audit complete · not accepted

## Objective

Verify the Warehouse master vertical slice against the current repository contracts without redesigning the Inventory module or resolving open questions. The slice covers authenticated, permissioned, organization-scoped list/get/create/update/enable/disable operations, same-organization usable Branch validation, normalized organization-scoped codes, lifecycle safety, and existing domain events.

## Boundaries

Warehouse remains Inventory-owned master data. Branch remains Organization-owned and is resolved only through `BranchesService.requireUsableBranchInOrganization()`. No schema change, migration, frontend work, valuation, costing, accounting integration, locations, or movement-model changes are authorized by this task.

## Governance

Task 33 is recorded as **MVP REQUIRED** and must remain distinct from **IMPLEMENTED**, **MERGED**, **CI VERIFIED**, and **ACCEPTED**. This task does not mark Owner acceptance.
