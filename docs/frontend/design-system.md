# Design System فرانت‌اند Vardena

**وضعیت:** ACTIVE — مرجع اجرایی لایۀ بصری
**نسخه:** ۱.۰
**وابستگی:** `docs/frontend/standards.md` (مرجع حقیقت قواعد) — این سند جزئیات اجرایی همان قواعد را ثبت می‌کند و در تعارض، `standards.md` و سپس ADR مقدم است.

این سند سه چیز را ثابت می‌کند:

1. **کجا** رنگ/فاصله/سایه/تایپوگرافی تعریف می‌شود (فقط `src/styles/index.css`).
2. **کدام** کامپوننت مشترک برای هر الگوی تکرارشوندۀ محصول وجود دارد (تا صفحۀ جدید فقط ترکیب الگو باشد).
3. **چگونه** قاعده به‌صورت ماشینی گرفته می‌شود (`scripts/check-frontend-design-tokens.mjs` + CI).

---

## ۱) لایۀ توکن — `src/styles/index.css`

تمام تصمیم‌های رنگ در بلوک `@theme` تعریف می‌شوند. هیچ کامپوننتی (نه feature و نه shared) مقدار hex/rgb ندارد؛ گارد CI این را می‌گیرد.

### سطوح (Surfaces)

| توکن                  | مقدار     | کاربرد                                        |
| --------------------- | --------- | --------------------------------------------- |
| `--color-canvas`      | `#f6f7f9` | پس‌زمینۀ کل صفحه (بدنۀ اپلیکیشن)              |
| `--color-surface`     | `#ffffff` | کارت، جدول، هدر، سایدبار                      |
| `--color-sunken`      | `#f8fafc` | ناحیۀ فرورفته: هدر جدول، hover خنثی، chip کاربر |
| `--color-line`        | `#e2e8f0` | خط جداکننده و کادر پیش‌فرض                     |
| `--color-line-strong` | `#cbd5e1` | کادر پرکنتراست (outline button، empty dashed) |

### متن (Ink)

| توکن                | مقدار     | کاربرد                                      |
| ------------------- | --------- | ------------------------------------------- |
| `--color-ink`       | `#0f172a` | عنوان و متن اصلی                            |
| `--color-ink-muted` | `#475569` | متن توضیحی، سلول جدول، برچسب ثانویه         |
| `--color-ink-subtle`| `#64748b` | متادیتا، placeholder، ستون راهنما           |

### برند

| توکن                | مقدار     | کاربرد                                     |
| ------------------- | --------- | ------------------------------------------ |
| `--color-brand`     | `#4f46e5` | دکمۀ اصلی، حالت فعال منو، حلقهٔ فوکوس       |
| `--color-brand-strong` | `#4338ca` | hover/active دکمۀ اصلی                  |
| `--color-brand-soft`| `#eef2ff` | پس‌زمینۀ آیتم فعال منو                     |
| `--color-brand-ink` | `#3730a3` | متن روی `brand-soft`                       |

### وضعیت (Status) — همیشه سه‌گانه

هر وضعیت یک «سطح نرم + خط + متن خوانا» دارد. رنگ تنها حامل معنا نیست؛ متن/آیکون/برچسب هم هست (WCAG 1.4.1).

| معنا     | نرم               | خط                 | متن                |
| -------- | ----------------- | ------------------- | ------------------ |
| موفق     | `ok-soft`         | `ok-line`           | `ok-ink`           |
| هشدار    | `warn-soft`       | `warn-line`         | `warn-ink`         |
| خطر/خطا  | `danger-soft`     | `danger-line`       | `danger-ink`       |
| اطلاع    | `info-soft`       | `info-line`         | `info-ink`         |
| خطر پُر  | `danger`          | `danger-strong`     | — (پس‌زمینه دکمه)  |

`Badge`، `Alert`، `Toast` و نواری‌های وضعیت لایسنس فقط از همین جفت‌ها استفاده می‌کنند؛ بنابراین یک «هشدار» در همۀ محصول یک شکل است.

### شکل و ارتفاع

