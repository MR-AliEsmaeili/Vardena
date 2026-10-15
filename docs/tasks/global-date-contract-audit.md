# Global date/calendar contract — PR #164 evidence and bounded implementation

Date: 2026-10-16. This report extends the existing licensing decision PR at the
Product Owner's explicit request; it does not replace those decisions or claim
all modules are implemented/compliant. Normative homes remain
[date/time architecture §0](../datetime.md), [ADR-0042](../adr/0042-datetime-calendar-architecture.md),
[ADR-0044](../adr/0044-fixed-jalali-first-businessdate-policy.md) and AR-32.
This file is evidence/inventory, not a competing policy or ADR.

## 1. Pre-edit inspection and coherent scope

- Fetched main: `636c19b0a137dc2b602fb1be1861fafaeecb7332`.
- Inspected PR #164 base: that same SHA; initial head:
  `af86be379c5dc46b8a6e270f9cabbbb674b4d627`, one commit, 20 Markdown files.
  Its docs-only Actions run `38814863011` succeeded **only for that old head**;
  code jobs were appropriately skipped, not evidence for this extension.
- PR files/commits, inline comments and reviews were inspected through GitHub
  REST. No inline comments/reviews; bot issue comments reported review usage
  failure, not review approval. The only open PR was #164; no competing open
  implementation to duplicate. No branch-protection access/approval is claimed.
- Existing PR already introduced global-date scope and explicitly identified raw
  Owner ISO gaps in PDR-11 §20.5. Extending those exact gaps is coherent; the
  user expressly superseded the original docs-only limit with bounded code/tests.
  Larger-than-guideline PR size is deliberate, not unrelated feature work.
- Previous licensing product policies, four Owner roles, independent runtime,
  replacement identities/quotas, recovery boundaries and unresolved technical
  questions remain intact. No key/signature/storage/API/schema/evaluator change.

## 2. Separate authorities from implementation

**New explicit product approvals (2026-10-16):** Persian date/time digits for
ordinary Iranian UI; canonical/API/protocol ASCII unchanged, accepted input
forms unchanged, OQ-02 narrowed only. Owner may regenerate exact canonical pure
helper sources as ignored build inputs, with allowlist/fail-closed staging and
no second implementation or customer runtime dependency. Root-context Docker
allowlists only Owner UI and those helpers.

**Existing accepted architecture:** branded Gregorian `BusinessDate`/PostgreSQL
`date`; UTC `Instant`/`timestamptz`; explicitly declared Jalali input converts
once and preserves the day. No artificial domain midnight, browser parsing or
historical reinterpretation. Valid organization IANA settings remain the
ADR-0042 exception to Tehran default; Owner has no organization context and uses
Tehran. Inclusive day filters, specific Inventory half-open validity and
half-open event windows remain distinct. Historical rendering fallback remains.

**Implemented here:** centralized Persian date/time digits; explicit local-day
UTC event-query helper; actual Owner customer/operation/audit timestamp callers;
thin Owner input/facade over exact canonical sources; Jalali audit input and
versioned Tehran links preserving unmarked legacy UTC day links; source guard,
focused regressions, independent image verification in Actions.

**Not implemented here:** expiry/Grace/recovery/replacement enforcement, archive,
future modules, all print/export/legal layouts, database migration or a whole
customer deployment/history audit. No new product conflict remains after the two
explicit approvals; technical follow-ups are not silently marked resolved.

## 3. Actual call-site audit matrix

Paths below are repository-relative. “Compliant” is bounded to the inspected
behavior, never the entire containing module. “Source inspected” is not an
executed test. Verification results belong to the exact PR head/Actions.

