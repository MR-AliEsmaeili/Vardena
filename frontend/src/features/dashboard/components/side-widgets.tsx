import type { ReactElement } from 'react';
import {
  Boxes,
  ClipboardCheck,
  FileLock2,
  ShieldQuestion,
} from 'lucide-react';
import type { InventoryBalance, WorkflowInstance } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { EmptyState } from '@/ui/patterns/states';
import { formatCount, formatDateTime, formatQuantity } from '@/lib/format';

/**
 * Side widgets (reference right column).
 *
 * - **Workflow bindings**: real `GET /workflow/instances` data, DISPLAY ONLY.
 *   Approve/reject actions are sensitive business operations; the reference's
 *   inline buttons are not reproduced because deciding an approval is a
 *   separate backend capability (POST /workflow/approvals/:id/decide is not
 *   wired to a dashboard surface). The gap is documented, not faked.
 * - **Inventory alerts**: real balances endpoint; `available` is the
 *   backend-derived field — the frontend never recomputes stock.
 * - **Fiscal period status**: real periods of the scoped fiscal year.
 */
export function WorkflowWidget({
  instances,
  isLoading,
  isPermitted,
}: {
  instances: WorkflowInstance[] | undefined;
  isLoading: boolean;
  isPermitted: boolean;
}): ReactElement {
  const count = instances?.length ?? 0;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-bold">{t.dashboard.approvalsTitle}</CardTitle>
        {!isLoading && count > 0 && (
          <Badge variant="warning" className="num">
            {formatCount(count)} {t.dashboard.approvalsBadge}
          </Badge>
        )}
      </CardHeader>
      <div className="px-4 pb-3 pt-2">
        {!isPermitted ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-6 text-center text-xs text-slate-500">
            {t.dashboard.noPermission}
          </p>
        ) : isLoading ? (
          <ul className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex items-center gap-3 py-1 text-sm text-slate-400">
                <span className="h-8 w-8 animate-pulse rounded-lg bg-slate-200" aria-hidden />
                <span className="h-3 w-2/3 animate-pulse rounded bg-slate-200" aria-hidden />
              </li>
            ))}
          </ul>
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
                className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0"
              >
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                  <ClipboardCheck className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">
                    {instance.entityType}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    <span className="code">{instance.entityId}</span> ·{' '}
                    {formatDateTime(instance.updatedAt)}
                  </span>
                </div>
                <ShieldQuestion
                  className="h-4 w-4 flex-none text-slate-300"
                  aria-hidden
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
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
}: {
  balances: InventoryBalance[] | undefined;
  isLoading: boolean;
  isPermitted: boolean;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold">{t.dashboard.inventoryTitle}</CardTitle>
        <CardDescription className="text-[11px]">{t.dashboard.inventorySubtitle}</CardDescription>
      </CardHeader>
      <div className="px-4 pb-3 pt-2">
        {!isPermitted ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-6 text-center text-xs text-slate-500">
            {t.dashboard.noPermission}
          </p>
        ) : isLoading ? (
          <ul className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <li key={index} className="h-10 animate-pulse rounded bg-slate-100" aria-hidden />
            ))}
          </ul>
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
                className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0"
                title={`${t.dashboard.inventoryOnHand}: ${balance.onHand} · ${t.dashboard.inventoryReserved}: ${balance.reserved}`}
              >
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-slate-100 text-slate-500">
                  <Boxes className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">
                    <span className="code">{balance.itemId}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {t.dashboard.inventoryAvailable}:{' '}
                    <strong
                      className={`num ${
                        Number(balance.available) <= 0 ? 'text-rose-600' : 'text-amber-600'
                      }`}
                    >
                      {formatQuantity(balance.available)}
                    </strong>
                  </span>
                </div>
                <Badge variant={Number(balance.available) <= 0 ? 'danger' : 'warning'}>
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
}: {
  periods: Array<{
    id: string;
    sequence: number;
    title: string;
    status: 'open' | 'closed' | 'sealed';
    isCurrent: boolean;
  }> | undefined;
  isLoading: boolean;
  isPermitted?: boolean;
  scopeMissing?: boolean;
}): ReactElement {
  const statusPresentation = {
    open: { label: t.dashboard.periodOpen, variant: 'success' },
    closed: { label: t.dashboard.periodClosed, variant: 'neutral' },
    sealed: { label: t.dashboard.periodSealed, variant: 'info' },
  } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold">{t.dashboard.periodTitle}</CardTitle>
      </CardHeader>
      <div className="px-4 pb-3 pt-2">
        {!isPermitted || scopeMissing ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-6 text-center text-xs text-slate-500">
            {scopeMissing ? t.dashboard.scopeMissingShort : t.dashboard.noPermission}
          </p>
        ) : isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-8 animate-pulse rounded bg-slate-100" aria-hidden />
            ))}
          </div>
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
                  className="flex items-center gap-3 border-b border-slate-100 py-2 text-[13px] last:border-b-0"
                >
                  <span className="font-medium text-slate-700">
                    {period.title}
                    {period.isCurrent && (
                      <span className="text-[11px] text-slate-400"> {t.dashboard.periodCurrent}</span>
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
