import type { AccountStatement } from '@/api/contracts';
import { AmountCell } from '@/features/accounting/shared/amount-cell';
import { formatDateOnly } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Card, CardContent } from '@/ui/card';

/**
 * Scope echo + totals of an account statement.
 *
 * Every figure is rendered straight from the response
 * (`totals.*`, exact decimal strings): the opening balance, the debit/credit
 * totals, the net change and the closing balance are computed by the backend
 * and are NOT recombined, re-added or re-derived here.
 */
export function AccountStatementSummary({
  statement,
}: {
  statement: AccountStatement;
}) {
  const { scope, totals } = statement;

  const figures: { label: string; value: string; strong?: boolean }[] = [
    { label: t.statement.openingBalance, value: totals.openingBalanceAmount },
    { label: t.statement.debitTotal, value: totals.debitTotalAmount },
    { label: t.statement.creditTotal, value: totals.creditTotalAmount },
    { label: t.statement.netChange, value: totals.netChangeAmount },
    {
      label: t.statement.closingBalance,
      value: totals.closingBalanceAmount,
      strong: true,
    },
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-slate-500">{t.statement.scope}:</span>
          <span>
            <span className="text-slate-500">{t.filters.account}: </span>
            <span className="code">{scope.account.code}</span> —{' '}
            {scope.account.title}
          </span>
          <span>
            <span className="text-slate-500">{t.filters.financialArea}: </span>
            <span className="code">{scope.financialArea.code}</span> —{' '}
            {scope.financialArea.title}
          </span>
          <span>
            <span className="text-slate-500">{t.filters.fiscalYear}: </span>
            <span className="code">{scope.fiscalYear.code}</span> (
            <span className="code">
              {formatDateOnly(scope.fiscalYear.startDate)}
            </span>{' '}
            …{' '}
            <span className="code">
              {formatDateOnly(scope.fiscalYear.endDate)}
            </span>
            )
          </span>
          <span>
            <span className="text-slate-500">
              {t.filters.accountingPeriod}:{' '}
            </span>
            {scope.accountingPeriod === null
              ? t.filters.allPeriods
              : `${scope.accountingPeriod.sequence} — ${scope.accountingPeriod.title}`}
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {figures.map((figure) => (
          <Card key={figure.label}>
            <CardContent className="space-y-1 p-3">
              <p className="text-xs text-slate-500">{figure.label}</p>
              <AmountCell
                value={figure.value}
                className={
                  figure.strong
                    ? 'text-lg font-semibold'
                    : 'text-base font-medium'
                }
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge variant="neutral">
          {t.statement.signConvention}:{' '}
          <span className="code ms-1">{statement.signConvention}</span>
        </Badge>
        <Badge variant="neutral">
          {t.statement.openingBasis}:{' '}
          <span className="code ms-1">{statement.openingBasis}</span>
        </Badge>
        <Badge variant="neutral">
          {t.statement.orderBasis}:{' '}
          <span className="code ms-1">{statement.orderBasis}</span>
        </Badge>
      </div>
    </div>
  );
}
