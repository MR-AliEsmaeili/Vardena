# INV-08 — رزرو موجودی (Inventory Reservations)

- **وضعیت:** پیاده‌سازی‌شده در فرانت‌اند (`INV-08`) — کد در PR [#227](https://github.com/MR-AliEsmaeili/Vardena/pull/227) مرج شد؛ این گزارش مستندات عقب‌ماندهٔ همان تغییر است.
- **تاریخ گزارش:** ۲۰۲۶-۱۰-۳۰ (نویسندهٔ گزارش: جلسهٔ `arena/5ce37da6-vardena`)
- **مبنای کد:** `main` @ `123642e` (merge PR #227)
- **ماژول بک‌اند مرجع:** `backend/src/modules/inventory/api/inventory-reservations.controller.ts` (`InventoryReservationsController`، v1 `/api/v1/inventory/reservations`)
- **مراجع:** [standards.md](../frontend/standards.md)، [datetime.md](../datetime.md)، `ADR-0039`، [PDR-05](../decisions/product/PDR-05-inventory-valuation-and-cost-optional-operations.md)، [ماتریس پوشش](../frontend/coverage-matrix.md)
- **تغییر بک‌اند / Prisma / migration / `vardena-api.d.ts`:** **۰**

---

## ۱. خلاصهٔ دامنهٔ تحویل‌شده

رزرو، «ادعای نرم» روی دسترس‌پذیری است: `onHand` را تغییر نمی‌دهد و فقط `reserved` را بالا می‌برد. همهٔ سطوح روی قرارداد موجود بک‌اند ساخته شده‌اند:

1. **لایهٔ API — `frontend/src/api/inventory.api.ts`**
   `listReservations(query, signal?)`, `getReservation(organizationId, id, signal?)`, `createReservation(body)`, `releaseReservation(organizationId, id, body)`.
   `organizationId` رزرو در **query** می‌رود (همان‌جا که کنترلر می‌خواند)، `operationKey` در **بدنه** می‌ماند.
2. **مجوزها — `features/permissions/permission-codes.ts`**
   `reservationView: 'Inventory.Reservation.View'`, `reservationCreate: 'Inventory.Reservation.Create'`, `reservationRelease: 'Inventory.Reservation.Release'` — دقیقاً همان سه کدی که در `inventory-core-permissions.ts` ثبت شده‌اند؛ هیچ کد بالادستی حدسی استفاده نشده.
3. **کلیدهای query — `api/query-keys.ts`**
   `inventory.reservations(orgId, filters)`, `inventory.reservationsPrefix(orgId)`, `inventory.reservationDetail(orgId, id)`؛ `organizationId` در ایندکس ۱ و `placeholderData` فقط با گارد `isOtherOrganizationScope`.
4. **هوک‌ها — `features/inventory/reservations/reservation-hooks.ts`**
   `useReservations`, `useReservation`, `useCreateReservationMutation`, `useReleaseReservationMutation`؛ بدون optimistic update؛ ابطال `reservationsPrefix` + `reservationDetail` + `balancesPrefix` پس از هر mutation.
5. **صفحه‌ها**
   - `reservations-page.tsx` (`/app/inventory/reservations`، گیت `reservationView`): `DataTable` سرور-صفحه‌بندی، فیلترهای `warehouseId`/`itemId`/`status` در URL (`useSearchParams`)، `sort` محدود به allow-list سرور (`createdAt`, `updatedAt`, `status`)، دکمهٔ «رزرو جدید» با گیت `reservationCreate`، چهار حالت loading/empty/error/success.
   - `reservation-detail-page.tsx` (`/app/inventory/reservations/:reservationId`، گیت `reservationView`): `DefinitionList` با مقدار واردشده + واحد، `baseQuantity` + واحد پایه، `conversionFactor`، وضعیت، دلیل، ارجاع، `operationKey` فنی؛ زمان‌ها با `formatDateTimeWithZone` (منطقهٔ زمانی سازمان).
   - `reservation-form-page.tsx` (`/app/inventory/reservations/new`، گیت **فقط** `reservationCreate` به‌صورت sibling): `warehouseId`/`itemId`/`quantity`/`unitId`/`reason`/جفت ارجاع؛ **هیچ فیلد تاریخی ندارد**؛ `operationKey` در `useRef` و پایدار در retry دستی.
6. **i18n:** فضای نام `t.reservations` (عنوان‌ها، برچسب‌ها، حالت‌ها، پیام‌های تأیید و خطا) — هیچ رشتهٔ فارسی inline در JSX.
7. **ناوبری:** آیتم «رزروها» در `app/navigation.ts` با `reservationView` و دو کارت در `inventory-home-page.tsx` (فهرست/ایجاد).

---

## ۲. تطبیق با قرارداد بک‌اند (نقاط تأییدشده)

| قاعدهٔ سرور                                       | بازتاب در UI                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| چرخهٔ عمر فقط `active → released`، پایانی         | دکمهٔ آزادسازی فقط با `status === 'active'`؛ پس از آزادسازی بنر «آزادشده» و هیچ اکشنی؛ ویرایش/حذف وجود ندارد               |
| `release` دوم → `422` «already released»          | نگاشت `already released` به `t.reservations.releasedAlready` (متن دقیق، نه پیام عمومی)                                     |
| `operationKey` اجباری و در بدنه                   | فرم: `useRef(newInventoryOperationKey())`؛ دیالوگ آزادسازی: کلید تازه هنگام باز شدن و ثابت تا موفقیت                       |
| همان `operationKey` با درخواست متفاوت → `409`     | نگاشت به `t.reservations.errors.operationKeyReused`                                                                        |
| `referenceType`/`referenceId` هر دو یا هیچ‌کدام   | اعتبارسنجی Zod (`hasCompleteReservationReference`) + راهنمای فیلد                                                          |
| رزرو BusinessDate ندارد                           | هیچ فیلد تاریخ در فرم/فهرست/جزئیات نیست؛ تبدیل واحد به روز کاری سرور سپرده شده                                             |
| `material_request_line` قابل آزادسازی مستقیم نیست | `canGenericReleaseReservation` دکمه را حذف می‌کند؛ به‌جای دکمه هشدار `materialRequestOwnedTitle` + نمایش `referenceId` خام |
| `quantity`/`baseQuantity`/`conversionFactor` رشته | نمایش با `formatQuantity` (تبدیل رشته‌ای، بدون parse به float)                                                             |
| موجودی ناکافی → `422` با اعداد دقیق               | `t.reservations.errors.insufficientStock` با placeholderهای `{warehouse}`/`{available}`/`{requested}` از پیام سرور         |

---

## ۳. انحراف‌ها و تصمیم‌های ثبت‌شده (صادقانه)

1. **لینک به درخواست کالا ساخته نشد.** تسک (بند ۵.۶) می‌خواست در رزرو `material_request_line` پیام + لینک به `/app/inventory/material-requests/:referenceId` (با مجوز `materialRequestView`) نمایش داده شود. سطح درخواست کالا (`INV-06`/`INV-07`) در فرانت وجود ندارد و مسیری برای آن ثبت نشده است؛ ساختن لینک به مسیر ناموجود، نقض «بدون مسیر جعلی» بود. در نتیجه فقط هشدار + `referenceId` نمایش داده می‌شود. **این بند باید در `INV-07` تکمیل شود** (زمانی که مسیر درخواست کالا موجود باشد).
2. **ابطال کش `availability` انجام نشد؛ فقط `balances`.** تسک ابطال `inventory.availability`/`balances` را می‌خواست. در `query-keys.ts` کلید `availability` وجود ندارد (`use-inventory-references.ts` فقط master-data فعال را کش می‌کند و رزرو آن را تغییر نمی‌دهد)، پس ابطال `balancesPrefix` تنها سطح درست است. هیچ کلید تازه‌ای برای رفع این تفاوت اختراع نشد.
3. **سخت‌گیری سمت فرم روی `reason`.** قرارداد بک‌اند `reason` را تا **۱۰۰۰** نویسه می‌پذیرد؛ اسکیمای فرم سقف **۵۰۰** می‌گذارد و hint هم همین را می‌گوید. این محدودیتِ افزوده (سخت‌گیرانه‌تر از سرور) عمداً حفظ شده تا با الگوی سایر فرم‌های موجودی یکسان بماند؛ اگر مالک بخواهد، با یک تغییر تک‌خطی به ۱۰۰۰ می‌رسد.
4. **`referenceType = material_request_line` در فرم عمومی رد می‌شود.** تسک فقط آزادسازی این رزروها را ممنوع کرده بود؛ اسکیمای فرم ساختِ دستی آن را نیز رد می‌کند (`materialRequestReferenceReserved`)، چون رزرو مالک‌دار بدون چرخهٔ درخواست کالا قابل مدیریت نیست و ادعای رزرو یتیم می‌ساخت.
5. **بدهی مستندات همین PR.** PR #227 هیچ فایل `docs/` را تغییر نداد: نه این گزارش نوشته شده بود، نه ردیف ماتریس پوشش. با همین گزارش و به‌روزرسانی `docs/frontend/coverage-matrix.md` بسته می‌شود.

---

## ۴. فایل‌های ایجادشده

`frontend/src/features/inventory/reservations/`: `reservations-page.tsx` · `reservations-columns.tsx` · `reservations-filter-bar.tsx` · `reservation-url-state.ts` · `reservation-detail-page.tsx` · `reservation-form-page.tsx` · `reservation-form-schema.ts` · `reservation-hooks.ts` · `reservation-error-messages.ts` · `reservation-reference.ts` · `reference-pair.ts` · `reservation-release-action.tsx` · `reservation-test-fixtures.ts` + ۸ فایل تست.

**ویرایش‌شده:** `api/inventory.api.ts` · `api/contracts.ts` · `api/query-keys.ts` · `api/inventory-routes.test.ts` · `app/navigation.ts` · `app/navigation.test.ts` · `app/routes/workspace-route-tree.tsx` · `app/routes/workspace-route-tree.test.tsx` · `features/inventory/inventory-home-page.tsx` (+ تست) · `features/permissions/permission-codes.ts` · `lib/i18n.ts`.

---

## ۵. راستی‌آزمایی

| گیت                                                  | محیط       | نتیجه                                                         |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| `npx vitest run src/features/inventory/reservations` | FAST-LOCAL | ✅ ۸ فایل / ۳۲ تست                                            |
| `npm run typecheck`                                  | FAST-LOCAL | ✅                                                            |
| `npm run lint`                                       | FAST-LOCAL | ✅ ۰ خطا، ۰ هشدار (۵۵۱ فایل)                                  |
| `npm run format:check`                               | FAST-LOCAL | ✅                                                            |
| `npm run test` (کل مجموعه) و `npm run build`         | FAST-LOCAL | در این جلسه اجرا نشد (خارج از دامنهٔ همین گزارش؛ CI مرجع است) |
| `npm run test:e2e` و آزمون live-DB                   | CI-HEAVY   | اجرا نشد                                                      |

---

## ۶. معیار پذیرش

- [x] فهرست/جزئیات/ایجاد/آزادسازی با گیت مجوز دقیق هر endpoint
- [x] `operationKey` الزامی، در بدنه، پایدار در retry دستی
- [x] `referenceType`/`referenceId` فقط با هم
- [x] هیچ فیلد تاریخ در فرم یا صفحه
- [x] رزرو `material_request_line` دکمهٔ آزادسازی ندارد (لینک به درخواست کالا به INV-07 موکول شد — انحراف ۱)
- [x] آزادسازی دوباره پیام دقیق سرور را نشان می‌دهد
- [x] `quantity` رشته می‌ماند؛ `baseQuantity` از سرور
- [x] `sort` محدود به allow-list
- [x] تست‌ها سبز؛ `coverage-matrix.md` به‌روز شد
