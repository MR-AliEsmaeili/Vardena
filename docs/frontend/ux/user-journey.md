# FE-UX-01 — Vardena Product UX Foundation & User Journey Discovery

**Status:** ACTIVE — Official Product & UX Contract
**Role:** Product Designer · UX Architect · Frontend Architect · ERP Product Analyst
**Date:** 2026-09-29
**Governance:** Aligned with `docs/frontend/standards.md` (v2.2), `docs/accounting/domain-contract.md`, ADR-0007, ADR-0021, ADR-0025, ADR-0026, and `STATE.md`.

---

## 1. Product UX Principles

Vardena is an enterprise-grade ERP designed for operational financial accuracy, dense information throughput, and strict regulatory compliance. The UX architecture adheres to the following foundational principles:

1. **Information Density over Decoration:** ERP professionals operate with high-volume data grids (30–40 rows per viewport). Whitespace is deliberate, padding is compact, and decorative cards or non-functional illustrations are prohibited.
2. **Deterministic State & Source of Truth:**
   - **Backend-owned data:** Managed solely by TanStack Query.
   - **Reproducible view state (Filters, Page, Sort):** Managed in URL Router Search Params (`URLSearchParams`).
   - **Local interaction state:** Managed in local React state (`useState`/`useReducer`).
   - **Form state:** Managed in React Hook Form + Zod.
   - **Scoped global application dependencies:** Managed in minimal React Contexts (`SessionContext`, `OrganizationContext`).
3. **No Financial Calculations on Frontend:** The backend is the single source of financial and accounting truth. The UI renders decimal strings exactly as returned (`tabular-nums`, right-aligned) and never recalculates totals, running balances, or tax amounts client-side.
4. **Honest System Capabilities (No Fake UI):** Actions, buttons, and search inputs only exist if backed by real API endpoints. When a capability is not yet implemented (e.g., Global Search, Workflow Decisioning), the UI transparently communicates its status instead of rendering dead-end fake workflows.
5. **RTL-First via Logical Properties:** Layouts and spacing strictly use CSS logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`). Directional classes (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`) are forbidden.
6. **The Four Essential States:** Every data-driven surface must explicitly handle four distinct states: `Loading`, `Success`, `Empty`, and `Error`.
7. **Semantic Feedback Taxonomy:** User feedback is strictly categorized (Inline Validation, Toast, Confirmation Dialog, Page-Level Alert, Empty State) based on severity and permanence.
8. **Consistent Formal Persian (i18n):** All user-facing copy originates from a centralized dictionary (`fa`), using formal respectful Persian ("شما") and official accounting terminology.
9. **Accessible Keyboard Navigation:** Keyboard accessibility is mandatory: standard shortcuts (e.g., `Alt+D` for Dashboard, `Tab` flow, `Enter` navigation, `Escape` dialog close) and focus trapping on interactive overlays.
10. **Zero Silent Degradation:** Network errors, permission rejections, and business rule violations surface meaningful, actionable messages with correlation tracking IDs.

---

## 2. Current Product Scope & Capability Classification

To prevent inventing non-existent features, the system's current boundaries are established as follows:

| Classification              | Definition                                                                      | Application to Vardena Current State                                                                                                                                                                                   |
| :-------------------------- | :------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EXISTS**                  | Fully implemented in backend API and frontend UI.                               | Session Login/Logout, Organization switcher, Dashboard KPIs & charts, Recent Documents grid, Accounting Navigation, Chart of Accounts tree, Account Statement report, General Ledger report, Trial Balance report.     |
| **SUPPORTED**               | Backend endpoint and schema exist; frontend implementation ready to consume.    | Accounting Document CRUD & Lifecycle (`POST /accounting-documents`, `PATCH`, `:id/issue`, `:id/finalize`, `:id/reverse`, `DELETE`), Financial Area / Fiscal Year management.                                           |
| **PARTIALLY SUPPORTED**     | Endpoint exists but lacks complete fields, filtering, or deep-linking metadata. | Accounting Document Detail view by ID (`GET /accounting-documents/:id` exists, but lacks dedicated frontend detail page and line drill-down routing).                                                                  |
| **CONTRACT GAP**            | Desired UX has no supporting backend contract/endpoint.                         | Global Full-Text Search (`/search`), Workflow Approval Action execution (`POST /workflow/instances/:id/decide`), Trial Balance total summary row in API response, Saved User Report Preferences (`/user-preferences`). |
| **FUTURE PRODUCT DECISION** | Policy, accounting rule, or design standard requiring Owner decision (OQ/ADR).  | Persian Solar Hijri DatePicker library selection (OQ-01), Dark Mode policy, System default density (Compact vs Comfortable), Finalized document print layouts.                                                         |

---

## 3. Primary User Journey Overview

The overarching journey moves deterministically from authentication through operational monitoring to granular accounting audit:

