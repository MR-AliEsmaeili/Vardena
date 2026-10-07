# FE-UX-02 — استاندارد بازخورد، Toast و خطای وردنا

**وضعیت:** READY FOR REVIEW — قرارداد پیشنهادی رسمی بازخورد UX
**تاریخ:** 2026-09-29
**نوع تسک:** DESIGN / DOCUMENTATION ONLY
**همراه:** [`persian-ux-writing-standard.md`](./persian-ux-writing-standard.md)

---

## 1. حدود قرارداد و واقعیت فعلی

این سند کانال، تقدم، متن و بازیابی بازخورد را مشخص می‌کند؛ پیاده‌سازی نمی‌کند.

### 1.1 یافته‌های ممیزی

| یافته | وضعیت |
| --- | --- |
| `Alert`، `ApiErrorAlert`، `FormField`، `LoadingState`، `EmptyState` و skeleton وجود دارند. | `CURRENT` |
| login، session bootstrap/expiry، route permission gates، سازمان و خطای section گزارش‌ها وجود دارند. | `CURRENT` |
| Toast primitive/provider وجود ندارد و dependency مرتبط نصب نیست. | `CONTRACT GAP` برای UI فعلی؛ قرارداد این سند برای تسک پیاده‌سازی بعدی است. |
| Confirmation dialog primitive و فرم dirty-guard وجود ندارد. | `CONTRACT GAP` در فرانت‌اند |
| `GlobalExceptionFilter` بکند همه خطاهای API را در envelope استاندارد `{ code, message, details?, correlationId }` قرار می‌دهد؛ `code`ها پایدارند و نگاشت مشخصی به HTTP status دارند. | پیاده‌سازی بکند `CURRENT`؛ قرارداد API برای مصرف فرانت `SUPPORTED` |
| قرارداد field-level اعتبارسنجی بکند به‌شکل `ValidationIssue { field, message, code }` وجود دارد. `field` و `code` داده ماشینی قابل نگاشت‌اند؛ `message` متن canonical فارسی UX نیست. | `SUPPORTED` |
| `message` و `details` هنوز قرارداد سراسری UX برای فارسی‌سازی، business subcode و semantic mapping همه قواعد کسب‌وکار به فیلد ندارند. envelope و error code پایدارند؛ raw `message` متن انسانی در سطح contract است، نه copy نهایی UX. | `CONTRACT GAP` |
| `normalizeApiError()` فرانت برای `ValidationFailed`، `BadRequest`، `BusinessRuleViolation` و `Conflict` ممکن است `body.message` بکند را به UI برساند. این رفتار فعلی فرانت است، نه نشانه آنکه بکند تولیدکننده پیام نهایی UX است. | رفتار پیاده‌سازی `CURRENT`؛ از دید FE-UX-02 یک UX gap و نیازمند تسک کد آینده |
| mutationهای سند حسابداری create/update/issue/finalize/delete/reverse در بکند وجود دارند؛ UI آن‌ها وجود ندارد. | `SUPPORTED` |
| گزارش‌های گردش حساب، دفتر کل، تراز آزمایشی و درخت حساب‌ها در UI وجود دارند. | `CURRENT` |
| انبار در بکند read/write دارد؛ UI فعلی فقط widget خواندنی موجودی در میزکار دارد. | read widget `CURRENT`؛ APIهای انبار `SUPPORTED`؛ UI عملیات انبار آینده است. |
| **افزوده 2026-10-04:** قیمت‌گذاری موجودی در بکند پیاده‌سازی شده است (ADR-0039): `/api/v1/inventory/valuation/*`، کدهای پایدار `inventory.backdated_document`، `inventory.repricing_choice_required`، `inventory.recalculation_too_large`، `inventory.valuation_method_not_implemented`، `inventory.cost_assignment_requires_inbound` و `details` ساختاریافته (`affectedMovements`، `affectedValuedMovements`، `latestMovementDate`). | APIها و کدها `SUPPORTED`؛ **هیچ UI انبار/قیمت‌گذاری ساخته نشده** — جریان‌های §5.3 آینده‌اند |

### 1.2 مرز قرارداد خطا (Contract Boundary)

**API Error Envelope** با **پیام قابل مشاهده کاربر** یک مفهوم نیست. envelope حمل استاندارد خطاست؛ UX mapper و واژه‌نامه فارسی مسئول تصمیم نمایش و copy نهایی‌اند.

| لایه | مسئولیت |
| --- | --- |
| Backend error code | طبقه‌بندی ماشینی خطا |
| Backend details | داده ساختاریافته در صورت وجود |
| Backend message | توضیح انسانی عمومی در سطح contract؛ canonical UX copy نیست |
| Frontend error mapper | تبدیل contract به semantic UX state |
| Persian UX dictionary | متن نهایی قابل مشاهده کاربر |
| Correlation ID | پشتیبانی و diagnosis؛ علت خطا نیست |

برای رفع FE-UX-02، بکند نباید صرفاً متن فارسی را جایگزین `message` کند. اگر تشخیص دقیق‌تر rule به داده ماشینی تازه‌ای نیاز دارد، business subcode یا schema ساختاریافته باید در یک تسک قرارداد/API و در صورت لزوم ADR آینده تعریف و به‌عنوان `CONTRACT GAP` پیگیری شود. این سند هیچ تغییر API را مجاز یا پیاده‌سازی نمی‌کند.

### 1.3 اصل کانال واحد

هر رویداد قابل مشاهده کاربر یک **کانال اصلی** دارد. کانال دوم فقط اگر نقش متفاوت و مستند داشته باشد مجاز است؛ متن تکراری ممنوع است. مثال مجاز: در conflict جدی، Toast کوتاه تغییر وضعیت را فوراً اعلام می‌کند و alert درون فرم راه بازیابی را پایدار نگه می‌دارد. این استثنا الزام `standards.md` §۱۲ را برآورده می‌کند.

## 2. معماری تصمیم بازخورد

### 2.1 اصل رسمی تصمیم‌گیری خطا

> **Error code، منبع تصمیم UX است؛ raw message، منبع copy نهایی UX نیست.**

ترتیب تصمیم الزامی است:

1. frontend ابتدا با `code`، طبقه و semantic state خطا را تعیین می‌کند؛ هرگز با جست‌وجو در متن `message` تصمیم نمی‌گیرد.
2. اگر `details` دارای schema شناخته‌شده، مستند و allow-listed باشد، mapper از داده ساختاریافته برای تشخیص دقیق‌تر rule یا field استفاده می‌کند.
3. اگر mapping معتبر وجود نداشته باشد، پیام عمومی، امن و مخصوص همان operation از Persian UX dictionary نمایش داده می‌شود.
4. raw backend `message` بدون تصمیم و mapping صریح نباید وارد UI نهایی شود؛ انسانی‌بودن متن contract به معنی UX-safe، فارسی یا canonical بودن آن نیست.
5. `correlationId` فقط مرجع پشتیبانی و diagnosis است؛ دلیل خطا، متن خطا یا کلید تصمیم UX نیست.

### 2.2 درخت تصمیم

```text
رویداد رخ داد
│
├─ درخواست عمداً با navigation جدید لغو شد؟ ── بله → بدون پیام
│
├─ نشست معتبر نیست/وسط کار منقضی شد؟ ─────── بله → جریان یکتای انقضای نشست
│
├─ ورودی کاربر نامعتبر است؟
│  ├─ قابل انتساب به فیلد ────────────────────→ خطای inline + focus نخستین فیلد
│  └─ وابسته به چند فیلد/کل فرم ─────────────→ خلاصه فرم + inline فیلدهای مرتبط
│
├─ عمل حساس/مخرب/برگشت‌ناپذیر هنوز آغاز نشده؟ → dialog تأیید پیامدمحور
│
├─ درخواست خواندنی در حال اجراست؟ ───────────→ skeleton/loading در همان سطح
│
├─ درخواست خواندنی موفق و بدون داده است؟ ───→ empty state، نه خطا و نه Toast
│
├─ page/section بارگذاری نشد؟ ───────────────→ خطای پایدار همان page/section + بازیابی
│
├─ mutation موفق شد؟ ────────────────────────→ Toast موفقیت پس از پاسخ بکند
│
├─ mutation شکست خورد؟
│  ├─ validation ─────────────────────────────→ inline/خلاصه فرم
│  ├─ business rule یا conflict ─────────────→ alert نزدیک عمل؛ dialog باز می‌ماند
│  ├─ permission ─────────────────────────────→ feedback سطح عمل، بدون generic Toast
│  └─ شبکه/سرور بدون جای پایدار ─────────────→ Toast خطا؛ در فرم/صفحه alert ترجیح دارد
│
└─ اطلاع کوتاه و غیرمسدودکننده؟ ─────────────→ Toast اطلاعاتی؛ اگر ماندگاری لازم است alert
```

