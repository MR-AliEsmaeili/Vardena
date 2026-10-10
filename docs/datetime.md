# Date & Time Architecture (C-63 / ADR-0042 / ADR-0044)

The single contract for what a date, a timestamp and a calendar day mean in
Vardena, where each is stored, how each crosses the API, and how each is shown.
Every module follows it; no module invents its own conversion.

**Permanent rule:** `BusinessDate` is a canonical Gregorian PostgreSQL `date`;
the MVP UI is fixed Jalali-first, with an explicit canonical-Gregorian fallback
when Jalali cannot render a valid historical day. `Instant` is a UTC PostgreSQL
`timestamptz`; display uses the organization's valid IANA time zone followed by
the fixed Jalali-first presentation policy. Use the shared kernel/frontend
date-time abstractions; do not reinterpret a business day as a JavaScript
`Date`, UTC-midnight transport, browser-zone value, or timestamp. Calendar
selection and calendar-transition workflows are not part of the MVP.

## 1. The model

| Concept                | Meaning                                                           | Stored as                                   | On the wire                                                                                             |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Instant**            | a point in time ("when it happened")                              | `timestamptz` (UTC)                         | ISO-8601 UTC string, e.g. `2026-10-08T08:32:14.421Z`                                                    |
| **Business date**      | the calendar DAY a document belongs to ("which day it counts as") | PostgreSQL `date` (canonical Gregorian day) | canonical Gregorian `YYYY-MM-DD`; derived `{ gregorian, jalali }` with `jalali: null` when unrenderable |
| **Local date-time**    | an instant expressed in a zone                                    | never stored                                | `YYYY-MM-DD HH:mm:ss` (+ the zone name)                                                                 |
| **Calendar rendering** | a day written in a calendar (`2026-10-08`, `1405/07/16`)          | never stored                                | derived per response                                                                                    |

The derivation chain is **one-way**:

```
instant ──(IANA zone)──▶ local date/time ──(calendar)──▶ rendering
   ▲                                                        │
   └──────────────── never used as input ◀──────────────────┘
```

Three rules follow, and they are the ones reviewers check:

1. A **business date is never derived from an instant inside a business rule**.
   If a document is dated 1405-07-16, that is what is stored — independent of
   when the row was written. The sole compatibility exception is an explicitly
   accepted legacy ISO-instant BusinessDate input at the API boundary; it
   resolves to that instant's UTC calendar day (§3), never the organization-zone
   day.
2. An **instant is never overwritten by a rendering**. Local time is derived on
   the way out, in the zone the organization had at render time (§6), and is
   never written back.
3. **A business date is never an instant** (OQ-73). Days are stored in `date`
   columns and cross the wire as `YYYY-MM-DD`; no day is ever carried as a
   UTC-midnight timestamp, and no timestamp doubles as a day.

## 2. Persistence rules

- Timestamps: `@db.Timestamptz(6)`, UTC, columns named `*_at` (`created_at`,
  `updated_at`, `finalized_at`, `approved_at`, `cancelled_at`, `posted_at`).
  Audit/event semantics — including `valued_at`, `executed_at` and
  `posting_timestamp` — stay instants. Inventory `asOf` query parameters resolve
  a canonical BusinessDate; valuation-run `from_date` is also a BusinessDate.
- Business days: `@db.Date` — PostgreSQL `date`, canonical Gregorian
  (`inventory.inventory_movements.movement_date`,
  `inventory.inventory_business_documents.business_date`,
  `inventory.inventory_valuation_runs.from_date`,
  `inventory.inventory_pricing_runs.from_date`/`to_date`,
  `inventory.inventory_accounting_posting_snapshots.document_date`,
  `accounting.document_date`, fiscal-period bounds,
  `inventory.inventory_balances.last_movement_date`). OQ-73 made this the only
  business-day carrier: the earlier "day riding a timestamptz column as its UTC
  midnight" convention is retired.