```text
[ 1. LOGIN ]
      │
      ▼
[ 2. SESSION BOOTSTRAP ]
      │ (GET /auth/me + GET /rbac/effective-permissions)
      ▼
[ 3. ORGANIZATION RESOLUTION ]
      ├─► Exactly 1 Org (Pinned/Unpinned) ──► Auto-select (Static indicator)
      ├─► Multiple Orgs                   ──► Explicit Selection Step → Topbar Switcher
      ├─► No Org Memberships              ──► Blocked State + Logout (Terminal)
      ├─► Forbidden (Missing Perm)        ──► Blocked State + Logout (Terminal)
      ├─► List Fetch Failure              ──► Error State + Retry (Terminal until retry)
      └─► Selection No Longer In List     ──► Invalid Selection → Re-select (Terminal)
      │
      ▼
[ 4. APPLICATION SHELL ]
      │ (Sidebar + Topbar + Organization Context + Permission Gates)
      ▼
[ 5. DASHBOARD ]
      │ (Turnover KPIs, Charts, Recent Documents, Fiscal Period State, Side Widgets)
      │
      ├───► Direct CTA: "تراز آزمایشی" ───┐
      ▼                                  │
[ 6. ACCOUNTING LANDING ]                 │
      │ (Surface cards with description)  │
      ├───► Chart of Accounts Tree        │
      ├───► Account Statement             │
      ├───► General Ledger                │
      └───► Trial Balance ◄───────────────┘
              │
              ▼
[ 7. REPORT PARAMETERS & FILTERING ]
              │ (Financial Area, Fiscal Year, Period, Account, Date Range)
              ▼
[ 8. REPORT EXECUTION & RESULT ]
              │ (Server Pagination, Allow-listed Sorting, Tabular Decimals)
              ▼
[ 9. DRILL-DOWN ]
              ├─► Trial Balance ──────► Account Statement (Pre-filtered)
              ├─► Account Statement ──► Document Detail (Future Route / Supported API)
              └─► General Ledger ─────► Document Detail (Future Route / Supported API)
```

---

## 4. Login Journey

### 4.1 Step-by-Step Analysis (12 Product Questions)

1. **User Goal:** Authenticate securely into the enterprise system.
2. **Why is the user here?** They are starting their workday, returned from an idle timeout, or clicked a deep-link while unauthenticated.
3. **Information Available:** Username input, password input, application branding, session expiry warning (if redirected due to timeout).
4. **User Actions:** Enter credentials, submit form (`Enter` or click button), view validation errors.
5. **Loading State:** Input fields disabled, submit button displays loading spinner and text `«در حال ورود…»`.
6. **Success Outcome:** Session cookie established; user redirected to intended destination (`location.state.from` or `/app`).
7. **No Data State:** N/A (Form input).
8. **Validation Failure:** Client-side Zod triggers inline red error text below the respective field (`«نام کاربری الزامی است.»`, `«گذرواژه الزامی است.»`).
9. **Permission Failure:** N/A during credential entry (governed post-login).
10. **Network/Server Failure:**
    - `401 Unauthorized` / `InvalidCredentials`: Generic security-compliant alert inside card — title `«نام کاربری یا گذرواژه نادرست است.»` with a recovery line `«نام کاربری و گذرواژه را بررسی کنید و دوباره تلاش کنید.»` and the support correlation id. It never renders the raw backend message or an HTTP code.
    - `NetworkError` / `500 InternalError`: Top-level alert with normalized message and correlation ID.
11. **Recovery:** Correct credentials and resubmit. Form retains username; password cleared on failure.
12. **Next Step:** Session Bootstrap (`/app`).

### 4.2 Form Lifecycle & Validation Rules

- **Schema:** Validated via `zodResolver(loginSchema)` on `onSubmit`.
- **Fields:** `username` (trimmed string, min 1), `password` (string, min 1).
- **Security Invariant:** Passwords are never logged, never stored in client state beyond form lifetime, and never echoed back in error responses.

---

## 5. Session Bootstrap UX

### 5.1 Lifecycle Sequence

Upon initial page load or hard browser refresh (`F5`), the frontend executes the bootstrap sequence:

```text
Browser Load
     │
     ▼
Session Query: GET /auth/me (retry: false, staleTime: 30s)
     ├─► 200 OK ──────────► Status: 'authenticated'
     │                           │
     │                           ▼
     │                     Permissions Query: GET /rbac/effective-permissions
     │                           │
     │                           ▼
     │                     Organization Query: GET /api/v1/organizations?isActive=true
     │
     ├─► 401 Unauthorized ─► Status: 'unauthenticated' (Normal state, NOT an error)
     │                           │
     │                           ▼
     │                     Redirect to /login with state.from
     │
     └─► 500 / NetworkErr ─► Status: 'error'
                                 │
                                 ▼
                           Full-page ApiErrorAlert with Retry button
```

### 5.2 Session Status Breakdown

- **Loading:** Renders `FullPageLoading` with spinner and label `«در حال بررسی نشست…»`. Full layout is suppressed to avoid visual flicker.
- **Session Expired (Mid-Session 401):** Interceptor intercepts 401 on any operational request, wipes TanStack Query cache completely, sets `sessionExpired = true`, and navigates to `/login` with flash alert: `«نشست شما منقضی شده است. لطفاً دوباره وارد شوید.»`.

---

## 6. Organization Resolution UX

Vardena implements organizational scoping under ADR-0021 and ADR-0025 (Deployment Pin):

### 6.1 Resolution Scenarios

