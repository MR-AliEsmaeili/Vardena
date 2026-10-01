import { useState, type FormEvent } from 'react';
import { FolderKanban } from 'lucide-react';
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
import { useOrganization } from '@/features/organization/use-organization';

/** Explicit area selection when more than one active area is available. */
export function FinancialAreaSelection({ invalid }: { invalid: boolean }) {
  const { financialAreas, selectFinancialArea } = useOrganization();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const validChosenId = financialAreas.some((item) => item.id === chosenId)
    ? chosenId
    : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validChosenId !== null) selectFinancialArea(validChosenId);
  };

  return (
    <div className="w-full space-y-4">
      {invalid && (
        <Alert variant="warning">
          <AlertTitle>{t.financialContext.areaInvalidTitle}</AlertTitle>
          <AlertBody>{t.financialContext.areaInvalidBody}</AlertBody>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-indigo-600" aria-hidden />
            {t.financialContext.areaTitle}
          </CardTitle>
          <CardDescription>{t.financialContext.areaBody}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div
              className="space-y-2"
              role="radiogroup"
              aria-label={t.financialContext.areaTitle}
            >
              {financialAreas.map((area) => (
                <label
                  key={area.id}
                  aria-label={area.title}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                    validChosenId === area.id
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  )}
                >
                  <input
                    type="radio"
                    name="financial-area"
                    value={area.id}
                    checked={validChosenId === area.id}
                    onChange={() => setChosenId(area.id)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">
                      {area.title}
                    </span>
                    <span className="code text-xs text-slate-500">
                      {area.code}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={validChosenId === null}
            >
              {t.financialContext.continue}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