- **Inventory BusinessDate persistence cutover** (`20261011000000_business_date_persistence`):
  the base migration converts the existing Inventory day carriers and renames
  `last_movement_at`. Its SQL contains no explicit `BEGIN`/`COMMIT` and sets no
  `lock_timeout`; do not infer those guarantees from an earlier PR variant or
  from PostgreSQL DDL in general. Whether the installed Prisma Migrate runner
  makes this whole script atomic must be verified using the exact Prisma version
  against a disposable PostgreSQL database before any operational claim. The
  `ALTER TABLE ... TYPE` operations acquire strong locks and may block reads and
  writes; this is a breaking schema cutover, not a rolling/zero-downtime
  migration. Stop the previous API/worker and quiesce writes for the complete
  migration sequence, verify a restorable backup and rehearse against a
  target-like copy, then deploy the new application before resuming traffic.
  Prisma records each migration separately: if 110 commits but a later
  migration fails, keep the old application stopped, inspect
  `_prisma_migrations` and the actual schema, and complete an approved forward
  recovery; do not reverse-cast the data or blindly rerun the migration.
- **Inventory validity windows (Owner decision, 2026-10-09):**
  `unit_conversions.valid_from/valid_to`,
  `item_unit_conversions.valid_from/valid_to`, and
  `item_valuation_methods.valid_from/valid_to` are BusinessDate range bounds,
  not instants. They become PostgreSQL `date` in migration
  `20261012000000_inventory_business_date_validity_windows`; this decision does
  not reclassify other timestamp fields named `valid_*` in other domains.
  Their range is half-open `[valid_from, valid_to)` (`NULL` end is open), so
  adjacent versions may meet on the same business date without overlapping.
  The migration converts the UTC calendar day, reports discarded non-midnight
  UTC time components, and fails closed on collapsed/reversed windows,
  duplicate starts, overlap, and values outside the general four-digit
  BusinessDate/API range. It does not read `organization.calendar_system`, lock
  `organization.organizations`, or reject a valid Gregorian day because Jalali
  cannot render it; rendering remains a presentation concern with Gregorian
  fallback. It retains an explicit PostgreSQL transaction, a 10-second
  `lock_timeout`, and `SHARE ROW EXCLUSIVE` locks on the Inventory source tables
  read by preflight. Those locks conflict with concurrent
  `INSERT`/`UPDATE`/`DELETE` and remain held through all three type conversions
  and `COMMIT`: existing writers finish before preflight begins, while later
  writers wait until the migration commits. A lock timeout aborts the
  transaction rather than leave a partial conversion. The subsequent
  `ALTER TABLE ... TYPE date` statements require stronger table locks and may
  also block reads; schedule an authorized maintenance window, do not treat this
  as zero-downtime, and do not raise the timeout without operational review.

  Its aggregate-only, read-only target report is
  `backend/prisma/rehearsal/business-date-validity-windows/audit.sql`; run it
  after migration `20261011000000_business_date_persistence` and before this
  migration using a read-only connection. It returns counts by table/column,
  not IDs, organization keys, conversion factors, or business payloads. The
  audit is a point-in-time evidence report, not a lock or a guarantee against
  later writes; the migration repeats its authoritative preflight while holding
  the serialization locks. Deployment gate: review and retain that report plus
  the migration NOTICE; rehearse the exact migration on a fresh, restorable
  target-like copy; resolve any nonzero API-range, collapsed/reversed-window,
  duplicate-start, or overlap counts through an explicitly approved data repair
  and rerun
  the audit/rehearsal; and verify a recoverable backup before applying only
  through `prisma migrate deploy`. Before authorization, record the backup or
  PITR recovery-point identity and timestamp, restore it to an isolated
  target-like database, validate that restore, and retain its rehearsal/audit
  evidence. If the migration aborts before commit, keep deployment paused and
  verify all three validity columns remain `timestamptz`, no partial schema
  change was committed, and Prisma migration state is failed. Under DBA/owner
  authorization, mark it rolled back with Prisma's
  `migrate resolve --rolled-back 20261012000000_inventory_business_date_validity_windows`
  only after those checks; rerun the audit/rehearsal, resolve lock contention,
  then retry deployment. Never blindly rerun or edit `_prisma_migrations`. If a
  commit may have completed but deployment reports failure, inspect schema and
  migration metadata before taking action; mark it applied only if the converted
  schema and data are verified. For an incompatible committed result, recover
  from the verified pre-migration backup/PITR point in an isolated restore or
  use an explicitly approved forward repair; do not improvise a reverse cast.
  No production/shared database was audited or migrated by this work.

  The CI rehearsal proves the selected barrier with two PostgreSQL clients: it
  holds an uncommitted collapsed-window writer and verifies migration waits
  before preflight, then commits the bad row and verifies rejection leaves the
  source column as `timestamptz`; on the success path it pauses the test copy
  immediately before `COMMIT`, verifies a later writer is blocked, and verifies
  that writer succeeds against the converted `date` schema after commit. The
  exact standalone migration text is used for both lock-race cases and the
  successful conversion path. The other negative fixtures use the identical
  migration body with only `BEGIN`/`COMMIT` removed so they can run inside an
  outer rollback transaction; the pre-existing-writer rejection still executes
  the exact standalone SQL. Only the successful concurrency case inserts a
  test-only pre-commit sleep. Non-midnight UTC endpoint counts must be recorded and reviewed; they
  are not automatically an error because the approved mapping preserves their
  UTC day. The CI synthetic-fixture rehearsal is not evidence about any
  production or customer database; no historical-data safety claim is made
  without target-specific evidence.

