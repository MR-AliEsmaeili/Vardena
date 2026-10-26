import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatBusinessDay } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { JalaliDateInputField } from '@/ui/patterns/jalali-date-input-field';
import { LoadingState } from '@/ui/patterns/states';
import { Select } from '@/ui/select';
import {
  useActiveItemOptions,
  useActiveUnitOptions,
} from '../master-data-references';
import { useResolveUnitConversion } from './unit-conversion-hooks';

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

/** Read-only backend resolution. Never derive a factor from the list. */
export function UnitConversionResolveSection() {
  const organizationId = useOrganizationId();
  const [params, setParams] = useSearchParams();
  const [fromUnitId, setFromUnitId] = useState(
    params.get('resolveFromUnitId') ?? '',
  );
  const [toUnitId, setToUnitId] = useState(params.get('resolveToUnitId') ?? '');
  const [itemId, setItemId] = useState(params.get('resolveItemId') ?? '');
  const [asOf, setAsOf] = useState(params.get('resolveAsOf') ?? '');
  const units = useActiveUnitOptions(organizationId);
  const items = useActiveItemOptions(organizationId);
  const selectedFrom = params.get('resolveFromUnitId') ?? '';
  const selectedTo = params.get('resolveToUnitId') ?? '';
  const selectedItem = params.get('resolveItemId') ?? '';
  const selectedDay = params.get('resolveAsOf') ?? '';
  const valid =
    ulidPattern.test(selectedFrom) &&
    ulidPattern.test(selectedTo) &&
    selectedFrom !== selectedTo &&
    dayPattern.test(selectedDay) &&
    (selectedItem === '' || ulidPattern.test(selectedItem));
  const query = useResolveUnitConversion(
    valid && organizationId !== null
      ? {
          organizationId,
          fromUnitId: selectedFrom,
          toUnitId: selectedTo,
          asOf: selectedDay,
          ...(selectedItem !== '' ? { itemId: selectedItem } : {}),
        }
      : null,
  );
  const canCheck =
    ulidPattern.test(fromUnitId.trim()) &&
    ulidPattern.test(toUnitId.trim()) &&
    fromUnitId.trim() !== toUnitId.trim() &&
    dayPattern.test(asOf) &&
    (itemId.trim() === '' || ulidPattern.test(itemId.trim()));

  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCheck) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('resolveFromUnitId', fromUnitId.trim());
      next.set('resolveToUnitId', toUnitId.trim());
      next.set('resolveAsOf', asOf);
      if (itemId.trim() !== '') next.set('resolveItemId', itemId.trim());
      else next.delete('resolveItemId');
      return next;
    });
  }

  const result = query.data?.conversion;
  return (
    <div className="space-y-5" data-testid="unit-conversion-resolve-page">
      <h2 className="text-lg font-semibold">
        {t.inventoryMaster.resolveTitle}
      </h2>
      <p className="text-sm text-ink-muted">
        {t.inventoryMaster.resolveSubtitle}
      </p>
      <form
        onSubmit={check}
        className="grid gap-4 rounded-card border border-line p-4 md:grid-cols-2"
      >
        <label className="text-sm text-ink-muted">
          {t.inventoryMaster.resolveFrom}
          {units.items.length > 0 && (
            <Select
              aria-label={t.inventoryMaster.resolveFrom}
              value={fromUnitId}
              onChange={(event) => setFromUnitId(event.target.value)}
            >
              <option value="">{t.inventoryMaster.resolveFrom}</option>
              {units.items.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            aria-label={`${t.inventoryMaster.resolveFrom} — ULID`}
            value={fromUnitId}
            onChange={(event) => setFromUnitId(event.target.value)}
            placeholder="ULID"
            dir="ltr"
          />
        </label>
        <label className="text-sm text-ink-muted">
          {t.inventoryMaster.resolveTo}
          {units.items.length > 0 && (
            <Select
              aria-label={t.inventoryMaster.resolveTo}
              value={toUnitId}
              onChange={(event) => setToUnitId(event.target.value)}
            >
              <option value="">{t.inventoryMaster.resolveTo}</option>
              {units.items.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            aria-label={`${t.inventoryMaster.resolveTo} — ULID`}
            value={toUnitId}
            onChange={(event) => setToUnitId(event.target.value)}
            placeholder="ULID"
            dir="ltr"
          />
        </label>
        <label className="text-sm text-ink-muted">
          {t.inventoryMaster.resolveItem}
          {items.items.length > 0 && (
            <Select
              aria-label={t.inventoryMaster.resolveItem}
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
            >
              <option value="">{t.inventoryMaster.resolveGlobal}</option>
              {items.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            aria-label={`${t.inventoryMaster.resolveItem} — ULID`}
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            placeholder={t.inventoryMaster.resolveGlobal}
            dir="ltr"
          />
        </label>
        <label className="text-sm text-ink-muted">
          {t.inventoryMaster.resolveAsOf}
          <JalaliDateInputField
            aria-label={t.inventoryMaster.resolveAsOf}
            value={asOf}
            onValueChange={setAsOf}
          />
        </label>
        {fromUnitId !== '' && fromUnitId === toUnitId && (
          <p role="alert" className="text-sm text-danger md:col-span-2">
            {t.inventoryMaster.resolveSameUnit}
          </p>
        )}
        <p className="text-xs text-ink-muted md:col-span-2">
          {t.inventoryMaster.resolveManualId}
        </p>
        <div className="md:col-span-2">
          <Button type="submit" disabled={!canCheck} loading={query.isFetching}>
            {t.inventoryMaster.resolveCheck}
          </Button>
        </div>
      </form>
      {valid && query.isPending && (
        <LoadingState rows={2} label={t.app.loading} />
      )}
      {valid && query.isError && (
        <div role="alert" className="text-danger">
          {t.inventoryMaster.resolveFailed}{' '}
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t.inventoryMaster.resolveCheck}
          </Button>
        </div>
      )}
      {valid && query.isSuccess && result === null && (
        <output className="block rounded-card border border-line p-4">
          <h2 className="font-medium">{t.inventoryMaster.resolveEmptyTitle}</h2>
          <p className="text-sm text-ink-muted">
            {t.inventoryMaster.resolveEmptyBody}
          </p>
        </output>
      )}
      {valid && query.isSuccess && result !== null && result !== undefined && (
        <section
          aria-label={t.inventoryMaster.resolveResult}
          className="rounded-card border border-line p-4"
        >
          <h2 className="font-medium">{t.inventoryMaster.resolveResult}</h2>
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <dt>{t.inventoryMaster.resolveFactor}</dt>
            <dd dir="ltr">{result.factor}</dd>
            <dt>{t.inventoryMaster.resolveVersionId}</dt>
            <dd dir="ltr">{result.id}</dd>
            <dt>{t.inventoryMaster.resolveItem}</dt>
            <dd>
              {result.itemId === null
                ? t.inventoryMaster.resolveGlobal
                : result.itemId}
            </dd>
            <dt>{t.inventoryMaster.resolveValidFrom}</dt>
            <dd>{formatBusinessDay(result.validFrom)}</dd>
            <dt>{t.inventoryMaster.resolveValidTo}</dt>
            <dd>
              {result.validTo === null
                ? t.inventoryMaster.resolveOpenEnded
                : formatBusinessDay(result.validTo)}
            </dd>
          </dl>
        </section>
      )}
    </div>
  );
}
