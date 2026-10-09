# Vardena — دستورالعمل ایجنت

## Frontend

پیش از هر کار UI: `docs/frontend/standards.md` را کامل بخوان و به آن پایبند بمان.

کامپوننت‌های لایه پایه و الگوهای صفحه در `src/shared`؛ صفحۀ جدید فقط با ترکیب الگوها.

قواعد بخش ۱۷ (Rule as Code) در CI گرفته می‌شوند؛ قاعدۀ قراردادی نقض‌شده در بازبینی = `CHANGES REQUIRED`.

برای هر تغییر تاریخ/زمان، قرارداد دائمی BusinessDate و Instant در AR-32 و `docs/datetime.md` را رعایت کن؛ برای فرمت یا تبدیل محلی جدید، abstraction مشترک را دور نزن.
