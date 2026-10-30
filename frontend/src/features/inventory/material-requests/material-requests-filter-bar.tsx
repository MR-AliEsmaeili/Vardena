import { useForm } from 'react-hook-form';
import {
  MATERIAL_REQUEST_STATUSES,
  type MaterialRequestStatus,
} from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import type { MaterialRequestsUrlState } from './material-request-url-state';

export type MaterialRequestsFilterValues = Pick<
  MaterialRequestsUrlState,
  'status' | 'requestedBy'
>;

export function materialRequestsFilterValuesFromUrl(
  state: MaterialRequestsUrlState,
): MaterialRequestsFilterValues {
  return { status: state.status, requestedBy: state.requestedBy };
}

function isStatus(value: string): value is MaterialRequestStatus {
  return (MATERIAL_REQUEST_STATUSES as readonly string[]).includes(value);
}

/**
 * URL-owned filters: the closed status list and the requester id. There is no
 * user picker in this surface because the UI has no permission-gated user
 * directory here — an id is typed as the backend filter expects it (ULID) and
 * an invalid one is dropped by the URL parser instead of failing the list.
 */
export function MaterialRequestsFilterBar({
  values,
  synchronizationKey,
  isFetching,
  onApply,
  onClear,
}: {
  values: MaterialRequestsFilterValues;
  synchronizationKey: string;
  isFetching: boolean;
  onApply: (values: MaterialRequestsFilterValues) => void;
  onClear: () => void;
}) {
  const form = useForm<MaterialRequestsFilterValues>({
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
      aria-label={t.materialRequests.filtersTitle}
    >
      <FilterField label={t.materialRequests.status}>
        <Select
          className="h-9"
          {...form.register('status', {
            setValueAs: (value: string) => (isStatus(value) ? value : ''),
          })}
        >
          <option value="">{t.materialRequests.allStatuses}</option>
          {MATERIAL_REQUEST_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t.materialRequests.statuses[status]}
            </option>
          ))}
        </Select>
      </FilterField>

      <FilterField label={t.materialRequests.requestedBy}>
        <Input
          className="h-9"
          dir="ltr"
          placeholder="01ARZ3NDEKTSV4RRFFQ69G5FAV"
          {...form.register('requestedBy')}
        />
      </FilterField>
    </FilterBar>
  );
}
