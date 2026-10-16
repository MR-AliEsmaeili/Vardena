# Vardena Frontend Standards — نسخه ۲.۳

**وضعیت:** ACTIVE — مرجع رسمی قواعد UI

**مالک تصمیم تغییر:** علی (مالک پروژه)

**اجراکننده:** Arena Agent (اجرا) · ChatGPT (طراحی و بازبینی) · کامپوننت‌های لایه پایه و قواعد lint (اجراچۀ خودکار)

**حکمرانی:** تغییر فقط با تصمیم مالک + افزایش نسخه + ثبت در Changelog.

در تعارض:

**ADR مرتبط > این سند > سلیقه**

اگر اینجا پاسخ نیست، حدس نزن — **Open Question بساز.**

---

# ۰) جایگاه سند

مرجع حقیقت قواعد فرانت.

دو دسته قاعده دارد:

### قواعد قراردادی

در بازبینی استناد می‌شوند.

نقض = `CHANGES REQUIRED`

### قواعد ماشینی

بخش ۱۷.

با ESLint یا gate CI خودکار اجرا می‌شوند.

هر قاعدۀ این سند که قابل بیان ماشینی است باید به gate تبدیل شود؛ چون مالک diff را نمی‌خواند، قاعده باید خودش نقض را بگیرد.

---

اصول بنیادین (۱۲)
۱. چگالی بر تزئین: جدول‌ها ۳۰–۴۰ ردیف در صفحه؛ کارت تزئینی و فضای مرده ممنوع.۲. الگو واحد: هر چیز تکرارشونده یک الگو؛ صفحۀ جدید = ترکیب الگوها؛ الگوی جدید = تسک مستقل.۳. فرمت مرکزی: هیچ عدد/تاریخی بدون فرمتر مرکزی؛ toLocaleString پراکنده و concat دستی ممنوع.۴. RTL فقط با logical properties: ms-, me-, ps-, pe-, start-, end- الزامی؛ ml-, mr-, pl-, pr-, left-, right- ممنوع.۵. چهار حالت همیشه: loading / empty / error / success.۶. رنگ فقط توکن semantic: hex/rgb مستقیم ممنوع.۷. متن فقط از i18n: رشتۀ فارسی inline در JSX ممنوع.۸. سرعت قرارداد است: بودجه‌های بخش ۱۴ الزامی؛ فونت self-host.۹. دسترس‌پذیری الزامی: بخش ۱۳ حداقل است، نه اختیاری.۱۰. امنیت واقعی در بکند: چک permission در UI فقط UX است.۱۱. کامپوزیشن به‌جای تکرار: منطق در hooks/سرویس، رندر در کامپوننت؛ prop drilling عمیق با کامپوزیشن حل می‌شود نه Context همه‌جا.۱۲. قاعده = کد اجرایی: ممنوعیت‌ها تا حد ممکن با lint/CI گرفته می‌شوند.

