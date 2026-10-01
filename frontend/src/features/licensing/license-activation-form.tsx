import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { FormField } from '@/ui/patterns/form-field';
import { useToast } from '@/ui/patterns/toast';
import {
  licenseActivationErrorMessage,
  type LicenseActivationErrorMessage,
} from './license-activation-errors';
import {
  licenseActivationSchema,
  type LicenseActivationFormValues,
} from './license-activation-schema';
import { useActivateLicenseMutation } from './use-activate-license';

/**
 * The license activation step of the licensing bootstrap stage (L-02).
 *
 * It is rendered by `LicenseGate` in the `inactive` state for a session that
 * holds `Licensing.License.Activate`; it is not a route and not a second
 * application shell — the gate owns the screen and the stage order stays
 * `session → license → organization → workspace`.
 *
 * What it does, and only does: take one code, POST it once, and let the
 * re-read of `GET /license/current` decide. It never marks the installation
 * licensed on its own, keeps no copy of the code (the value lives in this
 * form's state and in the body of the in-flight request — never in
 * `localStorage`, `sessionStorage`, the URL, a query cache entry or a log),
 * and leaves format, signature, binding and lifecycle to the backend.
 *
 * After a rejected code the screen stays exactly where it is, with the error
 * attached to the field and the form ready for another attempt: an invalid
 * license can never strand the installation.
 */
export function LicenseActivationForm({
  installationId,
}: {
  installationId: string | null;
}) {
  const { showToast } = useToast();
  const [failure, setFailure] = useState<LicenseActivationErrorMessage | null>(
    null,
  );

  const form = useForm<LicenseActivationFormValues>({
    resolver: zodResolver(licenseActivationSchema),
    defaultValues: { code: '' },
    mode: 'onSubmit',
  });

  const mutation = useActivateLicenseMutation();

  const onSubmit = form.handleSubmit((values) => {
    // Guards a second submit fired before React re-rendered the disabled
    // button (double click, repeated Enter).
    if (mutation.isPending) return;
    setFailure(null);
    mutation.mutate(
      { code: values.code },
      {
        onSuccess: (result) => {
          // The POST succeeded AND the authoritative re-read has settled
          // (the mutation awaits the license invalidation). The code is
          // dropped from the form as soon as it is no longer needed.
          form.reset({ code: '' });
          showToast({
            kind: 'success',
            message: result.changed
              ? t.license.activateSuccess
              : t.license.activateUnchanged,
          });
        },
        onError: (error) => {
          const presented = licenseActivationErrorMessage(error);
          setFailure(presented);
          if (presented.rejectedCode) {
            // A refused code is known-bad: clearing it prevents resubmitting
            // the same value by reflex. A transport failure keeps the value
            // so the retry costs the operator nothing.
            form.resetField('code');
          }
          form.setFocus('code');
        },
      },
    );
  });

  const fieldError = form.formState.errors.code?.message ?? failure?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.license.activateTitle}</CardTitle>
        <CardDescription>{t.license.activateBody}</CardDescription>
      </CardHeader>
      <CardContent>
        {installationId !== null && (
          <p className="mb-4 text-sm text-slate-600">
            {t.license.installationIdLabel}:{' '}
            <span className="code" dir="ltr">
              {installationId}
            </span>
          </p>
        )}

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <FormField
            id="license-code"
            label={t.license.activateCodeLabel}
            error={fieldError}
            hint={t.license.activateCodeHint}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="text"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                aria-required="true"
                disabled={mutation.isPending}
                {...form.register('code')}
              />
            )}
          </FormField>

          {/*
            The failure message itself is rendered once, under the field
            (`FormField` gives it `role="alert"` and wires `aria-describedby`).
            Only the support correlation id is added here — it is data, not a
            second copy of the same sentence.
          */}
          {failure?.correlationId !== undefined && (
            <p className="text-xs text-slate-500">
              {t.errors.correlationId}:{' '}
              <span className="code" dir="ltr">
                {failure.correlationId}
              </span>
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
          >
            {mutation.isPending
              ? t.license.activateSubmitting
              : t.license.activateSubmit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
