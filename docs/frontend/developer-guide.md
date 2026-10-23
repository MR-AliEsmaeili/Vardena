# راهنمای توسعه‌دهندگان فرانت‌اند Vardena

**وضعیت:** ACTIVE
**نسخه:** ۱.۰
**تاریخ:** ۲۰۲۶-۱۰-۲۳
**مراجع مرتبط:** [standards.md](./standards.md) · [design-system.md](./design-system.md) · [layout-and-navigation.md](./layout-and-navigation.md) · [operational-forms.md](./operational-forms.md) · [tables-and-lists.md](./tables-and-lists.md) · [date-standard.md](./date-standard.md) · [test-execution-policy.md](../testing/test-execution-policy.md)

---

## ۱) نقشه معماری و محل قرارگیری کدها

```text
frontend/src/
├── app/                     # ریشۀ ترکیب (Providers، Router، Navigation، Breadcrumb و AppShell)
│   ├── layouts/             # app-shell, app-header, app-sidebar و گیت‌های Bootstrap
│   └── routes/              # RequireAuth, RequirePermission, DashboardRoute, NotFoundPage
├── api/                     # تنها لایۀ مجاز HTTP (یک نمونه Axios + تولید تایپ از OpenAPI)
├── ui/                      # Primitives مشترک سیستم طراحی (Button, Dialog, DropdownMenu, Tooltip, …)
│   └── patterns/            # الگوهای صفحه و فرم (DataTable, DateInput, FilterBar, FormField, …)
│       └── operational-form/# پوسته ۵ ناحیه‌ای فرم‌های عملیاتی و DetailGrid
├── lib/                     # ابزارهای پایه: i18n, format, decimal, appearance, export-table, datetime/
├── features/                # برش‌های دامنه منطبق با ماژول‌های بک‌اند (accounting, inventory, organization, …)
├── styles/index.css         # تعریف متمرکز توکن‌های طراحی، تم روشن/تاریک، فونت و استایل چاپ
└── test/                    # ابزارهای تست مشترک (renderWithProviders, fixtures, setup)
```

### قواعد کلیدی استفاده مجدد و مرزبندی

1. هیچ کامپوننتی در `features/<x>` نباید کد داخلی `features/<y>` را import کند (`AR-27`). اشتراک فقط از مسیر `ui/`, `lib/` و `api/` مجاز است.
2. قبل از ساخت هر کامپوننت جدید، ابتدا `src/ui/` و `src/ui/patterns/` را بررسی کنید. اگر یک الگو در دو ماژول تکرار شد، آن را به `src/ui/patterns/` منتقل کنید.
3. تمام رشته‌های نمایشی فارسی باید در `src/lib/i18n.ts` تعریف شوند؛ نوشتن رشته فارسی مستقیم در JSX ممنوع است.

---

## ۲) چگونه یک فرم عملیاتی جدید بسازیم؟

برای ساخت فرم عملیاتی دارای سربرگ، ردیف‌ها، خلاصه و نوار عملیات پایانی:

1. **تعریف Schema با Zod و React Hook Form:**
   - محدودیت‌های فیلدها را دقیقاً مطابق DTO کنترلر بک‌اند تعریف کنید.
   - برای تاریخ‌های کاری از `isBusinessDay` (`@/lib/datetime`) و برای مبالغ/مقادیر از الگوهای رشته‌ای دقیق استفاده کنید.
2. **چیدمان با `OperationalFormShell`:**
   - `toolbar`: از `<OperationalToolbar>` همراه با `printCurrentSurface` و `exportRowsToExcelCsv` استفاده کنید.
   - `header`: فیلدهای سربرگ را درون `<CollapsibleHeader>` قرار دهید، شرط `canCollapse` را بر اساس تکمیل فیلدهای الزامی تعیین کنید، `summaryChips` (شماره سند، تاریخ شمسی، نوع سند) را بدهید و در `onCollapseBlocked` متد `form.trigger([...])` را صدا بزنید.
   - `detail`: از `<DetailGrid>` همراه با `useFieldArray` استفاده کنید؛ کلید ردیف را `getRowId={(row) => row.id}` بدهید و متدهای `onAddRow`, `onInsertAbove`, `onInsertBelow`, `onDuplicateRow`, `onRemoveRow` را متصل کنید.
   - `summary`: جمع مقادیر را با `sumExactDecimals` و `compareExactDecimals` (`@/lib/decimal`) محاسبه کرده و به `<OperationalSummary>` بدهید.
   - `footer`: عملیات چرخه عمر را در `start`، کنترل `<DocumentPaginationControl>` را در `center` و دکمه‌های انصراف/ذخیره را در `end` قرار دهید و جابه‌جایی روی فرم تغییریافته (`isDirty`) را با `<ConfirmDialog>` محافظت کنید.

