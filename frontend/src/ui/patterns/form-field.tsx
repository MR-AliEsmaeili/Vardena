import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/ui/label';

export interface FormFieldProps {
  /** Input id — wired to the label and to `aria-describedby`. */
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  /**
   * Marks the control as required for assistive technology AND shows the
   * visual asterisk (standards.md §9). The backend remains the authority on
   * what is actually required; this only mirrors the documented contract.
   */
  required?: boolean;
  className?: string;
  children: (fieldProps: {
    id: string;
    'aria-invalid': boolean;
    'aria-required': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}

/**
 * Label + control + error/hint wiring, used by every form in the app so
 * validation UX (and its accessibility attributes) is defined once.
 *
 * The error text is announced (`role="alert"`), rendered directly under its
 * own control, and the control points at it through `aria-describedby` — so a
 * keyboard/screen-reader user hears the message while focus stays in the
 * field. Hint and error can coexist: both ids are described, in that order.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [
    hint !== undefined ? hintId : undefined,
    error !== undefined ? errorId : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ');

  return (
    <div className={cn('space-y-1.5', className)}>
      {/*
        The required marker sits BESIDE the label, not inside it: an asterisk
        rendered inside the label becomes part of the label's text, so every
        `getByLabelText(label)` lookup (and every form-filling user script)
        would have to know about the marker. `aria-required` carries the same
        information to assistive technology.
      */}
      <div className="flex items-baseline gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {required && (
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        )}
      </div>
      {children({
        id,
        'aria-invalid': error !== undefined,
        'aria-required': required ? true : undefined,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
      })}
      {hint !== undefined && (
        <p id={hintId} className="text-xs leading-5 text-ink-subtle">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium leading-5 text-danger-ink"
        >
          {error}
        </p>
      )}
    </div>
  );
}
