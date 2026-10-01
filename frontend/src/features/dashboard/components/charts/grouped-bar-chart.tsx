import { useId, type ReactElement } from 'react';
import { formatAxisAmount } from '@/features/dashboard/lib/dashboard-format';
import { formatAmount } from '@/lib/format';

/**
 * Chart presentation primitives (lightweight, dependency-free SVG).
 *
 * The reference mockup uses ApexCharts via CDN; production Vardena draws
 * these four summary charts with a tiny local SVG layer instead of adding a
 * heavy chart runtime: the semantic data (exact values, series, period
 * labels) lives in the accessible description and the title/tooltip of every
 * mark, so nothing is conveyed by graphics alone (FR-13.9). A chart library
 * decision remains OQ-gated (AR-30); this layer is small enough to replace.
 *
 * Colors come from semantic Tailwind tokens only — no hex/rgb literals.
 */

export interface ChartPoint {
  label: string;
  /** Exact decimal string value. */
  value: string;
}

const WIDTH = 560;
const HEIGHT = 260;
const PADDING = { top: 14, end: 14, bottom: 28, start: 48 };

/** Convert a decimal string to a chart coordinate (display only). */
function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/** Grouped vertical bars — two series (reference: weekly cash flow). */
export function GroupedBarChart({
  seriesA,
  seriesB,
  labelA,
  labelB,
  description,
}: {
  seriesA: ChartPoint[];
  seriesB: ChartPoint[];
  labelA: string;
  labelB: string;
  description: string;
}): ReactElement {
  const gradientId = useId();
  const categories = seriesA.map((point) => point.label);
  const valuesA = seriesA.map((point) => toNumber(point.value));
  const valuesB = seriesB.map((point) => toNumber(point.value));
  const max = niceMax(Math.max(1, ...valuesA, ...valuesB));
  const plotWidth = WIDTH - PADDING.start - PADDING.end;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const groupWidth = plotWidth / Math.max(1, categories.length);
  const barWidth = groupWidth * 0.28;

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{description}</figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label={description}
        className="h-56 w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = PADDING.top + plotHeight * (1 - tick);
          return (
            <g key={tick}>
              <line
                x1={PADDING.start}
                x2={WIDTH - PADDING.end}
                y1={y}
                y2={y}
                className="stroke-slate-200"
                strokeDasharray="4 4"
              />
              <text
                x={WIDTH - PADDING.end + 6}
                y={y + 4}
                className="fill-slate-400 text-[10px]"
              >
                <tspan className="num">{formatAxisAmount(String(max * tick))}</tspan>
              </text>
            </g>
          );
        })}
        {categories.map((category, index) => {
          const valueA = seriesA[index]?.value ?? '0';
          const valueB = seriesB[index]?.value ?? '0';
          const groupStart = PADDING.start + index * groupWidth;
          const heightA = ((valuesA[index] ?? 0) / max) * plotHeight;
          const heightB = ((valuesB[index] ?? 0) / max) * plotHeight;
          const yA = PADDING.top + plotHeight - heightA;
          const yB = PADDING.top + plotHeight - heightB;
          const titleA = `${category} · ${labelA}: ${formatAmount(valueA)}`;
          const titleB = `${category} · ${labelB}: ${formatAmount(valueB)}`;
          return (
            <g key={category}>
              <rect
                x={groupStart + groupWidth * 0.12}
                y={yA}
                width={barWidth}
                height={Math.max(1, heightA)}
                rx={4}
                className="fill-emerald-500/85"
              >
                <title>{titleA}</title>
              </rect>
              <rect
                x={groupStart + groupWidth * 0.52}
                y={yB}
                width={barWidth}
                height={Math.max(1, heightB)}
                rx={4}
                className="fill-rose-500/85"
              >
                <title>{titleB}</title>
              </rect>
              <text
                x={groupStart + groupWidth / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-slate-500 text-[10px]"
              >
                {category}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center justify-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          {labelA}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" aria-hidden />
          {labelB}
        </span>
      </div>
    </figure>
  );
}