| توکن               | مقدار    | قاعده                                              |
| ------------------ | -------- | -------------------------------------------------- |
| `--radius-control` | `0.5rem` | دکمه، input، select، آیتم منو                      |
| `--radius-card`    | `0.875rem` | کارت، جدول، نوار فیلتر، بلوک empty                |
| `--shadow-card`    | سایه ۱–۲px | تنها ارتفاع مجاز برای سطح‌های عادی                |
| `--shadow-raised`  | سایه ۱۲px  | فقط کارت شناور (لاگین) و اعلان شناور؛ نه هر کارت  |

دو سطح سایه بیشتر نداریم: عمق بصری از **کادر و سطح** می‌آید، نه از سایه‌های تزئینی (اصل ۱: چگالی بر تزئین).

---

## ۲) تایپوگرافی

- فونت: **Vazirmatn** نسخۀ ۳۳٫۰۰۳، self-host در `public/fonts/` (چهار وزن ۴۰۰/۵۰۰/۶۰۰/۷۰۰). هیچ CDN فونتی در زمان اجرا فراخوانی نمی‌شود (استاندارد §۱۴). مجوز: `frontend/THIRD_PARTY_NOTICES.md`.
- `line-height` پایه بدنه **۱٫۷۵** است: خط فارسی در ارتفاع لاتین خفه می‌شود و ۱٫۵ برای جدول‌های ۳۰–۴۰ ردیفی خوانا نیست.
- عنوان‌ها (`h1`–`h3`) `line-height: 1.4` با `text-wrap: balance`.
- مقیاس واقعی محصول:

| نقش                | کلاس‌ها                                    | نمونه                          |
| ------------------ | ------------------------------------------ | ------------------------------ |
| عنوان صفحه         | `text-lg font-semibold` (`PageHeader`)     | «اسناد حسابداری»               |
| عنوان کارت/بخش     | `text-sm font-semibold`                    | «خلاصه»                        |
| متن بدنه/جدول      | `text-sm`                                  | سلول‌ها                        |
| برچسب فیلد/متادیتا | `text-xs font-medium text-ink-muted`       | «انبار»                        |
| ریزترین متادیتا    | `text-[11px]`                              | عنوان گروه در سایدبار          |

- اعداد: کلاس `.num` (tabular-nums، جهت LTR، تراز انتها) و `.code` برای شناسه‌ها. هیچ عددی با `toLocaleString` محلی فرمت نمی‌شود؛ فرمتر مرکزی `@/lib/format` تنها مسیر است.
- تاریخ: فقط `@/lib/datetime` و `ui/patterns/date-input.tsx`؛ این لایه در این سند بازتعریف نمی‌شود (ADR-0042، `docs/datetime.md`).

---

## ۳) کامپوننت‌های پایه — `src/ui/*`

| کامپوننت | گونه‌ها (variants) | نکته |
| -------- | ------------------ | ---- |
| `Button` | `default` · `outline` · `ghost` · `subtle` · `danger`؛ اندازۀ `sm`/`md`/`icon` | `loading` دکمه را disabled و `aria-busy` می‌کند (ضد ارسال دوباره)؛ `asChild` برای لینک |
| `Input` | — | `aria-invalid` را از `FormField` می‌گیرد؛ ارتفاع ۹ |
| `Select` | — | همان قرارداد Input |
| `Label` | — | متن کوچک، غیرقابل انتخاب |
| `Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` | — | سطح `surface` + `border-line` + `radius-card` |
| `Table` / `TableWrapper` / `TableHeaderCell` / `TableCell` … | — | `TableWrapper` پیمایش افقی و `.scroll-thin` |
| `Alert` / `AlertTitle` / `AlertBody` | `info` · `success` · `warning` · `danger` · `neutral` | پیام پایدار درون‌صفحه |
| `Badge` | `neutral` · `info` · `success` · `warning` · `danger` | همیشه با متن، هرگز فقط رنگ |
| `Skeleton` | — | `aria-hidden`، شکل محتوا را نگه می‌دارد |

---

## ۴) الگوها — `src/ui/patterns/*`

هر الگو دقیقاً یک مسئولیت دارد و صفحۀ جدید فقط این‌ها را ترکیب می‌کند (اصل ۲).

