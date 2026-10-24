# استاندارد رسمی جدول‌های داده Vardena — جست‌وجو و فیلترینگ سبک

**وضعیت:** ACTIVE — استاندارد رسمی همه‌ی گریدهای وردنا
**نسخه:** ۱.۰
**تاریخ:** ۲۰۲۶-۱۰-۲۴
**وابستگی:** [standards.md](./standards.md) (§۸ DataTable) · [tables-and-lists.md](./tables-and-lists.md) · [design-system.md](./design-system.md) · ADR-0002

> هر گرید فعلی یا آینده‌ی وردنا باید از یک کامپوننت مشترک — `DataTable` — استفاده کند.
> «گرید جدید» یعنی گرید ساخته‌شده با این کامپوننت؛ ساخت جدول `<table>` موازی در یک صفحه ممنوع است.

---

## ۱) هدف و دامنه

این سند لایه‌ی **جست‌وجو، فیلتر ستونی، مرتب‌سازی و صفحه‌بندی** گریدها را یکدست می‌کند:

- یک جست‌وجوی سراسری (global search) با debounce ۳۰۰ms در همه‌ی گریدها؛
- فیلتر ستونی بر اساس **نوع داده** (متن، انتخاب تک/چندگانه، بازه‌ی تاریخ، بازه‌ی عدد)؛
- مرتب‌سازی، صفحه‌بندی با انتخاب اندازه‌ی صفحه، حالت خالی، skeleton و RTL کامل؛
- برچسب‌های فارسی از دیکشنری مرکزی `src/lib/i18n.ts` (متن فارسی درون JSX ممنوع — standards.md §۷)؛
- دسترس‌پذیری: `aria-label` روی همه‌ی کنترل‌ها، `aria-sort` روی هدر، اعلام تعداد نتایج.

**در دامنه نیست:** گزارش‌های مالی با تجمیع سمت سرور، جدول‌های محوری، ویرایش درجا (inline edit) و دفتر روزنامه/معین که قرارداد خودشان را دارند. آن‌ها از همان `DataTable` استفاده می‌کنند اما فیلترشان سمت سرور است.

---

## ۲) معماری و مسیر واقعی فایل‌ها

پروژه monorepo است و فرانت‌اند در `frontend/` قرار دارد (نه `apps/web/`):

| نقش | مسیر واقعی |
| --- | --- |
| کامپوننت مشترک (single source of truth) | `frontend/src/ui/patterns/data-table.tsx` |
| نوع‌ها و `meta.filter` | `frontend/src/ui/patterns/data-table/types.ts` |
| `filterFn` های سفارشی | `frontend/src/ui/patterns/data-table/filter-fns.ts` |
| کنترل‌های فیلتر ستونی | `frontend/src/ui/patterns/data-table/filter-controls.tsx` |
| نوار ابزار (جست‌وجوی سراسری + فیلترها) | `frontend/src/ui/patterns/data-table/data-table-toolbar.tsx` |
| barrel export | `frontend/src/ui/patterns/data-table/index.ts` |
| صفحه‌بندی مشترک | `frontend/src/ui/patterns/pagination.tsx` |
| نرمال‌سازی متن فارسی | `frontend/src/lib/text-normalize.ts` |
| `useDebounce` | `frontend/src/lib/use-debounced-value.ts` |
| دیکشنری متن | `frontend/src/lib/i18n.ts` (`t.table.filters`، `t.table.filters.*`) |

`DataTable` هیچ دانش دامنه‌ای ندارد؛ تعریف ستون‌ها و «چه چیزی فیلتر شود» در همان feature تعریف می‌شود.

---

## ۳) دو حالت کار

| حالت | prop | مالک داده | مالک صفحه‌بندی/مرتب‌سازی | کاربرد |
| --- | --- | --- | --- | --- |
| **سرور** (پیش‌فرض، سازگار با گذشته) | `sorting` + `onSortingChange` + `pagination` | API | سرور | فهرست اسناد، معین، تراز، کاردکس، هر لیستی که می‌تواند بزرگ شود |
| **کلاینت (فیلترینگ سبک)** | `filtering={{ ... }}` | سرور یک‌بار و کامل می‌آورد | مرورگر | دیتاست محدود (≤ ۵٬۰۰۰ ردیف در سند، عملاً ≤ ۵۰۰ ردیف در هر درخواست API) |

