import type { ReactElement } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Alert, AlertBody } from '@/ui/alert';
import { Button } from '@/ui/button';

/**
 * Information banner (reference: period-close notice) and the reconciliation
 * empty-state card. The banner is driven by REAL fiscal-period state — never
 * a hard-coded alert. Dismissal is view state only (the operational fact
 * re-appears for the next visitor; nothing is persisted).
 */
export function PeriodStatusBanner({
  visiblePeriods,
}: {
  visiblePeriods: Array<{
    id: string;
    title: string;
    status: 'open' | 'closed' | 'sealed';
  }>;
}): ReactElement | null {
  const [dismissedIds, setDismissedIds] = useState<readonly string[]>([]);
  const noticeable = visiblePeriods.filter(
    (period) => period.status !== 'open' && !dismissedIds.includes(period.id),
  );
  const first = noticeable[0];
  if (first === undefined) return null;

  const statusLabel =
    first.status === 'sealed'
      ? t.dashboard.periodSealed
      : t.dashboard.periodClosed;

  return (
    <Alert variant="info" className="flex items-start gap-2.5 py-2.5">
      <Landmark className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <AlertBody className="mt-0 flex-1 text-[13px]">
        {t.dashboard.periodClosedBanner
          .replace('{period}', first.title)
          .replace('{status}', statusLabel)}
      </AlertBody>
      <button
        type="button"
        aria-label={t.dashboard.dismissBanner}
        className="rounded-md p-1 text-inherit hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        onClick={() => setDismissedIds((current) => [...current, first.id])}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Alert>
  );
}

/**
 * Reconciliation empty state (reference visual). The CTA links to the Trial
 * Balance — the real, permissioned reconciliation-adjacent read surface.
 */
export function ReconciliationEmptyCard({
  canOpenTrialBalance,
}: {
  canOpenTrialBalance: boolean;
}): ReactElement {
  return (
    <div className="flex flex-col items-center rounded-xl border-[1.5px] border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
      <span className="mb-2.5 grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-400">
        <Landmark className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="text-sm font-bold text-slate-800">
        {t.dashboard.reconciliationTitle}
      </h3>
      <p className="mt-1 max-w-60 text-xs leading-5 text-slate-500">
        {t.dashboard.reconciliationBody}
      </p>
      {canOpenTrialBalance && (
        <Button asChild variant="default" size="sm" className="mt-3.5">
          <Link to="/app/accounting/trial-balance">
            {t.dashboard.reconciliationCta}
          </Link>
        </Button>
      )}
    </div>
  );
}
