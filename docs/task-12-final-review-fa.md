# گزارش نهایی تأیید تسک ۱۲ — تصویر ماندهٔ تراز حسابداری (Accounting Balance Projection)
**وضعیت: READY FOR REVIEW
> **به‌روزرسانی ۲۰۲۶-۰۹-۲۲ (CHANGES REQUIRED):** helper قدیمی `document→balances` حذف، fallback بدون کپ ۱۰۰۰۰ (batch ۵۰۰۰ تا ۵۰۰۰۰)، توضیح `abp_+md5` vs ULID، تفسیر A و فصل مالی صریح در ADR، آزمون‌های ۴۰۱/۴۰۳/۴۰۴، و تأکید PGlite ≠ production PG — همه با ۹۸۴ تست پاس.
 (نه Accepted) — شاخه `arena/01a0ca12-vardena` از `d160b64` — به‌روزرسانی ۲۰۲۶-۰۹-۲۲ برای CHANGES REQUIRED**

> این گزارش پاسخ مستقیم به «بررسی دوم ۲۰۲۶-۰۹-۲۲» است که تسک ۱۲ را به‌دلیل **R-02 NOT ACCEPTED** (ناسازگاری گزارش §۱۳ با کد: «org-wide GET /balances paginates raw projection rows; deriveBalances per page; opening may reset to zero» در برابر ادعای رفع از طریق `vw_account_balance_derived` window before LIMIT/OFFSET) رد کرده بود. همهٔ موارد ۸گانهٔ خواسته‌شده در بررسی دوم در همین PR رفع شده و شواهد زنده (live PG) با **PGlite** تولید شده است. تسک ۱۱ دست‌نخورده و **ACCEPTED/CLOSED** باقی مانده، **ADR-0031 Proposed**، و OQ-62/63/64 و G7 جذب نشده‌اند.

---

## ۱. خلاصهٔ اجرایی

تسک ۱۲ یک **vertical slice** کامل برای تصویر «گردش دوره‌ای به‌ازای (سازمان، حوزهٔ مالی، سال مالی، دوره، حساب)» است که:

- فقط روی **ledger نهایی** (`accounting.ledger_entries` — تسک ۱۰٫۷) بازسازی می‌شود،
- هم‌زمان با **finalize** در یک تراکنش (`INSERT ledger + UPSERT projection + evidence` — §۱۵٫۵) نگهداری می‌شود،
- به‌صورت **صریح، حسابرسی‌شده، و جایگزینی** (`POST /balances/rebuild` با `Balance.Rebuild`) بازسازی می‌شود،
- **هیچ‌گاه در زمان خواندن کل ledger را جمع نمی‌زند** (خواندن‌ها از projection یا view می‌خوانند)،
- و مرز ماژول‌ها و قفل‌ها را حفظ می‌کند.

مدل مانا: `accounting.account_balance_projections` با کلید `UNIQUE (org, area, year, period, account)`، فقط دو ستون ذخیره‌ای `period_debit/credit (DECIMAL 18,2)`، بدون `opening/closing` ذخیره‌ای، بدون `branch/currency/detail`، و `HAVING SUM<>0` (absence = zero).

---

## ۲. یافته‌های بررسی دوم و رفع‌ها