- **Inventory date indexes (migration `20261013000000_inventory_business_date_history_indexes`):**
  retain `idx_movements_org_business_date` for
  `InventoryMovementsRepository.list` organization/date bounds and the six
  organization/valid-from/valid-to indexes for
  `UnitConversionsRepository.listGlobal/listForItem` and
  `ItemValuationMethodsRepository.findEffectiveVersionAt/list` `activeAt` /
  ordering paths. Remove the five
  indexes on `inventory_valuation_runs.from_date`, pricing-run `from_date` /
  `to_date`, `inventory_balances.last_movement_date`, and posting-snapshot
  `document_date`: current Inventory readers select these values but do not
  filter or sort by them. This is a code-path audit, not an `EXPLAIN` or a
  production-size performance claim; no calendar-transition history scan is
  part of the rationale.
- **No formatted dates** are ever persisted (no `'1405/07/16'` column), and no
  parallel Jalali column is added for a date that already exists: the calendar
  is a rendering, and duplicate columns would let the two disagree.
- **Legacy normalization (migration `20261011000000_business_date_persistence`)**:
  the SQL conversion `(column AT TIME ZONE 'UTC')::date` preserves the UTC
  calendar day of each value actually stored and discards time-of-day. That is
  the storage conversion contract; it does not, by itself, define how an old API
  timestamp request was interpreted. In the base runtime, the legacy ISO-input
  parser resolved the Instant in the organization's time zone, then the
  Inventory write helper stored the resulting day in a UTC-midnight carrier.
  For example, `2026-10-08T21:00:00Z` for `Asia/Tehran` became the BusinessDate
  `2026-10-09`, encoded as `2026-10-09T00:00:00Z`; migration 110 preserves that
  stored day. The current owner-approved compatibility input policy is UTC-day,
  so the PR parser changes this request behavior; it must not be described as
  unchanged legacy behavior or inferred from the migration cast. Direct/raw
  writers and the actual historical dataset remain uninspected, so this audit
  makes no customer-data safety claim. Retain target-specific read-only audit
  and isolated rehearsal evidence before deployment. The earlier PR-head variant
  (`c9a4561`) of migration 110's comment described arbitrary ISO instants as
  stored verbatim;
  that claim is not established by the standard runtime path examined here.
  The migration also renames `last_movement_at` to `last_movement_date`; indexes
  are rebuilt alongside the type changes.
- Historical migration `20261010000000_organization_datetime_settings`
  introduced `calendar_system` (`JALALI`) and `time_zone` (`Asia/Tehran`) with
  defaults. The former is now legacy and ignored by runtime policy; only the
  IANA time zone remains an organization setting. Do not rewrite the applied
  migration or drop its legacy column without an audited rollout plan.
- The kernel datetime layer (`backend/src/kernel/datetime/`) is framework-free
  and business-free (AR-06): calendars, zones, day/instant math and API shapes.
  The organization's IANA time zone is DATA; Jalali display is fixed product
  policy, not organization data.

## 3. API representation

**Event timestamp** — one shape, everywhere a timestamp is exposed with its
renderings:

```json
{
  "instant": "2026-10-08T08:32:14.421Z",
  "timeZone": "Asia/Tehran",
  "gregorian": "2026-10-08 12:02:14",
  "jalali": "1405-07-16 12:02:14"
}
```

