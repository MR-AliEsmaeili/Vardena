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
 * It owns the organization's IANA time zone for instant rendering. The MVP
 * display calendar is fixed to Jalali and is not organization configuration.
 * BusinessDates remain Gregorian canonical days; historical instants remain
 * exact and are not altered by a display policy. The legacy
 * `calendar_system` column is intentionally not consulted.
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
  /** IANA zone used to resolve an instant to a local date-time (C-63 §5). */
  timeZone: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The time-zone setting every timestamp rendering path reads (C-63,
 * ADR-0042 §6). Calendar rendering is a fixed Jalali-first MVP policy, not a
 * member of this per-organization value.
 *
 * The TYPE lives in the kernel (`kernel/datetime/date-time-settings.ts`) so a
 * consumer — a report or a document DTO mapper — depends on the technical
 * shape and never reaches into the Organization module for it (AR-06/AR-07).
 */
export type OrganizationDateTimeSettings = DateTimeSettings;

/** Deployment time-zone fallback when an organization has no stated value. */
export { DEFAULT_DATE_TIME_SETTINGS };

/** The active time-zone setting of an organization. */
export function toDateTimeSettings(
  organization: Organization,
): OrganizationDateTimeSettings {
  return { timeZone: organization.timeZone };
}

/** API representation. Audit actor ids are not exposed (AR-24). */
export interface OrganizationDto {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  /** Fixed Jalali-first MVP display calendar; retained read-only for compatibility. */
  calendarSystem: 'JALALI';
  /** IANA zone used for local date-times. */
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
    calendarSystem: 'JALALI',
    timeZone: organization.timeZone,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}
