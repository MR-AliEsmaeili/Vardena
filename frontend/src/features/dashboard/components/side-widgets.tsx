import type { ReactElement } from 'react';
import { Boxes, ClipboardCheck, FileLock2, ShieldQuestion } from 'lucide-react';
import type { InventoryBalance, WorkflowInstance } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, UnavailableState } from '@/ui/patterns/states';
import { formatCount, formatDateTime, formatQuantity } from '@/lib/format';

export function WorkflowWidget({
  instances,
  isLoading,
  isPermitted,
  error,
  onRetry,
}: {
  instances: WorkflowInstance[] | undefined;
  isLoading: boolean;
  isPermitted: boolean;
  error?: unknown;
  onRetry: () => void;
}): ReactElement {
  const count = instances?.length ?? 0;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t.dashboard.approvalsTitle}</CardTitle>
        {!isLoading && count > 0 && (
          <Badge variant="warning" className="num">
            {formatCount(count)} {t.dashboard.approvalsBadge}
          </Badge>
        )}
      </CardHeader>
      <div className="px-4 pb-3 pt-2">
        {!isPermitted ? (
          <UnavailableState description={t.dashboard.noPermission} />
        ) : isLoading ? (
          <ul className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <li
                key={index}
                className="flex items-center gap-3 py-1 text-sm text-ink-subtle"
              >
                <span
                  className="h-8 w-8 animate-pulse rounded-control bg-sunken"
                  aria-hidden
                />
                <span
                  className="h-3 w-2/3 animate-pulse rounded bg-sunken"
                  aria-hidden
                />
              </li>
            ))}
          </ul>
        ) : error !== undefined ? (
          <ApiErrorAlert
            error={error}
            title={t.dashboardErrors.workflow}
            onRetry={onRetry}
          />
        ) : instances === undefined || instances.length === 0 ? (
          <EmptyState
            title={t.dashboard.approvalsEmptyTitle}
            description={t.dashboard.approvalsEmptyBody}
            className="border-none bg-transparent px-2 py-4"
          />
        ) : (
          <ul>
            {instances.map((instance) => (
              <li
                key={instance.id}
                className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                <span className="grid h-8 w-8 flex-none place-items-center rounded-control bg-brand-soft text-brand">
                  <ClipboardCheck className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-semibold text-ink">
                    {instance.entityType}
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] text-ink-subtle">
                    <span className="code">{instance.entityId}</span> ·{' '}
                    {formatDateTime(instance.updatedAt)}
                  </span>
                </div>
                <ShieldQuestion
                  className="h-4 w-4 flex-none text-ink-subtle"
                  aria-hidden
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[0.6875rem] leading-5 text-ink-subtle">
          {t.dashboard.approvalsActionUnavailable}
        </p>
      </div>
    </Card>
  );
}

export function InventoryAlertWidget({
  balances,
  isLoading,
  isPermitted,
  error,
  onRetry,
}: {
  balances: InventoryBalance[] | undefined;
  isLoading: boolean;
  isPermitted: boolean;
  error?: unknown;
  onRetry: () => void;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.dashboard.inventoryTitle}</CardTitle>
        <CardDescription>{t.dashboard.inventorySubtitle}</CardDescription>
      </CardHeader>
      <div className="px-4 pb-3 pt-2">
        {!isPermitted ? (
          <UnavailableState description={t.dashboard.noPermission} />
        ) : isLoading ? (
          <ul className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <li
                key={index}
                className="h-10 animate-pulse rounded bg-sunken"
                aria-hidden
              />
            ))}
          </ul>
        ) : error !== undefined ? (
          <ApiErrorAlert
            error={error}
            title={t.dashboardErrors.inventory}
            onRetry={onRetry}
          />
        ) : balances === undefined || balances.length === 0 ? (
          <EmptyState
            title={t.dashboard.inventoryEmptyTitle}
            description={t.dashboard.inventoryEmptyBody}
            className="border-none bg-transparent px-2 py-4"
          />
        ) : (
          <ul>
            {balances.map((balance) => (
              <li
                key={balance.id}
                className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
                title={`${t.dashboard.inventoryOnHand}: ${balance.onHand} · ${t.dashboard.inventoryReserved}: ${balance.reserved}`}
              >
                <span className="grid h-8 w-8 flex-none place-items-center rounded-control bg-sunken text-ink-subtle">
                  <Boxes className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-semibold text-ink">
                    <span className="code">{balance.itemId}</span>
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] text-ink-subtle">
                    {t.dashboard.inventoryOnHand}:{' '}
                    <strong className="num text-ink-muted">
                      {formatQuantity(balance.onHand)}
                    </strong>
                  </span>
                </div>
                <Badge variant="neutral">
                  {t.dashboard.inventoryReserved}:{' '}
                  {formatQuantity(balance.reserved)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function PeriodStatusWidget({
  periods,
  isLoading,
  isPermitted = true,
  scopeMissing = false,
  error,
  onRetry,
}: {
  periods:
    | Array<{
        id: string;
        sequence: number;
        title: string;
        status: 'open' | 'closed' | 'sealed';
        isCurrent: boolean;
      }>
    | undefined;
  isLoading: boolean;
  isPermitted?: boolean;
  scopeMissing?: boolean;
  error?: unknown;
  onRetry: () => void;
}): ReactElement {
  const statusPresentation = {
    open: { label: t.dashboard.periodOpen, variant: 'success' },
    closed: { label: t.dashboard.periodClosed, variant: 'neutral' },
    sealed: { label: t.dashboard.periodSealed, variant: 'info' },
  } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.dashboard.periodTitle}</CardTitle>
      </CardHeader>
      <div className="px-4 pb-3 pt-2">
        {!isPermitted || scopeMissing ? (
          <UnavailableState
            description={
              scopeMissing
                ? t.dashboard.scopeMissingShort
                : t.dashboard.noPermission
            }
          />
        ) : isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-8 animate-pulse rounded bg-sunken"
                aria-hidden
              />
            ))}
          </div>
        ) : error !== undefined ? (
          <ApiErrorAlert
            error={error}
            title={t.dashboardErrors.periods}
            onRetry={onRetry}
          />
        ) : periods === undefined || periods.length === 0 ? (
          <EmptyState
            title={t.dashboard.periodEmptyTitle}
            description={t.dashboard.periodEmptyBody}
            className="border-none bg-transparent px-2 py-4"
          />
        ) : (
          <ul>
            {periods.map((period) => {
              const presentation = statusPresentation[period.status];
              return (
                <li
                  key={period.id}
                  className="flex items-center gap-3 border-b border-line py-2 text-[0.8125rem] last:border-b-0"
                >
                  <span className="font-medium text-ink-muted">
                    {period.title}
                    {period.isCurrent && (
                      <span className="text-[0.6875rem] text-ink-subtle">
                        {' '}
                        {t.dashboard.periodCurrent}
                      </span>
                    )}
                  </span>
                  <Badge variant={presentation.variant} className="ms-auto">
                    {period.status !== 'open' && (
                      <FileLock2 className="h-3 w-3" aria-hidden />
                    )}
                    {presentation.label}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
