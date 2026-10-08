import { Controller, type UseFormReturn } from 'react-hook-form';
import type { InventoryDocumentKind } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { useCalendarSystem } from '@/lib/datetime';
import { Input } from '@/ui/input';
import { DateInput } from '@/ui/patterns/date-input';
import { Select } from '@/ui/select';
import { FormField } from '@/ui/patterns/form-field';
import type { InventoryReferences } from '../use-inventory-references';
import { acceptsCost } from './inventory-document-labels';
import type { DocumentFormValues } from './inventory-document-form-schema';

/**
 * Header fields of a business document.
 *
 * The warehouse shape follows the kind: a receipt/issue has ONE warehouse, a
 * transfer has a source and a destination that must differ. The cost field
 * exists only where the contract accepts one — a receipt, with a single
 * line, for a session holding `Inventory.Valuation.AssignCost`; an issue
 * never shows it, because issue value is derived by the valuation method
 * and is never typed by an operator (OD-VAL-07).
 */
export function DocumentHeaderFields({
  form,
  references,
  kind,
  disabled,
}: {
  form: UseFormReturn<DocumentFormValues>;
  references: InventoryReferences;
  kind: InventoryDocumentKind;
  disabled: boolean;
}) {
  const permissions = usePermissions();
  const { register, formState, watch } = form;
  const calendarSystem = useCalendarSystem();
  const errors = formState.errors;
  const lineCount = watch('lines').length;
  const mayAssignCost = permissions.has(
    PERMISSIONS.inventory.valuationAssignCost,
  );
  const costAllowed = acceptsCost(kind, lineCount);

  const warehouseOptions = references.warehouses.map((warehouse) => (
    <option key={warehouse.id} value={warehouse.id}>
      {warehouse.code} — {warehouse.name}
    </option>
  ));

  return (
    <section className="grid gap-4 md:grid-cols-2">
      <FormField
        id="document-business-date"
        label={t.inventoryDocuments.businessDate}
        error={errors.businessDate?.message}
        hint={
          calendarSystem === 'JALALI'
            ? t.filters.dateFormatHintJalali
            : t.filters.dateFormatHint
        }
      >
        {(fieldProps) => (
          <Controller
            control={form.control}
            name="businessDate"
            render={({ field }) => (
              <DateInput
                {...fieldProps}
                id="document-business-date"
                value={field.value}
                onValueChange={field.onChange}
                disabled={disabled}
                data-testid="document-business-date"
              />
            )}
          />
        )}
      </FormField>

      {kind === 'transfer' ? (
        <>
          <FormField
            id="document-source-warehouse"
            label={t.inventoryDocuments.sourceWarehouse}
            error={errors.sourceWarehouseId?.message}
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                {...register('sourceWarehouseId')}
                disabled={disabled}
              >
                <option value="">
                  {t.inventoryDocuments.selectPlaceholder}
                </option>
                {warehouseOptions}
              </Select>
            )}
          </FormField>
          <FormField
            id="document-destination-warehouse"
            label={t.inventoryDocuments.destinationWarehouse}
            error={errors.destinationWarehouseId?.message}
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                {...register('destinationWarehouseId')}
                disabled={disabled}
              >
                <option value="">
                  {t.inventoryDocuments.selectPlaceholder}
                </option>
                {warehouseOptions}
              </Select>
            )}
          </FormField>
        </>
      ) : (
        <FormField
          id="document-warehouse"
          label={t.inventoryDocuments.warehouse}
          error={errors.warehouseId?.message}
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              {...register('warehouseId')}
              disabled={disabled}
            >
              <option value="">{t.inventoryDocuments.selectPlaceholder}</option>
              {warehouseOptions}
            </Select>
          )}
        </FormField>
      )}

      {kind === 'receipt' && mayAssignCost ? (
        <FormField
          id="document-cost"
          label={t.inventoryDocuments.cost}
          error={errors.cost?.message}
          hint={
            costAllowed
              ? t.inventoryDocuments.costHint
              : t.inventoryDocuments.costMultiLineDisabled
          }
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...register('cost')}
              inputMode="decimal"
              className="num"
              disabled={disabled || !costAllowed}
              data-testid="document-cost"
            />
          )}
        </FormField>
      ) : null}

      {kind === 'issue' ? (
        <p className="self-end text-xs text-slate-500">
          {t.inventoryDocuments.issueNoCost}
        </p>
      ) : null}
      {kind === 'transfer' ? (
        <p className="self-end text-xs text-slate-500">
          {t.inventoryDocuments.transferNoCost}
        </p>
      ) : null}

      <FormField
        id="document-reference"
        label={t.inventoryDocuments.reference}
        error={errors.reference?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register('reference')}
            disabled={disabled}
          />
        )}
      </FormField>

      <FormField
        id="document-description"
        label={t.inventoryDocuments.description}
        error={errors.description?.message}
        className="md:col-span-2"
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register('description')}
            disabled={disabled}
          />
        )}
      </FormField>
    </section>
  );
}
