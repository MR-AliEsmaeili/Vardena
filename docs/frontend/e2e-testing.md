# تست‌های مرورگری (Playwright) — قرارداد e2e فرانت‌اند

**وضعیت:** ACTIVE — قرارداد e2e فرانت‌اند وردنا
**نسخه:** ۱.۰
**تاریخ:** ۲۰۲۶-۱۰-۲۴
**وابستگی:** [data-table.md](./data-table.md) §۱۰ · [standards.md](./standards.md) · [developer-guide.md](./developer-guide.md) · ADR-0002

> تست مرورگری **جایگزین** Vitest نیست: منطق در jsdom و با Vitest تست می‌شود؛ Playwright فقط
> چیزهایی را می‌سنجد که jsdom نمی‌تواند — چیدمان RTL، عرض واقعی صفحه، پاپ‌آپ‌های portal شده،
> کلیدهای میان‌بر داخل گرید و اسکرول افقی.

---

## ۱) دامنه و اصل حاکم

- مرورگر واقعی (**Chromium**) روی **سرور توسعه‌ی واقعی** (`npm run dev`) اجرا می‌شود؛ بنابراین
  همان Router، همان Shell، همان `DataTable`، همان `DateInput` جلالی و همان توکن‌های RTL آزموده می‌شوند.
- تنها مرزِ جعلی، **HTTP** است: `e2e/fixtures/api.ts` هر درخواست `GET/POST /api/v1/**` را از
  fixture تایپ‌شده‌ی `e2e/fixtures/seed.ts` پاسخ می‌دهد. نتیجه: نه PostgreSQL لازم است، نه NestJS،
  نه کوکی نشست — و تست در CI در چند ثانیه سبز/قرمز می‌شود.
- fixture با **قرارداد واقعی** (`src/api/contracts.ts`) تایپ شده است؛ تغییر DTO باعث خطای
  `npm run typecheck` می‌شود، نه یک تست سبز روی payload قدیمی.
- هر endpoint پاسخ‌نداده برای متدهای نوشتاری **۴۰۴ با پیام صریح** برمی‌گرداند. برای `GET`های
  جانبی (فهرست مرجع ثانویه) یک صفحه‌ی خالی برمی‌گردد تا خطای مرزِ صفحه، رفتاری که آزموده می‌شود را
  پنهان نکند؛ ردیف‌ها همیشه صریح assert می‌شوند، پس خواندن اصلی هرگز با این fallback سبز نمی‌شود.

---

## ۲) مسیرها و اجرا

| نقش | مسیر |
| --- | --- |
| پیکربندی | `frontend/playwright.config.ts` |
| تست‌ها | `frontend/e2e/*.spec.ts` |
| مرز HTTP | `frontend/e2e/fixtures/api.ts` |
| داده‌ی نمونه (تایپ‌شده) | `frontend/e2e/fixtures/seed.ts` |
| مرحله‌ی CI | `.github/workflows/ci.yml` → job `frontend-e2e` |

```bash
cd frontend
npx playwright install --with-deps chromium   # یک‌بار، برای دریافت مرورگر
npm run test:e2e                              # سرور dev را خودش بالا می‌آورد
E2E_BASE_URL=http://127.0.0.1:5173 npm run test:e2e   # سرور در حال اجرا (reuse)
```

- `webServer.command = npm run dev -- --port 5173 --strictPort`؛ اگر سروری از قبل روی ۵۱۷۳
  باشد، Playwright در حالت لوکال از آن استفاده می‌کند (`reuseExistingServer`).
- پیش‌فرض‌ها: `locale=fa-IR`، `timezoneId=Asia/Tehran`، `trace=retain-on-failure`،
  اسکرین‌شات فقط در شکست. در CI: `retries=1`، دو worker، گزارش `list` + `html`.
- **اجرای لوکال اجباری نیست**؛ استاندارد گرید (data-table.md §۱۰) اجرای محلی «سنگین» را ممنوع
  کرده و اجرای مرورگری را به CI سپرده است. `npm test` (Vitest/jsdom) حلقه‌ی سریع لوکال است.

