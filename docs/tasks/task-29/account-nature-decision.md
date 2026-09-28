# Account Nature Domain Proposal: DEBIT, CREDIT, and DUAL (OD-29-01)

## 1. Domain Background & Source Semantics

In Iranian accounting practice and the VARDENA Base Chart artifact (`Pasted markdown(20260927-203801).md`), the field **`ماهیت حساب`** (Account Nature / Balance Orientation) governs the expected normal balance and orientation of an account.

The source artifact defines three distinct values:

| Source Persian Value | English Domain Concept | Business Accounting Meaning |
|---|---|---|
| **`بدهکار`** | `DEBIT` | Normal debit-balance account (171 accounts: Assets, Costs, Expenses). Increases via Debit; normal balance $\ge 0$ Dr. |
| **`بستانکار`** | `CREDIT` | Normal credit-balance account (78 accounts: Liabilities, Equity, Revenues, Contra-Assets). Increases via Credit; normal balance $\ge 0$ Cr. |
| **`هردو`** | `DUAL` | Bi-directional / Dual-nature account (15 accounts: all in Group 9 Memorandum). Not constrained to a single normal balance side. |

---

## 2. Role of `DUAL` (`هردو`) Accounts

*(Note: The accounting scenarios described below represent illustrative domain examples / analysis; not source-artifact facts and not Owner-approved Vardena requirements).*

### 2.1 Observed Source Role
In the canonical 264-account VARDENA dataset, all 15 Memorandum accounts (Group `9`) have `ماهیت = هردو`. These accounts track contingent liabilities, guarantees, and off-balance-sheet commitments which operate symmetrically.

### 2.2 Illustrative Business Scenarios (Domain Analysis)
In general commercial accounting practice, dual behavior often occurs in:
1. Current Accounts with Shareholders / Partners (`حساب جاری شرکا / سهامداران`).
2. Transit / Clearing Accounts (`حساب‌های واسط و در راه`).
3. Suspense / Settlement Accounts (`حساب‌های تصفیه و واسطه`).

### 2.3 Prohibited Anti-Patterns (Proposition B)
- **DO NOT collapse `هردو` into `debit` or `credit`:** Forcing `DUAL` into `debit` or `credit` distorts balance reporting.
- **DO NOT silently drop or ignore `هردو`:** Ignoring nature leads to validation failures or loss of accounting classification.
- **DO NOT confuse `DUAL` nature with unrestricted posting permissions:** `DUAL` defines the balance orientation expectation, not a bypass of double-entry rules.

---

## 3. Current Vardena Implementation Inspection

An exhaustive audit of the repository reveals where and how `accountNature` currently exists:

### 3.1 Domain Model (`backend/src/modules/accounting/domain/account.ts`)
```typescript
/** Balance direction (`ماهیت`) — a closed DECIDED list (§8.3). */
export const ACCOUNT_NATURES = ['debit', 'credit'] as const;

export type AccountNature = (typeof ACCOUNT_NATURES)[number];

export function isAccountNature(value: string): value is AccountNature {
  return (ACCOUNT_NATURES as readonly string[]).includes(value);
}
```
**Current limitation:** Only `'debit'` and `'credit'` are permitted. Any value `'dual'` or `'هردو'` is rejected by `isAccountNature`.

### 3.2 Database Schema (`backend/prisma/schema/accounting.prisma`)
- `Account.accountNature String @map("account_nature") @db.VarChar(8)` (Line 364)
- `BaseChartTemplateNode.accountNature String @map("account_nature") @db.VarChar(8)` (Line 1080)
*Note:* The column width `VarChar(8)` in PostgreSQL is already wide enough to store `'dual'` (4 chars) or `'DUAL'`, but the domain and application layers enforce the 2-value constraint.

### 3.3 Domain Validation & Services
- **Base Chart Template Planner (`base-chart-template.ts:542`):**
  ```typescript
  if (!isAccountNature(node.accountNature)) {
    return fail('node_nature_invalid', node.nodeKey);
  }
  ```
  Fails with `node_nature_invalid` ("Every node’s accountNature must be 'debit' or 'credit'").
- **Accounts Service (`accounts.service.ts:693`):**
  ```typescript
  private assertNature(nature: string): void {
    if (!isAccountNature(nature)) {
      throw new BadRequestException('accountNature must be "debit" or "credit".');
    }
  }
  ```
- **Adoptions Repository (`base-chart-adoptions.repository.ts:452`):**
  Throws `Base chart template node ... has an invalid account nature`.

### 3.4 API DTOs & Frontend
- `account.dto.ts`, `base-chart.dto.ts`, `chart-tree.dto.ts` declare:
  `accountNature!: (typeof ACCOUNT_NATURES)[number];`
- `frontend/src/features/accounting/chart-tree/chart-tree-node-row.tsx:70` uses binary badge rendering.

---

## 4. Fit-Gap Classification & Governance Status

| Dimension | Current State | Proposed State | Fit-Gap Classification | Owner Decision Status |
|---|---|---|---|---|
| **Account Nature Domain Values** | `['debit', 'credit']` | `['debit', 'credit', 'dual']` | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-01 (`PENDING OWNER DECISION`) |
| **Prisma Schema (`VarChar(8)`)** | `VarChar(8)` | `VarChar(8)` | **DIRECTLY COMPATIBLE** | Fits `'dual'` |
| **Validation Rules** | Rejects anything $\ne$ debit/credit | Accepts `'dual'` | **IMPLEMENTATION REQUIRED** | OD-29-01 (`PENDING OWNER DECISION`) |
| **DTO Enums / Swagger** | `['debit', 'credit']` | `['debit', 'credit', 'dual']` | **IMPLEMENTATION REQUIRED** | OD-29-01 (`PENDING OWNER DECISION`) |
| **Frontend UI Rendering** | Binary Dr/Cr badge | Tri-state (Dr/Cr/Dual) badge | **IMPLEMENTATION REQUIRED** | Proposed Task 30 |

---

## 5. Domain Relationship with Account Type (Proposition D)

Account Nature and Account Type are orthogonal, non-interchangeable concepts:

```text
Account Nature (ماهیت)
├── Answers: "What normal debit/credit orientation is expected?"
└── Proposed Values: DEBIT | CREDIT | DUAL (OD-29-01)

Account Type (نوع حساب)
├── Answers: "What is the accounting period/reporting/closing behavior?"
└── Proposed Values: BALANCE_SHEET | INCOME_STATEMENT | MEMORANDUM (OD-29-02)
```

An account with `AccountType = BALANCE_SHEET` can have Nature `DEBIT` (Assets), `CREDIT` (Liabilities/Equity), or `DUAL` (Clearing/Transit). They must remain distinct fields.
