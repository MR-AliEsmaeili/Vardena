# Task 30 Implementation Report: Production Accounting Decisions (OD-29-01, OD-29-02, OD-29-03)

## 1. Executive Summary

Task 30 brings the owner decisions from Task 29 into production across schema, migration, domain, application, API, and test suites:

- **OD-29-01**: Account Nature supports exactly three canonical uppercase domain values (`DEBIT`, `CREDIT`, `DUAL`). Lowercase values are rejected fail-closed at API/domain boundaries. `DUAL` is an independent domain value and opposite-side postings are not prohibited.
- **OD-29-02**: Account Type supports exactly three values (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`). Account Type immutability timing is strictly tied to posted ledger evidence: accounts referenced by draft or temporary document lines remain mutable; once referenced in an immutable posted ledger entry (`ledger_entries`), `accountType` becomes immutable.
- **OD-29-03**: Detail hierarchy versioning, level definitions, multi-level detail records with `isPostable` (`is_postable`), account-to-detail-group linking (`detailGroupId`), voucher line detail allocation validation, and controlled atomic destructive unlinking with exact warning text.
- **OD-29-06**: Verified absence of system account bypasses in MVP.
- **OD-29-05**: Statement classification implementation is preserved as deferred to the Reporting Foundation (no statement classification schema or API added).

---

## 2. Changes by Layer

### 2.1 Database & Schema (`backend/prisma/schema/accounting.prisma` & migration)

- Added `account_type` (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`, default `'BALANCE_SHEET'`) to `Account`.
- Normalized legacy `account_nature` values to canonical uppercase (`DEBIT`, `CREDIT`, `DUAL`) in migration.
- Added `detail_group_id` nullable foreign key to `Account` referencing `Detail`.
- Created `detail_structure_versions` and `detail_structure_levels` tables supporting organization-specific hierarchy depths, custom level names, digit lengths, and version statuses (`draft`, `active`, `superseded`).
- Created `details` table representing hierarchical detail nodes with `code`, `title`, `level`, `is_postable BOOLEAN NOT NULL DEFAULT TRUE`, `is_active`, and `parent_id`.
- Added nullable `detail_id` referencing `Detail` to `accounting_document_lines` and `ledger_entries`.
- Migration path: `backend/prisma/migrations/20260928000000_accounting_account_semantics_and_details/migration.sql`.

### 2.2 Domain Layer (`backend/src/modules/accounting/domain/`)

- `account.ts`:
  - `ACCOUNT_NATURES` = `['DEBIT', 'CREDIT', 'DUAL'] as const`.
  - `ACCOUNT_TYPES` = `['BALANCE_SHEET', 'INCOME_STATEMENT', 'MEMORANDUM'] as const`.
  - `planAccountEdit`: Distinguishes line references (`referencedByDocumentLine`) from posted ledger entries (`hasPostedLedgerEntry`). Draft/temporary document lines freeze structural fields (`parentId`, `level`, `accountNature`, `detailGroupId`, `isPostable`) but keep `accountType` mutable; `accountType` freezes strictly upon `hasPostedLedgerEntry: true`.
  - Exact mandatory destructive unlink warning text:
    `این تغییر باعث حذف ارتباط بین تفصیلی و کد حساب می‌شود و تمامی گردش‌های تفصیلی در سندهایی که کدحساب مدنظر گردش داشته باشد حذف خواهد شد . قبل از انجام این کار از دیتا بیس بکاپ بگیرید`
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
  - Creation and update enforce validated uppercase `accountNature`, `accountType`, and `detailGroupId`.
  - Immutability check under transaction and row locks uses `countReferencingLinesInTx` and `countPostedLedgerEntriesInTx`.
  - Implemented `unlinkDetailGroupChecked`: Requires explicit `confirmUnlink = true`, atomically executes `UPDATE accounting_document_lines SET detail_id = NULL WHERE account_id = $id`, `UPDATE ledger_entries SET detail_id = NULL WHERE account_id = $id`, and `UPDATE accounts SET detail_group_id = NULL WHERE id = $id`. Preserves account monetary turnover and emits `ACCOUNT_DETAIL_UNLINKED_EVENT` with full audit metadata.
- `DetailStructuresRepository` & `DetailStructuresService`:
  - Full draft/edit/publish lifecycle guaranteeing exactly one active version per organization.
- `DetailsRepository` & `DetailsService`:
  - Hierarchical placement and postability validation, tree listing, enable/disable operations.
- `AccountingDocumentsRepository`:
  - In `lockAccountsForLinesInTx`: Validates detail requirements on lines. When account has `detailGroupId`, `detailId` is required, must belong to the linked detail group hierarchy, and must be postable and active. When account has no detail requirement, `detailId` is rejected.

---

## 3. Test Coverage & Verification

- Unit & integration test suites passing.
- Dedicated test suites added/updated:
  - `backend/src/modules/accounting/domain/detail-structure.spec.ts`
  - `backend/src/modules/accounting/domain/detail.spec.ts`
  - `backend/src/modules/accounting/domain/account-placement.spec.ts` (draft line vs posted ledger immutability)
  - `backend/src/modules/accounting/application/coding-structure-accounts.spec.ts` (OD-29-01 & OD-29-02 regression suites)
  - `backend/src/modules/accounting/application/account-detail-unlink.spec.ts` (atomic unlink, audit event, turnover preservation)
