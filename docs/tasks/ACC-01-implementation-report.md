# گزارش پیاده‌سازی ACC-01 — مدیریت نواحی مالی (Financial Area Administration)

| | |
| --- | --- |
| **تسک** | ACC-01 (حسابداری، P1، موج ۰) |
| **نوع** | فرانت‌اند + تست + مستندات — **بدون هیچ تغییر بک‌اند** |
| **قرارداد مبنا** | `backend/src/modules/accounting/api/financial-areas.controller.ts` + `dto/financial-area.dto.ts` + `domain/accounting-permissions.ts` (بدون تغییر) |

## ۱) نتیجه

نواحی مالی دیگر فقط خواندنی نیستند. مدیر از مسیر مدیریتی حسابداری
(`/app/accounting/financial-areas`) می‌تواند حوزه مالی بسازد
(`financial-areas/new`)، `code`/`title` را ویرایش کند
(`financial-areas/:financialAreaId/edit`)، پیش‌فرض تعیین کند و فعال/غیرفعال
کند — هر عملیات فقط با مجوز دقیق همان endpoint، و عملیاتی که کاربر مجوزش را
ندارد اصلاً رندر نمی‌شود (پنهان، نه `disabled`).

## ۲) فایل‌های تغییرکرده

### جدید

| فایل | نقش |
| --- | --- |
| `frontend/src/features/accounting/master-data/financial-area-schema.ts` | schema مشترک `financialAreaSchema` + تایپ `FinancialAreaFormValues` + ثابت‌های طول (۶۴/۲۰۰، آیینه DTO بک‌اند) |
| `frontend/src/features/accounting/master-data/financial-area-hooks.ts` | `useFinancialAreaDetail`، `useCreateFinancialAreaMutation`، `useUpdateFinancialAreaMutation(organizationId, financialAreaId)`، `useFinancialAreaLifecycleMutation` با `{ id, next: 'enable' \| 'disable' }` |
| `frontend/src/features/accounting/master-data/financial-area-form-page.tsx` | صفحه فرم واحد با prop `mode: 'create' \| 'edit'` (الگوی `branch-form-page.tsx`) |
| `frontend/src/features/accounting/master-data/financial-area-row-actions.tsx` | اکشن‌های ردیف فهرست: ویرایش / تعیین پیش‌فرض / فعال / غیرفعال + `ConfirmDialog` |
| `frontend/src/features/accounting/master-data/financial-area-error-messages.ts` | نگاشت خطای عملیاتی بر اساس کد خطای پایدار + نگاشت اعتبارسنجی سرور روی فیلدهای فرم |
| `frontend/src/features/accounting/master-data/financial-area-schema.test.ts` | تست schema (حد طول، trim، پیام‌ها) |
| `frontend/src/features/accounting/master-data/financial-areas-page.test.tsx` | تست فهرست و اکشن‌های ردیف |
| `frontend/src/features/accounting/master-data/financial-area-form-page.test.tsx` | تست فرم create/edit |
| `frontend/src/features/accounting/master-data/financial-area-hooks.test.tsx` | تست قرارداد API و invalidate هوک‌ها |
| `docs/tasks/ACC-01-implementation-report.md` | همین گزارش |

### ویرایش‌شده

| فایل | تغییر |
| --- | --- |
| `frontend/src/api/contracts.ts` | `UpdateFinancialAreaRequest = Schemas['UpdateFinancialAreaDto']` (مشتق از OpenAPI تولیدشده، نه دستی) |
| `frontend/src/api/accounting.api.ts` | `updateFinancialArea` (PATCH)، `enableFinancialArea` / `disableFinancialArea` (POST بدون بدنه، الگوی `enableBranch`) + `getFinancialArea` (نکته ۱ در بخش انحراف‌ها) |
| `frontend/src/api/query-keys.ts` | `financialAreaPrefix` و `financialAreaDetail` طبق §۵.۴ تسک |
| `frontend/src/features/permissions/permission-codes.ts` | `financialAreaEdit` / `financialAreaEnable` / `financialAreaDisable` با کدهای دقیق رجیستری بک‌اند |
| `frontend/src/lib/i18n.ts` | فضای نام تازه `t.financialArea` (همه کلیدهای §۵.۸؛ نکته ۵) |
| `frontend/src/app/router.tsx` | مسیر `new` خواهرِ گروه View با گیت فقط Create؛ مسیر `:financialAreaId/edit` داخل گروه View و با گیت اضافی Edit |
| `frontend/src/features/accounting/master-data/financial-areas-page.tsx` | `PageHeader.actions` (دکمه ایجاد با `PermissionGate`) + ستون `actions` |
| `frontend/src/features/accounting/context/financial-area-create-form.tsx` | فقط حذف schema داخلی و import کردن schema مشترک (§۵.۱)؛ منطق و ظاهر فرم بی‌تغییر |
| `frontend/src/features/accounting/master-data/master-data-pages.test.tsx` | کامل‌کردن mock ماژول `accounting.api` با تابع‌های تازه |
| `frontend/src/app/routes/protected-routing.test.tsx` | سه تست گیت مسیر ACC-01 + mock برای `getFinancialArea` |
| `frontend/src/test/fixtures.ts` | افزودن سه کد مجوز تازه به `allAccountingPermissions` |
| `docs/frontend/coverage-matrix.md` | ردیف «نواحی مالی» از `PARTIAL` به `COMPLETE` + اصلاح جمع‌بندی |

