# یکپارچه‌سازی هوش طراحی UI UX Pro Max در Vardena

**وضعیت:** ACTIVE — قرارداد مصرف اسکیل هوش طراحی در کارهای UI/فرانت
**تاریخ:** ۲۰۲۶-۱۰-۲۸
**وابستگی:** [standards.md](./standards.md) · [design-system.md](./design-system.md) · [ADR-0002](../adr/0002-technology-stack.md)

مستندات مرتبط:
- [استاندارد فرانت](./standards.md) · [Design System](./design-system.md) · [راهنمای توسعه‌دهندگان](./developer-guide.md)

---

## ۱) اسکیل چیست و کجاست

[UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) یک
اسکیل «هوش طراحی» است: موتور جست‌وجوی محلی (BM25 + regex) روی پایگاه‌داده‌های
سبک‌های UI، پالت‌های رنگ، زوج‌های تایپوگرافی، راهنماهای UX، آیکون‌ها، الگوهای
صفحه، انواع چارت و دستورالعمل استک‌ها. خروجی آن **توصیۀ طراحی** است — نه کد،
نه قاعدۀ کسب‌وکار، نه منبع حقیقت بصری.

نسخۀ vendored داخل مخزن (کاملاً محلی، بدون شبکه، فقط Python 3 استاندارد):

```text
.claude/skills/ui-ux-pro-max/
├── SKILL.md       # راهنمای اجرا + «Vardena Project Overlay»
├── scripts/       # search.py (جست‌وجو + تولید design system)
├── data/          # پایگاه‌داده‌های CSV/JSON
├── references/    # quick-reference.md و pro-rules.md
├── UPSTREAM.md    # منبع، نسخۀ پین‌شده و روش به‌روزرسانی
└── LICENSE        # مجوز MIT آپ‌استریم
```

**نسخۀ پین‌شده:** آپ‌استریم `nextlevelbuilder/ui-ux-pro-max-skill` نسخه
`2.15.0` (کامیت `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`) — جزئیات و روش
به‌روزرسانی در [`UPSTREAM.md`](../../.claude/skills/ui-ux-pro-max/UPSTREAM.md).

پیش‌نیاز: `python3 --version` (در ویندوز `python`). اسکیل هیچ بسته‌ای نصب
نمی‌کند و هیچ فراخوانی شبکه‌ای ندارد؛ اگر Python در دسترس نبود، از ایجنت خواسته
می‌شود نصبش نکند و به کاربر اطلاع دهد.

## ۲) جایگاه و تقدم (مهم‌ترین قاعده)

```text
ADR مرتبط  >  standards.md + design-system.md  >  خروجی اسکیل  >  سلیقه
```

- اسکیل **مشورتی** است: برای انتخاب/بازبینی ساختار بصری، سلسله‌مراتب، الگوهای
  UX، دسترس‌پذیری، چارت و آیکون اطلاعات می‌دهد.
- هیچ خروجی از اسکیل مجوز نقض [standards.md](./standards.md)،
  [design-system.md](./design-system.md)، ADRها، قرارداد تاریخ/زمان (AR-32) یا
  گاردهای CI (بخش ۱۷ standards.md) را نمی‌دهد. در تعارض، **قاعدهٔ مخزن برنده
  است** و تعارض + تصمیم اتخاذشده در گزارش تسک ثبت می‌شود (AG-17).
- قواعد ماشینی پابرجا هستند: `node scripts/check-frontend-design-tokens.mjs`،
  grep جهت‌دار/فرمت دستی/رشتۀ فارسی در JSX، `import/no-cycle` و بقیۀ gateها
  همیشه باید سبز بمانند؛ «اسکیل این‌طور گفته» هرگز معافیت نیست.
- دادۀ خصوصی پروژه در queryها قرار نمی‌گیرد و خروجی تولیدشده در مخزن persist
  نمی‌شود (بخش ۵، ردیف `--persist`).
- قواعد کسب‌وکار (شماره‌گذاری، مالیات، سند، posting، تأییدها) از حیطۀ اسکیل
  خارج است (AG-09/AR-31)؛ اسکیل فقط «ظاهر و تعامل» را پوشش می‌دهد.

## ۳) چه زمانی از اسکیل استفاده شود

**استفاده شود:**