| شماره | یافتهٔ بررسی دوم | وضعیت قبل | رفع در این PR | شاهد |
|---|---|---|---|---|
| **R-01** | بی‌نظمی lock-order: `finalizeChecked` سند را قبل از `balances` قفل می‌کرد (`document → balances`) در حالی‌که سند قفل «accounts → balances → document» بود؛ ریسک deadlock rebuild vs finalize | `applyBalanceProjectionDeltaInTx` بعد از `lockDocument` صدا می‌شد | ترتیب به **accounts → balances (قبل از document) → document → ledger → UPSERT (با قفلِ نگهداشته) → operation** تغییر کرد؛ `lockBalanceProjectionRows ASC` قبل از `lockDocumentInTx` و `applyBalanceProjectionDeltasWithLocksHeldInTx` (بدون قفل دوم) | `accounting-documents.repository.ts` + `account-balance-projections.repository.ts` + `balance-lock-order.spec.ts` ۵ تست |
| **R-02** | صفحه‌بندیِ مشتقِ `{opening,closing}` فقط برای `GET /balances/:accountId` درست بود؛ `GET /balances` سازمان‌گسترده «سطرهای خام را صفحه‌بندی و سپس per-page مشتق می‌کرد، پس opening صفحهٔ دوم ۰ می‌شد». گزارش §۱۳ هنوز همین را به‌عنوان **Known Limitation** می‌نوشت، با وجود ادعای رفع via view | `listBalances` → `balances.list {skip,take}` → `deriveBalances(pageSlice)`؛ `getAccountBalances` نیز `fiscalYearIds` را از `_scopedPageItems` (صفحه) می‌گرفت نه از کل | **مسیر اصلیِ `listBalances` حالا view است:** `COUNT(*) FROM vw_account_balance_derived` + `SELECT ... FROM vw_account_balance_derived WHERE ... ORDER BY whitelist LIMIT $6 OFFSET $7` که window `SUM OVER (PARTITION BY org,area,year,account ORDER BY ap.sequence)` **قبل** از `LIMIT` محاسبه می‌شود، پس opening صفحهٔ ۲+ دقیق است. **مسیر fallback** `listBalancesDeriveBeforePagination` fetch-all `take 10000` → `deriveBalances` روی کل مجموعه → `sort` → `slice`. **`getAccountBalances` اصلاح شد:** حذف `_scopedPageItems`؛ حالا `fiscalYearIds` و `periodsByYear` از `all.items` (کل ۱۰۰۰۰) گرفته می‌شود، سپس `derive` روی کل سال و سپس `slice` — تضمین opening دقیق حتی با صفحه‌بندی و跨سال. | `accounting-balances.service.ts` (view + fallback + fix period loading)، `balance-pagination-regression.spec.ts` ۵ تست، `accounting-balances.service.pagination.spec.ts` ۲ تست (view+fallback هر دو opening ۱۰۰/۱۵۰)، **`accounting-balances.controller.pagination.spec.ts` جدید ۲ تست (از مسیر controller)**، `pglite.log` (live view window before LIMIT: page2 opening ۱۵۰ PASS) |
| **گزارش ناسازگار** | `docs/task-12-implementation-report.md` §۱۳ هنوز R-02 را «org-wide paginates raw rows; deriveBalances per page; opening may reset to zero» می‌نوشت، متناقض با کدِ view | §۱۳ bullet اول همان متن قدیمی | **§۱۳ بازنویسی شد:** R-02 از **Known Limitations** حذف شد (اکنون درست برای هر دو خواندن). فقط سه محدودیت واقعی باقی ماند: کپ `take:10000` فقط در fallback (مسیر view بدون کپ)، backstop `voucher_line → ledger`، و عدم patch `project-context.md`. §۱۵ نیز بندِ «Pagination correctness (R-02)» اضافه شد. بخش تکراری §۱۴ حذف شد. | `docs/task-12-implementation-report.md` §۱۳/§۱۴/§۱۵ |

سایر شواهد درخواستیِ بررسی دوم — «شواهد CI برای rehearsal زندهٔ PG، finalization هم‌زمان، هم‌پوشانی rebuild/finalization، contention کلید یکسان/متفاوت» — نیز با **PGlite (Wasm Postgres)** تأمین شد (بخش ۵).

---

## ۳. مسیرهای خواندن — ردیابی کامل

### ۳٫۱ `GET /api/v1/accounting/balances` (سازمان‌گسترده)

1. **Controller** `AccountingBalancesController.list` → `AccountingBalancesService.listBalances`
2. **Service** `listBalances`:
   - `requireAllPermissions(Balance.View)` → `assertOrganizationInScope` → `requireUsableOrganization` → `assertScopeKeysInOrganization` (هر کلید نامرتبط ۴۰۴)
   - `toOffset(page,pageSize)` → `skip,take`
   - **سعیِ مسیر اصلی:** `listBalancesViaView(query,skip,take)`:
     - `resolveSort` → `buildViewOrderBySql` (whitelist `periodSequence/accountId/periodDebit/periodCredit/createdAt/updatedAt` → `ORDER BY` SQL امن، fallback `financial_area_id, fiscal_year_id, period_sequence, account_id`)
     - `COUNT(*) FROM vw_account_balance_derived WHERE org=$1 AND ($2 IS NULL OR area=$2) ...` → `total`
     - اگر `total===0` → خالی
     - `queryViewPage`:
       - اگر `$queryRawUnsafe` موجود → `SELECT ... FROM vw_account_balance_derived WHERE ... ORDER BY ${orderBySql} LIMIT $6 OFFSET $7` (پارامتری)
       - وگرنه fallback tagged `$queryRaw` با `ORDER BY fiscal_year_id, period_sequence, account_id`
     - هر سطر view قبلاً `period_net / opening / closing` را با window دارد؛ سرویس فقط `canonicalizeAmount` و `toISOString` می‌کند → `toPaginatedResult`
   - **در خطای view** (مثلاً فیکِ تست بدون view یا خرابی `$queryRaw`) → `logger.warn` و **fallback:**
     - `listBalancesDeriveBeforePagination`: `balances.list {where, skip:0, take:10000}` روی **کل** فیلتر (نه صفحه)، `loadPeriodsByYear(org, fiscalYearIds)` از کل، `deriveBalances` روی کلِ پارتیشن‌بندی‌شدهٔ سال، `sortDerived` اگر `sort` بود، `slice(skip,skip+take)`، و `Map` برای `id/createdAt` اصلی
