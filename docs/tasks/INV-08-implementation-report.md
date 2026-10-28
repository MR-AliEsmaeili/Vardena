# گزارش اجرایی INV-08 — رزرو موجودی (Inventory Reservations)

**تاریخ:** ۲۰۲۶-۱۰-۲۷ · **شاخه:** `arena/70d2d595-vardena` · **موج:** ۱

## چکیده اجرا
رزرو موجودی «ادعای نرم» روی دسترس‌پذیری است: موجودی را جابه‌جا نمی‌کند و فقط `reserved` را بالا می‌برد. بک-André کامل است (`list/detail/create/release`، کلید `operationKey` در بدنه، تبدیل واحد در روز کاری جاری، سیاست موجودی منفی) و فرانت‌اند هیچ سطحی ندارد. این تسک لایه نویشی فرانت-André را می‌سازد و هیچ تغییری در بک-André ایجاد نمی‌کند.

## مطابقت با contrato بک-André (بدون تغییر)

| متد | مسیر | مجوز |
| --- | --- | --- |
| GET | `/inventory/reservations` | `Inventory.Reservation.View` |
| GET | `/inventory/reservations/:id` | `Inventory.Reservation.View` |
| POST | `/inventory/reservations` | `Inventory.Reservation.Create` |
| POST | `/inventory/reservations/:id/release` | `Inventory.Reservation.Release` |

تأیید کد مجوز در `backend/src/modules/inventory/domain/inventory-core-permissions.ts` (RESERVATION_PERMISSIONS) و مسیرها در `inventory-reservations.controller.ts` انجام شد؛ کدها به‌صورت دقیق در `frontend/src/features/permissions/permission-codes.ts` (گروه `inventory`) کپی شدند.

## انحراف‌ها

- `PUT /inventory/material-requests/:id/lines/invoke` (فراخوانی سطر) طبق `task/OUT-OF-SCOPE.md` مسدود است و UI نمی‌سازد.
- چرخه تأیید درخواست کالا (INV-07) در این تسک نیست؛ هیچ دکمهٔ تأیید/رد/لغو/فراخوانی سطر ساخته نشده.
- رزرو `material_request_line` آزادسازی مستقیم ندارد (پیام+t لینک به درخواست کالا).
- `quantity`/`baseQuantity`/`conversionFactor` رشته می‌مانند؛ هیچ تبدیل/گردکردن سمت کلاینت نیست.
- رزرو BusinessDate ندارد — هیچ فیلد تاریخ در فرم/صفحه نیست.
- `operationKey` در بدنه است (نه هدر)، برای create و release الزامی، و در retry دستی پایدار است.

## فایل‌های جدید/تغییر یافته

Frontend:
- `frontend/src/features/permissions/permission-codes.ts` — ۳ کد مجوز افزوده شد.
- `frontend/src/api/inventory.api.ts` — ۴ تابع + انواع درخواست/پاسخ.
- `frontend/src/api/query-keys.ts` — `reservations` / `reservationsPrefix` / `reservation`.
- `frontend/src/features/inventory/reservations/reservation-hooks.ts` — هوک‌ها + Motorهای invalidation.
- `frontend/src/features/inventory/reservations/reservation-error-messages.ts` — نقشه 메시지‌های خطای دامنه.
- `frontend/src/features/inventory/reservations/reservations-page.tsx` — فهرست (صفحه‌بندی سرور، فیلتر URL).
- `frontend/src/features/inventory/reservations/reservation-detail-page.tsx` — جزئیات + آزادسازی.
- `frontend/src/features/inventory/reservations/reservation-form-page.tsx` — ایجاد رزرو.
- `frontend/src/features/inventory/reservations/reference-pair.test.ts`
- `frontend/src/features/inventory/reservations/reservation-hooks.test.tsx`
- `frontend/src/features/inventory/reservations/reservations-page.test.tsx`
- `frontend/src/features/inventory/reservations/reservation-form-page.test.tsx`
- `frontend/src/features/inventory/reservations/reservation-detail-page.test.tsx`
- `frontend/src/lib/i18n.ts` — فضای نام `reservations`.
- `frontend/src/app/routes/workspace-route-tree.tsx` — مسیرها (Create سیلینگ از View جدا است).
- `frontend/src/app/navigation.ts` — ورودی ناوبری.
- `frontend/src/features/inventory/inventory-home-page.tsx` — کارت صفحه خانه.

مستندات:
- `docs/frontend/coverage-matrix.md` — ردیف رزرو موجودی → COMPLETE.
- `docs/tasks/INV-08-implementation-report.md` (این فایل).

## راستی‌آزمایی اجرا شده

`cd frontend && npm run typecheck` سبز · `npm run lint` بدون خطای جدید · `npm run format:check` سبز · `npx vitest run src/features/inventory/reservations` سبز · `npm run test` سبز · `npm run build` سبز.

## معیار پذیرش

- [x] فهرست/جزئیات/ایجاد/آزادسازی کار می‌کنند و هر کدام گیت مجوز دارند
- [x] `operationKey` الزامی، در بدنه، و در retry دستی پایدار است
- [x] `referenceType`/`referenceId` فقط با هم پذیرفته می‌شوند
- [x] هیچ فیلد تاریخ در فرم یا صفحه وجود ندارد
- [x] رزرو `material_request_line` دکمهٔ آزادسازی ندارد و مسیر درخواست کالا را پیشنهاد می‌دهد
- [x] آزادسازی دوباره پیام دقیق سرور را نشان می‌دهد
- [x] `quantity` رشته می‌ماند؛ هیچ تبدیل/گردکردنی نیست و `baseQuantity` از سرور نمایش داده می‌شود
- [x] `sort` به allow-list محدود است
- [x] تست‌های جدید سبز و ماتریس پوشش به‌روز

## استثناء
هیچ‌کدام.
