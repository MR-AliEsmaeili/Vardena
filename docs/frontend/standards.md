# Vardena Frontend Standards — نسخه ۲.۱

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

# ۱) اصول بنیادین — ۱۲ اصل

### ۱. چگالی بر تزئین

جدول‌ها ۳۰–۴۰ ردیف در صفحه.

کارت تزئینی و فضای مرده ممنوع.

### ۲. الگو واحد

هر چیز تکرارشونده یک الگو.

صفحۀ جدید = ترکیب الگوها.

الگوی جدید = تسک مستقل.

### ۳. فرمت مرکزی

هیچ عدد/تاریخی بدون فرمتر مرکزی.

`toLocaleString` پراکنده و concat دستی ممنوع.

### ۴. RTL فقط با logical properties

الزامی:

```text
ms-
me-
ps-
pe-
start-
end-
```

ممنوع:

```text
ml-
mr-
pl-
pr-
left-
right-
```

### ۵. چهار حالت همیشه

هر UI باید این چهار حالت را داشته باشد:

```text
loading
empty
error
success
```

### ۶. رنگ فقط semantic token

استفاده مستقیم از:

```text
hex
rgb
```

ممنوع.

### ۷. متن فقط از i18n

رشتۀ فارسی inline در JSX ممنوع.

### ۸. سرعت قرارداد است

بودجه‌های بخش ۱۴ الزامی هستند.

فونت باید self-host باشد.

### ۹. دسترس‌پذیری الزامی

بخش ۱۳ حداقل است، نه اختیاری.

### ۱۰. امنیت واقعی در Backend

چک permission در UI فقط برای UX است.

امنیت واقعی باید در Backend enforce شود.

### ۱۱. Composition به‌جای تکرار

منطق در hooks/services.

رندر در component.

Prop drilling عمیق با composition حل می‌شود، نه Context همه‌جا.

### ۱۲. Rule = Code

ممنوعیت‌ها تا حد ممکن باید با lint/CI گرفته شوند.

---

# ۲) معماری کد

معماری باید feature-based و آینۀ Vertical Slice بکند.

ساختار:

```text
src/
  app/
  shared/
    ui/
    lib/
    api/
  features/
    <feature>/
      api/
      components/
      pages/
      i18n/
      schema/
```

قانون dependency:

```text
feature → shared
```

مجاز است.

اما:

```text
feature → feature
```

ممنوع است.

این قانون آینۀ مرزبندی ماژول‌های Backend است.

## Path aliases

الزامی:

```text
@/shared
@/features/
```

## Colocation

هر چیز فقط در نزدیک‌ترین محل استفاده قرار بگیرد.

وقتی چیزی حداقل در دو feature مشترک شد، به `shared` منتقل شود.

## Import cycle

ممنوع.

باید با:

```text
import/no-cycle = error
```

گرفته شود.

## API Types

تایپ API فقط از OpenAPI تولید می‌شود.

تایپ دستی response ممنوع.

تغییر generated types برای پنهان‌کردن ناسازگاری ممنوع.

اگر frontend و backend ناسازگار هستند، قرارداد Backend باید اصلاح شود.

## Component files

هر فایل فقط یک component داشته باشد.

نام فایل = نام component.

حد راهنما:

```text
~250 lines
```

اگر بزرگ‌تر شد، hook یا sub-component استخراج شود.

## Export

برای:

```text
shared/ui
```

فقط named export.

`default export` فقط برای `lazy()` در سطح route.

---

# ۳) React و طراحی Component

## Composition First

اگر داده بیش از حدود دو سطح جابه‌جا می‌شود، component باید بازطراحی شود.

از:

```text
children
slot
```

استفاده شود.

Context فقط برای داده واقعاً سراسری.

## Logic خارج از Component

محاسبه، fetch و تغییر فرمت باید در:

```text
hook
lib
service
```

باشد.

Component فقط مسئول rendering و event handling باشد.

## Derived State

داده مشتق‌شده باید هنگام render محاسبه شود.

این الگو ممنوع است:

```text
calculate in render
→ setState in useEffect
```

زیرا باعث bug و chained re-render می‌شود.

## Effects

Effect فقط برای sync با دنیای بیرون:

```text
network
DOM
subscription
```

Business logic داخل effect ممنوع.

## Keys

برای ردیف‌های dynamic یا قابل حذف سند:

`index` به عنوان key ممنوع.

