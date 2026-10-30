# INV-06 — نویسندگی درخواست کالا (Material Request Authoring)

- **وضعیت:** پیاده‌سازی‌شده در فرانت‌اند (`INV-06`)
- **تاریخ گزارش:** ۲۰۲۶-۱۰-۳۰ (نویسندهٔ گزارش: جلسهٔ `arena/29564a9e-vardena`)
- **مبنای کد:** `main` @ `4a0dd56`
- **ماژول بک‌اند مرجع:** `backend/src/modules/inventory/api/material-requests.controller.ts` (v1 `/api/v1/inventory/material-requests`)، `application/material-requests.service.ts`، `domain/material-request.ts`، `domain/material-request-permissions.ts`
- **مراجع:** [standards.md](../frontend/standards.md)، [datetime.md](../datetime.md)، [ماتریس پوشش](../frontend/coverage-matrix.md)، `task/inventory/INV-06-material-request-authoring.md`، `OUT-OF-SCOPE.md`
- **تغییر بک‌اند / Prisma / migration / `vardena-api.d.ts`:** **۰** (قرارداد موجود مصرف شد؛ هیچ endpoint، مجوز یا DTO تازه‌ای اختراع نشد)

---

## ۱. خلاصهٔ دامنهٔ تحویل‌شده

درخواست کالا سند «تقاضای داخلی» است: خطوط، کالا/انبار/واحد/مقدار واردشده و پرچم «رزرو لازم است» را نگه می‌دارد، اما **هیچ حرکتی ثبت نمی‌کند**. این تسک فقط **نویسندگی** را می‌آورد:

1. **لایهٔ API — `frontend/src/api/inventory.api.ts`**
   `listMaterialRequests(query, signal?)`، `getMaterialRequest(organizationId, id, signal?)`، `listMaterialRequestEvents(organizationId, id, signal?)`، `createMaterialRequest(body)`، `updateMaterialRequest(organizationId, id, body)`، `deleteMaterialRequest(organizationId, id)`، `submitMaterialRequest(organizationId, id)`.
   `organizationId` در **query** می‌رود (همان‌جا که کنترلر می‌خواند)؛ در `create` داخل **بدنه** است. `submit` بدنهٔ خالی `{}` می‌فرستد (کنترلر body ندارد).
2. **قراردادها — `frontend/src/api/contracts.ts`**
   `MaterialRequestStatus` به‌صورت union مشتق از tuple (`draft`/`submitted`/`returned`/`approved`/`rejected`/`cancelled`/`invoked`) + رکوردها، خط، رویداد، بدنهٔ create/update و پاسخ فهرست. `quantity` **رشتهٔ اعشاری دقیق** می‌ماند و هرگز به float تبدیل/گرد نمی‌شود.
   محدودیت‌های producer (Swagger تولیدی) فقط **باریک** شدند و هیچ‌جا گسترش نیافتند: ستون‌های nullable هدر → `NullableString`؛ `MaterialRequestLineInputDto.reservationRequested` در Swagger **required** تولید می‌شود در حالی که در DTO `@IsOptional()` است؛ `CreateMaterialRequestDto.description` به‌صورت `Record<string, never>` تولید می‌شود.
3. **مجوزها — `features/permissions/permission-codes.ts`**
   `materialRequestView`، `materialRequestCreate`، `materialRequestEdit`، `materialRequestDelete`، `materialRequestSubmit` — دقیقاً همان کدهایی که در `domain/material-request-permissions.ts` ثبت شده‌اند.
4. **کلیدهای query — `api/query-keys.ts`**
   `inventory.materialRequests(orgId, filters)`، `materialRequestsPrefix(orgId)`، `materialRequestDetail(orgId, id)`، `materialRequestEvents(orgId, id)`؛ `organizationId` در ایندکس ۱.
5. **هوک‌ها — `features/inventory/material-requests/material-request-hooks.ts`**
   `useMaterialRequests`، `useMaterialRequest`، `useMaterialRequestEvents`، `useCreateMaterialRequestMutation`، `useUpdateMaterialRequestMutation`، `useDeleteMaterialRequestMutation`، `useSubmitMaterialRequestMutation`. بدون optimistic update؛ پس از هر mutation ابطال `materialRequestsPrefix` + `materialRequestDetail` + `materialRequestEvents` (در همهٔ mutationها، چون هر گذار رویداد تولید می‌کند).
