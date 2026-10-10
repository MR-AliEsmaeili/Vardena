import { isBusinessDay, jalaliDayOf } from '@/lib/datetime';
import { Input } from '@/ui/input';
import { JalaliDateInputField } from './jalali-date-input-field';

/**
 * The ONE BusinessDate input. Supported dates are always entered and displayed
 * in Jalali; there is no user- or organization-selectable calendar. Its form
 * value remains the canonical Gregorian day (`YYYY-MM-DD`).
 *
 * A valid historical Gregorian day that cannot be rendered by the shared
 * Jalali converter automatically uses a native Gregorian input, so viewing or
 * editing it never erases the stored fact. This is a range fallback, not a
 * second calendar preference. Partial Jalali text never overwrites the form
 * value and invalid entries cannot blank an existing day.
 */
export interface DateInputProps {
  id?: string;
  /** Canonical Gregorian day (`YYYY-MM-DD`), or `''` when empty. */
  value: string;
  /** Receives the canonical Gregorian day — never a Jalali string. */
  onValueChange: (day: string) => void;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
  'data-testid'?: string | undefined;
}

export function DateInput({ value, onValueChange, ...props }: DateInputProps) {
  const useGregorianFallback =
    value !== '' && isBusinessDay(value) && jalaliDayOf(value) === null;

  if (useGregorianFallback) {
    return (
      <Input
        {...props}
        type="date"
        dir="ltr"
        data-calendar="GREGORIAN"
        data-calendar-fallback="true"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }

  return (
    <JalaliDateInputField
      {...props}
      value={value}
      onValueChange={onValueChange}
    />
  );
}
