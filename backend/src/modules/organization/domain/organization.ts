import type { CalendarSystem } from '../../../kernel/datetime/calendar-system.js';
import {
  DEFAULT_DATE_TIME_SETTINGS,
  type DateTimeSettings,
} from '../../../kernel/datetime/date-time-settings.js';

/**
 * Organization — the business/tenant root of a Vardena deployment
 * (docs/architecture/domain/domain-glossary.md §Organizational terms,
 * master-data-strategy.md §1/§2, ADR-0020 §1, ADR-0021).
 *
 * The glossary defines Organization as "the single legal/business entity a
 * Vardena deployment serves" under the OQ-01 assumption of one organization
 * per deployment with no `organization_id` columns. Task 6 makes the
 * organization an explicit, addressable row and scopes master data to it,
 * which supersedes that assumption; the change and its consequences are
 * recorded in ADR-0021 and in the updated OQ-01/OQ-22 entries.
 *
 * This entity is a *boundary*, not a settings bag: the fiscal calendar,
 * numbering series, tax definitions, workflow definitions and custom-field
 * definitions that ADR-0020 also assigns to this module are NOT implemented
 * here (later tasks).
 *
 * It DOES own the date/time **display policy** (C-63, ADR-0042 §5/§6): which
 * calendar the organization's days are shown in and which IANA zone turns an
 * instant into a local date-time. Those two values are rendering/authoring
 * configuration — they never decide what is stored. `is_active` on a document
 * is a fact; the calendar it was dated in is a presentation of that fact.
 * Keeping them here (and only here) is what stops a second, competing
 * settings store from appearing for dates.
 *
 * Framework-free (AR-05).
 */

export interface Organization {
  /** ULID primary key. */
  id: string;
  /** Human business key, unique deployment-wide. */
  code: string;
  name: string;
  /**
   * Lifecycle (master-data-strategy.md §7.4). A disabled organization blocks
   * the creation of new organization-scoped records but keeps existing ones
   * readable and reportable.
   */
  isActive: boolean;
  /**
   * The calendar this organization's days are rendered in and new dates are
   * authored in (C-63 §4). A closed code-defined list; stored values outside
   * it are a defect, not a default.
   */
  calendarSystem: CalendarSystem;
  /** The IANA zone used to resolve an instant to a local date-time (C-63 §5). */
  timeZone: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The date/time policy every rendering and day-authoring path reads (C-63,
 * ADR-0042 §6).
 *
 * The TYPE lives in the kernel (`kernel/datetime/date-time-settings.ts`) so a
 * consumer — a report, a document DTO mapper, the frontend's settings store —
 * depends on the technical shape and never reaches into the Organization
 * module for it (AR-06/AR-07). This module owns the durable record.
 */
export type OrganizationDateTimeSettings = DateTimeSettings;

/**
 * The settings as they apply to any organization that has not stated its own.
 *
 * This is the DEFAULT, not a hardcoded behaviour: the product ships with a
 * Persian/Jalali business default (C-63 §4/§5), and a deployment that needs
 * another one changes the organization row — no code changes.
 */
export { DEFAULT_DATE_TIME_SETTINGS };

/** The date/time policy in effect for an organization. */
export function toDateTimeSettings(
  organization: Organization,
): OrganizationDateTimeSettings {
  return {
    calendarSystem: organization.calendarSystem,
    timeZone: organization.timeZone,
  };
}

/** API representation. Audit actor ids are not exposed (AR-24). */
export interface OrganizationDto {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  /** C-63: display calendar (`GREGORIAN` | `JALALI`). */
  calendarSystem: CalendarSystem;
  /** C-63: IANA zone used for local date-times. */
  timeZone: string;
  createdAt: string;
  updatedAt: string;
}

export function toOrganizationDto(organization: Organization): OrganizationDto {
  return {
    id: organization.id,
    code: organization.code,
    name: organization.name,
    isActive: organization.isActive,
    calendarSystem: organization.calendarSystem,
    timeZone: organization.timeZone,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}
