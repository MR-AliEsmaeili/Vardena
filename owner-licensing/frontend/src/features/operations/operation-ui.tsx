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
    <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
      <p role="note">{o.manualBanner}</p>
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
