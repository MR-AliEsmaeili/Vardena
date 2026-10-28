# ماتریس پوشش بک‌اند ↔ فرانت‌اند

**وضعیت:** ACTIVE — ممیزی نقطه‌به‌نقطه
**تاریخ ممیزی:** ۲۰۲۶-۱۰-۲۶؛ به‌روزرسانی ACC-04/07/08/09 و نوارهای کار: ۲۰۲۶-۱۰-۲۶؛ DOC-01: ۲۰۲۶-۱۰-۲۶؛ DOC-02: ۲۰۲۶-۱۰-۲۸
**مبنا:** `backend/src/modules/**/api/*.controller.ts` (۶۰ کنترلر) در برابر `frontend/src/app/router.tsx`، `frontend/src/api/*.api.ts` و هوک/صفحه‌های `frontend/src/features/**`.

این سند فقط وضعیت را ثبت می‌کند؛ در این دور **هیچ endpoint، قرارداد یا قاعدۀ کسب‌وکار تغییر نکرده است**. هر جا «MISSING» است، یعنی UI وجود ندارد، نه اینکه بک‌اند ناقص باشد.

## تعریف وضعیت‌ها

| وضعیت | معنا |
| ----- | ---- |
| **COMPLETE** | همۀ عملیات کاربرپسندِ آن گروه در UI موجود، با گیت مجوز هم‌راستا با endpoint، و حالت‌های چهارگانه. |
| **PARTIAL** | بخشی از گروه (معمولاً چرخۀ عمر یا ویرایش) در UI نیست؛ بخش موجود کار می‌کند. |
| **MISSING** | هیچ سطح فرانت‌اندی برای این قرارداد وجود ندارد. |
| **BLOCKED** | UI نمی‌تواند ساخته شود تا یک تصمیم/قرارداد روشن شود (تصمیم مالک یا تغییر بک‌اند لازم است). |
| **NOT_REQUIRED** | عملیات برای اپراتور طراحی نشده است (سلامت سرویس، بازسازی داخلی، یا endpoint نمایشی که وجود ندارد). |

> روش تأیید: تطبیق ایستا (controller ↔ `api/*.ts` ↔ route/hook). تست رفتاری هر سطح در `features/**/*.test.tsx` است؛ این ماتریس جای تست را نمی‌گیرد.

---