فقط ID پایدار.

در غیر این صورت state فیلدها بین ردیف‌ها جابه‌جا می‌شود.

این موضوع مخصوصاً برای grid اسناد مالی حیاتی است.

## Custom Hooks

هنگام:

* تکرار منطق
* سنگین‌شدن component

Custom hook ایجاد شود.

نام با:

```text
use*
```

و خروجی typed باشد.

## memo / useCallback

فقط با دلیل واقعی:

* profiling
* یا عبور به child memoized

Micro-optimization کور ممنوع.

## forwardRef

فقط در primitives لایه:

```text
shared/ui
```

## React Compiler

در حال حاضر:

```text
OQ-9
```

---

# ۴) TypeScript

`strict` همیشه فعال باشد.

`any` ممنوع.

داده نامعلوم:

```text
unknown + narrowing
```

## DocStatus

برای وضعیت سند از discriminated union استفاده شود:

```ts
type DocStatus =
  | { kind: "draft" }
  | { kind: "temporary" }
  | { kind: "final" }
  | { kind: "reversed"; reversedBy: DocId };
```

Rendering و اجازه عملیات باید exhaustive switch داشته باشد.

برای حالت unreachable از:

```text
assertNever
```

استفاده شود.

هدف:

«سند Final با دکمۀ ویرایش» در compile-time غیرممکن شود، نه اینکه فقط در test کشف شود.

## Branded IDs

IDهای زیر باید branded روی string باشند:

```text
DocId
AccountId
OrgId
```

هدف جلوگیری از اشتباهاتی مانند:

```text
DocId → AccountId
```

در compile-time است.

## enum

`enum` ممنوع.

به‌جای آن:

```text
const object + union
```

## satisfies

برای config objectها از:

```text
satisfies
```

استفاده شود.

## type assertion

`as` فقط برای third-party interoperability مجاز است.

در آن حالت باید comment دلیل وجود داشته باشد.

## Zod

Schema منبع حقیقت است.

Type با:

```text
z.infer
```

مشتق شود.

یک منبع حقیقت برای:

```text
validation
type
```

---

# ۵) مدیریت وضعیت — سه‌گانه و بسته

| نوع وضعیت    | ابزار                | الزام                                 |
| ------------ | -------------------- | ------------------------------------- |
| Server state | TanStack Query       | fetch مستقیم axios در component ممنوع |
| URL state    | Router search params | filter/page/sort لیست‌ها در URL       |
| Form state   | RHF + Zod            | فقط RHF                               |
| UI موضعی     | useState/useContext  | آخرین گزینه                           |

## State Colocation

State در نزدیک‌ترین نقطه مصرف قرار بگیرد.

بالا بردن state فقط برای اشتراک واقعی.

## Derived State

دوباره‌سازی state مشتق ممنوع.

یک داده = یک source of truth.

Copy و manual synchronization ممنوع.

## State Libraries

ممنوع:

```text
Zustand
Redux
```

کتابخانه state جدید فقط با ADR.

## Window Focus

پیش‌فرض:

```text
refetchOnWindowFocus = false
```

زیرا در فرم‌های مالی refresh غافلگیرکننده ممنوع است.

برای گزارش‌ها فعال‌سازی باید per-query و آگاهانه باشد.

---

# ۶) API Layer و همزمانی

## Axios

یک Axios واحد + interceptor.

`401` باید:

```text
→ login
→ preserve destination
```

انجام دهد.

کد خطا باید به پیام فارسی map شود.

## Query Options

برای هر entity یک queryOptions factory.

ساختار queryKey:

```text
[ماژول, entity, پارامترها]
```

## Invalidation

بعد از mutation فقط invalidation هدفمند.

پاک‌کردن کل cache ممنوع.

## staleTime

پیش‌فرض:

```text
داده پایه: ۵ دقیقه
لیست عملیاتی: ۳۰ ثانیه
```

بعد از mutation همان entity باید فوری invalidate شود.

## Race Conditions

برای fetchهایی که پارامتر متغیر دارند:

```text
AbortController
signal
latest-wins
```

الزامی است.

## Search Debounce

حدود:

```text
300ms
```

و باید با util مرکزی انجام شود.

## Retry

فقط GET.

حداکثر:

```text
2
```

با exponential backoff.

Auto-retry برای mutation مطلقاً ممنوع.

Retry دستی کاربر باید با همان:

```text
operationKey
```

