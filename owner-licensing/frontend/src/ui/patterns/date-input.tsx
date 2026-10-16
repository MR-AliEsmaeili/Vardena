import { useState } from 'react';
import {
  formatBusinessDay,
  isBusinessDay,
  resolveDayInput,
} from '@/lib/date-time';
import { o } from '@/lib/owner-i18n';
import { Input } from '@/ui/input';

/** Thin Owner form adapter; parsing/calendar/numerals are the canonical foundation. */
export function DateInput({
  value,
  onChange,
  ...props
}: {
  id: string;
  value: string;
  onChange: (formValue: string) => void;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
}) {
  const [draft, setDraft] = useState<{ value: string; text: string } | null>(
    null,
  );
  const historical =
    value !== '' && isBusinessDay(value) && formatBusinessDay(value) === value;
  return (
    <Input
      {...props}
      dir="ltr"
      type={historical ? 'date' : 'text'}
      inputMode="numeric"
      placeholder={o.jalaliDatePlaceholder}
      data-calendar={historical ? 'GREGORIAN' : 'JALALI'}
      value={
        draft?.value === value
          ? draft.text
          : value === ''
            ? ''
            : formatBusinessDay(value)
      }
      onBlur={() => {
        if (isBusinessDay(value) || value === '') setDraft(null);
      }}
      onChange={(event) => {
        const text = event.target.value;

        // Keep an invalid draft invalid in RHF: never submit the old valid day
        // or silently drop a bound. Conversion itself is not duplicated here.
        const next =
          text === ''
            ? ''
            : (resolveDayInput(text, historical ? 'GREGORIAN' : 'JALALI') ??
              `invalid:${text}`);
        setDraft({ value: next, text });
        onChange(next);
      }}
    />
  );
}