## ۱) حساب‌داری — `backend/src/modules/accounting`

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| اسناد حسابداری | `GET/POST/PATCH/DELETE /accounting-documents`, `POST /:id/issue|finalize|reverse` | `documents-page`, `document-form-page`, `document-detail-page`, `document-action-dialogs` | **COMPLETE** |
| درخت حساب‌ها | `GET /accounting/chart-tree`, `/:id` | `chart-tree-page`, `chart-tree-node-row` | **COMPLETE** |
| صورت حساب | `GET /accounting/account-statements` | `account-statement-page` | **COMPLETE** |
| دفتر کل | `GET /accounting/general-ledger` | `general-ledger-page` | **COMPLETE** |
| تراز آزمایشی | `GET /accounting/trial-balance` | `trial-balance-page` | **COMPLETE** |
| حساب‌ها (master) | `GET /accounts`, `/:id`, `POST`, `PATCH`, `enable/disable`, `unlink-detail-group` | فهرست + جزئیات + ایجاد/ویرایش با جست‌وجوی server-side والد، انتخاب گروه از ساختار تفصیلی فعال، تأیید گذارهای چرخهٔ عمر | **COMPLETE** — ACC-04 تکمیل شد؛ unlink موجود مربوط به ACC-05 است و در این تسک تغییر نکرد |
| نواحی مالی | `GET /financial-areas`, `GET /:id`, `POST`, `PATCH`, `enable/disable` | فهرست + فرم ایجاد/ویرایش (`financial-area-form-page`) + اکشن‌های ردیف (ویرایش، تعیین پیش‌فرض، فعال/غیرفعال با تأیید) | **COMPLETE** — همه عملیات قرارداد با گیت مجوز دقیق هر endpoint (ACC-01) |
| سال‌های مالی | `GET /fiscal-years`, `GET /:id`, `POST`, `PATCH`, `close/reopen/seal/unseal` | فهرست + فرم ایجاد/ویرایش + گذارهای چرخه عمر با دلیل اجباری و گیت مجوز دقیق | **COMPLETE** (ACC-02) |
| دوره‌های حسابداری | `GET /accounting-periods`, `POST`, `close/reopen/seal` | فهرست، فرم ایجاد (شناسهٔ دستی برای مجوز Open-only)، اکشن‌های گذار با دلیل و ماتریس وضعیت منطبق با بک‌اند | **COMPLETE** (ACC-03؛ `sealed → open` پس از رفع مهر سال نیز از UI ممکن است) |
| تراز حساب‌ها (balances) | `GET /accounting/balances`, `/reconciliation`, `/:accountId`, `POST /rebuild` | ویجت داشبورد (`listAccountBalances`) | **PARTIAL** — صفحهٔ اختصاصی گزارش و بازسازی داخلی ندارد |
| حرکات دفتر | `GET /accounting/ledger-movements` | — | **NOT_REQUIRED** — دفتر کل از endpoint گزارش خودش استفاده می‌کند؛ این مسیر مصرف مستقیم ندارد |
| پیکربندی حساب‌داری | `GET/POST/PATCH/DELETE /accounting-configurations`, `:id/publish`, `active` | `configuration-list-page`, `configuration-form-page` (+ `configuration-levels-editor`), `configuration-detail-page`, `configuration-actions` (انتشار/حذف با تأیید) | **COMPLETE** (ACC-06؛ گیت مجوز دقیق View/Configure، ماتریس وضعیت DRAFT/ACTIVE/SUPERSEDED، `pattern` فقط نمایش مقدار سرور، `effectiveFrom` به‌صورت Instant) |
| الگوهای دفتر پایه | `base-chart-templates`, `base-chart-template-versions`, `base-chart-adoptions` (پیش‌نمایش/پذیرش) | — | **MISSING** |
| ساختارهای کدینگ | `coding-structures` (+`active`, `publish`) | فهرست نسخه‌ها با pagination/فیلتر URL، ایجاد/ویرایش پیش‌نویس، جزئیات سطوح، انتشار تأییدشده | **COMPLETE** (ACC-07؛ کد تغییرناپذیر، pattern از سرور، انتشار بدون body) |
| ساختارهای تفصیلی | `detail-structures` (+`active`, `publish`) | فهرست نسخه‌ها، فرم سطوح مجزا از ساختار کدینگ، جزئیات و شمارش تفصیلی‌های متصل، انتشار تأییدشده | **COMPLETE** (ACC-08؛ DTO بدون `code`/`defaultIsPostable`/`levelKind`؛ backend `GET /active` مقدار `null` را برمی‌گرداند) |
| تفصیلی‌ها | `GET /details`, `/:id`, `POST`, `PATCH`, `enable/disable` | مدیریت جدولی با فیلتر URL، والد‌یابی و لینک زیرشاخه، ایجاد/ویرایش، فعال/غیرفعال با تأیید | **COMPLETE** (ACC-09؛ کد در ویرایش تغییرناپذیر؛ DELETE در بک‌اند وجود ندارد و در UI جعل نشده؛ `listPostableDetails` دست‌نخورده است) |

## ۲) اسناد پایه — `backend/src/modules/documents`

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| انواع سند | `GET /documents/types`, `/:code`, `PUT :code/configuration` | `document-types-page`, `document-type-detail-page`, `document-type-configuration-form` — فهرست رجیستری با جستوجو/صفحهبندی سرور، جزئیات کامل قرارداد، و پیکربندی فقط `draftRequired` با نمایش پاسخ سرور | **COMPLETE** (DOC-01؛ ساخت/حذف نوع سند در بکاند وجود ندارد و در UI هم جعل نشده است؛ `sort` ارسال نمیشود چون سرویس آن را نادیده میگیرد) |
| سری‌های شماره‌گذاری | `GET/POST /documents/numbering-series`, `/:id`, `PATCH`, `:id/allocations` | `numbering-series-page` (فهرست صفحه‌بندی‌شده با فیلتر `documentType`/`isActive` از رجیستری + ۴ حالت)، `numbering-series-form-page` (ایجاد: `documentType` از `GET /types` بدون hardcode + `scopeKey` اختیاری + `name`/`width`/`reusePolicy`؛ ویرایش: `scopeKey`/`documentType` فقط‌خواندنی + `isActive` + whitelist `name`/`strategy`/`width`/`reusePolicy`/`isActive` + ۴۰۹ دقیق)، `numbering-series-detail-page` + جدول تخصیص‌های فقط‌خواندنی (صفحه‌بندی/فیلتر `reference*`/مرتب‌سازی `number`/`createdAt`، گیت `Document.Numbering.View`، بدون allocate/delete، `lastValue`/`number` رشتهٔ دقیق) — گیت‌ها `View` sibling `Create` / `:id/edit` `View+Edit`، `queryKeys` with `numberingSeriesPrefix+Detail+Allocations` invalidation | **COMPLETE** (DOC-02؛ یکتایی `(org, documentType, scopeKey)` بدون وابستگی به `isActive`، `scopeKey=""` پیش‌فرض مبهم، `width` padding فقط‌نمایشی، `reusePolicy=recycle` بی‌اثر در این نسخه، بدون حذف سری/تخصیص) |
| روابط اسناد | `GET/POST /documents/relations`, `/:id`, `DELETE` | — | **MISSING** |