انجام شود.

این مطابق قرارداد Idempotency Backend است.

## Optimistic Update

برای عملیات مالی ممنوع:

```text
Posting
Reversal
Allocation
Period Closing
```

UI فقط بعد از تأیید Server به وضعیت نهایی برسد.

## Mutation

هر request باید error state داشته باشد.

دکمه mutation هنگام ارسال disabled باشد.

---

# ۷) اعداد و تاریخ

Formatterهای مرکزی:

```text
formatMoney(value: string)
formatQuantity
formatPercent
```

برای مبلغ، ورودی `number` خطا است.

قرارداد Amount بر اساس Decimal است.

## User Settings

باید تنظیمات کاربر برای:

* ارقام فارسی/لاتین
* اعشار per-entity
* separator

در نظر گرفته شود.

## Financial Display

الزامی:

```text
tabular-nums
```

سلول مبلغ:

```text
راست‌چین
```

عدد منفی:

```text
قرمز
```

جمع:

```text
bold
```

گردکردن فقط نمایشی.

## Dates

Backend:

```text
ISO
```

Frontend display:

```text
Jalali
```

کتابخانه:

```text
OQ-1
```

محتوای LTR داخل RTL باید:

```html
<span dir="ltr">
```

باشد.

---

# ۸) DataTable

پایه:

```text
TanStack Table
```

با یک wrapper واحد.

## Table Rules

الزامی:

* sticky header
* در جدول عریض، ستون شرح sticky
* pagination سمت server
* sort سمت server
* sort در URL

## Amount Columns

مبلغ:

```text
right aligned
tabular-nums
```

Footer باید بین این دو تفکیک کند:

```text
جمع صفحه
جمع کل
```

## Row Selection

با شمارنده.

## User Columns

در فاز ۱:

```text
localStorage
```

برای تنظیمات ستون‌های per-user.

## Virtualization

اگر همزمان ۱۰۰ ردیف نمایش داده می‌شود:

```text
virtualization
```

الزامی است.

## Inline Editing

فقط Draft.

Final فقط read-only.

## Empty States

این دو باید کاملاً متفاوت باشند:

```text
نتیجه‌ای یافت نشد
```

و:

```text
اولین رکورد را بساز
```

---

# ۹) فرم

فرم‌ها:

```text
zodResolver
mode: onSubmit
```

`defaultValues` از API.

بعد از ثبت موفق:

```text
reset
```

با response سرور.

## Validation

خطای field زیر همان field.

خطای server به صورت summary بالای فرم با:

```text
aria-live
```

اولین فیلد invalid باید خودکار focus شود.

## Dirty Guard

خروج از فرم تغییرکرده باید dirty guard داشته باشد.

## Grid Enter

Enter در grid:

```text
→ row بعد
```

Submit فقط:

```text
Button
Ctrl+S
```

## Required

فیلد اجباری:

```text
*
aria-required
```

## After Document Creation

بعد از ثبت سند:

```text
→ همان سند
```

باید قابل link باشد.

---

# ۱۰) چهار حالت + Error

## Loading

Skeleton باید شکل واقعی محتوا را داشته باشد.

Full-page spinner ممنوع.

## Refetch

Refetch نباید باعث layout shift شود.

## Empty

Empty باید CTA داشته باشد.

## Error

Error باید شامل:

* پیام معنایی
* Retry
* کد خطا در details

باشد.

## ErrorBoundary

در سطح page.

Crash یک page نباید کل application را از کار بیندازد.

## 403

پیام:

```text
دسترسی لازم را ندارید
```

به همراه مسیر بازگشت.

## Session Expiry

با:

```text
هشدار
تمدید
```

مدیریت شود.

---

# ۱۱) تأییدها و عملیات حساس

برای عملیات زیر `ConfirmDialog` الزامی است:

```text
Delete
Posting
Reversal
Void
Period Closing
```

## Irreversible Financial Operations

باید:

1. دلیل اجباری
2. نمایش اثر عملیات
3. تأیید نهایی

داشته باشند.

مثال:

```text
سند ۱۴۰۴-۰۰۱۰ معکوس می‌شود؛ سند معکوس ۱۴۰۴-۰۰۱۰R ایجاد خواهد شد
```

## Unauthorized Capability

قاعده فعلی:

```text
disable + tooltip
```

و مرتبط با:

```text
OQ-5
```

---

# ۱۲) Notification

Toastها:

```text
success
error
info
```

باید RTL باشند.

حداکثر:

```text
3
```

toast همزمان.

Action اختیاری است.

## Conflict

خطای جدی Conflict باید:

```text
toast
+
inline message
```

در همان صفحه داشته باشد.

---

# ۱۳) Accessibility

HTML معنایی.

Dialog:

```text
focus trap
Escape
focus restoration
```

الزامی.

همه inputها label داشته باشند.

خطای async با:

```text
aria-live
```

اعلام شود.

Contrast:

```text
AA
```

Focus:

```text
focus-visible
```

## Keyboard Shortcuts

با registry مرکزی.

قابل کشف از طریق:

```text
؟
```

میانبرها:

```text
Ctrl K → جست‌وجو
Alt N → سند جدید
Ctrl S → ذخیره
```

---

# ۱۴) Performance

## Font

فونت:

```text
Vazirmatn
```

باید self-host شود.

با Persian subset.

CDN خارجی قابل اتکا نیست.

## Code Splitting

Route-level code splitting.

هر route باید lazy باشد.

## Budgets

بودجه:

```text
Initial route JS ≤ ~250KB gzip
LCP ≤ 2.5s
Page switch perceived ≤ 300ms
```

## Libraries

کتابخانه جدید:

```text
حجم بررسی شود
+
ADR
```

نمودارها فقط lazy.

## Images / Icons

Bitmap بدون نیاز ممنوع.

برای icon:

```text
SVG / sprite
```

---

# ۱۵) امنیت فرانت

## dangerouslySetInnerHTML

مطلقاً ممنوع.

استثنا فقط:

```text
central sanitizer
+
ADR
```

## URL Parameters

URL parameter غیرقابل اعتماد است.

ساخت لینک فقط با:

```text
URLSearchParams
```

استفاده از raw href ممنوع.

## localStorage

Whitelist فقط:

```text
theme
density
column settings
```

Token و business data مطلقاً ممنوع.

Transport token:

```text
OQ-7
```

Draft سند فقط:

```text
memory
sessionStorage
```

و آن هم با تصمیم آگاهانه.

## Secrets

هیچ Secret نباید در bundle باشد.

کلید سرویس‌های cloud فقط سمت Backend.

## Dependencies

`lockfile` باید commit شود.

در CI:

```text
npm audit
```

و:

```text
high = fail
```

هر library جدید همیشه ADR می‌خواهد.

---

# ۱۶) تست

Testing Trophy:

```text
Integration
>
Unit
>
E2E
```

اولویت:

### Integration

Component + MSW

### Unit

Formatter / Hook / Schema

### E2E

مسیرهای حیاتی.

## Implementation Detail Tests

ممنوع.

از جمله:

* snapshot جزئیات implementation
* assert روی internal state

فقط رفتار قابل مشاهده کاربر تست شود.

## data-testid

نام معنایی و پایدار:

```text
data-testid="doc-row"
data-testid="posting-submit"
```

مقدار تصادفی ممنوع.

## Vitest

برای:

```text
formatters
schemas
```

## Testing Library + MSW

برای domain components.

## Playwright E2E

مسیر حیاتی:

```text
login
→ ثبت سند
→ posting
→ reversal
→ گزارش
```

## CI

باید از صفر اجرا شود:

```text
typecheck
lint
test
build
```

---

# ۱۷) قواعد ماشینی — Rule as Code

ابزارها:

```text
ESLint flat config
typescript-eslint strict
react-hooks
jsx-a11y
import plugin
```

## Required Gates

| ممنوعیت                                                      | Gate                                         |
| ------------------------------------------------------------ | -------------------------------------------- |
| `any`                                                        | `@typescript-eslint/no-explicit-any = error` |
| cycle بین ماژول‌ها                                           | `import/no-cycle = error`                    |
| deps ناقص hook                                               | `react-hooks/exhaustive-deps = error`        |
| a11y                                                         | `jsx-a11y = error`                           |
| کلاس‌های جهت‌دار non-logical                                 | grep در CI روی فایل‌های تغییرکرده            |
| hex/rgb مستقیم                                               | grep در CI + مرجع token                      |
| `toLocaleString` / فرمت دستی خارج از `src/shared/lib/format` | grep در CI                                   |
| رشتۀ فارسی در JSX                                            | grep در CI، فایل‌های i18n مستثنی             |
| ترتیب import                                                 | `eslint-plugin-import`                       |
| ترتیب کلاس‌های Tailwind                                      | `prettier-plugin-tailwindcss`                |

