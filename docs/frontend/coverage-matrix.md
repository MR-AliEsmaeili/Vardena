# ماتریس پوشش بک‌اند ↔ فرانت‌اند

**وضعیت:** ACTIVE — ممیزی نقطه‌به‌نقطه
**تاریخ ممیزی:** ۲۰۲۶-۱۰-۲۲
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
| حساب‌ها (master) | `GET /accounts`, `/:id`, `POST`, `PATCH`, `enable/disable`, `unlink-detail-group` | فهرست + جزئیات | **PARTIAL** — ایجاد/ویرایش/فعال‌سازی حساب و جداکردن گروه تفصیلی UI ندارد |
| نواحی مالی | `GET /financial-areas`, `GET /:id`, `POST`, `PATCH`, `enable/disable` | فهرست + فرم ایجاد/ویرایش (`financial-area-form-page`) + اکشن‌های ردیف (ویرایش، تعیین پیش‌فرض، فعال/غیرفعال با تأیید) | **COMPLETE** — همه عملیات قرارداد با گیت مجوز دقیق هر endpoint (ACC-01) |
| سال‌های مالی | `GET /fiscal-years`, `POST`, `PATCH`, `close/reopen/seal/unseal` | فهرست + ایجاد | **PARTIAL** — چرخۀ عمر (بستن/مهر) UI ندارد |
| دوره‌های حسابداری | `GET /accounting-periods`, `POST`, `close/reopen/seal` | فهرست | **PARTIAL** — چرخۀ عمر UI ندارد |
| تراز حساب‌ها (balances) | `GET /accounting/balances`, `/reconciliation`, `/:accountId`, `POST /rebuild` | ویجت داشبورد (`listAccountBalances`) | **PARTIAL** — صفحهٔ اختصاصی گزارش و بازسازی داخلی ندارد |
| حرکات دفتر | `GET /accounting/ledger-movements` | — | **NOT_REQUIRED** — دفتر کل از endpoint گزارش خودش استفاده می‌کند؛ این مسیر مصرف مستقیم ندارد |
| پیکربندی حساب‌داری | `GET/POST/PATCH/DELETE /accounting-configurations`, `:id/publish`, `active` | — | **MISSING** |
| الگوهای دفتر پایه | `base-chart-templates`, `base-chart-template-versions`, `base-chart-adoptions` (پیش‌نمایش/پذیرش) | — | **MISSING** |
| ساختارهای کدینگ | `coding-structures` (+`active`, `publish`) | — | **MISSING** |
| ساختارهای تفصیلی | `detail-structures` (+`active`, `publish`) | — | **MISSING** |
| تفصیلی‌ها | `GET /details`, `/:id`, `POST`, `PATCH`, `enable/disable` | فقط خواندن در فرم کالا/حساب | **PARTIAL** |

## ۲) اسناد پایه — `backend/src/modules/documents`

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| انواع سند | `GET /documents/types`, `/:code`, `PUT :code/configuration` | — | **MISSING** |
| سری‌های شماره‌گذاری | `GET/POST /documents/numbering-series`, `/:id`, `PATCH`, `:id/allocations` | — | **MISSING** |
| روابط اسناد | `GET/POST /documents/relations`, `/:id`, `DELETE` | — | **MISSING** |

## ۳) موجودی — `backend/src/modules/inventory`

| گروه قرارداد | endpointها | سطح فرانت‌اند | وضعیت |
| ------------ | ---------- | -------------- | ----- |
| کالا | `items` (list/detail/create/patch/enable/disable) | `master-data/items/*` | **COMPLETE** |
| گروه کالا | `item-groups` (همان الگو) | `master-data/item-groups/*` | **COMPLETE** |
| واحد | `units` (همان الگو) | `master-data/units/*` | **COMPLETE** |
| انبار | `warehouses` (همان الگو) | `master-data/warehouses/*` | **COMPLETE** |
| تبدیل واحد | `GET/POST /unit-conversions`, `GET /resolve`, `/:id` | فهرست + ایجاد نسخه | **PARTIAL** — `resolve` سطح UI ندارد (نسخه‌ها تغییرناپذیرند، ADR-0020 §۴) |
| حرکات انبار | `GET/POST /inventory/movements`, `/:id`, `POST /:id/reverse` | `movements-page`, `movement-form-page` | **PARTIAL** — برگشت حرکت UI ندارد |
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
| COMPLETE | ۲۷ |
| PARTIAL | ۱۰ |
| MISSING | ۱۳ |
| NOT_REQUIRED | ۳ |

**اولویت‌های بعدی (به ترتیب ارزش کاربر):**

1. **PARTIALهای چرخۀ عمر حساب‌داری** (بستن سال/دوره، ایجاد حساب) — کاربر برای بستن دوره به بک‌اند دسترسی ندارد؛ ریسک عملیاتی بالا. (مدیریت نواحی مالی در ACC-01 کامل شد.)
2. **درخواست کالا / رزرو / قیمت‌گذاری** — قرارداد کامل بک‌اند موجود است و بدون UI قابلیت استفاده ندارد.
3. **انواع سند و سری شماره‌گذاری** — پیش‌نیاز پیکربندی واقعی شماره‌گذاری در استقرار مشتری.
4. **گردش کار** — نیازمند تصمیم مالک (BLOCKED از نظر محصول، نه فنی).

**انحراف مستندات:** `docs/frontend/ux/ux-flow-matrix.md` وضعیت چند سطح (از جمله اسناد عملیاتی موجودی و ارزشیابی) را قدیمی نشان می‌دهد؛ این ماتریس جایگزین آن به‌عنوان مرجع پوشش است. اصلاح آن سند تسک جداگانه لازم دارد (خارج از دامنهٔ این دور).