`instant` is authoritative: the other three are derived and are for display.
Klass-level OpenAPI schemas: `kernel/datetime/api-date-time.dto.ts`
(`ApiInstantDto`, `ApiBusinessDateDto`, `DeclaredBusinessDateInputDto`).

**Business date** — `{ "gregorian": "2026-10-08", "jalali": "1405-07-16" }`, with
the Gregorian member canonical. `jalali` is derived and may be `null` when a
valid canonical Gregorian day is outside the reversible Jalali rendering range.
That valid day remains accepted and authoritative under the fixed policy; no
organization setting gates its storage or API representation. Canonical day
fields (`documentDate`, `businessDate`, `movementDate`, `lastMovementDate`, run
`fromDate`/`toDate`) remain plain `YYYY-MM-DD` strings; where a paired rendering
is exposed it is additive (`businessDateCalendar`).

**Business-date input** — three accepted forms, one meaning:

```jsonc
"2026-10-08"                                       // canonical Gregorian day (bare = Gregorian by contract)
{ "calendar": "JALALI", "value": "1405-07-16" }    // a DECLARED Jalali day
"2026-10-08T08:30:00.000Z"                         // legacy ISO instant → UTC calendar day, for compatibility only
```

The legacy `date-time` branch resolves to the UTC calendar day, regardless of
the offset written in the instant or the organization's display zone. This is
the owner-approved compatibility rule (2026-10-09), matching OQ-73's UTC-day
migration policy. The input's time-of-day is not written into the BusinessDate
column. If the request also contains a real event timestamp, that remains a
separate Instant field.

`YYYY-MM-DD` is the same SHAPE in both calendars, which is exactly why a Jalali
value must be declared: without `calendar`, `1405-12-30` would have to be
guessed (it is a valid Gregorian day and an invalid Jalali one). The shared
kernel parser returns stable reasons `business_date_format`,
`business_date_calendar`, and `business_date_declaration`. Inventory posting
application validation preserves parser reasons in its details where DTO shape
validation has not already rejected the request; Accounting currently maps
invalid body dates and day filters to its existing generic HTTP 400 contract, so
clients must not assume those detail codes are surfaced by every endpoint. An omitted
day defaults to TODAY in the organization's time zone where the operation
supports an omitted date.

The frontend uses fixed Jalali-first entry and sends the declared Jalali form
for dates the converter can render. If an existing valid canonical day lies
outside that envelope, the shared field switches automatically to a Gregorian
fallback and the request remains a bare canonical Gregorian string. This is not
a user-selectable calendar mode; external API and integration clients retain
both explicit Jalali and canonical Gregorian request forms.

The shared Jalali converter has a reversible rendering envelope of Gregorian
`0621-03-21` through `3798-12-31`, inclusive. The upstream algorithm can convert
some later Jalali-year-3177 days into Gregorian 3799, but those are rejected at
declared-Jalali input boundaries because they fall outside the supported
reverse-rendering range. Separately, canonical Gregorian BusinessDates use the
general API envelope `0001-01-01` through `9999-12-31`. Under ADR-0044, any valid
canonical Gregorian day outside the Jalali envelope remains accepted for all
organizations and its paired `jalali` rendering is `null`; the frontend shows
the canonical Gregorian value as a fallback. **Migration 120 and its current
target audit still apply the old Jalali bound using the legacy organization
column.** They contradict this runtime policy and remain an explicit deployment
blocker pending an applied-status/checksum review and an approved migration
plan. A PostgreSQL `date` outside the general API envelope remains invalid as
a canonical BusinessDate.

## 4. Range and filter semantics

- **BusinessDate filters: inclusive `[startDate, endDate]`** — a single-day
  filter is `startDate == endDate`. This matches Accounting's existing
  `date-range.ts` contract and needs no end-of-day arithmetic. This filter
  convention does not change effective-dated configuration windows.
- **Inventory validity windows: half-open `[valid_from, valid_to)`** — for
  `unit_conversions`, `item_unit_conversions`, and `item_valuation_methods`;
  `NULL` `valid_to` is open-ended. Adjacent versions may meet at the same date.
  They are BusinessDate ranges by the Owner decision (2026-10-09), not instant
  ranges. See §2 and migration
  `20261012000000_inventory_business_date_validity_windows`.
