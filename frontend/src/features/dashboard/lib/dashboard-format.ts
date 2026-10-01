import { formatAmount } from '@/lib/format';

/**
 * Dashboard-side formatting helpers.
 *
 * Every value passes through the CENTRAL formatters in `@/lib/format` —
 * this file only adds chart-axis presentation (compactly scaled integers for
 * axis ticks, where a full grouped amount would not fit). The exact value is
 * always available to the user through tooltips and the KPI/table cells.
 */

/** Compact axis tick: 12,500,000 → "12.5M" style scaling, exact elsewhere. */
export function formatAxisAmount(value: string): string {
  const raw = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) return raw;
  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/^[+-]/, '');
  const intPart = unsigned.split('.')[0] ?? '0';
  const digits = intPart.replace(/^0+(?=\d)/, '');
  if (digits.length <= 4) return formatAmount(raw);
  if (digits.length <= 6) return `${negative ? '-' : ''}${digits.slice(0, digits.length - 3)}K`;
  if (digits.length <= 9) {
    const millions = digits.slice(0, digits.length - 6);
    return `${negative ? '-' : ''}${millions}M`;
  }
  const billions = digits.slice(0, digits.length - 9);
  return `${negative ? '-' : ''}${billions}B`;
}
