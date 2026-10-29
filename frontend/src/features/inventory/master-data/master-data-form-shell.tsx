import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { useWorkspaceWindowDirty } from '@/app/workspace/workspace-context';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import type { MasterDataErrorMessage } from './master-data-errors';

/**
 * The create/edit form chrome shared by the inventory master-data forms
 * (standards.md §9) — the inventory twin of the organization form shell.
 *
 * Guarantees for every form that uses it:
 * - the server-side failure is a PERSISTENT summary above the form with
 *   `aria-live`, never a toast;
 * - the submit button is disabled while the request is in flight;
 * - leaving a dirty form is confirmed — in-app (cancel) and at the browser
 *   level (`beforeunload`).
 */

export interface MasterDataFormShellProps {
  title: string;
  description?: string;
  /** Mapped Persian failure of the last submit, or `null`. */
  error: MasterDataErrorMessage | null;
  isDirty: boolean;
  submitting: boolean;
  submitLabel: string;
  /** Where cancel (and a confirmed dirty exit) returns to. */
  cancelTo: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  testId: string;
  children: ReactNode;
}

export function MasterDataFormShell({
  title,
  description,
  error,
  isDirty,
  submitting,
  submitLabel,
  cancelTo,
  onSubmit,
  testId,
  children,
}: MasterDataFormShellProps) {
  const navigate = useNavigate();
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  // ADR-0054 (§4.7): the workspace dock shows this form's dirty
  // state and guards window close — the page's own leave-confirm
  // guards stay untouched (no double dialog: the dock dialog only
  // runs from dock/reset flows).
  useWorkspaceWindowDirty(isDirty);

  const leave = () => {
    if (isDirty) setConfirmLeave(true);
    else navigate(cancelTo);
  };

  return (
    <div className="space-y-4">
      <FormPageHeader
        title={title}
        {...(description !== undefined ? { description } : {})}
      />

      {/* The failed submit is announced politely and stays on screen. */}
      <div aria-live="polite">
        {error !== null && (
          <Alert variant="danger" role="alert">
            <AlertTitle>{t.errors.title}</AlertTitle>
            <AlertBody>
              <p>{error.message}</p>
              {error.correlationId !== undefined && (
                <p className="mt-2 text-xs text-danger-ink/85">
                  {t.errors.correlationId}:{' '}
                  <span className="code">{error.correlationId}</span>
                </p>
              )}
            </AlertBody>
          </Alert>
        )}
      </div>

      <Card>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={onSubmit}
            noValidate
            data-testid={testId}
          >
            <div className="grid gap-4 sm:grid-cols-2">{children}</div>

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <Button
                type="submit"
                disabled={submitting}
                loading={submitting}
                data-testid={`${testId}-submit`}
              >
                {submitting ? t.inventoryMaster.saving : submitLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={leave}
                disabled={submitting}
              >
                {t.app.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmLeave}
        title={t.inventoryMaster.dirtyLeaveTitle}
        description={t.inventoryMaster.dirtyLeaveDescription}
        confirmLabel={t.inventoryMaster.dirtyLeaveConfirm}
        danger
        onConfirm={() => {
          setConfirmLeave(false);
          navigate(cancelTo);
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
