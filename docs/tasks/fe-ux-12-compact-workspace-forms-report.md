# گزارش مأموریت FE-UX-12 — فرم‌های فشردهٔ محیط کاری و سربرگ یکپارچه

**وضعیت:** READY FOR REVIEW
**تاریخ:** ۲۰۲۶-۱۰-۲۹
**شاخهٔ کار:** `arena/164a68cc-vardena` (از `main` در `23c3a7c`)
**نوع تغییر:** لایهٔ نمایش، ناوبری محیط کاری، الگوهای مشترک، توکن چگالی، تست و مستندسازی — **بدون تغییر** قرارداد API، مدل داده، migration، مجوزها، احراز هویت یا قاعدهٔ کسب‌وکار.

---

## ۱) خلاصهٔ اجرایی

سه تغییر در یک زنجیره، در لایهٔ **مشترک** و نه با وصلهٔ هر مسیر:

1. **حذف سربرگ‌های تکراری بالای محتوا:** `AppBreadcrumb` و `PageBackButton` صفحه‌ای از پوستهٔ
   `AppShell` حذف شدند و محتوای پنجره مستقیماً زیر نوار «پنجره‌های فعال» آغاز می‌شود.
2. **یک سربرگ مشترک فشرده** (`FormPageHeader`) برای همهٔ فرم‌ها و صفحه‌های جزئیات با Back
   استاندارد در بالا-راست (RTL)، شناسهٔ رکورد و اقدام‌های صفحه — با یک پیاده‌سازی ریسپانسیو.
3. **چگالی جدول‌گونهٔ جزئیات:** `DefinitionList`/`Definition` به یک گرید خواندنی به سبک جدول
   داده بازنویسی شد (چند فیلد در ردیف، خطوط مویی، پدینگ فشرده) و `FormSection` برای سربرگ
   فشردهٔ بخش‌ها اضافه شد؛ همه با توکن‌های چگالی در `src/styles/index.css`.

Back با سه لایه شواهد حل می‌شود (تاریخچهٔ همان پنجره، پنجرهٔ مبدأ `openedFrom`، والد قراردادی
مسیر) و هیچ‌جا `navigate(-1)` کور اجرا نمی‌شود.

---

## ۲) چه چیزی تغییر کرد

### ۲.۱ پوسته (`src/app/layouts/app-shell.tsx`)

- `<AppBreadcrumb />` و `<PageBackButton />` از `<main id="main-content">` حذف شدند؛
  ترتیب باقی‌مانده: `WorkspaceDock` (بدون تغییر در رفتار sticky/z-index/آنسامبل تب‌ها) و سپس
  `WorkspaceWindowHost`.
- فاصلهٔ عمودی محتوا از `py-4 sm:py-5` به `pt-2 pb-4` و `space-y-4` به `space-y-2` رسید تا
  فرم دقیقاً زیر داک شروع شود؛ پدینگ افقی دست‌نخورده ماند چون داک با `-mx-3 sm:-mx-5 lg:-mx-6`
  به لبه‌ها bleed می‌کند.
- `src/app/breadcrumb.tsx` و `src/app/layouts/page-back-button.tsx` (و تست‌هایشان) حذف شدند؛
  معادل والد مسیر به `src/app/workspace/parent-path.ts` منتقل شد که تنها منبع والد است و در
  Back مصرف می‌شود.

### ۲.۲ سربرگ مشترک — `src/app/layouts/form-page-header.tsx`

در لایهٔ `app` است (نه `ui/patterns`) چون Back به وضعیت پنجره‌ها نیاز دارد؛ همان الگوی
`@/app/workspace/workspace-context` که فرم‌ها از قبل وارد می‌کنند.

- یک ردیف فشرده: **Back (outline, size=sm, `ArrowRight`, `aria-label`, `min-h-form-header`)** در
  ابتدا (بالا-راست RTL) → جداکنندهٔ ۱px → `h1` با `text-sm` + برچسب‌های وضعیت (`meta`) →
  توضیح یک‌خطی `line-clamp-2` (شناسهٔ رکورد/شمارهٔ سند) → اقدام‌ها در انتها (چپ RTL).
