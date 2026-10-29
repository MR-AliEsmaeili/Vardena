import { normalizeApiError } from '@/api/errors';
import { o } from '@/lib/owner-i18n';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';

const labels: Record<string, string> = o.statuses;
export function labelOf(code: string | null | undefined) {
  if (!code) return '—';
  return labels[code] ?? code;
}
export function ManualNotice() {
  return (
    <div className="space-y-1.5 rounded-control border border-warning-line border-s-4 border-s-warning bg-warning-soft p-3.5 text-xs leading-6 text-warning">
      <p role="note" className="font-semibold">
        {o.manualBanner}
      </p>
      <p>{o.notReceipt}</p>
      <p>{o.deviceOutOfScope}</p>
      <p>{o.limitation}</p>
    </div>
  );
}
export function OperationError({ error }: { error: unknown }) {
  const apiError = normalizeApiError(error);
  const description =
    apiError.code === 'InvalidTransition'
      ? o.invalidTransition
      : apiError.code === 'DuplicateOperation' || apiError.code === 'Conflict'
        ? o.conflictOperation
        : apiError.code === 'PermissionDenied'
          ? o.forbidden
          : apiError.code === 'EntityNotFound'
            ? undefined
            : o.operationError;
  return <ApiErrorAlert error={error} description={description} />;
}