> حالت سرور عوض نشده و هیچ صفحه‌ای که قبلاً `DataTable` را با `pagination` صدا می‌زد، رفتارش تغییر نمی‌کند.
> حالت کلاینت فقط با دادن `filtering` فعال می‌شود.

---

## ۴) API کامپوننت

### ۴.۱ props موجود (بدون تغییر)

```ts
interface DataTableProps<TRow> {
  columns: ColumnDef<TRow, unknown>[];
  data: TRow[];
  getRowId: (row: TRow, index: number) => string;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  errorDescription?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  sorting?: SortingState;                    // حالت سرور
  onSortingChange?: (sorting: SortingState) => void;
  pagination?: Omit<PaginationProps, 'disabled'>; // حالت سرور
  caption?: string;
  selectable?: boolean;
  selectedRowIds?: ReadonlySet<string>;
  onSelectedRowIdsChange?: (next: Set<string>) => void;
  onRowActivate?: (row: TRow) => void;
  virtualize?: boolean;
  filtering?: DataTableFilteringOptions;     // حالت کلاینت (جدید)
}
```

### ۴.۲ prop جدید `filtering`

```ts
interface DataTableFilteringOptions {
  /** جست‌وجوی سراسری؛ پیش‌فرض true. */
  globalSearch?: boolean;
  /** رندر خودکار کنترل هر ستونِ دارای `meta.filter`؛ پیش‌فرض true. */
  columnFilters?: boolean;
  /** debounce جست‌وجو و فیلتر متنی؛ پیش‌فرض ۳۰۰ms. */
  debounceMs?: number;
  initialPageSize?: number;          // پیش‌فرض ۲۵
  pageSizeOptions?: readonly number[]; // پیش‌فرض [25, 50, 100]
  /** دکمه‌ها/لینک‌های اضافی نوار ابزار (خروجی، ایجاد، …) */
  toolbarActions?: ReactNode;
  /** اختیاری برای همگام‌سازی با URL یا analytics. */
  onStateChange?: (state: DataTableClientState) => void;
}

interface DataTableClientState {
  globalFilter: string;
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  page: number;
  pageSize: number;
}
```

در حالت کلاینت، `sorting` / `pagination` / `onSortingChange` نباید پاس داده شوند؛ وضعیت داخلی مالک است.

### ۴.۳ قرارداد `meta.filter` روی ستون

```ts
export type DataTableFilterMeta =
  | { kind: 'text'; label: string; placeholder?: string }
  | { kind: 'select'; label: string; options: readonly { value: string; label: string }[] }
  | { kind: 'multi-select'; label: string; options: readonly { value: string; label: string }[] }
  | { kind: 'date-range'; label: string }
  | { kind: 'number-range'; label: string }
  | never;
```

به‌همراه فیلدهای اختیاری سطح `meta`:

```ts
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    align?: 'start' | 'end';            // موجود
    filter?: {
      kind: 'text' | 'select' | 'multi-select' | 'date-range' | 'number-range';
      label: string;
      options?: readonly { value: string; label: string }[];
      placeholder?: string;
      /** متن جست‌وجوی سراسری برای این ستون (مثلاً «فعال» برای boolean). */
      searchValue?: (row: TData) => string;
      /** خارج‌کردن ستون از جست‌وجوی سراسری (مثلاً ستون عملیات). */
      excludeFromGlobalSearch?: boolean;
    };
    /** نام اضافی برای ستون در جست‌وجوی سراسری (مثلاً نام فارسی enum). */
    globalSearchLabel?: string;
  }
}
```

قواعد:

1. فقط ستونی که `accessorKey` یا `accessorFn` دارد می‌تواند فیلتر شود؛ اگر سلول نمایشی است، `accessorKey` را به فیلد واقعی بدهید و ظاهر را در `cell` بسازید.
2. `filterFn` به‌طور خودکار از `kind` انتخاب می‌شود؛ فقط برای رفتار سفارشی، `filterFn` ستون را صریح بدهید.
3. ستون عملیات (`actions`) باید `meta.filter` نداشته باشد و `excludeFromGlobalSearch: true` بگیرد.

