import { Input } from '@/ui/input';
import { useCalendarSystem, type CalendarSystem } from '@/lib/datetime';
import { JalaliDateInputField } from './jalali-date-input-field';

/**
 * The ONE calendar-aware date field (C-63 §17, ADR-0042 §D9).
 *
 * The contract is deliberately narrow, and it is what keeps calendar handling
 * out of every screen:
 *
 *  - the field's VALUE is always the canonical Gregorian day (`YYYY-MM-DD`),
 *    or `''` while empty — forms hold the canonical day, then API adapters
 *    declare the calendar if the operator entered a Jalali day;
 *  - the field's PRESENTATION follows the organization's calendar: a Gregorian
 *    organization gets the native date input (unchanged behaviour, unchanged
 *    accessibility, unchanged keyboard), a Jalali organization gets a text
 *    field that accepts `1405/07/16` — including Persian digits and a short
 *    `7/6`, as the operator actually types them — and converts it once, here;
 *  - a partially typed day never overwrites the form value, so validation
 *    cannot fire mid-typing and an invalid entry cannot blank a valid date.
 *
 * It EXTENDS the field every screen already used (same `Input`, same
 * keyboard/ARIA wiring, same `YYYY-MM-DD` value) rather than adding a parallel
 * picker; a Jalali calendar grid is a UI follow-up (`docs/datetime.md` §11) and
 * would replace this component's rendering, not its contract.
 */
export interface DateInputProps {
  id?: string;
  /** Canonical Gregorian day (`YYYY-MM-DD`), or `''` when empty. */
  value: string;
  /** Receives the canonical Gregorian day — never a Jalali string. */
  onValueChange: (day: string) => void;
  /** Overrides the organization calendar (tests, intentionally fixed screens). */
  calendar?: CalendarSystem;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
  'data-testid'?: string | undefined;
}

export function DateInput({
  calendar,
  value,
  onValueChange,
  ...props
}: DateInputProps) {
  const organizationCalendar = useCalendarSystem();
  const active = calendar ?? organizationCalendar;

  if (active === 'GREGORIAN') {
    return (
      <Input
        {...props}
        type="date"
        dir="ltr"
        data-calendar="GREGORIAN"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }

  // Switching calendars unmounts the text field, discarding any partial Jalali
  // draft. Returning to Jalali then derives its display from the canonical
  // value instead of resurrecting text entered under the prior calendar.
  return (
    <JalaliDateInputField
      {...props}
      value={value}
      onValueChange={onValueChange}
    />
  );
}