---

## ۳) قانون نوشتن تست

1. **فقط نقش (role) یا `data-testid` مستند.** کلاس CSS، مسیر DOM و متن شکننده ممنوع.
2. متن‌ها از دیکشنری می‌آیند: `import { t } from '../src/lib/i18n';` — هیچ رشته‌ی فارسی
   دست‌نویس در spec نوشته نمی‌شود (همان قانون standards.md §۷).
3. هر تست فقط **یک رفتار**؛ آماده‌سازی در `beforeEach` (`installApiStub` + `goto` + انتظار برای
   ردیف اول) تا خطای واقعی از انتظارِ گم‌شده جدا بماند.
4. assertionهای همگام‌نشدنی با `expect(...)` (خودش retry می‌کند) نوشته می‌شوند، نه `waitForTimeout`.
5. **چهار عرض** پوشش داده می‌شود: `360px` (موبایل)، `768px` (تبلت)، `1280px` (دسکتاپ).
6. برای گرید، همیشه **سرشماری نتیجه** (`data-table-filter-summary`) و **حضور/غیبت یک ردیف
   مشخص** با هم بررسی می‌شوند؛ فقط شمردن ردیف‌ها، شکستِ «همه‌ی ردیف‌ها فیلتر شده‌اند» را پنهان می‌کند.
7. اسکرول افقی صفحه ممنوع است: `document.documentElement.scrollWidth <= innerWidth + 1`.
   گریدِ پهن باید **درون** `TableWrapper` اسکرول بخورد، نه اینکه کل صفحه را بکشد (نقص گزارش‌شده).

---

## ۴) فهرست تست‌های موجود

| فایل | چه چیزی را می‌سنجد |
| --- | --- |
| `e2e/users.spec.ts` | جست‌وجوی سراسری، نرمال‌سازی «ي/ی»، فیلتر متن و انتخاب، Reset، حالت «یافت نشد»، `aria-sort` |
| `e2e/roles.spec.ts` | جست‌وجو روی نام **و** توضیح نقش، فیلتر ستونی + Reset |
| `e2e/items.spec.ts` | فیلتر کد/نوع کالا، ماندن `itemGroupId` به‌عنوان کوئری سرور در URL |
| `e2e/document-account-link.spec.ts` | کد↔نام حساب در ردیف سند: تایپ کد → نام، تایپ نام → کد، حساب تجمیعی نمایش‌پذیر ولی غیرقابل‌انتخاب، انتخاب با کیبورد |
| `e2e/responsive.spec.ts` | ۳۶۰/۷۶۸/۱۲۸۰: نبود اسکرول افقی صفحه، دسترس‌پذیری کنترل‌ها، جمع/باز شدن ریل کنار |

- **شمارش واقعی:** ۱۹ تست در ۵ فایل (`npm run test:e2e -- --list`).
- انتخاب‌گرهای مشترک: `data-table-toolbar`, `data-table-filter-summary`, `data-table-reset-filters`,
  `data-table-clear-filters`, `account-suggestions`, `data-table-truncation-notice`,
  `users-page`, `roles-page`, `items-page`.

---

## ۵) CI

- job مستقل `frontend-e2e` (به `classify` وابسته است و با `outputs.frontend == 'true'` اجرا می‌شود)،
  نه یک قدم داخل job `frontend`: شکست چیدمان باید از شکست typecheck/unit جدا دیده شود و زمان
  مرورگر فقط یک‌بار پرداخت شود.
- مراحل: نصب وابستگی‌ها → `npx playwright install --with-deps chromium` → `npm run test:e2e`
  → بارگذاری `playwright-report`/`test-results` در شکست.
- `ci-gate` این job را نیز می‌پوشاند (`scripts/ci-gate.py` → `GATED_JOBS`)؛ پس skip شدن آن
  «سبز» تلقی نمی‌شود و merge بدون اجرای آن ممکن نیست.
- **شرط merge:** `frontend` (lint/typecheck/format/unit/build) و `frontend-e2e` هر دو سبز.