### ۴.۴ `filterFn` های استاندارد

| `kind` | `filterFn` | مقدار فیلتر | رفتار |
| --- | --- | --- | --- |
| `text` | `includesStringFilter` | `string` | «شامل می‌شود»، نرمال‌شده برای فارسی/عربی (ی/ک، اعراب، ZWNJ) و ارقام فارسی؛ بی‌توجه به حروف بزرگ/کوچک |
| `select` | `equalsStringFilter` | `string` | برابری نرمال‌شده |
| `multi-select` | `multiSelectFilter` | `string[]` | عضویت؛ آرایه‌ی خالی = بدون فیلتر |
| `date-range` | `dateRangeFilter` | `{ from?: string; to?: string }` | مقایسه‌ی رشته‌ی canonical `YYYY-MM-DD` (هرگز `Date` جاوااسکریپت) |
| `number-range` | `numberRangeFilter` | `{ min?: string; max?: string }` | مقایسه‌ی اعشاری دقیق با BigInt، سازگار با مبالغ `numeric(18,2)` |
| سراسری | `globalTextFilter` | `string` | جست‌وجو در همه‌ی ستون‌های مجاز با نرمال‌سازی فارسی |

همه‌ی این توابع از `frontend/src/ui/patterns/data-table/filter-fns.ts` export می‌شوند و مستقل از React تست می‌شوند.

### ۴.۵ قرارداد نام‌گذاری

- شناسه‌ی ستون (`id`/`accessorKey`) = همان نام فیلد قرارداد API (`username`, `isActive`, `documentDate`)؛ نام نمایشی فارسی فقط در `header`.
- نوع فیلتر در `meta.filter.kind` اعلام می‌شود؛ هیچ فیلتر ضمنی از روی `header` حدس زده نمی‌شود.
- فیلتر سفارشی فقط وقتی که جدول استاندارد جواب ندهد ساخته می‌شود و باید با پسوند `Filter` و در `feature` مربوطه باشد و `filterFn` نام‌دار export شود.
- متن کنترل‌ها فقط از `t.table.filters` می‌آید؛ برای برچسب ستون از `meta.filter.label` استفاده کنید.

---

## ۵) سه مثال کامل

### ۵.۱ جدول ساده (فقط جست‌وجوی سراسری)

```tsx
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/ui/patterns/data-table';
import { t } from '@/lib/i18n';

interface RoleRow {
  id: string;
  name: string;
  description: string;
}

const columns: ColumnDef<RoleRow, unknown>[] = [
  { accessorKey: 'name', header: t.rolesAdmin.roleName },
  { accessorKey: 'description', header: t.rolesAdmin.description },
];

export function RolesTable({ rows }: { rows: RoleRow[] }) {
  return (
    <DataTable<RoleRow>
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      caption={t.rolesAdmin.roles}
      filtering={{ globalSearch: true, columnFilters: false }}
    />
  );
}
```

### ۵.۲ جدول با فیلتر ستونی (متن + انتخاب)

```tsx
const columns: ColumnDef<AdminUser, unknown>[] = [
  { accessorKey: 'username', header: t.usersAdmin.username,
    meta: { filter: { kind: 'text', label: t.usersAdmin.username } } },
  {
    accessorKey: 'isActive',
    header: t.usersAdmin.status,
    enableSorting: false,
    cell: ({ row }) => <StatusBadge active={row.original.isActive} />,
    meta: {
      filter: {
        kind: 'select',
        label: t.usersAdmin.status,
        options: [
          { value: 'true', label: t.usersAdmin.active },
          { value: 'false', label: t.usersAdmin.inactive },
        ],
        searchValue: (user) => (user.isActive ? t.usersAdmin.active : t.usersAdmin.inactive),
      },
    },
  },
  { id: 'actions', header: '', meta: { excludeFromGlobalSearch: true }, cell: () => null },
];

<DataTable<AdminUser>
  columns={columns}
  data={users}
  getRowId={(user) => user.id}
  filtering={{ initialPageSize: 50, pageSizeOptions: [25, 50, 100] }}
/>;
```

