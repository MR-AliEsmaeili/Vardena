# Date & Time Architecture (C-63 / ADR-0042)

The single contract for what a date, a timestamp and a calendar day mean in
Vardena, where each is stored, how each crosses the API, and how each is shown.
Every module follows it; no module invents its own conversion.

## 1. The model

| Concept                | Meaning                                                           | Stored as                                                                       | On the wire                                                          |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Instant**            | a point in time ("when it happened")                              | `timestamptz` (UTC)                                                             | ISO-8601 UTC string, e.g. `2026-10-08T08:32:14.421Z`                 |
| **Business date**      | the calendar DAY a document belongs to ("which day it counts as") | PG `date`, or a day's UTC-midnight instant where a day rides a timestamp column | canonical Gregorian `YYYY-MM-DD` + `{ gregorian, jalali }` rendering |
| **Local date-time**    | an instant expressed in a zone                                    | never stored                                                                    | `YYYY-MM-DD HH:mm:ss` (+ the zone name)                              |
| **Calendar rendering** | a day written in a calendar (`2026-10-08`, `1405/07/16`)          | never stored                                                                    | derived per response                                                 |

The derivation chain is **one-way**:

```
instant ──(IANA zone)──▶ local date/time ──(calendar)──▶ rendering
   ▲                                                        │
   └──────────────── never used as input ◀──────────────────┘
```

Two rules follow, and they are the ones reviewers check:

1. A **business date is never derived from an instant inside a business rule**.
   If a document is dated 1405-07-16, that is what is stored — independent of
   when the row was written.
2. An **instant is never overwritten by a rendering**. Local time is derived on
   the way out, in the zone the organization had at render time (§6), and is
   never written back.

## 2. Persistence rules

- Timestamps: `@db.Timestamptz(6)`, UTC, columns named `*_at` (`created_at`,
  `updated_at`, `finalized_at`, `approved_at`, `cancelled_at`, `posted_at`).
- Business days: `@db.Date` when the column exists for that purpose
  (`accounting.document_date`). Where the day rides an existing, indexed
  `timestamptz` column (`inventory.inventory_business_documents.business_date`,
  `inventory.inventory_movements.movement_date`), the day's canonical value is
  `{YYYY-MM-DD}T00:00:00.000Z` — the day's **UTC midnight**, so the day can
  never shift with a zone. The typing question is registered as OQ-73.
- **No formatted dates** are ever persisted (no `'1405/07/16'` column), and no
  parallel Jalali column is added for a date that already exists: the calendar
  is a rendering, and duplicate columns would let the two disagree.
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
the Gregorian member canonical. Existing canonical fields (`documentDate`,
`businessDate`) keep their meaning: `businessDate` stays the stored value, and
the paired rendering is additive (`businessDateCalendar`).

**Business-date input** — three accepted forms, one meaning:

```jsonc
"2026-10-08"                                       // canonical Gregorian day (bare = Gregorian by contract)
{ "calendar": "JALALI", "value": "1405-07-16" }    // a DECLARED Jalali day
"2026-10-08T00:00:00.000Z"                         // legacy instant, kept verbatim (existing clients)
```

`YYYY-MM-DD` is the same SHAPE in both calendars, which is exactly why a Jalali
value must be declared: without `calendar`, `1405-12-30` would have to be
guessed (it is a valid Gregorian day and an invalid Jalali one). Rejections are
stable codes: `business_date_format`, `business_date_calendar`,
`business_date_declaration`.

Frontend sends what the operator wrote: a Jalali organization sends the
declared form, so the request carries the calendar the user worked in.

## 4. Range and filter semantics

- **Business-date ranges: inclusive `[startDate, endDate]`** — a single-day
  filter is `startDate == endDate`. This matches Accounting's existing
  `date-range.ts` contract and needs no end-of-day arithmetic.
- **Instant ranges: half-open `[startInstant, endInstant)`** — a day's worth of
  instants is `[D 00:00, D+1 00:00)`; the `23:59:59.999` convention is banned
  (it silently drops the last second of a day).
- **Day filters over timestamp-backed day columns** use the inclusive bounds of
  the day instant: `movement_date >= 'D T00:00:00.000Z' AND movement_date <= 'D
T00:00:00.000Z'` — correct for every row written through the API, because
  such rows carry the day's UTC midnight (§2). Clients that omit an explicit
  day get the server's `now` default, which is not midnight and therefore may
  fall outside a day filter — send the day.
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
  moved to the write time (verified by unit tests, not by inspection).
- Day input is normalized to the day's UTC-midnight instant; a legacy ISO
  instant is preserved verbatim; an omitted day keeps the historical `now`
  default (clients are expected to send an explicit day).
- Documents carry the day's ledger value as `movement_date`, which is why the
  day on the ledger is the UTC day of the stored instant (§2/OQ-73).
- Backdating rules are untouched by C-63: `domain/backdating.ts` still decides
  what a backdated edit means (`inventory.backdated_document`,
  `inventory.repricing_choice_required`, explicit repricing choice).
- Responses add `businessDateCalendar`, `createdAtCalendar`, `updatedAtCalendar`
  (derived once per response); canonical fields are unchanged, so existing
  clients keep working.

## 8. Accounting and audit

`document_date` is the reporting axis and `posting_timestamp` the event axis
(OQ-43/Q14) — the two must never be conflated. `document_date` is a `date` in
UTC-midnight form with inclusive ranges (`accounting/domain/date-range.ts`), and
that contract is unchanged. Displaying statutory reports in Jalali is a Legal
Profile concern (ADR-0036) and not decided here.

## 9. Frontend

- `src/lib/datetime/` is the whole layer:
  - `calendar.ts` — the ONLY importer of the Jalali library; conversion,
    validation, leap years;
  - `numerals.ts` — digit conversion, deliberately separate from calendars
    (Persian-numeral rendering is a pending preference, OQ-02);
  - `dayjs.ts` — the ONE Day.js configuration (plugins registered once);
  - `time-zone.ts` / `instant.ts` — zone validity, and instant → local renderings
    (with the zone label);
  - `business-date.ts` — canonical days, today in the organization's zone, the
    day ⇄ day-instant convention;
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
  years, invalid days, DST-dependent offsets, half-open ranges, API shapes),
  inventory document specs (Jalali day ≡ Gregorian day, backdated day ≠ creation
  instant), organization settings specs (defaults, closed vocabulary, refusals).
- Frontend: `lib/datetime/datetime.test.ts` and `ui/patterns/
date-input.test.tsx` (round trips, leap years, typed Jalali input, Persian
  digits, canonical emission, organization defaults).
- Live-database suites run in CI only (`.github/workflows/ci.yml`); no local
  database, migration rehearsal or full suite is required to verify this slice.

## 11. Open items

- **OQ-02** — numeral rendering and the rest of localization stay open; the
  calendar default is now implementation-recorded (Jalali primary).
- **OQ-73** — inventory day columns are `timestamptz` carrying a day; converting
  them to `date` is a separate, behavior-visible decision.
- `frontend/src/api/generated/vardena-api.d.ts` is committed and predates C-62/
  C-63; regenerate with `npm run api:types` against a running API. Until then,
  `src/api/contracts.ts` carries a documented refinement for the two
  organization settings fields.
- Other modules (accounting document filters, reporting surfaces) adopt this
  layer as they are touched; this slice wires the organization settings, the
  Inventory business-document date, and the Inventory date fields.
