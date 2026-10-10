import { AppException } from '../../../kernel/errors/app-exception.js';
import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import type { CalendarSystem } from '../../../kernel/datetime/calendar-system.js';
import type { OrganizationsService } from '../../organization/application/organizations.service.js';
import { isInventoryBusinessDateRenderable } from '../domain/inventory-balance.js';

/** Stable detail code for the 409 returned when a prevalidated calendar is stale. */
export const INVENTORY_BUSINESS_DATE_CALENDAR_CHANGED_CODE =
  'organization.calendar.changed_during_business_date_write';

/**
 * Fail before opening an Inventory write when a canonical BusinessDate cannot
 * be represented in the organization's current calendar. Gregorian
 * organizations retain the full canonical Gregorian range; Jalali requires
 * the inclusive reversible conversion range.
 */
export function assertInventoryBusinessDateRenderable(
  field: string,
  businessDate: BusinessDate,
  calendarSystem: CalendarSystem,
): void {
  if (!isInventoryBusinessDateRenderable(businessDate, calendarSystem)) {
    throw AppException.validation([
      {
        field,
        code: 'business_date_calendar',
        message:
          'Business date is outside the supported calendar rendering range.',
      },
    ]);
  }
}

/**
 * Acquire Organization's public BusinessDate lock around the complete
 * Inventory-owned durable transaction. No transaction client crosses modules.
 * A stale/missing organization never invokes `work`.
 */
export async function withInventoryBusinessDateWriteLock<T>(
  organizations: OrganizationsService,
  organizationId: string,
  validatedCalendarSystem: CalendarSystem,
  work: () => Promise<T>,
): Promise<T> {
  const result = await organizations.withBusinessDateWriteLock(
    organizationId,
    validatedCalendarSystem,
    work,
  );
  if (result.kind === 'completed') return result.value;
  if (result.kind === 'not_found') {
    throw AppException.notFound('Organization', organizationId);
  }
  throw AppException.conflict(
    'The organization calendar changed after this Inventory operation was validated. No Inventory write was started; refresh and retry.',
    { code: INVENTORY_BUSINESS_DATE_CALENDAR_CHANGED_CODE },
  );
}
