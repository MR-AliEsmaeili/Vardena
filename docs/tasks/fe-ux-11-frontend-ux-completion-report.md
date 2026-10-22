# گزارش مأموریت FE-UX-11 — تکمیل کیفیت بصری و ممیزی پوشش فرانت‌اند

**وضعیت:** READY FOR REVIEW
**تاریخ:** ۲۰۲۶-۱۰-۲۲
**مبنا:** `main` پس از ادغام PR #192 و PR #193 — کامیت `6e5c1a6`
**شاخهٔ کار:** `feat/frontend-ux-completion`
**نوع تغییر:** لایهٔ نمایش، الگوهای مشترک، گارد CI، مستندسازی و تست — **بدون تغییر** قاعدهٔ کسب‌وکار، قرارداد API، مدل داده، migration، مجوزها یا معماری.

---

## ۱) خلاصهٔ اجرایی

این دور، سه کار مستقل را در یک زنجیره انجام داد:

1. **ارتقای کیفیت بصری** با یک لایهٔ توکن معنایی (`src/styles/index.css`) که همان پالت موجود (slate/indigo) را با نام‌های معنایی بازتعریف می‌کند؛ بنابراین تضاد رنگ‌ها تغییر نکرده، ولی از این پس تصمیم رنگ در یک نقطه گرفته می‌شود.
2. **استانداردسازی فنی** با استخراج الگوهای تکرارشونده (`FilterBar`, `DefinitionList`)، یکدست‌سازی چهار حالت (loading/empty/error/success) در `DataTable`/`States`، و بازنویسی پوستهٔ اپلیکیشن با دسترس‌پذیری واقعی (drawer موبایل، فوکوس، Escape، trap تب).
3. **ممیزی پوشش بک‌اند ↔ فرانت‌اند** با سند `docs/frontend/coverage-matrix.md`: ۵۳ گروه قرارداد، ۲۶ COMPLETE، ۱۱ PARTIAL، ۱۳ MISSING، ۳ NOT_REQUIRED.

قاعدۀ رنگ به‌صورت ماشینی گرفته می‌شود: `scripts/check-frontend-design-tokens.mjs` روی ۳۴۴ فایل اجرا و در CI سیم‌کشی شده است.

---

## ۲) چه چیزی تغییر کرد

### ۲.۱ لایهٔ توکن — `frontend/src/styles/index.css`

- فونت **Vazirmatn** به‌صورت self-hosted (Regular/Medium/SemiBold/Bold، woff2) در `frontend/public/fonts/`؛ بدون CDN و بدون وابستگی شبکه. پروانهٔ OFL در `frontend/THIRD_PARTY_NOTICES.md` ثبت شد.
- بلوک `@theme` با توکن‌های معنایی: سطوح (`canvas`, `surface`, `sunken`)، خطوط (`line`, `line-strong`)، متن (`ink`, `ink-muted`, `ink-subtle`)، برند (`brand`, `brand-strong`, `brand-soft`, `brand-ink`)، وضعیت‌های سه‌گانه (`ok/warn/danger/info` × `-soft/-line/-ink`).
- لایهٔ پایه: ارتفاع خط ۱٫۷۵ برای متن فارسی، حلقهٔ فوکوس مشترک (`focus-visible`)، `.scroll-thin`، و بلوک `prefers-reduced-motion`.

### ۲.۲ کامپوننت‌های پایه (`src/ui/*`)

`button`, `input`, `select`, `label`, `table`, `card`, `alert`, `badge`, `skeleton` به توکن منتقل شدند. تغییرات رفتاری فقط در مرزهای دسترس‌پذیری است (مثلاً `aria-invalid`, `aria-describedby`, حالت `active` یکدست)، نه در منطق.

### ۲.۳ الگوهای مشترک (`src/ui/patterns/*`)

| الگو | تغییر |
| ---- | ----- |
| `page-header.tsx` | پشتیبانی از `meta` (متادیتای صفحه در یک خط) |
| `states.tsx` | `EmptyState`/`ErrorState` با اکشن بازگشت و پیام یکدست |
| `data-table.tsx` | آیکون مرتب‌سازی، `emptyAction`، `aria-sort` شامل `none`، حالت چهارگانه کامل |
| `pagination.tsx` | برچسب‌های فارسی و `aria-label` شمارهٔ صفحه |
| `form-field.tsx` | ستارهٔ الزامی **بیرون** از `<label>` (باگ واقعی: متن لیبل به `نام کاربری*` تبدیل می‌شد و ۲۸ تست را می‌شکست) |
| `api-error-alert.tsx` | پیام خطای API با نقش `alert` و دکمهٔ تلاش دوباره |
| `confirm-dialog.tsx` | فوکوس اولیه، بازگرداندن فوکوس، Escape |
| `request-activity.tsx`, `toast.tsx`, `amount-cell.tsx` | یکدست‌سازی توکن و خوانایی ارقام |
| **`filter-bar.tsx` (جدید)** | نوار فیلتر مشترک با `FilterBar`/`FilterField` و `applyDisabled` |
| **`definition-list.tsx` (جدید)** | الگوی «برچسب/مقدار» برای صفحه‌های جزئیات؛ featureها دوباره صادر می‌کنند تا API داخلی نشکند |