### 2.3 جدول تصمیم رسمی

| محرک | کانال اصلی | ماندگاری | CTA | Toast هم‌زمان؟ |
| --- | --- | --- | --- | --- |
| خطای یک فیلد | inline | تا اصلاح/ارسال معتبر | focus فیلد | خیر |
| خطای چند فیلد | خلاصه فرم + inline مرتبط | تا اصلاح | رفتن به نخستین خطا | خیر |
| عمل غیرقابل‌برگشت | dialog قبل از mutation | تا تصمیم | فعل دقیق + `لغو` | خیر |
| mutation موفق | Toast success | گذرا | اختیاری: مشاهده نتیجه | فقط همین |
| mutation business failure | alert فرم/dialog | تا اصلاح/لغو | اصلاح داده | خیر |
| query page شکست‌خورده | page error | پایدار | `تلاش دوباره`/بازگشت | خیر |
| query یک widget شکست‌خورده | section error | پایدار در همان widget | `تلاش دوباره` | خیر |
| query موفق با صفر ردیف | empty state | تا تغییر داده/فیلتر | تغییر فیلتر یا create معتبر | خیر |
| loading | skeleton/label همان سطح | تا اتمام | معمولاً خیر؛ cancel فقط اگر پشتیبانی شود | خیر |
| route 403 | permission state/page | پایدار | بازگشت | خیر |
| action 403 | alert نزدیک action | پایدار تا اقدام بعدی | بستن/بازگشت | خیر |
| mid-session 401 | session-expiry flow | تا login | `ورود` | فقط یک اعلان در صفحه login، نه Toastهای متعدد |
| background job تمام شد | Toast info/success | گذرا/تا اقدام | مشاهده/دریافت | بله؛ فقط اگر job واقعاً وجود دارد |
| navigation عادی | هیچ | — | — | خیر |
| request abort بر اثر navigation/latest-wins | هیچ | — | — | خیر |

## 3. استاندارد Toast

### 3.1 موارد استفاده

Toast برای رویداد کوتاه، تکمیل‌شده و غیرمسدودکننده است:

- موفقیت mutation پس از پاسخ موفق سرور؛
- تکمیل عملیات پس‌زمینه‌ای که کاربر دیگر روی سطح آغازکننده نیست؛
- اطلاع غیرحیاتی که برای ادامه نیاز به تصمیم ندارد؛
- خطای mutation فقط وقتی سطح پایدار مناسبی وجود ندارد و خطا field/business/permission/session نیست.

### 3.2 گونه‌ها

| گونه | کاربرد | مدت پیش‌فرض |
| --- | --- | --- |
| success | mutation واقعاً موفق | ۴ ثانیه |
| info | اطلاع یا تکمیل پس‌زمینه | ۵ ثانیه |
| warning | وضعیت قابل توجه ولی غیرمسدودکننده | ۶ ثانیه |
| error | شکست گذرای action بدون سطح پایدار | ۸ ثانیه؛ با pause |

مدت صرفاً پیش‌فرض است. Toast دارای action یا متن نیازمند خواندن حداقل ۸ ثانیه می‌ماند. خطای حیاتی نباید فقط Toast باشد؛ به state پایدار ارتقا می‌یابد.

### 3.3 قواعد رفتاری

- حداکثر **۳ Toast قابل مشاهده**؛ جدیدترین در انتهای منطقی container و ترتیب خواندن قابل پیش‌بینی.
- Toastهای یکسان با کلید رویداد (`kind + operation + entity`) در بازه ۱۰ ثانیه deduplicate می‌شوند؛ شمارنده تکرار می‌تواند نشان داده شود.
- action مالی mutation به‌طور خودکار retry نمی‌شود. دکمه `تلاش دوباره` فقط همان intent و operation key معتبر را دوباره می‌فرستد.
- success پیش از پاسخ بکند، در optimistic state یا فقط پس از click ممنوع است.
- dismiss دستی برای همه Toastها وجود دارد؛ hover، focus و تعامل countdown را متوقف می‌کند.
- dismiss کردن پیام، عملیات را undo نمی‌کند. `واگرد` فقط اگر قرارداد واقعی undo وجود داشته باشد؛ اکنون برای اسناد مالی وجود ندارد.
- تغییر route Toast مرتبط با mutation را می‌تواند نگه دارد؛ navigation عادی Toast تولید نمی‌کند.
- logout موفق در جریان عادی می‌تواند بدون Toast و با انتقال به login تمام شود؛ اگر پیام لازم است، یک notice صفحه login کافی است.

### 3.4 Toast ممنوع

Toast نباید تنها کانال این موارد باشد:

- خطای required/format/range فرم؛
- query page/section failure؛
- empty state یا loading؛
- route-level 403/404؛
- انقضای نشست؛
- موفقیت GET، تغییر route، باز شدن dialog، انتخاب tab یا اعمال sort؛
- عمل عادی client-only؛
- پیام چندمرحله‌ای یا پیام دارای پیامد حقوقی/مالی؛
- همان خطایی که inline یا page alert آن را با همان متن نمایش می‌دهد.

### 3.5 دسترس‌پذیری Toast

- container success/info: `role=status` و `aria-live=polite`؛ warning/error فوریتی: `role=alert`/`aria-live=assertive` با احتیاط.
- هر Toast یک بار announce می‌شود؛ update شمارنده نباید متن کامل را پی‌درپی بخواند.
- focus خودکار به Toast منتقل نمی‌شود. action آن با Tab قابل دسترسی و dismiss با دکمه نام‌دار است؛ Escape فقط Toast دارای focus را می‌بندد، نه همه را.
- icon + عنوان/متن معنا را می‌رسانند؛ رنگ به‌تنهایی ممنوع.
- RTL برای جمله، و `dir=ltr` مستقل برای شناسه/عدد فنی.

## 4. اعتبارسنجی Inline و فرم

### 4.1 زمان نمایش

- mode پایه مطابق standards و پیاده‌سازی: `onSubmit`.
- پس از اولین submit ناموفق، هر فیلد لمس‌شده هنگام blur یا تغییرِ معنادار دوباره ارزیابی می‌شود.
- خطا پس از اصلاح معتبر همان فیلد بی‌درنگ حذف می‌شود؛ خطای وابسته پس از معتبرشدن همه وابستگی‌ها.
- هنگام submit ناموفق، focus به نخستین فیلد نامعتبر در ترتیب DOM منتقل و خلاصه فرم announce می‌شود.
- required با ستاره بصری و `aria-required=true` پیشاپیش مشخص می‌شود؛ پیام فقط پس از زمان اعتبارسنجی.

### 4.2 انواع و متن

| نوع | الگو/نمونه | کانال |
| --- | --- | --- |
| required | `تاریخ سند الزامی است.` | زیر فیلد |
| format | `کد حساب فقط می‌تواند شامل رقم باشد.` | زیر فیلد |
| date format | `تاریخ سند معتبر نیست. تاریخ را با قالب YYYY-MM-DD وارد کنید.` | زیر فیلد |
| range | `مبلغ باید بزرگ‌تر از صفر باشد.` | زیر فیلد |
| amount precision | `مبلغ حداکثر می‌تواند ۲ رقم اعشار داشته باشد.` | زیر فیلد؛ عدد precision باید از قرارداد بیاید |
| date dependency | `تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.` | زیر `تا تاریخ` و خلاصه فرم در صورت submit |
| duplicate | `این شماره سند قبلاً استفاده شده است.` | فیلد اگر backend آن را دقیق map کند؛ وگرنه form alert |
| dependent field | `دوره مالی باید متعلق به سال مالی انتخاب‌شده باشد.` | فیلد دوره + خلاصه فرم |
| line composition | `حداقل دو ردیف برای سند لازم است.` | نزدیک grid + خلاصه فرم |
| debit/credit XOR | `در هر ردیف فقط یکی از مبلغ‌های بدهکار یا بستانکار باید وارد شود.` | همان ردیف |
| unbalanced | `جمع بدهکار و بستانکار سند برابر نیست.` | خلاصه grid/form؛ مقدار authoritative فقط از backend |

