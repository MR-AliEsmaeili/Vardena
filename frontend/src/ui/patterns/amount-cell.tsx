import type { ReactElement } from 'react';
import { formatAmount, isNegativeAmount } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Render an exact decimal amount returned by the API.
 *
 * The value is displayed digit-for-digit (only thousands separators are
 * added): amounts are never parsed into a JavaScript number and never
 * rounded, summed or otherwise recomputed in the frontend.
 */
export function AmountCell({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}): ReactElement {
  const negative = isNegativeAmount(value);
  return (
    <span
      className={cn('num block', negative && 'text-danger-ink', className)}
      title={value ?? undefined}
    >
      {formatAmount(value)}
    </span>
  );
}
