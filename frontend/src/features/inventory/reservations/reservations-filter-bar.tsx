import { useForm } from 'react-hook-form';
import type { InventoryReservationStatus } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { Select } from '@/ui/select';
import type { InventoryReferences } from '../use-inventory-references';
import type { ReservationsUrlState } from './reservation-url-state';

export type ReservationsFilterValues = Pick<
  ReservationsUrlState,
  'warehouseId' | 'itemId' | 'status'
>;

export function reservationsFilterValuesFromUrl(
  state: ReservationsUrlState,
): ReservationsFilterValues {
  return {
    warehouseId: state.warehouseId,
    itemId: state.itemId,
    status: state.status,
  };
}

export function ReservationsFilterBar({
  references,
  values,
  synchronizationKey,
  isFetching,
  onApply,
  onClear,
}: {
  references: InventoryReferences;
  values: ReservationsFilterValues;
  synchronizationKey: string;
  isFetching: boolean;
  onApply: (values: ReservationsFilterValues) => void;
  onClear: () => void;
}) {
  const form = useForm<ReservationsFilterValues>({
    defaultValues: values,
    mode: 'onSubmit',
  });

  return (
    <FilterBar
      key={synchronizationKey}
      onSubmit={form.handleSubmit(onApply)}
      onClear={onClear}
      isFetching={isFetching}
      columns={3}
      aria-label={t.reservations.filtersTitle}
    >
      <FilterField label={t.reservations.warehouse}>
        <Select
          className="h-9"
          disabled={references.isFailed}
          {...form.register('warehouseId')}
        >
          <option value="">{t.filters.allWarehouses}</option>
          {references.warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code} — {warehouse.name}
            </option>
          ))}
        </Select>
      </FilterField>

      <FilterField label={t.reservations.item}>
        <Select
          className="h-9"
          disabled={references.isFailed}
          {...form.register('itemId')}
        >
          <option value="">{t.filters.allItems}</option>
          {references.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </Select>
      </FilterField>

      <FilterField label={t.reservations.status}>
        <Select
          className="h-9"
          {...form.register('status', {
            setValueAs: (value: string) =>
              value === 'active' || value === 'released'
                ? (value as InventoryReservationStatus)
                : '',
          })}
        >
          <option value="">{t.reservations.allStatuses}</option>
          <option value="active">{t.reservations.statuses.active}</option>
          <option value="released">{t.reservations.statuses.released}</option>
        </Select>
      </FilterField>
    </FilterBar>
  );
}