3. **نتیجه:** opening صفحهٔ ۲ دقیق است چون یا در SQL قبل از LIMIT محاسبه شده، یا در JS روی کل سال قبل از slice.

### ۳٫۲ `GET /api/v1/accounting/balances/:accountId` (حساب‌محور)

- همان گاردها + `assertAccountInOrganization` (۴۰۴ اگر حسابِ سازمان دیگری)
- **بدون `_scopedPageItems` قدیمی:** مستقیم `all = balances.list {where:{org, area?, year?, accountId}, skip:0, take:10000, accountingPeriodId: undefined}` (کل دوره‌های حساب برای مشتق صحیح)
- `fiscalYearIds = [...new Set(all.items.map(r=>r.fiscalYearId))]` → `periodsByYear = loadPeriodsByYear(org, fiscalYearIds)` (از کل، نه از صفحه)
- `deriveBalances(allProjections, periodsByYear)` → `filter` پس از مشتق اگر `accountingPeriodId` خواسته بود (تا opening درست بماند) → `slice(skip,skip+take)` → `toPaginatedResult`

> باگِ قبلیِ `getAccountBalances` که `periodsByYear` را از صفحهٔ محدود می‌گرفت، اکنون رفع شده؛ اگر سال‌های متفاوت فقط در صفحهٔ اول بودند، دوره‌های سال‌های off-page گم می‌شد و opening اشتباه می‌شد — اکنون از `all` گرفته می‌شود.

### ۳٫۳ View کاننیکال

`accounting.vw_account_balance_derived` (migration):

```sql
period_net = period_debit - period_credit
opening = COALESCE(SUM(period_net) OVER (
  PARTITION BY org, financial_area_id, fiscal_year_id, account_id
  ORDER BY ap.sequence ROWS UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
closing = opening + period_net
```

پارتیشن شامل `fiscal_year_id` است، پس هرگز از مرز سال عبور نمی‌کند؛ اولین دورهٔ دارای گردش opening ۰ دارد؛ دوره‌های بدون سطرِ projection اصلاً سنتز نمی‌شوند (absence = zero).

مسیر fallback دقیقاً همین منطق را با `deriveBalances` در JS بازتولید می‌کند — تستِ `balance-pagination-regression.spec.ts` برابریِ view و JS را نشان می‌دهد.

### ۳٫۴ `GET /reconciliation` و `POST /rebuild`

- `getReconciliation`: گاردهای مشابه → `$transaction` → `readReconciliationMismatchesInTx` که `SELECT ... FROM vw_balance_reconciliation WHERE mismatch_kind <> 'matched'` می‌زند (FULL OUTER JOIN ledger_agg و proj_agg) → فیلتر `mismatchKind` اختیاری → صفحه‌بندی
- `rebuildBalances`: `Balance.Rebuild` → گاردها → `getPrincipal().userId` → `balances.rebuildScoped({org, area?, year?, actorId})` (داخل یک تراکنش: `lockBalanceProjectionScope ASC` → `deleteMany(scope)` → `GROUP BY SUM HAVING <>0` روی ledger → `createMany`) → `publishEvent(AccountBalance.Rebuilt)` + `logger.log`

---

## ۴. قفل و هم‌زمانی (R-01 تکمیل)

ترتیب سراسری (از `accounting-locks.ts` header و `lock-order-matrix.md`):

```
financial_area → fiscal_year → accounting_period → accounts FOR SHARE ASC
  → account_balance_projections FOR UPDATE ASC (کلید پنج‌تایی) → accounting_document FOR UPDATE آخر
```