6. **صفحه‌ها**
   - `material-requests-page.tsx` (`/app/inventory/material-requests`، گیت `materialRequestView`): `DataTable` سرور-صفحه‌بندی، فیلترهای `status`/`requestedBy` در **URL** (دقیقاً همان دو پارامتری که query DTO می‌پذیرد)، `sort` محدود به allow-list سرور (`createdAt`/`number`/`status`)، دکمهٔ «درخواست جدید» با گیت `materialRequestCreate`، چهار حالت loading/empty/error/success، ستون‌های شمارهٔ درخواست/وضعیت/توضیح/درخواست‌کننده/تاریخ ایجاد/بازکردن جزئیات.
   - `material-request-detail-page.tsx` (`/app/inventory/material-requests/:requestId`، گیت `materialRequestView`): سرصفحه + نشان وضعیت، جدول خطوط (کالا با کد، انبار با کد، مقدار واردشده + واحد، مقدار پایه، نرخ تبدیل، پرچم رزرو، وضعیت قفل فراخوانی)، جدول رویدادها به ترتیب زمانی، اکشن‌ها، و بنر فقط‌خواندنی برای وضعیت‌های غیرقابل ویرایش.
   - `material-request-form-page.tsx` (`/new` و `/:requestId/edit`): فیلد توضیح + آرایهٔ خطوط قابل افزودن/حذف (حداقل یک خط، حذف در تک‌خطی غیرفعال)، انتخاب کالا/انبار/واحد، `quantity` به‌صورت رشتهٔ دقیق با ۴ رقم اعشار در ارسال، `<input type="checkbox" />` بومی برای «رزرو لازم است» (کامپوننت `ui/checkbox.tsx` در این ریپو وجود ندارد)، خلاصهٔ خطا با `role="alert"` و فوکوس روی آن هنگام شکست اعتبارسنجی.
   - `material-request-actions.tsx`: ارسال (با دیالوگ تأیید) و حذف (با دیالوگ تأیید)، هر دو با گیت مجوز اختصاصی و فقط در وضعیت مجاز.
7. **i18n:** فضای نام `t.materialRequests` (+ `inventoryMaterialRequests` در ناوبری) — هیچ رشتهٔ فارسی inline در JSX نیست؛ تاریخ‌ها با `formatDateTimeWithZone`/`formatDateWithZone` و بدون `new Date`/`toISOString` مستقیم.
8. **ناوبری:** آیتم «درخواست‌های کالا» در `app/navigation.ts` با `materialRequestView` و دو کارت در `inventory-home-page.tsx` (فهرست/ایجاد).

---

## ۲. تطبیق با قرارداد بک‌اند (نقاط تأییدشده)

| قاعدهٔ سرور                                                                         | بازتاب در UI                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ویرایش/ارسال/حذف فقط در `draft` یا `returned`                                       | `canEditMaterialRequest`/`canSubmitMaterialRequest` (پیش‌نویس + برگشتی)، `canDeleteMaterialRequest` (فقط `draft`)؛ فرم در وضعیت دیگر بنر فقط‌خواندنی می‌دهد       |
| `MaterialRequestStatusError` → «… requires "draft"» در همهٔ مسیرها                  | نگاشت الگوی پیام سرور به `t.materialRequests.errors.notEditable` با مقدار وضعیت فعلی؛ هرگز پیام خام نمایش داده نمی‌شود                                            |
| آرایهٔ خط خالی → `400` «at least one line»                                          | اسکیمای Zod حداقل یک خط؛ حذف آخرین خط غیرفعال است و خلاصهٔ خطا `itemRequired` را نشان می‌دهد                                                                      |
| `quantity`: اعشار مثبت، حداکثر ۱۴ رقم صحیح و **۴ رقم اعشار**                        | اسکیمای `decimalString` با `^\d{1,14}(\.\d{1,4})?$`؛ `0`/`0.0000`/`-1`/`1.00001`/`1,5` رد می‌شوند؛ ارسال به‌صورت `'5' → '5.0000'` نرمال می‌شود (دقیق، بدون float) |
| عدم پوشش تبدیل واحد در تاریخ سند → `422`                                            | نگاشت پیام «No unit conversion …» به `t.materialRequests.errors.conversionMissing` با واحد/تاریخ                                                                  |
| کالا/انبار/واحد باید در سازمان قابل استفاده باشند                                   | فقط گزینه‌های فعال از `useInventoryReferences`؛ پیام‌های `notStockable`/`lotTracking`/`serialTracking` نگاشت می‌شوند                                              |
| خطِ فراخوانی‌شده (`invoked`) قابل ویرایش نیست                                       | ردیف خط با `invocationLocked` غیرفعال و دکمهٔ حذفش غیرفعال؛ پیام توضیحی زیر ردیف                                                                                  |
| گذارهای گردش‌کاری (`approve`/`reject`/`return`/`reverse`/`cancel`) و `lines/invoke` | **عمداً ساخته نشد** — `OUT-OF-SCOPE.md` این‌ها را BLOCKED (موتور گردش‌کار) می‌داند؛ `INV-07`                                                                      |
| رویدادها فقط خواندنی و مرتب‌شده                                                     | `material-request-events-table.tsx` با `occurredAt` قالب‌شده و نوع رویداد از سرور                                                                                 |

