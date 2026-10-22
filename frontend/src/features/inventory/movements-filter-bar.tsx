import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { isBusinessDay } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { FilterBar } from '@/ui/patterns/filter-bar';
import { FormField } from '@/ui/patterns/form-field';
import { DateInput } from '@/ui/patterns/date-input';
import { Select } from '@/ui/select';
import type { InventoryReferences } from './use-inventory-references';
import { MOVEMENT_TYPE_FILTERS } from './use-inventory-movements';
import { movementTypeLabel } from './inventory-labels';
import type { MovementsUrlState } from './use-inventory-movements';

/**
 * Movements workspace filters — exactly the query parameters the
 * `InventoryMovementsController.list` endpoint declares: warehouse, item,
 * movement type and a movement-date range. Filters apply EXPLICITLY on
 * submit and then live in the URL.
 */

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === '' || isBusinessDay(value), {
    message: t.filters.invalidDate,
  });

export const movementsFilterSchema = z.object({
  warehouseId: z.string(),
  itemId: z.string(),
  movementType: z.string(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
});

export type MovementsFilterValues = z.infer<typeof movementsFilterSchema>;

export function movementsFilterValuesFromUrl(
  state: MovementsUrlState,
): MovementsFilterValues {
  return {
    warehouseId: state.warehouseId,
    itemId: state.itemId,
    movementType: state.movementType,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
  };
}

export function isEmptyMovementsFilter(values: MovementsFilterValues): boolean {
  return (
    values.warehouseId === '' &&
    values.itemId === '' &&
    values.movementType === '' &&
    values.dateFrom === '' &&
    values.dateTo === ''
  );
}

export interface MovementsFilterBarProps {
  references: InventoryReferences;
  /** URL-owned values the form is seeded with (a change remounts the form). */
  values: MovementsFilterValues;
  synchronizationKey: string;
  isFetching: boolean;
  onApply: (values: MovementsFilterValues) => void;
  onClear: () => void;
}

export function MovementsFilterBar({
  references,
  values,
  synchronizationKey,
  isFetching,
  onApply,
  onClear,
}: MovementsFilterBarProps) {
  const form = useForm<MovementsFilterValues>({
    resolver: zodResolver(movementsFilterSchema),
    defaultValues: values,
    mode: 'onSubmit',
  });
  const { formState } = form;

  return (
    <FilterBar
      key={synchronizationKey}
      onSubmit={form.handleSubmit(onApply)}
      onClear={onClear}
      isFetching={isFetching}
      columns={5}
      aria-label={t.filters.title}
      actions={
        formState.errors.dateFrom !== undefined ||
        formState.errors.dateTo !== undefined ? (
          <p role="alert" className="text-xs font-medium text-danger-ink">
            {formState.errors.dateFrom?.message ??
              formState.errors.dateTo?.message}
          </p>
        ) : undefined
      }
    >
      <FormField id="movements-filter-warehouse" label={t.inventory.warehouse}>
        {(fieldProps) => (
          <Select
            {...fieldProps}
            className="h-9"
            {...form.register('warehouseId')}
          >
            <option value="">{t.filters.allWarehouses}</option>
            {references.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="movements-filter-item" label={t.inventory.item}>
        {(fieldProps) => (
          <Select {...fieldProps} className="h-9" {...form.register('itemId')}>
            <option value="">{t.filters.allItems}</option>
            {references.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="movements-filter-type"
        label={t.inventory.movementTypeFilter}
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            className="h-9"
            {...form.register('movementType')}
          >
            <option value="">{t.inventory.allMovementTypes}</option>
            {MOVEMENT_TYPE_FILTERS.map((type) => (
              <option key={type} value={type}>
                {movementTypeLabel(type)}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="movements-filter-date-from" label={t.inventory.dateFrom}>
        {(fieldProps) => (
          <Controller
            control={form.control}
            name="dateFrom"
            render={({ field }) => (
              <DateInput
                {...fieldProps}
                id="movements-filter-date-from"
                value={field.value}
                onValueChange={field.onChange}
                className="h-9"
              />
            )}
          />
        )}
      </FormField>

      <FormField id="movements-filter-date-to" label={t.inventory.dateTo}>
        {(fieldProps) => (
          <Controller
            control={form.control}
            name="dateTo"
            render={({ field }) => (
              <DateInput
                {...fieldProps}
                id="movements-filter-date-to"
                value={field.value}
                onValueChange={field.onChange}
                className="h-9"
              />
            )}
          />
        )}
      </FormField>
    </FilterBar>
  );
}
