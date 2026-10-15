# ADR-0044: Fixed Jalali-First BusinessDate Presentation in the MVP

Status: Accepted (PO-02, 2026-10-10)
Date: 2026-10-10
Builds on: ADR-0042, OQ-73
Supersedes: ADR-0043; calendar-selection/transition portions of ADR-0042

> **Project-wide product clarification (2026-10-15):** the existing
> Jalali-first rule applies to all Vardena user-visible dates for Iranian users,
> including the independent Owner Licensing application, licensing/recovery,
> audit/history, reports and filters — not ERP UI alone. The normative scope,
> existing digit convention (OQ-02 still open), Asia/Tehran/default versus
> organization IANA-zone handling, and historical fallback are in
> [docs/datetime.md §0](../datetime.md). This changes no BusinessDate/Instant
> persistence, wire contract, signed bytes or separation boundary, and is not
> a claim that every module is already compliant.

## Context

The MVP has one product-owned display policy: Jalali-first. A selector and
transition workflow add history scans, cross-module write coordination, and
deployment risk without an MVP requirement. Preserve the date/time foundation
and all existing Gregorian API/integration contracts.

## Decision

1. **Jalali is fixed for the MVP UI.** No user, organization, or Inventory
   setting selects a calendar. Organization owns only its IANA time zone. Keep
   the legacy `calendar_system` column untouched and ignored; the response may
   expose read-only `JALALI` for compatibility, but writes do not accept it.
2. **Preserve the canonical model.** BusinessDate is a Gregorian calendar day
   stored as PostgreSQL `date`. Instant is a real timestamp stored as
   `timestamptz`; use the IANA zone only for local-time interpretation/display.
   Convert calendars only at explicit input/presentation boundaries; never
   store Jalali as the canonical fact.
3. **Preserve Gregorian contracts and history.** Gregorian BusinessDate API,
   filter, and integration values remain valid. A valid day or Instant outside
   the Jalali rendering range remains canonical and gets a `null` Jalali
   rendering plus a Gregorian UI fallback; rendering limits never reject or
   rewrite the fact. Convert an Instant to a BusinessDate only at an explicit,
   documented boundary with its existing business rule.
4. **Remove calendar-transition coordination.** No transition endpoint/service,
   Inventory history scan, organization-row calendar lock, or calendar-specific
   write/renderability gate. Preserve ordinary BusinessDate validation,
   ordering/ranges/persistence, Inventory row locks, transaction boundaries,
   and idempotency. Do not duplicate a calendar setting in Inventory.
5. **Keep module ownership acyclic.** Organization owns the time-zone record;
   Inventory owns its BusinessDates and persistence. Consumers use public
   module contracts and shared kernel primitives, never another module's
   repository/table or transaction client.
6. **Frontend stays Jalali-first and RTL-aware.** Shared BusinessDate inputs,
   filters, labels and views use the common date-time layer. Unsupported
   historical days display their canonical Gregorian value as fallback.
7. **Migration safety is unchanged.** Do not edit applied migrations, rewrite
   stored dates, or drop the legacy column without a reviewed safe rollout.
   Migration rehearsal is not proof that a shared/production database was
   audited.

## Consequences

- ADR-0043 remains historical record and is superseded; its transition-only
  implementation, APIs and locks are removed.
- The `DATE`/`timestamptz` foundation, Gregorian wire contracts, Inventory
  ordering/ranges/persistence and unrelated write concurrency remain.
- Preserve legacy column/checksums; evidence migration application status
  before deployment claims. Test conversion, invalid/leap/boundary cases,
  historical fallback, timezone semantics, persistence/ranges and absence of
  transition paths without removing unrelated concurrency coverage.