> مقدار `select` همیشه **رشته** است (`'true'` / `'false'`) چون `<select>` رشته برمی‌گرداند؛ `searchValue` متن فارسی را برای جست‌وجوی سراسری فراهم می‌کند.

### ۵.۳ جدول با فیلتر بازه‌ی تاریخ و بازه‌ی عدد

```tsx
interface VoucherRow {
  id: string;
  documentNumber: string;
  documentDate: string; // BusinessDate: YYYY-MM-DD
  totalDebit: string;   // Decimal string
}

const columns: ColumnDef<VoucherRow, unknown>[] = [
  { accessorKey: 'documentNumber', header: t.documents.colNumber },
  {
    accessorKey: 'documentDate',
    header: t.documents.colDate,
    meta: { filter: { kind: 'date-range', label: t.documents.colDate } },
  },
  {
    accessorKey: 'totalDebit',
    header: t.documents.colTotal,
    meta: { align: 'end', filter: { kind: 'number-range', label: t.documents.colTotal } },
  },
];

<DataTable<VoucherRow>
  columns={columns}
  data={boundedVouchers /* یعنی دادهٔ کامل و محدود، نه یک صفحهٔ سرور */}
  getRowId={(voucher) => voucher.id}
  filtering={{ globalSearch: true }}
/>;
```

---

## ۶) فهرست واقعی گریدها و وضعیت مهاجرت

| # | صفحه / گرید | مسیر فرانت | حالت | وضعیت |
| --- | --- | --- | --- | --- |
| ۱ | کاربران | `features/administration/users/users-page.tsx` | کلاینت | ✅ مهاجرت‌شده |
| ۲ | نقش‌ها (RBAC) | `features/administration/roles/roles-page.tsx` | کلاینت | ✅ مهاجرت‌شده |
| ۳ | اقلام انبار | `features/inventory/master-data/items/items-page.tsx` | کلاینت | ✅ مهاجرت‌شده |
| ۴ | فهرست اسناد حسابداری (Voucher List) | `features/accounting/documents/documents-page.tsx` | سرور | ⏸ نگه‌داری‌شده (حجم نامحدود؛ الگوی سرور) |
| ۵ | فهرست ردیف‌های اسناد | `features/accounting/documents/document-lines-page.tsx` | سرور | ⏸ |
| ۶ | درخت/فهرست حساب‌ها | `features/accounting/master-data/accounts-page.tsx` | سرور | ⏸ |
| ۷ | دوره‌های مالی / سال‌های مالی / حوزه‌ها | `features/accounting/master-data/*-page.tsx` | سرور | ⏸ |
| ۸ | دفتر کل، تراز آزمایشی، گردش حساب | `features/accounting/{general-ledger,trial-balance,account-statement}` | سرور | ⏸ |
| ۹ | اسناد و ردیف‌های انبار | `features/inventory/documents/*` | سرور | ⏸ |
| ۱۰ | کاردکس، گردش انبار، ارزش‌گذاری، مانده‌ها | `features/inventory/*-page.tsx` | سرور | ⏸ |
| ۱۱ | انبارها، واحدها، گروه کالا، تبدیل واحد | `features/inventory/master-data/*` | سرور | ⏸ |
| ۱۲ | شعب، دپارتمان‌ها، کارمندان، طرف‌ها، اعضا | `features/organization/admin/*` | سرور | ⏸ |

«⏸» یعنی گرید از همان `DataTable` استفاده می‌کند و تغییر رفتاری ندارد؛ فیلترهای سرور فعلی حفظ شده‌اند. مهاجرت آن‌ها به فیلترینگ کلاینت فقط در صورتی مجاز است که کل دیتاست محدود و قابل بارگذاری باشد (بند ۷).

---

## ۷) الگوی server-side برای دیتاست بزرگ (فقط مستند — پیاده‌سازی در PR جداگانه)

هر گریدی که می‌تواند از ۵٬۰۰۰ ردیف بگذرد (اسناد حسابداری، ردیف‌های سند، دفتر کل، کاردکس، گردش انبار) **نباید** کل داده را دانلود کند. قرارداد:

