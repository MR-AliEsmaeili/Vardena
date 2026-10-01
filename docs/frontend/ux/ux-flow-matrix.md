# FE-UX-01 — UX Flow, State & Decision Matrices

**Status:** ACTIVE — Official UX Contract Specification
**Role:** Product Designer · UX Architect · Frontend Architect · ERP Product Analyst
**Date:** 2026-09-29
**Governance:** Aligned with `docs/frontend/standards.md` (v2.2), `docs/frontend/ux/user-journey.md`, and Vardena API Contracts.

---

## 1. Comprehensive State Matrix

The table below maps the ten core interaction flows of the Vardena frontend across all operational states:

| Flow                            | Idle / Initial                                      | Loading                                     | Success                                          | Empty State                                  | Validation Error                                 | Permission Error                                              | Network Error                                      | Server Error (500)                       | Primary Recovery Action                     |
| :------------------------------ | :-------------------------------------------------- | :------------------------------------------ | :----------------------------------------------- | :------------------------------------------- | :----------------------------------------------- | :------------------------------------------------------------ | :------------------------------------------------- | :--------------------------------------- | :------------------------------------------ |
| **1. Login**                    | Clean form, focus on `username`                     | Inputs disabled, spinner on submit button   | Session set; redirect to `state.from` or `/app`  | N/A (Form input)                             | Inline red field error below input (`RHF + Zod`) | `401 Unauthorized`: Alert «نام کاربری یا گذرواژه نادرست است.» | Form-level Alert with «ارتباط با سرور برقرار نشد.» | Form-level Alert with correlation ID     | Correct inputs and re-submit                |
| **2. Session Bootstrap**        | N/A (Executes automatically on boot)                | `FullPageLoading` with «در حال بررسی نشست…» | Renders protected application tree               | 401 returns `unauthenticated` state          | N/A (Internal probe)                             | Unauthenticated redirects to `/login`                         | Full-page error alert with retry button            | Full-page error alert with retry button  | Click «تلاش دوباره» or reload page          |
| **2b. License Activation**      | Backend reports no active license; code field empty, focused on submit attempt | Submit disabled with «در حال فعال‌سازی مجوز…»; field disabled | `GET /license/current` re-read reports ACTIVE → gate releases into the organization stage + success toast | N/A (Single required field) | Inline red field error (`RHF + Zod`): «کد مجوز الزامی است.» | Without `Licensing.License.Activate`: terminal explainer «این استقرار هنوز مجوزی ندارد» + خروج (no form) | Inline field error «ارتباط با سرور برقرار نشد.»; entered code preserved | Inline field error «فعال‌سازی مجوز انجام نشد…» + کد پیگیری; `422` → «کد مجوز پذیرفته نشد…» and the field is cleared | Enter another code and submit again / Click «تلاش دوباره» on a failed license read |
| **3. Organization Resolution**  | Auto-selects if 1 org; explicit selection screen if several | Gate state «در حال بررسی سازمان…» replaces workspace | Org scope active; name or `<Select>` in topbar | Terminal blocked state: «سازمانی در دسترس نیست.» + خروج | N/A (Server-listed options only) | Terminal blocked state: «نیاز به مجوز Organization.Organization.View» + خروج | `ApiErrorAlert` + «تلاش دوباره» replaces workspace | `ApiErrorAlert` + «تلاش دوباره» replaces workspace | Click «تلاش دوباره» / Contact administrator |
| **4. App Shell & Navigation**   | Navigation menu rendered and active                 | Drawer animation on mobile                  | Target route rendered in `<main>`                | N/A                                          | N/A                                              | Target menu item hidden from sidebar                          | N/A                                                | N/A                                      | Navigate via sidebar / breadcrumb           |
| **5. Dashboard**                | Scope check (Financial Area & Year)                 | Skeleton cards for KPIs, charts & table     | KPIs, charts, and recent documents rendered      | Scope missing notice or empty documents card | N/A                                              | Widget hidden or honest «دسترسی ندارید» notice                | Section-level `ApiErrorAlert` with Retry           | Section-level `ApiErrorAlert` with Retry | Click «تلاش دوباره» on failed widget        |
| **6. Accounting Landing**       | Static cards rendered                               | Instantaneous (Static page)                 | 4 surface cards rendered                         | N/A                                          | N/A                                              | Individual cards hidden via `PermissionGate`                  | N/A                                                | N/A                                      | Contact admin for module permissions        |
| **7. Chart of Accounts Tree**   | Tree query initiated                                | Tree skeleton rows (8 rows)                 | Indented node hierarchy with badges              | EmptyState: «حسابی ثبت نشده است.»            | N/A                                              | Alert: «مجوز Accounting.Account.View نیاز است.»               | `ApiErrorAlert` with retry button                  | `ApiErrorAlert` with correlation ID      | Click «تلاش دوباره»                         |
| **8. Account Statement Report** | FilterBar open; Alert: «حساب و سال را انتخاب کنید.» | Table skeleton rows with progress indicator | Summary totals card + paginated movement rows    | EmptyState: «ردیفی بازگردانده نشد.»          | Inline red error under missing field (Zod)       | Alert: «مجوز Accounting.AccountStatement.View»                | `ApiErrorAlert` with retry button                  | `ApiErrorAlert` with correlation ID      | Refine filters / Click «تلاش دوباره»        |
| **9. General Ledger Report**    | FilterBar open; Alert: «حوزه و سال را انتخاب کنید.» | Table skeleton rows with progress indicator | Paginated journal rows with allow-listed sorting | EmptyState: «ردیفی بازگردانده نشد.»          | Inline red error under missing field (Zod)       | Alert: «مجوز Accounting.GeneralLedger.View»                   | `ApiErrorAlert` with retry button                  | `ApiErrorAlert` with correlation ID      | Refine filters / Click «تلاش دوباره»        |
| **10. Trial Balance Report**    | FilterBar open; Alert: «حوزه و سال را انتخاب کنید.» | Table skeleton rows with progress indicator | Multi-column balance grid with sorting           | EmptyState: «ردیفی بازگردانده نشد.»          | Inline red error under missing field (Zod)       | Alert: «مجوز Accounting.TrialBalance.View»                    | `ApiErrorAlert` with retry button                  | `ApiErrorAlert` with correlation ID      | Refine filters / Click «تلاش دوباره»        |
| **11. Document Drill-down**     | Navigate to `/documents/:id`                        | Document skeleton header & line items       | Header metadata + double-entry lines grid        | Alert: «سند یافت نشد.» (404)                 | Inline validation on edit form                   | Alert: «مجوز Accounting.Document.View»                        | `ApiErrorAlert` with retry button                  | `ApiErrorAlert` with correlation ID      | Navigate back to report / Retry             |