---

## ۳. انحراف‌ها و تصمیم‌های ثبت‌شده (صادقانه)

1. **ردیف ماتریس پوشش `PARTIAL` است، نه `COMPLETE`.** چرخهٔ نویسندگی کامل است، اما همان ردیف شامل گذارهای گردش‌کاری و `lines/invoke` است که طبق `OUT-OF-SCOPE.md` BLOCKED‌اند. ثبت `COMPLETE` یعنی ادعای پوشش عملیاتی که وجود ندارد.
2. **کامپوننت `ui/checkbox.tsx` وجود نداشت؛** از `<input type="checkbox" />` بومی با استایل توکن‌ها استفاده شد (بدون ساخت primitive تازه در `ui/`، چون خارج از دامنهٔ تسک بود).
3. **`reservationRequested` در فرم اختیاری است** اما Swagger تولیدی آن را required می‌کند؛ نوع دستی در `contracts.ts` اختیاری گرفته شد (باریک‌سازی به سمت واقعیت DTO) و در `create` فقط وقتی `true` است فرستاده می‌شود.
4. **لینک رزروهای `material_request_line` در صفحهٔ جزئیات ساخته نشد.** این بند در گزارش INV-08 به `INV-07` ارجاع داده شده و اکنون مسیر درخواست کالا موجود است، اما فیلتر `referenceId` در `listReservations` وجود ندارد؛ ساختن لینک بدون فیلتر معتبر، کاربر را به فهرست نامرتبط می‌برد. **این بند در `INV-07` بسته می‌شود.**
5. **هیچ ابطال کش `balances`/`availability` انجام نشد:** نویسندگی درخواست کالا موجودی را تغییر نمی‌دهد (فقط ارسال، بدون رزرو). ابطال در INV-07 هنگام invoke/رزرو لازم است.
6. **`prisma:validate` اجرا نشد:** هیچ فایل Prisma/schema تغییر نکرد (صفر migration)، پس گیت مربوطه مصداق ندارد.

---

## ۴. فایل‌های ایجادشده / ویرایش‌شده

**ایجادشده — `frontend/src/features/inventory/material-requests/`:**
`material-request-hooks.ts` · `material-request-url-state.ts` · `material-request-status.ts` · `material-request-error-messages.ts` · `material-requests-columns.tsx` · `material-requests-filter-bar.tsx` · `material-requests-page.tsx` · `material-request-form-schema.ts` · `material-request-line-row.tsx` · `material-request-form-page.tsx` · `material-request-actions.tsx` · `material-request-lines-table.tsx` · `material-request-events-table.tsx` · `material-request-detail-page.tsx` · `material-request-test-fixtures.ts`

**ایجادشده — تست‌ها (۶ فایل):**
`material-requests-page.test.tsx` · `material-request-form-page.test.tsx` · `material-request-detail-page.test.tsx` · `material-request-hooks.test.tsx` · `material-request-logic.test.ts` · (به‌روزرسانی) `src/api/inventory-routes.test.ts`

**ویرایش‌شده:**
`src/api/contracts.ts` · `src/api/inventory.api.ts` · `src/api/query-keys.ts` · `src/features/permissions/permission-codes.ts` · `src/lib/i18n.ts` · `src/app/navigation.ts` · `src/app/routes/workspace-route-tree.tsx` (+ `.test.tsx`) · `src/features/inventory/inventory-home-page.tsx` · `docs/frontend/coverage-matrix.md` · همین گزارش.

---

## ۵. ماتریس اجرای تست (TEST EXECUTION MATRIX)