`FilterBar` در ۸ سطح جای‌گذاری شد: سازمان (`admin-ui`)، حساب‌داری (`master-data-ui`, `documents-filter-bar`)، موجودی (`master-data-ui`, `movements-filter-bar`, `kardex-page`, `valuation-states-page`) و کاربران.

### ۲.۴ پوستهٔ اپلیکیشن

`app/layouts/app-shell.tsx` بازنویسی شد: نشان برند، چیپ کاربر، نوار تأکید آیتم فعال، و drawer موبایل با قفل اسکرول، `aria-controls`, Escape، trap تب در دو جهت، بازگرداندن فوکوس به دکمهٔ بازکننده و مخفی‌سازی واقعی از درخت دسترس‌پذیری (`invisible`). همچنین `app/breadcrumb.tsx`, `app/layouts/license-gate.tsx`, `app/layouts/bootstrap-states.tsx` و `app/routes/home-page.tsx` به توکن منتقل شدند؛ نتیجه: `src/ui/**` و `src/app/**` صددرصد token-only هستند.

`features/auth/login-page.tsx` نیز بازطراحی شد؛ `autoFocus` حذف شد (قاعدهٔ `jsx-a11y/no-autofocus`) و فوکوس مدیریت‌شده جای آن نشست.

### ۲.۵ بودجهٔ CTA در حالت خالی

برای صفحه‌های مدیریتی، دکمهٔ «ایجاد» در `EmptyState` فقط با مجوز مربوطه نمایش داده می‌شود:

- `administration/roles/roles-page.tsx` — CTA ایجاد نقش با گیت مجوز.
- `administration/users/users-page.tsx` — CTA ایجاد کاربر، و فقط وقتی فیلتری فعال نیست (`statusValue === ''`)، تا کاربر پیام «چیزی پیدا نشد» را با «هنوز چیزی ندارید» اشتباه نگیرد.

### ۲.۶ گارد CI

`scripts/check-frontend-design-tokens.mjs`:

- hex/rgb/hsl خام در `src/**` را می‌گیرد (به‌جز `styles/index.css`)؛
- کلاس پالت خام Tailwind (`slate-*`, `indigo-*`, ...) را در `src/ui/**` و `src/app/**` می‌گیرد؛
- خروجی سبز روی مخزن: `frontend design tokens: OK (344 source files, shared layer is token-only)`.

در `.github/workflows/ci.yml`، در job فرانت‌اند بلافاصله بعد از «Setup Node.js» به‌عنوان step «Frontend design-token guard» اضافه شد.

### ۲.۷ تست‌ها

تست‌های جدید/گسترش‌یافته (همگی رفتار واقعی، بدون snapshot تزئینی):

- `ui/patterns/filter-bar.test.tsx` — ارسال فیلتر، پاک‌سازی، `applyDisabled`.
- `ui/patterns/form-field.test.tsx` — اتصال `label`/`description`/`error` و ستارهٔ الزامی بدون آلوده‌کردن نام قابل‌دسترس.
- `ui/patterns/data-table.test.tsx` — حالت خالی، `emptyAction`، آیکون مرتب‌سازی، `aria-sort` (صعودی/نزولی/`none`) و ستون غیرقابل‌مرتب‌سازی.
- `app/layouts/app-shell.test.tsx` (+۴) — drawer بسته/باز، قفل اسکرول، Escape، بازگشت فوکوس، trap تب در دو جهت، بستن با کلیک ناوبری.
- `src/test/testing-library-config.test.tsx` — اثبات تنظیم `asyncUtilTimeout` (۳ ثانیه).

---

## ۳) ممیزی پوشش بک‌اند ↔ فرانت‌اند

سند کامل: **`docs/frontend/coverage-matrix.md`**

| وضعیت | تعداد |
| ----- | ----- |
| COMPLETE | ۲۶ |
| PARTIAL | ۱۱ |
| MISSING | ۱۳ |
| NOT_REQUIRED | ۳ |
| BLOCKED | ۰ |
| **جمع گروه‌های قرارداد** | **۵۳** |

نکات روش:

