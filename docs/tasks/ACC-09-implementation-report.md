# ACC-09 — مدیریت تفصیلی‌ها — گزارش پیاده‌سازی

**تاریخ:** ۲۰۲۶-۱۰-۲۶ · **وضعیت:** پیاده‌سازی فرانت‌اند؛ بک‌اند تغییر نکرده است.

## تحویل

- APIهای مستقل `listDetails`, `createDetail`, `updateDetail`, `enableDetail`, `disableDetail` و typeهای Create/Update از قراردادهای OpenAPI. رفتار موجود `listPostableDetails` برای picker سند تغییر نکرد.
- routeها و مجوزهای دقیق View/Create/Edit/Enable/Disable؛ فهرست جدولی با search/level/isActive/isPostable/parentId در URL و pagination سرور.
- فهرست والد را با کد و عنوان resolve می‌کند؛ فرم ایجاد از مسیر `?parentId=` والد را از پیش انتخاب می‌کند و اکشن «افزودن زیرشاخه» دارد.
- فرم ویرایش کد را فقط‌خواندنی/نمایشی نگه می‌دارد و در PATCH فقط title/parentId/isPostable می‌فرستد. ساختار فعال در حالت نبودش هشدار و مسیر تنظیم ساختار را نشان می‌دهد.
- فعال‌سازی/غیرفعال‌سازی با ConfirmDialog و invalidation هدفمند؛ هیچ اکشن DELETE جعل نشده است.

## قرارداد بک‌اند

`DetailsController` برای تفصیلی endpoint حذف ارائه نمی‌کند. بنابراین حذف در فرانت‌اند ساخته نشده است. `detailStructureVersionId` فقط از پاسخ خوانده می‌شود و هیچ‌گاه در بدنهٔ ایجاد/ویرایش ارسال نمی‌شود.

## راستی‌آزمایی

- `src/features/accounting/details/details-admin-page.test.tsx`: دادهٔ فهرست، عملیات lifecycle قابل مشاهده، عدم وجود فیلد کد در ویرایش و بدنهٔ PATCH بدون code را بررسی می‌کند.
- تابع `listPostableDetails` و picker اسناد از نظر کد دست‌نخورده‌اند؛ suite موجود اسناد در اجرای کامل Vitest سبز بود.
- coverage matrix به COMPLETE به‌روزرسانی شد. آزمون‌های محلی typecheck/lint/format، suite کامل و build اجرا شدند.

## محدودیت

فهرست تفصیلی جدول‌محور است و نام والد برای هر ردیف از endpoint جزئیات resolve می‌شود؛ در صورت خطای resolve شناسهٔ کوتاه‌شده به‌عنوان fallback نمایش داده می‌شود. تست‌های lifecycle با ConfirmDialog به‌صورت مستقل باید در CI تکمیل شوند.