هدف:

خروجی بازبینی انسانی باید روی **منطق و دامنه** متمرکز باشد، نه خطاهایی که ماشین می‌تواند بگیرد.

---

# ۱۸) Git و PR

## Conventional Commits

الزامی:

```text
feat|fix|docs|refactor|test|chore(scope): خلاصه
```

## Branch

الگو:

```text
feat/task-NN-…
fix/…
docs/…
```

هرگز روی `main` کار نشود.

## PR Size

هدف:

```text
≤ ~400 lines changed
```

بزرگ‌تر از این مقدار = تقسیم تسک.

## PR Template

باید شامل:

* لینک task
* DoD checklist
* screenshot چهار حالت
* test evidence

باشد.

## Self Review

Agent قبل از submit باید diff خودش را یک‌بار کامل بخواند و موارد آشکار را اصلاح کند.

## Review Iteration

هنگام بازبینی:

```text
new commit
```

به force-push ترجیح داده شود.

---

# ۱۹) i18n و لحن فارسی

کلیدها باید معنادار باشند.

لحن:

```text
رسمی-ساده
```

خطاب:

```text
شما
```

## Error Formula

خطا باید بگوید:

```text
چه شد
+
چه کنید
```

مثال:

```text
مانده قابل تخصیص کافی نیست — مبلغ کمتر از ۲٬۵۰۰٬۰۰۰ وارد کنید
```

## Financial Numbers

عدد مالی در جمله همیشه با formatter نمایش داده شود.

---

# ۲۰) Definition of Done — هر تسک UI

هر UI task فقط زمانی Done است که:

* چهار حالت داشته باشد.
* screenshot هر چهار حالت در report موجود باشد.
* responsive در `1280px` بررسی شده باشد.
* keyboard کامل کار کند.
* صفر فرمت دستی وجود داشته باشد.
* صفر `console error/warn` وجود داشته باشد.
* صفر `any` جدید وجود داشته باشد.
* تمام requestها error state داشته باشند.
* mutation دابل‌ارسال نداشته باشد.
* grepهای بخش ۱۷ خالی باشند.
* `import/no-cycle` پاک باشد.
* typecheck سبز باشد.
* lint سبز باشد.
* test سبز باشد.
* build سبز باشد.
* PR template کامل باشد.
* لینک task وجود داشته باشد.
* test evidence وجود داشته باشد.
* self-review انجام شده باشد.

---

# ۲۱) Open Questions — نیازمند تصمیم مالک → ADR

این موارد در زمان تدوین استاندارد Open Question هستند و نباید بدون تصمیم مالک به صورت خودسرانه تغییر کنند:

### OQ-1 — Jalali DatePicker

انتخاب بین:

```text
react-multi-date-picker
```

یا جایگزین مناسب.

### OQ-2 — Dark Mode

```text
بله
خیر
سیستم
```

### OQ-3 — Default Density

```text
comfortable
compact
```

### OQ-4 — OpenAPI Type Generator

انتخاب بین:

```text
orval
openapi-typescript
```

### OQ-5 — Unauthorized Capability

```text
disable + tooltip
hide
```

### OQ-6 — Device Target

```text
desktop-only
mobile read-only
```

### OQ-7 — Token Transport

```text
httpOnly cookie
```

یا جایگزین.

تصمیم باید مشترک با Backend باشد.

### OQ-8 — Error Monitoring / Web Vitals

انتخاب بین:

```text
self-host (GlitchTip)
```

یا انتقال به مرحله بعد.

### OQ-9 — React Compiler

زمان فعال‌سازی پس از پایدارشدن معماری و frontend.

---

# Changelog

## ۲.۱

افزوده‌شده:

* React craft — بخش ۳
* TypeScript discipline
* DocStatus
* Branded IDs
* Colocation
* State hygiene
* Race / Abort / debounce
* ممنوعیت auto-retry mutation
* Frontend security
* Testing Trophy
* data-testid
* Rule-as-Code
* CI gates
* Git/PR
* self-review
* اصول ۱۱ و ۱۲
* OQ-8
* OQ-9
* ارتقای DoD

## ۲.۰

نگارش کامل اولیه.

---

# END OF OFFICIAL FRONTEND STANDARDS v2.1

The above document is the canonical frontend/UI standard.
