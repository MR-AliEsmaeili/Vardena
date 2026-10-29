# INV-04 — روش‌های ارزشیابی کالا (Item Valuation Methods)

- **وضعیت:** پیاده‌سازی‌شده در فرانت‌اند (`INV-04`)
- **تاریخ:** 2026-10-29
- **ماژول بک‌اند مرجع:** `backend/src/modules/inventory/api/inventory-valuation.controller.ts` (`InventoryValuationController`, v1 `/api/v1/inventory/valuation`)
- **مراجع معماری و دامنه:** `ADR-0039`، [PDR-05](../decisions/product/PDR-05-inventory-valuation-and-cost-optional-operations.md) (`OD-VAL-01`، `OD-VAL-02`، `OD-VAL-14`، `OD-VAL-18`)، [standards.md](../frontend/standards.md) نسخهٔ ۲.۵، [datetime.md](../datetime.md)

---

## ۱. خلاصهٔ دامنهٔ تحویل‌شده

این تسک پوشش فرانت‌اند برای نسخه‌های تاریخ‌دار (effective-dated، تغییرناپذیر / append-only) روش ارزشیابی کالا و بررسی روش مؤثر در یک روز کاری مشخص را روی قراردادهای موجود بک‌اند پیاده‌سازی می‌کند:

1. **فهرست نسخه‌های روش ارزشیابی کالا (`/app/inventory/valuation-methods`):**
   - متصل به `GET /api/v1/inventory/valuation/methods` با مجوز `Inventory.Valuation.View`.
   - فیلتر بر اساس کالا (`itemId`)، روز کاری مؤثر (`activeAt` با ورودی شمسی `JalaliDateInputField` و سیم `YYYY-MM-DD`)، مرتب‌سازی سرورمحور روی ستون‌های مجاز بک‌اند (`validFrom` و `createdAt`) و صفحه‌بندی سروری.
   - نمایش بازهٔ نیمه‌باز `[validFrom, validTo)` که در آن `validTo === null` به‌صورت نشان «باز» نمایش داده می‌شود و هیچ دکمه یا لینک ویرایش/حذف در جدول وجود ندارد.
   - پشتیبانی از نشست‌هایی که `Inventory.Valuation.View` دارند اما `Inventory.Item.View` ندارند: به جای فراخوانی غیرمجاز `GET /inventory/items`، ورودی مستقیم شناسهٔ ULID کالا نمایش داده می‌شود.

2. **بخش بررسی روش مؤثر در تاریخ (`ValuationMethodResolveCard` در همان صفحه):**
   - متصل به `GET /api/v1/inventory/valuation/methods/resolve` با مجوز `Inventory.Valuation.View`.
   - دریافت کالا و روز کاری (`asOf`، پیش‌فرض `todayBusinessDay(zone)` در منطقهٔ زمانی سازمان) و نمایش روش مؤثر، وضعیت پیاده‌سازی (`active`)، منشأ روش (`configured` = «تنظیم‌شده» یا `default` = «پیش‌فرض»)، پنجرهٔ اعتبار و `configurationId`.
   - پاسخ `source: "default"` با `configurationId: null` دقیقاً مطابق قرارداد بک‌اند به‌عنوان وضعیت عادی و موفق (نه خطا) نمایش داده می‌شود.

3. **فرم ثبت نسخهٔ تازه (`/app/inventory/valuation-methods/new`):**
   - متصل به `POST /api/v1/inventory/valuation/methods` با مجوز مستقل `Inventory.Valuation.Configure` (به‌صورت مسیر هم‌سطح / sibling تا کاربری که فقط مجوز پیکربندی دارد پشت گیت `Inventory.Valuation.View` مسدود نشود).
   - نمایش هر چهار مقدار enum معماری (`moving_weighted_average`، `fifo`، `lifo`، `specific_identification`) که در آن تنها `moving_weighted_average` فعال است و سه روش پیاده‌سازی‌نشده هم در گزینهٔ `Select` به‌صورت `disabled` همراه با برچسب «در این نسخه پیاده‌سازی نشده» مشخص شده‌اند و هم در اعتبارسنجی `Zod` رد می‌شوند.
   - اعتبارسنجی کلاینت با `react-hook-form` + `zodResolver` (`mode: 'onSubmit'`) برای الزامی بودن کالا، معتبر بودن روزهای کاری `validFrom`/`validTo`، شرط بازهٔ نیمه‌باز `validTo > validFrom`، و سقف ۵۰۰ نویسه برای `note`.
   - حفاظت از خروج تصادفی در فرم تغییریافته (`useWorkspaceWindowDirty`، رویداد `beforeunload`، و `ConfirmDialog` هنگام انصراف/بازگشت).
   - ابطال هم‌زمان کش‌های `valuationMethodsPrefix(organizationId)` و `valuationStatesPrefix(organizationId)` پس از ثبت موفق.

---