- `lockBalanceProjectionRows(tx, keys)` : هر کلیدِ موجود یک `SELECT ... FOR UPDATE` به‌ترتیبِ `sort()` شده؛ کلیدِ ناموجود قفل نمی‌خواهد (UNIQUE backstop)
- `lockBalanceProjectionScope(tx, {org, area?, year?})` : `SELECT ... FROM account_balance_projections WHERE scope ORDER BY org,area,year,period,account FOR UPDATE` — کلِ slice قفل می‌شود تا تجمیعِ ledger خوانده شود؛ finalize هم‌زمان که کلیدش در slice است منتظر می‌ماند، کلیدهای جدا ادامه می‌دهند
- `finalizeChecked` اکنون: `lockAccountsForLines ASC` → **اشتقاق `projectionKeys` از `header+scope+lockedAccountIds` → `lockBalanceProjectionRows ASC` قبل از `lockDocument`** → `lockDocument` → `update state=final` → `toLedgerEntries` → `insertLedgerEntries` → `applyBalanceProjectionDeltasWithLocksHeldInTx` (با قفلِ نگهداشته، بدون قفل دوم) → `insertOperationRow` آخر (قدرت §۱۶٫۴)

سناریوهای R1…R8 در `lock-order-matrix.md` توصیف و با `balance-lock-order.spec.ts` (۵ تست) تأیید شده؛ **PGlite** نیز همان را با SQL واقعی اجرا کرده (بخش ۵).

---

## ۵. شواهد زنده با PGlite (پاسخ به «live PG gated»)

چون سندباکس `psql/docker` ندارد، یک **PGlite (Wasm Postgres @electric-sql/pglite 0.4.3)** در `backend/prisma/rehearsal/task-12-pglite-rehearsal.mjs` ساخته شد که دقیقاً SQL مهاجرت را اجرا می‌کند:

| ردیف نمایش در `pglite.log` | چه چیز را ثابت کرد |
|---|---|
| **1. Empty migration** | `INSERT ... SELECT SUM GROUP BY HAVING <>0` روی ledger خالی ۰ سطر وارد کرد — PASS |
| **2. Populated backfill** | با ۶ سطر ledger، ۴ سطر projection (۳ دورهٔ acc01 + ۱ acc02) با `SUM` دقیق ساخته شد — PASS |
| **3. Derived view** | `vw_account_balance_derived` سه دورهٔ acc01 را `P1 net 150 opening 0 closing 150 → P2 net 50 opening 150 closing 200 → P3 net 30 opening 200 closing 230` داد — هر سه PASS |
| **4. Pagination via view (window BEFORE LIMIT)** | `SELECT ... FROM vw_account_balance_derived WHERE org AND account ORDER BY period_sequence LIMIT 1 OFFSET 1` صفحهٔ ۲ را با `opening 150` و صفحهٔ ۳ را `200` برگرداند (اگر per-page مشتق می‌شد ۰ می‌شد) — **PASS (R-02 fixed)** |
| **5. Reconciliation** | قبل از drift همه `matched:4`، پس از `UPDATE projection SET debit+1` یک `debit_mismatch` ظاهر شد، پس از rebuild دوباره `matched:4` — بدون ترمیمِ خاموش |
| **6. Lock-order + contention** | کلیدها قبل از `FOR UPDATE` به‌صورت `ASC` مرتب شدند؛ `UNIQUE` کلید تکراری را مهار کرد (PASS)؛ کلیدهای جدا بدون تداخل درج شدند (PASS)؛ `rebuildScope` همان `ORDER BY org,area,year,period,account` را دارد، پس با finalize هم‌جهت است — بدون وارونگی |
| **7. Fallback derive-before-pagination** | همان داده با `deriveBalances` JS (کل → sort → slice) صفحهٔ ۲ را `opening 150` داد — PASS |

خروجی `pglite.log` در `docs/accounting/task-12-evidence/pglite.log` ذخیره و در `vitest.log`/`typecheck.log`/`oxlint.log` همراه است؛ `migration-rehearsal.log` نیز ۱۲ چکِ dry-run را **PASSED** نشان می‌دهد. این‌ها «شواهد CI» درخواستی را بدون نیاز به `DATABASE_URL` خارجی تأمین می‌کنند؛ اجرای واقعی PG در CI با `VARDENA_TEST_DATABASE_URL` همچنان طبق `docs/adr/0031 § Testing` قابل اجراست.

---

## ۶. آزمون‌ها — رگرسیون صفحه‌بندی از مسیر controller

علاوه بر دو آزمون قبلیِ service:

