# ADR-0042: One Date/Time Model — UTC Instants, Calendar Days, a Configurable Calendar

Status: Accepted (PO-02, 2026-10-09 — OQ-73 resolved: business days persist as PostgreSQL `date`)
Date: 2026-10-08

## Context

Vardena had no date/time architecture: every module invented its own answer.
Inventory stores `business_date` / `movement_date` as `timestamptz` and labels
them `format: 'date-time'`; Accounting stores `document_date` as `date`/UTC
midnight and treats it as the reporting axis; event timestamps are UTC instants;
the UI ships `${YYYY-MM-DD}T00:00:00.000Z` from native date inputs; Day.js is
configured nowhere; there is no time-zone concept at all (Tehran is implicit)
and no calendar abstraction. Iranian business users read and type Jalali days,
and OQ-02 has kept that undecided. Without one model, "date" silently means
three different things, a Jalali day cannot be told apart from a Gregorian one,
and every new module re-implements a conversion.

## Decision

1. **Technical truth is a UTC instant** (`timestamptz`, ISO-8601 UTC on the
   wire, e.g. `2026-10-08T08:32:14.421Z`). Never local time, never a formatted
   string in storage.
2. **A business date is a calendar DAY, not a timestamp.** It is persisted as
   PostgreSQL `date` — canonical Gregorian, never Jalali, never a timestamp
   (OQ-73, resolved): `accounting.document_date`,
   `inventory.inventory_movements.movement_date`,
   `inventory.inventory_business_documents.business_date`, valuation/pricing run
   bounds, the posting-snapshot document date and the balance
   `last_movement_date`. The interim "day riding a timestamp column as its
   UTC-midnight instant" convention is retired; audit/event instants
   (`*_at`, `valued_at`, `posting_timestamp`, validity windows) stay
   `timestamptz`. Day columns filter with true date comparisons.
3. **The derivation chain is one-way:** instant → IANA time zone → local
   date/time → calendar rendering. Rendering never feeds storage.
4. **`CalendarSystem { GREGORIAN, JALALI }`** is a closed, code-defined
   vocabulary. `JALALI` is the product default, never hard-coded per screen or
   per module.
5. **Time zones are IANA ids only** (default `Asia/Tehran`). Numeric offsets are
   rejected; offsets are resolved by the runtime for the instant in question —
   no manual offset arithmetic anywhere.
6. **The settings live on the organization**, `organization.organizations.
calendar_system` / `time_zone` (ADR-0020 boundary, values validated against
   the kernel vocabulary). No second settings table, no per-user duplicate.
7. **One API representation.** Business date: `{ gregorian, jalali }` (Gregorian
   canonical). Event timestamp: `{ instant, timeZone, gregorian, jalali }`
   (instant authoritative). A Jalali day INPUT is declared as
   `{ calendar: 'JALALI', value: '1405-07-16' }`; a bare `YYYY-MM-DD` is
   Gregorian by contract.
8. **Range semantics are stated, not guessed:** business-date ranges are
   inclusive `[startDate, endDate]`; instant ranges are half-open
   `[startInstant, endInstant)`; no `23:59:59.999` arithmetic. Filters stay
   index-friendly (`>=`/`<` on the stored column — never `format()` or string
   comparison on a Jalali rendering).
9. **The Jalali library is isolated behind the kernel abstraction**
   (`backend/src/kernel/datetime/`, `frontend/src/lib/datetime/`). No domain
   module, repository or component imports it directly.
10. **Historical rendering uses the CURRENT organization settings** (policy A of
    the three candidates): the stored instant is the fact, a rendering is a
    view, and detail views name the zone they used. A rendering is never audit
    evidence.
11. **The frontend keeps Day.js as its engine** (ADR-0002), with plugins
    registered in exactly one module, ONE calendar-aware date field, shared
    formatters and API adapters. Calendar conversion and Persian-numeral
    rendering are separate concerns.

## Consequences

- Jalali days can be authored and read everywhere without a single stored
  conversion; changing an organization's calendar re-renders history instead of
  rewriting it.
- New modules have one place to ask "what day is this / what instant is this".
- Migration defaults (`JALALI`, `Asia/Tehran`) change rendering only — no
  stored fact moves, so the migration is safe on populated data.
- **OQ-73 is resolved** by migration `20261011000000_business_date_persistence`:
  every business-day column becomes `date` via the deterministic policy
  `(column AT TIME ZONE 'UTC')::date` — byte-for-byte the day the previous
  `timestamptz` read path returned, so no row changes its business date and no
  data is lost; `last_movement_at` is renamed `last_movement_date`. Filtering a
  day column is now a real date comparison (index-friendly, no row-side Jalali
  conversion), and the ledger's Kardex order is (business day, entry time, id).
- Follow-ups: OQ-02 keeps the numeral/localization decision open;
  `frontend/src/api/generated/vardena-api.d.ts` is committed and hand-kept in
  step with the backend, so `api/contracts.ts` carries a documented refinement
  until the next `npm run api:types`.
- Full contract: `docs/datetime.md`.
