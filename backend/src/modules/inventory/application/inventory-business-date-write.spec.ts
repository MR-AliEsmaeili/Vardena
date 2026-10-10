import { describe, expect, it, vi } from 'vitest';
import { parseBusinessDate } from '../../../kernel/datetime/business-date.js';
import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import type { OrganizationsService } from '../../organization/application/organizations.service.js';
import {
  assertInventoryBusinessDateRenderable,
  INVENTORY_BUSINESS_DATE_CALENDAR_CHANGED_CODE,
  withInventoryBusinessDateWriteLock,
} from './inventory-business-date-write.js';

function businessDate(value: string): BusinessDate {
  const parsed = parseBusinessDate(value, 'GREGORIAN');
  if (parsed === null)
    throw new Error(`Invalid BusinessDate fixture: ${value}`);
  return parsed.gregorian;
}

describe('Inventory BusinessDate write contract', () => {
  it('keeps both inclusive Jalali rendering endpoints and refuses days outside them', () => {
    expect(() =>
      assertInventoryBusinessDateRenderable(
        'movementDate',
        businessDate('0621-03-21'),
        'JALALI',
      ),
    ).not.toThrow();
    expect(() =>
      assertInventoryBusinessDateRenderable(
        'movementDate',
        businessDate('3798-12-31'),
        'JALALI',
      ),
    ).not.toThrow();
    expect(() =>
      assertInventoryBusinessDateRenderable(
        'movementDate',
        businessDate('0621-03-20'),
        'JALALI',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'ValidationFailed',
        details: [
          expect.objectContaining({
            field: 'movementDate',
            code: 'business_date_calendar',
          }),
        ],
      }),
    );
    expect(() =>
      assertInventoryBusinessDateRenderable(
        'movementDate',
        businessDate('3799-01-01'),
        'JALALI',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'ValidationFailed',
        details: [
          expect.objectContaining({
            field: 'movementDate',
            code: 'business_date_calendar',
          }),
        ],
      }),
    );
  });

  it('retains the full canonical Gregorian range when the organization is Gregorian', () => {
    expect(() =>
      assertInventoryBusinessDateRenderable(
        'movementDate',
        businessDate('4000-01-01'),
        'GREGORIAN',
      ),
    ).not.toThrow();
  });

  it('runs work only for a completed lock and exposes stale-calendar refusal as a stable Conflict', async () => {
    const work = vi.fn(async () => 'committed');
    const organizations = {
      withBusinessDateWriteLock: vi.fn().mockResolvedValue({
        kind: 'calendar_changed',
      }),
    } as unknown as OrganizationsService;

    await expect(
      withInventoryBusinessDateWriteLock(
        organizations,
        'org-1',
        'GREGORIAN',
        work,
      ),
    ).rejects.toMatchObject({
      code: 'Conflict',
      details: { code: INVENTORY_BUSINESS_DATE_CALENDAR_CHANGED_CODE },
    });
    expect(work).not.toHaveBeenCalled();

    vi.mocked(organizations.withBusinessDateWriteLock).mockImplementation(
      async (_organizationId, _calendarSystem, callback) => ({
        kind: 'completed',
        value: await callback(),
      }),
    );
    await expect(
      withInventoryBusinessDateWriteLock(
        organizations,
        'org-1',
        'GREGORIAN',
        work,
      ),
    ).resolves.toBe('committed');
    expect(work).toHaveBeenCalledTimes(1);
  });
});
