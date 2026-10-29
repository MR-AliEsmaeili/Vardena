# پنجره‌های فعال محیط کاری (Workspace Windows) — سند پیاده‌سازی

**وضعیت:** APPROVED (design) — تصمیم‌های مالک در ۲۰۲۶-۱۰-۲۶ ثبت شده‌اند. این نسخه، نسخهٔ «استاندارد پیاده‌سازی» است: هر قاعده باید طوری نوشته شده باشد که یک ایجنت بتواند بدون پرسش، پیاده و تست کند. اگر بخشی مبهم مانده، آن را در بخش ۱۴ به‌عنوان Open ثبت کن؛ پیش‌فرض شخصی انتخاب نکن.

**نسخه:** ۰.۳ · **تاریخ:** ۲۰۲۶-۱۰-۲۶

**وابستگی:** [standards.md](../docs/frontend/standards.md) · [layout-and-navigation.md](../docs/frontend/layout-and-navigation.md) · [design-system.md](../docs/frontend/design-system.md) · [ADR-0054](./ADR-0054-multi-window-workspace-dock.md) · [FDR-01](./FDR-01-workspace-windows.md) · [Frontend State-Management Audit](../docs/frontend/architecture/frontend-state-management-audit.md)

**مرجع تصمیم:** [FDR-01](./FDR-01-workspace-windows.md). اگر این سند با ردیف‌های `Confirmed` در FDR-01 تعارض داشت، FDR-01 مرجع است.

---

## ۱) خلاصه

نوار باریک «پنجره‌های فعال» دقیقاً زیر هدر و در ستون محیط کاری قرار می‌گیرد. هر پنجره یک **بستر مسیر مستقل** با state فرم، فیلتر و اسکرول خودش است. پنجره‌های فعال‌شده mount می‌مانند و فقط پنجره فعال دیده می‌شود (keep-alive). جابه‌جایی بین پنجره‌ها، فرم ذخیره‌نشده را از بین نمی‌برد.

- داک در حالت تک‌پنجره هم دیده می‌شود (D-1)؛ سقف ۱۲ پنجره (D-2).
- هر ماژول tone مستقل دارد؛ تخصیص toneها از تنظیمات پروفایل قابل تغییر است (D-3).
- بدون اسکرول افقی؛ با افزایش تعداد، تب‌ها فشرده می‌شوند.
- بستن پنجره dirty فقط با تأیید صریح.
- تغییر سازمان یا زمینه مالی، پنجره‌ها را بازنشانی می‌کند.
- لیست پنجره‌ها پس از refresh بازیابی می‌شود؛ فقط مسیرها، نه محتوای فرم (D-6).
- بدون کتابخانه جدید، بدون global store، بدون وابستگی runtime تازه.

## ۲) سناریوهای پذیرش

هر سناریو مبنای حداقل یک تست در §۱۰ است:

1. **وقفه فوری:** شروع سند حسابداری → رفتن به گزارش → بازگشت → همه فیلدهای سند دست‌نخورده.
2. **چند فرم هم‌زمان:** دو سند جدید با state مستقل.
3. **مقایسه گزارش:** دو نمونه از یک گزارش با فیلترهای متفاوت، با جابه‌جایی سریع.
4. **پنجره تکراری:** باز کردن همان مسیر با فیلتر دیگر، بدون از بین رفتن پنجره قبلی.
5. **بستن کنترل‌شده:** بستن پنجره dirty فقط با تأیید.
6. **تغییر دامنه:** تغییر سازمان/سال مالی پنجره‌های سازمان قبلی را نگه نمی‌دارد.

## ۳) قراردادهای واژگان (فقط این تعریف‌ها)

| واژه                   | تعریف دقیق                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| پنجره (Window)         | بستر کاری مستقل با شناسه runtime.                                                                                 |
| `WindowId`             | خروجی `crypto.randomUUID()`؛ در ذخیره‌سازی فقط با `^[A-Za-z0-9-]{8,64}$` پذیرفته می‌شود.                          |
| داک (Dock)             | نوار تب‌های بالای محیط کاری.                                                                                      |
| پنجره فعال             | تنها پنجره‌ای که در flow عادی رندر می‌شود (`activeId`).                                                           |
| `basePath`             | `location.pathname` بدون `?query` و `#hash`.                                                                      |
| `path`                 | `pathname + search + hash` واقعی.                                                                                 |
| reuse                  | فعال‌سازی پنجره موجود با `basePath` یکسان. دقت: مسیر `/new` هرگز reuse نمی‌شود.                                   |
| پنجره پیش‌نویس         | پنجره‌ای که `basePath` آن به `/new` ختم می‌شود.                                                                   |
| Dirty                  | حداقل یک فرم در پنجره `formState.isDirty === true` دارد.                                                          |
| ماژول (`ModuleId`)     | `'workspace' \| 'accounting' \| 'inventory' \| 'organization' \| 'licensing' \| 'admin'` — همان مقادیر `NavTone`. |
| tone                   | `NavTone` موجود در `ui/nav-glyph.tsx`؛ در لحظه هر tone دقیقاً به یک ماژول اختصاص دارد.                            |
| descriptor بازیابی‌شده | پنجره‌ای که از ذخیره‌سازی خوانده شده و هنوز mount نشده است.                                                       |
| `mounted`              | پرچم runtime (ذخیره نمی‌شود)؛ پس از اولین mount تا `reset()` true می‌ماند.                                        |

## ۴) مشخصات رابط کاربری

### ۴.۱ جایگاه و ابعاد

- داک در ستون محیط کاری، داخل `<main id="main-content">`، بلافاصله زیر `AppHeader` (h-14) و بالای `AppBreadcrumb` است؛ سایدبار تمام‌قد می‌ماند.
- داک `sticky top-14`، `z-20`، `no-print`؛ ارتفاع داک `h-9` (۳۶px) و ارتفاع هر تب `h-7` (۲۸px).
- عرض داک عرض کامل ستون محیط کاری است، نه کل viewport.

### ۴.۲ آناتومی هر تب

| جزء          | مشخص دقیق                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| شعاع         | `--radius-control` (۸px)، نه `--radius-card`.                                                                                                 |
| نوار رنگ     | ۳px در لبه inline-start (راست در RTL)؛ رنگ ماژول: `tone-strong` در تب فعال، همان رنگ با شفافیت کمتر در غیرفعال.                               |
| آیکون        | ۱۴px (`h-3.5 w-3.5`)؛ همان `LucideIcon` آیتم ناوبری؛ در تراکم icon حذف نمی‌شود.                                                               |
| عنوان        | یک خط، `truncate`، متن کامل در `title`؛ حداکثر `14rem` (compact: `10rem`).                                                                    |
| نقطه dirty   | ۶px با رنگ `warn`؛ tooltip «تغییرات ذخیره‌نشده» (`t.workspace.dirtyTooltip`).                                                                 |
| دکمه close   | `<button>` مستقل (نه داخل تب) با رنگ `danger`؛ روی تب فعال همیشه نمایان، روی غیرفعال با hover/focus نمایان ولی فضایش رزرو است تا layout نپرد. |
| حالت فعال    | پس‌زمینه `tone-soft`، کادر `tone-line`، متن `tone-ink`، نوار رنگ `tone-strong`، سایه `shadow-card`.                                           |
| حالت غیرفعال | پس‌زمینه `surface`، کادر `line`، متن `ink-muted`.                                                                                             |
| hover/focus  | `sunken` / حلقه `focus-visible` استاندارد.                                                                                                    |

- هیچ badge عددی روی تب نیست؛ شمارش کل در انتهای داک و در `aria-label` است.
- `data-testid` پایدار برای تست:
  - داک: `data-testid="workspace-dock"`.
  - تب: `data-testid="workspace-tab"` به‌علاوهٔ `data-window-path={basePath}` (لوکیتور معنایی E2E؛ هیچ شمارهٔ ثابتی روی تب نیست چون ترتیب پنجره‌ها ممکن است عوض شود).
  - منوی `…`: `data-testid="workspace-dock-menu"`.
  - محتوای پنجرهٔ فعال: `data-testid="workspace-window"`.

