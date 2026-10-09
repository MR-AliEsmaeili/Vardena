# Date & Time Architecture (C-63 / ADR-0042)

The single contract for what a date, a timestamp and a calendar day mean in
Vardena, where each is stored, how each crosses the API, and how each is shown.
Every module follows it; no module invents its own conversion.

**Permanent rule:** `BusinessDate` is a canonical Gregorian PostgreSQL `date`;
user-facing input and display follow the organization's configured calendar
(Jalali by default). `Instant` is a UTC PostgreSQL `timestamptz`; display follows
the organization's configured valid IANA time zone and calendar. Use the shared
kernel/frontend date-time abstractions; do not reinterpret a business day as a
JavaScript `Date`, UTC-midnight transport, browser-zone value, or timestamp.

## 1. The model

| Concept                | Meaning                                                           | Stored as                                   | On the wire                                                          |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| **Instant**            | a point in time ("when it happened")                              | `timestamptz` (UTC)                         | ISO-8601 UTC string, e.g. `2026-10-08T08:32:14.421Z`                 |
| **Business date**      | the calendar DAY a document belongs to ("which day it counts as") | PostgreSQL `date` (canonical Gregorian day) | canonical Gregorian `YYYY-MM-DD` + `{ gregorian, jalali }` rendering |
| **Local date-time**    | an instant expressed in a zone                                    | never stored                                | `YYYY-MM-DD HH:mm:ss` (+ the zone name)                              |
| **Calendar rendering** | a day written in a calendar (`2026-10-08`, `1405/07/16`)          | never stored                                | derived per response                                                 |

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
  duplicate starts, overlap, and unrepresentable values. Its aggregate-only,
  read-only target report is
  `backend/prisma/rehearsal/business-date-validity-windows/audit.sql`; run it
  after migration `20261011000000_business_date_persistence` and before this
  migration using a read-only connection. It returns counts by table/column,
  not IDs, organization keys, conversion factors, or business payloads.
  Deployment gate: review and retain that report plus the migration NOTICE;
  rehearse the exact migration on a fresh, restorable target-like copy; resolve
  any nonzero invalid-range/collision/overlap/unrepresentable counts through an
  explicitly approved data repair and rerun the audit/rehearsal; and verify a
  recoverable backup before applying only through `prisma migrate deploy`.
  Non-midnight UTC endpoint counts must be recorded and reviewed; they are not
  automatically an error because the approved mapping preserves their UTC day.
  The CI synthetic-fixture rehearsal is not evidence about any production or
  customer database; no historical-data safety claim is made without
  target-specific evidence.
- **No formatted dates** are ever persisted (no `'1405/07/16'` column), and no
  parallel Jalali column is added for a date that already exists: the calendar
  is a rendering, and duplicate columns would let the two disagree.
- **Legacy normalization (migration `20261011000000_business_date_persistence`)**:
  the conversion policy is `(column AT TIME ZONE 'UTC')::date`, which preserves
  the UTC calendar day the old read path exposed for each value actually stored
  and deliberately discards time-of-day. A separate baseline-path check found
  that the former legacy ISO-input parser first resolved the submitted Instant
  in the organization zone, then the standard Inventory write helper converted
  the resulting BusinessDate to a UTC-day carrier before persistence. That
  standard path does **not** substantiate migration 110's comment that ISO
  instants were stored verbatim. The current owner-approved compatibility input
  policy is UTC-day (2026-10-09); its behavior change is distinct from the
  migration's conversion of stored values. Do not edit the merged migration;
  alternate/raw writers and the actual historical dataset remain uninspected.
  This audit therefore does not claim customer-data safety. Retain evidence from
  a rehearsal/preflight against the target's actual history before deployment.
  The migration also renames `last_movement_at` to `last_movement_date`; indexes
  are rebuilt alongside the type changes.
- Migrations that introduce settings carry **safe defaults** for existing rows
  (`JALALI`, `Asia/Tehran`): defaults affect rendering only, so no stored fact
  moves (`prisma/migrations/20261010000000_organization_datetime_settings`).
- The kernel datetime layer (`backend/src/kernel/datetime/`) is framework-free
  and business-free (AR-06): calendars, zones, day/instant math and the API
  shapes. Which calendar an organization uses is DATA (its row), not code.

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
the Gregorian member canonical. Canonical day fields (`documentDate`,
`businessDate`, `movementDate`, `lastMovementDate`, run `fromDate`/`toDate`)
are plain `YYYY-MM-DD` strings on the wire; where a paired rendering is exposed
it is additive (`businessDateCalendar`).

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
guessed (it is a valid Gregorian day and an invalid Jalali one). Rejections are
stable codes: `business_date_format`, `business_date_calendar`,
`business_date_declaration`. An omitted day defaults to TODAY in the
organization's time zone.

Frontend sends what the operator wrote: a Jalali organization sends the
declared form, so the request carries the calendar the user worked in.

The kernel and frontend use a reversible Jalali/API rendering envelope of
Gregorian `0621-03-21` through `3798-12-31`, inclusive. The upstream algorithm
can convert some later Jalali-year-3177 days into Gregorian 3799, but Vardena
rejects those inputs in both converters because they fall outside the supported
reverse-rendering range. The Inventory migration preflight uses these same
bounds for Jalali-calendar rows (and for its always-paired business-document
dates); a PostgreSQL `date` being storable does not by itself make it
representable in the organization's configured calendar.

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

## 5. Organization settings

| Setting          | Column                                       | Default       | Validated by                                 |
| ---------------- | -------------------------------------------- | ------------- | -------------------------------------------- |
| `calendarSystem` | `organization.organizations.calendar_system` | `JALALI`      | closed list `GREGORIAN \| JALALI`            |
| `timeZone`       | `organization.organizations.time_zone`       | `Asia/Tehran` | resolvable IANA id; numeric offsets rejected |