### 4.3 نگاشت خطای سرور و `ValidationIssue`

بکند فعلی برای خطای اعتبارسنجی قرارداد ساختاریافته زیر را دارد:

```text
ValidationIssue { field, message, code }
```

نقش هر عضو متفاوت است:

- `field`: مسیر ماشینی فیلد و ورودی نگاشت به label فارسی؛ فقط pathهای allow-listed و واقعاً شناخته‌شده map می‌شوند.
- `code`: نام ماشینی constraint مانند `isString` یا `min` و ورودی نگاشت به الگوی پیام فارسی.
- `message`: توضیح انسانی contract؛ منبع canonical Persian UX copy نیست و مستقیم نمایش داده نمی‌شود.

قواعد نگاشت:

1. فقط `details` با schema شناخته‌شده و field path allow-list به فیلد map می‌شود.
2. path فنی به label فارسی و row index یک‌مبنایی قابل فهم تبدیل می‌شود. برای مثال `lines.0.quantity` فقط در صورت وجود mapping واقعی می‌تواند به `مقدار ردیف ۱` تبدیل شود؛ mapper نباید label یا معنای فیلد ناشناخته را حدس بزند.
3. `code` شناخته‌شده به متن Persian UX dictionary نگاشت می‌شود. نه `ValidationIssue.message` و نه متن انگلیسی آن مستقیماً copy نهایی نیست.
4. issue ناشناخته در خلاصه فرم با پیام عمومی و امن همان operation نمایش داده می‌شود؛ raw payload فقط در logging امن و سازوکار پشتیبانی مجاز است.
5. duplicate یا business validation فقط وقتی inline می‌شود که API، field و subcode ساختاریافته و مستند بدهد.

**مرز فعلی:** field-level schema برای `ValidationIssue`، `SUPPORTED` است. business-rule field mapping و business subcode یکنواخت هنوز `CONTRACT GAP` هستند. رفتار `CURRENT` فرانت که ممکن است `body.message` را عبور دهد یک UX gap است؛ این رفتار envelope پایدار بکند را به پیام canonical UX تبدیل نمی‌کند.

### 4.4 جلوگیری از duplication

اگر خطا به فیلد map شد، Toast ممنوع است. خلاصه فرم می‌تواند بگوید `۳ مورد نیاز به اصلاح دارد.` و فیلدها جزئیات را بدهند؛ این تکرار نیست، دو نقش متفاوت (پیمایش و توضیح) است.

## 5. Confirmation Dialog

### 5.1 معیار استفاده

Dialog اجباری است برای:

- نهایی‌سازی سند (`SUPPORTED` backend، future UI)؛
- معکوس کردن سند قطعی (`SUPPORTED` backend، future UI)؛
- بستن/مهروموم کردن سال یا دوره مالی (`SUPPORTED` backend، future UI)؛
- حذف واقعی سند پیش‌نویس/موقت (`SUPPORTED` backend، future UI)؛
- هر عملیات غیرقابل‌برگشت یا با اثر مالی/دامنه وسیع؛
- ثبت سند انبار با تاریخ گذشته (`SUPPORTED` backend، future UI) — **دو dialog جداگانه و پشت‌سرهم**، نه یک dialog ترکیبی؛
- قیمت‌گذاری مجدد موجودی و ثبت قیمت تمام‌شده روی رسید بدون قیمت (`SUPPORTED` backend، future UI)؛
- تغییر سازمان با تغییرات ذخیره‌نشده (`CONTRACT GAP` dirty guard)؛
- خروج با تغییرات ذخیره‌نشده (`CONTRACT GAP` dirty guard).

Dialog برای save عادی، اعمال فیلتر، navigation بدون dirty state، login/logout بدون داده ذخیره‌نشده، enable/disable کم‌اثرِ قابل بازگشت (مگر قرارداد خلاف آن بگوید) و GET ممنوع است.

### 5.2 ساختار و رفتار

هر dialog دارد: **عنوان، توضیح، پیامد، عمل اصلی، لغو، loading، failure و success feedback**.

- focus اولیه روی `لغو` برای اعمال پرخطر؛ در حذف کم‌خطر می‌تواند طبق الگوی component باشد، اما هرگز خودکار submit نشود.
- action هنگام ارسال disabled و label جاری (`در حال نهایی‌سازی…`)؛ double submit ممنوع.
- Escape و close icon فقط پیش از شروع یا وقتی لغو request امن است؛ هنگام mutation وضعیت روشن باشد.
- در failure dialog باز می‌ماند و alert پایدار داخل آن نمایش داده می‌شود؛ کاربر reason/data را از دست نمی‌دهد.
- در success dialog بسته، focus به trigger/نتیجه مرتبط برمی‌گردد و Toast success نشان داده می‌شود.

### 5.3 کاتالوگ dialog

| عمل/وضعیت | عنوان | توضیح و پیامد | اصلی / لغو | failure | success |
| --- | --- | --- | --- | --- | --- |
| نهایی‌سازی سند — `SUPPORTED` | `نهایی‌سازی سند` | `پس از نهایی‌سازی، ویرایش مستقیم این سند امکان‌پذیر نیست و سند وارد دفاتر می‌شود.` | `نهایی‌سازی` / `لغو` | alert در dialog | `سند قطعی شد.` Toast |
| معکوس کردن — `SUPPORTED` | `معکوس کردن سند` | `یک سند معکوس جدید ایجاد می‌شود و سند اصلی حذف یا ویرایش نمی‌شود. دلیل معکوس کردن الزامی است.` | `ایجاد سند معکوس` / `لغو` | inline دلیل + alert | `سند معکوس ایجاد شد.` Toast |
| بستن دوره — `SUPPORTED` | `بستن دوره مالی` | `پس از بستن دوره، ثبت و نهایی‌سازی سند در این دوره متوقف می‌شود. بازگشایی به مجوز و دلیل نیاز دارد.` | `بستن دوره` / `لغو` | alert | `دوره مالی بسته شد.` Toast |
| مهروموم سال — `SUPPORTED` | `مهروموم کردن سال مالی` | `سال مالی و مبنای گزارش‌های آن تثبیت می‌شود. بازگشایی فقط با مجوز جداگانه و ثبت دلیل ممکن است.` | `مهروموم کردن` / `لغو` | alert | `سال مالی مهروموم شد.` Toast |
| حذف سند غیرقطعی — `SUPPORTED` | `حذف سند` | `این سند غیرقطعی حذف می‌شود. اگر شماره‌ای تخصیص یافته باشد، سابقه تخصیص آن باقی می‌ماند.` | `حذف سند` / `لغو` | alert | `سند حذف شد.` Toast |
| تغییر سازمان با dirty state — `CONTRACT GAP` | `تغییر سازمان` | `تغییرات ذخیره‌نشده این صفحه از دست می‌رود. پیش از تغییر سازمان، اطلاعات را ذخیره کنید یا بدون ذخیره ادامه دهید.` | `تغییر بدون ذخیره` / `لغو`؛ action ذخیره فقط اگر واقعی | بدون mutation در dialog | notice سازمان پس از تغییر |
| خروج با dirty state — `CONTRACT GAP` | `خروج از وردنا` | `تغییرات ذخیره‌نشده این صفحه از دست می‌رود.` | `خروج بدون ذخیره` / `لغو` | alert logout در صورت شکست سیاست‌گذاری‌شده | redirect؛ پیام اضافی اختیاری |
| سند انبار با تاریخ گذشته — گام ۱ پذیرش پیامد — `CURRENT` (`inventory.backdated_document` از POST یا از `backdate-check` پیش از ارسال) | `سند با تاریخ گذشته` | `تاریخ این سند پیش از آخرین گردش ثبت‌شده برای این کالا در این انبار است. {affectedMovements} گردش بعدی ({affectedValuedMovements} گردش قیمت‌گذاری‌شده) ممکن است دیگر با قیمت تمام‌شده درست محاسبه نشده باشند. ثبت این سند مجاز است، اما تا زمانی که قیمت‌گذاری مجدد انجام نشود، ارزش این کالا در این انبار نامعتبر می‌ماند.` | `ادامه و انتخاب نحوه قیمت‌گذاری` / `لغو` | alert در dialog | بدون Toast؛ مستقیم به گام ۲ |
| سند انبار با تاریخ گذشته — گام ۲ انتخاب قیمت‌گذاری — `CURRENT` (`inventory.repricing_choice_required` از POST یا از `backdate-check` پیش از ارسال) | `قیمت‌گذاری مجدد این کالا و انبار` | `یکی از دو گزینه را انتخاب کنید. هیچ‌کدام پیش‌فرض نیست و سیستم به‌تنهایی تصمیم نمی‌گیرد.` + دو گزینه رادیویی: `قیمت‌گذاری مجدد انجام شود — ارزش این کالا در این انبار دوباره از ابتدای گردش‌ها محاسبه می‌شود؛ ارقام گزارش‌های قبلی این کالا و انبار تغییر می‌کند.` و `انجام نشود — سند ثبت می‌شود و ارزش فعلی دست‌نخورده می‌ماند، اما با برچسب «ارزش‌گذاری نامعتبر» نمایش داده می‌شود تا بعداً اصلاح شود.` | `ثبت سند` (فقط پس از انتخاب یک گزینه) / `لغو` | alert در dialog؛ انتخاب کاربر حفظ می‌شود | `رسید انبار ثبت شد.` + در حالت عدم قیمت‌گذاری، notice پایدار `ارزش‌گذاری این کالا و انبار نامعتبر است.` |
| قیمت‌گذاری مجدد دستی — `CURRENT` (`POST /inventory/valuation/recalculations`؛ فقط روی کلید «نامعتبر» در کارفهرست ارزش‌گذاری و از داخل notice پایدار) | `قیمت‌گذاری مجدد` | `ارزش این کالا در این انبار از ابتدای گردش‌ها دوباره محاسبه می‌شود. ارقام ارزش در گزارش‌های این کالا و انبار تغییر می‌کند؛ مقدار موجودی تغییر نمی‌کند.` | `قیمت‌گذاری مجدد` / `لغو` | alert؛ در `inventory.recalculation_too_large` متن محدوده و اقدام جایگزین | `قیمت‌گذاری مجدد انجام شد. {movementsRevalued} گردش به‌روزرسانی شد.` Toast |
| ثبت قیمت تمام‌شده برای رسید بدون قیمت — `SUPPORTED` backend (`POST /inventory/valuation/movements/{id}/cost`)، future UI | `ثبت قیمت تمام‌شده` | `این مبلغ به رسیدِ بدون قیمت افزوده می‌شود و پس از ثبت قابل ویرایش نیست؛ اصلاح آن فقط با معکوس کردن رسید ممکن است. سپس باید مشخص کنید قیمت‌گذاری مجدد انجام شود یا خیر.` | `ثبت قیمت تمام‌شده` / `لغو` | alert؛ در ۴۰۹ متن «این رسید قیمت دارد» با راهنمای معکوس کردن | `قیمت تمام‌شده ثبت شد.` Toast |