---

## 2. API Error & Exception Matrix

The table below maps normalized backend error codes (`src/api/errors.ts`) to exact UI presentations and user recovery paths:

| API Error Code              | HTTP Status   | Normalized Persian Message (`t.errors.*`)                 | UI Placement & Component                              | Recovery Behavior                        | Retriable?   |
| :-------------------------- | :------------ | :-------------------------------------------------------- | :---------------------------------------------------- | :--------------------------------------- | :----------- |
| **`Unauthorized`**          | `401`         | «برای انجام این عملیات باید وارد شوید.»                   | Interceptor redirects to `/login` with Warning Alert  | User logs in again                       | No           |
| **`PermissionDenied`**      | `403`         | «مجوز لازم برای این عملیات را ندارید.»                    | Inline `Alert` (variant="warning") or `ApiErrorAlert` | Contact system administrator             | No           |
| **`EntityNotFound`**        | `404`         | «مورد درخواست‌شده یافت نشد یا در دامنه دسترسی شما نیست.»  | Section `Alert` or `NotFoundPage`                     | Check entity ID or navigate back         | No           |
| **`ValidationFailed`**      | `400` / `422` | «اطلاعات ارسالی معتبر نیست.»                              | Field-level inline text + Form summary banner         | Correct invalid input values             | No           |
| **`BusinessRuleViolation`** | `422`         | «این درخواست با قواعد کسب‌وکار سازگار نیست.»              | Form-level `Alert` / Modal Alert with server detail   | Adjust operational data / period state   | No           |
| **`Conflict`**              | `409`         | «تداخل در داده‌ها رخ داد.»                                | Form-level `Alert` with concurrent update message     | Refresh page to load latest version      | No           |
| **`RateLimitExceeded`**     | `429`         | «تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.» | Toast or Banner Alert with countdown                  | Wait 30 seconds before retrying          | Yes (Manual) |
| **`InternalError`**         | `500`         | «خطای غیرمنتظره در سرور رخ داد. (کد پیگیری: ... )»        | `ApiErrorAlert` with tracking correlation ID          | Click «تلاش دوباره» / Report tracking ID | Yes          |
| **`ServiceUnavailable`**    | `503`         | «سرویس موقتاً در دسترس نیست. کمی بعد تلاش کنید.»          | `ApiErrorAlert` with Retry button                     | Click «تلاش دوباره»                      | Yes          |
| **`NetworkError`**          | `0` / Timeout | «ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.»    | `ApiErrorAlert` with Retry button                     | Check connection and click «تلاش دوباره» | Yes          |
| **`RequestAborted`**        | N/A           | (Silent cancellation on fast navigation)                  | None (Suppressed)                                     | Automated: latest request wins           | No           |

