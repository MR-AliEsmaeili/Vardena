# Task 30 Brief: Production Implementation of Approved Task 29 Accounting Decisions

## 1. Objective

Implement the owner decisions ratified in Task 29 (`OD-29-01`, `OD-29-02`, `OD-29-03`, and `OD-29-06`) across the Vardena Accounting engine, database schema, NestJS domain/application/data layers, and API endpoints, maintaining strict adherence to enterprise ledger immutability, multi-tenancy isolation, and permission-first RBAC.

## 2. Scope & Approved Decisions

- **OD-29-01 (Account Nature)**:
  - Account nature supports exactly three canonical uppercase values: `DEBIT`, `CREDIT`, and `DUAL`. Lowercase values are rejected at API/domain boundaries.
  - `DUAL` is an independent domain value for accounts that naturally balance both ways (e.g., clearing accounts, current accounts).
  - Account nature does not prohibit opposite-side postings; `DUAL` accounts post to debit and credit without restriction.
- **OD-29-02 (Account Type)**:
  - Account type supports exactly three values: `BALANCE_SHEET`, `INCOME_STATEMENT`, and `MEMORANDUM`.
  - Account type remains mutable while an account is unreferenced or referenced only by Draft/Temporary document lines.
  - Draft document line reference alone does NOT freeze `accountType`.
  - Temporary document line reference alone does NOT freeze `accountType`.
  - `accountType` becomes immutable strictly upon reference in at least one posted immutable ledger entry (`ledger_entries`).
  - Authoritative enforcement resides in the repository under PostgreSQL transactional row-locking (`countPostedLedgerEntriesInTx`), backed by fast pre-flight check in service (`countPostedLedgerEntries`).
- **OD-29-03 (Detail Hierarchy, Validation & Controlled Destructive Unlink)**:
  - Configurable Detail hierarchy with versioned structure (`DetailStructureVersion` and `DetailStructureLevel`).
  - First-class `Detail` records supporting hierarchy depth, custom digit lengths, prefix validation, and leaf-only postability (`is_postable BOOLEAN NOT NULL DEFAULT TRUE`).
  - Account links to Level-1 Detail Group (`Account.detailGroupId`).
  - Posting enforcement: when account requires detail, line must specify a valid, postable, active `detailId` belonging to the linked Detail Group hierarchy.
  - Controlled destructive unlinking of Account ↔ Detail Group:
    - Mandatory exact Persian warning text: `این تغییر باعث حذف ارتباط بین تفصیلی و کد حساب می‌شود و تمامی گردش‌های تفصیلی در سندهایی که کدحساب مدنظر گردش داشته باشد حذف خواهد شد . قبل از انجام این کار از دیتا بیس بکاپ بگیرید`
    - Explicit confirmation is mandatory (`confirmUnlink: true`); cancel or absent confirmation makes zero modifications.
    - Confirmation triggers atomic database transaction that unlinks `Account.detailGroupId`, clears historical `detailId` references from `accounting_document_lines` and `ledger_entries`, preserves monetary account turnover and balances, and emits audit event (`ACCOUNT_DETAIL_UNLINKED_EVENT`) with actor, timestamp, organization, account, previous detail group, and cleared allocation counts.
- **OD-29-06 (No System Accounts)**:
  - No `isSystem` or hardcoded bypasses in MVP.

## 3. Deliverables

- Database migration `backend/prisma/migrations/20260928000000_accounting_account_semantics_and_details/migration.sql` and updated Prisma schema (`backend/prisma/schema/accounting.prisma`, `backend/prisma/schema/organization.prisma`).
- Domain models and validation logic for Detail Structures, Details, Account Types, and Natures.
- Repository implementations with PostgreSQL transactional row-locking and verification.
- Application services, permission definitions (`Accounting.Account.UnlinkDetailGroup`, `Accounting.DetailStructure.*`, `Accounting.Detail.*`), and REST controllers.
- Comprehensive unit and integration test coverage across domain and application layers.