- **Instant ranges: half-open `[startInstant, endInstant)`** — a day's worth of
  instants is `[D 00:00, D+1 00:00)`; the `23:59:59.999` convention is banned
  (it silently drops the last second of a day).
- **Day filters are true date comparisons** over the `date` column:
  `movement_date >= 'D1'::date AND movement_date <= 'D2'::date` (equality for a
  single day). No instant arithmetic, no end-of-day bound, no row-side
  conversion — the client's Jalali day is converted to the canonical Gregorian
  day ONCE at the boundary, and the `date` column is compared directly, so the
  comparison stays index-friendly.
- **Queries stay index-friendly**: comparisons on the stored column only. A
  Jalali day is converted to the canonical Gregorian day ONCE, at the boundary;
  `format()`/string comparison on a Jalali rendering is never a query plan.

## 5. Organization date/time data

| Setting   | Column                                      | Default       | Validated by                                 |
| --------- | ------------------------------------------- | ------------- | -------------------------------------------- |
| `timeZone`| `organization.organizations.time_zone`      | `Asia/Tehran` | resolvable IANA id; numeric offsets rejected |

The Organization module owns only the organization's IANA time zone as
mutable date/time configuration. `calendar_system` is a legacy persisted
column: current application code ignores it, does not accept it on create or
update, and keeps the existing response field as the constant `JALALI` for
wire compatibility. There is no organization calendar selector, transition
endpoint, per-user calendar setting, or Inventory-specific calendar setting.

Cross-module time-zone reads go through the Organization module's public
`OrganizationsService.getDateTimeSettings(organizationId)` contract — an AR-07
reference read that asserts organization scope but demands no Organization
permission, because the caller has already authorized its own request. Read it
once per response and derive every Instant rendering from that one value, so a
response cannot mix time-zone versions. BusinessDate persistence and comparison
remain organization-independent Gregorian `date` operations.

Inventory retains its ordinary module-local transaction, row-lock,
idempotency, and balance-rebuild boundaries. None takes or waits on an
Organization calendar lock; no calendar history scan or renderability check is
part of the write path. The transition-only coordination described in the
historical body of ADR-0043 is superseded by ADR-0044, without changing
unrelated concurrency controls.

## 6. Historical display policy

Rendering is a view; the canonical BusinessDate/Instant is the fact.

- BusinessDates render Jalali-first using the current shared converter. If a
  valid historical Gregorian day lies outside its rendering envelope, show the
  canonical Gregorian value; do not reject, rewrite, or hide it.
- Instants render in the organization's current IANA time zone, followed by the
  fixed Jalali-first date presentation. Detail/audit surfaces name the zone
  (`Asia/Tehran (UTC+03:30)`) and show seconds; the authoritative ISO instant
  remains on the payload.
- No calendar-setting history or rendering snapshot is retained. A display is
  never audit evidence; the raw canonical day/instant remains available for
  reconciliation.

## 7. Inventory semantics

- `businessDate` is the document's **business day**; `createdAt`/`updatedAt`/
  `finalizedAt`/`accountingPostedAt`/`sealedAt`/`cancelledAt` are **event
  instants**. A backdated document keeps its business date — the day is never
  moved to the write time (verified by unit tests, not by inspection). The day
  and the creation instant are separate columns and never conflated (OQ-73).
- Day input resolves to a PostgreSQL `date` carrier: a canonical Gregorian day
  or a declared Jalali day converts once; the explicitly accepted legacy ISO
  instant compatibility branch resolves to its UTC calendar day (Owner decision,
  2026-10-09), never the organization-zone day; an omitted day defaults to today
  in the organization's time zone. The carrier is a transport detail of the
  Prisma boundary — it is never rendered, zone-shifted or compared with
  time-of-day.
- **Effective-dated configuration** uses BusinessDate ranges for Inventory unit
  conversions (global and item-specific) and item valuation methods. Each row is
  effective on `valid_from` and ceases at the exclusive `valid_to`; a null end
  is open. Replay resolves a method/conversion against the movement's business
  date, not an Instant. Other modules' validity axes remain governed by their
  own accepted contracts.