```text
GET /api/v1/organizations?isActive=true
   │
   ├─► Case A: Exactly 1 Organization Returned
   │     ├─ UX Behavior: Auto-selects this organization immediately (no selection step).
   │     └─ UI Shell: Displays organization name as static badge/text (No dropdown).
   │
   ├─► Case B: Multiple Organizations Returned (> 1)
   │     ├─ UX Behavior: An explicit selection screen is shown BEFORE the workspace;
   │     │              `organizationId` stays null until the user confirms, so no
   │     │              organization-scoped request can fire with an unconfirmed scope.
   │     ├─ Post-selection: Topbar `<Select>` switcher active for later switching.
   │     ├─ Switch Action: Updates OrganizationContext, evicts the previous
   │     │                 organization's cached queries, and refetches scoped queries.
   │     └─ Persistence: Selection lives in React memory, scoped to the session's
   │                     user id (ADR-0025: no localStorage, no cookie).
   │
   ├─► Case C: Zero Organizations Returned (Empty)
   │     ├─ UX Behavior: Terminal blocked state replaces the workspace (sidebar and
   │     │              routed content are not rendered); logout is offered.
   │     └─ Copy: «سازمانی در دسترس نیست. سازمانی برای حساب کاربری شما در دسترس نیست.
   │               دسترسی عضویت سازمان را با مدیر سامانه بررسی کنید.»
   │
   ├─► Case D: Forbidden (403 / Missing `Organization.Organization.View`)
   │     ├─ UX Behavior: Terminal blocked state replaces the workspace; logout is offered.
   │     └─ Copy: «خطا در دریافت سازمان — دریافت فهرست سازمان‌ها به مجوز Organization.Organization.View نیاز دارد.»
   │
   ├─► Case E: List Fetch Failure (Network / 5xx)
   │     ├─ UX Behavior: Error state replaces the workspace (no silent degradation);
   │     │              `ApiErrorAlert` with correlation id, «تلاش دوباره» and logout.
   │     └─ Recovery: Retry refetches the list and resolution continues.
   │
   └─► Case F: Confirmed Selection No Longer In The Refreshed List
         ├─ Cause: Organization deactivated, deleted, or deployment pin mismatched.
         ├─ UX Behavior: Status `invalid` — the scope is dropped (NEVER a silent
         │              fallback to another organization) and the selection screen
         │              returns with «سازمان انتخاب‌شده دیگر در دسترس نیست.».
         └─ Scoped 404s on individual widgets surface their own `ApiErrorAlert`.
```

---

## 7. Application Shell Architecture

The shell (`AppShell`) provides the consistent operational frame across all modules:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [Logo] وردنا | سامانه یکپارچه                    [Org: شرکت نمونه ▼] [User] [خروج]    │
├──────────────────────────┬─────────────────────────────────────────────────────────────┤
│ ☰ منوی اصلی              │ مسیر: میزکار / حسابداری / درخت حساب‌ها (Breadcrumb)          │
│                          ├─────────────────────────────────────────────────────────────┤
│ 📊 میزکار                │                                                             │
│                          │                                                             │
│ 📚 حسابداری              │                     محتوای صفحه                             │
│   ├─ درخت حساب‌ها        │                   (<Outlet />)                              │
│   ├─ گردش حساب           │                                                             │
│   ├─ دفتر کل             │                                                             │
│   └─ تراز آزمایشی        │                                                             │
│                          │                                                             │
└──────────────────────────┴─────────────────────────────────────────────────────────────┘
```

### 7.1 Shell Components & Standards

- **Sidebar Navigation:**
  - Grouped into semantic sections (`میزکار`, `حسابداری`).
  - Active route highlighted (`bg-indigo-50 text-indigo-700 font-medium`).
  - Permission-aware gating: Menu items are hidden if the session lacks the backend permission code (`permissions.hasAll(...)`).
  - Mobile Drawer: Responsive off-canvas navigation overlay on `< 1024px` screens with backdrop dismissal and focus restoration.
  - Accessibility: Includes `#main-content` skip link (`sr-only focus:not-sr-only`).
- **Topbar:**
  - Branding: Application title and subtitle.
  - No search field: the backend exposes no global search contract, and an inert input would be a fake capability — the topbar search placeholder was removed (FE-UX-04, `CONTRACT GAP`).
  - Organization Switcher: Renders interactive `<Select>` for multi-org or static label for single-org; hidden while the scope is unresolved.
  - User Status: Displays current username with `dir="ltr"`.
  - Logout Control: Button with `LogOut` icon and disabled/loading state during mutation.
- **Organization Gate:** While organization resolution is `loading` / `empty` / `forbidden` / `error` / `selecting` / `invalid`, the gate replaces the sidebar and routed content entirely (explicit state per FE-UX-04; the dashboard never loads around an unresolved scope).
- **Breadcrumbs & Page Header:** Nested routes render a real-hierarchy breadcrumb (`مسیر: میزکار / حسابداری / …`, parents linked, current page `aria-current="page"`); no breadcrumb is invented for single-level routes. Each view additionally renders a standardized `PageHeader` with title, subtitle, and primary contextual actions.
- **404 Not Found Handling:** Unmatched paths inside `/app/*` render `NotFoundPage` with CTA `«بازگشت به صفحه اصلی»`.

