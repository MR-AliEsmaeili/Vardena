import { lazy, Suspense, type ReactElement } from 'react';
import type { AccountBalance } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Skeleton } from '@/ui/skeleton';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { buildTurnoverSeries } from '../lib/chart-series';
import { formatAmount } from '@/lib/format';
import { aggregateKpis, topAccountsByTurnover } from '../lib/kpis';

/**
 * Chart area (reference layout: one 2:1 row + one 1:1 row).
 *
 * The four reference charts are mapped to the contract's real read models:
 *   1. Income vs expense trend   → debit/credit turnover per period.
 *   2. Branch sales donut        → net turnover share per period (ShareBars).
 *   3. Weekly cash flow          → net per period, grouped bars (debit/credit).
 *   4. Largest debtors           → top accounts by turnover (RankedBars).
 *
 * Charts are lazy-loaded so the dashboard's first paint stays within budget
 * (FR-14: نمودارها فقط lazy). The primitives are dependency-free SVG.
 */
const GroupedBarChart = lazy(() =>
  import('./charts/grouped-bar-chart').then((m) => ({
    default: m.GroupedBarChart,
  })),
);
const RankedBars = lazy(() =>
  import('./charts/ranked-bars').then((m) => ({ default: m.RankedBars })),
);
const ShareBars = lazy(() =>
  import('./charts/ranked-bars').then((m) => ({ default: m.ShareBars })),
);

function ChartSkeleton(): ReactElement {
  return <Skeleton className="h-56 w-full" />;
}

function ChartCard({
  title,
  subtitle,
  children,
  badge,
}: {
  title: string;
  subtitle: string;
  children: ReactElement;
  badge?: ReactElement;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-bold">{title}</CardTitle>
          <CardDescription className="text-[11px]">{subtitle}</CardDescription>
        </div>
        {badge}
      </CardHeader>
      <div className="px-3 pb-3 pt-1">{children}</div>
    </Card>
  );
}