### 5.4 قاعده دو تأیید مستقل برای سند با تاریخ گذشته (ADR-0039 / OD-VAL-10، OD-VAL-11)

این قاعده استثنای صریح بر «یک dialog برای یک عمل» است و ادغام آن مجاز نیست:

1. **گام ۱ — پذیرش پیامد.** کاربر باید بداند *چه چیزی* تحت تأثیر قرار می‌گیرد: تعداد گردش‌های بعدی و تعداد گردش‌های قیمت‌گذاری‌شده‌ای که ممکن است نادرست شده باشند، به‌همراه تاریخ آخرین گردش. متن باید برای کسی که حسابدار نیست قابل فهم باشد؛ `آیا مطمئنید؟` ممنوع است.
2. **گام ۲ — انتخاب قیمت‌گذاری.** پرسش متفاوتی است و **هیچ گزینه‌ای از پیش انتخاب نشده**. هر دو گزینه باید پیامد خود را بگویند؛ نبود انتخاب یعنی عدم ارسال درخواست.

قواعد الزامی UI:

- دکمه گام ۱ هرگز عمل نهایی را انجام نمی‌دهد؛ فقط گام ۲ را باز می‌کند.
- اگر کاربر `انجام نشود` را انتخاب کرد، پس از موفقیت باید notice پایدار `ارزش‌گذاری این کالا و انبار نامعتبر است.` با اقدام `قیمت‌گذاری مجدد` نمایش داده شود. پنهان کردن این وضعیت ممنوع است.
- `قیمت‌گذاری مجدد` فقط روی **یک کالا در یک انبار** اجرا می‌شود؛ UI نباید عمل «قیمت‌گذاری مجدد همه» بسازد، چون چنین APIای وجود ندارد و عمداً وجود ندارد (OD-VAL-12).
- پیش از ثبت، صفحه می‌تواند با `GET /inventory/valuation/backdate-check` همین اعداد را بدون نیاز به مجوز مشاهده مبلغ دریافت کند؛ این فراخوانی فقط تعداد و تاریخ برمی‌گرداند.
- اگر کاربر مجوز `Inventory.Valuation.View` نداشته باشد، ستون‌های مبلغ خالی‌اند اما وضعیت (`در انتظار قیمت تمام‌شده` / `ارزش‌گذاری نامعتبر`) همچنان نمایش داده می‌شود؛ مخفی کردن وضعیت ممنوع است.

## 6. خطای Page و Section

### 6.1 انتخاب سطح

- **Page-level:** داده اصلی یا bootstrap لازم شکست خورده و هدف صفحه قابل انجام نیست.
- **Section-level:** فقط widget/table مستقل شکست خورده و سایر بخش‌ها سالم‌اند.
- layout قبلی در refetch حفظ می‌شود؛ error state نباید کل صفحه را برای شکست یک widget جایگزین کند.
- عنوان، عمل را نام می‌برد؛ body نوع خطا و recovery را می‌گوید.

### 6.2 نگاشت HTTP/API