## ۳) موجودی — `backend/src/modules/inventory`

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| کالا | `items` (list/detail/create/patch/enable/disable) | `master-data/items/*` | **COMPLETE** |
| گروه کالا | `item-groups` (همان الگو) | `master-data/item-groups/*` | **COMPLETE** |
| واحد | `units` (همان الگو) | `master-data/units/*` | **COMPLETE** |
| انبار | `warehouses` (همان الگو) | `master-data/warehouses/*` | **COMPLETE** |
| تبدیل واحد | `GET/POST /inventory/unit-conversions`, `GET /resolve`, `/:id` | فهرست + ایجاد نسخه + بخش درون‌صفحه‌ای resolve تاریخ‌دار (INV-03) | **PARTIAL** — حل نسخهٔ مؤثر و حالت بدون پوشش پیاده شده، اما جزئیات مستقل `GET /:id` هنوز UI ندارد؛ نسخه‌ها تغییرناپذیرند (ADR-0020 §۴) |
| حرکات انبار | `GET/POST /inventory/movements`, `/:id`, `POST /:id/reverse` | `movements-page`, `movement-form-page`, `movement-reversal-dialog` | **PARTIAL** — برگشت تک‌گردش غیرانتقالی با مجوز، تاریخ و تأیید دو مرحله‌ای موجود است (INV-01)؛ نمایش جزئیات مستقل `GET /:id` هنوز UI ندارد؛ برگشت تک‌پای انتقال در بک‌اند ممنوع است |
| کاردکس | `GET /inventory/kardex`, `/quantity` | `kardex-page` | **COMPLETE** |
| اسناد عملیاتی | `business-documents` (list/detail/create/patch/delete/finalize/seal/cancel/posting) | `documents/*` | **COMPLETE** |
| تراز/دسترس‌پذیری | `GET /inventory/balances`, `availability`, `availability-across-warehouses` | `balances-page`, `use-inventory-references` | **COMPLETE** |
| بازسازی/تطبیق موجودی | `POST /inventory/balances/reconcile|rebuild` | — | **NOT_REQUIRED** — عملیات نگهداری/اپراتوری، نه کاربر نهایی |
| ارزشیابی | `valuation/methods`, `methods/resolve`, `states`, `states/current`, `backdate-check`, `movements/:id/cost`, `recalculations` | `valuation-states-page`, `movement-form-page` (backdate) | **PARTIAL** — روش‌های ارزشیابی و ثبت بهای یک حرکت UI ندارد |
| انتقال بین انبار | `POST /inventory/transfers` | `transfer-form-page` | **PARTIAL** — ثبت انتقال هست؛ endpoint فهرست انتقال وجود ندارد (نه UI) |
| درخواست کالا | `material-requests` (list/detail/events/lines/submit/approve/reject/return/reverse/cancel) | — | **MISSING** |
| رزرو موجودی | `reservations` (list/detail/create/release) | — | **MISSING** |
| اجرای قیمت‌گذاری | `pricing/runs`, `runs/reverse`, `runs/:id` | — | **MISSING** |

