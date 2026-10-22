import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { FormField } from '@/ui/patterns/form-field';
import { JalaliDateInputField } from '@/ui/patterns/jalali-date-input-field';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { Select } from '@/ui/select';
import { Input } from '@/ui/input';
import {
  masterDataErrorMessage,
  type MasterDataErrorMessage,
} from '../master-data-errors';
import { MasterDataFormShell } from '../master-data-form-shell';
import {
  useActiveItemOptions,
  useActiveUnitOptions,
} from '../master-data-references';
import {
  unitConversionSchema,
  type UnitConversionFormValues,
} from '../master-data-schemas';
import { useCreateUnitConversionMutation } from './unit-conversion-hooks';

/**
 * Create a new unit-conversion version (`POST /unit-conversions`).
 *
 * There is deliberately NO edit screen: a conversion is an effective-dated
 * version (ADR-0020 §4) and correcting it means superseding it with a new
 * one. `validFrom` is required; `validTo` empty = open-ended, and the
 * backend closes the previous open-ended version automatically.
 */

export function UnitConversionCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  return <UnitConversionForm organizationId={organizationId} />;
}

function UnitConversionForm({
  organizationId,
}: {
  organizationId: string;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<MasterDataErrorMessage | null>(
    null,
  );

  const form = useForm<UnitConversionFormValues>({
    resolver: zodResolver(unitConversionSchema),
    mode: 'onSubmit',
    defaultValues: {
      scope: 'global',
      itemId: '',
      fromUnitId: '',
      toUnitId: '',
      factor: '',
      validFrom: '',
      validTo: '',
    },
  });

  const units = useActiveUnitOptions(organizationId);
  const items = useActiveItemOptions(organizationId);
  const createMutation = useCreateUnitConversionMutation(organizationId);
  const submitting = createMutation.isPending;
  const scope = form.watch('scope');

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setServerError(null);
    createMutation.mutate(
      {
        ...(values.scope === 'item' ? { itemId: values.itemId } : {}),
        fromUnitId: values.fromUnitId,
        toUnitId: values.toUnitId,
        factor: values.factor,
        validFrom: values.validFrom,
        // Empty = open-ended (the documented absent value).
        ...(values.validTo !== '' ? { validTo: values.validTo } : {}),
      },
      {
        onSuccess: () => {
          showToast({
            kind: 'success',
            message: t.inventoryMaster.conversionCreated,
          });
          navigate('/app/inventory/unit-conversions');
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return;
          setServerError(
            masterDataErrorMessage('unitConversion', 'create', error),
          );
        },
      },
    );
  });

  return (
    <MasterDataFormShell
      title={t.inventoryMaster.newUnitConversion}
      description={t.inventoryMaster.unitConversionsDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.inventoryMaster.create}
      cancelTo="/app/inventory/unit-conversions"
      onSubmit={onSubmit}
      testId="unit-conversion-form"
    >
      <FormField
        id="conversion-scope"
        label={t.inventoryMaster.conversionScope}
        error={form.formState.errors.itemId?.message}
      >
        {() => (
          <Select disabled={submitting} {...form.register('scope')}>
            <option value="global">
              {t.inventoryMaster.conversionScopes.global}
            </option>
            <option value="item">
              {t.inventoryMaster.conversionScopes.item}
            </option>
          </Select>
        )}
      </FormField>

      {scope === 'item' && (
        <FormField
          id="conversion-item"
          label={t.inventoryMaster.conversionItem}
          error={form.formState.errors.itemId?.message}
        >
          {() => (
            <Select
              disabled={submitting || items.unavailable}
              {...form.register('itemId')}
            >
              <option value="">{t.inventoryMaster.allItems}</option>
              {items.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}

      <FormField
        id="conversion-from-unit"
        label={t.inventoryMaster.fromUnit}
        error={form.formState.errors.fromUnitId?.message}
      >
        {() => (
          <Select
            disabled={submitting || units.unavailable}
            {...form.register('fromUnitId')}
          >
            <option value="">{t.inventoryMaster.selectUnit}</option>
            {units.items.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} — {unit.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="conversion-to-unit"
        label={t.inventoryMaster.toUnit}
        hint={t.inventoryMaster.toUnitHint}
        error={form.formState.errors.toUnitId?.message}
      >
        {() => (
          <Select
            disabled={submitting || units.unavailable}
            {...form.register('toUnitId')}
          >
            <option value="">{t.inventoryMaster.selectUnit}</option>
            {units.items.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} — {unit.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="conversion-factor"
        label={t.inventoryMaster.factor}
        hint={t.inventoryMaster.factorHint}
        error={form.formState.errors.factor?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            dir="ltr"
            inputMode="decimal"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('factor')}
          />
        )}
      </FormField>

      <FormField
        id="conversion-valid-from"
        label={t.inventoryMaster.validFrom}
        error={form.formState.errors.validFrom?.message}
      >
        {(fieldProps) => (
          <JalaliDateInputField
            {...fieldProps}
            required
            aria-required="true"
            disabled={submitting}
            value={form.watch('validFrom')}
            onValueChange={(day) =>
              form.setValue('validFrom', day, {
                shouldDirty: true,
              })
            }
          />
        )}
      </FormField>

      <FormField
        id="conversion-valid-to"
        label={t.inventoryMaster.validTo}
        hint={t.inventoryMaster.validToHint}
        error={form.formState.errors.validTo?.message}
      >
        {(fieldProps) => (
          <JalaliDateInputField
            {...fieldProps}
            disabled={submitting}
            value={form.watch('validTo')}
            onValueChange={(day) =>
              form.setValue('validTo', day, {
                shouldDirty: true,
              })
            }
          />
        )}
      </FormField>
    </MasterDataFormShell>
  );
}
