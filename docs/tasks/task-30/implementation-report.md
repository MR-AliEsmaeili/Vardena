# Task 30 Implementation Report: Production Accounting Decisions (OD-29-01, OD-29-02, OD-29-03)

## 1. Executive Summary

Task 30 brings the owner decisions from Task 29 into production across schema, domain, application, API, and test suites:

- **OD-29-01**: Dual nature (`DEBIT`, `CREDIT`, `DUAL`) implemented without restrictive posting blockers.
- **OD-29-02**: Account types (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) implemented with post-use operational immutability.
- **OD-29-03**: Detail hierarchy versioning, level definitions, detail records, account-to-detail-group linking, voucher line detail allocation validation, and atomic destructive unlinking implemented.
- **OD-29-06**: Verified absence of system account bypasses in MVP.

---

## 2. Changes by Layer

### 2.1 Database & Schema (`backend/prisma/schema/accounting.prisma`)

- Added `account_type` (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`, default `'BALANCE_SHEET'`) to `Account`.
- Added `detail_group_id` nullable foreign key to `Account` referencing `Detail`.
- Created `detail_structure_versions` and `detail_structure_levels` models supporting organization-specific hierarchy depths, custom level names, digit lengths, and version statuses (`draft`, `active`, `superseded`).
- Created `details` model representing hierarchical detail nodes with `code`, `title`, `level`, `is_postable`, `is_active`, and `parent_id`.
- Added nullable `detail_id` referencing `Detail` to `accounting_document_lines` and `ledger_entries`.
- Added migration `backend/prisma/migrations/20260928000000_task30_accounting_decisions/migration.sql`.

### 2.2 Domain Layer (`backend/src/modules/accounting/domain/`)

- `account.ts`:
  - Defined `ACCOUNT_NATURES` as `['debit', 'credit', 'dual', 'DEBIT', 'CREDIT', 'DUAL']`.
  - Defined `ACCOUNT_TYPES` as `['BALANCE_SHEET', 'INCOME_STATEMENT', 'MEMORANDUM']`.
  - Added `accountType` and `detailGroupId` to `ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS`.
- `detail-structure.ts`:
  - Defined `planDetailStructure`, `checkDetailCode`, version progression, and status lifecycles.
- `detail.ts`:
  - Defined `planDetailPlacement`, `planDetailPostabilityChange`, `isDetailInGroup`, and tree validation rules.
- `voucher-lines.ts` & `document-reversal.ts`:
  - Added `detailId: string | null` to document line definitions and reversal inversion mappings.
- `accounting-permissions.ts`:
  - Added permissions `Accounting.Account.UnlinkDetailGroup`, `Accounting.DetailStructure.View`, `Accounting.DetailStructure.Configure`, `Accounting.Detail.View`, `Accounting.Detail.Create`, `Accounting.Detail.Edit`, `Accounting.Detail.Enable`, `Accounting.Detail.Disable`.

### 2.3 Application & Data Layer

- `AccountsRepository` & `AccountsService`:
  - Enforced account creation and update with validated `accountNature`, `accountType`, and `detailGroupId`.
  - Implemented `unlinkDetailGroupChecked`: Requires explicit `confirmUnlink = true`, atomically executes `UPDATE accounting_document_lines SET detail_id = NULL WHERE account_id = $id`, `UPDATE ledger_entries SET detail_id = NULL WHERE account_id = $id`, and `UPDATE accounts SET detail_group_id = NULL WHERE id = $id`. Emits `ACCOUNT_DETAIL_UNLINKED_EVENT` with full audit metadata.
- `DetailStructuresRepository` & `DetailStructuresService`:
  - Full draft/edit/publish lifecycle guaranteeing exactly one active version per organization.
- `DetailsRepository` & `DetailsService`:
  - Hierarchical placement and postability validation, tree listing, enable/disable operations.
- `AccountingDocumentsRepository`:
  - In `lockAccountsForLinesInTx`: Validates detail requirements on lines. When account has `detailGroupId`, `detailId` is required, must belong to the linked detail group hierarchy, and must be postable and active. When account has no detail requirement, `detailId` is forbidden.

---

## 3. Test Coverage & Verification

- Unit test suite: 113 test files, 1,307 unit tests passing with 0 failures.
- Frontend test suite: 11 test files, 63 tests passing, production build passing.
- Dedicated test suites added:
  - `backend/src/modules/accounting/domain/detail-structure.spec.ts`
  - `backend/src/modules/accounting/domain/detail.spec.ts`
  - `backend/src/modules/accounting/application/account-detail-unlink.spec.ts`
