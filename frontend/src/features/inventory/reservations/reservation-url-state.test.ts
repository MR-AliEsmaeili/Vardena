import { describe, expect, it } from 'vitest';
import { buildReservationsQuery } from './reservation-hooks';
import {
  parseReservationsUrlState,
  RESERVATIONS_DEFAULT_SORT,
  RESERVATION_SORT_FIELDS,
  reservationsSortingState,
} from './reservation-url-state';

function parse(search: string) {
  return parseReservationsUrlState(new URLSearchParams(search));
}

describe('reservation list URL state', () => {
  it('keeps only supported status and sort values', () => {
    const invalid = parse(
      'status=pending&sort=quantity:asc&page=0&pageSize=999',
    );
    expect(invalid).toMatchObject({
      status: '',
      sort: RESERVATIONS_DEFAULT_SORT,
      page: 1,
      pageSize: 50,
    });

    const valid = parse(
      'status=released&sort=updatedAt:asc&page=2&pageSize=100',
    );
    expect(valid).toMatchObject({
      status: 'released',
      sort: 'updatedAt:asc',
      page: 2,
      pageSize: 100,
    });
  });

  it('builds only backend-declared filters and organization scope', () => {
    const state = parse(
      'status=active&warehouseId=wh-1&itemId=item-1&sort=status:desc',
    );
    expect(buildReservationsQuery('org-1', state)).toEqual({
      organizationId: 'org-1',
      page: 1,
      pageSize: 50,
      sort: 'status:desc',
      status: 'active',
      warehouseId: 'wh-1',
      itemId: 'item-1',
    });
  });

  it('exposes exactly the service sort allow-list to the table', () => {
    expect(RESERVATION_SORT_FIELDS).toEqual([
      'createdAt',
      'updatedAt',
      'status',
    ]);
    expect(reservationsSortingState('unlisted:desc')).toEqual([]);
    expect(reservationsSortingState('status:asc')).toEqual([
      { id: 'status', desc: false },
    ]);
  });
});