---

## 3. UX Feedback Taxonomy Matrix

| Feedback Type                  | Primary Use Case                                                                | When NOT to Use                              | Visual Component / Token                                    | Lifetime / Interaction                 | Concrete Example                                |
| :----------------------------- | :------------------------------------------------------------------------------ | :------------------------------------------- | :---------------------------------------------------------- | :------------------------------------- | :---------------------------------------------- |
| **Inline Validation**          | Input formatting, missing required fields, date syntax                          | Global server errors, operation success      | `<FormField>` error slot (`text-rose-600 text-xs`)          | Persistent until field is corrected    | `«کد حساب الزامی است.»`                         |
| **Toast Notification**         | Async mutation success, background export ready                                 | Fatal query failures, form field errors      | Floating bottom-start container (`bg-slate-900 text-white`) | Auto-dismiss after 4s (Max 3 visible)  | `«سند با موفقیت ثبت شد.»`                       |
| **Confirmation Dialog**        | Destructive or irreversible financial actions (Reversal, Posting, Close Period) | Simple navigation, non-destructive saves     | Modal overlay (`focus-trap`, `aria-modal="true"`)           | Explicit user click (Confirm / Cancel) | `«سند معکوس ایجاد خواهد شد. آیا مطمئنید؟»`      |
| **Section Alert (Page-Level)** | Query load failure, missing required filter scope                               | Field-level validation                       | `<Alert variant="danger">` (`ApiErrorAlert`)                | Persistent with «تلاش دوباره» button   | `«دریافت گردش حساب انجام نشد.»`                 |
| **Empty State**                | Successful query with zero matching records                                     | Initial unscoped filter state, query errors  | `<EmptyState>` with dashed border & icon                    | Persistent until filter changes        | `«هیچ ردیفی برای فیلترهای انتخابی یافت نشد.»`   |
| **Loading State**              | Query in flight during data fetching                                            | Static local interactions                    | `<LoadingState>` / `<Skeleton>` layout                      | Replaced on query resolution           | 6-row animated skeleton table                   |
| **Permission Gate Alert**      | Authenticated user lacks required RBAC permission                               | Unauthenticated session (redirects to login) | `<Alert variant="warning">` with permission code            | Persistent until role is updated       | `«مجوز موردنیاز: Accounting.TrialBalance.View»` |

---

## 4. RBAC Permission UX Gating Matrix

