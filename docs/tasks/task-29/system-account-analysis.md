# System Account (`isSystem`) Domain Analysis

## 1. Domain Concept & Definition

**`System Account`** (حساب سیستمی / کنترل سیستمی) is an independent domain attribute (`isSystem: boolean`) that answers:
> **Is this account controlled and managed by automated system processes, rather than being freely available for ordinary manual user posting?**

*(Note: The automated ledger operation examples listed below represent illustrative domain analysis; they are not source-artifact facts and not Owner-approved Vardena requirements).*

### Illustrative Automated Ledger Roles (Domain Analysis)
1. **Fiscal Year-End Closing & Summary:** e.g. Income Summary Accounts.
2. **Retained Earnings Accumulator:** e.g. Retained Earnings Accounts.
3. **Opening / Closing Balance Transitory:** e.g. Opening/Closing Balance Offset Accounts.
4. **Automated Subsystem Integration Clearing:** e.g. Inventory Valuation Clearing, FX Clearing.

---

## 2. Orthogonality & Separation of Concerns (Proposition F)

The `isSystem` flag is completely orthogonal to other account concepts:

```text
Account
├── type: AccountType (Proposed: BALANCE_SHEET | INCOME_STATEMENT | MEMORANDUM)
├── balanceNature: AccountNature (Proposed: DEBIT | CREDIT | DUAL)
├── statementClass: StatementClass? (Configurable Presentation Node)
└── isSystem: boolean (System Control Restriction Flag)
```

### Prohibited Inferences:
- **DO NOT infer system status from account titles:** System behavior must never be keyed off Persian strings such as `"بستن حساب"` or `"افتتاحیه"`.
- **DO NOT conflate with Account Type:** A system account can be `BALANCE_SHEET` (e.g. Opening Balance Offset) or `INCOME_STATEMENT` (e.g. Income Summary).
- **DO NOT invent system accounts in Task 29:** Concrete system account identities belong to the specific subsystems that require them (Fiscal Closing, Subsystem Posting Integrations).

---

## 3. Current Vardena Inspection & Fit-Gap Status

- **Prisma Schema (`accounting.prisma`):**
  - `Account`: Has `isPostable`, `isActive`, but **NO** `isSystem` column.
  - `BaseChartTemplateNode`: Has `isPostable`, `isMandatory`, `defaultIsActive`, but **NO** `isSystem` column.
- **Posting Validation:** The current posting service (`posting.service.ts`) validates that an account is active, postable, and a leaf, but does not enforce system-account manual posting locks.

### Fit-Gap Classification & Governance Status:
- **Classification:** `FUTURE MODEL GAP` (Deferred to Future Subsystem Integration / Year-End Closing Task).
- **Owner Decision:** OD-29-06 (`PENDING OWNER DECISION`).