| Area | Exact evidence (file and symbol/call site) | Finding | Action in this extension | Verification |
|---|---|---|---|---|
| Canonical calendar/validation | `frontend/src/lib/datetime/calendar.ts`: `isGregorianDay`, `convertDay`; `business-date.ts`: `resolveDayInput` | Existing strict conversion/canonical contract compliant; numeral display defective under new approval | Add `toPersianDigits` only in presentation; preserve declared/API ASCII | `datetime.test.ts`, `format.test.ts`: leap/invalid/rollover, conversion, serialization and historical fallback |
| Instant/zone foundation | `instant.ts`: `formatInCalendar`, `isInstant`, `instantOffsetLabel`; `settings.ts`: organization store | Zone-first and strict UTC-Z existing compliant; primary digits defective | Central Persian date/time output; keep technical zone/offset ASCII | Existing fixed Tehran/UTC and historical DST fixtures; new `instant-range.test.ts` near-midnight Persian output |
| Event-query ranges | New `frontend/src/lib/datetime/instant-range.ts`: `calendarDayStartInstant`, `calendarDayExclusiveEnd` | Needed explicit new Tehran event-day boundary; not a BusinessDate persistence adapter | Resolve local start and next-day start independently, reject skipped/coerced/overflow days | New fixed 2022 Tehran 25-hour day, leap, invalid zone/day, year coercion, skipped Apia day, max-year tests; non-Tehran process TZ |
| Shared customer input | `frontend/src/ui/patterns/date-input.tsx`, `jalali-date-input-field.tsx` | Jalali parser/presentation and historical fallback inspected; partial draft intentionally keeps prior canonical value then resets on blur | Persian initial/blur display comes from central formatter; no broad RHF draft refactor | `date-input.test.tsx` valid Persian input/canonical output, partial behavior, historical fallback; remaining draft risk in §5 |
| Customer document creation | `frontend/src/features/accounting/documents/document-form-page.tsx`: Controller `documentDate` → shared `DateInput`; `frontend/src/features/accounting/documents/document-form-schema.ts`: `documentFormSchema` | Representative Jalali input/canonical boundary inspected, not every write route | No new date engine or request shape | Existing form tests in Actions; valid input foundation tests locally |
| Customer document list/dashboard | `frontend/src/features/accounting/documents/documents-columns.tsx`, `frontend/src/features/dashboard/components/documents-table.tsx`: primary `formatDateOnly`, secondary canonical title | Existing Jalali call sites; inherited ASCII display defect | Update display-only test expectations, retain canonical title assertion | Dashboard table regression locally; document list assertions updated and tested separately/Actions |
| Customer document detail/audit | `frontend/src/features/accounting/documents/document-detail-page.tsx`: `formatDateOnlyWithCanonical`, `formatDateTimeWithZone` | Existing shared call sites compliant except inherited digits | Persian primary; Gregorian reconciliation/ISO title unchanged | Detail tests locally; no day/time fact rewritten |
| Customer reports/filter URLs | `frontend/src/features/accounting/general-ledger/general-ledger-page.test.tsx`; runtime `shared/report-filters.ts`, `general-ledger/general-ledger-columns.tsx` | Jalali entry → canonical ASCII URL/query and formatted day/Instant inspected | Update rendered expectations only; preserve inclusive day filter API | GL UI regression and `shared/report-query.test.ts` locally; remaining report assertions in Actions |
| Inventory representative consumers | `frontend/src/features/inventory/movements-columns.tsx`, `kardex-page.tsx`, `documents/inventory-document-detail-page.tsx`, `documents/document-header-fields.tsx` | Shared formatting/input call sites source-inspected; full Inventory journeys unverified | Inherit central digit output; no posting/replay changes | Broad module/integration checks in Actions, no claim of all paths audited |
| Organization detail/history | `frontend/src/features/organization/admin/organization-profile-page.tsx`, branch/department/party/employee detail `formatDateTimeWithZone` | Representative source compliant with shared facade | Inherit central output, keep ISO titles | Call-site inspection only locally; not whole administration compliance |
| Licensing/expiry/device display | `frontend/src/features/licensing/license-status-card.tsx`: `windowLabel`; `client-devices-page.tsx`: activation and event `formatDateTime` | Existing Instant presentation consumers; signed validity is not BusinessDate | Central digits; add real scheduled-license display assertion without changing ISO fixture/payload | Focused scheduled-renewal UI regression; device flows in Actions; Grace/recovery future flows unverified |
| Backend domain and explicit input | `backend/src/kernel/datetime/business-date.ts`, `business-date-input.ts`, `backend/src/kernel/http/is-business-date.decorator.ts`; `modules/accounting/api/dto/accounting-document.dto.ts`: `documentDate` | Branded day, declared-calendar/legacy UTC adapter and validation inspected, compliant for these boundaries | No backend/schema/API change | Existing `kernel/datetime/datetime.spec.ts` and HTTP validator tests inspected; execution via backend Actions, not locally |
| Backend transport distinction | `backend/src/kernel/datetime/api-date-time.ts`, `api-date-time.dto.ts`; `frontend/src/lib/datetime/api-mapping.ts` | Canonical/derived API blocks remain ASCII, distinct from UI digits | No transport/generated fixture modification | Existing datetime API mapping/declared-day tests locally; backend tests/contract generation in Actions |
| Accounting query/persistence | `backend/src/modules/accounting/domain/date-range.ts`; `data/accounting-read-query.repository.ts`: SQL `document_date >= dateFrom::date`, `<= dateTo::date`; `backend/prisma/schema/accounting.prisma` | Inclusive BusinessDate queries and `@db.Date` versus event `@db.Timestamptz(6)` source inspected | Preserve semantics and Prisma-only adapters | Existing domain/repository/DB checks in Actions; no local DB/migration claim |
| Inventory query/validity | `backend/src/modules/inventory/data/inventory-movements.repository.ts`: `toWhere` gte/lte `dbBusinessDate`; `domain/unit-conversion.ts`: `[validFrom,validTo)`; `backend/prisma/schema/inventory.prisma`: movement `@db.Date`, created `@db.Timestamptz(6)` | Inclusive movement filters and distinct half-open effective validity inspected; not all valuation/replay paths | Preserve all existing boundaries | Existing backend regression/integration suites in Actions; production histories unverified |
| Owner customer timestamp detail | `owner-licensing/frontend/src/features/customers/customer-page.tsx`: created/updated rows | **Defective:** raw ISO primary | `formatOwnerInstant`, Persian Jalali Tehran seconds/zone; ISO retained in title | Actual customer detail regression in `audit-page.test.tsx` |
| Owner license/replacement observations | `owner-licensing/frontend/src/features/operations/operation-page.tsx`: created/updated and transition times | **Defective:** raw ISO primary | Shared facade; technical ISO title/dateTime preserved; no observation/security semantics change | `operations-flow.test.tsx` actual detail/history regression plus existing permission/manual-observation tests |
| Owner security/audit display | `owner-licensing/frontend/src/features/audit/audit-page.tsx`: event time row | **Defective:** raw ISO primary | Shared Tehran formatter; raw ISO title; before/after JSON remains technical evidence | Actual near-midnight audit view test, retained security/permissions tests |
| Owner audit date entry/query | `audit-page.tsx`, `audit-filters.ts`, `audit-filter-schema.ts`; `ui/patterns/date-input.tsx` | **Defective:** ordinary Gregorian-only input/UTC-day UX | Thin Jalali form adapter; invalid drafts cannot retain/widen prior bounds; new `dayZone=Asia/Tehran`; unmarked old date URLs stay UTC with explicit legacy hint | Actual UI valid/invalid entry and old-link tests; filter tests retain min/max-year, duplicates/unknown keys/range protections plus zone-marker cases |
| Owner backend event boundary | `owner-licensing/backend/src/audit.ts`: strict `utcInstant`, query `occurred_at >= ::timestamptz`, `< ::timestamptz`; audit migrations | Existing canonical UTC Instant/half-open query compliant; no need to alter storage/API | Frontend converts selected local days only at explicit event-query boundary; lower-year overflow disables query | Existing backend audit/security/DB tests in Actions; frontend filter cases locally |
| Independent Owner build | `owner-licensing/frontend/scripts/stage-date-foundation.mjs`, `Dockerfile`, `Dockerfile.dockerignore`, package pre-scripts; `src/lib/date-time.ts` | Approved compatibility path, no direct application imports | Seven pure files staged byte-identically, allowlisted imports, ignored generated outputs, fail closed/no fallback; own dependencies and static artifact | Node staging test compares every byte/removes stale files/rejects missing and unexpected dependency; Owner typecheck/tests; Docker build only in Actions |
| Contracts/fixtures/separation | Existing signed protocol vectors and frontend/backend API fixtures; `scripts/check-owner-isolation.py`; workflow customer image/artifact checks | No observed reason to modify signed/API/storage fixtures | Leave canonical files/bytes and isolation checker intact; no new package/calendar dependency | Diff review plus existing Actions artifact/protocol checks; no cryptographic approval inferred from display tests |
| Mechanical enforcement | New `scripts/check-date-contract.py`, `scripts/tests/test_date_contract.py`, frontend CI step | Limited preventive coverage, not universal compliance proof | Reject direct calendar libraries, locale date formatting, unauthorized native inputs and simple raw-primary Instant JSX; permit technical evidence/dictionary labels | Focused Python tests and live scan; behavioral and reviewer gates still required |
| Print/Excel/PDF/invoice templates, future Recovery/Grace/Owner issuance, other modules | No exhaustive field-by-field consumer inventory or deployed artifact sampled in this task | **UNVERIFIED** (some future surfaces not implemented) | Mandatory §0 gate applies, but no blanket compliance label | Follow-ups below; one screen/shared formatter does not prove these surfaces |

