# Date & Time Architecture (C-63 / ADR-0042)

The single contract for what a date, a timestamp and a calendar day mean in
Vardena, where each is stored, how each crosses the API, and how each is shown.
Every module follows it; no module invents its own conversion.

## 1. The model

| Concept                | Meaning                                                           | Stored as                                                                       | On the wire                                                          |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Instant**            | a point in time ("when it happened")                              | `timestamptz` (UTC)                                                             | ISO-8601 UTC string, e.g. `2026-10-08T08:32:14.421Z`                 |
| **Business date**      | the calendar DAY a document belongs to ("which day it counts as") | PostgreSQL `date` (canonical Gregorian day)                                     | canonical Gregorian `YYYY-MM-DD` + `{ gregorian, jalali }` rendering |
| **Local date-time**    | an instant expressed in a zone                                    | never stored                                                                    | `YYYY-MM-DD HH:mm:ss` (+ the zone name)                              |
| **Calendar rendering** | a day written in a calendar (`2026-10-08`, `1405/07/16`)          | never stored                                                                    | derived per response                                                 |

The derivation chain is **one-way**:

```
instant ──(IANA zone)──▶ local date/time ──(calendar)──▶ rendering
   ▲                                                        │
   └──────────────── never used as input ◀──────────────────┘
```

Three rules follow, and they are the ones reviewers check:

1. A **business date is never derived from an instant inside a business rule**.
   If a document is dated 1405-07-16, that is what is stored — independent of
   when the row was written.
2. An **instant is never overwritten by a rendering**. Local time is derived on
   the way out, in the zone the organization had at render time (§6), and is
   never written back.
3. **A business date is never an instant** (OQ-73). Days are stored in `date`
   columns and cross the wire as `YYYY-MM-DD`; no day is ever carried as a
   UTC-midnight timestamp, and no timestamp doubles as a day.

## 2. Persistence rules

- Timestamps: `@db.Timestamptz(6)`, UTC, columns named `*_at` (`created_at`,
  `updated_at`, `finalized_at`, `approved_at`, `cancelled_at`, `posted_at`).
  Audit/event semantics — including `valued_at`, `executed_at`,
  `posting_timestamp`, validity windows (`valid_from`/`valid_to`) and the
  valuation `as_of` — stay instants.
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
- **No formatted dates** are ever persisted (no `'1405/07/16'` column), and no
  parallel Jalali column is added for a date that already exists: the calendar
  is a rendering, and duplicate columns would let the two disagree.
- **Legacy normalization (migration `20261011000000_business_date_persistence`)**:
  every pre-OQ-73 day value was stored as a day's UTC-midnight instant, so the
  deterministic conversion policy is `(column AT TIME ZONE 'UTC')::date` — the
  stored UTC calendar day. That is byte-for-byte the day the old read path
  returned, so no row changes its business date, nothing is lost, and the
  migration is a pure type change plus the `last_movement_at` →
  `last_movement_date` rename (indexes rebuilt alongside).
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
"2026-10-08T08:30:00.000Z"                         // legacy ISO instant → collapses onto the day it falls on
                                                   //   in the organization's time zone
```

`YYYY-MM-DD` is the same SHAPE in both calendars, which is exactly why a Jalali
value must be declared: without `calendar`, `1405-12-30` would have to be
guessed (it is a valid Gregorian day and an invalid Jalali one). Rejections are
stable codes: `business_date_format`, `business_date_calendar`,
`business_date_declaration`. An omitted day defaults to TODAY in the
organization's time zone.

Frontend sends what the operator wrote: a Jalali organization sends the
declared form, so the request carries the calendar the user worked in.

## 4. Range and filter semantics

- **Business-date ranges: inclusive `[startDate, endDate]`** — a single-day
  filter is `startDate == endDate`. This matches Accounting's existing
  `date-range.ts` contract and needs no end-of-day arithmetic.
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
  or a declared Jalali day converts once; a legacy ISO instant collapses onto
  the day it falls on in the organization's time zone; an omitted day defaults
  to today in that zone. The carrier is a transport detail of the Prisma
  boundary — it is never rendered, zone-shifted or compared with time-of-day.
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
  - `time-zone.ts` / `instant.ts` — zone validity, and instant → local renderings
    (with the zone label);
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
- Formatters live in `lib/format.ts` (`formatDateOnly`/`formatDateTime`) and
  delegate to the layer; a component never imports `dayjs` or the Jalali library.
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
- Persistence coverage — business-day `date` columns, true date filtering, the
  backdated/replay/Kardex flows, and the accounting-posting day — runs in the
  live-database suites in CI only (`.github/workflows/ci.yml`), including the
  `20261011000000_business_date_persistence` migration; no local database,
  migration rehearsal or full suite is required to verify this slice.

## 11. Open items

- **OQ-02** — numeral rendering and the rest of localization stay open; the
  calendar default is now implementation-recorded (Jalali primary).
- ~~**OQ-73**~~ — **resolved**: every business-day column is PostgreSQL `date`
  (canonical Gregorian), instants stay `timestamptz`, and the legacy
  UTC-midnight-on-a-timestamp convention is retired. See ADR-0042 (status
  Accepted) and migration `20261011000000_business_date_persistence`.
- `frontend/src/api/generated/vardena-api.d.ts` is committed and is hand-kept
  in step with the backend OpenAPI; regenerate with `npm run api:types` against
  a running API to re-sync. Until then, `src/api/contracts.ts` carries
  documented refinements where the generated types lag the contract.
- Other modules (accounting document filters, reporting surfaces) adopt this
  layer as they are touched; this slice wires the organization settings, the
  Inventory business-document date, and the Inventory date fields.
