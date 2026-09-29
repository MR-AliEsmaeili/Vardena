import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';

export interface ApiErrorAlertProps {
  error: unknown;
  title?: string;
  /**
   * Semantic UX copy to render in place of the code-derived message. Used when
   * the calling surface owns a more specific, operation-scoped Persian message
   * (e.g. the login form's credential rejection). It must be dictionary copy —
   * never a raw backend `message` (FE-UX-02 §2.1).
   */
  description?: string | undefined;
  onRetry?: () => void;
}

/**
 * The single renderer for a failed API call.
 *
 * It shows the normalized, code-derived message (or an explicit `description`
 * override supplied by the caller) plus the backend correlation id (the id the
 * server logged the failure under). It never renders raw server internals and
 * never uses `dangerouslySetInnerHTML`.
 */
export function ApiErrorAlert({
  error,
  title,
  description,
  onRetry,
}: ApiErrorAlertProps) {
  const apiError = normalizeApiError(error);
  return (
    <Alert variant="danger" role="alert">
      <AlertTitle>{title ?? t.errors.title}</AlertTitle>
      <AlertBody>
        <p>{description ?? apiError.message}</p>
        {apiError.correlationId !== undefined && (
          <p className="mt-2 text-xs text-rose-800/80">
            {t.errors.correlationId}:{' '}
            <span className="code">{apiError.correlationId}</span>
          </p>
        )}
        {onRetry !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onRetry}
          >
            {t.app.retry}
          </Button>
        )}
      </AlertBody>
    </Alert>
  );
}
