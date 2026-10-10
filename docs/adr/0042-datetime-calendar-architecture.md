# ADR-0042: One Date/Time Model — UTC Instants, Calendar Days, a Configurable Calendar

Status: Accepted for the BusinessDate/Instant foundation; organization-selectable calendar superseded by ADR-0044
Date: 2026-10-08

## Context

Before this architecture was implemented, modules used incompatible date/time
representations: Inventory exposed some day-valued columns as `timestamptz`,
Accounting used `date`/UTC-midnight conventions, UI date inputs could ship
midnight timestamps, and Tehran was often implicit instead of an explicit IANA
zone. Jalali days also needed an explicit declaration to distinguish them from
Gregorian strings. This ADR establishes the common model and preserves the
modular-monolith boundaries: the kernel provides calendar/time primitives;
organization-owned settings determine presentation; each business module owns
its facts and rules.

## Decision

1. **A real event is an Instant.** Persist it as PostgreSQL `timestamptz` and
   expose the authoritative value as an ISO-8601 UTC instant (for example,
   `2026-10-08T08:32:14.421Z`). Never persist local wall-clock time or a formatted
   string as the event fact.
2. **A BusinessDate is a calendar day, not a timestamp.** Persist it as
   PostgreSQL `date`, canonical Gregorian. User-facing input and display use the
   organization's configured calendar (Jalali by default); no day is stored as
   Jalali, as a timestamp, or as UTC midnight. This includes
   `accounting.document_date`, Inventory movement/document days, valuation and
   pricing run bounds, posting-snapshot document dates, fiscal-period bounds,
   and the balance `last_movement_date`. OQ-73 is resolved: day columns are
   compared as dates.
3. **Inventory validity-window owner decision (2026-10-09).**
   `inventory.unit_conversions.valid_from/valid_to`,
   `inventory.item_unit_conversions.valid_from/valid_to`, and
   `inventory.item_valuation_methods.valid_from/valid_to` are BusinessDate
   bounds, not instants. They use half-open ranges `[valid_from, valid_to)`;
   `NULL` `valid_to` is open-ended. Adjacent versions may meet at one boundary.
   This classification is specific to these Inventory fields; it does not
   reclassify all columns named `valid_*` in other modules. The conversion
   migration is `20261012000000_inventory_business_date_validity_windows`.
4. **The conversion chain is one-way:** Instant → valid organization IANA time
   zone → local date/time → organization calendar rendering. A rendering never
   feeds persistence or business logic.
5. **`CalendarSystem { GREGORIAN, JALALI }`** is a closed code-defined
   vocabulary. The organization default is `JALALI`; no screen or module
   hard-codes its own calendar choice.
6. **Time zones are valid IANA identifiers only** (default `Asia/Tehran`).
   Numeric offsets are rejected as settings. The runtime resolves the offset for
   each instant; manual offset arithmetic and browser-zone assumptions are
   forbidden.
7. **Settings belong to the organization:**
   `organization.organizations.calendar_system` and `time_zone`. No duplicate
   settings store or per-user override is introduced by this decision.
8. **API representation is explicit.** A BusinessDate response carries its
   canonical Gregorian day and, when paired rendering is exposed, its Jalali
   rendering. A Jalali BusinessDate input is declared as
   `{ "calendar": "JALALI", "value": "1405-07-16" }`; bare
   `YYYY-MM-DD` means Gregorian. The owner-approved compatibility path for a
   legacy ISO-instant supplied to a BusinessDate input resolves to that
   instant's **UTC calendar day**, regardless of its written offset or the
   organization's display zone. It is not a general way to turn event
   timestamps into business dates; event facts remain Instants.
9. **Range semantics are explicit.** BusinessDate filters are inclusive
   `[startDate, endDate]`; Inventory validity windows are half-open
   `[valid_from, valid_to)`; Instant ranges are half-open
   `[startInstant, endInstant)`. Never approximate an inclusive end with
   `23:59:59.999`. Date filters compare the stored date column directly.
10. **The calendar library is isolated** behind
    `backend/src/kernel/datetime/` and `frontend/src/lib/datetime/`. Domain
    modules, repositories and components do not import a calendar library or
    implement local calendar conversion.
11. **Historical rendering uses current organization settings** (policy A): the
    stored instant/day is the fact; rendering is a view. Audit/detail Instant
    displays include seconds and explicitly identify the resolved IANA zone and
    offset for that instant. The raw ISO instant remains available as evidence;
    a rendering is never audit evidence.
12. **The frontend uses Day.js through the shared date-time layer** (ADR-0002),
    with plugins registered once, one calendar-aware date input, shared
    formatters and API adapters. Calendar conversion and numeral rendering are
    separate; OQ-02 remains open for Persian-numeral and broader localization
    policy, not for the BusinessDate/Instant distinction or configured calendar
    contract.

## Consequences

- Organization settings change presentation only; they do not rewrite a stored
  BusinessDate or Instant.
- Cross-module date/time behavior reuses the kernel/frontend abstractions and
  the owning module's public API/service. No second settings store, local
  conversion library, or module-to-module Prisma access is introduced.
- The resolved OQ-73 migration is
  `20261011000000_business_date_persistence`; its SQL conversion policy uses the
  UTC calendar day. CI migration/repository coverage is not proof about an
  external production dataset. The actual historical values of a target database
  must be evidenced separately before deployment; do not blindly convert
  arbitrary timestamps or claim data safety without that evidence.
- The Inventory validity-window migration uses the same explicit UTC-calendar-
  day mapping and preflights for collapsed/reversed windows, duplicate starts,
  overlaps, and unrepresentable values after conversion. Its PostgreSQL fixture
  rehearsal covers representative boundary and failure cases and preserves
  audit timestamps; it is not evidence about customer/production rows. The
  aggregate-only target audit is
  `backend/prisma/rehearsal/business-date-validity-windows/audit.sql`; inspect
  and retain its counts plus the migration NOTICE/outcome for the actual target
  dataset. The rehearsal refuses non-local hosts and pre-existing database
  names, and its synthetic fixtures never substantiate production-data safety.
- The Kardex's deterministic order remains (business day, entry time, id), and
  BusinessDate filters remain true date comparisons (index-friendly).
- Full normative contract and checklist: [`docs/datetime.md`](../datetime.md).
