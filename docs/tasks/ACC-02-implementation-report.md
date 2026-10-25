# گزارش پیاده‌سازی ACC-02 — مدیریت سال مالی و چرخهٔ عمر

|                  |                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------ |
| **تسک**          | ACC-02 (حسابداری، P1، موج ۱)                                                               |
| **نوع**          | فرانت‌اند + تست + مستندات — بدون تغییر بک‌اند                                              |
| **قرارداد مبنا** | `backend/src/modules/accounting/api/fiscal-years.controller.ts` و `dto/fiscal-year.dto.ts` |

## نتیجه

مدیریت سال مالی اکنون شامل ایجاد در حوزه مالی فعال، ویرایش سال‌های باز/بسته و اجرای گذارهای مجاز از فهرست است. دلیل هر گذار اجباری است و با همان `{ reason }` به endpoint متناظر ارسال می‌شود. گذارهای روی ردیف براساس وضعیت و مجوز همان عملیات نمایش داده می‌شوند؛ `sealed` فقط `unseal` دارد و امکان ویرایش ندارد.

## ماتریس نمایش عملیات

| وضعیت سرور | اکشن‌های قابل نمایش | نتیجه                                                       |
| ---------- | ------------------- | ----------------------------------------------------------- |
| `open`     | Edit، Close         | Close با هشدار صریح بستن دوره‌های باز همان سال              |
| `closed`   | Edit، Seal، Reopen  | Seal با هشدار منع ثبت سند جدید                              |
| `sealed`   | Unseal              | بازگشت به `closed`؛ هیچ Edit یا Reopen مستقیم ارائه نمی‌شود |

مجوزهای `Accounting.FiscalYear.Edit`, `.Close`, `.Reopen`, `.Seal`, `.Unseal` هر کدام مستقل کنترل می‌شوند. نبود مجوز به پنهان‌شدن همان دکمه می‌انجامد؛ مسیر و backend همچنان مرجع مجوز هستند.

## قرارداد تاریخ و cache

فرم از `DateInput` مشترک و `isBusinessDay` استفاده می‌کند. مقدار canonical تولیدشده توسط ورودی (`YYYY-MM-DD` ASCII) عیناً به API می‌رود؛ چون قرارداد همین تسک ارسال رشتهٔ canonical را الزام کرده، از `toBusinessDateInput` که برای ورودی Jalali شکل declared `{ calendar, value }` می‌سازد استفاده نشده است. در مسیر هیچ `Date`، `new Date()`، `toISOString()` یا بازتفسیر در zone مرورگر وجود ندارد. نمایش فهرست با formatter مرکزی Jalali-first است. سال پیشین فقط از گزینه‌های همان حوزه مالی انتخاب می‌شود و `financialAreaId` در فرم ایجاد فقط‌خواندنی و برگرفته از زمینه فعال است.

کلیدهای `fiscalYearPrefix`, `fiscalYearDetail`, `accountingPeriodsPrefix` و prefix زمینه مالی اضافه شدند. پس از update و transition، سال‌ها، دوره‌ها و سال‌های context invalidate می‌شوند؛ ایجاد نیز همین cacheهای مرتبط را تازه می‌کند. پاسخ سرور تنها منبع تغییر وضعیت است و optimistic update نداریم.

## شواهد تست محلی سبک

- `npm run typecheck` — PASS.
- `npm run lint` — PASS، صفر هشدار/خطا.
- `npm run format:check` — PASS.
- `npx vitest run src/features/accounting/master-data src/app/routes/protected-routing.test.tsx` — PASS، ۱۴ فایل و ۸۷ تست (شامل گیت مستقل Create و ترکیب View+Edit).
- `python3 scripts/check-date-contract.py` — PASS (گارد محدود ساختاری).
- `python3 scripts/check-docs-links.py` — PASS، ۳۶۰ سند و ۱۳۳۴ پیوند نسبی بدون لینک شکسته.
- `git diff --check` — PASS.
- تست‌های ACC-02 شامل ماتریس سه وضعیت و دسترسی، ارسال `{ reason }` در Close، هشدار بستن دوره‌ها، تاریخ Jalali به BusinessDate canonical ASCII، تاریخ نامعتبر/بازه معکوس، PATCH و نگاشت خطای 422 است.
- طبق درخواست مالک، `npm test` کامل و `npm run build` محلی اجرا نشده‌اند؛ CI مسئول همه بررسی‌های کامل/سنگین است.

## تطبیق چرخه عمر و ADR-0032

هشدار Close با قرارداد موجود controller/service هم‌راستاست: بستن سال مالی، دوره‌های باز همان سال را در همان تراکنش می‌بندد. بررسی ADR-0032 نکرده است که سیاست close سال را تغییر دهد؛ آن ADR در این تسک بدون تغییر باقی مانده است و اختلافی در متن هشدار مشاهده نشد.

## محدودهٔ تغییر

هیچ endpoint تازه، DELETE، تاریخچه یا تغییر بک‌اندی ساخته نشده است. تابع موجود `createFiscalYear` و گیت زمینه مالی موجود حفظ شده‌اند.

## وضعیت Pull Request و CI

پس از ساخت PR، شماره PR، SHA مورد بررسی و نتیجهٔ نهایی checkهای الزامی CI در این بخش ثبت می‌شود. نتیجهٔ محلی جایگزین CI نیست.