- ریسپانسیو بدون کامپوننت تکراری: ردیف wrap می‌شود، برچسب «بازگشت» زیر `sm` به آیکون جمع
  می‌شود (نام دسترس‌پذیر می‌ماند) و روی اشاره‌گر لمسی (`pointer-coarse`) ارتفاع دکمه `h-9`
  می‌شود.
- `PageHeader` برای صفحه‌های فهرست/گزارش/داشبورد/تنظیمات ماند (عنوان واقعی صفحه)؛ ۴۳ فایل
  فرم/جزئیات به `FormPageHeader` مهاجرت کردند (حسابداری، اسناد، انبار، سازمان، مدیریت).

### ۲.۳ جزئیات فشرده — `ui/patterns/definition-list.tsx` و `ui/patterns/form-section.tsx`

- `DefinitionList` یک سطح با کادر مویی است؛ روی دسکتاپ ۲–۳ فیلد در هر ردیف
  (`grid-cols-[var(--spacing-detail-label-inline)_minmax(0,1fr)]` در هر سلول) با ستون برچسب
  هم‌تراز، ارتفاع ردیف ≈۳۲px، `break-words` برای مقدارهای بلند و `Definition span` برای
  متن‌های بلند. سمانتیک `dl/dt/dd` حفظ شد.
- `FormSection`: سربرگ فشردهٔ بخش (`h2` + خط ۱px + اقدام‌های بخش) — در صفحهٔ جزئیات سند
  حسابداری برای بخش‌های «اطلاعات سند» و «ردیف‌های سند» به کار رفت و هدرهای `h2` دستی را حذف کرد.
- `features/administration/administration-ui.tsx` که نسخهٔ تکراری `DefinitionList` را داشت،
  اکنون از الگوی مشترک re-export می‌کند (یک الگو برای همهٔ ماژول‌ها).

### ۲.۴ سیستم چگالی (توکن‌ها)

`src/styles/index.css`:

| توکن | مقدار | مصرف |
| --- | --- | --- |
| `--spacing-form-header` | `2.25rem` | `min-h-form-header` |
| `--spacing-form-header-gap` | `0.5rem` | `gap-x-form-header-gap` |
| `--spacing-form-section-header` | `1.75rem` | `min-h-form-section-header` |
| `--spacing-detail-label-inline` | `7.5rem` | ستون برچسب گرید جزئیات |
| `--spacing-detail-cell-inline` / `-block` | `0.75rem` / `0.375rem` | پدینگ سلول جزئیات |
| `--spacing-workspace-inset` | `0.375rem` | فاصلهٔ محتوا از داک |

کنترل‌های تعاملی کوچک نشدند: ورودی/دکمهٔ `md` همان `h-9`، دکمهٔ نوارها `h-8` (و روی لمسی
`h-9`)، پدینگ سلول جدول داده و دیالوگ‌ها بدون تغییر. خروجی build تأیید می‌کند کلاس‌های تولیدشده
از این توکن‌ها (`min-h-form-header`, `px-detail-cell-inline`, `gap-x-form-header-gap`,
`pointer-coarse:*`) در CSS نهایی emit شده‌اند.

### ۲.۵ قواعد Back

`src/app/workspace/use-form-page-back.ts`:

1. تاریخچهٔ همان پنجره (`index > 0`) و پنجرهٔ بدون form dirty → یک قدم داخل `MemoryRouter`
   (مرحلهٔ قبلی همان جریان کاری؛ state آن مرحله زنده می‌ماند).
2. `openedFrom` (فیلد **runtime** جدید در `WorkspaceWindow`) و پنجرهٔ مبدأ اگر هنوز باز است →
   فعال‌سازی همان پنجره؛ فیلترها/query لیست حفظ می‌شوند (reuse §۴.۵).
3. `parent-path.ts`: `…/:id/edit` → `…/:id`؛ `…/new` → فهرست؛ جزئیات → ثبت‌شده‌ترین مقصد
   ناوبری که پیشوند واقعی مسیر است؛ سپس `/app`. `backTo` صریح صفحه (مثل
   `inventory/transfers/new` → `inventory/movements`) بر همه مقدم است، اما فقط اگر مقصد واقعی
   باشد.