---

## 8. Dashboard → Accounting Journey

### 8.1 Dashboard Layout & Information Hierarchy

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [Banner] وضعیت دوره مالی: دوره مالی ۱ (باز)                                            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [KPI Row]  [جمع گردش بدهکار]   [جمع گردش بستانکار]   [خالص گردش دوره]   [دوره‌های دارای گردش]   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [Charts]   [گردش بدهکار/بستانکار]   [خالص گردش دوره‌ها]   [بزرگ‌ترین گردش‌ها]   [حرکات انبار] │
├────────────────────────────────────────────────────────────┬───────────────────────────┤
│ [جدول اسناد اخیر] (Recent Accounting Documents)            │ [ابزارک‌ها]               │
│ - شماره سند | تاریخ | شرح | جمع (ریال) | وضعیت | منشأ       │ ├─ گردش‌کارهای فعال (نمایشی)│
│ - صفحه ۱ از ۵ | صفحه‌بندی سمت سرور                         │ ├─ کمترین موجودی انبار    │
│ - مرتب‌سازی بر اساس تاریخ و شماره سند                      │ ├─ وضعیت دوره‌های مالی    │
│                                                            │ └─ [CTA] تراز آزمایشی     │
└────────────────────────────────────────────────────────────┴───────────────────────────┘
```

### 8.2 Widget Categorization & Interaction Rules

1. **Informational Widgets:**
   - **KPI Cards:** Aggregated balance figures from `GET /accounting/balances`.
   - **Trend Charts:** SVG-rendered debit/credit turnover and stock trends.
   - **Recent Documents Table:** Live paginated read model from `GET /accounting-documents`.
   - **Workflow Widget:** Displays active instances (`DISPLAY ONLY`, approval decision action is a `CONTRACT GAP`).
   - **Inventory Alert Widget:** Displays stock sorted by `onHand` (honestly labeled as on-hand ranking).
2. **Navigational Transitions into Accounting:**
   - **Reconciliation Card CTA:** Direct link button `«باز کردن تراز آزمایشی»` navigating to `/app/accounting/trial-balance`.
   - **Sidebar Menu:** Direct links to `درخت حساب‌ها`, `گردش حساب`, `دفتر کل`, and `تراز آزمایشی`.
   - **Document Row Click (Future Requirement):** Once Document View is implemented, clicking a document row navigates to its voucher detail view (`/app/accounting/documents/:id`).

---

## 9. Accounting Information Architecture (IA)

The Accounting subsystem is organized hierarchically around accounting workflows and user intent:

```text
Accounting (حسابداری)
├── 1. Master Data & Structure (اطلاعات پایه و ساختار)
│   ├── Chart of Accounts (درخت حساب‌ها) ──────────────► /app/accounting/chart [EXISTS]
│   ├── Financial Areas (حوزه‌های مالی) ──────────────► Reference Filter Data [EXISTS] / Management UI [SUPPORTED API]
│   ├── Fiscal Years (سال‌های مالی) ───────────────────► Reference Filter Data [EXISTS] / Management UI [SUPPORTED API]
│   └── Accounting Periods (دوره‌های مالی) ───────────► Reference Filter Data [EXISTS] / Management UI [SUPPORTED API]
│
├── 2. Documents & Vouchers (اسناد حسابداری)
│   ├── Recent Documents (اسناد اخیر) ────────────────► Embedded in Dashboard [EXISTS]
│   ├── Document Management (فهرست، پیش‌نویس، قطعی) ───► /app/accounting/documents [SUPPORTED API / FUTURE UI]
│   ├── Document Compose / Edit (ثبت و ویرایش سند) ───► /app/accounting/documents/new [SUPPORTED API / FUTURE UI]
│   └── Document View & Reversal (مشاهده و معکوس‌سازی) ─► /app/accounting/documents/:id [SUPPORTED API / FUTURE UI]
│
└── 3. Financial Reports & Ledgers (گزارش‌ها و دفاتر مالی)
    ├── Account Statement (گردش حساب) ────────────────► /app/accounting/account-statements [EXISTS]
    ├── General Ledger (دفتر کل) ─────────────────────► /app/accounting/general-ledger [EXISTS]
    └── Trial Balance (تراز آزمایشی) ─────────────────► /app/accounting/trial-balance [EXISTS]
