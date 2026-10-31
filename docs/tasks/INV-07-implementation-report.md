# INV-07 — درخواست کالا: چرخهٔ تأیید (Material Request Approval Lifecycle)

- **وضعیت:** پیاده‌سازی‌شده در فرانت‌اند (`INV-07`)
- **تاریخ گزارش:** ۲۰۲۶-۱۰-۳۱
- **مبنای کد:** `main` @ `46a190f`
- **ماژول بک‌اند مرجع:** `backend/src/modules/inventory/api/material-requests.controller.ts` (`MaterialRequestsController`، v1 `/api/v1/inventory/material-requests`) + `domain/material-request.ts` + `application/material-requests.service.ts`
- **مراجع:** [standards.md](../frontend/standards.md)، [datetime.md](../datetime.md)، [ماتریس پوشش](../frontend/coverage-matrix.md)، `task/OUT-OF-SCOPE.md` (نسخهٔ بستهٔ تسک، بیرون از مخزن)، `AR-21`
- **تغییر بک‌اند / Prisma / migration / `vardena-api.d.ts`:** **۰**

---

## ۱. خلاصهٔ دامنهٔ تحویل‌شده

پنج اکشن تصمیم روی جزئیات درخواست کالا، روی قرارداد موجود بک‌اند و بدون هیچ endpoint یا مجوز تازه:

1. **مجوزها — `frontend/src/features/permissions/permission-codes.ts`**
   `materialRequestApprove`, `materialRequestReject`, `materialRequestReturnForCorrection`, `materialRequestReverseApproval`, `materialRequestCancel` — دقیقاً همان پنج کدی که در `backend/src/modules/inventory/domain/material-request-permissions.ts` ثبت شده‌اند. `Invoke` اضافه نشد (BLOCKED).
2. **لایهٔ API — `frontend/src/api/inventory.api.ts`**
   `approveMaterialRequest(orgId, id)` **بدون بدنه** (`apiPost(url, undefined, …)`)،
   `rejectMaterialRequest(orgId, id, { reason })`،
   `returnMaterialRequestForCorrection(orgId, id, { reason })`،
   `reverseMaterialRequestApproval(orgId, id, { reason })`،
   `cancelMaterialRequest(orgId, id, { reason })`.
   `organizationId` در query می‌ماند و پاسخ همه `MaterialRequestDetail` است.
3. **کلیدهای query:** کلید تازه‌ای لازم نبود؛ هر پنج mutation از `materialRequestsPrefix` + `materialRequestDetail` + `materialRequestEvents` استفاده می‌کنند. `approve`/`reverseApproval`/`cancel` علاوه بر آن `balancesPrefix` و `reservationsPrefix` را هم invalidate می‌کنند (تأیید رزرو می‌سازد، برگشت/لغو آزاد می‌کند).
4. **هوک‌ها — `material-request-hooks.ts`**
   `useApproveMaterialRequestMutation`, `useRejectMaterialRequestMutation`, `useReturnMaterialRequestForCorrectionMutation`, `useReverseMaterialRequestApprovalMutation`, `useCancelMaterialRequestMutation`؛ بدون optimistic update.
5. **منطق خالص — `material-request-decisions.ts`**
   `availableMaterialRequestActions({ status, approvedBy, currentUserId, hasInvokedLine, permissions })` → ماتریس «دیده‌شدن/فعال‌بودن/دلیل غیرفعالی» برای هر پنج اکشن، به‌علاوهٔ اعتبارسنجی دلیل (`materialRequestReasonProblem`, `normalizeMaterialRequestReason`).
6. **UI — `material-request-decision-actions.tsx` + `material-request-decision-copy.ts`**
   دکمه‌ها از ماتریس رندر می‌شوند؛ یک `ConfirmDialog` مشترک با فیلد دلیل (الزامی برای رد/برگشت، اختیاری برای برگشت تأیید/لغو، بدون فیلد برای تأیید) و نمایش «واقعیت‌های تصمیم» (شماره، تعداد ردیف، ردیف‌های رزروی/فراخوانی‌شده) پیش از تأیید.
7. **صفحهٔ جزئیات — `material-request-detail-page.tsx`**
   ناحیهٔ تصمیم در کنار اکشن‌های نویسندگی، و افزودن بازیگر هر تصمیم (`approvedBy`/`rejectedBy`/`returnedBy`/`approvalReversedBy`/`cancelledBy`) به DefinitionList؛ زمان‌ها همچنان `Instant` با `formatDateTimeWithZone`.
8. **i18n — `lib/i18n.ts`**
   زیرفضای `t.materialRequests.actions` (برچسب/عنوان/بدنه/هشدار/دلیل/دلیل غیرفعالی/toast/loading)، `t.materialRequests.decisions`، و چهار پیام خطای دامنه‌ای. هیچ رشتهٔ فارسی inline در JSX نیست.

---

## ۲. تطبیق ماتریس دسترس‌پذیری با بک‌اند

