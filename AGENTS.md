# Vardena — دستورالعمل ایجنت

## Frontend

پیش از هر کار UI: `docs/frontend/standards.md` را کامل بخوان و به آن پایبند بمان.

کامپوننت‌های لایه پایه و الگوهای صفحه در `src/shared`؛ صفحۀ جدید فقط با ترکیب الگوها.

قواعد بخش ۱۷ (Rule as Code) در CI گرفته می‌شوند؛ قاعدۀ قراردادی نقض‌شده در بازبینی = `CHANGES REQUIRED`.

برای هر تغییر تاریخ/زمان، قرارداد دائمی BusinessDate و Instant در AR-32 و `docs/datetime.md` را رعایت کن؛ برای فرمت یا تبدیل محلی جدید، abstraction مشترک را دور نزن.

## دروازۀ بازبینی تاریخ و زمان (Backend و Frontend)

- ابتدا `docs/datetime.md`، ADR-0042 و قاعدۀ AR-32 را بخوان؛ برای هر فیلد مشخص کن **BusinessDate** است یا **Instant** و قرارداد همان feature/module را دنبال کن.
- `BusinessDate` رشتهٔ canonical `YYYY-MM-DD` با نوع branded و PostgreSQL `date` است؛ در domain، API، مقایسه، فیلتر و شناسه از `Date` نیمه‌شب UTC، `toISOString()` یا parse ضمنی JS استفاده نکن. تبدیل Prisma `Date` فقط در adapter پایگاه‌داده و با helper مشترک مجاز است.
- `Instant` در PostgreSQL `timestamptz` و روی wire یک ISO UTC معتبر است؛ برای نمایش ابتدا zone معتبر IANA سازمان و سپس calendar سازمان را به کار ببر. برای فیلد Jalali، calendar باید صریح اعلام شود.
- پذیرش legacy ISO Instant به‌عنوان BusinessDate فقط در مرزهایی که صریحاً سازگار نگه داشته می‌شوند مجاز است و باید به روز UTC تبدیل شود؛ این سازگاری را به فیلترهای day-only یا قراردادهای تازه تعمیم نده.
- برای تغییر تاریخ، DTO/validation، domain، repository، query/list filter، resolver، controller/API، frontend، replay/revaluation، migration و تست‌های مرزی را در زنجیرهٔ واقعی مصرف‌کننده بررسی کن؛ فقط formatter مشترک کافی نیست.
- پنجره‌های مؤثر Inventory برای unit-conversion و item-valuation از نوع BusinessDate و نیمه‌باز `[validFrom, validTo)` هستند؛ `validTo = null` باز است. مرز شمول، مجاورت، هم‌پوشانی/بازهٔ نامعتبر، replay و revaluation را حفظ کن؛ سیاست را به دیگر `valid_*`ها تعمیم نده.
- migration تازه بساز؛ migration اعمال‌شده را ویرایش نکن. پیش از تبدیل، audit تجمیعیِ بدون شناسه/دادهٔ حساس ارائه کن، برخورد/هم‌پوشانی/مقدار غیرقابل‌نمایش را fail-closed کن، و rehearsal واقعی را فقط روی PostgreSQL disposable اجرا کن. Fixture یا code review اثبات ایمنی دادهٔ مشتری نیست.
- اگر Owner خواست تست‌ها فقط از GitHub CI اجرا شوند، suite محلی/E2E سنگین اجرا نکن؛ وضعیت checkها را برای SHA نهایی بررسی کن و نتیجهٔ تأییدنشده را سبز گزارش نکن.