export function ChartsSection({
  balances,
  error,
  onRetry,
  isPermitted = true,
  scopeMissing = false,
}: {
  balances: AccountBalance[] | undefined;
  error?: unknown;
  onRetry?: () => void;
  isPermitted?: boolean;
  scopeMissing?: boolean;
}): ReactElement {
  if (!isPermitted || scopeMissing) {
    return (
      <div
        className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-6 text-center text-xs text-slate-500"
        aria-label={t.dashboard.chartsSectionLabel}
      >
        {scopeMissing ? t.dashboard.scopeMissing : t.dashboard.noPermission}
      </div>
    );
  }

  if (error !== undefined) {
    return (
      <div className="space-y-4" aria-label={t.dashboard.chartsSectionLabel}>
        <ApiErrorAlert
          error={error}
          title={t.dashboardErrors.charts}
          {...(onRetry !== undefined ? { onRetry } : {})}
        />
      </div>
    );
  }

  if (balances === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard
              title={t.dashboard.chartTurnoverTitle}
              subtitle={t.dashboard.chartTurnoverSubtitle}
            >
              <ChartSkeleton />
            </ChartCard>
          </div>
          <ChartCard
            title={t.dashboard.chartNetTitle}
            subtitle={t.dashboard.chartNetSubtitle}
          >
            <ChartSkeleton />
          </ChartCard>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title={t.dashboard.chartMovementsTitle}
            subtitle={t.dashboard.chartMovementsSubtitle}
          >
            <ChartSkeleton />
          </ChartCard>
          <ChartCard
            title={t.dashboard.chartTopAccountsTitle}
            subtitle={t.dashboard.chartTopAccountsSubtitle}
          >
            <ChartSkeleton />
          </ChartCard>
        </div>
      </div>
    );
  }

  const series = buildTurnoverSeries(balances);
  const periodLabels = series.sequences.map(
    (sequence) => `${t.dashboard.chartPeriodShort} ${sequence}`,
  );
  const kpis = aggregateKpis(balances);
  const netPositive = !kpis.totalNet.trim().startsWith('-');
  const shareItems = kpis.periodTurnover.map((entry) => ({
    label: `${t.dashboard.chartPeriodShort} ${entry.periodSequence}`,
    value: entry.net.replace('-', ''),
  }));
  const topItems = topAccountsByTurnover(balances).map((item) => ({
    label: item.accountId,
    value: item.total,
  }));

  const empty = balances.length === 0;

  return (
    <div className="space-y-4" aria-label={t.dashboard.chartsSectionLabel}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard
            title={t.dashboard.chartTurnoverTitle}
            subtitle={t.dashboard.chartTurnoverSubtitle}
          >
            <Suspense fallback={<ChartSkeleton />}>
              {empty ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  {t.dashboard.chartEmpty}
                </p>
              ) : (
                <GroupedBarChart
                  seriesA={series.debit.map((value, index) => ({
                    label: periodLabels[index] ?? '',
                    value,
                  }))}
                  seriesB={series.credit.map((value, index) => ({
                    label: periodLabels[index] ?? '',
                    value,
                  }))}
                  labelA={t.dashboard.chartTurnoverDebit}
                  labelB={t.dashboard.chartTurnoverCredit}
                  description={`${t.dashboard.chartAriaPrefix} ${t.dashboard.chartTurnoverTitle}`}
                />
              )}
            </Suspense>
          </ChartCard>
        </div>
        <ChartCard
          title={t.dashboard.chartNetTitle}
          subtitle={t.dashboard.chartNetSubtitle}
          badge={
            <Badge variant={netPositive ? 'success' : 'danger'} className="num">
              {formatAmount(kpis.totalNet)}
            </Badge>
          }
        >
          <Suspense fallback={<ChartSkeleton />}>
            {empty ? (
              <p className="py-8 text-center text-xs text-slate-500">
                {t.dashboard.chartEmpty}
              </p>
            ) : (
              <ShareBars
                items={shareItems}
                description={`${t.dashboard.chartAriaPrefix} ${t.dashboard.chartNetTitle}`}
              />
            )}
          </Suspense>
        </ChartCard>
      </div>
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        aria-label={t.dashboard.chartsOperationalLabel}
      >
        <ChartCard
          title={t.dashboard.chartMovementsTitle}
          subtitle={t.dashboard.chartMovementsSubtitle}
        >
          <Suspense fallback={<ChartSkeleton />}>
            {empty ? (
              <p className="py-8 text-center text-xs text-slate-500">
                {t.dashboard.chartEmpty}
              </p>
            ) : (
              <GroupedBarChart
                seriesA={kpis.periodTurnover.map((entry) => ({
                  label:
                    periodLabels[
                      series.sequences.indexOf(entry.periodSequence)
                    ] ??
                    `${t.dashboard.chartPeriodShort} ${entry.periodSequence}`,
                  value: entry.debit,
                }))}
                seriesB={kpis.periodTurnover.map((entry) => ({
                  label:
                    periodLabels[
                      series.sequences.indexOf(entry.periodSequence)
                    ] ??
                    `${t.dashboard.chartPeriodShort} ${entry.periodSequence}`,
                  value: entry.credit,
                }))}
                labelA={t.dashboard.chartTurnoverDebit}
                labelB={t.dashboard.chartTurnoverCredit}
                description={`${t.dashboard.chartAriaPrefix} ${t.dashboard.chartMovementsTitle}`}
              />
            )}
          </Suspense>
        </ChartCard>
        <ChartCard
          title={t.dashboard.chartTopAccountsTitle}
          subtitle={t.dashboard.chartTopAccountsSubtitle}
        >
          <Suspense fallback={<ChartSkeleton />}>
            <RankedBars
              items={topItems}
              description={`${t.dashboard.chartAriaPrefix} ${t.dashboard.chartTopAccountsTitle}`}
            />
          </Suspense>
        </ChartCard>
      </div>
    </div>
  );
}