| وضعیت API | متن اصلی نمونه | جزئیات فنی | retry/بازیابی | سطح |
| --- | --- | --- | --- | --- |
| GET network/timeout | `دریافت گزارش انجام نشد. اتصال شبکه را بررسی کرده و دوباره تلاش کنید.` | status/raw ممنوع؛ correlation اگر وجود داشت | `تلاش دوباره` دستی | page/section |
| 401 initial `/auth/me` | پیام خطا نیست؛ کاربر وارد نشده و به login می‌رود | هیچ | `ورود` | auth flow |
| 401 mid-session | `نشست شما منقضی شده است. لطفاً دوباره وارد شوید.` | هیچ | login و بازگشت امن | session flow |
| 403 | `شما مجوز مشاهده این بخش را ندارید.` | permission code فقط details پشتیبانی | retry خیر؛ `بازگشت` | permission state |
| 404 entity | `مورد درخواست‌شده یافت نشد یا در دامنه دسترسی شما نیست.` | ID در primary copy نه؛ اگر خود کاربر وارد کرده در context مجاز | بازگشت به فهرست | page/section |
| 404 route | `صفحه پیدا نشد. نشانی درخواست‌شده در وردنا وجود ندارد.` | route خام تکرار نشود | `بازگشت به صفحه اصلی` | page |
| 409 query | `اطلاعات این صفحه تغییر کرده است. صفحه را تازه‌سازی کنید.` | correlation اختیاری | `دریافت نسخه جدید` | section/page |
| 422 query/filter | `فیلترهای گزارش معتبر نیستند. موارد مشخص‌شده را اصلاح کنید.` | field map | focus فیلتر | form/section |
| 429 | `تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.` | retryAfter فقط اگر معتبر، به متن قابل فهم | CTA پس از زمان اعلام‌شده؛ auto-loop ممنوع | page/section/banner |
| 500+ / ServiceUnavailable | `دریافت اطلاعات انجام نشد. لطفاً دوباره تلاش کنید.` | کد پیگیری مجاز | retry دستی؛ پشتیبانی در تکرار | page/section |
| unknown/non-envelope | `دریافت اطلاعات انجام نشد. لطفاً دوباره تلاش کنید.` | raw ممنوع | retry | page/section |
| RequestAborted | هیچ پیام | هیچ | خودکار latest-wins | هیچ |
| 422 `inventory.backdated_document` | dialog گام ۱ (بالا) — پیام خطای خام نمایش داده نمی‌شود | `affectedMovements`، `affectedValuedMovements`، `latestMovementDate` به متن فارسی تبدیل می‌شوند | ادامه با تأیید کاربر | dialog |
| 422 `inventory.repricing_choice_required` | dialog گام ۲ (بالا) | همان جزئیات | ادامه پس از انتخاب صریح | dialog |
| 422 `inventory.recalculation_too_large` | `تعداد گردش‌های این کالا در این انبار بیش از حد مجاز یک بار قیمت‌گذاری مجدد است. با پشتیبانی تماس بگیرید تا در بازه‌های کوچک‌تر انجام شود.` | سقف مجاز در جزئیات | retry خودکار ممنوع | dialog/section |
| 422 `inventory.valuation_method_not_implemented` | `این روش قیمت‌گذاری در این نسخه پشتیبانی نمی‌شود. تنها روش فعال، میانگین موزون متحرک است.` | نام روش فقط در جزئیات | انتخاب روش معتبر | form |
| 422 `inventory.cost_assignment_requires_inbound` | `ثبت مستقیم قیمت تمام‌شده فقط برای رسید انبار ممکن است؛ ارزش صادره از روش قیمت‌گذاری محاسبه می‌شود.` | هیچ | راهنمایی به رسید مربوط | form |
| 422 `inventory.insufficient_stock` | `امکان ثبت عملیات انبار وجود ندارد؛ زیرا موجودی قابل استفاده کافی نیست. مقدار را کاهش دهید یا موجودی رزروشده را بررسی کنید. موجودی فعلی: {onHand} — مقدار درخواستی: {requested}.` | `onHand`/`requested` (رشته اعشاری مبنای واحد مبنا) به فارسی تبدیل می‌شوند؛ raw ممنوع | کاهش مقدار یا بررسی رزرو | form alert |
| 422 `inventory.backdated_document` (انتقال؛ C-59C) | `انتقال با تاریخ پیش از آخرین گردش این کالا در یکی از دو انبار، فقط پس از تأیید صریح ثبت می‌شود و به مجوز «قیمت‌گذاری مجدد» نیاز دارد؛ ارزش هر دو انبار از تاریخ انتقال بازمحاسبه می‌شود. تاریخ گردش را اصلاح کنید یا با کاربر دارای این مجوز هماهنگ کنید.` | `keys` (هر کلید: انبار + آخرین تاریخ گردش) و `movementDate` به متن فارسی تبدیل می‌شوند؛ کد بازنشستهٔ `inventory.backdated_transfer_valuation_unresolved` دیگر تولید نمی‌شود | اصلاح تاریخ گردش؛ یا ارسال با `backdateConfirmed` توسط دارندهٔ مجوز | form alert (dialog گام‌به‌گام انتقال: پیگیری UI ثبت‌شده) |
| 409 قیمت تکراری روی گردش | `برای این رسید قیمت تمام‌شده ثبت شده است و ویرایش نمی‌شود. برای اصلاح، رسید را معکوس و دوباره ثبت کنید.` | شناسه گردش فقط در جزئیات | مسیر معکوس کردن | dialog |
| 422 `costInputAmbiguous` / `costNotAcceptedForMovementType` / `costPrecisionExceeded` | به‌ترتیب: `فقط یکی از «قیمت واحد» یا «قیمت کل» را وارد کنید.` · `برای این نوع گردش، قیمت تمام‌شده پذیرفته نمی‌شود.` · `مبلغ واردشده بیش از دو رقم اعشار دارد؛ مبلغ گرد نمی‌شود و باید دقیق وارد شود.` | `field` از `ValidationIssue` | focus روی فیلد | inline |

Correlation ID فقط اگر از پاسخ معتبر آمده نمایش داده می‌شود: `کد پیگیری: «…»`. ID ساختگی، `unknown` یا stack trace نمایش داده نمی‌شود.

### 6.3 ErrorBoundary

crash رندر page باید state امن page-level با `بارگذاری دوباره صفحه` و کد ثبت‌شده سمت monitoring (در صورت وجود) بدهد. سامانه monitoring فعلاً `FUTURE PRODUCT DECISION` است؛ UI نباید کد خیالی بسازد.

## 7. Empty و Loading

### 7.1 Empty

empty فقط نتیجه موفق با صفر داده است، نه network error، نه scope ناقص.

| حالت | متن | CTA |
| --- | --- | --- |
| first-use | `هنوز سندی ثبت نشده است.` | `ثبت سند` فقط اگر UI/مجوز واقعی موجود؛ فعلاً UI سند `SUPPORTED` و CTA در فرانت جاری نباید فعال باشد |
| filtered | `برای فیلترهای انتخاب‌شده نتیجه‌ای یافت نشد.` | `پاک کردن فیلترها` |
| missing scope | `برای نمایش گزارش، حوزه مالی و سال مالی را انتخاب کنید.` | focus نخستین scope |
| no accessible organization | `سازمانی در دسترس نیست. دسترسی سازمانی خود را بررسی کنید.` | مسیر مدیر فقط طبق سیاست deployment |
| no account | `برای این سازمان حسابی ثبت نشده است.` | CTA ساخت فقط در UI آینده |

### 7.2 Loading

- skeleton شکل واقعی محتوا را حفظ می‌کند؛ spinner تمام‌صفحه فقط bootstrap/session و route transition بدون shell.
- label دقیق: `در حال دریافت تراز آزمایشی…`، `در حال ذخیره سند…`.
- `aria-busy=true` روی region و `aria-live=polite` برای تغییر معنادار؛ skeletonها تک‌تک announce نمی‌شوند.
- refetch، داده قبلی را بی‌دلیل پاک نمی‌کند و layout shift نمی‌سازد.
- submit button disabled؛ عملیات مالی auto-retry نمی‌شود.
- loading طولانی نباید درصد ساختگی نشان دهد. progress عددی فقط با قرارداد واقعی progress.

## 8. مجوز و دسترسی

### 8.1 Route-level denial

- پیام: `شما مجوز مشاهده این بخش را ندارید.`
- state پایدار در main، heading قابل focus و CTA `بازگشت به صفحه اصلی` یا آخرین مسیر مجاز.
- کد permission فقط در details پشتیبانی؛ متن فعلی FE-UX-01 که کد را primary می‌کند superseded است.

### 8.2 Action-level denial

- اگر permission از پیش معلوم است، action پرخطر یا کلیدی می‌تواند disabled با توضیح `شما مجوز نهایی‌سازی سند را ندارید.` باشد.
- اگر action برای نقش کاربر هیچ relevance ندارد و discoverability ارزشی ندارد، پنهان می‌شود.
- برای عمل اصلی موجودیت که کاربر باید بداند وجود دارد (finalize/reverse)، disabled + توضیح بر hidden ترجیح دارد. این انتخاب کلی هنوز در standards با OQ-5 ثبت شده؛ قاعده نهایی per-action یک `FUTURE PRODUCT DECISION` است.
- tooltip تنها منبع توضیح نیست؛ keyboard/focus و متن قابل دسترس لازم است.

### 8.3 navigation پنهان

nav مربوط به route کاملاً غیرقابل استفاده برای نقش پنهان می‌شود تا dead end نسازد. direct URL همچنان route guard دارد. پنهان‌سازی یا disable کردن **امنیت نیست**؛ پاسخ 403 بکند authoritative است.

### 8.4 Backend 403

حتی اگر UI action را فعال نشان داده باشد، 403 بکند معتبر است (ممکن است مجوز لغو شده باشد). dialog بسته نمی‌شود، success نشان داده نمی‌شود و generic error Toast ممنوع است. متن action-specific نمایش داده و permission cache در تسک پیاده‌سازی بعدی refresh می‌شود.

## 9. نشست و احراز هویت