| UI Route / Action                                            | Backend Permission Code            | UI Presentation Gate Behavior          | Backend Enforcement Point                         | Fallback UX if Forbidden                     |
| :----------------------------------------------------------- | :--------------------------------- | :------------------------------------- | :------------------------------------------------ | :------------------------------------------- |
| **Dashboard Route (`/app`)**                                 | `Accounting.Document.View`         | Route guard `<RequirePermission>`      | `AccountingDocumentsController.list`              | Warning alert with missing permission        |
| **Dashboard KPI Row**                                        | `Accounting.Balance.View`          | `useDashboardBalances` query disabled  | `AccountingBalancesController.list`               | Honest «دسترسی لازم فراهم نیست» widget       |
| **Dashboard Inventory Widget**                               | `Inventory.Balance.View`           | `useDashboardInventory` query disabled | `InventoryBalancesController.list`                | Honest «دسترسی لازم فراهم نیست» widget       |
| **Dashboard Workflow Widget**                                | `Workflow.Instance.View`           | `useDashboardWorkflow` query disabled  | `WorkflowInstancesController.list`                | Honest «دسترسی لازم فراهم نیست» widget       |
| **Chart of Accounts (`/app/accounting/chart`)**              | `Accounting.Account.View`          | Sidebar link hidden; Route guarded     | `ChartTreeController.list`                        | Warning alert with `Accounting.Account.View` |
| **Account Statement (`/app/accounting/account-statements`)** | `Accounting.AccountStatement.View` | Sidebar link hidden; Route guarded     | `AccountStatementsController.getAccountStatement` | Warning alert with required permission       |
| **General Ledger (`/app/accounting/general-ledger`)**        | `Accounting.GeneralLedger.View`    | Sidebar link hidden; Route guarded     | `GeneralLedgerController.list`                    | Warning alert with required permission       |
| **Trial Balance (`/app/accounting/trial-balance`)**          | `Accounting.TrialBalance.View`     | Sidebar link hidden; Route guarded     | `TrialBalanceController.list`                     | Warning alert with required permission       |
| **Organization Switcher**                                    | `Organization.Organization.View`   | Switcher disabled/hidden               | `OrganizationsController.list`                    | Shell alert explaining missing permission    |
| **Document Create (Future)**                                 | `Accounting.Document.Create`       | Compose button disabled with tooltip   | `AccountingDocumentsController.create`            | Disabled CTA with tooltip                    |
| **Document Finalize (Future)**                               | `Accounting.Document.Finalize`     | Finalize button disabled with tooltip  | `AccountingDocumentsController.finalize`          | Disabled CTA with tooltip                    |
| **Document Reverse (Future)**                                | `Accounting.Document.Reverse`      | Reverse button disabled with tooltip   | `AccountingDocumentsController.reverse`           | Disabled CTA with tooltip                    |

---

## 5. Navigation & URL Parameter Routing Matrix

| Route Path                           | Gating Permission                  | Primary Entry Points                                                     | URL Search Parameters Contract                                                                                                           | Deep-Link Support                   | Current Status                    |
| :----------------------------------- | :--------------------------------- | :----------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------- | :-------------------------------- |
| `/login`                             | Public                             | Auth boundary redirect, Topbar logout                                    | None (attempted route carried in `location.state.from`, sanitized to internal paths — no open redirect)                                  | Yes                                 | **EXISTS**                        |
| `/app`                               | `Accounting.Document.View`         | Login redirect, Sidebar «میزکار», Logo                                   | `?page=1&pageSize=9&sort=documentDate:desc`                                                                                              | Yes                                 | **EXISTS**                        |
| `/app/accounting`                    | Public inside `/app`               | Sidebar «حسابداری»                                                       | None                                                                                                                                     | Yes                                 | **EXISTS**                        |
| `/app/accounting/chart`              | `Accounting.Account.View`          | Accounting landing, Sidebar «درخت حساب‌ها»                               | None (Fixed code hierarchy)                                                                                                              | Yes                                 | **EXISTS**                        |
| `/app/accounting/account-statements` | `Accounting.AccountStatement.View` | Accounting landing, Sidebar «گردش حساب», Trial Balance drill-down        | `?fiscalYearId=&accountId=&financialAreaId=&accountingPeriodId=&page=1&pageSize=50`                                                      | Target UX (Currently in `useState`) | **EXISTS** (URL migration needed) |
| `/app/accounting/general-ledger`     | `Accounting.GeneralLedger.View`    | Accounting landing, Sidebar «دفتر کل»                                    | `?financialAreaId=&fiscalYearId=&accountingPeriodId=&accountId=&accountCode=&dateFrom=&dateTo=&page=1&pageSize=50&sort=documentDate:asc` | Target UX (Currently in `useState`) | **EXISTS** (URL migration needed) |
| `/app/accounting/trial-balance`      | `Accounting.TrialBalance.View`     | Accounting landing, Sidebar «تراز آزمایشی», Dashboard Reconciliation CTA | `?financialAreaId=&fiscalYearId=&accountingPeriodId=&accountId=&accountCode=&dateFrom=&dateTo=&page=1&pageSize=50&sort=accountCode:asc`  | Target UX (Currently in `useState`) | **EXISTS** (URL migration needed) |
| `/app/accounting/documents/:id`      | `Accounting.Document.View`         | General Ledger row click, Account Statement row click                    | None (Route param `:id`)                                                                                                                 | Target UX                           | **SUPPORTED API / FUTURE UI**     |
| `*`                                  | Public                             | Unmatched URL paths                                                      | None                                                                                                                                     | N/A                                 | **EXISTS** (`NotFoundPage`)       |