- مبنا، تطبیق ایستای `backend/src/modules/**/api/*.controller.ts` (۶۰ کنترلر) با `frontend/src/app/router.tsx`, `frontend/src/api/*.api.ts` و `features/**` است.
- «MISSING» یعنی UI وجود ندارد؛ **نه** اینکه بک‌اند ناقص است.
- موارد MISSING عمدتاً چرخهٔ عمر پیکربندی (حساب‌داری، اسناد پایه)، درخواست کالا/رزرو/اجرای قیمت‌گذاری، و ابزارهای مالکِ مجوز هستند. ساخت آن‌ها تصمیم محصولی است و در این دور انجام نشد (بخش ۷).
- `docs/frontend/ux/ux-flow-matrix.md` از قبل قدیمی است و با این ممیزی هم‌راستا نیست؛ در ماتریس به‌عنوان «نیازمند تسک جداگانه» علامت‌گذاری شد تا اطلاعات نادرست به‌عنوان حقیقت مصرف نشود.

---

## ۴) دسترس‌پذیری (تلاش WCAG 2.2 AA)

- **کنتراست:** پالت موجود حفظ شد (بدون روشن‌کردن رنگ‌ها)؛ توکن‌های `-ink` روی سطوح `-soft` انتخاب شدند تا نسبت کنتراست بدتر نشود.
- **کیبورد و فوکوس:** حلقهٔ فوکوس مشترک `focus-visible`، trap تب در drawer، Escape برای بستن، بازگرداندن فوکوس به مبدأ.
- **برچسب‌ها:** `Label`/`FormField` با `htmlFor`، `aria-invalid`, `aria-describedby`; پیام خطا با نقش `alert`.
- **جدول‌ها:** `aria-sort` روی هدر مرتب‌سازی‌شده (شامل `none`)، دکمهٔ مرتب‌سازی با متن قابل‌دسترس.
- **وضعیت فقط با رنگ بیان نمی‌شود:** `Badge`/`Alert` متن و آیکون دارند.
- **حرکت:** `prefers-reduced-motion` در CSS و رفتار بدون انیمیشن اجباری.
- **اعلام تغییر:** توست‌ها با `role="status"` و ناحیهٔ زنده.

---

## ۵) شواهد اجرا (واقعی، روی همین درخت کاری)

| بررسی | فرمان | نتیجه |
| ----- | ----- | ----- |
| نوع‌ها | `npm run typecheck` | ✅ بدون خطا |
| لینت | `npm run lint` (oxlint) | ✅ بدون خطا |
| قالب | `npx prettier --check --end-of-line crlf "src/**/*.{ts,tsx,css}"` | ✅ همه مطابق |
| تست‌ها | `npm test` | ✅ **۷۱ فایل / ۵۰۲ تست** |
| گارد تاریخ | `py -3 scripts/check-date-contract.py` | ✅ PASS |
| لینک مستندات | `py -3 scripts/check-docs-links.py` | ✅ ۳۴۸ فایل، ۱۲۶۲ لینک، ۰ خراب |
| گارد طراحی | `node scripts/check-frontend-design-tokens.mjs` | ✅ OK (۳۴۴ فایل) |
| ساخت | `npm run build` | ⚠️ روی این ماشین اجرا نمی‌شود (بخش ۶.۱)؛ ✅ در CI سبز شد (بخش ۵.۲) |

> قالب‌بندی محلی با `--end-of-line crlf` اجرا شد چون `core.autocrlf=true` است؛ CI لینوکسی همان اسکریپت معمول `format:check` را با LF اجرا می‌کند.

### ۵.۱ نوسان تست (flake) — تشخیص و اصلاح واقعی

در اجرای اول این دور، یک تست سنگین (`client-devices-page`: چرخهٔ جایگزینی آفلاین) با خطای «Test timed out in 5000ms» قرمز شد، در حالی که همان فایل به‌تنهایی سبز بود. علت، رقابت زمان‌بندی بین workerها بود، نه منطق. اصلاح:

- `maxWorkers: 4` (به‌جای یک worker به‌ازای هر هستهٔ منطقی) — پیش‌تر در همین دور اعمال شد؛
- `testTimeout: 15_000` با توضیح در `vitest.config.ts` — تست‌های جریان‌محور با `userEvent` روی استک کامل provider به بیش از ۵ ثانیه در ماشین اشباع‌شده نیاز دارند. هیچ assertion حذف یا سست نشد؛ تایم‌اوت تنها سقف شکست واقعی را بالا می‌برد.

پس از این تنظیم: ۷۱/۷۱ فایل و ۵۰۲/۵۰۲ تست سبز در اجرای کامل.

### ۵.۲ شواهد CI (GitHub Actions)

- PR: **#195** — `https://github.com/MR-AliEsmaeili/Vardena/pull/195`
- Workflow Run: **#774** — `https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39778372801`
- کامیت: `1c358b2`
- نتیجهٔ کل: **Success** (مدت ۵m ۵۸s)؛ jobها: `classify`, `docs`, `backend`, `frontend`, `generated-api-client`, `ci-gate` — همه موفق.