| سناریو | رفتار و متن | وضعیت |
| --- | --- | --- |
| بازدید اولیه بدون نشست | `/auth/me` با 401 یک state عادی است؛ redirect به login بدون error | `CURRENT` |
| اعتبار ورود نامعتبر | alert فرم: `نام کاربری یا گذرواژه نادرست است.` + خط بازیابی `نام کاربری و گذرواژه را بررسی کنید و دوباره تلاش کنید.`؛ username حفظ و password پس از شکست پاک می‌شود و focus به فیلد گذرواژه برمی‌گردد | `CURRENT` — پاک‌کردن password در FE-UX-03 پیاده و با تست پوشش داده شد |
| 401 میانه نشست | cache حساس پاک، تنها یک event expiry، redirect login؛ `نشست شما منقضی شده است. لطفاً دوباره وارد شوید.` | `CURRENT` — copy در FE-UX-03 با این سند هم‌تراز شد |
| login پس از expiry | بازگشت به مقصد محفوظ فقط اگر امن و مجاز؛ banner expiry حذف؛ Toast موفقیت لازم نیست | حفظ مقصد در route state `CURRENT` |
| unauthorized action بدون نشست | وارد جریان session شود، نه 401 Toast | `CURRENT` architecture |
| logout موفق | cache پاک و login؛ پیام success اختیاری و فقط یک‌بار | `CURRENT` |
| logout API failure | پیاده‌سازی فعلی `onSettled` محلی خارج می‌شود؛ نباید success سرور ادعا شود. متن اختیاری: `از این دستگاه خارج شدید؛ پایان نشست در سرور تأیید نشد.` | policy دقیق `FUTURE PRODUCT DECISION`؛ raw success ممنوع |

برای طوفان 401، handler باید فقط نخستین expiry را announce کند؛ درخواست‌های هم‌زمان اعلان/redirect جدا نمی‌سازند.

## 10. خطاهای قاعده کسب‌وکار

### 10.1 taxonomy

| خانواده | مثال contract | پیام الگو | recovery |
| --- | --- | --- | --- |
| lifecycle state | سند قطعی/قبلاً معکوس | `امکان [عمل] وجود ندارد؛ زیرا [وضعیت].` | refresh/عمل جایگزین |
| fiscal lock | دوره/سال بسته یا مهروموم | همان | انتخاب دوره باز یا مسئول حسابداری |
| posting eligibility | حساب غیرفعال/غیرقابل ثبت | همان | انتخاب حساب معتبر |
| hierarchy | parent/cycle/version mismatch | `امکان جابه‌جایی حساب وجود ندارد؛ زیرا ساختار حساب نامعتبر می‌شود.` | اصلاح parent/code |
| scope | سازمان/حوزه نامعتبر یا خارج دامنه | 404 امن یا پیام context | بازگشت/انتخاب دامنه |
| duplicate/idempotency | شماره/operation key تکراری | پیام duplicate یا intent conflict | refresh؛ key جدید فقط برای intent جدید |
| concurrency | نسخه stale | `سند در فاصله انجام عملیات تغییر کرده است.` | دریافت نسخه جدید، ادغام دستی |
| inventory availability | موجودی کافی نیست | `امکان ثبت عملیات انبار وجود ندارد؛ زیرا موجودی قابل استفاده کافی نیست.` | کاهش مقدار/آزادسازی رزرو |
| unsupported tracking | lot/serial/expiry هنوز قرارداد کامل ندارد | پیام capability unavailable | توقف؛ نه workaround جعلی |

### 10.2 مرز `BusinessRuleViolation` و منبع پیام

`BusinessRuleViolation` یک error code موجود و پایدار در بکند است، اما به‌تنهایی فقط خانواده خطا را مشخص می‌کند. business subcode استاندارد و سراسری برای تمام قواعد دامنه وجود ندارد؛ برخی endpointها ممکن است `details.problem` یا `details.rule` داشته باشند، اما تا وقتی schema آن مورد مستند و allow-listed نشده، frontend حق ندارد آن را قراردادی عمومی فرض کند.

تشخیص rule از متن آزاد ممنوع است:

```ts
// ممنوع: متن انسانی پایدار و ماشینی نیست.
if (error.message.includes('fiscal period is closed')) {
  // ...
}
```

تصمیم سطح اول باید با code باشد:

```ts
// مجاز: تعیین خانواده semantic خطا.
if (error.code === 'BusinessRuleViolation') {
  // پیام عمومی امن همان operation، مگر subcode رسمی map شده باشد.
}
```

برای تشخیص دقیق «دوره بسته»، «حساب غیرقابل ثبت» یا ruleهای دیگر، ابتدا contract/subcode رسمی و ساختاریافته لازم است. frontend فقط از `details.problem/rule` مستند و allow-listed استفاده می‌کند؛ raw `message` نه discriminator است و نه copy نهایی. رفتار فعلی fallback به `message` یک UX gap است. تعریف business subcode versioned یک `CONTRACT GAP` و تسک API/ADR آینده است؛ این سند API را تغییر نمی‌دهد.

## 11. کاتالوگ پیام

**راهنما:** «مکانیزم» کانال اصلی است. `[نام]` و `[کد]` فقط از داده معتبر و با formatter می‌آیند.

### 11.1 احراز هویت

| رویداد | پیام رسمی | مکانیزم | وضعیت |
| --- | --- | --- | --- |
| credentials نامعتبر | `نام کاربری یا گذرواژه نادرست است.` | form alert | `CURRENT` |
| نشست منقضی | `نشست شما منقضی شده است. لطفاً دوباره وارد شوید.` | banner login + redirect یکتا | `CURRENT` |
| خروج موفق | `با موفقیت خارج شدید.` | notice login، فقط اگر محصول آن را لازم بداند | endpoint `CURRENT`؛ نمایش پیام `FUTURE PRODUCT DECISION` |
| unauthorized | `برای ادامه باید وارد شوید.` | redirect/login state | `CURRENT` |

### 11.2 سازمان

| رویداد | پیام رسمی | مکانیزم | وضعیت |
| --- | --- | --- | --- |
| unavailable | `سازمانی در دسترس نیست. دسترسی سازمانی خود را بررسی کنید.` | shell empty/warning | `CURRENT` |
| access denied | `شما مجوز مشاهده سازمان‌ها را ندارید.` | shell permission state | `CURRENT`؛ متن فعلی نیازمند اصلاح آینده |
| changed | `سازمان به «[نام]» تغییر کرد.` | Toast info پس از تغییر context موفق | switcher `CURRENT`؛ Toast `CONTRACT GAP` |
| invalid context | `سازمان انتخاب‌شده دیگر در دسترس نیست. سازمان دیگری را انتخاب کنید.` | shell alert + refresh selector | backend 404 `SUPPORTED`؛ recovery کامل `CONTRACT GAP` |

### 11.3 عمومی

| رویداد | پیام | مکانیزم | وضعیت |
| --- | --- | --- | --- |
| save success | `اطلاعات با موفقیت ذخیره شد.` | Toast success | contract target؛ Toast `CONTRACT GAP` |
| update success | `اطلاعات با موفقیت به‌روزرسانی شد.` | Toast success | contract target |
| delete success | `[موجودیت] حذف شد.` | Toast success | فقط برای delete پشتیبانی‌شده |
| operation failed | `انجام عملیات ممکن نشد. لطفاً دوباره تلاش کنید.` | نزدیک action، با نام عمل هرجا ممکن | `SUPPORTED` generic fallback |
| network unavailable | `ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کرده و دوباره تلاش کنید.` | alert سطح عمل/page | detection `CURRENT` |
| retry | `تلاش دوباره` | CTA | `CURRENT` |
| unexpected + correlation | `انجام عملیات ممکن نشد. در صورت ادامه مشکل، کد پیگیری «[کد]» را به پشتیبانی اعلام کنید.` | alert | correlation `CURRENT` |

### 11.4 سند حسابداری