```

---

## 10. Report Discovery Flow

When navigating to reports, the UX answers five essential questions for the accountant:

| Question                    | Account Statement (گردش حساب)                                                                     | General Ledger (دفتر کل)                                                                        | Trial Balance (تراز آزمایشی)                                                                          |
| :-------------------------- | :------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| **Where am I?**             | `/app/accounting/account-statements`                                                              | `/app/accounting/general-ledger`                                                                | `/app/accounting/trial-balance`                                                                       |
| **What does it represent?** | Opening balance, continuous running movements, and closing balance for a single postable account. | Immutable chronological double-entry movement rows across accounts.                             | Aggregated balance summary (Opening, Debit Turnover, Credit Turnover, Net, Closing) across the chart. |
| **Required Scope?**         | Fiscal Year (`fiscalYearId`), Account (`accountId`).                                              | Financial Area (`financialAreaId`), Fiscal Year (`fiscalYearId`).                               | Financial Area (`financialAreaId`), Fiscal Year (`fiscalYearId`).                                     |
| **Optional Filters?**       | Financial Area, Accounting Period.                                                                | Accounting Period, Account Picker, Account Code/Name search, Date Range (`dateFrom`, `dateTo`). | Accounting Period, Account Picker, Account Code/Name search, Date Range (`dateFrom`, `dateTo`).       |
| **Default Initial State?**  | Neutral alert: «برای نمایش گزارش، حساب و سال مالی را انتخاب کنید.»                                | Neutral alert: «برای نمایش گزارش، حوزه مالی و سال مالی را انتخاب کنید.»                         | Neutral alert: «برای نمایش گزارش، حوزه مالی و سال مالی را انتخاب کنید.»                               |

---

## 11. Report Filter UX

### 11.1 Filter Interaction & Validation Rules

- **Form Management:** Implemented via React Hook Form with `zodResolver(scopeSchema)` in `onSubmit` mode.
- **Cascade & Dependent Reset Rules:**
  - Selecting/changing `financialAreaId` automatically clears and re-fetches `fiscalYearId` and `accountingPeriodId`.
  - Selecting/changing `fiscalYearId` automatically clears and re-fetches `accountingPeriodId`.
  - Account Picker searches postable (leaf) accounts dynamically via `GET /accounts?isPostable=true&search=...` (debounced 300ms).
- **Date Format Contract:** Date filters are canonical Gregorian BusinessDates (`YYYY-MM-DD`) in the URL/API and validate as real calendar days. The shared `DateInput` presents the organization-configured calendar (Jalali by default) and emits the canonical day; no filter is transported as a timestamp or UTC midnight. Jalali is explicitly declared for API request bodies that accept BusinessDate input; filters remain canonical Gregorian days (ADR-0042, `docs/datetime.md`).
- **Apply Action:** User explicitly clicks `«نمایش گزارش»`. Validates inputs, resets table to page 1, and triggers data query.
- **Reset Action:** User clicks `«پاک کردن فیلترها»`. Clears all inputs and unloads current query results.

### 11.2 URL State Architecture vs Local State (Anti-Pattern Remediation)

- **Current State:** Filter state currently resides in component `useState` via `useReportQueryState`.
- **UX Requirement (Standards §5):** Report parameters, page number, page size, and sorting MUST reside in Router Search Params (`?area=...&year=...&account=...&page=1&sort=code:asc`).
- **Benefits:**
  - Deep-linking & bookmarking of exact report snapshots.
  - Seamless Browser Back/Forward navigation between reports and drill-downs without state loss.
  - Browser Refresh (`F5`) preserves active audit filters.

---

## 12. Report Result UX

### 12.1 The Four Display States

```text
1. INITIAL / MISSING SCOPE:
   ┌────────────────────────────────────────────────────────┐
   │ ℹ برای نمایش گزارش، حوزه مالی و سال مالی را انتخاب کنید. │
   └────────────────────────────────────────────────────────┘

2. LOADING (Query in Flight):
   ┌────────────────────────────────────────────────────────┐
   │ [Skeleton Header Row]                                  │
   │ [Skeleton Row 1] [Skeleton Row 2] [Skeleton Row 3] ... │
   └────────────────────────────────────────────────────────┘

3. EMPTY (Query Succeeded with 0 Rows):
   ┌────────────────────────────────────────────────────────┐
   │                    داده‌ای یافت نشد                     │
   │      برای فیلترهای انتخاب‌شده هیچ ردیفی بازگردانده نشد.      │
   └────────────────────────────────────────────────────────┘

4. SUCCESS (Data Grid with Server Controls):
   ┌────────────────────────────────────────────────────────┐
   │ [Summary Header (Account Statement Totals)]            │
   │ ┌────────────────────────────────────────────────────┐ │
   │ │ Table: Sticky Header, Allow-listed Sorting, Tabular │ │
   │ ├────────────────────────────────────────────────────┤ │
   │ │ Row 1: Code | Date | Desc | Debit | Credit | Net   │ │
   │ │ Row 2: ...                                         │ │
   │ └────────────────────────────────────────────────────┘ │
   │ [Pagination: صفحه ۱ از ۱۰ · قبلی | بعدی · تعداد در صفحه] │
   └────────────────────────────────────────────────────────┘
```

### 12.2 Grid Formatting & Backend Financial Truth

- **Amounts:** Displayed via `<AmountCell>` with `tabular-nums`, right alignment, and thousand separators. Negative numbers highlighted in red text.
- **Server-Side Summary Cards:** Account Statement displays authoritative backend totals (`openingBalance`, `debitTotal`, `creditTotal`, `netChange`, `closingBalance`).
- **No Client Calculations:** If backend does not provide total sums (as in Trial Balance endpoint), frontend strictly refrains from summing columns client-side.

---

## 13. Drill-Down UX Architecture

Drill-down navigation enables financial auditors to trace high-level balances down to the underlying journal voucher:

```text
[ TRIAL BALANCE (تراز آزمایشی) ]
      │
      │ (Click Account Code / Row)
      ▼
[ ACCOUNT STATEMENT (گردش حساب) ]
      │ Pre-fills: accountId, fiscalYearId, financialAreaId
      │
      │ (Click Voucher Number / Line)
      ▼