۲) معماری کد
feature-based، آینۀ Vertical Slice بکند: src/app · src/shared (ui, lib, api) · src/features/ (api, components, pages, i18n, schema)
feature → shared مجاز؛ feature → feature ممنوع (آینۀ مرزبندی ماژول‌های بکند).
Path aliases: @/shared و @/features/.
Colocation: هر چیز فقط در نزدیک‌ترین محل استفاده؛ مشترک‌شدن از دو feature = انتقال به shared.
Import cycle ممنوع (import/no-cycle = error).
تایپ API فقط از OpenAPI تولید می‌شود؛ تایپ دستیِ response ممنوع؛ دستکاری تایپ generated برای پنهان‌کردن ناسازگاری ممنوع — ناسازگاری باید در قرارداد بکند اصلاح شود.
فایل/کامپوننت: یک کامپوننت در هر فایل؛ نام فایل = نام کامپوننت؛ حد راهنما ~۲۵۰ خط؛ بیشتر = استخراج hook/زیرکامپوننت.
Export: shared/ui فقط named export؛ default فقط برای lazy() در سطح route.
۳) React و طراحی کامپوننت
کامپوزیشن اول: داده‌ای که بیش از ~۲ سطح می‌گردد → کامپوننت را بازطراحی کن (children/slot)؛ Context فقط برای داده واقعاً سراسری.
منطق خارج از کامپوننت: محاسبه/واکشی/چانگِ فرمت در hook یا lib؛ کامپوننت فقط رندر و رخداد.
Derived state: داده مشتق در رندر محاسبه می‌شود؛ الگوی «محاسبه در render سپس setState در useEffect» ممنوع (باگ و re-render زنجیره‌ای).
Effects فقط برای همگام‌سازی با دنیای بیرون (شبکه، DOM، subscription). منطق کسب‌وکار در effect ممنوع.
Keys: برای ردیف‌های داینامیک/قابل‌حذف سند، index ممنوع — فقط ID پایدار؛ وگرنه state فیلدها بین ردیف‌ها جابه‌جا می‌شود (باگ کلاسیک گرید اسناد مالی).
Custom hook: هنگام تکرار منطق یا کامپوننت سنگین؛ نام use\*؛ خروجی تایپ‌دار.
memo/useCallback فقط با دلیل (پروفایل یا عبور به فرزند memoized)؛ میکرو-بهینه‌سازی کور ممنوع.
forwardRef فقط در primitives لایه shared/ui.
React Compiler: OQ-9.
۴) TypeScript
strict همیشه؛ any ممنوع؛ داده نامعلوم = unknown + narrowing.
اتحادیۀ متمایز برای وضعیت سند:type DocStatus = | { kind: "draft" } | { kind: "temporary" } | { kind: "final" } | { kind: "reversed"; reversedBy: DocId };رندر/اجازۀ عملیات با exhaustive switch؛ حالت unreachable با assertNever —«سند Final با دکمۀ ویرایش» در کامپایل غیرممکن می‌شود، نه در تست.
IDهای برندگذاری‌شده: DocId/AccountId/OrgId به‌صورت برند روی string —پاس‌دادن DocId به‌جای AccountId خطای کامپایل می‌شود (پیشگیری از خطای مرزی سازمان/موجودیت).
enum ممنوع؛ const object + union.
satisfies برای آبجکت‌های config؛ type assertion (as) فقط interop با کد ثالث + کامنت دلیل.
تایپ تکراری با Zod: schema = منبع، تایپ با z.infer مشتق می‌شود (یک منبع حقیقت برای validation و type).
۵) مدیریت وضعیت — بر اساس مالکیت

| نوع وضعیت | ابزار پیش‌فرض | قاعده |
| --- | --- | --- |
| داده تحت مالکیت بکند (Server state) | TanStack Query | واکشی مستقیم یا axios داخل کامپوننت و کپی‌کردن داده در store دیگر ممنوع است. |
| فیلتر، صفحه و sort لینک‌پذیر | Router search params | وضعیت لیست‌ها و گزارش‌ها در URL نگه‌داری شود. |
| وضعیت فرم | React Hook Form + Zod | داده و تعامل فرم در scope همان فرم باقی بماند. |
| تعامل محلی UI | React state | modal، tab، expansion، انتخاب محلی و وضعیت موقت نزدیک‌ترین کامپوننت مالک را ترک نکند. |
| dependency کوچک و cross-tree | React Context | فقط برای scope مشخصی مانند session یا organization؛ Context نباید به cache عمومی داده بکند تبدیل شود. |
| وضعیت پیچیده، client-owned و cross-feature | یک global state library تأییدشده | اختیاری است و فقط پس از اثبات نیاز واقعی معرفی می‌شود. |

سلسله‌مراتب تصمیم:

```text
Backend-owned data
        ↓
TanStack Query

Local component interaction
        ↓
React state

Small scoped dependency/context
        ↓
React Context

Complex cross-feature client-owned state
        ↓
Approved global state library (optional)
```

State colocation: state در نزدیک‌ترین نقطه مصرف بماند؛ بالا‌بردن فقط برای اشتراک واقعی مجاز است. داده مشتق در render محاسبه می‌شود و یک داده نباید با کپی و همگام‌سازی دستی چند منبع حقیقت پیدا کند.

پروژه Redux Toolkit، Zustand یا MobX را الزام یا ممنوع نمی‌کند. وقتی state پیچیده و client-owned از مرز چند feature عبور کند و local state یا Context دیگر نگه‌داری‌پذیر نباشد، یک گزینه با تصمیم معماری و مطابق ADR-0002/AR-30 انتخاب و به‌صورت یکپارچه استفاده می‌شود؛ چند کتابخانه global state رقیب بدون توجیه معماری مجاز نیست. داده بکند حتی در آن حالت در TanStack Query باقی می‌ماند.

