# استاندارد طراحی و Design System فرانت‌اند Vardena

**وضعیت:** ACTIVE — مرجع اجرایی لایۀ بصری و سیستم طراحی
**نسخه:** ۲.۰
**تاریخ به‌روزرسانی:** ۲۰۲۶-۱۰-۲۳
**وابستگی:** [standards.md](./standards.md) · [ADR-0002](../adr/0002-technology-stack.md) · [ADR-0051](../adr/0051-global-request-loading-system.md) · [ADR-0052](../adr/0052-frontend-modernization-shell-theme-operational-forms.md)

مستندات مرتبط:
- [استاندارد Layout و Navigation](./layout-and-navigation.md)
- [استاندارد فرم‌های عملیاتی](./operational-forms.md)
- [استاندارد جدول‌ها و فهرست‌ها](./tables-and-lists.md)
- [استاندارد تاریخ و زمان فرانت‌اند](./date-standard.md)
- [راهنمای توسعه‌دهندگان فرانت‌اند](./developer-guide.md)

---

## ۱) اصول بصری و قواعد Design System

1. **چگالی بر تزئین (Density over Decoration):** رابط کاربری یک ERP مالی و عملیاتی است؛ فضای صفحه صرف نمایش داده، فرم و جدول می‌شود، نه کارت‌های تزئینی، سایه‌های سنگین یا حاشیه‌های پهن بی‌مورد.
2. **یک منبع حقیقت برای رنگ و توکن:** تمام تصمیم‌های رنگ، شعاع گوشه، سایه و ابعاد پوسته در `frontend/src/styles/index.css` تعریف می‌شوند. استفاده از مقادیر خام `#hex`، `rgb()` یا `hsl()` در فایل‌های `.ts`/`.tsx` ممنوع است و توسط گارد `scripts/check-frontend-design-tokens.mjs` مسدود می‌شود.
3. **الگوی واحد برای هر رفتار تکرارشونده:** صفحه‌ها فقط از ترکیب Primitives (`src/ui/*`) و Patterns (`src/ui/patterns/*`) ساخته می‌شوند؛ ایجاد سیستم طراحی موازی یا کامپوننت تکراری در داخل `features/` ممنوع است.
4. **فارسی و راست‌به‌چپ بومی (Native RTL):** ریشه سند `<html lang="fa" dir="rtl">` است و تمام چیدمان‌ها فقط با ویژگی‌های منطقی CSS/Tailwind (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s`, `border-e`) نوشته می‌شوند.

---

## ۲) رنگ‌ها و Design Tokenها (تم روشن و تاریک)

تم فعال روی ریشه سند با صفت `data-theme="light"` یا `data-theme="dark"` و `style.colorScheme` تنظیم می‌شود. کامپوننت‌ها هرگز شرط `isDark ? ... : ...` برای رنگ ندارند؛ فقط توکن معنایی می‌خوانند.

### ۲.۱ سطوح (Surfaces) و خطوط

| توکن | تم روشن (`light`) | تم تاریک (`dark`) | کاربرد |
| --- | --- | --- | --- |
| `--color-canvas` | `#f6f7f9` | `#0b1120` | پس‌زمینۀ اصلی محیط کاری |
| `--color-surface` | `#ffffff` | `#131c31` | کارت، جدول، هدر، سایدبار، دیالوگ |
| `--color-sunken` | `#f8fafc` | `#1b2640` | هدر جدول، پس‌زمینۀ فیلتر/جست‌وجو، حالت hover خنثی |
| `--color-line` | `#e2e8f0` | `#293654` | خط جداکننده و کادر پیش‌فرض |
| `--color-line-strong` | `#cbd5e1` | `#3d4f75` | کادر کنترل‌ها، دکمۀ `outline`، کادر نقطه‌چین Empty |

### ۲.۲ متن (Ink) و برند (Brand)

| توکن | تم روشن (`light`) | تم تاریک (`dark`) | کاربرد |
| --- | --- | --- | --- |
| `--color-ink` | `#0f172a` | `#f1f5f9` | عنوان‌ها، اعداد اصلی و متن اولیه |
| `--color-ink-muted` | `#475569` | `#cbd5e1` | متن توضیحی، سلول‌های جدول و برچسب فیلدها |
| `--color-ink-subtle` | `#64748b` | `#94a3b8` | متادیتا، راهنما (`hint`) و آیکون‌های خنثی |
| `--color-brand` | `#4f46e5` | `#6366f1` | دکمۀ اصلی، نوار آیتم فعال، حلقۀ فوکوس |
| `--color-brand-strong` | `#4338ca` | `#818cf8` | حالت hover/active دکمۀ اصلی |
| `--color-brand-soft` | `#eef2ff` | `#1e1b4b` | پس‌زمینۀ آیتم فعال منو و ردیف انتخاب‌شده |
| `--color-brand-ink` | `#3730a3` | `#c7d2fe` | متن خوانا روی `brand-soft` |

### ۲.۳ رنگ‌های وضعیت (Status Triads)

هر وضعیت سه توکن هماهنگ (`soft` پس‌زمینه، `line` کادر، `ink` متن) دارد و هرگز بدون متن یا آیکون همراه به کار نمی‌رود (انطباق با WCAG 1.4.1):

| وضعیت | پس‌زمینه | کادر | متن |
| --- | --- | --- | --- |
| موفقیت (`ok`) | `--color-ok-soft` | `--color-ok-line` | `--color-ok-ink` |
| هشدار (`warn`) | `--color-warn-soft` | `--color-warn-line` | `--color-warn-ink` |
| خطا / خطر (`danger`) | `--color-danger-soft` | `--color-danger-line` | `--color-danger-ink` (+ `--color-danger` و `--color-danger-strong` برای دکمۀ مخرب) |
| اطلاع (`info`) | `--color-info-soft` | `--color-info-line` | `--color-info-ink` |

### ۲.۴ تون‌های دامنه (Domain Tones) و تخصیص tone ماژول‌ها

هر ماژول سامانه (میزکار، حسابداری، انبار، سازمان، مجوز، مدیریت) یک tone معنایی مستقل با چهار توکن `--color-tone-<module>-{soft,line,ink,strong}` در `frontend/src/styles/index.css` دارد؛ کلاس‌های Tailwind از همین توکن‌ها ساخته می‌شوند و نقشۀ کلاس‌ها در `src/ui/nav-glyph.tsx` (`NAV_TONE_TILE`) به‌صورت شمارش‌شده (enumerated) نگه داشته می‌شود — ساخت داینامیک کلاس (`bg-tone-${x}`) ممنوع است چون Tailwind کلاس ساخته‌شده در زمان اجرا را emit نمی‌کند.

طبق تصمیم مالک (D-3 در [FDR-01](../../workspace-windows/FDR-01-workspace-windows.md)):

- **هر ماژول tone مستقل دارد** و هیچ دو ماژولی هیچ‌وقت tone یکسان ندارند؛ tone خنثی/مشترک «workspace fallback» مجاز نیست. به همین دلیل `--color-tone-workspace-*` از خانوادۀ ایندیگو (مشترک با accounting) به خانوادۀ **اسلیت** تغییر کرد — فقط مقدار توکن، بدون تغییر نام توکن یا ویرایش کامپوننت‌ها (همه از قبل `tone-workspace-*` می‌خوانند).
- **تخصیص toneها از تنظیمات پروفایل کاربری قابل تغییر است** (`/app/profile`، بخش «رنگ ماژول‌ها»): یک شبکۀ تخصیص که هر ماژول یکی از شش tone مصوب را می‌گیرد و هر tone دقیقاً یک بار مصرف می‌شود؛ انتخاب toneِ در اختیارِ ماژول دیگر، دو ماژول را **جابه‌جا (swap)** می‌کند تا یکتایی ساختاراً غیرقابل نقض باشد. رنگ آزاد (hex دلخواه) وجود ندارد.
- اعمال در runtime با indirection از جنس `var()` انجام می‌شود (`--color-tone-<module>-<part>: var(--color-tone-<tone>-<part>)`) تا هر دو تم خودکار پیروی شوند و هیچ hex در JS نوشته نشود؛ نگاشت در کلید نسخه‌دار `vardena:module-tones:v1` (localStorage، allowlist شش‌تایی، fail-closed) ذخیره می‌شود و اسکریپت pre-paint در `index.html` پیش از اولین رنگ‌آمیزی اعمالش می‌کند.
- رنگ هرگز تنها حامل معنا نیست: آیکون + عنوان + tooltip + `aria-label` در کنار tone همیشه حضور دارند (WCAG 1.4.1) و contrast AA در هر دو تم شرط پذیرش است.

---

## ۳) تایپوگرافی فارسی و سه سطح اندازه فونت

- **فونت:** خانوادۀ **Vazirmatn** به‌صورت کاملاً محلی (Self-hosted در `frontend/public/fonts/` در وزن‌های `400`, `500`, `600`, `700` با `font-display: swap`) سرو می‌شود؛ هیچ وابستگی شبکه‌ای به CDN خارجی وجود ندارد.
- **ارتفاع خط:** بدنه دارای `line-height: 1.75` برای خوانایی حروف فارسی در جدول‌های متراکم و عنوان‌ها دارای `line-height: 1.4` با `text-wrap: balance` هستند.
- **اعداد و شناسه‌ها:**
  - `.num`: اعداد مالی و مقداری (`tabular-nums`, `direction: ltr`, `unicode-bidi: isolate`, `text-align: end`).
  - `.code`: کد حساب، شماره سند، کد کالا و شناسه‌ها (`tabular-nums`, `direction: ltr`, `unicode-bidi: isolate`, `text-align: start`).

### سه سطح اندازه فونت (`data-font-scale`)

اندازه پایه روی `<html>` تنظیم می‌شود و تمام کامپوننت‌ها، فاصله‌ها و کنترل‌ها از واحد نسبی `rem` پیروی می‌کنند تا در هیچ سطحی شکستگی چیدمان یا بیرون‌زدگی متن در فرم‌ها و جدول‌های متراکم رخ ندهد:

| کلید (`FontScale`) | عنوان فارسی | اندازه پایه (`html`) | کاربرد پیشنهادی |
| --- | --- | --- | --- |
| `compact` | فشرده | `14.5px` | نمایشگرهای لپ‌تاپ یا اپراتورهایی که بیشترین تعداد ستون و ردیف را می‌خواهند |
| `default` | معمولی | `16px` | پیش‌فرض استاندارد سامانه (`1rem = 16px`) |
| `comfortable` | راحت | `17.5px` | نمایشگرهای بزرگ یا افزایش خوانایی در کار طولانی‌مدت |

مدیریت تم و اندازه فونت در `src/lib/appearance.ts` و `AppearanceProvider` انجام می‌شود و در `localStorage` زیر کلید نسخه‌دار `vardena:appearance:v1` ذخیره می‌گردد. اسکریپت اولیۀ درون `index.html` پیش از نخستین رنگ‌آمیزی مرورگر صفت‌های `data-theme` و `data-font-scale` را اعمال می‌کند تا پرش نوری (FOUC) رخ ندهد.

---

## ۴) فاصله‌گذاری، ابعاد کنترل‌ها و Responsive Layout

- **ابعاد کنترل‌ها:**
  - ارتفاع هدر سراسری: `--spacing-app-header` (`3.5rem` / `h-14`).
  - عرض سایدبار باز: `--spacing-app-sidebar` (`16rem`).
  - عرض سایدبار جمع‌شده: `--spacing-app-sidebar-collapsed` (`3.75rem`).
  - ارتفاع استاندارد کنترل‌های فرم (`Input`, `Select`, `Button md`): `h-9` (`2.25rem`).
  - ارتفاع کنترل‌های فشرده نوار ابزار و هدر (`Button sm`, فیلترهای سریع): `h-8` (`2rem`).
  - شعاع گوشه: `--radius-control` (`0.5rem`) برای کنترل‌ها و `--radius-card` (`0.875rem`) برای کارت‌ها و جدول‌ها.
- **حذف Max-width مصنوعی:** پوسته اصلی (`AppShell`) و میزکار (`DashboardPage`) از تمام عرض Viewport استفاده می‌کنند تا جدول‌های عریض حسابداری و انبار دچار فشردگی مصنوعی نشوند. محدودیت عرض فقط برای صفحات تک‌ستونی تمرکزی مانند فرم ورود (`max-w-md`) مجاز است.
- **واکنش‌گرایی (Responsive):**
  - در دسکتاپ (`lg` به بالا): سایدبار چسبان قابل جمع‌شدن به حالت آیکون‌محور، هدر کامل.
  - در تبلت و موبایل (`< lg`): سایدبار به Drawer کشویی با پس‌زمینۀ نیمه‌شفاف تبدیل می‌شود؛ جست‌وجوی سراسری به‌صورت نوار بازشونده زیر هدر عمل می‌کند؛ جدول‌ها درون `TableWrapper` اسکرول افقی نرم (`.scroll-thin`) دارند.

---

## ۵) کاتالوگ کامپوننت‌های پایه (`src/ui/*`) و الگوها (`src/ui/patterns/*`)

### ۵.۱ Primitives (`src/ui/*`)

| کامپوننت | فایل | توضیح و حالت‌های تعاملی |
| --- | --- | --- |
| `Button` | `button.tsx` | گونه‌های `default`, `outline`, `ghost`, `subtle`, `danger`؛ اندازه‌های `sm`, `md`, `icon`؛ پشتیبانی از `loading` (نمایش Thinking Orb + جلوگیری از ارسال مجدد) |
| `Input` / `Select` / `Label` | `input.tsx`, `select.tsx`, `label.tsx` | کنترل‌های یکپارچه فرم با پشتیبانی از `aria-invalid`, `disabled`, و حلقۀ فوکوس استاندارد |
| `Dialog` | `dialog.tsx` | دیالوگ مودال دسترس‌پذیر (`<dialog open>`) با حبس فوکوس (Focus Trap)، بستن با `Escape`، قفل اسکرول بدنه و بازگردانی فوکوس |
| `DropdownMenu` / `DropdownMenuItem` | `dropdown-menu.tsx` | منوی بازشونده با ناوبری کیبورد (`ArrowUp`/`ArrowDown`/`Home`/`End`/`Escape`) و تراز منطقی RTL |
| `Tooltip` | `tooltip.tsx` | راهنمای شناور در hover و focus کیبورد با پشتیبانی از `side="top" \| "bottom" \| "end"` |
| `Card` | `card.tsx` | ظرف سطح `surface` با کادر `border-line` و سایۀ ملایم `shadow-card` |
| `Alert` / `Badge` | `alert.tsx`, `badge.tsx` | نمایش پیام‌ها و برچسب‌های وضعیت با سه‌گانۀ توکن‌های وضعیت |
| `Table` / `TableWrapper` | `table.tsx` | زیرساخت جدول معنایی با اسکرول افقی و هدر متمایز |
| `Skeleton` / `ThinkingOrbIndicator` | `skeleton.tsx`, `thinking-orb.tsx` | اسکلت هم‌شکل محتوا و نشانگر فعالیت شبکه |

### ۵.۲ Patterns (`src/ui/patterns/*`)

| الگو | فایل | مسئولیت |
| --- | --- | --- |
| `PageHeader` | `page-header.tsx` | عنوان یکتای `h1` صفحه، توضیح و دکمه‌های عملیات صفحه |
| `WorkspaceCardGrid` | `workspace-cards.tsx` | کارت‌های حوزه‌ای مینیمال (آیکون بالا، عنوان پایین) با دسته‌بندی مشخص |
| `DataTable` / `Pagination` | `data-table.tsx`, `pagination.tsx` | جدول سرور-محور با مرتب‌سازی، صفحه‌بندی، انتخاب ردیف و مجازی‌سازی خودکار |
| `FilterBar` / `FormField` | `filter-bar.tsx`, `form-field.tsx` | نوار فیلتر استاندارد و اتصال برچسب/ستاره الزامی/خطا/راهنما به کنترل |
| `DateInput` / `JalaliDateInputField` | `date-input.tsx`, `jalali-date-input-field.tsx` | ورودی و تقویم تعاملی شمسی متصل به لایۀ مرکزی تاریخ |
| `OperationalFormShell` | `operational-form/operational-form-shell.tsx` | پوسته استاندارد فرم عملیاتی: Toolbar، CollapsibleHeader، Detail، Summary و Footer |
| `DetailGrid` | `operational-form/detail-grid.tsx` | گرید ورود ردیف‌های عملیاتی با ناوبری کیبورد، مجازی‌سازی و Context Menu |
| `DocumentListToolbar` | `operational-form/document-list-toolbar.tsx` | نوار ابزار فهرست اسناد و ردیف‌ها (جست‌وجو، فیلتر، چاپ، اکسل، بازکردن سند) |
| `ConfirmDialog` / `Toast` | `confirm-dialog.tsx`, `toast.tsx` | تأیید عملیات حساس و اعلان‌های گذرا |

---

## ۶) حالت‌های تعاملی و چهار حالت صفحه

1. **Focus / Hover / Active / Disabled:**
   - `:focus-visible` سراسری با `outline: 2px solid var(--color-brand)` و `outline-offset: 2px` فعال است؛ حذف حلقه فوکوس بدون جایگزین ممنوع است.
   - کنترل‌های غیرفعال (`disabled` / `aria-disabled`) با کاهش شفافیت کنترل‌شده نمایش داده می‌شوند؛ در عملیات وابسته به مجوز در صفحه جزئیات سند، دلیل عدم دسترسی از طریق `title` و `aria-describedby` توضیح داده می‌شود.
2. **Loading / Empty / Error / Success:**
   - **Loading:** اسکلت هم‌شکل محتوا (`LoadingState`) + نشانگر فعالیت شبکه (`ADR-0051`)؛ اسپینر تمام‌صفحه برای بارگذاری بخش‌ها ممنوع است.
   - **Empty:** تفکیک صریح میان «اولین رکورد هنوز ثبت نشده است» و «نتیجه‌ای مطابق فیلترها یافت نشد».
   - **Error:** نمایش `ApiErrorAlert` یا `ErrorState` با پیام فارسی نگاشت‌شده از کد خطا (هرگز متن خام انگلیسی سرور)، نمایش `correlationId` و دکمۀ تلاش دوباره.
   - **Success:** نمایش داده واقعی دریافت‌شده از سرور + اعلان `Toast` پس از تکمیل موفق Mutation.
3. **کاهش حرکت (`prefers-reduced-motion`):** در صورت فعال‌بودن تنظیم کاهش حرکت سیستم‌عامل، تمام انیمیشن‌ها و ترنزیشن‌ها متوقف می‌شوند.

---

## ۷) گارد ماشینی CI

فرمان زیر در گام `Frontend design-token guard` از Workflow رسمی CI اجرا می‌شود:

```bash
node scripts/check-frontend-design-tokens.mjs
```

این گارد عدم وجود مقادیر رنگ خام در کل `src/`، توکنی‌بودن کامل لایۀ مشترک (`src/ui/**` و `src/app/**`) و حضور تمام توکن‌های الزامی در `src/styles/index.css` را تضمین می‌کند.