stepهای job فرانت‌اند (همه `success`):

```
Cross-project date contract guard
Setup Node.js
Frontend design-token guard      <-- گارد جدید
Upgrade npm to v11
Install dependencies
Lint
Typecheck
Format check
Tests
Build                            <-- ساخت تأیید شد
```

بنابراین تنها بررسی‌ای که محلی ممکن نبود (build) در CI تأیید شده است. `ci-gate` هم که «fail-closed» است، موفق شد؛ یعنی هیچ job لازم دیگری skip/ناموفق نبوده است.

---

## ۶) محدودیت‌ها و آنچه انجام نشد

### ۶.۱ ساخت محلی (`npm run build`) — محدودیت محیطی

خطا:

```
[vite:esbuild-transpile] remove C:\Users\...\Temp\esbuild-<hash>: Access is denied
```

این خطا **مستقل از تغییرات این دور** است: روی یک baseline پاک از `origin/main` (با stash کردن تغییرات و کنار گذاشتن فایل‌های تست جدید) هم بازتولید شد؛ یعنی قفل فایل/آنتی‌ویروس روی پوشهٔ Temp. بنابراین build محلی به‌عنوان شاهد استفاده نشد و **همان بررسی در CI اجرا و سبز شد** (بخش ۵.۲).

### ۶.۲ رنگ خام در صفحه‌های feature

`src/ui/**` و `src/app/**` کامل token-only هستند. صفحه‌های feature هنوز در برخی جاها کلاس پالت خام (`slate-*`, `indigo-*`) دارند، چون برای بعضی سایه‌ها (مثل `slate-400`, `slate-700`, `indigo-500`) توکن هم‌ارز وجود ندارد و ساختن توکن جدید یعنی تغییر تصمیم بصری. مسیر مهاجرت با جدول «مقدار فعلی → توکن هدف» در `docs/frontend/design-system.md` ثبت شده تا در دورهای بعد مکانیکی انجام شود، بدون تغییر ظاهر.

### ۶.۳ آنچه عمداً انجام نشد

- هیچ endpoint، DTO، قرارداد API، migration یا قاعدهٔ کسب‌وکار تغییر نکرد.
- هیچ صفحهٔ MISSING ساخته نشد (نیازمند تصمیم محصولی).
- هیچ کتابخانهٔ جدید یا ارتقای وابستگی اضافه نشد (تنها فونت self-hosted).
- هیچ تست حذف/سست/skip نشد؛ هیچ خطای typecheck یا lint پنهان نشد.

---

## ۷) پرسش‌های باز برای مالک

1. **MISSINGهای پیکربندی:** آیا پیکربندی حساب‌داری، الگوهای دفتر پایه، ساختارهای کدینگ/تفصیلی و انواع سند/سری شماره‌گذاری در محصول مشتری UI می‌خواهند، یا ابزار پیاده‌سازی/مالک هستند؟
2. **درخواست کالا / رزرو / اجرای قیمت‌گذاری:** این سه گروه قرارداد کاملاً بدون UI هستند. اولویت محصولی و دامنهٔ مجوز آن‌ها مشخص شود.
3. **چرخهٔ عمر:** بستن/مهر سال مالی و دورهٔ حسابداری، بازگشت حرکت انبار و ثبت بهای حرکت — آیا در این نسخه لازم‌اند؟
4. **ابزارهای مالک در محصول مشتری:** فعال‌سازی، انتقال مشتری، بازیابی شکاف و کاهش مجوز عمداً UI ندارند؛ تأیید می‌کنید که همین‌طور بماند؟
5. **سیاست فونت:** آیا self-hosting وزیرمتن تأیید می‌شود (بدون CDN، حجم ~۲۰۰KB)؟
6. **سیاست حذف:** در EmptyStateهای مدیریتی، دکمهٔ حذف/غیرفعال‌سازی نمایش داده نمی‌شود چون سیاست حذف داده در محصول روشن نیست.

---

## ۸) وضعیت نهایی

- تغییرات روی شاخهٔ `feat/frontend-ux-completion` است و در PR **#195** باز شده؛ **ادغام خودکار نمی‌شود**.
- typecheck، lint، prettier، ۵۰۲ تست، سه گارد مستندات/تاریخ/طراحی: **همه سبز و اجراشده**.
- `npm run build` محلی به‌دلیل محدودیت محیطی (با اثبات بازتولید روی baseline پاک) اجرا نشد، اما همان step در CI برای همین تغییرات **سبز** است (بخش ۵.۲) — پس این مورد «تأییدنشده» نیست.

**وضعیت: READY FOR REVIEW**
