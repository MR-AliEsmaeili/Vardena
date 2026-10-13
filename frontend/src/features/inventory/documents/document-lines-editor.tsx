import type { UseFormReturn } from 'react-hook-form';
import { useFieldArray } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FormField } from '@/ui/patterns/form-field';
import type { InventoryReferences } from '../use-inventory-references';
import type { DocumentFormValues } from './inventory-document-form-schema';

/**
 * The line editor of a business document.
 *
 * Picking an item defaults the unit to that item's base unit; the operator
 * may still choose another unit and the backend resolves (or refuses) the
 * conversion in force at the business date — the UI never guesses a factor.
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
  const { control, register, setValue, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const linesError = formState.errors.lines;
  const rootMessage =
    typeof linesError?.message === 'string' ? linesError.message : undefined;

  return (
    <section className="space-y-3" data-testid="document-lines">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">
          {t.inventoryDocuments.lines}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => append({ itemId: '', quantity: '', unitId: '' })}
          data-testid="add-document-line"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t.inventoryDocuments.addLine}
        </Button>
      </div>

      {rootMessage !== undefined ? (
        <p role="alert" className="text-xs text-rose-700">
          {rootMessage}
        </p>
      ) : null}

      <ol className="space-y-3">
        {fields.map((field, index) => {
          const errors = formState.errors.lines?.[index];
          const itemId = form.watch(`lines.${index}.itemId`);
          const item = references.itemById(itemId);
          return (
            <li
              key={field.id}
              className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[2fr_1fr_1fr_auto]"
              data-testid={`document-line-${index}`}
            >
              <FormField
                id={`line-${index}-item`}
                label={t.inventoryDocuments.lineItem}
                error={errors?.itemId?.message}
              >
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    {...register(`lines.${index}.itemId`, {
                      onChange: (event: { target: { value: string } }) => {
                        const selected = references.itemById(
                          event.target.value,
                        );
                        if (selected !== undefined) {
                          setValue(
                            `lines.${index}.unitId`,
                            selected.baseUnitId,
                            { shouldValidate: formState.isSubmitted },
                          );
                        }
                      },
                    })}
                    disabled={disabled}
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
                )}
              </FormField>

              <FormField
                id={`line-${index}-quantity`}
                label={t.inventoryDocuments.lineQuantity}
                error={errors?.quantity?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    {...register(`lines.${index}.quantity`)}
                    inputMode="decimal"
                    className="num"
                    disabled={disabled}
                  />
                )}
              </FormField>

              <FormField
                id={`line-${index}-unit`}
                label={t.inventoryDocuments.lineUnit}
                error={errors?.unitId?.message}
              >
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    {...register(`lines.${index}.unitId`)}
                    disabled={disabled || item === undefined}
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
                )}
              </FormField>

              <div className="flex items-end">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={disabled || fields.length === 1}
                  onClick={() => remove(index)}
                  aria-label={t.inventoryDocuments.removeLine}
                  data-testid={`remove-document-line-${index}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