## ۲. تطبیق با حقیقت بک‌اند و یافته‌های قراردادی

بک‌اند به‌عنوان منبع حقیقت بررسی شد و هیچ تغییری در کد بک‌اند یا فایل تولیدی `vardena-api.d.ts` اعمال نگردید:

1. **فیلدهای مجاز مرتب‌سازی در `listMethods`:**
   - در `InventoryValuationService.listMethods` (`backend/src/modules/inventory/application/inventory-valuation.service.ts`) تنها دو کلید `{ validFrom: 'validFrom', createdAt: 'createdAt' }` با پیش‌فرض `validFrom:desc` در `resolveSort` مجاز هستند. مرتب‌سازی روی `validTo` عمداً در `DataTable` غیرفعال (`enableSorting: false`) شد و پارامترهای نامعتبر URL به `validFrom:desc` بازمی‌گردند تا خطای `400` از سرور رخ ندهد.
2. **کد خطای هم‌پوشانی بازه در `configureMethod`:**
   - دامنهٔ بک‌اند (`ValuationMethodPlanRejectedError` از `unit-conversion.ts`) کد جزئی `inventory.valuation_method_overlapping_version` و برای بازهٔ نامعتبر `inventory.valuation_method_invalid_window` را در `details.code` برمی‌گرداند، در حالی که متن تسک `INV-04` به `inventory.valuation_method_overlap` نیز اشاره کرده بود. نگاشت خطای فرانت‌اند (`valuationMethodErrorMessage`) هر دو subcode را به پیام فارسی هم‌پوشانی نگاشت می‌کند و کدهای `409 Conflict` (تاریخ شروع تکراری)، `422 inventory.valuation_method_not_implemented`، `400 ValidationFailed` (`invalidWindow` / `unknownValuationMethod`)، `404 EntityNotFound` و `403 PermissionDenied` را بدون نمایش متن انگلیسی سرور پوشش می‌دهد.
3. **بازتعریف تایپ‌های Nullable و BusinessDate در `contracts.ts`:**
   - فیلدهای `validTo | note` در `ItemValuationMethodResponseDto` و `configurationId | validFrom | validTo` در `ResolvedValuationMethodResponseDto` با الگوی استاندارد `NullableString<...>` و فیلدهای تاریخ کاری (`activeAt`، `asOf`، `validFrom`، `validTo`) بدون دستکاری فایل تولیدی OpenAPI دقیق‌سازی شدند.
4. **یادداشت واژگانی و استاندارد UX فارسی (`INV-04` بخش ۷.۳):**
   - عنوان روش فعال دقیقاً از واژه‌نامهٔ مصوب `PDR-05 §6` («میانگین موزون متحرک») گرفته شد.
   - در `PDR-05` (`OD-VAL-18`) و `docs/frontend/ux/persian-ux-writing-standard.md` بخش ۳.۴ ذکر شده است که روش‌های پیاده‌سازی‌نشده به‌عنوان گزینهٔ قابل انتخاب عرضه نمی‌شوند؛ مطابق دستور صریح تسک `INV-04` (بخش‌های ۳، ۵.۶، ۶ و ۷.۳)، سه روش پیاده‌سازی‌نشده صرفاً به‌صورت `disabled` به همراه توضیح «در این نسخه پیاده‌سازی نشده» نمایش داده شده و در لایهٔ اسکیمای فرم نیز غیرقابل ارسال هستند، و اسناد موجود بدون تغییر باقی ماندند.

---

## ۳. خلاصهٔ خروجی مهارت طراحی (`ui-ux-pro-max`) و ترجمه به توکن‌های وردنا

جست‌وجوهای `.claude/skills/ui-ux-pro-max/scripts/search.py` پیش از پیاده‌سازی اجرا شد (`--design-system --density 8 --motion 2 --variance 3 -p "Vardena"`, `--domain ux`, `--domain icons`, `--stack shadcn`):

- **قواعد به‌کارگرفته‌شده:**
  - ساختار متراکم و جدول‌محور اداری (Swiss Minimalism / Dense Data Grid) با تفکیک روشن بین پنل بررسی روش مؤثر (`Card` + `DefinitionList`)، نوار فیلتر (`FilterBar`) و جدول نسخه‌ها (`DataTable` با تگ‌های معنایی جدول و اعداد هم‌عرض `tabular-nums`).
  - اتصال صریح `<label htmlFor>` از طریق `FormField` برای تمام کنترل‌های فرم، نمایش خطا در مجاورت فیلد با `aria-invalid` و `aria-describedby`، و نمایش خطای سرور در بنر پایدار `ApiErrorAlert` بالای فرم همراه با `correlationId`.
  - غیرفعال‌سازی دکمهٔ ارسال در حین درخواست (`loading`/`disabled`) و استفاده از آیکون‌های برداری `lucide-react` (`Settings2`، `CalendarCheck2`، `Plus`؛ دیتاست `icons.csv` برای کوئری حسابداری/تنظیمات نتیجهٔ اختصاصی نداشت).