---

## ۳) چگونه ستون‌های فهرست اسناد و ردیف‌ها را تعریف کنیم؟

- برای فهرست اسناد، آرایه `ColumnDef<TDocument>[]` بسازید و فقط روی فیلدهای موجود در لیست سفید مرتب‌سازی بک‌اند `enableSorting: true` بگذارید.
- برای فهرست ردیف‌های اسناد، ردیف‌های برگشتی API را به همراه فیلدهای کلیدی سربرگ سند والد (`documentId`, `documentNumber`, `documentDate`, `status`) تخت (Flatten) کنید، `getRowId` را `${documentId}:${lineId}` قرار دهید و پراپ `virtualize` را روی `<DataTable>` فعال کنید.

---

## ۴) نوشتن و اجرای تست‌ها

### ۴.۱ اصول تست‌نویسی در فرانت‌اند

- از `renderWithProviders` (`@/test/test-utils`) استفاده کنید تا تمام Providerهای واقعی (`AppearanceProvider`, `QueryClientProvider`, `SessionProvider`, `OrganizationProvider`, `ToastProvider`) اجرا شوند.
- فقط مرز ماژول‌های `@/api/*.api` را با `vi.mock` شبیه‌سازی کنید؛ هرگز کامپوننت‌های فرزند یا هوک‌های داخلی را Mock نکنید.
- تعامل کاربر را با `@testing-library/user-event` و بر اساس نقش‌های دسترس‌پذیر (`getByRole`, `getByLabelText`) بنویسید.

### ۴.۲ دستورات بررسی و تست سریع محلی (FAST-LOCAL)

پیش از هر Commit و Push، دستورات زیر باید به ترتیب اجرا شده و سبز باشند:

```bash
# ۱. گاردهای قراردادی پروژه (از ریشه مخزن)
python3 scripts/check-date-contract.py
node scripts/check-frontend-design-tokens.mjs
python3 scripts/check-docs-links.py

# ۲. بررسی ایستا، فرمت، تست و بیلد فرانت‌اند
cd frontend
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build

# ۳. گارد ایزوله‌بودن باندل مشتری از کدهای Owner (از ریشه مخزن)
python3 scripts/check-owner-isolation.py --artifact frontend/dist
```

### ۴.۳ تفکیک تست‌های محلی و تست‌های سنگین CI

مطابق سیاست رسمی [docs/testing/test-execution-policy.md](../testing/test-execution-policy.md):
- تست‌های سریع فوق (`lint`, `typecheck`, `format:check`, `vitest`, `vite build` و گاردهای اسکریپتی) به‌صورت محلی اجرا می‌شوند و در جاب `frontend` از `.github/workflows/ci.yml` نیز مجدداً راستی‌آزمایی می‌گردند.
- تست‌های سنگین وابسته به PostgreSQL زنده، تمرین‌های Migration، کانتینرهای Docker و تست‌های E2E بک‌اند منحصراً در محیط استاندارد GitHub Actions اجرا می‌شوند و نباید در محیط محلی شبیه‌سازی ناقص شوند.

---

## ۵) عیب‌یابی مشکلات رایج طراحی و تست

1. **شکست گارد `check-frontend-design-tokens.mjs`:** از کلاس‌های پالت خام Tailwind (`bg-white`, `text-slate-600`, `border-rose-200`) در `src/ui/` و `src/app/` یا رنگ‌های `#hex`/`rgb()` استفاده شده است. معادل توکنی (`bg-surface`, `text-ink-muted`, `border-danger-line`) را جایگزین کنید.
2. **خطای `getByLabelText` در تست فرم‌ها:** ستاره الزامی (`*`) نباید داخل تگ `<label>` قرار گیرد؛ آن را به‌صورت عنصر خواهر کنار `<label>` با `aria-hidden="true"` قرار دهید (یا از الگوی آماده `FormField` استفاده کنید).
3. **خطای TypeScript با `exactOptionalPropertyTypes: true`:** در تعریف اینترفیس پراپ‌های اختیاری که ممکن است مقدار صریح `undefined` دریافت کنند، نوع را به‌صورت `prop?: Type | undefined` بنویسید.
4. **هشدار `jsx-a11y(prefer-tag-over-role)` در `oxlint`:** به‌جای `<div role="dialog">`، `<div role="region">` یا `<p role="status">` از تگ‌های معنایی استاندارد `<dialog>`, `<section>` و `<output>` استفاده کنید.
5. **خطای TanStack Query (`Query data cannot be undefined`):** در تست‌هایی که تابع API با `vi.fn()` بدون مقدار بازگشتی اولیه تعریف شده، در `queryFn`های کمکی از `(await apiCall()) ?? null` استفاده کنید.
