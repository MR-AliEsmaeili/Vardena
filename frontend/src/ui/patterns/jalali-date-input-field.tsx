import { useState, type ComponentProps } from 'react';
import { formatBusinessDay, resolveDayInput } from '@/lib/datetime';
import { Input } from '@/ui/input';

export type JalaliDateInputFieldProps = Omit<
  ComponentProps<typeof Input>,
  | 'autoComplete'
  | 'dir'
  | 'inputMode'
  | 'onChange'
  | 'placeholder'
  | 'type'
  | 'value'
> & {
  /** Canonical Gregorian day (`YYYY-MM-DD`), or `''` when empty. */
  value: string;
  /** Receives a canonical Gregorian day — never a Jalali string. */
  onValueChange: (day: string) => void;
};

/** The local draft exists only while the active field is Jalali text input. */
export function JalaliDateInputField({
  value,
  onValueChange,
  ...props
}: JalaliDateInputFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      {...props}
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      placeholder={formatBusinessDay('2026-03-21', 'JALALI')}
      data-calendar="JALALI"
      value={draft ?? (value === '' ? '' : formatBusinessDay(value, 'JALALI'))}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const day = resolveDayInput(text, 'JALALI');
        if (day !== null) {
          onValueChange(day);
        } else if (text.trim() === '') {
          onValueChange('');
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