| الگو | فایل | مسئولیت |
| ---- | ---- | ------- |
| `PageHeader` | `page-header.tsx` | تنها `h1` صفحه + `description` + `meta` (کد/وضعیت) + `actions` |
| `FilterBar` / `FilterField` | `filter-bar.tsx` | نوار فیلتر واحد: گرید ۲–۵ ستونه، ردیف عملیات (اعمال/پاک‌کردن)، `aria-label` روی `form`/`section` |
| `DataTable` | `data-table.tsx` | گرید سرور-محور با چهار حالت، `aria-sort`, آیکون مرتب‌سازی، `emptyAction` |
| `Pagination` | `pagination.tsx` | صفحه/اندازه صفحه، وضعیت `fetching` |
| `FormField` | `form-field.tsx` | اتصال label/کنترل/خطا/راهنما + `aria-required` + ستارۀ الزامی بیرون از متن label |
| `DefinitionList` / `Definition` | `definition-list.tsx` | خلاصۀ کلید/مقدار صفحه‌های جزئیات (`dl`/`dt`/`dd`) |
| `LoadingState` / `FullPageLoading` | `states.tsx` | اسکلت هم‌شکل محتوا + Thinking Orb؛ `FullPageLoading` فقط برای bootstrap نشست |
| `EmptyState` | `states.tsx` | «چیزی برای نمایش نیست» + مسیر بازیابی (`action`) |
| `ErrorState` | `states.tsx` | خطای پایانی با نقش `alert` و دکمۀ تلاش دوباره |
| `ApiErrorAlert` | `api-error-alert.tsx` | خطای API: پیام فارسی + `correlationId` + retry |
| `ConfirmDialog` | `confirm-dialog.tsx` | تأیید عملیات مخرب/برگشت‌ناپذیر با focus trap |
| `Toast` / `useToast` | `toast.tsx` | بازخورد گذرا با variant وضعیت |
| `DateInput` | `date-input.tsx` | ورود BusinessDate (Jalali-first، ورودی فارسی/عربی/لاتین) |
| `request-activity` | `request-activity.tsx` | نشانگرهای فعالیت پس‌زمینه/محلی، بدون overlay |

قاعدۀ انتخاب: اگر همان چیدمان در **دو** feature تکرار شد، به `patterns/` منتقل می‌شود (colocation → shared). در این دور `FilterBar` و `DefinitionList` دقیقاً از همین قاعده زاده شدند.

---

## ۵) پوسته و ناوبری — `src/app/layouts/app-shell.tsx`

- یک پوسته برای همه: هدر چسبان ۳٫۵rem، سایدبار ۱۶rem در دسکتاپ، دراور تمام‌قد در موبایل (بدون صفحۀ موبایل دوم).
- دراور یک سطح کیبوردی واقعی است: بسته = `invisible` (خارج از layout/focus/a11y tree)، باز = `visible` + قفل اسکرول بدنه + حلقۀ Tab + بستن با `Escape` + بازگشت فوکوس به دکمۀ بازکننده + بستن هنگام کلیک روی لینک.
- آیتم فعال منو: `bg-brand-soft` + نوار عمودی `brand` + `aria-current="page"`.
- لینک «رفتن به محتوای اصلی» اولین عنصر قابل فوکوس است و به `#main-content` اشاره می‌کند.
- حذف عمدی: فیلد جست‌وجوی سراسری وجود ندارد، چون API قرارداد جست‌وجوی سراسری ندارد و کنترلِ بدون عملکرد = قابلیت جعلی.

---

## ۶) دسترس‌پذیری — خط پایه (WCAG 2.2 AA تلاش)