---

## 6. Failure Recovery Matrix

| Failure Scenario                            | System Impact                   | Detection Mechanism                        | Immediate User Recovery Path                               | Automated System Fallback                          |
| :------------------------------------------ | :------------------------------ | :----------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------- |
| **Session Expired Mid-Task**                | Operations blocked with 401     | Axios response interceptor                 | User logs in again via redirect                            | Entire TanStack cache cleared; user state reset    |
| **Selected Organization Deactivated / 404** | Scoped requests fail with 404   | Service `mustFindInOrganization`; refreshed list no longer contains the selection | Selection screen returns with «سازمان انتخاب‌شده دیگر در دسترس نیست.» | Scope dropped (status `invalid`); NO silent fallback; previous org's scoped cache evicted |
| **Report Query Timeout (>10s)**             | Data grid fails to load         | TanStack Query timeout                     | Click «تلاش دوباره» or narrow filter date range            | Query aborted via `AbortController` signal         |
| **Invalid Report Filter Values**            | Backend rejects with 400        | Zod schema validation on submit            | Form highlights invalid field with red validation text     | Prevent API call; keep current view untouched      |
| **Concurrent Document Modification**        | Document update fails with 409  | Backend optimistic lock check              | Refresh document to view latest version                    | Form notifies user of conflict                     |
| **Network Disconnection**                   | All requests fail with 0 status | Browser offline event / Axios NetworkError | Check connectivity and click «تلاش دوباره»                 | Global retries halted after 2 exponential attempts |

---

## 7. Current Implementation vs. Desired UX Architecture

