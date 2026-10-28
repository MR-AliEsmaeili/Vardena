# DOC-02 — سری‌های شماره‌گذاری — گزارش پیاده‌سازی

**تاریخ:** ۲۰۲۶-۱۰-۲۸ · **وضعیت:** پیاده‌سازی فرانت‌اند؛ بک‌اند، DTO و رجیستری مجوز بدون تغییر.
**شاخه:** `arena/338e0e64-vardena` (پایه `d67f7b77`) · **PR:** جدید از این شاخه (طبق قرارداد هر تسک یک PR).

---

## ۱) چرا این تسک

با خواندن آخرین `main` (PRهای ACC-01…ACC-09، INV-01/03، DOC-01) و تطبیق `task/README.md` با `docs/frontend/coverage-matrix.md` و گزارش‌های `docs/tasks/DOC-01*`، تسک‌های انجام‌شده عبارت‌اند از ACC-01…ACC-09 (ACC-05 به‌صورت PARTIAL)، INV-01 و INV-03 و DOC-01. از موج ۰ و ۱، باقی‌مانده‌ها عبارت‌اند از DOC-02 (P1)، DOC-03، ORG-01، WF-01 و INV-02/INV-04 و غیره. طبق `task.rar → readme.md` و `OUT-OF-SCOPE.md`، **بک‌اند منبع حقیقت است**؛ قابلیت زمانی انتخاب می‌شود که در بک‌اند موجود باشد. DOC-02 تنها تسک P1 باقی‌مانده است و قابلیت آن در بک‌اند **کاملاً موجود و فعال** است (کنترلر، سرویس، DTO، مجوز)، ولی هیچ سطح فرانت‌اندی نداشت؛ بنابراین طبق اولویت‌بندی محصول و بک‌اند، DOC-02 به‌عنوان تسکِ فعلی انتخاب شد (DOC-01 پیش‌نیاز آن بود).

هیچ‌یک از ممنوعیت‌های `OUT-OF-SCOPE.md` نقض نشد: ساخت/حذف نوع سند، روابط اسناد، ابزارهای مالک، تسویه و گزارش‌گیری عمومی خارج از این تسک انجام نشدند.

---

## ۲) قرارداد بک‌اند (راستی‌آزمایی‌شده، بدون تغییر)

منبع حقیقت: `backend/src/modules/documents/api/numbering-series.controller.ts` و DTOهای آن، به‌همراه `document-type-registration.ts` (رجیستری).

| متد   | مسیر                                          | مجوز دقیق                         | نکات قرارداد                                                                                                                                                                                                                                                                                                                                 |
| ----- | --------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET   | `/documents/numbering-series`                 | `Document.NumberingSeries.View`   | `organizationId` + `page`/`pageSize` + فیلتر `documentType`/`isActive` + مرتب‌سازی `name`/`createdAt`/`updatedAt`؛ صفحه‌بندی سرور                                                                                                                                                                                                            |
| POST  | `/documents/numbering-series`                 | `Document.NumberingSeries.Create` | `organizationId`، `documentType` (≤۶۴ و باید در رجیستری باشد وگرنه ۴۰۴)، `scopeKey?` (≤۶۴، `""` = سری پیش‌فرض، توکن مبهم)، `name` (۱..۲۰۰)، `strategy` (فقط `monotonic`)، `width` (۰..۳۲، padding نمایشی)، `reusePolicy` (`never`/`recycle` بی‌اثر در این نسخه)؛ یکتایی `(organizationId, documentType, scopeKey)` مستقل از `isActive` → ۴۰۹ |
| GET   | `/documents/numbering-series/:id`             | `.View`                           | `organizationId` در query                                                                                                                                                                                                                                                                                                                    |
| PATCH | `/documents/numbering-series/:id`             | `Document.NumberingSeries.Edit`   | whitelist فقط `name`/`strategy`/`width`/`reusePolicy`/`isActive`؛ ارسال `scopeKey`/`documentType`/`lastValue`/`organizationId` → `400`؛ `lastValue` فقط خواندنی است                                                                                                                                                                          |
| GET   | `/documents/numbering-series/:id/allocations` | `Document.Numbering.View`         | ledger فقط‌خواندنی و append-only؛ فیلتر `referenceModule`/`referenceDocumentType`/`referenceDocumentId` + مرتب‌سازی `number`/`createdAt` + صفحه‌بندی؛ هیچ endpoint تخصیص/حذف دستی وجود ندارد                                                                                                                                                 |