They are exposed on the existing organization DTOs (create/update accept them;
`GET /organizations/mine` and `GET /organizations/:id` return them). Cross-module
reads go through `OrganizationsService.getDateTimeSettings(organizationId)` —
an AR-07 reference read that asserts organization scope but demands no
Organization permission, because the caller has already authorized its own
request. Read it **once per response** and derive every rendering from that one
value, so a response cannot mix two settings versions.

Changing the settings is a presentation change: it re-renders history, it never
rewrites it.

## 6. Historical display policy (decided: A)

Of the three candidates — (A) render with the current organization settings,
(B) resolve the settings that were stored at the record's timestamp, (C) snapshot
the rendering onto the record — **Vardena uses (A)**:

- the stored instant/day is the fact; the rendering is a view;
- settings history is not retained, so (B) would require a new history table for
  a purely presentational feature, and (C) would freeze a display value that the
  user may legitimately want changed;
- to keep a rendering from being mistaken for evidence, detail and audit
  surfaces name the zone they rendered in (`Asia/Tehran (UTC+03:30)`) and show
  seconds; the authoritative value (`createdAt`) stays on the payload.

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
    organization-zone local rendering followed by organization-calendar
    rendering. Wire Instants must be valid UTC `Z` values; naive, malformed, or
    offset-bearing values are not parsed in the browser zone: display formatters
    preserve them raw, while day/offset helpers reject them. Detail/audit
    formatting includes seconds and the resolved IANA zone plus that instant's
    UTC offset;
  - `business-date.ts` — canonical days, today in the organization's zone, day
    input resolution; a business day is NEVER reinterpreted as an instant or
    shifted by the browser's timezone (OQ-73);
  - `settings.ts` + `use-date-time-settings.ts` — the active organization's
    settings as an external store (components, form defaults and API mapping all
    read the same value);
  - `api-mapping.ts` — the `{ gregorian, jalali }` / `{ instant, … }` boundary
    and the declared-day request form.
- **One** calendar-aware field: `src/ui/patterns/date-input.tsx`. It shows a
  native date input for a Gregorian organization and a Jalali text field
  (`1405/07/16`, Persian digits accepted) for a Jalali one, and always emits the
  canonical Gregorian day. No screen builds its own Jalali picker.
- Formatters live in `lib/format.ts` (`formatDateOnly`, `formatDateTime`, and
  the explicit-zone detail/audit formatter) and delegate to the shared layer; a
  component never imports `dayjs` or a Jalali conversion library. For an
  Instant, convert to the organization's IANA zone first, then render that
  local day in the organization's configured calendar; never format the UTC or
  browser-local day as a shortcut.
- Detail/audit Instant views show seconds and an explicit resolved IANA zone and
  offset. Where helpful, raw ISO timestamps and canonical Gregorian dates remain
  available as tooltips for reconciliation.
- Panels that show Jalali days pair them with the canonical Gregorian value for
  reconciliation.

## 10. Testing

- Backend: `kernel/datetime/datetime.spec.ts` (round trips, boundaries, leap
  years, invalid days, DST-dependent offsets, half-open ranges, API shapes, and
  the timezone-independent day ⇄ `date` carrier round trip), inventory document
  specs (Jalali day ≡ Gregorian day, backdated day ≠ creation instant),
  organization settings specs (defaults, closed vocabulary, refusals).
- Frontend: `lib/datetime/datetime.test.ts` and `ui/patterns/
date-input.test.tsx` (round trips, leap years, typed Jalali input, Persian
  digits, canonical emission, organization defaults).
- Backend tests cover the BusinessDate parser's legacy-instant UTC-day
  compatibility (including organization-zone boundaries), invalid Gregorian
  days, DTO declarations, and the Accounting/Inventory date consumers. Frontend
  tests cover Jalali input conversion, canonical URL/filter values, impossible
  Gregorian dates, and Instant rendering across UTC/local-day boundaries;
  malformed, naive, and offset-bearing wire Instants are preserved/rejected by
  the formatter, day, and offset helpers rather than browser-zone parsed.
- PostgreSQL conversion rehearsal:
  `backend/prisma/rehearsal/business-date-validity-windows/rehearse.mjs` uses a
  local PostgreSQL server to create a uniquely named disposable database,
  applies the real validity-window migration to representative synthetic
  fixtures, verifies UTC-day conversion/adjacency/open-ended ranges and
  unchanged audit Instants, and expects collapsed/reversed, duplicate-start,
  overlap, and unrepresentable-value cases to fail. It refuses non-local hosts
  and any pre-existing database name; it never drops or reuses a database it did
  not create. CI runs it against its ephemeral PostgreSQL 16 service
  (`.github/workflows/ci.yml`). The aggregate-only target report is
  `backend/prisma/rehearsal/business-date-validity-windows/audit.sql`. The
  fixture is not a customer/production snapshot and does not prove a target
  dataset is safe; retain target-specific audit, rehearsal, backup, and recovery
  evidence before deployment.

## 11. Open items

- **OQ-02** — Persian-numeral rendering, primary UI language(s), and broader
  localization remain open. The BusinessDate/Instant distinction, organization
  calendar default, and IANA-zone behavior are accepted in ADR-0042; Jalali is
  the organization default, not a per-screen assumption.
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
- The implemented paths include Organization settings, Accounting BusinessDate
  inputs/filters/reports, Inventory movement/document/valuation/configuration
  date paths, and shared frontend date inputs/formatters. This is not permission
  to assume an unaudited future DTO or consumer is correct: date/time changes
  must use the checklist in `.vardena/agent-rules.md` AG-20 and verify the
  complete execution path.