### ۴.۳ رنگ ماژول و شخصی‌سازی (D-3)

رنگ فقط از توکن‌های موجود `--color-tone-*` خوانده می‌شود؛ هیچ hex/rgb در کامپوننت نیست.

هر ماژول یک tone مستقل دارد؛ هیچ دو ماژولی در هیچ زمانی tone یکسان ندارند.

| ماژول            | tone پیش‌فرض   | رنگ                  |
| ---------------- | -------------- | -------------------- |
| میزکار/پروفایل   | `workspace`    | اسلیت (**تأییدشده**) |
| حسابداری         | `accounting`   | نیلی/ایندیگو         |
| انبار            | `inventory`    | سبز زمردی            |
| سازمان           | `organization` | نارنجی               |
| مجوز و دستگاه‌ها | `licensing`    | آبی                  |
| مدیریت سیستم     | `admin`        | صورتی                |

> **تغییر تأییدشده:** در توکن‌های فعلی `workspace` و `accounting` هر دو ایندیگو هستند. طبق D-3 این اشتراک مجاز نیست؛ مقادیر `--color-tone-workspace-{soft,line,ink,strong}` در `frontend/src/styles/index.css` به خانوادهٔ اسلیت تغییر می‌کند (فقط مقدار توکن، بدون تغییر نام توکن) چون همهٔ مصرف‌کننده‌ها از قبل `tone-workspace-*` را می‌خوانند. مقادیر پیشنهادی — light: `soft #f8fafc / line #cbd5e1 / ink #475569 / strong #64748b` · dark: `soft #1e293b / line #475569 / ink #cbd5e1 / strong #94a3b8`. مقادیر نهایی در بازبینی بصری ثابت می‌شوند؛ شرط پذیرش: contrast AA و متمایزبودن از پنج tone دیگر در هر دو تم.

**تخصیص قابل تغییر (D-3):** الگوریتم کامل در §۶.۱۰(ب)؛ رابط کاربری:

- بخش «رنگ ماژول‌ها» در صفحهٔ پروفایل (`/app/profile`) یک شبکهٔ تخصیص است: هر ماژول، یک selector از شش tone؛ هر tone فقط یک بار قابل انتخاب.
- انتخاب toneی که در اختیار ماژول دیگری است، دو ماژول را **جابه‌جا** می‌کند (swap)؛ یکتایی از این مسیر تضمین می‌شود.
- پیش‌نمایش هر انتخاب در `data-theme="light"` و `data-theme="dark"` به‌صورت هم‌زمان؛ contrast AA شرط پذیرش است.
- تخصیص آزاد و رنگ سفارشی (hex) وجود ندارد. نقشهٔ کلاس‌های شمارش‌شده (`NAV_TONE_TILE`) دست‌نخورده می‌ماند و کلاس‌ها هرگز داینامیک ساخته نمی‌شوند (`bg-tone-${tone}` ممنوع).

رنگ هرگز تنها حامل معنا نیست: آیکون + عنوان + tooltip + `aria-label` همیشه وجود دارند (WCAG 1.4.1).

### ۴.۴ تراکم و ریسپانسیو — ماتریس قطعی

ورودی الگوریتم: `N = windows.length` و عرض viewport. خروجی: حالت `full | compact | icon | single`.

| شرط                                   | حالت    | عرض تب                                   | محتوای تب                                                                                           |
| ------------------------------------- | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `N ≤ 5` و viewport ≥ 1280px           | full    | `flex: 1 1 0`، max `14rem`، min `7rem`   | آیکون + عنوان کامل + dirty + close                                                                  |
| `N ≤ 4` و viewport در 1024–1279px     | full    | همان                                     | همان                                                                                                |
| `6 ≤ N ≤ 9` و viewport ≥ 1280px       | compact | `flex: 1 1 0`، max `10rem`، min `5.5rem` | آیکون + عنوان (truncate) + dirty + close                                                            |
| `5 ≤ N ≤ 8` و viewport در 1024–1279px | compact | همان                                     | همان                                                                                                |
| `N ≥ 10` و viewport ≥ 1280px          | icon    | ثابت `2.5rem`                            | آیکون + dirty + close؛ عنوان فقط در tooltip                                                         |
| `N ≥ 9` و viewport در 1024–1279px     | icon    | همان                                     | همان                                                                                                |
| viewport `< 1024px`                   | single  | پنجره فعال + دکمهٔ «N پنجره»             | لیست پنجره‌ها در popover (≥768px) یا bottom sheet (<768px)؛ همهٔ پنجره‌های mount‌شده mount می‌مانند |

