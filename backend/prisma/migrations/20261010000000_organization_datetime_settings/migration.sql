-- C-63 — the organization's date/time/calendar settings (ADR-0042).
--
-- Two additive columns on `organization.organizations`, no destructive change
-- and no data rewrite:
--
-- 1. `calendar_system` — the calendar this organization's days are shown in
--    (`GREGORIAN` | `JALALI`, a closed code-defined list). DEFAULT `JALALI`
--    because Vardena's business users read Jalali days; the value only affects
--    RENDERING and day-authoring, so adopting the default for every existing
--    row changes no stored fact: instants stay UTC (`timestamptz`) and
--    business days stay Gregorian (`date`).
--
-- 2. `time_zone` — the IANA zone used to turn an instant into a local
--    date-time (`Asia/Tehran` for the current market). DEFAULT `Asia/Tehran`
--    is the deployment's effective zone today (the repository hardcodes no
--    offset anywhere: the runtime's tz database resolves offsets per instant).
--
-- Both values are validated in the application layer (closed calendar list +
-- resolvable IANA zone) — the columns are just the durable record.

ALTER TABLE "organization"."organizations"
    ADD COLUMN "calendar_system" VARCHAR(16) NOT NULL DEFAULT 'JALALI';

ALTER TABLE "organization"."organizations"
    ADD COLUMN "time_zone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Tehran';
