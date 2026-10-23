import { useMemo } from 'react';
import { useFieldArray, type UseFormReturn } from 'react-hook-form';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import {
  DetailGrid,
  type DetailGridColumn,
} from '@/ui/patterns/operational-form';
import type { InventoryReferences } from '../use-inventory-references';
import type { DocumentFormValues } from './inventory-document-form-schema';

interface InventoryLineFieldRow {
  id: string;
  itemId: string;
  quantity: string;
  unitId: string;
}

/**
 * Operational Detail Grid for Inventory Business Document lines.
 *
 * Uses the shared `DetailGrid`:
 * - Stable `field.id` keys
 * - Keyboard navigation (`Enter` advances/appends row; `ArrowUp`/`ArrowDown`
 *   moves vertically)
 * - Row Context Menu (Insert Above, Insert Below, Duplicate Row, Delete Row)
 * - Automatic virtualization at 80+ rows
 * - Selecting an item defaults `unitId` to that item's `baseUnitId`
 */
export function DocumentLinesEditor({
  form,
  references,
  disabled,
}: {
  form: UseFormReturn<DocumentFormValues>;
  references: InventoryReferences;
  disabled: boolean;
}) {
  const { control, register, setValue, formState, watch } = form;
  const { fields, append, insert, remove } = useFieldArray({
    control,
    name: 'lines',
  });
  const linesError = formState.errors.lines;
  const rootMessage =
    typeof linesError?.message === 'string' ? linesError.message : undefined;

  const columns = useMemo<DetailGridColumn<InventoryLineFieldRow>[]>(
    () => [
      {
        key: 'item',
        header: t.inventoryDocuments.lineItem,
        minWidthClass: 'min-w-60',
        render: (_row, index) => {
          const error = formState.errors.lines?.[index]?.itemId?.message;
          const errorId = `inv-line-${index}-item-error`;
          return (
            <div>
              <Select
                id={`line-${index}-item`}
                aria-label={t.inventoryDocuments.lineItem}
                aria-invalid={error !== undefined}
                aria-describedby={error !== undefined ? errorId : undefined}
                disabled={disabled}
                {...register(`lines.${index}.itemId`, {
                  onChange: (event: { target: { value: string } }) => {
                    const selected = references.itemById(event.target.value);
                    if (selected !== undefined) {
                      setValue(`lines.${index}.unitId`, selected.baseUnitId, {
                        shouldDirty: true,
                        shouldValidate: formState.isSubmitted,
                      });
                    }
                  },
                })}
              >
                <option value="">
                  {t.inventoryDocuments.selectPlaceholder}
                </option>
                {references.items.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} — {option.name}
                  </option>
                ))}
              </Select>
              {error !== undefined && (
                <p
                  id={errorId}
                  role="alert"
                  className="mt-1 text-xs text-danger-ink"
                >
                  {error}
                </p>
              )}
            </div>
          );
        },
      },
      {
        key: 'quantity',
        header: t.inventoryDocuments.lineQuantity,
        minWidthClass: 'min-w-36',
        align: 'end',
        render: (_row, index) => {
          const error = formState.errors.lines?.[index]?.quantity?.message;
          const errorId = `inv-line-${index}-quantity-error`;
          return (
            <div>
              <Input
                id={`line-${index}-quantity`}
                aria-label={t.inventoryDocuments.lineQuantity}
                aria-invalid={error !== undefined}
                aria-describedby={error !== undefined ? errorId : undefined}
                inputMode="decimal"
                className="num"
                disabled={disabled}
                {...register(`lines.${index}.quantity`)}
              />
              {error !== undefined && (
                <p
                  id={errorId}
                  role="alert"
                  className="mt-1 text-xs text-danger-ink"
                >
                  {error}
                </p>
              )}
            </div>
          );
        },
      },
      {
        key: 'unit',
        header: t.inventoryDocuments.lineUnit,
        minWidthClass: 'min-w-44',
        render: (_row, index) => {
          const itemId = watch(`lines.${index}.itemId`);
          const item = references.itemById(itemId);
          const error = formState.errors.lines?.[index]?.unitId?.message;
          const errorId = `inv-line-${index}-unit-error`;
          return (
            <div>
              <Select
                id={`line-${index}-unit`}
                aria-label={t.inventoryDocuments.lineUnit}
                aria-invalid={error !== undefined}
                aria-describedby={error !== undefined ? errorId : undefined}
                disabled={disabled || item === undefined}
                {...register(`lines.${index}.unitId`)}
              >
                <option value="">
                  {t.inventoryDocuments.selectPlaceholder}
                </option>
                {references.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} — {unit.name}
                  </option>
                ))}
              </Select>
              {error !== undefined && (
                <p
                  id={errorId}
                  role="alert"
                  className="mt-1 text-xs text-danger-ink"
                >
                  {error}
                </p>
              )}
            </div>
          );
        },
      },
    ],
    [
      disabled,
      formState.errors.lines,
      formState.isSubmitted,
      references,
      register,
      setValue,
      watch,
    ],
  );

  const emptyLine = () => ({ itemId: '', quantity: '', unitId: '' });

  return (
    <div className="space-y-2" data-testid="document-lines">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          {t.inventoryDocuments.lines}
        </h2>
      </div>

      {rootMessage !== undefined ? (
        <p role="alert" className="text-xs text-danger-ink">
          {rootMessage}
        </p>
      ) : null}

      <DetailGrid
        ariaLabel={t.inventoryDocuments.lines}
        columns={columns}
        rows={fields}
        getRowId={(row) => row.id}
        readOnly={disabled}
        addLabel={t.inventoryDocuments.addLine}
        onAddRow={() => append(emptyLine())}
        onInsertAbove={(index) => insert(index, emptyLine())}
        onInsertBelow={(index) => insert(index + 1, emptyLine())}
        onDuplicateRow={(index) => {
          const current = form.getValues(`lines.${index}`);
          insert(index + 1, {
            itemId: current.itemId,
            quantity: current.quantity,
            unitId: current.unitId,
          });
        }}
        onRemoveRow={(index) => {
          if (fields.length > 1) remove(index);
        }}
        canRemoveRow={() => fields.length > 1}
      />
    </div>
  );
}