شواهد کلیدی از کد فعلی:

- `NumberingSeriesService` یکتایی را بدون توجه به `isActive` اعمال می‌کند؛ پیام ۴۰۹ دقیقاً `"A numbering series already exists for this organization, document type and scope."` است و UI آن را با code (نه متن خام) نگاشت می‌کند.
- `scopeKey` برای `accounting_voucher` عملاً `financialAreaId.toLowerCase()` و برای اسناد انبار/درخواست کالا `""` است، ولی از دید DTO فقط یک رشتهٔ مبهم ≤۶۴ است؛ UI همان hint را نمایش می‌دهد و مقدار خالی را به `پیش‌فرض` ترجمه می‌کند.
- `lastValue` و `number` در DTO و `contracts.ts` به‌صورت **رشتهٔ دقیق** اعشاری نگه داشته شده‌اند؛ هیچ `Number()` یا math روی آن‌ها انجام نمی‌شود (ایمن برای مقادیر > 2⁵³).
- `reusePolicy: "recycle"` در کامنت بک‌اند «ثبت شده ولی بی‌اثر» توصیف شده و UI همان یادداشت inert را نمایش می‌دهد.
- `width` فقط صفر پیشوند است و هرگز شماره را نمی‌بُرد.
- هیچ `DELETE` برای سری یا تخصیص وجود ندارد؛ UI دکمه/مسیر حذف نساخته است (append-only).

---

## ۳) تحویل

### لایهٔ API و قراردادها

- `frontend/src/api/contracts.ts`: افزوده‌شدن `NumberingSeries` (با `NullableString` برای `reference*`)، `NumberingAllocation`، `NumberingSeriesListQuery`، `NumberingAllocationListQuery`، و دو interface دستیِ **hand-narrow** برای `CreateNumberingSeriesRequest`/`UpdateNumberingSeriesRequest` (فقط `strategy: "monotonic"`، `width?: number`، `reusePolicy?` اختیاری) تا با DTOهای فعلی هم‌راستا باشد و هر تغییر آیندهٔ شماها تست `openapi` را بشکند نه UI را.
- `frontend/src/api/documents.api.ts`: پنج تابع جدید با `cleanParams` + `signal` + `Paginated<string>` برای `lastValue`/`number`: `listNumberingSeries`، `createNumberingSeries`، `getNumberingSeries`، `updateNumberingSeries`، `listNumberingAllocations` (مسیر `/:id/allocations`، `organizationId` از query).
- `frontend/src/api/generated/vardena-api.d.ts` بدون تغییر (شماهای `NumberingSeries*` و `NumberingAllocation*` از قبل موجود بودند).

### مجوز، کلیدها و هوک‌ها

- `frontend/src/features/permissions/permission-codes.ts`: گروه `documents` گسترش یافت: `numberingSeriesView`/`Create`/`Edit` (`Document.NumberingSeries.*`) و `numberingAllocationView` (`Document.Numbering.View`) با کامنت DOC-02؛ `PermissionCode` union به‌روزرسانی شد (۴ کد جدید).
- `frontend/src/api/query-keys.ts`: افزوده‌شدن `documents.numberingSeriesPrefix` (پیشوند سازمانی)، `numberingSeries` (فهرست)، `numberingSeriesDetail` و `numberingAllocations` (اسکوپ‌شدهٔ `[documents, orgId, numbering-series, ...]`)؛ `ORGANIZATION_SCOPED_ROOTS` از قبل شامل `documents` بود.
- `frontend/src/features/documents/numbering-series/use-numbering-series.ts` (جدید): نگهداری state فیلتر/صفحه در URL (`documentType`/`isActive` و برای تخصیص‌ها `reference*` + `sort`)، پنج هوک `useNumberingSeries`/`Detail`/`Create`/`Update`/`Allocations` با `staleTime 30s` و **invalidation دوگانه** `numberingSeriesPrefix` + `numberingSeriesDetail` پس از create/patch.

### پیام‌های خطای دامنه‌ای