4. ورود مستقیم/رفرش/بازیابی: همان والد قراردادی؛ خارج از پوسته اگر تاریخچهٔ مرورگر ورودی
   درون‌برنامه‌ای دارد یک قدم، وگرنه `replace` (بدون ورودی مرده).

فرم dirty هرگز با Back دور ریخته نمی‌شود: پنجرهٔ پیش‌نویس باز می‌ماند (W-05) و Back فقط والد را
فعال می‌کند.

---

## ۳) مهارت UI UX Pro Max — کوئری‌ها و تصمیم‌ها

کوئری‌های اجراشده (طبق قرارداد `docs/frontend/ui-ux-pro-max.md`، بدون `--persist`):

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "internal operations ERP dense data form" \
  --design-system --density 8 --motion 2 --variance 3 -p "Vardena"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "back behavior" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "nav hierarchy" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "heading hierarchy form" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "touch target size" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "focus not obscured" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "icon button accessible label" --domain icons
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "data table density" --stack shadcn
```

| توصیه | تصمیم | دلیل |
| --- | --- | --- |
| Minimalism/Swiss + `density 8` برای ERP متراکم | **اعمال** | با `standards.md` §۱ (چگالی بر تزئین) هم‌جهت است |
| «Keep back predictable / preserve navigation history» | **اعمال** | سه‌لایه‌شدن Back؛ `navigate(-1)` کور حذف شد |
| breadcrumb برای عمق ۳+ | **رد** (برای داخل محیط کاری) | داک نام صفحه را می‌گوید و ساختار مسیر با `/app/<module>/<collection>/:id` دو سطحی است؛ حفظ breadcrumb = تکرار |
| Heading hierarchy h1→h2 بدون پرش | **اعمال** | `h1` سربرگ فشرده + `h2` در `FormSection` |
| Target size ≥24px (WCAG 2.2 AA) و اجتناب از 44pt به‌عنوان قاعدهٔ وب | **اعمال** | دکمه‌ها `h-8`/`h-9` (۳۲/۳۶px) و روی لمسی بزرگ‌تر؛ هیچ کنترل زیر ۲۴px نمی‌رود |
| Focus not obscured: `scroll-padding` با ارتفاع چسبان | **از قبل موجود** | `html { scroll-padding-top: 6.25rem }` در `index.css` با داک `sticky top-14` هم‌خوان است |
| Icon-only button needs accessible name | **اعمال** | برچسب Back همیشه `aria-label` دارد، حتی وقتی متن در موبایل جمع می‌شود |
| پالت رنگی/فونت Google/GSAP چارچوب‌های اسکیل | **رد** | لایۀ ترجمه: توکن `semantic`، Vazirmatn self-host، بدون GSAP (ADR-0002) |
| `Table` برای داده جدولی، پرهیز از گرید برای جدول | **اعمال با تفکیک** | داده واقعاً جدولی = `ui/table`؛ متادیتای موجودیت = گرید `DefinitionList` با `dl/dt/dd` |

---

## ۴) تست و شواهد واقعی

اجرا در همین محیط (Node 22، Vite 7، Vitest 4، oxlint):

| فرمان | نتیجه |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | ✅ پاک |
| `npm run lint` (`oxlint .`) | ✅ ۰ خطا، ۰ هشدار (۵۱۹ فایل) |
| `npm run format:check` (prettier) | ✅ پاک |
| `npm test` (`vitest run`) | ✅ **۱۴۷ فایل / ۱۰۹۰ تست سبز** |
| `npm run build` | ✅ موفق (هشدار اندازهٔ chunk از قبل موجود) |
| `node scripts/check-frontend-design-tokens.mjs` | ✅ OK (۶۳۱ فایل، توکن/جهت‌منطقی) |
| `python3 scripts/check-date-contract.py` | ✅ PASS |
| `python3 scripts/check-docs-links.py` | ✅ PASS (۰ لینک شکسته) |
| `npm run dev` (Vite) | ✅ سرور بالا آمد و ماژول‌ها سرو شدند (`/`, `/src/main.tsx`, `form-page-header.tsx`, `index.css` = 200) |

### تست‌های جدید (رفتار قابل مشاهده، نه پیاده‌سازی)

- `src/app/layouts/workspace-form-chrome.test.tsx` — با **پوستهٔ واقعی** (`AppRoutes`):
  داک حاضر است، هیچ لندمارک breadcrumb وجود ندارد، فقط یک `h1` هست، سربرگ فشردهٔ صفحهٔ
  «جزئیات حساب» با Back و شناسهٔ «۱۰۱۰ — نقد» دیده می‌شود، و Back از یک ورود مستقیم
  (`/app/accounting/accounts/acc-1` بدون تاریخچه) پنجرهٔ فهرست حساب‌ها را باز می‌کند (بدون ۴۰۴،
  بدون مقصد ساختگی).
- `src/app/layouts/form-page-header.test.tsx` — نام دسترس‌پذیر Back، ترتیب ردیف (Back اول،
  اقدام آخر)، بازگشت به مرحلهٔ قبلی درون پنجره (`…/:id/edit` → `…/:id`)، ورود مستقیم → والد
  قراردادی، و فعال‌شدن پنجرهٔ فهرستِ مبدأ به‌جای ساخت پنجرهٔ سوم.
- `src/app/workspace/parent-path.test.ts` — ۹ قاعدهٔ والد: فهرست رکورد، رکورد از فرم ویرایش،
  فهرست از فرم ایجاد، `backTo` معتبر/نامعتبر، هاب ماژول برای `transfers/new`، مسیر ناشناخته و
  کوئری.
- `src/app/workspace/workspace-reducer.test.ts` — `openedFrom` برای پنجرهٔ جدید (والد = پنجرهٔ
  فعال)، `null` برای تکرار (duplicate) و برای پنجرهٔ بازشده از هاب.
- `src/app/layouts/app-shell.test.tsx` — بازنویسی‌شده: استقرار مسیر فعال بدون breadcrumb و
  حضور داک بالای محتوا.

### مرورگر واقعی و اسکرین‌شات

**انجام نشد و ادعا نمی‌شود.** این محیط sandbox هیچ موتور مرورگری ندارد و
`npx playwright install chromium` با خطای دانلود (`Download failure, code=1`) شکست خورد؛ بنابراین
هیچ اسکرین‌شات before/after گرفته نشده است. آنچه واقعاً اجرا و مشاهده شد: رندر کامل پوسته/روتر/
پنجره‌ها/صفحه‌ها در jsdom (تست‌های بالا + ۱۰۹۰ تست موجود) و سرو شدن اپلیکیشن در Vite dev.
صحت پیکسلی/چیدمانی (۳۶۰/۷۶۸/۱۲۸۰px) در CI با `npm run test:e2e` (Playwright، `e2e/responsive.spec.ts`
و …) پوشش داده می‌شود؛ در این محیط قابل اجرا نبود.

---

## ۵) محدودیت‌ها و کارهای باقی‌مانده

1. **صفحه‌های تنظیمات** (`/app/profile`, `/app/organization/profile`) همچنان `PageHeader` دارند:
   فرم رکورد نیستند و عنوان صفحه برایشان معنادار است. اگر مالک محصول آن‌ها را هم فرم بداند،
   مهاجرتشان یک تغییر کوچک مستقل است.
2. **صفحه‌های فهرست/گزارش** عنوان `PageHeader` خود را نگه داشتند (عنوان واقعی صفحه). حذف آن
   تنها با تصمیم صریح مالک محصول انجام می‌شود.
3. **والد چند-پنجره‌ای فقط تا یک سطح:** `openedFrom` یک اشاره‌گر است، نه پشته؛ اگر پنجرهٔ مبدأ
   بسته شود Back به والد قراردادی مسیر می‌رود (رفتار عمدی و امن).
4. تودرتویی عمیق‌تر از «رکورد → ویرایش» در همین درخت مسیر وجود ندارد؛ اگر در آینده مسیر
   سه‌سطحی اضافه شود، صفحه باید `backTo` صریح بدهد (قاعده در `parent-path.ts` مستند است).
5. **مقایسهٔ بصری پیش/پس** به تصمیم مالک و اجرای CI/مرورگر محلی موکول است.