- Documents carry the day's ledger value as `movement_date` (`date`), and the
  balance projection keeps `last_movement_date` (`date`) — the rename from
  `last_movement_at` is part of the OQ-73 migration.
- The Kardex orders strictly by (business day, entry time, id) and filters the
  day column with inclusive `date` bounds; valuation/pricing replay and the
  backdating rules operate on the same day column
  (`domain/backdating.ts` decides what a backdated edit means:
  `inventory.backdated_document`, `inventory.repricing_choice_required`,
  explicit repricing choice).
- Responses add `businessDateCalendar`, `createdAtCalendar`, `updatedAtCalendar`
  (derived once per response); canonical day fields are plain `YYYY-MM-DD`.

## 8. Accounting and audit

`document_date` is the reporting axis and `posting_timestamp` the event axis
(OQ-43/Q14) — the two must never be conflated. `document_date` is a `date`
with inclusive ranges (`accounting/domain/date-range.ts`), and that contract is
unchanged. Displaying statutory reports in Jalali is a Legal Profile concern
(ADR-0036) and not decided here.

## 9. Frontend

- `src/lib/datetime/` is the whole layer:
  - `calendar.ts` — the ONLY importer of the Jalali library; conversion,
    validation, leap years;
  - `numerals.ts` — digit conversion, deliberately separate from calendars
    (Persian-numeral rendering is a pending preference, OQ-02);
  - `dayjs.ts` — the ONE Day.js configuration (plugins registered once);
  - `time-zone.ts` / `instant.ts` — valid IANA-zone handling and Instant →
    organization-zone local rendering followed by fixed Jalali-first
    rendering. Wire Instants must be valid UTC `Z` values; naive, malformed, or
    offset-bearing values are not parsed in the browser zone: display formatters
    preserve them raw, while day/offset helpers reject them. Detail/audit
    formatting includes seconds and the resolved IANA zone plus that instant's
    UTC offset;
  - `business-date.ts` — canonical days, today in the organization's zone, day
    input resolution; a business day is NEVER reinterpreted as an instant or
    shifted by the browser's timezone (OQ-73);
  - `settings.ts` + `use-date-time-settings.ts` — the active organization's
    IANA time zone as an external store; there is no calendar setting;
  - `api-mapping.ts` — the `{ gregorian, jalali|null }` / `{ instant, … }`
    boundary and the fixed Jalali-first declared-day request form, with
    canonical Gregorian fallback when the converter cannot render a day.
- **One** shared BusinessDate field: `src/ui/patterns/date-input.tsx`. It always
  uses a Jalali text field (`1405/07/16`, Persian digits accepted) for supported
  dates and emits a canonical Gregorian day. For a valid historical day outside
  the Jalali envelope it automatically switches to a native Gregorian fallback;
  that is range handling, not a user or organization calendar choice. No screen
  builds its own date picker.
- Formatters live in `lib/format.ts` (`formatDateOnly`, `formatDateTime`, and
  the explicit-zone detail/audit formatter) and delegate to the shared layer; a
  component never imports `dayjs` or a Jalali conversion library. For an
  Instant, convert to the organization's IANA zone first, then render that
  local day in the fixed Jalali-first policy; never format the UTC or
  browser-local day as a shortcut.
- Detail/audit Instant views show seconds and an explicit resolved IANA zone and
  offset. Where helpful, raw ISO timestamps and canonical Gregorian dates remain
  available as tooltips for reconciliation.
- Panels that show Jalali days pair them with the canonical Gregorian value for
  reconciliation.

## 10. Testing

- Backend: `kernel/datetime/datetime.spec.ts` (round trips, boundaries, leap
  years, invalid days, DST-dependent offsets, half-open ranges, nullable
  renderings, API shapes, and the timezone-independent day ⇄ `date` carrier
  round trip), inventory document specs (Jalali day ≡ Gregorian day, backdated
  day ≠ creation instant), organization specs (IANA-zone defaults, fixed
  `JALALI` compatibility output, rejection of calendar-setting writes).
- Frontend: `lib/datetime/datetime.test.ts` and
  `ui/patterns/date-input.test.tsx` (round trips, leap years, typed Jalali input,
  Persian digits, canonical emission, ignoring stale calendar data, and
  automatic Gregorian fallback for unrenderable history).
