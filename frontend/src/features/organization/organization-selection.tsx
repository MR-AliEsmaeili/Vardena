import { useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { useOrganization } from './use-organization';

/**
 * The explicit organization selection step (FE-UX-04).
 *
 * Rendered only while several organizations are available and none has been
 * confirmed yet (`selecting`), or when the confirmed one disappeared from the
 * list (`invalid`). No organization-scoped request is in flight while this
 * screen is up — the context keeps `organizationId` null until the user
 * confirms, so the workspace below can never show another organization's
 * data by accident.
 *
 * Accessibility: a native radio group (arrow keys move, space/enter select)
 * inside a form, so the whole step is operable from the keyboard alone.
 */
export function OrganizationSelection({ invalid }: { invalid: boolean }) {
  const { organizations, selectOrganization } = useOrganization();
  const [chosenId, setChosenId] = useState<string | null>(null);

  // `null` is an intentional UX state: in a multi-organization session the
  // user must make an explicit choice before continuing. If the list changes
  // underneath the screen, a choice that is no longer offered becomes invalid
  // during render rather than silently falling back to another organization.
  const validChosenId = organizations.some((item) => item.id === chosenId)
    ? chosenId
    : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validChosenId !== null) {
      selectOrganization(validChosenId);
    }
  };

  return (
    <div className="w-full space-y-4">
      {invalid && (
        <Alert variant="warning">
          <AlertTitle>{t.organization.invalidTitle}</AlertTitle>
          <AlertBody>{t.organization.invalidBody}</AlertBody>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-indigo-600" aria-hidden />
            {t.organization.selectingTitle}
          </CardTitle>
          <CardDescription>{t.organization.selectingSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <fieldset className="space-y-2">
              <legend className="sr-only">
                {t.organization.selectingTitle}
              </legend>
              {organizations.map((item) => {
                const checked = item.id === validChosenId;
                return (
                  <label
                    key={item.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                      checked
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="radio"
                      name="organization"
                      value={item.id}
                      checked={checked}
                      onChange={() => setChosenId(item.id)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                      {item.name}
                    </span>
                    <span className="code text-xs text-slate-500" dir="ltr">
                      {item.code}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <Button
              type="submit"
              className="mt-4 w-full"
              disabled={validChosenId === null}
            >
              {t.organization.selectingSubmit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