| رویداد | پیام رسمی | مکانیزم | وضعیت |
| --- | --- | --- | --- |
| create/save | `سند با موفقیت ذخیره شد.` | Toast success | API `SUPPORTED`، UI آینده |
| update | `سند با موفقیت به‌روزرسانی شد.` | Toast success | API `SUPPORTED`، UI آینده |
| delete non-final | `سند حذف شد.` | confirm سپس Toast | API `SUPPORTED`، UI آینده |
| finalize | `سند قطعی شد.` | confirm سپس Toast | API `SUPPORTED`، UI آینده |
| reverse | `سند معکوس ایجاد شد.` | confirm سپس Toast | API `SUPPORTED`، UI آینده |
| finalization blocked: closed period | `امکان نهایی‌سازی سند وجود ندارد؛ زیرا دوره مالی بسته است.` | alert داخل dialog/form | `SUPPORTED`؛ subcode mapping `CONTRACT GAP` |
| finalization blocked: sealed year | `امکان نهایی‌سازی سند وجود ندارد؛ زیرا سال مالی مهروموم شده است.` | alert | `SUPPORTED`؛ mapping gap |
| already final | `امکان نهایی‌سازی سند وجود ندارد؛ زیرا سند قبلاً قطعی شده است.` | alert + refresh | `SUPPORTED` |
| reversal blocked: not final | `امکان معکوس کردن سند وجود ندارد؛ زیرا فقط سند قطعی قابل معکوس کردن است.` | alert dialog | `SUPPORTED` |
| reversal blocked: already reversed | `امکان معکوس کردن سند وجود ندارد؛ زیرا این سند قبلاً معکوس شده است.` | alert dialog | `SUPPORTED`؛ `details.problem` موجود |
| invalid/unresolvable period | `تاریخ سند در هیچ دوره مالی معتبری قرار نمی‌گیرد. تاریخ یا تنظیمات سال مالی را بررسی کنید.` | form alert/inline date | `SUPPORTED` |
| duplicate number | `این شماره سند قبلاً در حوزه مالی استفاده شده است. اطلاعات را تازه‌سازی کنید.` | form alert | `SUPPORTED` |
| concurrent modification | `سند در فاصله انجام عملیات تغییر کرده است. نسخه جدید را دریافت و تغییرات را دوباره بررسی کنید.` | conflict Toast کوتاه + alert پایدار غیرتکراری | `SUPPORTED` |
| invalid lines | `ردیف‌های سند معتبر نیستند. موارد مشخص‌شده را اصلاح کنید.` | grid summary + inline | `SUPPORTED` |
| unbalanced | `جمع بدهکار و بستانکار سند برابر نیست.` | grid/form summary | `SUPPORTED`؛ frontend نباید خودش حقیقت مالی را محاسبه کند |

### 11.5 مالی و حساب‌ها

| رویداد | پیام | مکانیزم | وضعیت |
| --- | --- | --- | --- |
| fiscal period closed | `امکان ثبت سند در این دوره وجود ندارد؛ زیرا دوره مالی بسته است.` | business alert | `SUPPORTED` |
| fiscal period/year sealed | `امکان ثبت یا اصلاح سند وجود ندارد؛ زیرا سال یا دوره مالی مهروموم شده است.` | business alert | `SUPPORTED` |
| invalid account/not found | `حساب انتخاب‌شده یافت نشد یا در دسترس شما نیست.` | field/form alert | `SUPPORTED` |
| non-postable account | `امکان ثبت ردیف وجود ندارد؛ زیرا حساب انتخاب‌شده قابل ثبت نیست. یک حساب قابل ثبت انتخاب کنید.` | inline account + summary | `SUPPORTED` |
| inactive account | `امکان ثبت ردیف وجود ندارد؛ زیرا حساب انتخاب‌شده غیرفعال است. حساب فعال دیگری انتخاب کنید.` | inline + summary | `SUPPORTED` |
| hierarchy violation | `امکان ذخیره حساب وجود ندارد؛ زیرا جایگاه انتخاب‌شده با ساختار کدینگ سازگار نیست.` | form alert/inline parent | `SUPPORTED` |
| duplicate account code | `این کد حساب قبلاً استفاده شده است.` | inline اگر field mapping معتبر | `SUPPORTED` |
| fiscal close | `سال مالی بسته شد.` | confirm + Toast | API `SUPPORTED`، UI آینده |
| fiscal seal | `سال مالی مهروموم شد.` | confirm + Toast | API `SUPPORTED`، UI آینده |

### 11.6 گزارش‌ها

| رویداد | پیام | مکانیزم | وضعیت |
| --- | --- | --- | --- |
| loading | `در حال دریافت گزارش…` | table skeleton + sr label | `CURRENT` |
| empty | `برای فیلترهای انتخاب‌شده نتیجه‌ای یافت نشد. فیلترها را تغییر دهید.` | empty state | `CURRENT` با copy refinement |
| missing/invalid filters | `برای نمایش گزارش، حوزه مالی و سال مالی را انتخاب کنید.` یا inline دقیق | neutral state/inline | `CURRENT` |
| load failure | `دریافت گزارش انجام نشد. لطفاً دوباره تلاش کنید.` | section/page error + retry | `CURRENT` |
| permission denied | `شما مجوز مشاهده این گزارش را ندارید.` | route permission state | `CURRENT` |
| read success | بدون Toast | table/result | `CURRENT` rule |

### 11.7 انبار — عملیات انبار و ارزش‌گذاری

بکند موجودی، availability، movement، transfer، valuation، reservation، reversal و reconciliation را پشتیبانی می‌کند. UI عملیات انبار (فهرست گردش‌ها، فرم رسید/صادره، فرم انتقال، کاردکس و کارفهرست ارزش‌گذاری) پیاده‌سازی شده است؛ پیام‌های آن `CURRENT` است. عملیات‌های بدون UI (معکوس کردن، رزرو، reconciliation، ثبت دیرهنگام قیمت) همچنان `SUPPORTED` ثبت می‌شوند.

Toast موفقیت ثبت گردش به‌جای متن عمومی، نام نوع گردش را می‌گوید (رسید/صادره)؛ برای انتقال، متن واحد است.

| رویداد | پیام | مکانیزم | وضعیت |
| --- | --- | --- | --- |
| widget loading | `در حال دریافت موجودی انبار…` | widget skeleton | `CURRENT` |
| widget empty | `برای این سازمان موجودی انبار ثبت نشده است.` | empty widget | `CURRENT` |
| widget failure | `دریافت موجودی انبار انجام نشد. دوباره تلاش کنید.` | section error | `CURRENT` |
| widget permission | `شما مجوز مشاهده موجودی انبار را ندارید.` | widget permission state | `CURRENT` |
| receipt created | `رسید انبار ثبت شد.` | Toast success | `CURRENT` |
| issue created | `صادره انبار ثبت شد.` | Toast success | `CURRENT` |
| transfer created | `انتقال انبار ثبت شد.` | Toast success | `CURRENT` |
| recalculation done | `قیمت‌گذاری مجدد انجام شد. {movementsRevalued} گردش به‌روزرسانی شد.` | Toast success | `CURRENT` |
| movement reversed | `حرکت انبار معکوس شد.` | confirm + Toast | API `SUPPORTED`؛ UI وجود ندارد |
| insufficient stock | `امکان ثبت عملیات انبار وجود ندارد؛ زیرا موجودی قابل استفاده کافی نیست. مقدار را کاهش دهید یا موجودی رزروشده را بررسی کنید. موجودی فعلی: {onHand} — مقدار درخواستی: {requested}.` | form alert | `CURRENT` |
| backdated transfer | `انتقال با تاریخ پیش از آخرین گردش این کالا در یکی از دو انبار، فقط پس از تأیید صریح ثبت می‌شود و به مجوز «قیمت‌گذاری مجدد» نیاز دارد؛ ارزش هر دو انبار از تاریخ انتقال بازمحاسبه می‌شود. تاریخ گردش را اصلاح کنید یا با کاربر دارای این مجوز هماهنگ کنید.` | form alert | `CURRENT` (C-59C؛ OQ-67 Resolved) |
| stale notice (پس از «انجام نشود») | `ارزش‌گذاری این کالا و انبار نامعتبر است.` + اقدام `قیمت‌گذاری مجدد` | persistent alert | `CURRENT` |
| duplicate operation key | `این درخواست قبلاً با اطلاعات دیگری ثبت شده است. اطلاعات را تازه‌سازی کنید و عملیات را بررسی کنید.` | conflict alert | `CURRENT` |

پیام lot/serial/expiry به catalog UI اضافه نشده، زیرا UI موجود نیست و محصول نباید راه‌حل ناقص را capability جاری نشان دهد.

## 12. پیشگیری از بازخورد تکراری