بدون تغییر (طبق دامنه تسک): `frontend/src/app/navigation.ts`،
`accounting-home-page.tsx`، تابع موجود `createFinancialArea` و هر فایل بک‌اند.

## ۳) قواعد قراردادی رعایت‌شده

- **گیت مسیر `new` فقط `Accounting.FinancialArea.Create` است** و خواهر گروه
  View تعریف شده است؛ گیت `edit` همان View + Edit است (چون صفحه اول رکورد را
  با `GET /:id` می‌خواند).
- **تعیین پیش‌فرض فقط `{ isDefault: true }` می‌فرستد.** فرم ویرایش هرگز
  `isDefault: false` نمی‌فرستد و قاعده «فقط یک پیش‌فرض» در فرانت بازپیاده
  نشده است؛ بک‌اند پیش‌فرض قبلی را اتمیک برمی‌دارد و UI پس از invalidate
  حقیقت سرور را دوباره می‌خواند.
- **مسیر `DELETE` ساخته نشده است** (بک‌اند ندارد)؛ چرخه عمر فقط enable/disable است.
- پس از هر mutation تأییدشده، `financialAreaPrefix` و `financialAreas`
  invalidate می‌شوند (نکته ۳)؛ هیچ mutationای optimistic یا auto-retry نیست.
- هیچ رشته فارسی inline در JSX نیست؛ همه متن‌ها از `t.financialArea.*` یا
  کلیدهای موجود `t.masterData` می‌آیند. واژه دامنه در UI همان «حوزه مالی»
  ثابت موجود ریپو مانده است و مترادف تازه‌ای ابداع نشده است.

## ۴) تست‌ها (سبک، لوکالی — سنگین در CI)

| دستور | نتیجه لوکال |
| --- | --- |
| `npm run typecheck` | سبز |
| `npm run lint` | سبز (۰ هشدار، ۰ خطا) |
| `npm run format:check` | سبز |
| `npx vitest run src/features/accounting/master-data` | ۹ فایل، ۵۵ تست سبز (شامل ۵ schema + ۷ فهرست + ۴ فرم + ۳ هوک تازه) |
| `npx vitest run src/features/accounting/context/financial-context-gate.test.tsx src/app/routes/protected-routing.test.tsx` | ۲ فایل، ۲۶ تست سبز (رگرسیون گیت زمینه + گیت مسیرهای ACC-01) |

سناریوهای §۶ تسک پوشش داده شده‌اند: موفقیت با ۲ ناحیه، empty، خطا + retry،
نبود دکمه ایجاد بدون `financialAreaCreate`، نبود دکمه غیرفعال بدون
`financialAreaDisable`، ارسال دقیق `{ organizationId, code, title }` در
create، بارگذاری رکورد + `PATCH` در edit، خطای اعتبارسنجی فیلد خالی، خطای
سرور در `ApiErrorAlert` با نگاشت ۴۰۹ و بدون نمایش پیام خام، invalidate روی
prefix و `financialAreas` پس از mutation، و حد طول/trim/پیام‌های schema.
افزون بر تسک، جریان کامل تعیین پیش‌فرض و غیرفعال‌سازی (Confirm → فراخوانی
API) در تست فهرست و سه گیت مسیر در `protected-routing.test.tsx` اثبات شده‌اند.

طبق دستور مالک، suite کامل (`npm run test`، `build`، E2E و بقیه jobها) در CI
همین PR دنبال و فقط نتیجه سبز نهایی تحویل داده می‌شود؛ لوکالی فقط تست‌های
سبک بالا اجرا شده‌اند.

### رگرسیون گیت زمینه مالی

schema مشترک دقیقاً همان schema قبلی فرم bootstrap است (همان حدود، همان
متن فارسی پیام‌های `codeRequired`/`titleRequired`)؛ تنها تفاوت این است که
پیام‌های حد طول هم اکنون صریحاً فارسی‌اند
(`codeTooLong`/`titleTooLong`) به‌جای پیام پیش‌فرض Zod. فرم گیت زمینه از
نظر منطق، ظاهر، mutation و invalidate دست نخورده است و هر ۷ تست
`financial-context-gate.test.tsx` — از جمله «ایجاد نخستین ناحیه از ورودی
صریح کاربر و ورود دوباره از فهرست سرور» — سبز مانده‌اند.

## ۵) انحراف‌ها و تصمیم‌های اجرایی

۱. **`getFinancialArea` هم به لایه API اضافه شد.** §۵.۲ تسک سه تابع نام
   می‌برد، اما `useFinancialAreaDetail` در §۵.۵ بدون تابع خواندن `GET /:id`
   (که در جدول قرارداد §۳ هست) ممکن نیست؛ تابع با همان سبک `getAccount`
   اضافه شده است.
