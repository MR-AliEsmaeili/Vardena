# Task 22 — Formal Acceptance Record

- **Task:** Task 22 — Frontend Vertical Slice (Login → Session → RTL Shell → Organization Context → Accounting Read Surfaces)
- **Decision:** **ACCEPTED**
- **Acceptance date:** 2026-09-26
- **Acceptance authority:** Repository Owner, by Owner-authorized formal acceptance synchronization
- **Implementation PR:** [#62](https://github.com/MR-Ali-Esmaeili/Vardena/pull/62)
- **Implementation branch:** `arena/01a0ded9-vardena`
- **Implementation head:** `772bdbb1b851c48bd8e9a03378a24e131e5a7333` (`772bdbb`)
- **Merged PR evidence:** PR #62 merged in `b0d9337d11d9241a9a8d0641af5dacd7d5362e20`

## Acceptance status

**Task 22 — ACCEPTED.**

This record is an Owner-authorized formal acceptance synchronization. Acceptance is
attributed to the Repository Owner; Arena Agent does not self-accept the task.

## Scope accepted

The accepted scope is exactly the bounded frontend vertical slice delivered by PR #62:

- Login, logout, server-backed session state, protected routes, and session-expiry handling using the existing Identity contract.
- A responsive RTL application shell with navigation and session/user context.
- Organization context from the existing organizations endpoint: a single effective organization is shown without an unnecessary switcher, while multiple organizations can be selected in frontend memory only.
- Effective-permission, exact-match UX gating sourced from the existing backend contract; frontend checks are not an authorization boundary.
- Accounting read-only surfaces: **Chart Tree, Account Statement, General Ledger, and Trial Balance**.

The accounting surfaces use the existing APIs. The Chart Tree transformation is presentation-only;
server-side filtering, paging, and endpoint-permitted sorting are preserved; and decimal amounts
remain exact API values/strings. No accounting amounts or domain rules are calculated in the
frontend.

## Architecture and security verification

Repository review reconciled the implementation with the accepted architecture and governance
records:

- React + TypeScript + Vite, Tailwind, shadcn/ui-style primitives, React Router, TanStack Query,
  Axios, React Hook Form + Zod, TanStack Table, and Day.js are used; Task 22 introduced no
  global client store. This is historical acceptance evidence, not a continuing ban; current
  state-management policy is `docs/frontend/standards.md` §۵.
- Session authentication uses the existing httpOnly-cookie Identity contract. No token is persisted
  in `localStorage` or `sessionStorage`.
- Organization selection is frontend context only. Backend organization membership and authorization
  remain authoritative.
- Effective permissions come from the existing endpoint, use exact matching, and introduce no
  wildcard mechanism or frontend authorization bypass.
- No backend modular-monolith behavior, API contract, schema, migration, permission behavior, or
  authentication behavior was changed by Task 22.
- No Task 23 implementation or Base Chart capability was introduced.

Task 21 remains **ACCEPTED (2026-09-26)**. Task 19 and Task 20 remain accepted and unchanged.
Their decisions and boundaries are not reopened or altered by this record.

## Verification evidence

The repository and PR evidence supporting acceptance are:

- PR #62 is merged and its final GitHub CI run **`36263398518`** is successful:
  - `frontend` job: **SUCCESS**
  - `backend` job: **SUCCESS**, including the configured live-PostgreSQL E2E coverage
- The final frontend CI gates passed: lint, typecheck, format check, tests, and production build.
- The recorded frontend tests passed (**11 files / 63 tests**), and the recorded frontend production
  build passed.
- The earlier frontend formatting failure was corrected before the final successful CI run; it is
  not an acceptance blocker.
- The recorded backend CI passed its existing Prisma, lint, typecheck, format, unit, build,
  migration-rehearsal, and live-PostgreSQL E2E gates. No expensive local live-database E2E was
  rerun for this documentation-only synchronization.
- Static review of the current merged repository confirms the Task 22 diff contains no backend
  production implementation and no accounting write UI, unrelated module UI, export/reporting
  capability, or Task 23 implementation.

## Explicit exclusions

Acceptance does **not** authorize or implement:

- Base Chart implementation or adoption (Task 23)
- Control Roles
- Dimensions
- Accounting create, edit, post, finalize, or other write surfaces
- Inventory UI
- Workflow UI
- RBAC administration UI
- Treasury UI
- Documents UI
- Reporting or export functionality
- Notification system
- Unrelated backend capabilities or architecture changes

At the time of this acceptance, Task 23 was a **separate subsequent task**
and was not part of Task 22's accepted scope. Its later implementation status
is recorded in `STATE.md` and `docs/accounting/task-index.md`; that later work
does not broaden this Task 22 acceptance.

## Open items preserved

The following remain follow-ups and are not resolved or closed by this acceptance:

- **OQ-02:** UI language and Jalali date behavior remain OPEN. Task 22 does not claim that this
  decision has been made; dates remain displayed according to the documented current contract.
- **Organization-context follow-up:** the documented case where a principal lacks
  `Organization.Organization.View` while still needing organization context remains open. No
  self-service organization-context solution is invented here.
- **OpenAPI annotation/documentation gaps:** the previously recorded generated-schema gaps remain
  follow-ups. They are not fixed or closed by this acceptance.
- **Frontend Docker/Compose integration:** remains a separate follow-up; no Docker/Compose
  integration was added.
- The implementation report's other explicitly recorded follow-ups, including the security-document
  wording discrepancy and customization/grid-state persistence, remain follow-ups unless accepted
  independently elsewhere.

No existing Open Question is closed, including OQ-25, OQ-36, OQ-41, and OQ-43. No ADR is
promoted. No Base Chart content, control-role catalog, accounting policy, or other unresolved
business rule is invented.

## Production-change statement

> This acceptance record does not itself authorize or introduce any production implementation,
> schema, migration, API, permission, authorization, dependency, frontend capability, or test
> behavior change.

This record is documentation/governance only. It changes no production behavior and does not
authorize follow-up implementation work.

## Related records

- [Task 22 implementation report](./task-22-implementation-report.md)
- [Task 21 acceptance record](../task-21/task-21-acceptance-record.md)
- [Task 20 acceptance record](../task-20/task-20-acceptance-record.md)
- [Task 19 acceptance record](../task-19/task-19-acceptance-record.md)
- [Project state](../../../STATE.md)
- [Architecture](../../architecture.md)

**Task 22 — Frontend Vertical Slice — ACCEPTED under Owner-authorized formal acceptance synchronization.**

## Later date/time clarification (2026-10-09)

This acceptance record remains a historical snapshot of Task 22 and PR #62; its
statement above that OQ-02's Jalali date behavior was open was accurate on
2026-09-26. Owner-accepted ADR-0042 (2026-10-09) subsequently resolved the
generic BusinessDate/Instant contract: BusinessDates are canonical Gregorian
PostgreSQL `date` values with organization-calendar input/display (Jalali by
default), while Instants remain UTC `timestamptz` values rendered in the
organization's valid IANA zone and calendar. The present audit separately
verifies the current shared frontend paths; this later decision does not imply
that PR #62 implemented them. OQ-02 remains open for primary UI language,
Persian-numeral preference, and broader localization, not for the generic
date/time contract. See ADR-0042, `docs/datetime.md`, and the resolved OQ-73
entry in `docs/open-questions.md`.
