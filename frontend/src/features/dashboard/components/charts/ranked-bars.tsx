import type { ReactElement } from 'react';
import { formatAxisAmount } from '@/features/dashboard/lib/dashboard-format';
import { formatAmount } from '@/lib/format';

/**
 * Horizontal ranked bars (reference: largest balances) and the donut-free
 * period share presentation. Values remain exact strings in the markup; the
 * geometry is display-only. Distributed colors reuse semantic palette
 * classes so light/dark themes keep working.
 */

const ROW_CLASS = [
  'bg-indigo-500/85',
  'bg-sky-500/85',
  'bg-emerald-500/85',
  'bg-amber-500/85',
  'bg-slate-400/85',
] as const;

export interface RankedBar {
  label: string;
  value: string;
}

export function RankedBars({
  items,
  description,
}: {
  items: RankedBar[];
  description: string;
}): ReactElement {
  const max = Math.max(
    1,
    ...items.map((item) => {
      const parsed = Number(item.value);
      return Number.isFinite(parsed) ? parsed : 0;
    }),
  );

  return (
    <figure className="m-0 space-y-3">
      <figcaption className="sr-only">{description}</figcaption>
      {items.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-500">
          {description}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => {
            const numeric = Number(item.value);
            const safe = Number.isFinite(numeric) ? numeric : 0;
            const ratio = Math.max(0.02, safe / max);
            return (
              <li key={item.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700">
                    {item.label}
                  </span>
                  <span className="num font-semibold text-slate-700" title={item.value}>
                    {formatAmount(item.value)}
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
                  role="presentation"
                >
                  <div
                    className={`h-full rounded-full ${ROW_CLASS[index % ROW_CLASS.length]}`}
                    style={{ width: `${ratio * 100}%` }}
                    title={`${item.label}: ${formatAmount(item.value)} (${formatAxisAmount(item.value)})`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}

/** Period share donut substitute: stacked proportional bar with legend. */
export function ShareBars({
  items,
  description,
}: {
  items: RankedBar[];
  description: string;
}): ReactElement {
  const total = items.reduce((acc, item) => {
    const parsed = Number(item.value);
    return acc + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);

  return (
    <figure className="m-0 space-y-3">
      <figcaption className="sr-only">{description}</figcaption>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
        role="presentation"
      >
        {items.map((item, index) => {
          const parsed = Number(item.value);
          const safe = Number.isFinite(parsed) ? parsed : 0;
          const ratio = total > 0 ? safe / total : 0;
          return (
            <div
              key={item.label}
              className={ROW_CLASS[index % ROW_CLASS.length]}
              style={{ width: `${ratio * 100}%` }}
              title={`${item.label}: ${formatAmount(item.value)}`}
            />
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-2 text-xs">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${ROW_CLASS[index % ROW_CLASS.length]}`}
              aria-hidden
            />
            <span className="truncate text-slate-600">{item.label}</span>
            <span className="num ms-auto font-semibold text-slate-700">
              {formatAmount(item.value)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
