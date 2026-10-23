import type { AccountBalance } from '@/api/contracts';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card } from '@/ui/card';
import { Skeleton } from '@/ui/skeleton';
import { SparkLine } from './charts/spark-line';
import { aggregateKpis, presentKpis } from '../lib/kpis';

/**
 * KPI row (four compact cards).
 *
 * Values are the backend-derived period aggregates of the dashboard scope:
 * total debit/credit turnover, net turnover and the count of accounting-period
 * buckets represented by the projection. Formatting goes only through the
 * central formatters; negative net renders danger-ink (FR-7).
 */
export function KpiRow({
  balances,
  isLoading,
  isPermitted = true,
  scopeMissing = false,
}: {
  balances: AccountBalance[] | undefined;
  isLoading: boolean;
  isPermitted?: boolean;
  scopeMissing?: boolean;
}) {
  if (!isPermitted || scopeMissing) {
    return (
      <section aria-label={t.dashboard.kpiSectionLabel}>
        <p className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-6 text-center text-xs text-ink-subtle">
          {scopeMissing ? t.dashboard.scopeMissing : t.dashboard.noPermission}
        </p>
      </section>
    );
  }

  if (isLoading || balances === undefined) {
    return (
      <section aria-label={t.dashboard.kpiSectionLabel} aria-busy="true">
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Card key={index} className="space-y-2.5 px-4 py-4">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      </section>
    );
  }

  const kpis = aggregateKpis(balances);
  const present = presentKpis(kpis);
  // Display-only conversion for spark-line coordinates; exact strings remain
  // authoritative for every KPI and tooltip.
  const spark = kpis.periodTurnover.map((entry) => Number(entry.net) || 0);
  const periodsWithTurnover = kpis.periodTurnover.filter(
    (entry) =>
      !/^[-+]?0*(?:\.0*)?$/.test(entry.debit) ||
      !/^[-+]?0*(?:\.0*)?$/.test(entry.credit),
  ).length;

  const cards = [
    {
      label: t.dashboard.kpiTotalDebit,
      value: present.debit,
      negative: false,
      sub: t.dashboard.kpiPeriodScope,
      sparkClass: 'text-brand',
    },
    {
      label: t.dashboard.kpiTotalCredit,
      value: present.credit,
      negative: false,
      sub: t.dashboard.kpiPeriodScope,
      sparkClass: 'text-ok-ink',
    },
    {
      label: t.dashboard.kpiTotalNet,
      value: present.net,
      negative: present.netNegative,
      sub: t.dashboard.kpiPeriodScope,
      sparkClass: present.netNegative ? 'text-danger' : 'text-info-ink',
    },
    {
      label: t.dashboard.kpiPeriodsWithTurnover,
      value: formatCount(periodsWithTurnover),
      negative: false,
      sub: t.dashboard.kpiPeriodsScope,
      sparkClass: 'text-ink-subtle',
    },
  ];

  return (
    <section aria-label={t.dashboard.kpiSectionLabel}>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} className="px-4 py-4">
            <p className="mb-1.5 text-xs font-semibold text-ink-muted">
              {card.label}
            </p>
            <p className="flex items-baseline gap-1.5">
              <span
                className={`num text-xl font-extrabold ${
                  card.negative ? 'text-danger-ink' : 'text-ink'
                }`}
                title={card.value}
              >
                {card.value}
              </span>
              {card.label !== t.dashboard.kpiPeriodsWithTurnover && (
                <span className="text-[0.6875rem] font-medium text-ink-subtle">
                  {t.dashboard.kpiUnit}
                </span>
              )}
            </p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <span className="text-[0.6875rem] text-ink-subtle">
                {card.sub}
              </span>
              <SparkLine points={spark} className={card.sparkClass} />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
