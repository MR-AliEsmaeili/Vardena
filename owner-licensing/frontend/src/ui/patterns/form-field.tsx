import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/ui/label';

export interface FormFieldProps {
  /** Input id — wired to the label and to `aria-describedby`. */
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string;
  children: (fieldProps: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}

/**
 * Label + control + error/hint wiring, used by every form in the app so
 * validation UX (and its accessibility attributes) is defined once.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  className,
  children,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    error !== undefined ? errorId : hint !== undefined ? hintId : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': error !== undefined,
        'aria-describedby': describedBy,
      })}
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={hintId} className="text-xs text-muted-ink">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
