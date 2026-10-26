# ACC-08 — ساختارهای تفصیلی — گزارش پیاده‌سازی

**تاریخ:** ۲۰۲۶-۱۰-۲۶ · **وضعیت:** پیاده‌سازی فرانت‌اند؛ بک‌اند تغییر نکرده است.

## تحویل

- توابع API فهرست/فعال/جزئیات/ایجاد/ویرایش/انتشار و query keyهای سازمان‌محور برای `detail-structures`.
- مجوزهای `Accounting.DetailStructure.View` و `Accounting.DetailStructure.Configure`، routeهای list/new/detail/edit، فهرست با status در URL و صفحه‌بندی سرور، فرم ایجاد/ویرایش draft، جدول سطح‌ها و تأیید انتشار.
- جزئیات نسخه الگوی سرور را نمایش می‌دهد و در صورت داشتن مجوز `Accounting.Detail.View`، تعداد تفصیلی‌های متصل را با `GET /details?detailStructureVersionId=...` می‌خواند.
- سطح‌های تفصیلی فقط `{ levelIndex, title, digitLength }` هستند؛ این DTO کد، `defaultIsPostable` یا `levelKind` ندارد.

## حقیقت بک‌اند و اختلاف با متن تسک

- مطابق `DetailStructuresService.getActiveDetailStructure` فعلی، نبود نسخهٔ فعال با پاسخ `null` در HTTP 200 نمایش داده می‌شود؛ API فرانت مقدار nullable را مستقیم حفظ می‌کند و 404 عمومی را به «نبود نسخه» تبدیل نمی‌کند.
- انتشار بدون body و با `organizationId` در query اجرا می‌شود. `pattern` صرفاً از پاسخ سرور رندر می‌شود و ذخیره/محاسبهٔ مستقل ندارد.
- هیچ تغییر بک‌اند، migration یا OpenAPI generated انجام نشده است.

## راستی‌آزمایی

- `src/features/accounting/structures/structure-admin-page.test.tsx`: فهرست و بدنهٔ ایجاد را بررسی می‌کند؛ بدنه فاقد فیلدهای ممنوعه و دارای سطح‌های پیوسته است.
- ردیف coverage به COMPLETE تغییر کرد. typecheck، lint (۰ warning/error)، format check، کل Vitest و build در مجموعهٔ همین تغییرات اجرا شدند؛ جزئیات نهایی در توضیح PR درج می‌شود.

## محدودیت

صفحه‌های coding و detail ساختار در یک کامپوننت مشترک نگهداری می‌شوند؛ فیلدها و DTOهای دو قرارداد جدا هستند. تأیید نهایی تست‌های سنگین با GitHub CI است.