- صفحه/مسیر جدید یا بازطراحی بصری یک سطح
- انتخاب/بازبینی سلسله‌مراتب بصری، چیدمان، فرم‌های عملیاتی، چهار حالت
  (loading/empty/error/success)
- بازبینی UX و دسترس‌پذیری (کیبورد، focus، contrast، متن‌های بلند، RTL)
- انتخاب نوع چارت، الگوی نمودار و آیکون
- بهبود ادراکی (بازخورد تعامل، micro-interaction، انیمیشن سبک)

**استفاده نشود:**

- منطق بکند، API، پایگاه‌داده، زیرساخت و هر کار غیربصری
- قواعد کسب‌وکار و تصمیم‌های محصولی (OQ/PDR)
- تغییر توکن/فونت/تم/پالت — این‌ها فقط با تصمیم مالک و مسیر
  [design-system.md](./design-system.md)

## ۴) چگونه اجرا شود

از ریشۀ مخزن (دستورات را با `python3` اجرا کنید؛ در ویندوز `python`):

```bash
# گام ۱ — جهت بصری یک صفحه/سطح جدید (ERP متراکم):
python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
  "internal operations dashboard dense data grid" --design-system \
  --density 8 --motion 2 --variance 3 -p "Vardena"

# گام ۲ — جست‌وجوی هدفمند یک دغدغه:
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "error summary validation" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "icon button accessible label" --domain icons
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard" --domain chart

# گام ۳ — راهنمای استک (همیشه استک ثابت Vardena):
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "form validation" --stack react
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "data table density" --stack shadcn
```

دستورهای پرکاربرد:

| نیاز | دستور |
| --- | --- |
| صفحه/سطح جدید (متراکم) | `... "<محصول/سطح> <کلیدواژه‌ها>" --design-system --density 8 --motion 2 --variance 3` |
| بازبینی UX/دسترس‌پذیری | `... "<outcome>" --domain ux` (هر بار یک نتیجۀ قابل مشاهده) |
| آیکون | `... "<outcome>" --domain icons` |
| چارت | `... "dashboard" --domain chart` |
| فرم | `... "form validation" --domain ux` + `--stack react` |
| راهنمای استک | `... "<keyword>" --stack react` یا `--stack shadcn` |
| گزینه‌های سبک/رنگ/فونت | `--domain style` / `color` / `typography` |

قواعد query (از SKILL.md): ۲–۵ واژه با **یک نیت غالب**؛ در خروجی خالی فقط
**یک‌بار** بازنویسی باریک‌تر/دامنۀ صریح؛ اگر باز هم خالی بود، صریح اعلام شود
«تطبیق تأییدشده‌ای یافت نشد» و هر راهنمای عمومی fallback برچسب بخورد — نتیجۀ
صفر هرگز به‌عنوان داده گزارش نمی‌شود.

خروجی `--design-system` را با `-f markdown` یا `--json` برای استخراج دقیق
بگیرید؛ فیلدهای طولانی در خروجی انسانی بریده می‌شوند.

## ۵) لایۀ ترجمه: خروجی اسکیل → قواعد Vardena

هر توصیۀ اسکیل پیش از اعمال از این جدول می‌گذرد:

| خروجی اسکیل | در Vardena |
| --- | --- |
| رنگ/پالت (مقادیر hex) | فقط **خلق‌وخوی رنگی** مرجع است؛ در کد فقط توکن semantic از `frontend/src/styles/index.css` (`bg-surface`، `text-ink-muted`، `text-danger-ink`، …). نوشتن hex/rgb/hsl یا کلاس پالت خام (`text-slate-600`) توسط `scripts/check-frontend-design-tokens.mjs` رد می‌شود. توکن جدید = مسیر [design-system.md](./design-system.md) + تصمیم مالک. |
| تایپوگرافی / Google Fonts | فونت سامانه فقط **Vazirmatn** (self-host، وزن‌های ۴۰۰/۵۰۰/۶۰۰/۷۰۰) است؛ هر import گوگل‌فونت/CDN ممنوع. خروجی typography فقط برای الهام سلسله‌مراتب/وزن/اندازۀ نسبی در چارچوب سه سطح `data-font-scale` به کار می‌رود. |
| طرح‌های GSAP / موشن | GSAP در استک مصوب (ADR-0002) نیست؛ snippetها فقط مرجع حس/تایینگ هستند. پیاده‌سازی با transitionهای موجود و اکشن‌های سبک (press/pop/rise/marker) + رعایت `prefers-reduced-motion`. |
| چیدمان/جهت (پیش‌فرض LTR) | همۀ ابعاد/جهت‌ها با logical properties (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`) بازنویسی می‌شوند؛ `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-` ممنوع و gate می‌خورد (اصل ۴). |
| آیکون (Phosphor/Heroicons/Lucide) | فقط **`lucide-react`**؛ معادل Lucide انتخاب شود. کتابخانۀ آیکون جدید = ADR. آیکون تزئینی `aria-hidden`؛ آیکون-دکمه `aria-label` (WCAG 1.4.1). |
| چارت | انتخاب **نوع** چارت از خروجی مجاز است؛ کتابخانۀ چارت فقط lazy (standards §۱۴) و افزودن/تعویض کتابخانه = بررسی حجم + ADR. |
| spacing / density | توکن‌های ابعاد موجود مقدم‌اند (`h-9`، `h-8`، `--radius-control`، `--radius-card`)؛ برای گرید/میزکار همیشه `--density 8` و قاعدۀ ردیف ~۲۹px (standards §۸). |
| متن / لحن | همۀ رشته‌ها از دیکشنری i18n فارسی با لحن رسمی-ساده و فرمول «چه شد + چه کنید» (standards §۱۹)؛ ارقام تاریخ/زمان فارسی و قرارداد BusinessDate/Instant طبق AR-32. |
| `--persist` / پوشۀ `design-system/` | **بدون تصمیم صریح مالک ممنوع.** منبع حقیقت بصری [design-system.md](./design-system.md) است؛ `MASTER.md` تولیدی اسکیل commit نمی‌شود. |
| تم روشن/تاریک | خروجی اسکیل فقط مرجع است؛ قرارداد `data-theme` فعلی و contrast AA در هر دو تم الزامی است. |
| لندمارک جست‌وجو (`role="search"`) | در Vardena طبق قاعدۀ ماشینی `oxlint jsx-a11y/prefer-tag-over-role` از تگ معنایی `<search>` به‌جای `<div role="search">` استفاده می‌شود. |
| چهار حالت + DoD | توصیه‌های اسکیل جایگزین DoD بخش ۲۰ standards.md نمی‌شوند؛ هر تسک UI همچنان چهار حالت + اسکرین‌شات + gateهای سبز می‌خواهد. |

## ۶) گردش کار هر تسک UI/فرانت

1. **قواعد:** [standards.md](./standards.md) (+ سند تخصصی همان سطح مثل
   [tables-and-lists.md](./tables-and-lists.md) یا [operational-forms.md](./operational-forms.md))
   کامل خوانده شود.
2. **هوش طراحی:** نیت بصری با اسکیل استخراج شود (بخش ۴) و از لایۀ ترجمۀ
   بخش ۵ به تصمیم Vardena تبدیل شود.
3. **پیاده‌سازی:** صفحه فقط از ترکیب Primitives/Patterns موجود
   (`frontend/src/ui/**` و `src/ui/patterns/**`) ساخته شود؛ الگوی جدید = تسک
   مستقل (اصل ۲). feature → shared مجاز؛ feature → feature ممنوع.
4. **پذیرش:** چهار حالت، کیبورد کامل، RTL، contrast، DoD بخش ۲۰ و گزارش
   تسک — شامل نام queryهای اسکیل و فهرست توصیه‌های اعمال‌شده/ردشده با دلیل.
5. **gateها:** `typecheck + lint + test + build` و گاردهای بخش ۱۷ سبز؛
   `node scripts/check-frontend-design-tokens.mjs` و `python3 scripts/check-date-contract.py`.

## ۷) به‌روزرسانی از upstream

فقط با تصمیم مالک و طبق [`UPSTREAM.md`](../../.claude/skills/ui-ux-pro-max/UPSTREAM.md):
کپی همان ترکیب از آپ‌استریم، اعمال دوبارۀ دو سازگاری محلی `SKILL.md` (مسیر
اسکریپت + بخش Overlay)، به‌روزرسانی پین نسخه در هر دو سند، و smoke test آفلاین
دستور بخش ۴. تغییر رفتار بصری محصول در پی به‌روزرسانی همچنان از مسیر تصمیم
مالک می‌گذرد — به‌روزرسانی اسکیل قاعده‌ای را در standards.md عوض نمی‌کند.