| وضعیت درخواست | approve | reject | returnForCorrection | reverseApproval | cancel |
| --- | --- | --- | --- | --- | --- |
| `draft` | — | — | — | — | — |
| `submitted` | ✔ | ✔ | ✔ | — | — |
| `returned` | — | — | — | — | — |
| `approved` | — | — | — | ✔ فقط تأییدکنندهٔ اصلی | ✔ |
| `rejected` | — | — | — | — | — |
| `cancelled` | — | — | — | — | — |

- اکشنی که وضعیت اجازه نمی‌دهد **رندر نمی‌شود** (نه حتی غیرفعال) — منطبق با `planDecision` (فقط `submitted`) و `planReversal` (فقط `approved`).
- اکشنی که کاربر مجوزش را ندارد `visible: false` است.
- `approved` + سطر فراخوانی‌شده (`invocationCount > 0`): برگشت تأیید و لغو **دیده می‌شوند ولی غیرفعال‌اند** با دلیل «حداقل یک سطر فراخوانی شده است» — همان `MaterialRequestLinesInvokedError` سرور.
- `approved` + `approvedBy !== currentUserId`: برگشت تأیید غیرفعال با دلیل «فقط تأییدکنندهٔ اصلی»؛ **لغو فعال می‌ماند** چون بک‌اند برای لغو محدودیت تأییدکننده ندارد.
- `cancel` روی پیش‌نویس وجود ندارد؛ لغو پیش‌نویس همان `DELETE` در INV-06 است.

### نگاشت خطاها (بدون بازسازی پیام سرور)

| کد/پیام بک‌اند | نمایش |
| --- | --- |
| `422` «The request must be submitted…» | `actions.disabledNotSubmitted` |
| `422` «The request is not approved.» | `actions.disabledNotApproved` |
| `422` «… at least one line has already been invoked …» | `actions.disabledLinesInvoked` |
| `403` «Only the original approver may reverse this approval.» | `errors.notOriginalApprover` |
| `409` `BalanceDriftError` | `errors.balanceDrift` |
| `422` «Insufficient available stock: available X, requested Y.» | `errors.insufficientStock` با `{details}` = **متن دقیق سرور** |
| `400` «A rejection/return reason is required.» | `actions.reasonRequired` |
| `400` «Reason must be at most 1000 characters.» | `actions.reasonTooLong` |

اعداد `available`/`requested` هرگز در فرانت بازسازی، گرد یا بازقالب‌بندی نمی‌شوند؛ فقط داخل یک جملهٔ فارسی نمایش داده می‌شوند (استانداردهای §۷).

---

## ۳. راستی‌آزمایی (اجراشده)

| دستور | نتیجه |
| --- | --- |
| `npm run typecheck` | سبز |
| `npm run lint` | سبز (۰ خطا/۰ هشدار) |
| `npm run format:check` | سبز |
| `npx vitest run src/features/inventory/material-requests` | سبز (۶ فایل / ۷۲ تست) |
| `npm run test` | سبز (۱۶۵ فایل / ۱۲۱۹ تست) |
| `npm run build` | سبز |
| `python3 scripts/check-date-contract.py` | PASS |
| `node scripts/check-frontend-design-tokens.mjs` | OK |
| CI سنگین (backend/PostgreSQL/E2E/Owner UI) | در GitHub Actions همین PR |

تست‌های تازه:

| فایل | پوشش |
| --- | --- |
| `material-request-decisions.test.ts` | جدول کامل وضعیت×اکشن، گیت مجوز، `hasInvokedLine`، تأییدکنندهٔ اصلی (و کاربر ناشناس)، اعتبارسنجی دلیل الزامی/اختیاری/سقف ۱۰۰۰ |
| `material-request-detail-page.test.tsx` (توسعه) | سه اکشن تصمیم روی `submitted`؛ تأیید **بدون آرگومان سوم**؛ دلیل الزامی رد/برگشت؛ دلیل اختیاری برگشت تأیید و لغو (`reason: null`)؛ لغو فقط در `approved`؛ غیرفعالی با دلیل برای سطر فراخوانی‌شده؛ ۴۰۳ غیرتأییدکننده با دیالوگ باز؛ ۴۲۲ موجودی ناکافی با اعداد سرور؛ ۴۰۹ drift؛ نمایش تصمیم‌گیرنده/دلیل روی رکورد؛ نبود اکشن بدون مجوز |
| `material-request-hooks.test.tsx` (توسعه) | پنج mutation، invalidate بودن prefix/detail/events، و `balances`/`reservations` فقط برای سه اکشن مؤثر بر رزرو؛ رد/برگشت، موجودی را دست نمی‌زنند |

---

## ۴. انحراف‌ها و تصمیم‌های ثبت‌شده (صادقانه)