۲. **نگاشت `errorCodes` روی کدهای `accounting.financial_area.*` انجام نشد،
   چون چنین خانواده کدی در بک‌اند وجود ندارد.** سرویس
   (`financial-areas.service.ts`) خطاها را با `AppException.conflict`
   (کد تکراری، ۴۰۹) و `AppException.businessRule` (سال مالی باز هنگام
   غیرفعال‌سازی، ۴۲۲، با `details.openFiscalYearId`) می‌سازد.
   `financial-area-error-messages.ts` روی همین کدهای پایدار واقعی
   (`Conflict` / `BusinessRuleViolation` / …) شاخه می‌زند — اختراع کد
   خیالی هیچ خطای واقعی را نگاشت نمی‌کرد.
۳. **invalidation سوم اضافه شد:** علاوه بر `financialAreaPrefix` و
   `financialAreas` (که امروز دقیقاً به یک tuple می‌رسند و هر دو صریحاً
   invalidate می‌شوند)، کلید `financialContextAreas` هم invalidate می‌شود
   تا هدف اعلام‌شده تسک — «گیت زمینه هم تازه شود» — واقعاً محقق شود؛ گیت
   زمینه روی `financialContextAreas` سوار است، نه روی `financialAreas`.
۴. **اکشن‌های ردیف دکمه کوچک inline هستند، نه `DropdownMenu`** (تسک هر دو
   را مجاز کرده بود) و در کامپوننت جدا
   (`financial-area-row-actions.tsx`) زندگی می‌کنند تا فایل صفحه در حدود
   راهنمای استاندارد بماند و هوک‌های هر ردیف مالک مشخص داشته باشند.
۵. **چند کلید i18n افزون بر فهرست §۵.۸** برای پوشش پیام‌هایی که همان بخش
   لازم دارد اضافه شد: `codeTooLong`، `titleTooLong`، `actions`،
   `enabling`/`disabling`، پیام‌های موفقیت تفکیکی
   (`created`/`updated`/`enabled`/`disabled`/`defaultSet`) و متن‌های گارد
   خروج از فرم کثیف. همه کلیدهای نام‌برده‌شده در تسک حضور دارند.
۶. **فرم از `AdminFormShell` سازمان import نمی‌کند.** آن shell به فضای نام
   `t.orgAdmin` سازمان گره خورده است؛ به‌جای import بین‌دامنه‌ای، همان
   ساختار معادل (`PageHeader` + خلاصه خطای پایدار بالای فرم + دکمه‌های
   ذخیره/لغو + گارد خروج از فرم کثیف) با متن‌های `t.financialArea` داخل
   خود صفحه فرم حسابداری ساخته شده است (تسک «ساختار معادل موجود در همان
   دامنه» را مجاز کرده بود).

## ۶) پیشنهاد برای `standards.md` (اعمال‌نشده — طبق §۷.۳ تسک)

الگوی «اکشن‌های ردیف + `ConfirmDialog` + فرم صفحه‌ای create/edit» اکنون در
سه دامنه با shellهای موازی تکرار شده است: سازمان
(`admin-form-shell.tsx` + `admin-lifecycle-actions.tsx`)، انبار
(`master-data-form-shell.tsx` + `master-data-lifecycle-actions.tsx`) و
حسابداری (shell داخل همین صفحه فرم + `financial-area-row-actions.tsx`).
پیشنهاد می‌شود در یک تسک مستقل، `AdminFormShell` و کامپوننت چرخه عمر به
لایه مشترک `src/ui/patterns` منتقل و در `standards.md` به‌عنوان الگوی واحد
صفحه‌های مدیریتی ثبت شوند تا دامنه چهارم نسخه چهارم را نسازد. این سند
(گزارش) طبق دستور تسک فقط پیشنهاد می‌دهد و `standards.md` ویرایش نشده است.

## ۷) چک‌لیست پذیرش (§۸ تسک)

- [x] ایجاد ناحیه از صفحه مدیریتی (نه فقط گیت bootstrap)
- [x] ویرایش `code`/`title` + تازه‌شدن فهرست پس از ذخیره (invalidate)
- [x] تعیین پیش‌فرض با تأیید؛ پیش‌فرض قبلی پس از پاسخ سرور و invalidate در UI برداشته می‌شود
- [x] فعال/غیرفعال با تأیید؛ نشان وضعیت جدول پس از پاسخ سرور به‌روز می‌شود
- [x] هر اکشن فقط با مجوز دقیق خودش دیده می‌شود (پنهان، نه disabled) — تست‌شده
- [x] مسیر `:id/edit` بدون `financialAreaEdit` با `RequirePermission` مسدود — تست‌شده
- [x] فرم ایجاد فقط با `financialAreaCreate` (بدون پیش‌نیاز View) — تست‌شده
- [x] همه تست‌های §۶ سبز (لوکال)؛ suite سنگین در CI دنبال می‌شود
- [x] `coverage-matrix.md` به‌روز (`COMPLETE`)