## ۴) مجوز نصب — `backend/src/modules/licensing`

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| وضعیت مجوز | `GET /license/current` | `license-gate`, `license-status-card`, `use-license-state` | **COMPLETE** |
| ورود مجوز | `POST /license/import` | `license-import-form` | **COMPLETE** |
| ورود ابطال | `POST /license/revocations/import` | `revocation-import-form` | **COMPLETE** |
| دستگاه‌های مشتری | `license/devices` (enrollment، activation، deactivate، replacement prove/export/import/cancel، history) | `client-devices-page` | **COMPLETE** |
| فعال‌سازی / انتقال مشتری / بازسازی شکاف / کاهش | `POST /license/activate`, `customer-transfer`, `gap-recovery`, `reduction-resolution` | — | **MISSING** — این‌ها ابزار مالک/صادرکننده‌اند؛ در محصول مشتری عمداً سطح UI ندارند. اگر مالک بخواهد در محصول مشتری هم دیده شوند، تصمیم و دامنهٔ جدا لازم است. |

## ۵) سازمان — `backend/src/modules/organization`

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| سازمان | `GET /organizations`, `mine`, `/:id`, `POST`, `PATCH`, `enable/disable` | `organization-profile-page`, `organization-selection`, `organization-switcher` | **COMPLETE** |
| عضویت‌ها | `GET/POST/DELETE /organizations/:id/members` | `members-page` | **COMPLETE** |
| شعبه | `branches` (CRUD + lifecycle) | `admin/branches/*` | **COMPLETE** |
| دپارتمان | `departments` (CRUD + lifecycle) | `admin/departments/*` | **COMPLETE** |
| کارمند | `employees` (CRUD + lifecycle) | `admin/employees/*` | **COMPLETE** |
| طرف حساب | `parties` (CRUD + lifecycle) | `admin/parties/*` | **COMPLETE** |

## ۶) هویت و دسترسی

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| نشست | `POST /auth/login`, `/logout`, `GET /auth/me`, `POST /auth/change-password` | `login-page`, `change-password-page`, `session-*` | **COMPLETE** |
| مجوزها | `GET /permissions`, `/permissions/effective` | `permission-gate`, `use-permissions` | **COMPLETE** |
| کاربران | `users` (list/detail/create/patch/enable/disable/password-reset) | `administration/users/*` | **COMPLETE** |
| نقش‌ها | `roles` (CRUD + permissions/users attach/detach) | `administration/roles/*` | **COMPLETE** |

## ۷) گردش کار — `backend/src/modules/workflow`

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| نمونه‌های گردش کار | `GET /workflow/instances` | ویجت داشبورد | **PARTIAL** |
| تعریف/نسخه/وضعیت/گذار | `workflow/definitions`, `versions`, `states`, `transitions`, `automations` | — | **MISSING** |
| تأییدها | `instances/:id/approvals`, `approvals/:id/decide` | — | **MISSING** — نیازمند تصمیم مالک دربارهٔ جریان تأیید (خارج از این دور) |

## ۸) سلامت

| گروه | endpoint | وضعیت |
| ---- | -------- | ----- |
| سلامت سرویس | `GET /health/live`, `/health/ready` | **NOT_REQUIRED** — مصرف‌کنندهٔ آن orchestrator/CI است، نه UI |

---

## جمع‌بندی

| وضعیت | تعداد گروه |
| ----- | ---------- |
| COMPLETE | ۳۲ |
| PARTIAL | ۷ |
| MISSING | ۱۱ |
| NOT_REQUIRED | ۳ |

**اولویت‌های بعدی (به ترتیب ارزش کاربر):**

1. **درخواست کالا / رزرو / قیمت‌گذاری** — قرارداد کامل بک‌اند موجود است و بدون UI قابلیت استفاده ندارد.
2. **روابط اسناد (DOC-03)** — سری‌های شماره‌گذاری (DOC-02) اکنون کامل است؛ روابط بین‌اسنادی بدون صفحه است.
3. **PARTIALهای موجودی** — جزئیات مستقل حرکت و تبدیل واحد، روش‌های ارزشیابی/ثبت بها و فهرست انتقال؛ هرکدام باید در دامنهٔ تسک مستقل بماند.
4. **گردش کار** — نیازمند تصمیم مالک (BLOCKED از نظر محصول، نه فنی).

چرخهٔ عمر حسابداری مورد اولویت قبلی با ACC-02/03/04 کامل شد؛ مدیریت نواحی مالی نیز در ACC-01 کامل است.

**انحراف مستندات:** `docs/frontend/ux/ux-flow-matrix.md` وضعیت چند سطح (از جمله اسناد عملیاتی موجودی و ارزشیابی) را قدیمی نشان می‌دهد؛ این ماتریس جایگزین آن به‌عنوان مرجع پوشش است. اصلاح آن سند تسک جداگانه لازم دارد (خارج از دامنهٔ این دور).
