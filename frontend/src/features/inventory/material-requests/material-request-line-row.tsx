import type { UseFormReturn } from 'react-hook-form';
import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FormField } from '@/ui/patterns/form-field';
import { t } from '@/lib/i18n';
import type { InventoryReferences } from '../use-inventory-references';
import type { MaterialRequestFormValues } from './material-request-form-schema';

/**
 * ONE line of the request editor.
 *
 * A line carries its OWN warehouse (the backend never splits a line across
 * warehouses) and an exact decimal quantity string. When a line has already
 * been invoked into a subsequent process it is locked as a whole: the UI cannot
 * prove a quantity decrease is still above `invokedBaseQuantity` without
 * repeating server decimal conversion, so it refuses every edit instead of
 * provoking a `422`.
 */
export function MaterialRequestLineRow({
  form,
  index,
  references,
  canViewConversions,
  locked,
  canRemove,
  onRemove,
}: {
  form: UseFormReturn<MaterialRequestFormValues>;
  index: number;
  references: Pick<InventoryReferences, 'items' | 'warehouses' | 'units'> & {
    itemById: InventoryReferences['itemById'];
  };
  canViewConversions: boolean;
  locked: boolean;
  canRemove: boolean;
  onRemove: () => void;
}): ReactElement {
  const errors = form.formState.errors.lines?.[index];
  const itemId = form.watch(`lines.${index}.itemId`);
  const selectedItem = references.itemById(itemId ?? '');
  const fieldId = (field: string) => `material-request-line-${index}-${field}`;
  const availableUnits =
    selectedItem === undefined
      ? []
      : references.units.filter(
          (unit) =>
            canViewConversions ||
            unit.id === selectedItem.baseUnitId ||
            unit.id === form.getValues(`lines.${index}.unitId`),
        );
  const itemField = form.register(`lines.${index}.itemId`);

  return (
    <fieldset
      className="rounded-control border border-line bg-surface p-3"
      data-testid={`material-request-line-${index}`}
      disabled={locked}
    >
      <legend className="px-1 text-xs font-semibold text-ink-muted">
        {t.materialRequests.lineNumber} {index + 1}
        {locked ? (
          <span className="ms-2 font-normal text-ink-subtle">
            {t.materialRequests.invocationLocked}
          </span>
        ) : null}
      </legend>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FormField
          id={fieldId('itemId')}
          label={t.materialRequests.item}
          error={errors?.itemId?.message}
          required
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              {...itemField}
              onChange={(event) => {
                void itemField.onChange(event);
                const item = references.itemById(event.target.value);
                form.setValue(`lines.${index}.unitId`, item?.baseUnitId ?? '', {
                  shouldValidate: form.formState.isSubmitted,
                });
              }}
            >
              <option value="">{t.filters.select}</option>
              {references.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          id={fieldId('warehouseId')}
          label={t.materialRequests.warehouse}
          error={errors?.warehouseId?.message}
          required
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              {...form.register(`lines.${index}.warehouseId`)}
            >
              <option value="">{t.filters.select}</option>
              {references.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} — {warehouse.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          id={fieldId('quantity')}
          label={t.materialRequests.quantity}
          error={errors?.quantity?.message}
          hint={t.materialRequests.quantityHint}
          required
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...form.register(`lines.${index}.quantity`)}
              inputMode="decimal"
              dir="ltr"
              placeholder="0.0000"
            />
          )}
        </FormField>

        <FormField
          id={fieldId('unitId')}
          label={t.materialRequests.unit}
          error={errors?.unitId?.message}
          required
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              {...form.register(`lines.${index}.unitId`)}
              disabled={selectedItem === undefined}
            >
              <option value="">{t.filters.select}</option>
              {availableUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.code} — {unit.name}
                  {unit.id === selectedItem?.baseUnitId
                    ? ` (${t.materialRequests.baseUnit})`
                    : ''}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-start gap-2 text-xs leading-5 text-ink-muted">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-line-strong"
            {...form.register(`lines.${index}.reservationRequested`)}
          />
          <span>
            <span className="font-medium text-ink">
              {t.materialRequests.reservationRequested}
            </span>
            <span className="block text-ink-subtle">
              {t.materialRequests.reservationHint}
            </span>
          </span>
        </label>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRemove}
          disabled={locked || !canRemove}
          title={
            !canRemove || locked
              ? t.materialRequests.lastLineNote
              : t.materialRequests.removeLine
          }
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {t.materialRequests.removeLine}
        </Button>
      </div>
    </fieldset>
  );
}