| موضوع | پیاده‌سازی |
| ----- | ---------- |
| فوکوس | `:focus-visible` سراسری با `outline 2px` توکن `brand` و `offset 2px`؛ هیچ کامپوننتی `outline: none` بدون جانشین ندارد |
| برچسب | هر کنترل از `FormField` یا `FilterField`؛ آیکون‌ها `aria-hidden` |
| خطا | پیام زیر همان فیلد، `role="alert"`، `aria-describedby` هینت+خطا، `aria-invalid` |
| جدول | `aria-sort` (شامل `none`)، هدر مرتب‌سازی دکمه است، `caption` اختیاری برای جدول‌های بدون عنوان |
| حرکت | بلوک `prefers-reduced-motion: reduce` همۀ انیمیشن/ترنزیشن‌ها را عملاً متوقف می‌کند |
| مقیاس‌پذیری | ارتفاع‌ها با `rem`، بدون متن داخل تصویر، تراز منطقی (`ms/me/ps/pe/start/end`) |
| وضعیت | هیچ وضعیتی فقط با رنگ بیان نمی‌شود (برچسب متنی + آیکون) |

پوشش تست: `form-field.test.tsx` (اتصال label، `aria-required`, `aria-describedby`)، `filter-bar.test.tsx` (نام دسترس‌پذیر نوار، disabled‌ها)، `data-table.test.tsx` (`aria-sort`/آیکون/empty)، `app-shell.test.tsx` (Escape، حلقۀ Tab، بازگشت فوکوس، قفل اسکرول).

---

## ۷) گارد ماشینی

```bash
node scripts/check-frontend-design-tokens.mjs
```

سه قاعده را می‌گیرد:

1. هیچ hex/rgb/hsl در `src/**/*.ts(x)` نباشد.
2. لایۀ مشترک (`src/ui/**` و `src/app/**`) فقط توکن معنایی استفاده کند؛ کلاس پالت خام (`text-slate-600`, `bg-rose-50`, …) رد می‌شود.
3. قرارداد توکن در `src/styles/index.css` کامل باشد (توکن ارجاع‌شده ولی تعریف‌نشده = خطا).

در CI، گام «Frontend design-token guard» پیش از `npm ci` اجرا می‌شود (بدون وابستگی، فقط خواندن).

---

## ۸) مسیر مهاجرت باقی‌ماندۀ feature pages

لایۀ مشترک اکنون صد‌درصد توکنی است. صفحه‌های feature هنوز در چند جا از کلاس پالت خام استفاده می‌کنند. مهاجرت **فقط با نگاشت معادل دقیق** مجاز است، چون تغییر مقدار = تغییر کنتراست:

| کلاس فعلی | معادل دقیق | توکن |
| --------- | ---------- | ---- |
| `bg-white` | `#ffffff` | `bg-surface` |
| `bg-slate-50` | `#f8fafc` | `bg-sunken` |
| `border-slate-200` | `#e2e8f0` | `border-line` |
| `border-slate-300` | `#cbd5e1` | `border-line-strong` |
| `text-slate-900` | `#0f172a` | `text-ink` |
| `text-slate-600` | `#475569` | `text-ink-muted` |
| `text-slate-500` | `#64748b` | `text-ink-subtle` |
| `text-indigo-600` | `#4f46e5` | `text-brand` |

نگاشت‌نشدنی‌ها (`text-slate-400`, `text-slate-700`, `indigo-500`, …) **عمداً** تبدیل نشده‌اند؛ برای آن‌ها یا توکن جدید با تصمیم مالک لازم است یا مقدار فعلی حفظ می‌شود. تبدیل کورکورانه، کنتراست را بی‌سروصدا تغییر می‌دهد و مجاز نیست.

---

## ۹) چک‌لیست صفحۀ جدید

- [ ] `PageHeader` با عنوان `h1` و `actions` مجاز‌سنجی‌شده
- [ ] `FilterBar` برای فیلترها؛ وضعیت فیلتر در URL (استاندارد §۵)
- [ ] `DataTable` با `emptyTitle`/`emptyDescription`/`emptyAction` متناسب با دسترسی
- [ ] چهار حالت: `LoadingState`، `EmptyState`، `ApiErrorAlert`/`ErrorState`، محتوای موفق
- [ ] `FormField` برای هر کنترل فرم؛ ستارۀ الزامی + `aria-required`
- [ ] همۀ متن‌ها از `@/lib/i18n`؛ عدد/تاریخ از `@/lib/format` و `@/lib/datetime`
- [ ] فقط توکن معنایی (گارد باید سبز باشد)
- [ ] گیت مجوز (`RequirePermission`) هم‌راستا با مجوز دقیق endpoint
