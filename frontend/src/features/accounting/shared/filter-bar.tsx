import type { FormEventHandler, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/ui/card';

export interface FilterBarProps {
  onSubmit: FormEventHandler<HTMLFormElement>;
  onReset: () => void;
  children: ReactNode;
  disabled?: boolean;
  isFetching?: boolean;
}

/**
 * Shared shell for the report filter forms: one card, one grid of fields and
 * one explicit "apply" action. Filters are applied on submit (not on every
 * keystroke) so each report request is intentional and server-side.
 */
export function FilterBar({
  onSubmit,
  onReset,
  children,
  disabled = false,
  isFetching = false,
}: FilterBarProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.filters.title}</CardTitle>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {children}
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            disabled={disabled}
          >
            {t.filters.reset}
          </Button>
          <Button type="submit" disabled={disabled || isFetching}>
            {isFetching ? t.app.loading : t.filters.submit}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
