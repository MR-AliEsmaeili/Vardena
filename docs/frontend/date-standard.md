# استاندارد تاریخ و زمان در فرانت‌اند Vardena

**وضعیت:** ACTIVE
**نسخه:** ۱.۰
**تاریخ:** ۲۰۲۶-۱۰-۲۳
**مرجع بالادستی الزامی:** [docs/datetime.md](../datetime.md) · [ADR-0042](../adr/0042-datetime-calendar-architecture.md) · [ADR-0044](../adr/0044-fixed-jalali-first-businessdate-policy.md) · قاعدۀ معماری `AR-32`

> **هشدار قراردادی:** سیاست تاریخ پروژه دائمی و مصوب مالک محصول است. هیچ کامپوننتی خارج از `frontend/src/lib/datetime/` مجاز به import مستقیم کتابخانه تقویم (`dayjs` یا `jalaali-js`)، استفاده از `new Date()` نیمه‌شب UTC برای روز کاری، یا فراخوانی `toLocaleDateString` نیست. این قاعده در CI توسط `python3 scripts/check-date-contract.py` و تست‌های مصرف‌کننده محافظت می‌شود.

---

## ۱) تفکیک دائمی BusinessDate و Instant

| نوع داده | معنا | ذخیره در پایگاه‌داده و پروتکل API | نمایش در رابط کاربری |
| --- | --- | --- | --- |
| **`BusinessDate`** | روز تقویمی اقتصادی سند (مثلاً تاریخ سند حسابداری یا رسید انبار) | PostgreSQL `date`؛ رشته ASCII کانونیکال `YYYY-MM-DD` (یا ورودی صریح `{ calendar: 'JALALI', value: 'YYYY-MM-DD' }`) | ثابت و شمسی-اول با ارقام فارسی: `۱۴۰۵/۰۷/۱۶` (در نمای جزئیات همراه با مقدار میلادی کانونیکال در پرانتز یا `title` برای تطبیق ممیزی) |
| **`Instant`** | لحظۀ دقیق زمانی رخداد (مثلاً `createdAt`, `finalizedAt`, `postingTimestamp`) | PostgreSQL `timestamptz`؛ رشته ISO-8601 UTC با پسوند `Z` | ابتدا تبدیل به منطقه زمانی IANA معتبر سازمان فعال (`organization.timeZone`، پیش‌فرض `Asia/Tehran`) و سپس نمایش شمسی با ارقام فارسی (همراه با ثانیه و نام/افست منطقه زمانی در نماهای جزئیات و ممیزی) |

---

## ۲) کامپوننت یکپارچه Date Picker شمسی (`DateInput`)

تنها کنترل مجاز ورود `BusinessDate` در کل فرانت‌اند `src/ui/patterns/date-input.tsx` (به همراه `jalali-date-input-field.tsx`) است:

1. **مقدار فرم همیشه کانونیکال است:** پراپ `value` و خروجی `onValueChange` همیشه رشته میلادی کانونیکال `YYYY-MM-DD` (یا `''` در حالت خالی) با ارقام ASCII است؛ کامپوننت مصرف‌کننده هرگز رشته شمسی ذخیره نمی‌کند.
2. **ورودی دستی انعطاف‌پذیر:** اپراتور می‌تواند تاریخ شمسی را با ارقام فارسی (`۱۴۰۵/۰۷/۱۶`)، عربی (`١٤٠٥/٠٧/١٦`) یا لاتین (`1405/07/16`، `1405-07-16` یا فرم کوتاه `1405/7/6`) تایپ کند. تابع `resolveDayInput` اعتبار واقعی روز در تقویم جلالی (شامل کبیسه‌بودن سال برای ۳۰ اسفند) را بررسی کرده و تنها در صورت معتبر بودن، مقدار کانونیکال را صادر می‌کند. متن ناقص حین تایپ مقدار معتبر قبلی فرم را خراب نمی‌کند.
3. **پاپ‌آپ تقویم تعاملی شمسی:** دکمۀ آیکون تقویم (`data-testid="jalali-calendar-trigger"`) یک تقویم ماهانه هجری شمسی باز می‌کند که مستقیماً روی توابع هسته `@/lib/datetime` (`jalaliMonthLengthOf`, `jalaliDayToGregorianDay`, `jalaliDayOf`, `todayBusinessDay`, `toPersianDigits`) ساخته شده است:
   - شروع هفته از **شنبه** (`ش ی د س چ پ ج`).
   - محاسبه دقیق تعداد روزهای ماه (۳۱ روز در نیمه اول، ۳۰ روز در ماه‌های ۷ تا ۱۱، و ۲۹ یا ۳۰ روز در اسفند بر اساس سال کبیسه جلالی).
   - پیمایش ماه قبل و بعد، انتخاب سریع **«امروز»** بر مبنای منطقه زمانی سازمان فعال (`useTimeZone`)، دکمۀ **«پاک کردن»** و بستن با کلید `Escape` یا کلیک بیرون.
4. **پشتیبان خودکار تاریخ‌های تاریخی خارج از بازه (`Gregorian Fallback`):** اگر یک سند تاریخی معتبر در دیتابیس خارج از بازه قابل تبدیل کتابخانه جلالی باشد (`isBusinessDay(value) && jalaliDayOf(value) === null`)، `DateInput` بدون حذف یا دستکاری داده، فیلد را با `data-calendar="GREGORIAN"` و `data-calendar-fallback="true"` نمایش می‌دهد (مطابق ADR-0044).

---

## ۳) تبدیل در مرز API و نمایش

- **برای نمایش در جدول و کارت:** فقط از توابع `@/lib/format` استفاده کنید:
  - `formatDateOnly(day)` + قرار دادن `formatDateOnlyCanonical(day)` در `title` سلول.
  - `formatDateOnlyWithCanonical(day)` برای صفحات جزئیات سند.
  - `formatDateTime(iso)` برای جدول‌ها و `formatDateTimeWithZone(iso)` (به همراه `title={iso}`) برای صفحات جزئیات و ممیزی.
- **برای ارسال در بدنه APIهای نوشتن:** از `toBusinessDateInput(day)` در `@/lib/datetime` استفاده کنید تا تاریخ شمسی با تقویم صریح `{ calendar: 'JALALI', value: '1405-07-16' }` (ارقام ASCII) به سرور ارسال شود.
- **حفاظت از فایل‌های Staged اپلیکیشن Owner:** هفت فایل پایه در `frontend/src/lib/datetime/` (`calendar.ts`, `dayjs.ts`, `numerals.ts`, `business-date.ts`, `time-zone.ts`, `instant.ts`, `instant-range.ts`) طبق قرارداد جداسازی ADR-0048 توسط `owner-licensing/frontend` نیز بازتولید می‌شوند؛ هیچ وابستگی به کدهای اپلیکیشن مشتری نباید وارد آن هفت فایل شود.