- هیچ `overflow-x: auto` در داک؛ فقط `overflow-x: clip`.
- حالت با `matchMedia('(min-width: 1024px)')` و `(min-width: 1280px)` تعیین می‌شود (نه با اندازه‌گیری هر تب)؛ تغییر عرض با `addEventListener('change')` دنبال می‌شود.
- در همهٔ حالت‌ها دکمهٔ `…` (`workspace-dock-menu`) با دو اقدام «مدیریت پنجره‌ها» و «بستن پنجره‌های بدون تغییر» دیده می‌شود.
- داک هرگز اسکرول افقی صفحه نمی‌سازد؛ سنجهٔ E2E: `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
- در حالت `icon`، فضای `2.5rem` باید آیکون + نقطهٔ dirty + close را کامل بگیرد؛ اگر در بازبینی واقعی جا نشد، آن تب به popover منتقل می‌شود — نه حذفِ close، نه کاهش حداقل عرض.
- در حالت `single`، فقط پنجرهٔ فعال «دیده» می‌شود؛ پنجره‌های mount‌شده همچنان mounted و hidden می‌مانند.

### ۴.۵ بازکردن، فعال‌سازی و بستن — قرارداد قطعی

این الگوریتم مرجع است؛ هم reducer و هم UI به آن پایبندند.

**`open(target, { intent = 'auto' }) → OpenResult`**

1. `basePath = new URL(target).pathname`.
2. اگر `intent === 'new'` → برو به مرحلهٔ ۶.
3. اگر `basePath.endsWith('/new')` → برو به مرحلهٔ ۶ (حتی اگر پنجرهٔ پیش‌نویس دیگری با همان مسیر باز است).
4. اگر پنجره‌ای با `basePath` یکسان باز است → فقط `activate(id)` همان؛ `path` آن پنجره عوض نمی‌شود (فیلترهای فعلی حفظ می‌شوند)؛ بازگشت `{ kind: 'reused' }`.
5. اگر `windows.length === 12` → بازگشت `{ kind: 'capped' }`؛ هیچ پنجره‌ای خودکار بسته نمی‌شود؛ UI دیالوگ سقف را نشان می‌دهد: فهرست پنجره‌ها (فعال‌سازی) + «بستن پنجره‌های بدون تغییر» + «انصراف».
6. پنجرهٔ جدید: `id = crypto.randomUUID()`، `basePath`، `path = target`، `dirty = false`؛ انتهای آرایه؛ `activate`؛ بازگشت `{ kind: 'created' }`.

**`activate(id)`**

- ترتیب پنجره‌ها عوض نمی‌شود؛ `activeId = id`؛ اگر `mounted === false`، اولین رندر host آن را mount می‌کند و `markMounted(id)` را می‌فرستد.

**`requestClose(id)` و `close(id)`**

- اگر `dirty === true` → `pendingCloseId = id` و دیالوگ تأیید؛ تأیید → `close(id)`.
- در هر لحظه فقط یک دیالوگ `pendingClose` مجاز است.
- `Escape`، کلیک بیرون دیالوگ، یا فعال‌سازی تب دیگر → `cancelPendingClose`.
- `close(id)`: حذف از `windows`؛ اگر active بود، همسایهٔ بعدی (ترتیب آرایه) فعال؛ اگر آخرین بود، همسایهٔ قبلی؛ اگر فهرست خالی شد، پنجرهٔ میزکار تازه (`/app`) ساخته و فعال می‌شود.

**`closeAllClean()`** («بستن پنجره‌های بدون تغییر»)

- همهٔ پنجره‌های `dirty === false` بسته می‌شوند؛ dirtyها می‌مانند.
- اگر بعد از آن هیچ پنجره‌ای نماند، پنجرهٔ میزکار باز می‌شود.
- هیچ مسیری در این جریان dirty را بدون تأیید خودش نمی‌بندد.

### ۴.۶ اعمال روی اقدام‌های دیگر

| اقدام              | نتیجه                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| deep link          | پنجرهٔ فعال همان مسیر می‌شود؛ پنجرهٔ میزکار قبلی و لیست پنجره‌ها حفظ می‌شوند.                                     |
| تغییر سازمان/زمینه | اگر dirty وجود دارد، تعویض مسدود و دلیلش نمایش داده می‌شود؛ وگرنه `workspace.reset()` و میزکار باز می‌شود (§۶.۸). |
| خروج/انقضای نشست   | کل AppShell unmount؛ `sessionStorage` پاک می‌شود (§۶.۱۰).                                                         |
| refresh            | descriptorها بازیابی؛ پنجرهٔ فعال mount؛ بقیه lazy (§۶.۱۰).                                                       |

### ۴.۷ تغییرات ذخیره‌نشده (Dirty)

- هر فرمی که `formState.isDirty` دارد با `useWorkspaceWindowDirty(isDirty)` وضعیت خود را اعلام می‌کند؛ بیرون از provider no-op است.
- بستن dirty: `ConfirmDialog` با عنوان `t.workspace.dirtyCloseTitle`، پیام `t.workspace.dirtyCloseMessage` و دو اقدام «بازگشت به پنجره» و `danger` «بستن بدون ذخیره»؛ دکمهٔ «ذخیره و بستن» در فاز ۱ وجود ندارد (D-7).
- گاردهای موجود صفحات (`navigateWithDirtyGuard` در `document-form-page` و مشابه‌ها) دست‌نخورده می‌مانند؛ دیالوگ داک مستقل است و فقط از داک یا reset دامنه اجرا می‌شود تا دوبل نشود.
- `beforeunload` موجود فرم‌ها حفظ می‌شود؛ داک سطح دیگری اضافه نمی‌کند.
- شکاف `movement-form-page` و `transfer-form-page`: در فاز ۱ همان دو لایهٔ فرم‌های دیگر نصب می‌شود — `beforeunload` روی `isDirty` + `useWorkspaceWindowDirty(isDirty)`.
- close پنجرهٔ clean بدون تأیید.

### ۴.۸ کیبورد

| میان‌بر                       | عمل                     | ملاحظات                                                                                         |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `Alt+W`                       | بستن پنجرهٔ فعال        | با قاعدهٔ dirty؛ `preventDefault`؛ اگر فوکوس در `input/textarea/[contenteditable]` است، نادیده. |
| `Alt+ArrowRight/ArrowLeft`    | پنجرهٔ قبلی/بعدی        | در RTL: راست = قبلی، چپ = بعدی؛ با یک پنجره no-op.                                              |
| `Alt+1..9`                    | پرش به پنجرهٔ n         | اگر `n > N`، no-op.                                                                             |
| `ArrowRight/Left`, `Home/End` | roving focus در tablist | الگوی WAI-ARIA Tabs.                                                                            |
| `Enter` / `Space` روی تب      | فعال‌سازی               | —                                                                                               |
| `Ctrl/Cmd+K` (موجود)          | جست‌وجوی سراسری         | Enter روی نتیجه → `open(..., { intent: 'new' })`.                                               |
| `Alt+N` (موجود)               | سند جدید                | باید پنجرهٔ جدید بسازد.                                                                         |
| `Ctrl+S` (موجود)              | ذخیرهٔ فرم              | فقط پنجرهٔ فعال.                                                                                |
| `Escape`                      | بستن دیالوگ/منو         | هرگز پنجره نمی‌بندد؛ `pendingClose` را لغو می‌کند.                                              |

- در فاز ۱ یک handler محدود (`workspace-shortcuts.ts`) در سطح `AppShell` کافی است؛ رجیستری سراسری میان‌برها هنوز وجود ندارد و ساخته نمی‌شود.

### ۴.۹ انیمیشن

- ورود تب: `animate-rise-in` (~۱۸۰ms)؛ جابه‌جایی محتوا: `animate-fade-in` (~۱۲۰ms)؛ بدون slide افقی.
- بستن تب: fade/scale کوتاه (~۱۲۰ms)؛ ساده‌سازی حذف فوری مجاز.
- همهٔ انیمیشن‌ها در `prefers-reduced-motion: reduce` متوقف‌اند؛ هیچ انیمیشن تزئینی جدید.

### ۴.۱۰ چاپ

- داک `no-print`؛ پنجره‌های غیرفعال `display:none`؛ فقط محتوای پنجرهٔ فعال چاپ می‌شود.
- `printCurrentSurface` بدون تغییر کار می‌کند.

## ۵) قواعد رفتاری (W) — جدول مرجع تست‌پذیر

| شناسه | قاعده (به‌صورت رفتار قابل مشاهده)                                                       | دلیل                             |
| ----- | --------------------------------------------------------------------------------------- | -------------------------------- |
| W-01  | هر پنجره مسیر و history مستقل دارد.                                                     | حفظ state.                       |
| W-02  | فقط پنجرهٔ فعال در flow عادی دیده می‌شود؛ بقیه `hidden` + `inert` + `aria-hidden`.      | جلوگیری از Tab به محتوای مخفی.   |
| W-03  | reuse فقط بر اساس `pathname`؛ `/new` همیشه پنجرهٔ جدید.                                 | جلوگیری از گم‌شدن پیش‌نویس.      |
| W-04  | Ctrl/Cmd+click و کلیک میانی = پنجرهٔ جدید.                                              | کار موازی.                       |
| W-05  | بستن dirty فقط با تأیید.                                                                | جلوگیری از از دست رفتن داده.     |
| W-06  | تغییر سازمان/زمینه مالی = `workspace.reset()`.                                          | مرز سازمانی.                     |
| W-07  | URL مرورگر فقط آینهٔ پنجرهٔ فعال است (`replace`).                                       | refresh/deep-link قابل پیش‌بینی. |
| W-08  | هیچ محتوای فرم/پیش‌نویس/دادهٔ کسب‌وکار/توکن در مرورگر ذخیره نمی‌شود؛ فقط دو کلید §۶.۱۰. | standards §15.                   |
| W-09  | داک هیچ اسکرول افقی ندارد.                                                              | الزام مالک.                      |
| W-10  | رنگ فقط از توکن `--color-tone-*`؛ هر ماژول tone مستقل.                                  | standards §6 و D-3.              |
| W-11  | پنجره‌ها از Query cache مشترک استفاده می‌کنند.                                          | standards §5 و audit.            |
| W-12  | سقف ۱۲؛ dirty هرگز خودکار بسته نمی‌شود.                                                 | کنترل حافظه/داده.                |
| W-13  | چاپ فقط پنجرهٔ فعال.                                                                    | `@media print` موجود.            |
| W-14  | هر پنجره ErrorBoundary مستقل دارد.                                                      | عایق crash.                      |
| W-15  | پس از refresh، لیست و پنجرهٔ فعال بازیابی می‌شوند؛ فقط مسیر.                            | D-6.                             |
| W-16  | پنجره‌های بازیابی‌شده تا اولین فعال‌سازی mount نمی‌شوند.                                | جلوگیری از انفجار mount/query.   |
| W-17  | تخصیص tone جابه‌جایی است، نه انتخاب آزاد؛ یکتایی تضمین‌شده.                             | D-3.                             |

## ۶) معماری و قراردادهای کد

### ۶.۱ چرا تبِ ساده کافی نیست

تب ساده‌ای که فقط URL را عوض می‌کند، فرم را unmount می‌کند و state محلی از بین می‌رود. ذخیرهٔ پیش‌نویس در مرورگر بدون قرارداد بک‌اند مجاز نیست. پس پنجره‌ها باید mounted بمانند.

### ۶.۲ چرا MemoryRouter در هر پنجره

- هر پنجره به `useNavigate`/`useParams`/`useSearchParams` مستقل نیاز دارد؛ `MemoryRouter` این را بدون تغییر صفحات فراهم می‌کند.
- لینک‌ها مطلق `/app/...` داخل هر پنجره درست کار می‌کنند؛ browser URL با `replace` آینهٔ پنجرهٔ فعال می‌ماند.
- `iframe` رد می‌شود: هزینه، auth، دسترس‌پذیری.
- چند `<Routes>` با `location` جدا روی یک Router کافی نیست، چون `useNavigate` همهٔ صفحات به روتر سراسری وصل می‌شود و تاریخچهٔ پنجره‌ها گم می‌شود.
- **محدودیت پذیرفته‌شدهٔ فاز ۱:** Back مرورگر تاریخچه درون‌پنجره را طی نمی‌کند (فاز ۳).

### ۶.۳ درخت مسیر مشترک

وضعیت فعلی: `frontend/src/app/router.tsx` تمام صفحات را import و زیر `<Route path="/app" element={<AppShell />}>` تعریف کرده است.

هدف: تمام این زیردرخت به `frontend/src/app/routes/workspace-route-tree.tsx` منتقل می‌شود:

```tsx
// workspace-route-tree.tsx — کل زیردرخت /app، عیناً از router.tsx منتقل‌شده
export function WorkspaceRouteTree() {
  return (
    <>
      <Route index element={<DashboardRoute />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="accounting">…</Route>
      <Route path="organization">…</Route>
      <Route path="inventory">…</Route>
      <Route path="licensing/devices">…</Route>
      <Route path="admin">…</Route>
      <Route path="*" element={<NotFoundPage />} />
    </>
  );
}
```

و `router.tsx` فقط شکل زیر را نگه می‌دارد:

```tsx
<Route element={<RequireAuth />}>
  <Route path="/app" element={<AppShell />}>
    <WorkspaceRouteTree />
  </Route>
</Route>
```

شکل سلسله‌مراتبی کامل:

```
AppRoutes
  /login, /change-password
  RequireAuth
    /app → AppShell
             WorkspaceProvider (یک بار، بعد از همهٔ gates)
               AppHeader · AppSidebar · Dock
               AppBreadcrumb
               WorkspaceWindowHost     ← جای <Outlet />
                 per window (mounted):
                   MemoryRouter(initialEntries=[path])
                     WorkspaceErrorBoundary
                       WindowLocationReporter
                       <Routes><Route path="/app"><WorkspaceRouteTree /></Route></Routes>
                 per window (restored, not mounted):
                   <div data-window-slot data-window-path=… />
```

**قواعد روشن درخت مشترک (همه قابل تست):**

| شناسه | قاعده                                                                                          | تست                        |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| a     | هیچ Route از `workspace-route-tree` خارج نمی‌شود؛ router.tsx فقط پوستهٔ `/app` را نگه می‌دارد. | parity test §۱۰.۳          |
| b     | `RequireAuth` بیرون درخت می‌ماند.                                                              | parity + تست RequireAuth   |
| c     | همهٔ `RequirePermission`ها دست‌نخورده داخل درخت می‌مانند.                                      | parity + تست‌های 403 موجود |
| d     | مسیر `*` (404) در پنجره هم کار می‌کند.                                                         | تست مستقیم                 |
| e     | مسیرهای پویا (`:id`, `new`, `edit`) همان فعلی‌اند.                                             | parity                     |

### ۶.۴ مدل state و قرارداد reducer — `workspace-reducer.ts`

```ts
export type WindowId = string; // برند داخلی؛ خروجی crypto.randomUUID()

export interface WorkspaceWindow {
  id: WindowId;
  basePath: string; // pathname؛ مبنای reuse
  path: string; // pathname + search + hash
  dirty: boolean; // فقط runtime
  mounted: boolean; // فقط runtime؛ ذخیره نمی‌شود
  titleOverride: string | null;
}

export interface WorkspaceState {
  windows: WorkspaceWindow[]; // ترتیب این آرایه = ترتیب داک
  activeId: WindowId | null;
  pendingCloseId: WindowId | null;
}

export const MAX_WINDOWS = 12;

// اقدام‌ها
restore |
  open |
  activate |
  markMounted |
  setPath |
  setDirty |
  setTitle |
  requestClose |
  cancelPendingClose |
  close |
  closeAllClean |
  reset;
```

**قاعده‌های ثابت reducer (هر ردیف یک تست واحد دارد):**

| #   | قاعدهٔ ثابت                                                                                                 | ناقض → نتیجه                                   |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| ۱   | `windows.length ≤ 12` همیشه.                                                                                | بازگشت `capped`؛ هرگز exception پرتاب نمی‌شود. |
| ۲   | reuse فقط وقتی مجاز است که `basePath` هیچ‌وقت به `/new` ختم نشود؛ مسیر `/new` همیشه پنجرهٔ جدید است (W-03). | خطای تست واحد یعنی قاعدهٔ W-03 نقض شده.        |
| ۳   | `dirty` و `mounted` فقط runtime؛ هرگز در descriptor بازیابی یا در persistence نیست.                         | تست persistence: فیلد اضافه وجود ندارد.        |
| ۴   | `title`/`tone`/`icon` در state ذخیره نمی‌شوند؛ از `resolveWindowMeta` مشتق می‌شوند.                         |
| ۵   | هیچ دادهٔ API، فرم، token، سازمان یا تاریخ در state نیست.                                                   |
| ۶   | پس از `restore`: همهٔ `mounted=false`، `dirty=false`، `activeId = snapshot.activeId`.                       |
| ۷   | پس از `reset`: فقط یک پنجرهٔ میزکار تازه؛ `pendingCloseId = null`.                                          |
| ۸   | پس از `close`: اگر `windows` خالی شد، یک پنجرهٔ میزکار تازه ساخته و فعال می‌شود.                            |

**پوشش تست هر اقدام (واحد، در §۱۰.۲):** `open` (auto/new/draft/existing/capped)؛ `activate`؛ `markMounted`؛ `setDirty`؛ `setTitle override`؛ `requestClose` (dirty/clean)؛ `cancelPendingClose`؛ `close` (active/آخرین/غیر active/خالی)؛ `setPath`؛ `reset`؛ `restore` (معتبر/نامعتبر).

### ۶.۵ Provider، host، URL sync و اسکرول

**`WorkspaceProvider`** در سطح `AppShell` و زیر گیت‌های موجود (`OrganizationGate`، `FinancialContextGate`) قرار می‌گیرد تا context به یک منبع وصل بماند؛ و در درخت رندر **بالای** Header/Sidebar/Dock/Host.

API عمومی hookها:

```ts
useWorkspace(): WorkspaceApi           // open(target, intent?) · activate · requestClose · close · closeAllClean · state
useWorkspaceWindow(): WindowRuntime    // { id, basePath, path, dirty } — فقط داخل host
useWorkspaceWindowDirty(isDirty: boolean): void   // بیرون provider → no-op
useWorkspaceWindowTitle(title: string): void      // بیرون provider → no-op
```

**`WorkspaceWindowHost`** در جای `<Outlet />` فعلی:

```tsx
// فقط پنجره‌های mounted واقعاً render می‌شوند؛ بعدی (restore) با slot خالی.
windows
  .filter((w) => w.mounted)
  .map((w) => (
    <section
      key={w.id}
      role="tabpanel"
      id={`workspace-panel-${w.id}`}
      aria-labelledby={`workspace-tab-${w.id}`}
      hidden={w.id !== activeId}
      inert={w.id !== activeId}
      aria-hidden={w.id !== activeId}
      data-testid="workspace-window"
      data-window-path={w.basePath}
    >
      <WorkspaceErrorBoundary id={w.id}>
        <MemoryRouter initialEntries={[w.mountPath ?? w.path]}>
          <WindowLocationReporter windowId={w.id} />
          <Routes>
            <Route path="/app">
              <WorkspaceRouteTree />
            </Route>
          </Routes>
        </MemoryRouter>
      </WorkspaceErrorBoundary>
    </section>
  ));
```

- **`mountPath`:** اگر پنجره در session جاری mount شده بود، مسیر همان لحظهٔ mount نگه داشته می‌شود؛ مسیرهای بعدیِ همان پنجره با `WindowLocationReporter` داخلی حرکت می‌کنند و state MemoryRouter حفظ می‌شود (Keep-alive). اگر پنجره بازیابی‌شده باشد، `mountPath` هنوز تعریف نشده است؛ پس host موقتاً `data-window-slot` نشان می‌دهد و فعال‌سازی اول آن را با `w.path` mount می‌کند.
- **پنجرهٔ غیرفعال:** `hidden` + `inert` + `aria-hidden="true"`؛ focus هرگز وارد آن نمی‌شود.
- **`WindowLocationReporter`:** `useLocation()` در effect؛ تفاوت با مسیر قبلی خودش → dispatch `setPath`. فقط پنجرهٔ فعال، URL مرورگر را با `navigate(..., { replace: true })` همگام می‌کند؛ حلقهٔ بازخورد قهقرایی با یک `lastSyncedRef` قطع می‌شود (هر تغییر URL که خودِ sync داشتی، در ref ثبت می‌شود و دوباره در sync دست نمی‌زند).
- **اسکرول:** `Map<WindowId, number>` از `document.scrollingElement.scrollTop` (runtime). پیش از تغییر `activeId` ذخیره؛ پس از فعال‌سازی، در یک `requestAnimationFrame` بازگردان می‌شود؛ برای پنجره‌های بازیابی‌شده no-op.
- **انیمیشن ورود/بستن:** فقط روی تب داک اعمال می‌شود، نه روی همان `<section>` پنجره.

### ۶.۶ meta هر پنجره — `workspace-meta.ts`

`resolveWindowMeta(pathname, search) → { module, title, tone, icon }`

| قدم | قاعده                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ۱   | `module`: سگمنت اول بعد از `/app`؛ اگر خالی یا ناشناخته → `'workspace'`.                                                                                                     |
| ۲   | `icon` و `label` پایه: از `navigationSections` همان ماژول — یا آیتمی که `item.to === pathname` است، یا طولانی‌ترین آیتمی که `pathname.startsWith(item.to)`؛ وگرنه label بخش. |
| ۳   | پسوند پویا: آخرین سگمنت `new` → ` draftSuffix`; مسیر `/edit` → ` editSuffix`; `:id` → ` idSuffix(id کوتاه‌شده: ۶ کاراکتر آخر یا شناسهٔ خوانا).                               |
| ۴   | پسوند query شناخته‌شده: `kind=receipt                                                                                                                                        | issue | transfer`و`type=receipt | issue` → عنوان با پسوند مصوب؛ query ناشناخته در عنوان نمی‌آید. |
| ۵   | fallback: label بخش + آخرین سگمنت؛ هرگز عنوان خالی یا انگلیسی خام.                                                                                                           |
| ۶   | کلاس tone و icon در render خوانده می‌شوند؛ نه در state.                                                                                                                      |

`useWorkspaceWindowTitle(title)` فقط `titleOverride` همان پنجره را عوض می‌کند؛ بیرون provider no-op است تا تست ایزوله صفحات نشکند._override فقط عنوان تب نشان‌داده‌شده را عوض می‌کند؛ meta و tone را عوض نمی‌کند.

کلیدهای i18n که باید ساخته شوند (`t.workspace.*`) — همهٔ مقدارها در `lib/i18n.ts` فارسی می‌مانند:

| کلید‌ها                                                                    | مقدار (فارسی)                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------- |
| `dirtyTooltipTitle`                                                        | تغییرات ذخیره‌نشده                                        |
| `dirtyCloseTitle`, `dirtyCloseMessage`, `backToWindow`, `closeWithoutSave` | متن دیالوگ بستن dirty                                     |
| `draftSuffix`, `editSuffix`, `idSuffix`                                    | پسوندها (`… جدید`، `ویرایش …`، `(#…)` — ۶ کاراکتر آخر id) |
| `querySuffix.kind.receipt`, `…kind.issue`, `…kind.transfer`                | دریافت، پرداخت، حواله                                     |
| `querySuffix.type.receipt`, `…type.issue`                                  | رسید، خروج                                                |
| `windowListLabel`, `manageWindows`                                         | «فهرست پنجره‌ها»، «مدیریت پنجره‌ها»                       |
| `windowCount`                                                              | «N پنجره» (عدد فارسی)                                     |
| `capDialogTitle`, `capDialogBody`                                          | متن دیالوگ سقف                                            |
| `closeAllClean`                                                            | بستن پنجره‌های بدون تغییر                                 |
| `panelErrorTitle`, `retryPanel`, `closePanel`                              | متن ErrorBoundary                                         |

### ۶.۷ اتصال ناوبری

| ناوبری فعلی                                                  | تغییر در فاز ۱                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app-sidebar.tsx` — `NavLink` به مسیرها                      | همان `path` با `open(to)`؛ فعال‌سازی تب موجود با `basePath` مشترک؛ `NavLink` به عنصر فعال داک تبدیل می‌شود (`aria-current` حفظ)؛ permission و glyph و همان tooltip بدون تغییر. |
| `app-header.tsx` — Search (Ctrl+K Enter)                     | نتیجه روی Enter با `open(..., {intent: 'new'})`.                                                                                                                               |
| `app-header.tsx` — OrganizationSwitcher & Financial(Context) | مجاز به تعویض فقط اگر هیچ dirty؛ وگرنه `disabled` + tooltip دلیل (§۶.۸).                                                                                                       |
| کارت میزکار و لینک‌های «new»                                 | `open(to)`؛ مقصد `/new` همیشه پنجرهٔ جدید؛ ناوبری عادی reuse.                                                                                                                  |
| لینک‌های درون‌صفحه                                           | بدون تغییر؛ درون همان پنجره جلو می‌روند.                                                                                                                                       |
| breadcrumb صفحه‌ای                                           | حذف شد (۲۰۲۶-۱۰-۲۹): نوار پنجره‌های فعال نام صفحه را می‌گوید و هر فرم/جزئیات سربرگ فشردهٔ خودش (`FormPageHeader`) را دارد؛ محتوا مستقیماً زیر داک شروع می‌شود.                                                                                                                     |

اثر سایدبار: `AppSidebar` فقط با `WorkspaceNavLink` رندر می‌شود که `workspace.open(to)` را صدا می‌زند؛ `to` همان مسیر می‌ماند؛ `end` و active detection از `useLocation` (URL مرورگر) به‌عنوان آینهٔ پنجرهٔ فعال ادامه می‌یابد؛ permission فیلتر آیتم‌ها بدون تغییر از `visibleNavigationSections` می‌آید.

### ۶.۸ مرزهای امنیتی و دامنه

- تغییر `organizationId` یا زمینهٔ مالی → `workspace.reset()`؛ queryهای سازمان قبلی با `queryClient.removeQueries` (طبق الگوی موجود standards) خالی می‌شوند؛ `sessionStorage` بازنویسی می‌شود (§۶.۱۰).
- **آستانهٔ dirty:** تعویض سازمان/زمینه مالی وقتی پنجرهٔ dirty باز است مسدود می‌شود — Switcher هدر `disabled` + tooltip دلیل؛ پس از ذخیره/بستن dirtyها آزاد می‌شود.
- `RequirePermission`ها بعد از reset دوباره ارزیابی می‌شوند؛ پنجرهٔ بازیابی‌شدهٔ بدون مجوز → 403 استاندارد (AR-21؛ UI مرجع نیست).
- خروج/انقضای نشست → unmount کامل AppShell؛ `sessionStorage.removeItem(KEY)`.
- هیچ state پنجره‌ای متعلق به سازمان قبلی باقی نمی‌ماند؛ هیچ درخواستی با شناسهٔ سازمان قبلی پس از reset ارسال نمی‌شود (assert در تست reset).

### ۶.۹ Query و کارایی

- پنجره‌ها در query cache مشترک‌اند؛ کپی server state ساخته نمی‌شود (W-11).
- query پنجره‌های مخفی در فاز ۱ فعال می‌ماند؛ سقف ۱۲ بودجه را می‌بندد. در فاز ۳ `WindowActivityContext` برای queryهای سنگین بررسی می‌شود (D-10).
- `refetchOnWindowFocus` خاموش (استاندارد)؛ فعال‌سازی پنجره refetch نمی‌زند.
- بودجه: جابه‌جایی پنجره < ۱۰۰ms حس‌شده؛ هر پنجره lazy chunks از route splitting موجود؛ در جابه‌جایی هیچ refetch یا dispatch اضافه‌ای رخ نمی‌دهد.

### ۶.۱۰ پایدارسازی (D-6، D-3) — دو کلید تنها

پیش‌نویس، محتوای فرم و دادهٔ کسب‌وکار در هیچ حافظهٔ مرورگر ذخیره نمی‌شوند؛ فقط دو رکورد نسخه‌دار:

#### الف) لیست پنجره‌ها — `sessionStorage`، کلید `vardena:workspace:v1`

```ts
interface StoredWorkspace {
  version: 1;
  windows: { id: string; basePath: string; path: string }[];
  activeId: string;
}
```

**اعتبارسنجی (هر قاعده یک تست واحد):**

| قاعده                                                    | رفتار (fail closed)     |
| -------------------------------------------------------- | ----------------------- |
| `getItem` absent یا `JSON.parse` خطا                     | میزکار تازه             |
| `version !== 1` (نسخهٔ ناشناخته)                         | ignore                  |
| `windows` آرایه نیست، خالی است، یا طولش بیشتر از ۱۲ است  | میزکار تازه             |
| هر `id` با الگوی `^[A-Za-z0-9-]{8,64}$` نمی‌سازد         | حذف همان عضو            |
| id تکراری                                                | حذف عضو تکراری          |
| `basePath` یا `path` رشته نیست یا با `/app` شروع نمی‌شود | حذف همان عضو            |
| `activeId` جزو idهای باقی‌مانده نیست                     | اولین پنجرهٔ باقی‌مانده |
| نتیجهٔ نهایی خالی                                        | میزکار تازه             |

- **نوشتن:** debounce با `requestIdleCallback` (fallback `setTimeout(…, 0)`)، داخل `try/catch`. خطای quota یا private-mode بلعیده می‌شود و صفحه خراب نمی‌شود (الگوی `appearance.ts`).

- **پاک‌سازی:** خروج/انقضای نشست کلید را حذف می‌کند؛ `reset` سازمان/زمینه بازنویسی می‌کند؛ «بستن همه» در نتیجهٔ فقط میزکار state را می‌نویسد.

#### ب) ترجیح tone ماژول‌ها — `localStorage`، کلید `vardena:module-tones:v1`

```ts
type ModuleToneMap = Record<ModuleId, NavTone>; // ۶ جفت؛ دقیقاً بی‌تکرار
```

| قاعده                                                      | رفتار (fail closed)            |
| ---------------------------------------------------------- | ------------------------------ |
| `version !== 1` یا JSON خراب                               | پیش‌فرض‌ها                     |
| هر `module` خارج از شش مجاز یا هر `tone` خارج از allowlist | پیش‌فرض‌ها (کل رکورد، نه جزئی) |
| tones تکراری (دو ماژول با tone یکسان)                      | پیش‌فرض‌ها (کل رکورد)          |
| ناقص (نه دقیقاً شش کلید)                                   | پیش‌فرض‌ها                     |

اعمال در runtime (`applyModuleTones`) با `var()` indirection — تأثیر در هر دو تم، بدون hex در JS:

```ts
for (const [module, tone] of Object.entries(map)) {
  for (const part of ["soft", "line", "ink", "strong"]) {
    if (tone === module) {
      root.style.removeProperty(`--color-tone-${module}-${part}`);
    } else {
      root.style.setProperty(
        `--color-tone-${module}-${part}`,
        `var(--color-tone-${tone}-${part})`,
      );
    }
  }
}
```

- **pre-paint:** یک اسکریپت inline در `index.html` همین نگاشت را با نسخهٔ ساده‌شده اعمال می‌کند تا هرگز پرش رنگ بین اولین رندر و hydrate رخ ندهد (همان الگوی `vardena:appearance:v1`).
- تنظیم UI در `/app/profile`: یک شبکهٔ تخصیص؛ انتخاب toneی در اختیار ماژول دیگر → swap؛ دکمهٔ «بازگشت به پیش‌فرض» هم هست.
- پرسش باز Q-1 در FDR-01: اگر همگام‌سازی چنددستگاهی خواسته شود، این کلید حذف و ترجیح از طریق ADR-0013 (`customization.user_preferences`، دسته `ui.theme`) ذخیره می‌شود؛ در آن حالت نسخهٔ device-local ساخته نمی‌شود.

### ۶.۱۱ عایق خطا (Error isolation)

- هر پنجرهٔ mount‌شده داخل `WorkspaceErrorBoundary` خودش است: crash یک صفحه فقط همان پنجره را می‌اندازد؛ دکمه‌های «بستن پنجره» و «تلاش دوباره» (re-mount فقط همان پنجره).
- پیام خطا از i18n با کلیدهای §۶.۶ می‌آید؛ هیچ stack trace خام به کاربر نشان داده نمی‌شود.

## ۷) دسترس‌پذیری

- `role="tablist"` با `aria-label="پنجره‌های فعال"`؛ هر تب `role="tab"` با `aria-selected`, `aria-controls`, roving `tabIndex`.
- close یک `<button>` جدا با `aria-label="بستن پنجره {title}"`.
- محتوای فعال `role="tabpanel"` با `aria-labelledby` تب متناظر.
- پنجره‌های مخفی: `inert` + `aria-hidden="true"`.
- وقتی پنجرهٔ فعال بسته می‌شود، فوکوس به تب همسایه یا دکمهٔ `…` برمی‌گردد؛ هیچ فوکوسی گم نمی‌شود.
- `aria-live="polite"` برای اعلان تغییر پنجرهٔ فعال؛ نه اعلان هر کلیک.
- contrast AA برای متن روی tone-soft و آیکون قرمز روی سطح (هر دو تم).
- `aria-keyshortcuts="Alt+W"`؛ reduced-motion؛ رنگ تنها نشانهٔ ماژول نیست.

## ۸) نقشهٔ فایل‌ها (فاز ۱)

پیشوند دوم: `frontend/src/app/workspace/` — هر فایل یک مسئولیت دارد؛ تست‌ها هم‌جای خودشان.

| فایل                                                          | مسئولیت                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `workspace-reducer.ts` + `.test.ts`                           | state، اقدام‌ها، MAX_WINDOWS؛ تست همهٔ اقدام‌ها و نقض‌های ناپذیرش.   |
| `workspace-context.tsx` + `.test.tsx`                         | WorkspaceProvider + hookها؛ بیرون provider no-op.                    |
| `workspace-meta.ts` + `.test.ts`                              | resolveWindowMeta و moduleOfPath؛ جدول §۶.۶ به‌عنوان تست.            |
| `workspace-persistence.ts` + `.test.ts`                       | خواندن/نوشتن/اعتبارسنجی دو کلید؛ throttle/idle write.                |
| `workspace-host.tsx` + `.test.tsx`                            | MemoryRouter per window، hidden/inert، lazy mount، reporter، scroll. |
| `workspace-url-sync.test.tsx`                                 | no-loop URL sync.                                                    |
| `workspace-scroll.test.ts`                                    | ذخیره/بازگردانی اسکرول هر پنجره.                                     |
| `workspace-dock.tsx` + `.test.tsx` + tabs patterns            | داک و pattern presentational؛ تراکم و aria.                          |
| `workspace-dirty.test.ts`                                     | dirty registry؛ no-op بیرون provider؛ بستن شکاف movement/transfer.   |
| `workspace-shortcuts.ts` + `.test.ts`                         | `Alt+*` با skip روی text inputs.                                     |
| `workspace-error-boundary.tsx` + test                         | عایق crash.                                                          |
| `workspace-windows.test.tsx`                                  | سناریوهای پذیرش §۲ در سطح Application.                               |
| `routes/workspace-route-tree.tsx` + `.test.tsx`               | درخت مشترک؛ parity test.                                             |
| `router.tsx`                                                  | فقط `<Route path="/app" element={<AppShell />}>`.                    |
| `layouts/app-shell.tsx`                                       | Provider + Dock + Host + shortcuts.                                  |
| `layouts/app-sidebar.tsx`, `app-header.tsx`                   | تبدیل navigate به open()؛ نتایج جست‌وجو در پنجرهٔ جدید.              |
| `lib/module-tones.ts` + `.test.ts`, `module-tones-storage.ts` | شبکهٔ تخصیص، اعمال، کلید نسخه‌دار.                                   |
| `styles/index.css`                                            | tone اسلیت workspace.                                                |
| `index.html`                                                  | اسکریپت pre-paint برای module tones.                                 |
| `features/auth/profile-page.tsx`                              | بخش «رنگ ماژول‌ها».                                                  |
| `lib/i18n.ts`                                                 | کلیدهای §۶.۶.                                                        |
| `frontend/e2e/workspace-windows.spec.ts`                      | سناریوهای E2E.                                                       |

فایل‌های ممنوع: هیچ global store، هیچ کتابخانهٔ جدید، و هیچ تغییر contract بک‌اند.

## ۹) فازها و معیار خروج

هر فاز مستقل و باید خودش سبز باشد؛ معیار خروج هر فاز دو چیز است: (a) گیت‌های سبز §۱۰.۱، (b) ردیف «DoD» همین فاز.

| فاز | محتوا                                               | DoD                                                                                               |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ۱A  | استخراج درخت مسیر + Provider + Host تک‌پنجره        | parity سبز؛ تست‌های موجود صفحات سبز؛ URL sync بدون حلقه؛ رفتار فعلی فقط با یک پنجره               |
| ۱B  | داک: تب‌ها، tone، فشرده‌سازی، انیمیشن، کیبورد، a11y | ماتریس §۴.۴ با N=1,5,6,9,10,12 سبز؛ aria §۷ سبز؛ شواهد تصویری full/compact/icon                   |
| ۱C  | اتصال سایدبار/جست‌وجو/کارت‌ها + عنوان پویا          | سناریو ۲، ۳، ۴ سبز؛ در جست‌وجو Enter در پنجرهٔ جدید؛ عنوان پویا برای draft/edit/id/query          |
| ۱D  | dirty registry، close guard، reset دامنه            | سناریو ۵، ۶ سبز؛ دیالوگ dirty؛ صفحات فهرست §۴.۷ dirty را ثبت می‌کنند؛ شکاف movement/transfer بسته |
| ۱E  | بازیابی لیست پس از refresh                          | تمام قاعده‌های §۶.۱۰(الف) به‌عنوان تست؛ lazy mount؛ پاک‌سازی در logout/reset                      |
| ۱F  | tone اسلیت workspace + بخش رنگ ماژول‌ها در پروفایل  | قاعده‌های §۶.۱۰(ب) سبز؛ پیش‌نمایش دو تم؛ swap؛ مقدار خراب → پیش‌فرض؛ pre-paint                    |
| ۱G  | ErrorBoundary + E2E + همگام‌سازی مستندات            | crash فقط پنجرهٔ خودش؛ `e2e/workspace-windows.spec.ts` سبز؛ ارجاع‌های docs/ به‌روز                |
| ۲   | Split دو پنجره + مقایسه                             | ADR جدید برای state چیدمان؛ پاسخ Q-2                                                              |
| ۳   | browser history، pause query، recent closed         | اندازه‌گیری < ۱۰۰ms؛ بودجهٔ query اندازه‌گیری و نشان مالک؛ بستن Q-3                               |
| ۴   | ترجیحات بک‌اند طبق ADR-0013 (در صورت Q-1)           | مهاجرت گروهی از کلید محلی؛ کلید محلی حذف می‌شود، نه رها می‌شود                                    |

**قاعدهٔ عبور فاز:** اگر ردیف DoD فازی فعلی سبز نیست، فاز جلوتر شروع نمی‌شود؛ فازها مستقل از هم مستند می‌شوند.

## ۱۰) برنامهٔ تست

### ۱۰.۱ گیت‌های سبز (شرط هر فاز)

- `typecheck + lint + test + build` سبز (همان گیت‌های CI).
- `node scripts/check-frontend-design-tokens.mjs` سبز.
- بدون hex/rgb در `.ts/.tsx`؛ بدون متن فارسی inline در JSX؛ بدون `any` جدید؛ بدون وابستگی جدید.
- `data-testid`ها دقیقاً با نام‌های §۴.۲: `workspace-dock`، `workspace-tab`، `workspace-window`، `workspace-dock-menu`.

### ۱۰.۲ تست واحد (Vitest، بدون DOM واقعی)

| فایل                            | پوشش لازم                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-reducer.test.ts`     | همهٔ اقدام‌های §۶.۴؛ cap؛ `/new`؛ dedupe؛ close روی active/آخرین/غیر active؛ requestClose dirty؛ cancelPending؛ reset؛ restore (معتبر + قاعده‌های نامعتبر §۶.۱۰) |
| `workspace-meta.test.ts`        | جدول §۶.۶ به‌صورت موارد تست؛ هر ماژول؛ draft/edit/id؛ query پسوندها؛ fallback                                                                                    |
| `workspace-persistence.test.ts` | قاعده‌های §۶.۱۰ با storage تقلبی؛ debounce idempotent؛ خطا ننوشتن در حالت exception                                                                              |
| `module-tones.test.ts`          | پیش‌فرض؛ تکراری؛ خارج از allowlist؛ ناقص → بازگشت کامل؛ `setProperty/removeProperty` روی root style                                                              |

باقی: `workspace-shortcuts.test.ts` (skip روی inputs؛ preventDefault؛ no-op n خارج از فهرست)، `workspace-scroll.test.ts` (store/restore)، `workspace-url-sync.test.tsx` (no-loop).

### ۱۰.۳ تست parity درخت مسیر

`routes/workspace-route-tree.test.tsx` شامل یک جدول `APP_ROUTE_SAMPLES` (~۳۰ مسیر؛ پوشش همهٔ ماژول‌ها + پویا + `/new` + `:id` + `edit` + 403‌ها):

- هر مسیر: `matchRoutes` روی درخت جدید باید همان کامپوننت و همان سطح گیت (عمق مسیر، `RequirePermission`ها) را برگرداند؛ هیچ مسیری missing نمی‌شود و هیچ مسیر تازه‌ای اضافه نمی‌شود.
- مسیرهای موجود در تست‌های صفحه‌ای فعلی باید بدون تغییر سبز بمانند؛ هر شکست یعنی تغییر مسیر ناخواسته است و باید بررسی شود.

### ۱۰.۴ تست integration (Testing Library + MemoryRouter wrappers)

برای هر سناریو §۲ یک تست: (۱) وقفهٔ فوری؛ (۲) دو سند جدید؛ (۳) دو گزارش؛ (۴) duplicate با Ctrl+click؛ (۵) close dirty cancel/confirm + focus restore؛ (۶) reset dirty مسدود.

به‌علاوه:

- mount/lazy-mount/hidden/inert و aria تابلوی `tabpanel` + `WorkspaceErrorBoundary`.
- دیالوگ بستن dirty فقط یک‌بار باز است (mutex)؛ Escape لغو می‌کند؛ تغییر تب → `cancelPendingClose`.

### ۱۰.۵ E2E — Playwright: `frontend/e2e/workspace-windows.spec.ts`

| سناریو         | قدم‌ها                                           | گزاره                                                                                 |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| overflow       | viewport 360/768/1024/1280 با N=1,2,6,12         | `documentElement.scrollWidth <= documentElement.clientWidth`                          |
| compression    | N=2/6/10/12                                      | حالت‌های §۴.۴؛ دکمهٔ close همیشه با کیبورد قابل دسترسی                                |
| reload         | باز کردن چند پنجره + فعال → reload               | همان لیست و همان active؛ فقط active mount؛ بعدی lazy                                  |
| dirty form     | fill + reload                                    | مقدار فرم برنمی‌گردد؛ هشدار `beforeunload` فعال می‌ماند (با mock event سنجیده می‌شود) |
| tone           | تعویض از `/app/profile` + reload                 | رنگ داک/سایدبار با همان نگاشت جدید و پایدار پس از reload؛ مقدار خراب → پیش‌فرض        |
| reduced-motion | `page.emulateMedia({ reducedMotion: 'reduce' })` | هیچ انیمیشن داک/تب اجرا نمی‌شود                                                       |
| print          | `page.emulateMedia({ media: 'print' })`          | فقط پنجرهٔ active visible؛ داک hidden                                                 |

### ۱۰.۶ شواهد بازبینی

- اسکرین‌شات: full/compact/icon/single، dirty/close، دیالوگ سقف، error panel، پیش‌نمایش tone در دو تم.
- PR: گیت‌های سبز، فهرست فایل‌های جدید و فایل‌های تغییریافته، و حداقل یک اسکرین‌شات برای هر بخش بازبینی.

## ۱۱) ریسک‌ها و کاهش

| ریسک                           | اثر              | کاهش                                                      |
| ------------------------------ | ---------------- | --------------------------------------------------------- |
| حافظه/CPU با ۱۲ پنجره mount    | کندی             | سقف؛ `display:none`؛ lazy mount؛ اندازه‌گیری فاز ۱        |
| پوشش ناقص dirty                | از دست رفتن داده | فهرست کامل صفحات فرم؛ بستن شکاف movement/transfer         |
| Back مرورگر                    | انتظار کاربر     | مستند صریح؛ فاز ۳                                         |
| خطا در استخراج درخت مسیر       | شکستن مسیرها     | parity + حفظ گیت‌ها + تست‌های موجود صفحات                 |
| دیالوگ باز در پنجرهٔ مخفی      | نمایش ناخواسته   | backdrop؛ مسدودسازی جابه‌جایی هنگام modal باز             |
| رنگ workspace ≈ accounting     | ابهام            | tone اسلیت (D-3، فاز ۱F)                                  |
| نگاشت tone تکراری در ذخیره‌شده | ابهام            | اعتبارسنجی fail-closed                                    |
| بازیابی مسیر بدون مجوز         | افشای UI         | `RequirePermission` دوباره؛ 403 استاندارد                 |
| انفجار query پس از refresh     | کندی             | lazy mount (W-16)                                         |
| لیست پنجرهٔ اپراتور قبلی       | افشای ناوبری     | `sessionStorage` (نه `localStorage`) + پاک‌سازی در logout |
| کلیک روی `/new` در همان پنجره  | از دست رفتن لیست | پنجرهٔ جدید برای `/new` (W-03)                            |
| پنجرهٔ تکراری بی‌مورد          | شلوغی            | reuse بر basePath؛ duplicate فقط با modifier              |

## ۱۲) معیار پذیرش مالک

1. بازکردن یک کار فوری از سایدبار، فرم قبلی و مقادیرش حفظ شود.
2. حداقل دو فرم جدید هم‌زمان با state مستقل قابل استفاده باشند.
3. در ۱۲۸۰px و ۱۰۲۴px و ۳۶۰px هیچ اسکرول افقی ایجاد نشود.
4. با ۱۲ پنجره، همه در یک ردیف فشرده دیده شوند و close قابل دسترسی باشد.
5. داک در حالت تک‌پنجره هم دیده شود (D-1).
6. رنگ هر ماژول از توکن باشد، هیچ دو ماژولی tone یکسان نداشته باشند و در هر دو تم معتبر بماند.
7. تخصیص رنگ ماژول‌ها از تنظیمات پروفایل قابل تغییر و پایدار پس از refresh باشد (D-3).
8. بستن پنجره dirty بدون تأیید ممکن نباشد.
9. تغییر سازمان/سال مالی، پنجره‌های سازمان قبلی را نگه ندارد.
10. داک با کیبورد کامل قابل استفاده باشد و focus trap نداشته باشد.
11. پس از refresh همان پنجره‌ها و همان پنجرهٔ فعال بازگردند؛ محتوای ذخیره‌نشدهٔ فرم بازنگردد و این رفتار صریح باشد (D-6).
12. هیچ محتوای فرم/پیش‌نویس/دادهٔ کسب‌وکار/توکن در مرورگر ذخیره نشود؛ فقط دو کلید نسخه‌دار §۶.۱۰.
13. هیچ کتابخانهٔ جدید و هیچ global store اضافه نشود.

## ۱۳) وضعیت تصمیم‌ها

مرجع رسمی: [FDR-01](./FDR-01-workspace-windows.md)؛ جدول زیر فقط خلاصه است.

| شناسه | تصمیم                               | وضعیت                                                                                                             |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D-1   | داک در N=1 هم دیده شود؟             | **تأیید شد:** همیشه دیده شود.                                                                                     |
| D-2   | سقف پنجره‌ها                        | **تأیید شد:** ۱۲.                                                                                                 |
| D-3   | tone هر ماژول و قابل‌تغییر بودن رنگ | **تأیید شد:** هر ماژول tone مستقل؛ تخصیص از پروفایل؛ tone اسلیت workspace؛ پیشنهاد قدیمی «tone خنثی مشترک» منسوخ. |
| D-4   | Back مرورگر در فاز ۱                | بدون تغییر: فاز ۳.                                                                                                |
| D-5   | Split-view                          | **تأیید شد:** فاز ۲؛ حداکثر ۲ pane.                                                                               |
| D-6   | بازیابی پس از refresh               | **تأیید شد:** لیست + پنجرهٔ فعال؛ محتوای فرم نه.                                                                  |
| D-7   | «ذخیره و بستن»                      | بدون تغییر: فاز ۳.                                                                                                |
| D-8   | رفتار موبایل                        | بدون تغییر: پنجرهٔ فعال + sheet؛ بدون split.                                                                      |
| D-9   | پنجرهٔ دوم از گزارش تکراری          | بدون تغییر: مجاز با Ctrl/Cmd+کلیک.                                                                                |
| D-10  | pause queryهای مخفی                 | بدون تغییر: فاز ۳.                                                                                                |

پرسش‌های باز که فقط فاز مربوطه را مسدود می‌کنند:

| ID  | پرسش                                                         | پیشنهاد                                                                              |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Q-1 | ترجیح رنگ ماژول‌ها device-local بماند یا در بک‌اند per-user؟ | فاز ۱F device-local؛ فاز ۴ → ADR-0013؛ اگر پاسخ «بک‌اند» است، نسخهٔ محلی ساخته نشود. |
| Q-2 | بازیابی چیدمان split پس از refresh                           | بله؛ همان رکورد نسخه‌دار با `v2`.                                                    |
| Q-3 | «اخیراً بسته‌شده» در دامنه؟                                  | فاز ۳؛ فقط لیست؛ بدون بازیابی فرم.                                                   |

## ۱۴) قاعدهٔ ثبت نقاط Open

اگر ایجنت در پیاده‌سازی به ابهامی رسید که این سند و FDR آن را مشخص نکرده‌اند، **حدس نزن**:

1. در PR به‌شکل `OPEN-<n>: <متن> — گزینه‌ها: a) … b) …` ثبت کن.
2. پیشنهاد خود را با دلیل یک‌خطی بنویس، ولی پیش از تأیید مالک هیچ گزینه‌ای را اعمال نکن.
3. اگر ابهام فقط به ظاهر ربط دارد (رنگ/فاصله)، مرجع تصمیم بازبینی بصری است.

نقاط Open شناخته‌شده در همین سند: O-01 (مقادیر نهایی tone اسلیت workspace — پیش‌فرض مقادیر §۴.۳ تا بازبینی)، O-02 (چیدمان bottom-sheet موبایل — از الگوهای موجود استفاده شود)، O-03 (فاصله‌های typography داک — از design-system).