1. فیلترها در `URLSearchParams` می‌مانند (standards.md §۵) تا Back/Forward و لینک اشتراکی همان کوئری را بسازد.
2. نوار ابزار همان `DataTable` نمایش داده می‌شود اما حالت `filtering` فعال نیست؛ کنترل‌ها به URL متصل‌اند (`FilterBar` یا نوار ابزار سرور).
3. API نسخه‌دار NestJS پارامترهای استاندارد را می‌پذیرد:
   `page`, `pageSize` (حداکثر ۵۰۰), `sort=field:asc|desc`,
   `search` (زیررشته در کد/عنوان) و فیلترهای صریح هر endpoint
   (`isActive`, `dateFrom`, `dateTo`, …). هر endpoint فقط فیلدهای مجاز را می‌پذیرد و بقیه را ۴۰۰ می‌کند.
4. جست‌وجو با debounce ۳۰۰ms (`useDebouncedValue`) به `search` تبدیل می‌شود؛ درخواست قبلی با `AbortController` لغو می‌شود (latest-wins).
5. `manualPagination: true` و `manualSorting: true` در `DataTable`؛ `sort` روی هدر با `aria-sort` اعلام می‌شود.
6. فیلتر عددی/تاریخی در API با نوع ستون مقایسه می‌شود (نه رشته‌ی نمایشی)؛ `BusinessDate` همچنان `YYYY-MM-DD` canonical است.
7. **این الگو در این PR پیاده‌سازی نمی‌شود** — فقط قرارداد و مسیرها ثبت می‌شوند؛ پیاده‌سازی کامل در PR بعدی.

---

## ۸) چک‌لیست «چطور یک گرید جدید اضافه کنم؟»

1. **مسیر و مجوز را مشخص کن:** صفحه در `src/features/<domain>/...` و مسیر در `router.tsx`؛ مجوز واقعی را از `PERMISSIONS` بگیر (UI فقط UX است، بک‌اند مرجع است).
2. **قرارداد داده را از API بگیر:** تایپ را از `src/api/contracts.ts` / OpenAPI بگیر؛ تایپ دستی response ممنوع.
3. **آیا دیتاست محدود است؟** اگر پاسخ مثبت است (`total ≤ 5000` و API امکان بارگذاری کامل با `pageSize` مجاز را می‌دهد) → حالت کلاینت. وگرنه → حالت سرور + فیلترهای URL (بند ۷).
4. **ستون‌ها را در همان feature بنویس:** `ColumnDef<Row, unknown>[]`؛ `meta.align` برای مبلغ، `meta.filter` فقط برای فیلدهای فیلترپذیر.
5. **`getRowId` پایدار:** شناسه‌ی سرور، هرگز index آرایه.
6. **چهار حالت را وصل کن:** `error` + `onRetry`, `isLoading`, `emptyTitle/emptyDescription/emptyAction` (اولین رکورد) و حالت «نتیجه‌ای یافت نشد» (کلاینت خودکار).
7. **متن‌ها را به `i18n.ts` اضافه کن:** هیچ رشته‌ی فارسی inline ننویس.
8. **RTL را چک کن:** فقط logical properties (`ms/me/ps/pe/start/end`)؛ `left/right/ml/mr` ممنوع.
9. **دسترس‌پذیری:** `caption` بده؛ کنترل‌های جست‌وجو `aria-label` دارند؛ هدر با `aria-sort` می‌آید.
10. **تست:** منطق فیلتر/hook را unit-test کن؛ رندر پایه (داده، خالی، صفحه‌بندی) را با Testing Library بپوشان.
11. **اجباری پیش از commit:** `npm run lint`, `npm run typecheck`, `npm run test` در `frontend/` سبز.
12. اگر گرید پرحجم است، تست e2e را به CI بسپار (لوکال اجرا نکن).

---

## ۹) تصمیم‌های فنی و دلیل هر تصمیم

