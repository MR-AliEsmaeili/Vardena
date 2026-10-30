import { describe, expect, it } from 'vitest';
import { reservationsColumns } from './reservations-columns';

describe('reservation table sorting', () => {
  it('exposes only the backend-supported sort fields', () => {
    const columns = reservationsColumns({
      itemById: () => undefined,
      warehouseById: () => undefined,
      unitById: () => undefined,
    });

    expect(
      columns
        .filter((column) => column.enableSorting === true)
        .map((column) => column.id),
    ).toEqual(['status', 'createdAt', 'updatedAt']);
    expect(
      columns
        .filter((column) => column.enableSorting === false)
        .map((column) => column.id),
    ).toEqual([
      'itemId',
      'warehouseId',
      'quantity',
      'baseQuantity',
      'referenceType',
      'referenceId',
      'releasedAt',
      'actions',
    ]);
  });
});