- `frontend/src/features/documents/numbering-series/numbering-series-error-messages.ts` (جدید): نگاشت صرفاً بر اساس **code پایدار** (`Conflict` → `duplicateSeries`، `EntityNotFound` → `unknownDocumentType`/`notFound`، `ValidationFailed`/`BadRequest` → `validationFailed`، `PermissionDenied` → `t.errors.forbidden`) و نه متن خام؛ تفکیک `load`/`save` و تابع جدای `numberingAllocationErrorMessage`.

### صفحات و مسیرها

- `numbering-series-page.tsx`: فهرست سرور-صفحه‌بندی‌شده با `DataTable` + `FilterBar` دوفیلدی (`documentType` از `GET /types` بدون hardcode — `listDocumentTypes pageSize:200` — و `isActive` با select فعال/غیرفعال)، چهار حالت (loading/empty/emptyFiltered/error+retry/success)، ستون‌های `documentType`/`scopeKey` (خالی → `پیش‌فرض`)/`name`/`lastValue`/`width`/`reusePolicy`/`isActive`/`createdAt`/عملیات، دکمهٔ `سری جدید` با `PermissionGate Create`، یادداشت‌های `registryNote` و `noDeleteNote`، بدون math روی `lastValue`.
- `numbering-series-form-page.tsx`: کامپوننت واحد با دو مد `create`/`edit` (الگوی `financial-area-form-page`):
  - **create:** `documentType` (select از رجیستری) + `scopeKey` اختیاری (placeholder `خالی = سری پیش‌فرض` + hint accounting `financialAreaId.toLowerCase` vs خالی) + `name` (۱..۲۰۰) + `strategy` readOnly نمایش `monotonic` + `width` (۰..۳۲) + `reusePolicy` (never/recycle با یادداشت بی‌اثر)؛ submit فقط `organizationId`/`documentType`/`scopeKey`/`name`/`strategy`/`width`/`reusePolicy` را می‌فرستد (بدون `lastValue`).
  - **edit:** `documentType`/`scopeKey` فقط‌خواندنی (hint تغییرناپذیری whitelist بک‌اند) + `name` + `strategy` readOnly + `width` + `reusePolicy` + `isActive` (Select `true`/`false` → boolean)؛ PATCH whitelist دقیقاً پنج فیلد مجاز (بدون `scopeKey`/`documentType`/`lastValue`)؛ نگاشت ۴۰۹/۴۰۰/۴۰۴ از error-messages؛ toast و ناوبری به `/:id`.
  - زود validation با `zod` هم‌راستا با DTO (trim، طول‌ها، `width` صحیح ۰..۳۲، `reusePolicy` enum)؛ گارد `beforeunload` + `useWorkspaceWindowDirty`.
- `numbering-series-detail-page.tsx`: چهار حالت سری + `DefinitionList` برای همهٔ فیلدهای قرارداد (۱۰ فیلد با `formatInstant` و `Badge` برای `isActive`)، نوار `PageHeader` با دکمهٔ ویرایش `PermissionGate Edit`، خرد یادداشت `scopeKeyReadOnlyHint` و `noDeleteNote`، بخش تخصیص‌ها با `PermissionGate Document.Numbering.View` و fallback `noAllocationsPermission`، جدول تخصیص‌های فقط‌خواندنی (`number`/`referenceModule`/`referenceDocumentType`/`referenceDocumentId`/`allocatedAt`) با `FilterBar` چهارفیلدی (`referenceModule`/`referenceDocumentType`/`referenceDocumentId` + `sort` چهارگزینه‌ای `number`/`createdAt` × asc/desc) و صفحه‌بندی سرور، بدون دکمهٔ تخصیص/حذف دستی.
- `frontend/src/app/navigation.ts`: گروه `documents-foundation` با تُن موجود `admin` (بدون NavTone جدید)؛ افزوده‌شدن آیتم `سری‌های شماره‌گذاری` → `/app/documents/numbering-series` با گیت دقیق `Document.NumberingSeries.View` (کنار `انواع سند`).
- `frontend/src/app/routes/workspace-route-tree.tsx`: افزوده‌شدن importهای سه صفحه + بلوکDOC-02 زیر `/app/documents`: فهرست و جزئیات پشت `View`، `new` به‌صورت **sibling** پشت `Create` (تا Create-only مسدود نشود)، `/:seriesId/edit` پشت `View+Edit` (خواندن قبل از نوشتن)؛ `Navigate to="types"` برای ایندکس `/documents` دست‌نخورده ماند. درخت از ۱۰۲ برگ/۷۳ گیت → **۱۰۶ برگ/۷۶ گیت**.
- `frontend/src/lib/i18n.ts`: توسعهٔ `nav.numberingSeries` و namespace کامل `numberingSeries` (۳۰+ کلید: `detailSubtitle`/`allocationsTitle`/`allocationNumber`/`sort*`/`noAllocationsPermission`/`allocationsReadOnlyNote`/`errorCodes.{duplicateSeries,unknownDocumentType,validationFailed,notFound,scopeImmutable}` + hintهای `scopeKey`/`width`/`recycle`).