| گیت                                                | کلاس محیط      | فرمان                                                                                                                                        | نتیجه                                         |
| -------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| تست دامنهٔ تسک                                     | FAST-LOCAL     | `npx vitest run src/features/inventory/material-requests`                                                                                    | ✅ ۵ فایل / ۳۸ تست                            |
| تست مسیرهای API درخواست کالا (هم‌راستا با قرارداد) | FAST-LOCAL     | `npx vitest run src/api/inventory-routes.test.ts`                                                                                            | ✅ ۱ فایل / ۵ تست (۴ موجود + ۱ تازه)          |
| تست درخت مسیر/ناوبری/کارت‌های خانه                 | FAST-LOCAL     | `npx vitest run src/app/routes/workspace-route-tree.test.tsx src/app/navigation.test.ts src/features/inventory/inventory-home-page.test.tsx` | ✅ ۳ فایل / ۳۸ تست                            |
| کل مجموعهٔ واحد/یکپارچگی فرانت                     | FAST-LOCAL     | `npm run test`                                                                                                                               | ✅ ۱۶۰ فایل / ۱۱۶۶ تست                        |
| تحلیل ایستا                                        | FAST-LOCAL     | `npm run lint`                                                                                                                               | ✅ ۰ خطا / ۰ هشدار (۵۷۱ فایل)                 |
| نوع‌ها                                             | FAST-LOCAL     | `npm run typecheck`                                                                                                                          | ✅                                            |
| قالب‌بندی                                          | FAST-LOCAL     | `npm run format:check`                                                                                                                       | ✅                                            |
| ساخت production                                    | FAST-LOCAL     | `npm run build`                                                                                                                              | ✅ (هشدار اندازهٔ chunk از قبل موجود)         |
| گارد تاریخ                                         | FAST-LOCAL     | `python3 scripts/check-date-contract.py`                                                                                                     | ✅ PASS                                       |
| گارد توکن/جهت‌گیری RTL                             | FAST-LOCAL     | `node scripts/check-frontend-design-tokens.mjs`                                                                                              | ✅ OK (۶۷۲ فایل)                              |
| `prisma:validate` / `generate`                     | —              | —                                                                                                                                            | مصداق ندارد (بدون تغییر schema)               |
| `npm run test:e2e` (Playwright 360/768/1280)       | CI-HEAVY       | در CI                                                                                                                                        | در این جلسه اجرا نشد (سیاست execution-policy) |
| آزمون live-DB (`*VARDENA_TEST_DATABASE_URL*`)      | CI-LIVE-DB     | در CI                                                                                                                                        | در این جلسه اجرا نشد                          |
| آزمون هم‌زمانی/ترتیب قفل                           | CI-CONCURRENCY | در CI                                                                                                                                        | در این جلسه اجرا نشد                          |

**No heavy E2E/live-DB test was executed locally unless explicitly authorized.**

---

## ۶. پوشش رفتاری تست‌ها (خلاصه)

- **فهرست:** صفحه‌بندی/فیلترهای URL (`status`، `requestedBy`)، `sort` معتبر، حالت‌های چهارگانه، گیت ایجاد، خواندن وضعیت از URL، برچسب «پیش‌نویس» برای `number === null`.
- **فرم:** ارسال مقدار دقیق `'5.0000'` + `organizationId` و بدون `status`؛ افزودن/حذف خط با حداقل یک خط؛ ارسال خالی → خلاصهٔ خطای `role="alert"` و **بدون** فراخوانی API؛ نگاشت پیام تبدیل واحد؛ ویرایش کل آرایهٔ خطوط با `PATCH` و حفظ `7.5000`؛ خط `invoked` قفل؛ وضعیت غیرقابل ویرایش → بنر و نبود دکمهٔ افزودن خط؛ مسابقهٔ وضعیت (سرور `422`) → پیام `notEditable`.
- **جزئیات:** نشان وضعیت، جدول خطوط و رویدادها، پنهان‌بودن ارسال در حالت فقط‌خواندنی و نمایش آن برای `returned` + مجوز، دیالوگ تأیید و سپس `submitMaterialRequest` + نمایش شمارهٔ سند، حذف فقط برای `draft`، نبود دکمه‌های گردش‌کاری، نمایش مقادیر قفل‌شدهٔ خط `invoked`.
- **هوک‌ها:** آرگومان دقیق هر جهش و ابطال کلیدهای list/detail/events.
- **منطق:** ماتریس وضعیت روی همهٔ اعضای `MATERIAL_REQUEST_STATUSES`، قفل خط، اسکیمای مقدار (رد `0`/`0.0000`/`-1`/`1.00001`/`1,5`/`abc`)، نرمال‌سازی state آدرس (صفحه ۰ → ۱، `archived` → خالی، مرتب‌سازی پیش‌فرض)، متن خطاها.
- **مسیرها:** گیت‌های `/new` → `MaterialRequest.Create`، `/:id` → `View`، `/:id/edit` → `View` + `Edit` (داخلی داخل گروه View فقط `Edit` اضافه می‌کند).
