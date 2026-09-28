# Task 30 Brief: Production Implementation of Approved Task 29 Accounting Decisions

## 1. Objective

Implement the owner decisions ratified in Task 29 (`OD-29-01`, `OD-29-02`, `OD-29-03`, and `OD-29-06`) across the Vardena Accounting engine, database schema, NestJS domain/application/data layers, and API endpoints, maintaining strict adherence to enterprise ledger immutability, multi-tenancy isolation, and permission-first RBAC.

## 2. Scope & Approved Decisions

- **OD-29-01 (Account Nature)**:
  - Account nature supports exactly `DEBIT`, `CREDIT`, and `DUAL`.
  - `DUAL` is an independent domain value for accounts that naturally balance both ways (e.g., clearing accounts, current accounts).
  - Account nature does not prohibit opposite-side postings.
- **OD-29-02 (Account Type)**:
  - Account type supports exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, and `MEMORANDUM`.
  - Immutable once operationally used in the posting/ledger lifecycle (cannot change accountType once referenced by document line).
- **OD-29-03 (Detail Hierarchy, Validation & Controlled Destructive Unlink)**:
  - Configurable Detail hierarchy with versioned structure (`DetailStructureVersion` and `DetailStructureLevel`).
  - First-class `Detail` records supporting hierarchy depth, custom digit lengths, prefix validation, and leaf-only postability.
  - Account links to Level-1 Detail Group (`Account.detailGroupId`).
  - Posting enforcement: when account requires detail, line must specify a valid, postable, active `detailId` belonging to the linked Detail Group hierarchy.
  - Controlled destructive unlinking of Account ↔ Detail Group (`confirmDestructiveUnlink: true` required, atomically clears historical detail allocations on lines and ledger entries, unlinks `detailGroupId`, preserves account monetary balance, records audit event).
- **OD-29-06 (No System Accounts)**:
  - No `isSystem` or hardcoded bypasses in MVP.

## 3. Deliverables

- Database migration `20260928000000_task30_accounting_decisions` and updated Prisma schema.
- Domain models and validation logic for Detail Structures, Details, Account Types, and Natures.
- Repository implementations with PostgreSQL transactional row-locking and verification.
- Application services, permission definitions (`Accounting.Account.UnlinkDetailGroup`, `Accounting.DetailStructure.*`, `Accounting.Detail.*`), and REST controllers.
- Comprehensive unit and integration test coverage across domain and application layers.
