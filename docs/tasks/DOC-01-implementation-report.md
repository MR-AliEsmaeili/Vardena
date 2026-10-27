# DOC-01 — انواع سند و پیکربندی هر نوع — گزارش پیادهسازی

**تاریخ:** ۲۰۲۶-۱۰-۲۶ · **وضعیت:** پیادهسازی فرانتاند؛ بکاند، DTO و رجیستری مجوز بدون تغییر.

---

## ۱) چرا این تسک

با خواندن آخرین `main` (PR #217، ACC-04) و مقایسهٔ `task/README.md` (موجها) با
`docs/frontend/coverage-matrix.md` و گزارشهای `docs/tasks/ACC-*` و `INV-*`،
تسکهای انجامشده عبارتاند از ACC-01…ACC-09 (ACC-05 بهصورت PARTIAL)، INV-01 و
INV-03. از موج ۰، `DOC-01`، `DOC-03`، `ORG-01` و `WF-01` باقی ماندهاند که
`DOC-01` بالاترین اولویت (P2) را دارد و پیشنیاز تنها تسک P1 باقیمانده
(`DOC-02`، سریهای شمارهگذاری) است.

**منبع حقیقت بکاند است:** `backend/src/modules/documents/api/document-types.controller.ts`
سه مسیر کامل و فعال دارد و رجیستری انواع سند در کد ماژولها
(`*-document-type-registration.ts`) در زمان راهاندازی پر میشود. این یعنی قابلیت
در بکاند موجود و قابلاستفاده است، ولی هیچ سطح فرانتاندی نداشت. برخلاف
`INV-02` (بکاند endpoint فهرست انتقال ندارد)، `WF-03` (هیچ اکشنی در رجیستری
ثبت نشده است) و تأییدهای گردش کار (BLOCKED طبق `task/OUT-OF-SCOPE.md`)، DOC-01
به هیچ endpoint، مجوز یا تصمیم محصولی جدیدی نیاز ندارد.

هیچیک از ممنوعیتهای `task/OUT-OF-SCOPE.md` نقض نشد: ساخت/حذف نوع سند،
شمارهگذاری، روابط اسناد، ابزارهای مالک، تسویه و گزارشگیری عمومی انجام نشدند.

---

## ۲) قرارداد بکاند (راستیآزماییشده، بدون تغییر)

| متد | مسیر | مجوز دقیق | بدنه / query |
| --- | --- | --- | --- |
| GET | `/documents/types` | `Document.DocumentType.View` | `organizationId` (ULID), `search?` (≤۱۲۰), `page`, `pageSize` |
| GET | `/documents/types/:code` | `.View` | query: `organizationId` |
| PUT | `/documents/types/:code/configuration` | `Document.DocumentType.Configure` | `{ draftRequired: boolean }` + query: `organizationId` |

شواهد کلیدی از کد فعلی:

- رجیستری ۷ کد دارد: `accounting_voucher` (از `AccountingDocumentTypeRegistration`)،
  `inventory_receipt`, `inventory_issue`, `inventory_transfer`,
  `inventory_purchase_return`, `inventory_sales_return` (از
  `InventoryDocumentTypeRegistration`) و `inventory_material_request` (از
  `MaterialRequestDocumentTypeRegistration`). `accounting_journal` فقط در تستها
  ثبت میشود. هیچکدام در فرانت hardcode نشدهاند.
- کنترلر فقط `@Get()`, `@Get(':code')` و `@Put(':code/configuration')` دارد؛
  `@Post` و `@Delete` وجود ندارند، بنابراین `POST /documents/types` و حذف نوع
  سند `404` میگیرند. UI هم دکمه/مسیر ساخت یا حذف نساخته است.
- `DocumentTypesService.configureDocumentType` برای `draftRequired: true` روی نوع
  غیر `draftCapable` خطای `422` (کد پایدار `BusinessRuleViolation`) میدهد؛
  UI کنترل را برای چنین نوعی غیرفعال میکند و خطا را با کد (نه متن خام سرور)
  نگاشت میکند.
- `ListDocumentTypesQueryDto` فیلد `sort` را از `PageQueryDto` به ارث میبرد،
  ولی سرویس روی رجیستری در حافظه فیلتر میکند و `sort` را نادیده میگیرد؛
  بنابراین UI هیچ `sort`ای ارسال نمیکند (هم API و هم تست آن قید شدهاند).
- `description` یک فیلد nullable بدون type صریح در Swagger است و در
  `vardena-api.d.ts` به `Record<string, never> | null` تبدیل شده است؛ مانند الگوی
  `NullableString` در `contracts.ts`، دقیقاً همان نوع `string | null` اعلامشده در
  DTOی بکاند بازگردانده شد. فایل تولیدشده تغییر نکرد.

---

## ۳) تحویل

**لایه API و قراردادها**

- `frontend/src/api/documents.api.ts` (جدید): `listDocumentTypes`,
  `getDocumentType`, `configureDocumentType`؛ سه تابع، سه endpoint موجود، بدون
  پارامتر اختراعی.
- `frontend/src/api/client.ts`: افزودهشدن helper کوچک `apiPut` کنار
  `apiPost`/`apiPatch`، تا تنها نوشتن `PUT` محصول هم از همان نمونهٔ Axios،
  نرمالسازی خطا و ردیابی فعالیت درخواست عبور کند.
- `frontend/src/api/contracts.ts`: `DocumentType` (با `NullableString`),
  `ConfigureDocumentTypeRequest`, و `DocumentTypeListQuery` که `sort` را حذف
  میکند.

**مجوز، کلیدها و هوکها**

- `frontend/src/features/permissions/permission-codes.ts`: گروه تازهٔ `documents`
  با دقیقاً دو کد رجیستری بکاند (`View`, `Configure`) و گسترش union
  `PermissionCode`. کدهای DOC-02/DOC-03 عمداً اضافه نشدند (بدون مصرفکننده).
- `frontend/src/api/query-keys.ts`: ریشهٔ `documents` سازمانمحور (سازمان در
  ایندکس ۱) و افزودهشدن آن به `ORGANIZATION_SCOPED_ROOTS`؛
  `documentTypesPrefix` پیشوند هر دو کلید فهرست و جزئیات است تا یک invalidate
  هر دو سطح را تازه کند.
- `frontend/src/features/documents/document-types/use-document-types.ts`:
  وضعیت `search`/`page`/`pageSize` در URL، دو query و یک mutation که پاسخ سرور
  را کش میکند و فهرست + جزئیات را invalidate میکند.

**صفحهها و مسیرها**

- `document-types-page.tsx`: فهرست رجیستری با `DataTable` + `FilterBar`،
  صفحهبندی/جستوجوی سرور، چهار حالت (loading / empty / error+retry / success)
  و توضیح صریح اینکه انواع سند از ماژولها میآیند و ساخته نمیشوند. بدون ستون
  عملیات ساخت/حذف.
- `document-type-detail-page.tsx`: نمایش **همهٔ** فیلدهای قرارداد
  (`code`, `module`, `name`, `description`, `draftCapable`, `entryStates`,
  `deletablePhases`, `draftRequired`, `configured`) با برچسبهای فارسی از i18n و
  fallback امن برای مقادیر ناشناختهی آینده.
- `document-type-configuration-form.tsx`: تنها کنترل `draftRequired`، گیت دقیق
  `Configure`، غیرفعال برای نوع غیر `draftCapable`، ذخیره بدون ارسال مضاعف،
  و نمایش **مقدار بازگشتی سرور** (نه مقدار فرم) پس از موفقیت. خطاها از
  `document-type-error-messages.ts` و برچسبها از `document-type-labels.ts`.
- `frontend/src/app/router.tsx`: دو مسیر `/app/documents/types` و
  `/app/documents/types/:code` زیر یک `RequirePermission` با `View`.
- `frontend/src/app/navigation.ts`: گروه تازهٔ «اسناد پایه» با تُن موجود
  (`admin`، بدون اختراع `NavTone` تازه) و آیتم «انواع سند» با گیت `View`.
- `frontend/src/lib/i18n.ts`: فضای نام تازهٔ `documentTypes` (فضای نام قدیمی
  `documents` متعلق به اسناد حسابداری دستنخورده ماند) بههمراه
  `nav.documentTypes` و `nav.documentsFoundationGroup`. هیچ رشتهای در JSX
  inline نیست.

---

## ۴) انحرافها از متن تسک (همه ثبت شدهاند)

1. **مسیر `edit` جدا ساخته نشد.** همانطور که تسک پیشبینی کرده، تنها فیلد
   تغییرپذیر در صفحهای که خودش رکورد را میخواند قرار گرفت؛ `PUT` پیکربندی
   idempotent است و به خواندن اضافهای نیاز ندارد. بنابراین گیت `…/:id/edit`
   (که نیازمند `View` + `Edit` است) معنایی ندارد — هیچ مجوز `Edit` در رجیستری
   بکاند وجود ندارد.
2. **`apiPut` به لایهٔ مشترک اضافه شد.** تا پیش از این هیچ نوشتن `PUT`ای در
   فرانت وجود نداشت؛ استفادهٔ مستقیم از `apiClient.put` در feature، ردیابی
   فعالیت درخواست و نرمالسازی خطا را دور میزد.
3. **`sort` ارسال نمیشود** (سرویس آن را نادیده میگیرد)؛ `search` خالی نیز با
   `cleanParams` حذف میشود تا فیلتر بیهوده به سرور نرود.
4. **تُن ناوبری تازهای نساخته شد**؛ همانطور که تسک خواسته از `NavTone` موجود
   استفاده شد.

تغییری در بکاند، migration، فایل تولیدشدهٔ OpenAPI، DTO یا رجیستری مجوز
بکاند انجام نشد.

---

## ۵) تستها

| فایل | پوشش |
| --- | --- |
| `src/api/documents.api.test.ts` (۵ تست) | URL/متد/بدنهٔ دقیق، کد در مسیر encode میشود، absenceِ `sort`، نبود `POST`/`DELETE` |
| `src/features/documents/document-types/document-types-page.test.tsx` (۵ تست) | success دو ردیف، empty، error + retry، `search`/`page`/`pageSize` در URL و query، لینک جزئیات، نبود دکمهٔ ساخت |
| `src/features/documents/document-types/document-type-detail-page.test.tsx` (۷ تست) | همهٔ فیلدها، ذخیرهٔ تنها `draftRequired` و نمایش پاسخ سرور، گیت مجوز، `draftCapable=false`، ۴۲۲ → پیام دامنهای، خطای بارگذاری + retry، ۴۰۴ |
| `src/features/documents/document-types/document-types-routing.test.tsx` (۵ تست) | گیت واقعی `RequirePermission` روی روتر، مسدودشدن بدون `View`، مسیر جزئیات، نبود مسیر ساخت/حذف |
| `src/features/documents/document-types/document-types-hooks.test.tsx` (۲ تست) | invalidate جزئیات + فهرست، کششدن پاسخ سرور، نبود `sort` |
| `src/features/documents/document-types/document-type-labels.test.ts` (۴ تست) | نگاشت خالص وضعیتها/فازها/کدهای خطا و عدم نمایش متن خام سرور |

**جمع: ۲۸ تست جدید در ۶ فایل.**

### ماتریس اجرای تست

| دروازه | محیط | نتیجه |
| --- | --- | --- |
| typecheck / lint / format:check | FAST-LOCAL | سبز (۰ خطا، ۰ هشدار، ۴۸۴ فایل lint) |
| واحد کامل فرانتاند | FAST-LOCAL | **۸۴۱ تست / ۱۲۸ فایل، همگی سبز** (۲۸ تست جدید همان اجرا) |
| build تولیدی | FAST-LOCAL | سبز (فقط هشدارهای بالادستیِ ازپیشموجود zod و حجم چانک) |
| `check-date-contract.py`، `check-frontend-design-tokens.mjs`، `check-docs-links.py` | FAST-LOCAL | سبز؛ ۳۷۲ فایل markdown، ۱۳۳۶ لینک نسبی، ۰ شکسته |
| مرورگر E2E / Playwright، jobهای قابلمربوط CI و `ci-gate` | CI-HEAVY | طبق `docs/testing/test-execution-policy.md` فقط در GitHub CI؛ نتیجه در توضیحات PR نهایی ثبت میشود |

هیچ تست سنگین، E2E یا پایگاهدادهٔ زندهای بهصورت محلی اجرا نشد.

---

## ۶) مستندات

- `docs/frontend/coverage-matrix.md`: ردیف «انواع سند» از `MISSING` به
  `COMPLETE`؛ جمع بندی COMPLETE ۳۰→۳۱ و MISSING ۱۳→۱۲؛ اولویت بعدی به
  `DOC-02` اصلاح شد.
- این گزارش (`docs/tasks/DOC-01-implementation-report.md`).
- پیشنهاد الگوی تازهای به `docs/frontend/standards.md` داده نمیشود: پیادهسازی
  فقط ترکیب الگوهای موجود (`DataTable`, `FilterBar`, `DefinitionList`,
  `RequirePermission`, `ApiErrorAlert`, toast) است.

---

## ۷) معیار پذیرش

- [x] فهرست انواع سند با جستوجو و صفحهبندی سرور (بدون `sort`)
- [x] صفحهٔ جزئیات همهٔ فیلدهای قرارداد را نشان میدهد
- [x] پیکربندی فقط `draftRequired` میفرستد و مقدار بازگشتی سرور را نشان میدهد
- [x] نوع غیر `draftCapable` کنترل غیرفعال دارد و کاربر به ۴۲۲ نمیخورد
- [x] هیچ دکمه/مسیر ساخت یا حذف نوع سندی وجود ندارد
- [x] کدهای مجوز دقیقاً `Document.DocumentType.View` و `.Configure`اند
- [x] همهٔ متنها از i18n، بدون `any`، بدون فرمت دستی تاریخ/عدد
- [x] تستها، typecheck، lint، format و build محلی سبز
- [x] `coverage-matrix.md` بهروز و گزارش تسک نوشته شد
- [x] هیچ تغییری در بکاند / فایل تولیدشدهٔ OpenAPI / migration

## ۸) انجامنشده (خارج از دامنهٔ این تسک)

DOC-02 (سریهای شمارهگذاری)، DOC-03 (روابط اسناد)، بقیهٔ موجها و XC-01. چون
سشن به یک شاخهٔ ثابت محدود است و قانون آرشیو «هر تسک = یک PR» است، این PR
فقط DOC-01 است. تستهای مرورگر و لایودیتابیس به CI واگذار شدند و نتیجهٔ آنها
برای SHA نهایی در PR بررسی میشود؛ بدون رؤیت سبز CI چیزی «سبز» اعلام نشده است.