## 4. Regression/check strategy and evidence ledger

Focused local checks only; no full frontend/backend suite, production build,
Docker, PostgreSQL migration/integration or E2E run locally. Commands/results are
reported for final code in the PR description. The executed groups are:

- Frontend typecheck; `datetime.test.ts`, new `instant-range.test.ts`,
  `format.test.ts`, `date-input.test.tsx`, `shared/report-query.test.ts`.
- Representative dashboard/document-detail/GL input-and-report tests, including
  range foundation under `TZ=America/New_York` (host independence).
- Updated document-list/account-statement tests and the single
  `license-import.test.tsx -t 'shows the scheduled renewal'` case (other tests in
  that file are skipped intentionally, not counted as passing).
- Owner typecheck; Node exact-source staging regression; `date-time.test.ts`,
  `audit-filters.test.ts`, `audit-page.test.tsx`, `operations-flow.test.tsx`.
- Changed-file formatter/linter checks, source guard and its focused Python
  tests, docs-link check and `git diff --check`.

Final pre-push local ledger: both UI typechecks PASS; frontend foundation/query
48 tests PASS, dashboard/detail/GL 26 tests PASS, document-list/account-statement
18 tests PASS, scheduled-license case 1 PASS / 12 deliberately skipped (93 unique
selected customer tests, not a full suite). Owner selected files 116 tests PASS
plus Node projection regression 1 PASS. New source-guard unit tests 2 PASS;
source scan and existing customer source-isolation check PASS. Changed-file
Oxlint reports zero errors/warnings; formatting and diff whitespace PASS. Docs
link check: 307 Markdown files, 970 relative links, zero broken. Existing Owner
pagination fixtures emit duplicate-key React warnings; assertions pass, and no
claim of warning-free full test output is made. Heavy checks are Actions-only.