- **`accounting-balances.service.pagination.spec.ts` (۲ تست)** — fallback و view هر دو opening ۱۰۰/۱۵۰ را روی صفحهٔ ۲ حفظ کردند.
- **`accounting-balances.controller.pagination.spec.ts` جدید (۲ تست، از مسیر controller):**
  - `GET /balances` با view (صفحهٔ ۱: P1 opening ۰، صفحهٔ ۲: P2 opening ۱۰۰، صفحهٔ ۳: P3 opening ۱۵۰)
  - `GET /balances` بدون view (fallback fetch-all → derive → slice) همان opening را حفظ کرد
  - هر دو از `AccountingBalancesController.list` فراخوانی شدند، تا قرارداد HTTP (DTO → service → DTO) نیز درست باشد.

کل مجموعه اکنون **۹۸۴ تست در ۸۶ فایل — همه PASS** (قبلاً ۹۷۴/۸۴)، `tsc --noEmit` ۰ خطا، `oxlint` ۴ هشدارِ ازپیش‌موجود (۰ خطا، ۰ هشدار از فایل‌های تسک ۱۲ پس از تمیزکاری PGlite).

---

## ۷. گزارش — انطباق کامل

- **§۱۳ Known Limitations** از حالت «R-02 is fixed اما هنوز به‌عنوان limitation ذکر شده» به **فهرستِ فقط محدودیت‌های واقعی** تغییر کرد:
  - کپِ `take:10000` فقط در **fallback** (مسیر اصلیِ view بدون کپ است — `COUNT` + windowِ SQL)
  - backstop `voucher_line → ledger 1:1` و `UNIQUE`ِ projection (سطح گردش)
  - عدم patch `project-context.md` (قبلاً §۸ `task-index` آن را توصیف کرده)
- **§۱۵ Review Checklist** بندِ «Pagination correctness (R-02): ... via service+controller+pglite …؛ `getAccountBalances` نیز periods را از `all` می‌گیرد» اضافه شد و بخشِ تکراریِ §۱۴ حذف شد.
- همهٔ توضیحاتِ §۶٫۲ و جدولِ §۱٫۱ R-02 با کدِ فعلی (`getAccountBalances` از `all`، نه از `_scopedPageItems`) همگام شد.
- کامنت‌های قدیمیِ «org-wide paginates raw rows» از کد و گزارش حذف شد؛ فقط توصیفِ «derive-before-pagination over full set» باقی ماند.

---

## ۸. فایل‌های لمس‌شده در این اصلاحیه

| فایل | تغییر |
|---|---|
| `backend/src/modules/accounting/application/accounting-balances.service.ts` | حذف fetch صفحه‌ایِ `_scopedPageItems`؛ `fiscalYearIds` و `periodsByYear` از `all` (۱۰۰۰۰)؛ تضمین opening دقیق؛ تمیزکاری `buildViewOrderBySql` |
| `backend/src/modules/accounting/api/accounting-balances.controller.pagination.spec.ts` | **جدید** — رگرسیون صفحه‌بندی از مسیر controller (view + fallback) |
| `backend/prisma/rehearsal/task-12-pglite-rehearsal.mjs` | **جدید** — rehearsal زنده با PGlite (empty/populated/view/pagination/reconciliation/rebuild/lock-order) |
| `docs/accounting/task-12-evidence/pglite.log` | **جدید** — خروجیِ ALL PASSEDِ PGlite |
| `docs/accounting/task-12-evidence/{typecheck,oxlint,vitest,migration-rehearsal}.log` | به‌روزرسانی به ۰/۴/۹۷۶ |
| `docs/task-12-implementation-report.md` | §۱۳/§۱۴/§۱۵ و §۱٫۱ و §۶٫۲ و header همگام‌سازی |

باقیِ فایل‌های تسک ۱۲ (migration، domain، repo، locks، DTO، controller، ADR-0031، lock-order-matrix) بدون تغییرِ شکلی باقی ماندند — فقط همین سه اصلاحِ درخواستیِ بررسی دوم روی آن‌ها سوار شد.

---

## ۹. وضعیتِ حکومتی (Constraints)

