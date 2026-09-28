# Task 30 Prompt: Implement Production Accounting Engine Decisions

Implement the production accounting changes approved in Task 29:

1. Support `DEBIT`, `CREDIT`, and `DUAL` account natures with permissive opposite-side postings (OD-29-01).
2. Support `BALANCE_SHEET`, `INCOME_STATEMENT`, and `MEMORANDUM` account types with post-use immutability (OD-29-02).
3. Introduce full Detail Structure versioning and Detail hierarchy with Level-1 Detail Group linking to Accounts, voucher line detail validation, and controlled destructive unlinking (OD-29-03).
4. Maintain fail-closed authorization, strict organization tenancy, and migration-only database changes.