The old docs-only CI is not reusable for code. Observe exact **final head**
Actions status for backend (including protocol/persistence/security/isolation),
frontend/Owner/full builds/image and generated API checks when classified as
applicable. Pending/skipped/failed checks must be reported honestly. No merge,
auto-merge, protection change or valid-check rerun is authorized by this work.

## 5. Explicit remaining scope / ordered follow-ups

1. **Consumer inventory/completion:** module-by-module field inventory for print,
   PDF/Excel/invoice templates, all validation/error messages, report selectors,
   security/history and customer-device cases. Depend on the global foundation
   and §0 gate; add real caller regressions, not more conversion libraries.
   Representative source inspection and CI success do not establish all-field
   compliance or production rendering.
2. **Customer invalid-draft semantics:** `JalaliDateInputField` currently retains
   the last canonical value for a partial/invalid draft and resets on blur (an
   existing explicit regression). Owner event filters deliberately do not copy
   that behavior. Review customer RHF submission/validation interaction before
   declaring every invalid-input workflow compliant; any shared behavior change
   needs focused form/reset/keyboard regressions, not silent stale-bound queries.
3. **Licensing features not yet built:** expiry/14-day Grace, strict Read-Only,
   recovery, real signing/issuance, quota-neutral replacement, archive/security
   protocols remain their existing PDR/OQ implementation scopes. Their future
   dates must follow this contract without changing validity Instants, roles,
   signatures, replay protection or recovery authorization merely for display.
4. **History/migrations:** any discovered legacy timestamp-day or semantic
   mismatch needs target-specific read-only aggregate audit, reviewed mapping,
   backup/backfill/rollback and disposable PostgreSQL rehearsal. No historical
   mutation or schema migration is approved/performed by this extension.
5. **Independent source boundary evolution:** changing the seven-file allowlist,
   imports, library versions or context requires tests/review of both builds and
   artifacts. Do not commit the projection, fall back to stale copies, widen
   Docker context or share settings/application runtime graphs.
6. **Broader localization/legal policy:** OQ-02 non-date numerals/money/text and
   legal profile statutory layouts/encodings remain independent product/expert
   questions, not blockers to the now-explicit Persian date/time display rule.