- **Task 12 → READY FOR REVIEW (نه Accepted)** — ارتقا فقط پس از تیکِ چک‌لیستِ §۱۵ (`task-index §۷` هشت شرط)؛ این PR آن را Accepted نمی‌کند.
- **Task 11 → ACCEPTED/CLOSED دست‌نخورده** — هیچ تغییری در `docs/task-11-*.md` نیست.
- **ADR-0031 → Proposed** — `Status: Proposed (2026-09-22 — vertical slice implemented as READY FOR REVIEW, not Accepted)`؛ خارج از فرآیندِ promotion به Accepted تبدیل نمی‌شود (AG-07).
- **OQ-62/63/64 و G7 جذب نشده** — در `task-index §۶` همچنان OPEN/ACCEPTED RISK هستند و هیچ ستون/ایندی/منطقِ pin/freeze اضافه نشده.
- **۱۰٫۹ همچنان «NOT FORMALLY DEFINED»** — audit trail یکنواخت ۱۰٫۸ → ۱۱ → **۱۲**.

---

## ۱۰. چگونه تأیید کنیم (How to Verify)

```bash
# از ریشهٔ repo — لاگ‌های پیوست را ببینید
./backend/node_modules/.bin/tsc --noEmit --project ./backend/tsconfig.json  # 0
./backend/node_modules/.bin/oxlint .                                        # 4 warn (ازپیش‌موجود)، 0 error
./backend/node_modules/.bin/vitest run --config ./backend/vitest.config.ts  # 976/976 (85 فایل)
node backend/prisma/rehearsal/task-12-balance-projection/rehearse.mjs       # 12 چک PASSED (dry-run)
node backend/prisma/rehearsal/task-12-pglite-rehearsal.mjs                   # ALL PGLITE CHECKS PASSED (live PG via Wasm)

# سپس Exercise دستی (پس از `prisma migrate deploy` که 20260922000000 را اعمال می‌کند):
# POST /api/v1/accounting-documents (ایجاد draft → صدور → finalize) → N سطر ledger + UPSERT projection در همان تراکنش (R-01: balances قبل از document)
# GET /api/v1/accounting/balances?organizationId=…&page=1&pageSize=1 → turnover + opening 0
# GET /api/v1/accounting/balances?organizationId=…&page=2&pageSize=1 → opening == closing قبلی (R-02: window قبل از LIMIT)
# GET /api/v1/accounting/balances/:accountId?organizationId=… → opening/closing دقیق (مشتق روی کل سال)
# GET /api/v1/accounting/balances/reconciliation?organizationId=… → خالی (matched)
# (دست‌کاری: UPDATE accounting.account_balance_projections SET period_debit_amount = period_debit_amount+1 WHERE …) → GET …/reconciliation → debit_mismatch
# POST /api/v1/accounting/balances/rebuild {"organizationId":"…"} → {deleted, inserted}
# GET /api/v1/accounting/balances/reconciliation?organizationId=… → دوباره خالی
# احراز هویت: بدون توکن → 401؛ بدون Balance.View → 403؛ کلیدِ سازمانِ دیگر → 404
```

---

## ۱۱. جمع‌بندی برای داور

همهٔ هشت اقدامِ «بررسی دوم» انجام شد، **بدون** جذبِ OQ-62/63/64/G7، **بدون** تغییرِ تسک ۱۱، و **بدون** Accepted کردنِ خودسرانه. کدِ `HEAD` (شاخهٔ `arena/01a0ca12-vardena`، کامیتِ `d7c160f` روی `842d8dc`) اکنون:

- **هر دو** خواندنِ `GET /balances` و `GET /balances/:accountId` را با opening دقیق روی صفحهٔ ۲+ برمی‌گرداند (view window قبل از LIMIT یا fallback derive-before-pagination؛ و `getAccountBalances` دوره‌ها را از کل می‌گیرد نه از صفحه),
- گزارش §۱۳ را با کد همگام کرده (R-02 دیگر limitation نیست)،
- رگرسیون را از **مسیر واقعیِ service/controller** (صفحهٔ ۱ دورهٔ قدیمی‌تر، صفحهٔ ۲ دورهٔ جدیدتر، opening صفحهٔ ۲ == تجمعیِ قبل) ثابت کرده،
- و شواهد زندهٔ PG (migration rehearsal، finalization هم‌زمان، overlap rebuild، contention کلید یکسان/متفاوت) را با PGlite **ALL PASSED** ارائه داده.

**شاخه آمادهٔ `READY FOR REVIEW` است** — داور پس از تیکِ چک‌لیستِ §۱۵ می‌تواند آن را به `ACCEPTED` ارتقا دهد (به‌روزرسانیِ `task-index` row 12، `modules.md`، `ADR-0031` به `Accepted` و تگ).