[ ACCOUNTING DOCUMENT DETAIL (مشاهده سند حسابداری) ]  <── [ CONTRACT GAP: Dedicated UI Page ]
      │ (GET /accounting-documents/:id exists in backend API)
      │
      │ (Click Source Entity Reference)
      ▼
[ SOURCE TRANSACTION (انبار / فاکتور) ]               <── [ CONTRACT GAP: Cross-module UI link ]
```

### 13.1 Drill-Down Capability Matrix

| Transition                              | User Action                    | Target Destination                                                  | Status                                                   | Implementation Mechanism                                                              |
| :-------------------------------------- | :----------------------------- | :------------------------------------------------------------------ | :------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| **Trial Balance → Account Statement**   | Click Account row or code link | `/app/accounting/account-statements?fiscalYearId=...&accountId=...` | **SUPPORTED** (URL param mapping required)               | React Router `Link` / `navigate` passing query parameters.                            |
| **Account Statement → Document Detail** | Click `voucherNumber`          | `/app/accounting/documents/:voucherId`                              | **PARTIALLY SUPPORTED** (API exists; UI route is Future) | Backend `GET /accounting-documents/:id` ready; requires frontend Document View route. |
| **General Ledger → Document Detail**    | Click `voucherNumber`          | `/app/accounting/documents/:voucherId`                              | **PARTIALLY SUPPORTED** (API exists; UI route is Future) | Same as above.                                                                        |
| **Document Line → Source Subledger**    | Click `sourceEntityId`         | `/app/inventory/movements/:id`                                      | **CONTRACT GAP**                                         | Source entity cross-module route contracts not yet formalized.                        |

---

## 14. Logout & Session Expiry UX

### 14.1 Explicit User Logout

1. User clicks `«خروج»` in Topbar.
2. Button enters loading state (`«در حال خروج…»`).
3. Executes `POST /api/v1/auth/logout` (server-side session revocation).
4. `onSettled`: Client drops all cached queries via `queryClient.clear()`, resets session context to `unauthenticated`, and redirects to `/login`.

### 14.2 Passive Session Timeout (401 Response)

1. User session expires on server due to idle timeout.
2. Next API request receives `401 Unauthorized`.
3. Axios interceptor fires `unauthorizedHandler`:
   - Sets `sessionExpired = true`.
   - Clears entire TanStack Query cache (preventing stale sensitive data leakage).
   - Redirects to `/login` preserving target path in `state.from`.
4. Login page displays persistent warning banner: `«نشست شما منقضی شده است. لطفاً دوباره وارد شوید.»`.

---

## 15. UX Feedback Taxonomy & Strategy

To avoid notification fatigue and maintain professional clarity, Vardena standardizes all UI feedback:

```text
┌─────────────────────────┬───────────────────────────────┬──────────────────────────────────┐
│ Feedback Type           │ Intended Use Case             │ Concrete Example                 │
├─────────────────────────┼───────────────────────────────┼──────────────────────────────────┤
│ 1. Inline Validation    │ Field-specific input errors   │ «تاریخ باید به قالب YYYY-MM-DD    │
│                         │ (Zod / React Hook Form)       │  باشد.»                          │
├─────────────────────────┼───────────────────────────────┼──────────────────────────────────┤
│ 2. Toast Notification   │ Brief confirmation of an      │ «سند با موفقیت ثبت شد.»          │
│                         │ asynchronous operation        │ (Auto-dismiss 4s, Max 3)         │
├─────────────────────────┼───────────────────────────────┼──────────────────────────────────┤
│ 3. Confirmation Dialog  │ Irreversible, high-impact, or │ «آیا از معکوس‌سازی (Reversal)     │
│                         │ destructive financial actions │  این سند اطمینان دارید؟»         │
├─────────────────────────┼───────────────────────────────┼──────────────────────────────────┤
│ 4. Page/Section Alert   │ Query failures, missing scope,│ «خطا در دریافت دفتر کل — تلاش    │
│                         │ or permission blocks          │  دوباره [کد پیگیری: req_123]»    │
├─────────────────────────┼───────────────────────────────┼──────────────────────────────────┤
│ 5. Empty State          │ Succeeded query with 0 results│ «برای فیلترهای انتخاب‌شده هیچ     │
│                         │                               │  ردیفی بازگردانده نشد.»          │
├─────────────────────────┼───────────────────────────────┼──────────────────────────────────┤
│ 6. Permission Gate Alert│ Route or widget blocked due   │ «دسترسی لازم را ندارید — مجوز:    │
│                         │ to missing RBAC privilege     │  Accounting.TrialBalance.View»   │
└─────────────────────────┴───────────────────────────────┴──────────────────────────────────┘
```

---

## 16. Persian UX Language & Terminology Policy

1. **Tone of Voice:** Professional, formal, and concise. Users are addressed with the polite plural pronoun «شما».
2. **No Raw Backend Internals:** Technical errors (`500`, `ECONNREFUSED`, `PrismaClientKnownRequestError`, `404`) must never be displayed raw. They are mapped to human-readable Persian explanations.
3. **Actionable Error Formula:** Every error message must specify:
   $$\text{What happened} + \text{What the user can do} + [\text{Correlation Tracking ID}]$$
   _Example:_ `«دریافت فهرست اسناد انجام نشد. اتصال شبکه را بررسی کنید یا دوباره تلاش کنید. (کد پیگیری: 01HZX8...)»`
4. **Canonical Accounting Glossary:**
   - Account: `حساب`
   - Account Code: `کد حساب`
   - Chart of Accounts: `درخت حساب‌ها`
   - General Ledger: `دفتر کل`
   - Trial Balance: `تراز آزمایشی`
   - Account Statement: `گردش حساب`
   - Accounting Document / Voucher: `سند حسابداری`
   - Draft / Temporary / Final: `پیش‌نویس / موقت / قطعی`
   - Reversal Voucher: `سند معکوس`
   - Financial Area: `حوزه مالی`
   - Fiscal Year: `سال مالی`
   - Accounting Period: `دوره مالی`
   - Organization: `سازمان`

---

## 17. Permission UX & Security Boundary

- **Architectural Truth:** UI permission checks are **UX presentation gates only**. The backend is the sole security and authorization authority.
- **Four Permission UX States:**
  1. _Unauthenticated:_ Immediate redirect to `/login`.
  2. _Authenticated but Lacks UI Permission:_ Menu item hidden; direct route access renders `RequirePermission` warning alert specifying required code.
  3. _Permission Granted:_ Full access to route and features.
  4. _Backend Rejection (Concurrent Revocation / 403):_ Render `ApiErrorAlert` with `«مجوز لازم برای این عملیات را ندارید.»`.

---

## 18. Known Contract Gaps

The following capabilities are recognized as missing backend contracts or unimplemented UI routes:

1. **Global Search Endpoint (`CONTRACT GAP`):** Topbar search field is currently a non-submitting visual placeholder. Backend has no `/api/v1/search` endpoint.
2. **Workflow Approval Decision Surface (`CONTRACT GAP`):** Dashboard workflow widget displays active instances. Mutating state (Approve/Reject) requires a dedicated backend decision surface.
3. **Trial Balance Total Summary Row (`CONTRACT GAP`):** `TrialBalanceResponseDto` returns account rows but no aggregate totals object. Frontend intentionally does not compute client-side totals.
4. **Accounting Document View & Management UI (`SUPPORTED API / FUTURE UI`):** Backend provides full CRUD (`POST /accounting-documents`, `GET :id`, `finalize`, `reverse`), but frontend currently only contains the Dashboard recent documents table.
5. **Cross-Module Drill-Down Linkage (`CONTRACT GAP`):** `sourceModule` and `sourceEntityId` exist in ledger movement DTOs, but target entity view routes are not yet standardized.
6. **Inventory Operations & Valuation UI (`SUPPORTED API / FUTURE UI`, added 2026-10-04):** the backend ships movement posting, transfers, the quantity Kardex and the full valuation surface (`/api/v1/inventory/valuation/*`), but `frontend/src/features` contains **no** inventory feature at all — only the read-only dashboard stock widget. Target UX is specified in §18A; implementation is roadmap candidate C-57.

---

## 18A. Inventory: Warehouse Operations vs. Inventory Accounting (`SUPPORTED API / FUTURE UI`)

**Added 2026-10-04; backend hardening updated 2026-10-05.** The backend valuation foundation (ADR-0039, PDR-05 /
OD-VAL-01…OD-VAL-19) is implemented and C-57 added operational hardening for
backdated reversals, repricing permissions and backdated-transfer detection;
**no Inventory route exists in `frontend/src` yet**. This section is the target UX
contract for the slice that builds it, not a description of shipped UI. Persian
copy, vocabulary and the dialog catalogue live in `persian-ux-writing-standard.md`
§3.4/§9 and `feedback-standard.md` §5.3/§5.4.

### 18A.1 Two workspaces, one set of records (OD-VAL-08)

The same `inventory_movements` rows are presented through two different lenses. There
is no second ledger and no "accounting copy" of a warehouse document — a navigation
split, not a data split.

| | **عملیات انبار** (Warehouse Operations) | **حسابداری انبار** (Inventory Accounting) |
| :--- | :--- | :--- |
| Persona | Warehouse keeper — counts things | Accountant — values things |
| Primary question | *What moved, how much, where?* | *What is it worth, and what is still unpriced?* |
| Surfaces | `رسید انبار` (receipt), `صادره انبار` (issue), `انتقال بین انبارها` (transfer), quantity stock on hand, quantity Kardex — **all usable end to end without a single monetary field** | `قیمت تمام‌شده` per movement, `ارزش کل` per key, `وضعیت قیمت‌گذاری`, `موجودی بدون قیمت تمام‌شده`, `ارزش‌گذاری نامعتبر` (stale), `قیمت‌گذاری مجدد` (bounded repricing), method configuration |
| Money fields | Optional on a receipt; **absent from the issue form** | First-class |
| Required permissions | `Inventory.Movement.{View,Create}`, `Inventory.Balance.View` | `Inventory.Valuation.{View,Configure,AssignCost,Recalculate}` |
| Default landing | Post a receipt / post an issue / stock on hand | Worklist of `pending_cost` and `stale` keys |
| Never shows | A blocking "cost is required" error | A quantity the warehouse has not posted |

A user holding only operations permissions sees the same movement rows with the
monetary columns **blank** (the API blanks them server-side) — same layout, same row
count, no hidden records, no different shape.

### 18A.2 Journey A — receipt without a cost (the default case)

1. `رسید انبار` form: item, warehouse, quantity, date. `قیمت تمام‌شده` is a clearly
   optional field, never marked required and never validated into existence.
2. Submit → movement posted; the key's `uncostedQuantity` grows and its status becomes
   `در انتظار قیمت تمام‌شده`.
3. Toast: `رسید انبار ثبت شد.` No warning, no error — this is a normal outcome.
4. The row appears in the Inventory Accounting worklist. The value column shows `—`,
   **never `۰`** (`persian-ux-writing-standard.md` §9.11).

### 18A.3 Journey B — pricing it later (`Inventory.Valuation.AssignCost`)

1. From the worklist, `ثبت قیمت تمام‌شده` on an unvalued inbound movement.
2. The dialog states that the value is an addition and is not editable afterwards
   (correction is by reversal), and requires the same explicit repricing choice.
3. `409` (already priced) is presented as a business message with the reversal path,
   never as a raw conflict.

### 18A.4 Journey C — the backdated document (two dialogs, never one)

The hard rule: **two separate confirmations**, in order, with no default on the second
(OD-VAL-10/OD-VAL-11). Collapsing them into a single "Are you sure?" is an explicit
anti-pattern — see `feedback-standard.md` §5.4 for the catalogue entries and copy.

1. The form may call `GET /inventory/valuation/backdate-check` as the date leaves the
   field, so the warning is known *before* submit. That endpoint is gated by
   `Inventory.Movement.Create` and returns counts and dates only — a warehouse user who
   may not see money can still see the consequence.
2. **Dialog 1 — consequence:** how many later movements exist, how many of them are
   valued, and the date of the latest one, in plain Persian.
3. **Dialog 2 — choice:** `قیمت‌گذاری مجدد انجام شود` or `انجام نشود`, both spelling out
   their effect, neither preselected.
4. On `انجام نشود`, the success toast is followed by a **persistent** notice
   `ارزش‌گذاری این کالا و انبار نامعتبر است.` with a `قیمت‌گذاری مجدد` action. The UI must
   never hide a `stale` state behind a number that looks correct.

### 18A.5 Journey D — bounded repricing (`Inventory.Valuation.Recalculate`)

Repricing always names **one item in one warehouse**. There is intentionally no
"recalculate everything" endpoint (OD-VAL-12), so the UI must not offer one, not even
as a bulk selection. `inventory.recalculation_too_large` is presented as a bounded-scope
message, never as a retryable failure.

### 18A.6 Valuation method configuration (`Inventory.Valuation.Configure`)

Scope is organization + item and versions are effective-dated: the form creates a new
version with a `valid from` date and never edits an existing one (the same UX rule the
unit-conversion surface already follows). The method `<Select>` offers **only**
`میانگین موزون متحرک`; FIFO/standard are not rendered as disabled options or
"coming soon" items, because offering an unimplemented method is itself the
anti-pattern OD-VAL-18 forbids.

### 18A.7 Classification

| Capability | Classification |
| :--- | :--- |
| `/api/v1/inventory/valuation/*` (9 routes, 4 permissions) | `SUPPORTED` |
| Warehouse Operations and Inventory Accounting routes, forms, worklist | `FUTURE UI` — candidate **C-57** in the roadmap register |
| Jalali display of `movementDate` / `validFrom` | Required to use the accepted shared organization-calendar formatter (ADR-0042); any future Inventory UI must not add local conversion. The currently listed valuation-method configuration screen remains FUTURE UI. |
| Returns, COGS posting, landed cost surfaces | Not a gap in the UI — **no backend contract exists and none is planned in this slice** (OQ-24 open, OD-VAL-19) |

---

## 19. Future UX Considerations

1. **Persisted UI Preferences:** User customization of table column order, density (Compact/Comfortable), and saved report filter presets (pending Customization module).
2. **Report Export Workflows:** Seamless streaming export to Excel (XLSX) and printable PDF documents via backend reporting pipeline (ADR-0009 / ADR-0012).
3. **Optional Jalali calendar-grid picker:** a future presentation enhancement to the existing shared Jalali text field in `DateInput`; it does not reopen or change ADR-0042's accepted calendar contract and is not an OQ-01/OQ-02 blocker.
4. **Batch Operations Grid:** Bulk document posting/reversal workflows with multi-row selection and batch progress indicators.

---

## 20. Final Recommended Journey Specification

The recommended journey solidifies an unbreakable, linkable, and robust workflow for Vardena:

1. **Login:** Direct credential submission with deep-link redirection.
2. **Bootstrap:** Automatic profile resolution, permission loading, and organization context locking.
3. **Dashboard:** High-level executive overview with direct jump points to reports and recent document monitoring.
4. **Report Center:** Selection of Account Statement, General Ledger, or Trial Balance with URL-addressable parameters.
5. **Drill-Down:** Seamless traversal from high-level trial balance down to individual voucher lines, with browser history fully preserved.