refetchOnWindowFocus: پیش‌فرض خاموش (در فرم‌های مالی، رفرش غافلگیرانه ممنوع)؛ per-query برای گزارش‌ها فعال‌سازی آگاهانه.
۶) لایه API و همزمانی
axios واحد + interceptor: 401 → login با حفظ مقصد؛ نگاشت کد خطا به پیام فارسی.
queryOptions factory per-entity؛ queryKey: [ماژول, entity, پارامترها].
invalidation هدفمند بعد از mutation؛ پاک‌کردن کل کش ممنوع.
staleTime پیش‌فرض: داده پایه ۵ دقیقه · لیست عملیاتی ۳۰ ثانیه · پس از mutation همان entity، invalidate فوری.
Race: واکشی وابسته به پارامتر متغیر = AbortController (signal) + latest-wins؛ جست‌وجو debounce ~۳۰۰ms با util مرکزی.
Retry: فقط GET، حداکثر ۲، exponential. auto-retry برای mutation مطلقاً ممنوع —retry دستی کاربر با همان operationKey (قرارداد Idempotency بکند).
Optimistic update برای عملیات مالی ممنوع (Posting، Reversal، تخصیص، بستن دوره)؛ UI پس از تأیید سرور.
هر درخواست حالت خطا دارد؛ دکمۀ mutation حین ارسال disabled.
۷) اعداد و تاریخ
formatMoney(value: string) · formatQuantity · formatPercent — ورودی number برای مبلغ = خطا (قرارداد Decimal).
تنظیمات کاربر: ارقام فارسی/لاتین، اعشار per-entity، جداکننده.
tabular-nums · راست‌چین سلول مبلغ · منفی قرمز · جمع bold · گردکردن فقط نمایشی.
**قاعدۀ دائمی تاریخ و زمان (پایه در ADR-0042، سیاست MVP در ADR-0044؛ جزئیات و چک‌لیست در `docs/datetime.md`):** `BusinessDate` یک روز تقویمی canonical از نوع Gregorian و ذخیرۀ PostgreSQL `date` است؛ تجربۀ کاربری MVP ثابت و Jalali-first است و فقط از `ui/patterns/date-input.tsx` و `lib/datetime/` مشترک استفاده می‌کند. اگر یک تاریخ تاریخی معتبر در بازۀ تبدیل Jalali نباشد، مقدار canonical Gregorian بدون رد یا بازنویسی به‌صورت fallback نمایش داده می‌شود؛ این حالت انتخاب تقویم نیست. قراردادهای Gregorian برای API و integration حفظ می‌شوند. `BusinessDate` هرگز `Date` جاوااسکریپت، timestamp نیمه‌شب UTC، روزِ منطقه‌زمانی مرورگر یا تبدیل محلی هر صفحه نیست. `Instant` مقدار واقعی UTC در `timestamptz` است؛ ابتدا با `organization.timeZone` معتبر IANA به زمان محلی تبدیل و سپس Jalali-first نمایش داده می‌شود. هیچ تنظیم انتخاب تقویم برای Organization یا Inventory وجود ندارد. جزئیات/ممیزی باید ثانیه و نام zone به‌همراه offset همان instant را نشان دهد؛ مقدار خام ISO برای تطبیق در دسترس بماند. طبق تأیید مالک محصول در ۲۰۲۶-۱۰-۱۶، ارقام فارسی برای نمایش عادی تاریخ/زمان الزامی است؛ مقادیر canonical/API همچنان ASCII می‌مانند. OQ-02 برای بومی‌سازی اعداد غیرتاریخی و متن باز است. تست مسیر مصرف‌کننده و گارد `scripts/check-date-contract.py` جایگزین ممیزی کل ماژول نیستند. محتوای LTR داخل RTL با span dir="ltr" نمایش داده شود.
۸) DataTable
پایه: TanStack Table + wrapper واحد.