| تصمیم | دلیل |
| --- | --- |
| **TanStack Table (headless)** | منطق فیلتر/مرتب‌سازی/صفحه‌بندی مستقل از ظاهر است؛ با shadcn/ui و توکن‌های موجود ترکیب می‌شود؛ tree-shakeable و بدون runtime سنگین. قبلاً نیز در پروژه استفاده می‌شد (ADR-0002). |
| **یک `DataTable` مشترک** | standards.md §۲: هر چیز تکرارشونده یک الگو؛ گرید دوم = واگرایی RTL/چگالی/دسترس‌پذیری. |
| **فیلترینگ سمت کلاینت برای ≤ ۵٬۰۰۰ ردیف** | جست‌وجوی فوری بدون رفت‌وبرگشت شبکه، صفر بار اضافی روی DB؛ برای دیتاست کوچک تجربه‌ی بهتر و پیاده‌سازی ساده‌تر. |
| **الگوی سرور برای > ۵٬۰۰۰ ردیف** | دانلود کل دفتر کل یا اسناد، هم حافظه و هم پهنای باند را می‌بلعد و query سنگین می‌سازد؛ صفحه‌بندی و فیلتر باید در DB انجام شود. |
| **debounce ۳۰۰ms** | standards.md §۶ و استفاده‌ی موجود `useDebouncedValue`؛ تایپ فارسی (IME) را روان نگه می‌دارد و از فیلتر در هر کلید جلوگیری می‌کند. |
| **نرمال‌سازی متن فارسی** | «ي/ك» عربی، اعراب، ZWNJ و ارقام فارسی در داده‌ی واقعی دیده می‌شوند؛ جست‌وجوی خام آن‌ها را از دست می‌دهد. |
| **بازه‌ی تاریخ به‌صورت رشته‌ی canonical** | قرارداد `BusinessDate` (ADR-0042/AR-32): `YYYY-MM-DD`؛ استفاده از `Date` نیمه‌شب UTC ممنوع. |
| **بازه‌ی عدد با BigInt** | مبالغ `numeric(18,2)` رشته‌اند؛ `Number` بی‌صدا گرد می‌کند (`lib/decimal.ts`). |
| **صفر وابستگی جدید** | فقط `@tanstack/react-table` + shadcn/ui موجود؛ هیچ کتابخانه‌ی گرید آماده (AG Grid/Kendo/MUI X) اضافه نمی‌شود. |
| **وضعیت فیلتر کنترل‌نشده + `onStateChange`** | گریدهای کلاینت‌محور نباید برای هر کلید به URL بنویسند؛ اما اتصال به URL/ذخیره‌ی کاربر با همان callback ممکن است. |

---

## ۱۰) تست و CI

- ابزار: **Vitest + React Testing Library** (هر دو از قبل در پروژه هستند).
- تست‌های الزامی این استاندارد:
  - `filter-fns.test.ts`: `includesStringFilter` فارسی/ارقام، `dateRangeFilter`، `numberRangeFilter`، `multiSelectFilter` و جست‌وجوی سراسری.
  - `use-debounced-value.test.ts`: `useDebounce` با fake timers.
  - `data-table-client.test.tsx`: رندر پایه، جست‌وجو، فیلتر ستونی، حالت «یافت نشد»، صفحه‌بندی و انتخاب اندازه‌ی صفحه.
- اجرای محلی: `cd frontend && npm run lint && npm run typecheck && npm run test`.
- تست‌های مرورگری (Playwright) در `frontend/e2e/` هستند و قراردادشان در
  [e2e-testing.md](./e2e-testing.md) آمده است: جست‌وجو، فیلتر ستونی، Reset، حالت «یافت نشد»
  و نبود اسکرول افقی در ۳۶۰/۷۶۸/۱۲۸۰ پیکسل، روی سرور توسعه‌ی واقعی با مرز HTTP جعلی.
- تست‌های e2e سنگین فقط در GitHub Actions (`.github/workflows/ci.yml`، job `frontend-e2e`) و روی
  push به برنچ PR و `main` اجرا می‌شوند؛ اجرای لوکال آن‌ها اجباری نیست (`npm run test:e2e`).
- **شرط merge:** jobهای `frontend` (lint + typecheck + unit) و `frontend-e2e` باید سبز باشند.