1. **inline + Toast:** یک validation event فقط inline/summary؛ Toast ممنوع.
2. **page error + global Toast:** page/section alert canonical است؛ Toast ممنوع.
3. **403 + generic error:** فقط permission copy؛ generic error ممنوع.
4. **mutation success:** یک Toast؛ heading، banner و Toast هم‌متن ممنوع. اگر redirect مقصد نتیجه را آشکار می‌کند، Toast همچنان فقط برای تأیید mutation و یک‌بار است.
5. **session expiry:** اولین 401 مالک flow است؛ بقیه requestها silent. یک banner login، یک redirect.
6. **dialog failure:** alert داخل dialog؛ error Toast ممنوع.
7. **conflict جدی:** طبق standards دو کانال فقط با نقش متفاوت: Toast `اطلاعات تغییر کرده است.` برای announcement؛ alert `نسخه جدید را دریافت کنید…` برای recovery. متن یکسان نیست.
8. **dedupe key:** event identity/operation key از نمایش چند success/error ناشی از retry جلوگیری می‌کند.
9. **GET retry:** هر شکست retry شده Toast جدید نمی‌سازد؛ state همان section update می‌شود.
10. **background completion:** فقط owner سراسری job Toast می‌دهد؛ component آغازکننده هم‌زمان Toast دوم نمی‌سازد.

## 13. دسترس‌پذیری

### 13.1 اعلان خطا و فرم

- خطای field با `aria-invalid=true` و `aria-describedby` به متن مرتبط است؛ `role=alert` فقط هنگام ایجاد خطا، نه در هر render.
- خلاصه خطای async/form `aria-live=polite` یا برای failure blocking `role=alert` دارد.
- focus پس از submit به نخستین field invalid؛ پس از server field mapping نیز همان قاعده.
- نشانه خطا شامل متن و icon/label است؛ border یا رنگ تنها کافی نیست.

### 13.2 Dialog

- `role=dialog`، `aria-modal=true`، heading با `aria-labelledby`، توضیح با `aria-describedby`.
- focus trap، Tab/Shift+Tab، Escape در حالت مجاز، و بازگرداندن focus به trigger.
- در loading focus گم نمی‌شود؛ disabled action announce می‌شود. failure داخل dialog announce و focus به alert منتقل نمی‌شود مگر برای جلوگیری از گم‌شدن پیام ضروری.

### 13.3 Page/section، empty و loading

- heading page error قابل پیمایش است؛ CTA label روشن دارد.
- region section نام دسترس‌پذیر دارد و تغییر loading→success/error به‌اندازه announce می‌شود.
- `aria-busy` فقط تا پایان request؛ skeleton decorative از accessibility tree حذف می‌شود و یک label sr-only کافی است.
- جدول empty ساختار و caption را بی‌دلیل از بین نمی‌برد.

### 13.4 RTL و داده LTR

- document root `lang=fa dir=rtl`.
- اعداد مالی، تاریخ ISO، account code، document number، username و correlation ID در span با `dir=ltr`/`bdi` قرار می‌گیرند تا ترتیب خواندن حفظ شود.
- screen-reader label مفهوم را فارسی می‌گوید: `کد پیگیری، ABC123`، نه رشته بی‌زمینه.
- ترتیب بصری Toast/dialog با ترتیب DOM و خواندن RTL یکسان است؛ CSS direction نباید ترتیب معنایی را وارونه کند.

### 13.5 کیبورد و زمان

- همه CTAها keyboard reachable و focus-visible هستند.
- dismiss Toast دکمه labelدار دارد؛ time limit با hover/focus متوقف می‌شود.
- هیچ پیام حیاتی صرفاً auto-dismiss نمی‌شود.
- focus restoration پس از close/remove به عنصر موجود و منطقی؛ اگر trigger حذف شد به heading/نتیجه بعدی.

## 14. مغایرت‌ها و تقدم نسبت به FE-UX-01

1. FE-UX-01 permission alert را با کد RBAC در متن اصلی پیشنهاد می‌کند. FE-UX-02 کد را به details پشتیبانی محدود می‌کند.
2. FE-UX-01 dialog نمونه مبهم `آیا مطمئنید؟` دارد. FE-UX-02 آن را با توضیح پیامد و دکمه عمل‌محور جایگزین می‌کند.
3. FE-UX-01 در جدول خطا message «server detail» را برای business error مجاز می‌داند. فقط detail ساختاریافته allow-listed مجاز است؛ raw message، به‌ویژه انگلیسی، ممنوع.
4. FE-UX-01 مسیر document detail و mutation UI را گاهی در ماتریس مانند flow قابل اجرا نشان می‌دهد؛ این‌ها `SUPPORTED API / FUTURE UI` هستند، نه `CURRENT`.
5. standards §۱۲ برای conflict جدی Toast + inline می‌خواهد. FE-UX-02 آن را استثنای دو-نقشی تعریف می‌کند، نه مجوز duplication عمومی.
6. `FullPageLoading` فعلی spinner تمام‌صفحه دارد؛ standards آن را جز bootstrap منع می‌کند. استفاده فعلی session bootstrap مجاز است، نه query عادی.
7. frontend فعلی `errors.title = خطا` و پیام‌های `خطای ناشناخته/خطای غیرمنتظره` دارد. این سند عنوان/پیام action-specific را لازم می‌کند؛ اصلاح کد بعدی است.

## 15. شکاف‌ها و تصمیم‌های آینده

### 15.1 CONTRACT GAP

- Toast provider/primitive، queue، dedupe و live-region.
- Dialog/ConfirmDialog استاندارد و dirty guard.
- business subcode پایدار و schema یکنواخت details برای نگاشت دقیق فارسی.
- جلوگیری از عبور raw backend message در `normalizeApiError`.
- field mapping مرکزی server validation و form summary استاندارد.
- بازیابی کامل organization context نامعتبر.
- UI mutation سند، سال/دوره و عملیات انبار (با وجود APIهای پشتیبان).
- ErrorBoundary page-level و support/debug details کنترل‌شده.

### 15.2 FUTURE PRODUCT DECISION

- تقویم و DatePicker شمسی؛ تنظیم ارقام فارسی/لاتین.
- واحد پایه و نمایش ریال/تومان؛ هیچ تبدیل مالی در frontend.
- سیاست نهایی hide vs disabled برای هر گروه action بی‌مجوز (OQ-5).
- پیام logout و رفتار دقیق شکست revocation.
- monitoring/پشتیبانی و مسیر رسمی ارائه کد پیگیری.
- سیاست account/fiscal/legal workflows که در OQهای دامنه باز هستند؛ copy نباید آن‌ها را تصمیم‌گرفته نشان دهد.

## 16. وظایف پیاده‌سازی پس از تصویب (خارج از این تسک)

1. طراحی primitiveهای Toast و ConfirmDialog بدون انتخاب dependency در این سند.
2. افزودن error presentation mapper مرکزی بر اساس operation + code + allow-listed detail.
3. تعریف قرارداد versioned business problem codes در تسک مشترک API/فرانت (بدون تغییر envelope سطح بالا مگر با ADR/contract).
4. اصلاح dictionary مطابق واژه‌نامه و حذف raw message fallback.
5. ساخت form summary، server field mapping، focus manager و تست‌های accessibility.
6. افزودن session-expiry dedupe، route/page error patterns و ErrorBoundary.
7. پیاده‌سازی feedback هم‌زمان با UIهای mutation سند/تقویم/انبار؛ نه پیش از capability.
8. تست رفتاری: کانال واحد، عدم Toast برای GET، تأخیر success تا پاسخ سرور، keyboard، live region و RTL/LTR.

## 17. معیار راستی‌آزمایی این قرارداد

- Toast، inline، dialog، page/section، empty، loading، permission، session، business/network/unexpected error تفکیک شده‌اند.
- تصمیم‌نامه و ماتریس formal وجود دارد.
- duration، max=3، dismiss، dedupe و accessibility Toast صریح‌اند.
- catalog احراز هویت، سازمان، عمومی، حسابداری، گزارش و فقط قابلیت‌های پشتیبانی‌شده انبار را پوشش می‌دهد.
- پیام‌های raw/technical ممنوع‌اند.
- `CURRENT`، `SUPPORTED`، `CONTRACT GAP` و `FUTURE PRODUCT DECISION` از هم جدا شده‌اند.
- این سند هیچ component، hook، API، dependency یا capability جدیدی ایجاد نمی‌کند.