sticky header (+ ستون شرح در جدول عریض) · pagination و sort سمت سرور · sort در URL.
ستون مبلغ: راست‌چین tabular-nums؛ tfoot با تفکیک «جمع صفحه» و «جمع کل».
انتخاب ردیف با شمارنده؛ ستون‌های per-user (فاز ۱ localStorage).
۱۰۰ ردیف همزمان = virtualization.
inline edit فقط پیش‌نویس؛ قطعی فقط مشاهده.
دو empty متمایز: «نتیجه‌ای یافت نشد» ≠ «اولین رکورد را بساز».
۹) فرم
zodResolver + mode: onSubmit؛ defaultValues از داده API؛ پس از ثبت موفق reset با پاسخ سرور.
خطا زیر فیلد؛ خطای سرور: خلاصه بالای فرم با aria-live؛ focus خودکار اولین فیلد نامعتبر.
Dirty guard برای خروج از فرم تغییرکرده.
Enter در گرید ردیف‌ها = ردیف بعدی؛ submit فقط دکمه/Ctrl+S.
اجباری: ستاره + aria-required؛ پس از ثبت سند: هدایت به همان سند (لینک‌پذیر).
۱۰) چهار حالت + خطا
Skeleton با شکل واقعی محتوا؛ spinner تمام‌صفحه ممنوع.
Refetch بدون جابه‌جایی layout.
Empty با CTA؛ Error با پیام معنایی + تلاش دوباره + کد خطا در details.
ErrorBoundary سطح page؛ crash یک صفحه کل اپ را نمی‌اندازد.
403: «دسترسی لازم را ندارید» + مسیر بازگشت؛ انقضای نشست با هشدار و تمدید.
۱۱) تأییدها و عملیات حساس
ConfirmDialog: حذف، Posting، Reversal، Void، بستن دوره.
غیرقابل‌برگشت مالی: ورود اجباری دلیل + نمایش اثر پیش از تأیید («سند ۱۴۰۴-۰۰۱۰ معکوس می‌شود؛ سند معکوس ۱۴۰۴-۰۰۱۰R ایجاد خواهد شد»).
بی‌مجوز: disable + tooltip (OQ-5).
۱۲) Notification
Toast: success/error/info، RTL، حداکثر ۳ همزمان، اکشن اختیاری.
خطای جدی (Conflict): toast + پیام inline همان صفحه.
۱۳) دسترس‌پذیری
HTML معنایی؛ Dialog با focus trap + Escape + بازگشت focus.
label همه inputها؛ اعلام خطای async با aria-live؛ contrast AA؛ focus-visible.
میان‌برها با رجیستری مرکزی + قابل کشف با «؟»؛ Ctrl K جست‌وجو · Alt N سند جدید · Ctrl S ذخیره.
۱۴) Performance
Vazirmatn self-host با subset فارسی (CDN خارجی اتکاپذیر نیست).
Route-level code splitting؛ هر route lazy.
بودجه: JS اولیۀ route ≤ ~250KB gzip · LCP ≤ 2.5s · تعویض صفحه ≤ 300ms حس‌شده.
کتابخانه جدید = بررسی حجم + ADR؛ نمودار فقط lazy.
تصویر bitmap بدون نیاز ممنوع؛ آیکون SVG/sprite.
۱۵) امنیت فرانت
dangerouslySetInnerHTML ممنوع. استثنا فقط با sanitizer مرکزی + ADR.
URL param نامعتبر است؛ ساخت لینک فقط با URLSearchParams؛ never در href خام.
لیست سفید localStorage: theme، density، تنظیمات ستون. توکن و داده کسب‌وکار مطلقاً ممنوع(transport توکن: OQ-7). پیش‌نویس سند: فقط در حافظه/sessionStorage با تصمیم آگاهانه.
Secret در bundle وجود ندارد — کلید هر سرویس ابری فقط سمت بکند.
وابستگی: lockfile commit؛ npm audit در CI (high = fail)؛ کتابخانه جدید همیشه ADR.
۱۶) تست
Testing Trophy: اولویت integration (کامپوننت + MSW) > unit (فرمتر/hook/schema) > E2E.
تست داخلیِ پیاده‌سازی (snapshot جزئیات، assert روی state داخلی) ممنوع؛ فقط رفتار قابل مشاهده کاربر.
data-testid با نام معنایی پایدار (data-testid="doc-row"، "posting-submit")؛ بدون مقدار تصادفی.
Vitest: فرمترها و schemaها؛ Testing Library + MSW: کامپوننت‌های دامنه؛Playwright E2E مسیر حیاتی: login → ثبت سند → posting → reversal → گزارش.
CI: typecheck + lint + test + build از صفر.
۱۷) قواعد ماشینی — Rule as Code
ابزار: ESLint (flat config) + typescript-eslint strict + react-hooks + jsx-a11y + import plugin.