- Backend tests cover the BusinessDate parser's legacy-instant UTC-day
  compatibility (including organization-zone boundaries), valid and out-of-range
  declared-Jalali inputs, canonical Gregorian dates outside the Jalali envelope
  with nullable derived renderings for both BusinessDates and Instants, rejection
  outside the general API range, DTO declarations, and Accounting/Inventory
  consumers. Frontend tests cover nullable API mapping, fixed Jalali input,
  canonical URL/filter values, impossible Gregorian dates, historical Gregorian
  fallback, and Instant rendering across UTC/local-day boundaries; malformed,
  naive, and offset-bearing wire Instants are preserved/rejected by the
  formatter, day, and offset helpers rather than browser-zone parsed.
- PostgreSQL conversion rehearsal:
  `backend/prisma/rehearsal/business-date-validity-windows/rehearse.mjs` uses a
  local PostgreSQL server to create a uniquely named disposable database,
  applies the current validity-window migration to representative synthetic
  fixtures, verifies UTC-day conversion/adjacency/open-ended ranges, retains a
  valid Gregorian year-0600 day outside the Jalali rendering envelope, and
  preserves audit Instants. It expects collapsed/reversed, duplicate-start,
  overlapping, and `10000-01-01` outside the general API range to fail. Its
  minimal fixture
  has no Organization calendar schema, so it guards against reintroducing a
  `calendar_system` dependency; it is not a full customer-schema snapshot.
  The script refuses non-local hosts and pre-existing database names; it never
  drops or reuses a database it did not create. CI runs it against its ephemeral
  PostgreSQL 16 service (`.github/workflows/ci.yml`), whose `migrate deploy` also
  applies the complete migration set to a temporary database. Neither check
  establishes shared/staging apply/checksum history or customer-data safety.
  The aggregate-only target report is
  `backend/prisma/rehearsal/business-date-validity-windows/audit.sql`; retain
  target-specific read-only audit and authorized backup/recovery evidence before
  deployment.

## 11. Open items

- **OQ-02** — Persian-numeral rendering, primary UI language(s), and broader
  localization remain open. The BusinessDate/Instant distinction and IANA-zone
  behavior are accepted in ADR-0042; the fixed Jalali-first MVP presentation is
  decided in ADR-0044, not stored as organization data.
- ~~**OQ-73**~~ — **resolved**: every business-day column is PostgreSQL `date`
  (canonical Gregorian), instants stay `timestamptz`, and the legacy
  UTC-midnight-on-a-timestamp convention is retired. See ADR-0042 (Accepted),
  migration `20261011000000_business_date_persistence`, and the 2026-10-09
  Owner decision/migration `20261012000000_inventory_business_date_validity_windows`
  for Inventory conversion and valuation validity ranges. The latter migration's
  fixture rehearsal is not customer-data evidence.
- `frontend/src/api/generated/vardena-api.d.ts` is generated from the Nest
  Swagger `/api/docs-json` document with `npm run api:types`; this audit
  refreshed it from the built backend's actual `SwaggerModule` output (192
  paths, 260 schemas) and reviewed the date-related DTO/query declarations
  against their controllers. The audit confirmed that reusing
  `PaginatedResponseClass` had caused last-writer-wins item schemas across list
  operations; `paginatedResponseOf()` now assigns a model-specific schema name,
  and a regression test verifies distinct item references. There is no longer a
  pagination-schema collision in the generated document. `src/api/contracts.ts`
  retains only documented refinements for Swagger type-introspection omissions;
  its BusinessDate aliases match the generated unions. Swagger bootstrap logged
  that Prisma Client was not generated and skipped permission-registry sync;
  this output therefore verifies DTO/schema generation, not database behavior.
- The audited paths include the Organization IANA time-zone contract,
  Accounting BusinessDate inputs/filters/reports, Inventory movement/document/
  valuation/configuration date paths, and shared frontend date inputs/formatters;
  this is a path audit, not an assertion of exhaustive cross-module coverage.
  Migration 120's legacy calendar-range gate has been removed from the PR SQL,
  but target apply/checksum history remains unverified as described above. This
  is not permission to assume an unaudited future
  DTO or consumer is correct: date/time changes must use the checklist in
  `.vardena/agent-rules.md` AG-20 and verify the complete execution path.