| Capability / Surface         | Current Frontend Implementation                          | Target UX Standard (`standards.md`)                              | Classification              | Required Remediation Action                                                           |
| :--------------------------- | :------------------------------------------------------- | :--------------------------------------------------------------- | :-------------------------- | :------------------------------------------------------------------------------------ |
| **Session Bootstrap**        | `SessionProvider` + `RequireAuth`                        | Single centralized auth gate with clean unauth redirection       | **EXISTS**                  | None (Fully compliant)                                                                |
| **Organization Switcher**    | `OrganizationSwitcher` in Topbar                         | Responsive single/multi-org adaptive indicator                   | **EXISTS**                  | None (Fully compliant)                                                                |
| **Organization Selection Step** | `OrganizationSelection` gate before the workspace for multi-org sessions | Explicit, keyboard-accessible Persian selection; scope stays null until confirmed | **EXISTS**               | None (Fully compliant)                                                                |
| **Organization-Scoped Cache Isolation** | Org id in every scoped query key; `placeholderData` gated to the same org; previous org's cache evicted on switch | Switch never displays organization A data as organization B | **EXISTS** | None (Fully compliant)                                                                |
| **Workspace Breadcrumb**     | `AppBreadcrumb` from the real navigation hierarchy       | Hierarchical wayfinding for nested routes                        | **EXISTS**                  | None (Fully compliant)                                                                |
| **Dashboard Layout**         | Native Task 32 implementation on live read models        | Responsive dense grid, real data, no fake buttons                | **EXISTS**                  | None (Fully compliant)                                                                |
| **Report Query State**       | `useReportQueryState` stores filters in React `useState` | Filters, page, pageSize, and sort in `URLSearchParams`           | **PARTIALLY SUPPORTED**     | Migrate `useReportQueryState` to read/write Router search params                      |
| **Trial Balance Drill-down** | Table rows are non-interactive                           | Clicking account row navigates to pre-filtered Account Statement | **SUPPORTED**               | Wrap account cell with `<Link>` to `/app/accounting/account-statements?accountId=...` |
| **Document Line Drill-down** | Voucher numbers rendered as plain text                   | Clicking voucher number opens Document Detail view               | **SUPPORTED API**           | Implement `/app/accounting/documents/:id` view route                                  |
| **Global Topbar Search**     | Removed from the topbar (FE-UX-04: no fake affordance)   | Full-text entity search across documents and accounts            | **CONTRACT GAP**            | Await backend global search service and endpoint                                      |
| **Workflow Approval Action** | Display-only badge and list                              | In-place Approve/Reject decision modal with reason               | **CONTRACT GAP**            | Await backend decisioning endpoint                                                    |
| **Trial Balance Totals Row** | No footer totals rendered                                | Authoritative total debit/credit row in table footer             | **CONTRACT GAP**            | Await backend summary totals object in API response                                   |
| **Persisted Column Order**   | Default static column definitions                        | User-customizable column order and density settings              | **FUTURE PRODUCT DECISION** | Await Customization module key-value store                                            |

---

## 8. UX Anti-Pattern Audit Record

The Vardena codebase was audited against sixteen critical enterprise UX anti-patterns:

```text
[ PASS ] 1. Endpoint-driven navigation: Navigation is structured logically around accounting workflows, not raw controller endpoints.
[ PASS ] 2. Duplicate navigation paths: Every surface has exactly one canonical URL route.
[ PASS ] 3. Fake buttons / Dead-ends: Features without endpoints (e.g., New Document) are honestly excluded or labeled.
[ PASS ] 4. Dead-end screens: All empty and error states provide clear CTAs and return paths.
[ PASS ] 5. Unexplained empty states: Empty states explain *why* there is no data («داده‌ای یافت نشد»).
[ PASS ] 6. Raw API errors shown to users: Errors are normalized to human-readable Persian copy with correlation IDs.
[ PASS ] 7. Inconsistent Persian terminology: Central dictionary (`fa`) enforces domain-standard vocabulary.
[ PASS ] 8. Inconsistent Toast usage: Toasts are reserved for transient notifications; not spammed for fetch errors.
[ PASS ] 9. Unnecessary confirmation dialogs: Confirmations reserved strictly for irreversible actions.
[ PASS ] 10. Missing recovery paths: Error alerts consistently provide «تلاش دوباره» (retry) handlers.
[ PASS ] 11. Permission UX inconsistency: UI checks act strictly as presentation gates; backend authorizes every call.
[ WARN ] 12. State ownership violations: Report filters currently use local React state instead of URL search params.
[ PASS ] 13. Unnecessary global state: No premature Redux/Zustand installation; minimal Contexts used appropriately.
[ PASS ] 14. Duplicated server state: Server data is owned solely by TanStack Query; no secondary client cache.
[ WARN ] 15. URL state shareability: Report URLs cannot currently be shared via deep-link due to local state usage.
[ PASS ] 16. Frontend financial calculations: The frontend strictly preserves exact decimal strings and avoids recalculating totals.
```

### Audit Findings & Recommendations Summary:

1. **Report URL Search Parameters (Item 12 & 15 - Medium Priority):** `useReportQueryState` currently maintains filter state in local `useState`. Refactoring this hook to synchronize with `useSearchParams` will achieve complete compliance with `standards.md` §5, enabling bookmarkable, linkable reports.
2. **Document Detail Route (High Priority Feature Follow-up):** The backend already exposes `GET /accounting-documents/:id` and full voucher lifecycle endpoints. Building the Document View route will complete the end-to-end audit drill-down journey from Trial Balance and General Ledger.