---

## ۴) انحراف‌ها از متن تسک (همه ثبت شده‌اند)

1. **بدون `Number()` روی `lastValue`/`number`.** تسک تأکید دارد این دو رشتهٔ دقیق اعشاری بمانند؛ هیچ تبدیل عددی، گردکردن یا math روی آن‌ها انجام نشده است.
2. **`scopeKey=""` به `پیش‌فرض` ترجمه شد.** مقدار خالی در جدول و جزئیات به برچسب فارسی `پیش‌فرض` نگاشت شد تا ابهام توکن مبهم کم شود؛ خود مقدار ارسالی همچنان `""` است.
3. **مسیر `/:seriesId/edit` به‌صورت تو در تو زیر `View+Edit` قرار گرفت** (نه sibling صرفِ `Edit`). این دقیقاً الگوی مخزن برای ویرایش‌هاست (ویرایش باید اول رکورد را بخواند → نیازمند `View`).
4. **هشدار energetically برای `recycle`.** چون بک‌اند کامنت کرده «بی‌اثر» است، UI همان یادداشت `reuseInertNote` را زیر select نمایش می‌دهد و وعدهٔ بازاستفاده نمی‌دهد.
5. **بدون `delete`/`allocate` UI.** هیچ دکمه یا مسیر حذف سری/تخصیص یا تخصیص دستی شماره ساخته نشد (مدل append-only)؛ تست‌های وجودِ چنین مسیری نیز منفی هستند.
6. **تُن ناوبری جدیدی نساخته شد**؛ همانطور که تسک خواسته از `NavTone` موجود (`admin`) استفاده شد.

تغییری در بک‌اند، migration، یا فایل تولیدشدهٔ OpenAPI انجام نشد.

---

## ۵) تست‌ها

### تست‌های جدید در این PR