- **موارد ترجمه‌شده یا بازنویسی‌شده مطابق `docs/frontend/ui-ux-pro-max.md` بخش‌های ۲ و ۵:**
  - پالت پیشنهادی خام (`#334155`, `#0369A1`, `#F8FAFC`) و فونت‌های لاتین (`Poppins` / `Open Sans`) کنار گذاشته و به توکن‌های معنایی وردنا (`bg-surface`, `bg-sunken`, `text-ink`, `text-ink-muted`, `border-line`, `border-line-strong`, `brand`, فونت فارسی `Vazirmatn` و جهت‌گیری منطقی RTL) ترجمه شدند.
  - پیشنهاد انیمیشن اسکرول (`GSAP ScrollTrigger`) برای فرم و جدول عملیاتی رد شد.
  - پیشنهاد اعتبارسنجی `onBlur` مطابق قرارداد الزامی `docs/frontend/standards.md §9` با `mode: 'onSubmit'` جایگزین شد.

---

## ۴. فهرست فایل‌های ایجاد یا ویرایش‌شده

- `frontend/src/features/permissions/permission-codes.ts` — افزودن `PERMISSIONS.inventory.valuationConfigure = 'Inventory.Valuation.Configure'`.
- `frontend/src/api/contracts.ts` — افزودن تایپ‌های `ValuationMethod`، `ItemValuationMethod`، `ValuationMethodListQuery`، `ResolveValuationMethodQuery`، `ResolvedValuationMethod` و `ConfigureValuationMethodInput`.
- `frontend/src/api/inventory.api.ts` — افزودن `listInventoryValuationMethods`، `resolveInventoryValuationMethod` و `configureInventoryValuationMethod`.
- `frontend/src/api/query-keys.ts` — افزودن `valuationMethodsPrefix`، `valuationMethods` و `valuationMethodResolve` با کلید مقید به `organizationId`.
- `frontend/src/lib/i18n.ts` — افزودن `nav.inventoryValuationMethods` و فضای نام کامل `inventoryValuationMethods`.
- `frontend/src/features/inventory/valuation-methods/valuation-method-error-messages.ts` — نگاشت کدها و زیرکدهای خطای بک‌اند به پیام‌های فارسی و برچسب‌های دامنه.
- `frontend/src/features/inventory/valuation-methods/use-valuation-methods.ts` — هوک‌های وضعیت URL، لیست، resolve و ثبت نسخه با ابطال کش سازمان‌محور.
- `frontend/src/features/inventory/valuation-methods/valuation-methods-page.tsx` — صفحهٔ فهرست نسخه‌ها + پنل بررسی روش مؤثر در تاریخ.
- `frontend/src/features/inventory/valuation-methods/valuation-method-form-page.tsx` — صفحهٔ ثبت نسخهٔ تازه با فرم اعتبارسنجی‌شده و محافظ خروج.
- `frontend/src/app/routes/workspace-route-tree.tsx` — ثبت مسیرهای `/app/inventory/valuation-methods` و `/app/inventory/valuation-methods/new`.
- `frontend/src/app/navigation.ts` و `frontend/src/features/inventory/inventory-home-page.tsx` — افزودن لینک ناوبری و کارت هاب انبار با مجوز `Inventory.Valuation.View`.
- تست‌ها:
  - `frontend/src/features/inventory/valuation-methods/valuation-method-error-messages.test.ts`
  - `frontend/src/features/inventory/valuation-methods/use-valuation-methods.test.tsx`
  - `frontend/src/features/inventory/valuation-methods/valuation-methods-page.test.tsx`
  - `frontend/src/features/inventory/valuation-methods/valuation-method-form-page.test.tsx`
  - `frontend/src/api/inventory-routes.test.ts`
  - `frontend/src/app/routes/workspace-route-tree.test.tsx`
  - `frontend/src/features/inventory/inventory-home-page.test.tsx`
- مستندات:
  - `docs/frontend/coverage-matrix.md`
  - `docs/tasks/INV-04-implementation-report.md`

---

## ۵. راستی‌آزمایی محلی (Lightweight Checks)

مطابق سیاست اجرای تست (`docs/testing/test-execution-policy.md`)، تمام گیت‌های سبک محلی اجرا و پاس شدند و تست‌های سنگین E2E مرورگر به CI سپرده شدند:

- `python3 scripts/check-date-contract.py` — موفق
- `node scripts/check-frontend-design-tokens.mjs` — موفق
- `python3 scripts/check-docs-links.py` — موفق
- `cd frontend && npm run lint` — موفق (۰ خطا، ۰ هشدار)
- `cd frontend && npm run typecheck` — موفق
- `cd frontend && npm run format:check` — موفق
- `cd frontend && npm test` — موفق
- `cd frontend && npm run build` — موفق
- `python3 scripts/check-owner-isolation.py --artifact frontend/dist` — موفق