1. **نام فایل منطق خالص.** تسک `material-request-actions.ts` را پیشنهاد داده بود، اما `material-request-actions.tsx` (کامپوننت نویسندگی INV-06) از قبل وجود دارد؛ افزودن `.ts` هم‌نام باعث می‌شود resolve ماژول در Vite/TS ابتدا `.ts` را بردارد و import کامپوننت بشکند. فایل با نام `material-request-decisions.ts` ساخته شد (به‌همراه `material-request-decision-copy.ts`، `material-request-decision-actions.tsx` و `material-request-decision-dialog-fields.tsx`). رفتار پیشنهادی تسک بدون تغییر باقی است.
2. **`reasonKey?: string` → اتحاد بستهٔ `blockedReason`.** به‌جای رشتهٔ آزاد کلید i18n، خروجی تابع خالص یک اتحاد `'linesInvoked' | 'notOriginalApprover'` است و نگاشت به متن در یک جدول واحد (`material-request-decision-copy.ts`) انجام می‌شود؛ این‌گونه کلید ناموجود در زمان کامپایل گرفته می‌شود.
3. **ابطال `availability`.** کلید `inventory.availability` در `query-keys.ts` وجود ندارد (همان یافتهٔ گزارش INV-08)؛ تنها کلید موجودی‌بر `balancesPrefix` است. علاوه بر آن `reservationsPrefix` هم invalidate می‌شود، چون تأیید/برگشت/لغو رزروها را اتمی می‌سازند یا آزاد می‌کنند. کلید تازه‌ای برای این تفاوت اختراع نشد.
4. **پیام موجودی ناکافی.** قرارداد پروژه «متن انگلیسی سرور رندر نشود» است؛ این یک استثنای مستند است، چون پیام شامل `available`/`requested` است و استانداردهای §۷ بازسازی عدد سمت کلاینت را ممنوع می‌کند. قالب: `errors.insufficientStock` با `{details}` = متن کامل سرور.
5. **تغییر یک تست موجود (نه حذف رفتار).** تست INV-06 با عنوان «never renders approval, cancellation or line-invocation commands» تحت مجوزهای *فقط نویسندگی* اجرا می‌شد. با INV-07 این رفتار دیگر مطلق نیست، پس عنوان به «renders no decision command without its permission and NEVER the blocked line invocation» تغییر کرد و بدنه‌اش علاوه بر پنج test-id تصمیم، نبودِ `material-request-invoke` را هم در هر شرایطی تضمین می‌کند. هیچ assertی حذف نشد.
6. **`PUT …/lines/invoke` ساخته نشد.** طبق `OUT-OF-SCOPE.md` (BLOCKED: مصرف‌کنندهٔ واقعی وجود ندارد) نه کد `Invoke` اضافه شد، نه دکمه، نه تابع API — حتی غیرفعال.
7. **جریان تأیید چندمرحله‌ای/موازی ساخته نشد.** بک‌اند یک مرحلهٔ تصمیم دارد؛ هیچ مدل «مرحله/تأییدکنندهٔ منصوب» در UI جعل نشد.
8. **رزرو در فرانت ساخته/آزاد نمی‌شود.** تأیید/برگشت/لغو این کار را اتمی در بک‌اند انجام می‌دهند؛ UI فقط نتیجه و invalidate را نشان می‌دهد.
9. **بدهی باقی‌مانده (خارج از دامنهٔ این تسک).** گزارش INV-08 بند ۳.۱ درخواست کرده بود لینک «رزرو → درخواست کالا» در `reservations` تکمیل شود؛ مسیر درخواست کالا اکنون موجود است ولی این تغییر در دامنهٔ INV-07 نیست و به تسک مستقل نیاز دارد (feature → feature import ممنوع است و فقط لینک URL مجاز خواهد بود).

---

## ۵. فایل‌های ایجادشده

- `frontend/src/features/inventory/material-requests/material-request-decisions.ts`
- `frontend/src/features/inventory/material-requests/material-request-decisions.test.ts`
- `frontend/src/features/inventory/material-requests/material-request-decision-copy.ts`
- `frontend/src/features/inventory/material-requests/material-request-decision-actions.tsx`
- `frontend/src/features/inventory/material-requests/material-request-decision-dialog-fields.tsx`
- `docs/tasks/INV-07-implementation-report.md` (این فایل)

## ۶. فایل‌های تغییرکرده

- `frontend/src/api/inventory.api.ts` (پنج تابع تصمیم؛ `approve` بدون بدنه)
- `frontend/src/features/permissions/permission-codes.ts` (پنج کد مجوز)
- `frontend/src/features/inventory/material-requests/material-request-hooks.ts` (پنج mutation + invalidate موجودی/رزرو)
- `frontend/src/features/inventory/material-requests/material-request-error-messages.ts` (نگاشت خطاهای چرخهٔ تأیید)
- `frontend/src/features/inventory/material-requests/material-request-actions.tsx` (فقط به‌روزرسانی توضیح سرصفحه)
- `frontend/src/features/inventory/material-requests/material-request-detail-page.tsx` (ناحیهٔ تصمیم + بازیگر تصمیم‌ها)
- `frontend/src/features/inventory/material-requests/material-request-detail-page.test.tsx` (تست‌های INV-07)
- `frontend/src/features/inventory/material-requests/material-request-hooks.test.tsx` (تست‌های invalidate)
- `frontend/src/lib/i18n.ts` (کلیدهای `actions`/`decisions`/`errors`)
- `docs/frontend/coverage-matrix.md` (ردیف «درخواست کالا» → COMPLETE؛ جمع‌بندی و اولویت بعدی)
