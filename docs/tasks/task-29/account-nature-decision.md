# Account Nature Domain Decision: DEBIT, CREDIT, and DUAL (`هردو`)

## 1. Domain Background & Source Semantics

In Iranian accounting practice and the VARDENA Base Chart artifact, the field **`ماهیت حساب`** (Account Nature / Balance Orientation) governs the expected normal balance and orientation of an account.

The source artifact defines three distinct values:

| Source Persian Value | English Domain Concept | Business Accounting Meaning |
|---|---|---|
| **`بدهکار`** | `DEBIT` | Normal debit-balance account (Assets, Costs, Expenses, Debit Memorandum). Increases via Debit; normal balance $\ge 0$ Dr. |
| **`بستانکار`** | `CREDIT` | Normal credit-balance account (Liabilities, Equity, Revenues, Gains, Credit Memorandum). Increases via Credit; normal balance $\ge 0$ Cr. |
| **`هردو`** | `DUAL` | Bi-directional / Dual-nature account. Not constrained to a single normal balance side. May be debited in one voucher, credited in another, and carry either a net debit or net credit balance depending on operational state. |

---

## 2. The Crucial Role of `DUAL` (`هردو`)

### 2.1 Why `DUAL` Accounts Exist
In real Iranian accounting, several accounts naturally exhibit dual behavior:
1. **Current Accounts with Shareholders / Partners (`حساب جاری شرکا / سهامداران`):** May be owed money by the company (Credit) or owe money to the company (Debit).
2. **Bank Transit / Clearing Accounts (`حساب‌های واسط و در راه بانک`):** Clears transactions across settlement windows.
3. **Suspense / Transitory Clearing (`حساب‌های تصفیه و واسطه`):** Temporary reconciliation accounts.
4. **Tax Settlement Accounts (`حساب تسویه مالیاتی / ارزش افزوده`):** May be net payable or net refund/input credit.

### 2.2 Prohibited Anti-Patterns (Proposition B)
- **DO NOT collapse `هردو` into `debit` or `credit`:** Forcing `DUAL` into `debit` or `credit` distorts trial balance interpretation and presentation.
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
- `Account.accountNature String @map("account_nature") @db.VarChar(8)` (Lines 364)
- `BaseChartTemplateNode.accountNature String @map("account_nature") @db.VarChar(8)` (Lines 1080)
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

### 3.4 API DTOs
- `account.dto.ts`, `base-chart.dto.ts`, `chart-tree.dto.ts` declare:
  `accountNature!: (typeof ACCOUNT_NATURES)[number];`

### 3.5 Frontend
- `frontend/src/features/accounting/chart-tree/chart-tree-node-row.tsx:70`:
  Uses binary check `node.accountNature === 'debit' ? 'info' : 'warning'`.
- `frontend/src/api/generated/vardena-api.d.ts:4520`:
  Generated TypeScript contract types `accountNature: "debit" | "credit"`.

---

## 4. Fit-Gap Classification

| Dimension | Current State | Required State | Fit-Gap Classification | Action Required |
|---|---|---|---|---|
| **Account Nature Domain Values** | `['debit', 'credit']` | `['debit', 'credit', 'dual']` | **MODEL GAP / IMPLEMENTATION REQUIRED** | Update domain type `ACCOUNT_NATURES` |
| **Prisma Schema (`VarChar(8)`)** | `VarChar(8)` | `VarChar(8)` | **DIRECTLY COMPATIBLE** | No DDL migration required (fits `'dual'`) |
| **Validation Rules** | Rejects anything $\ne$ debit/credit | Accepts `'dual'` | **IMPLEMENTATION REQUIRED** | Update `isAccountNature` & error messages |
| **DTO Enums / Swagger** | `['debit', 'credit']` | `['debit', 'credit', 'dual']` | **IMPLEMENTATION REQUIRED** | Update API DTO decorators |
| **Frontend UI Rendering** | Binary Dr/Cr badge | Tri-state (Dr/Cr/Dual) badge | **IMPLEMENTATION REQUIRED** | Update Chart Tree & Account UI |

---

## 5. Domain Relationship with Account Type (Proposition D)

Account Nature and Account Type are orthogonal, non-interchangeable concepts:

```text
Account Nature (ماهیت)
├── Answers: "What normal debit/credit orientation is expected?"
└── Values: DEBIT | CREDIT | DUAL

Account Type (نوع حساب)
├── Answers: "What is the accounting period/reporting/closing behavior?"
└── Values: BALANCE_SHEET | INCOME_STATEMENT | MEMORANDUM
```

An account with `AccountType = BALANCE_SHEET` can have Nature `DEBIT` (Assets), `CREDIT` (Liabilities/Equity), or `DUAL` (Current Accounts/Clearing). They must remain distinct fields.
