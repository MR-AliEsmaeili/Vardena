import { useState, type FormEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatDateOnly, formatDateOnlyCanonical } from '@/lib/format';
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

/** Explicit fiscal-year selection when the active area has multiple open years. */
export function FiscalYearSelection({ invalid }: { invalid: boolean }) {
  const { fiscalYears, selectFiscalYear } = useOrganization();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const validChosenId = fiscalYears.some((item) => item.id === chosenId)
    ? chosenId
    : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validChosenId !== null) selectFiscalYear(validChosenId);
  };

  return (
    <div className="w-full space-y-4">
      {invalid && (
        <Alert variant="warning">
          <AlertTitle>{t.financialContext.fiscalYearInvalidTitle}</AlertTitle>
          <AlertBody>{t.financialContext.fiscalYearInvalidBody}</AlertBody>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-indigo-600" aria-hidden />
            {t.financialContext.fiscalYearTitle}
          </CardTitle>
          <CardDescription>{t.financialContext.fiscalYearBody}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div
              className="space-y-2"
              role="radiogroup"
              aria-label={t.financialContext.fiscalYearTitle}
            >
              {fiscalYears.map((year) => (
                <label
                  key={year.id}
                  aria-label={year.title}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                    validChosenId === year.id
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  )}
                >
                  <input
                    type="radio"
                    name="fiscal-year"
                    value={year.id}
                    checked={validChosenId === year.id}
                    onChange={() => setChosenId(year.id)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">
                      {year.title}
                    </span>
                    <span
                      className="code block text-xs text-slate-500"
                      title={`${formatDateOnlyCanonical(year.startDate)} — ${formatDateOnlyCanonical(year.endDate)}`}
                    >
                      {year.code} · {formatDateOnly(year.startDate)} —{' '}
                      {formatDateOnly(year.endDate)}
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