ممنوعیت این سند gate
any @typescript-eslint/no-explicit-any = error
cycle بین ماژول‌ها import/no-cycle = error
deps ناقص hook react-hooks/exhaustive-deps = error
a11y jsx-a11y = error
کلاس‌های جهت‌دار non-logical grep در CI روی فایل‌های تغییرکرده
hex/rgb مستقیم grep در CI + مرجع توکن
toLocaleString/فرمت دستی خارج src/shared/lib/format grep در CI
رشتۀ فارسی در JSX grep در CI (فایل‌های i18n مستثنی)
ترتیب import eslint-plugin-import
prettier-plugin-tailwindcss برای ترتیب کلاس‌ها.
هدف: خروجی بازبینی انسانی به منطق و دامنه برسد، نه خطاهای قابل ماشین.
۱۸) Git و PR
Conventional commits: feat|fix|docs|refactor|test|chore(scope): خلاصه.
Branch: feat/task-NN-… · fix/… · docs/… (هرگز روی main).
PR هدف ≤ ~۴۰۰ خط تغییر؛ بزرگ‌تر = تقسیم تسک.
قالب PR: لینک تسک + چک‌لیست DoD + اسکرین‌شات چهار حالت + شواهد تست.
Self-review: Agent قبل از submit، diff خودش را یک‌بار کامل می‌خواند و موارد آشکار را اصلاح می‌کند.
حین بازبینی: commit جدید ترجیح دارد بر force-push.
۱۹) i18n و لحن فارسی
کلید معنادار؛ لحن رسمی-ساده، خطاب «شما»؛فرمول خطا: چه شد + چه کنید («مانده قابل تخصیص کافی نیست — مبلغ کمتر از ۲٬۵۰۰٬۰۰۰ وارد کنید»).
عدد مالی در جمله: همیشه با فرمتر.
۲۰) DoD هر تسک UI
چهار حالت + اسکرین‌شات هر چهار حالت در گزارش
ریسپانسیو 1280px · کیبورد کامل
صفر فرمت دستی · صفر console error/warn · صفر any جدید
همه درخواست‌ها حالت خطا دارند · mutation بدون دابل‌ارسال
grepهای بخش ۱۷ خالی · import/no-cycle پاک
typecheck + lint + test + build سبز
قالب PR کامل (لینک تسک، شواهد، self-review انجام شد)
۲۱) Open Questions — نیازمند تصمیم مالک (→ ADR)
افزودن calendar-grid picker شمسی (جزئیات اختیاری UI؛ سیاست تقویم Jalali در ADR-0042 پذیرفته شده): react-multi-date-picker یا جایگزین
Dark mode: بله/خیر/سیستم
Density پیش‌فرض: comfortable یا compact
ابزار تولید تایپ OpenAPI: orval یا openapi-typescript
قابلیت بی‌مجوز: disable+tooltip یا hide
تارگت دستگاه: دسکتاپ‌فقط یا موبایل read-only
Token transport: httpOnly cookie یا جایگزین (تصمیم مشترک با بکند)
مانیتورینگ خطا و وب‌وایتال: self-host (GlitchTip) یا مرحله بعد
React Compiler: زمان فعال‌سازی پس از پایداری
## Changelog

- **۲.۳** — ثبت قاعدۀ دائمی ADR-0042 برای جدایی BusinessDate از Instant، تقویم/منطقۀ زمانی سازمان، ورودی مشترک و نمایش جزئیات ممیزی؛ تقویم/منطقۀ زمانی از OQ-02 بومی‌سازی جدا شد.
- **۲.۲** — جایگزینی ممنوعیت Redux/Zustand با سیاست technology-neutral مبتنی بر مالکیت state؛ تثبیت TanStack Query برای server state، React state برای تعامل محلی، Context برای dependency محدود، و امکان انتخاب یک global client-state library در صورت اثبات نیاز. حذف متن دستوریِ ناخواسته از انتهای سند.
- **۲.۱** — افزودن روش ساخت: React craft (بخش ۳)، انضباط TypeScript و DocStatus/ID برندگذاری‌شده (۴)، colocation و state hygiene (۵)، Race/Abort/debounce و ممنوعیت auto-retry mutation (۶)، امنیت فرانت (۱۵)، Testing Trophy و data-testid (۱۶)، Rule-as-Code و gateهای CI (۱۷)، Git/PR و self-review (۱۸)، اصول ۱۱ و ۱۲، OQ-8 و OQ-9، ارتقای DoD.
- **۲.۰** — نگارش کامل اولیه.