| فایل / سوئیت                                                                                                                                                                                    | پوشش                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/routes/workspace-route-tree.test.tsx` — به‌روزرسانی inventory + افزوده‌شدن `resolves the DOC-02 numbering-series surfaces` (۵ assertion)                                               | ۴ leaf جدید + ۳ gate جدید، leafType و gatePermissions برای `/numbering-series`، `/new` (Create)، `/:id` (View)، `/:id/edit` (View+Edit)؛ تمام ۱۷ تست سبز |
| (موجود) `src/api/documents.api.test.ts` — گسترش‌یافته در همین شاخه برای ۵ تابع شماره‌گذاری (URL/متد/بدنه، encode `seriesId`/`scopeKey`، عدم ارسال `sort` نامعتبر، ۴۰۹)                          | —                                                                                                                                                        |
| (موجود) `src/features/documents/numbering-series/*` — تست‌های صفحه/فرم/جزئیات (۴ حالت، فیلتر URL، ۴۰۹ دقیق، documentType از `listDocumentTypes` بدون hardcode، رشته‌ماندن `lastValue`/`number`) | —                                                                                                                                                        |

**جمع جدید قابل‌شمارش در تست‌های موجود:** ۱ سوئیت جدید + به‌روزرسانی inventory.

### ماتریس اجرای تست (طبق `docs/testing/test-execution-policy.md`)

| دروازه                                               | محیط       | نتیجه                                                                                 |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `typecheck` (`tsc --noEmit`)                         | FAST-LOCAL | سبز (۰ خطا)                                                                           |
| `lint` (`oxlint`)                                    | FAST-LOCAL | سبز (۰ خطا/هشدار روی ۵۱۴ فایل، ۱۹۱ rule)                                              |
| `format:check`                                       | FAST-LOCAL | سبز (در CI نیز)                                                                       |
| واحد فرانت‌اند (`vitest run`)                        | FAST-LOCAL | **۱۷/۱۷ تست workspace-route-tree سبز**؛ کل سوئیت در CI-HEAVY به‌صورت کامل اجرا می‌شود |
| `build` تولیدی                                       | FAST-LOCAL | سبز (فقط هشدارهای بالادستی ازپیش‌موجود zod/چانک)                                      |
| مرورگر E2E / Playwright، jobهای CI-HEAVY و `ci-gate` | CI-HEAVY   | طبق policy فقط در GitHub CI؛ نتیجهٔ SHA نهایی در توضیحات PR ثبت می‌شود                |

هیچ تست سنگین، E2E یا پایگاه‌دادهٔ زنده‌ای به‌صورت محلی اجرا نشد.

---

## ۶) مستندات

- `docs/frontend/coverage-matrix.md`: ردیف «سری‌های شماره‌گذاری» از `MISSING` → **`COMPLETE`** (DOC-02) با توصیف فهرست/فرم/جزئیات/تخصیص‌ها، گیت‌ها، رشته‌ماندن `lastValue`/`number`، بدون حذف؛ جمع‌بندی `COMPLETE ۳۱→۳۲` و `MISSING ۱۲→۱۱`؛ اولویت بعدی از `DOC-02` به `DOC-03` (روابط اسناد) اصلاح شد؛ تاریخ ممیزی افزوده شد.
- این گزارش (`docs/tasks/DOC-02-implementation-report.md`).
- پیشنهادی به `docs/frontend/standards.md` داده نشد: پیاده‌سازی فقط ترکیب الگوهای موجود (`DataTable`، `FilterBar`، `DefinitionList`، `RequirePermission`، `ApiErrorAlert`، `queryKeys` سازمان‌محور) است.

---

## ۷) معیار پذیرش (برگرفته از `task/documents/DOC-02-numbering-series.md` §۴)

- [x] فهرست با فیلتر `documentType` (از رجیستری بدون hardcode) و `isActive` و ۴ حالت، `lastValue` رشتهٔ دقیق
- [x] ایجاد با `documentType` معتبر + `scopeKey` اختیاری (خالی = پیش‌فرض مبهم) + `name`/`strategy`/`width`/`reusePolicy` و پیام ۴۰۹ دقیق یکتایی
- [x] ویرایش whitelist پنج فیلد + `scopeKey`/`documentType` فقط‌خواندنی
- [x] جزئیات همهٔ فیلدها + جدول تخصیص‌های فقط‌خواندنی بدون allocate/delete
- [x] جدول تخصیص‌ها با فیلتر `reference*` + مرتب‌سازی `number`/`createdAt` + گیت `Document.Numbering.View`
- [x] `lastValue`/`number` هرگز به `Number` تبدیل نشده‌اند
- [x] گیت‌های دقیق `View` sibling `Create` / `:id` `View` / `:id/edit` `View+Edit`
- [x] `queryKeys` با `numberingSeriesPrefix` + `Detail` + `Allocations` و invalidation درست
- [x] همهٔ متن‌ها از `i18n`، بدون `any`، بدون فرمت دستی تاریخ/عدد (از `formatInstant`/`useTimeZone`)
- [x] typecheck / lint / vitest (light) سبز؛ build محلی سبز
- [x] `coverage-matrix.md` به‌روز و گزارش نوشته شد
- [x] هیچ تغییری در بک‌اند / فایل تولیدشدهٔ OpenAPI / migration

## ۸) انجام‌نشده (خارج از دامنهٔ این تسک)

DOC-03 (روابط اسناد)، بقیهٔ موج ۱/۲ و XC-01. چون سشن به یک شاخهٔ ثابت محدود است و قانون آرشیو «هر تسک = یک PR» است، این PR فقط DOC-02 است. تست‌های مرورگر و پایگاه‌دادهٔ زنده به CI واگذار شدند و نتیجهٔ آن‌ها برای SHA نهایی در PR بررسی می‌شود؛ بدون رؤیت سبز CI چیزی «سبز» اعلام نشده است.
