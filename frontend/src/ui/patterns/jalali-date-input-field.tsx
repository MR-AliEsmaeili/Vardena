import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  dayjs,
  formatBusinessDay,
  formatDayParts,
  jalaliDayOf,
  jalaliDayToGregorianDay,
  jalaliMonthLengthOf,
  parseDayParts,
  resolveDayInput,
  todayBusinessDay,
  toPersianDigits,
  useTimeZone,
} from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
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

function initialViewMonth(
  canonicalValue: string,
  todayCanonical: string,
): { year: number; month: number } {
  const source = canonicalValue !== '' ? canonicalValue : todayCanonical;
  const jalali = jalaliDayOf(source) ?? jalaliDayOf(todayCanonical);
  const parts = jalali !== null ? parseDayParts(jalali) : null;
  if (parts !== null) {
    return { year: parts.year, month: parts.month };
  }
  return { year: 1405, month: 1 };
}

/**
 * Unified Jalali BusinessDate input + interactive calendar picker (ADR-0042,
 * ADR-0044, docs/datetime.md).
 *
 * Manual typing accepts Persian, Arabic-Indic, and Latin digits (`1405/07/16`,
 * `۱۴۰۵/۰۷/۱۶`, `1405-7-6`). The calendar popover uses the shared `@/lib/datetime`
 * foundation exclusively — never a second calendar library — and always emits
 * canonical Gregorian `YYYY-MM-DD`.
 */
export function JalaliDateInputField({
  value,
  onValueChange,
  disabled,
  className,
  ...props
}: JalaliDateInputFieldProps) {
  const timeZone = useTimeZone();
  const todayCanonical = todayBusinessDay(timeZone);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() =>
    initialViewMonth(value, todayCanonical),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (
        rootRef.current !== null &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectedJalaliParts = useMemo(() => {
    if (value === '') return null;
    const j = jalaliDayOf(value);
    return j !== null ? parseDayParts(j) : null;
  }, [value]);

  const todayJalaliParts = useMemo(() => {
    const j = jalaliDayOf(todayCanonical);
    return j !== null ? parseDayParts(j) : null;
  }, [todayCanonical]);

  const calendarCells = useMemo(() => {
    const daysInMonth = jalaliMonthLengthOf(view.year, view.month);
    const firstGregorian = jalaliDayToGregorianDay(
      formatDayParts({ year: view.year, month: view.month, day: 1 }),
    );
    const startOffset =
      firstGregorian !== null ? (dayjs.utc(firstGregorian).day() + 1) % 7 : 0;
    const blanks = Array.from({ length: startOffset }, (_, idx) => ({
      key: `blank-${idx}`,
      day: null as number | null,
    }));
    const days = Array.from({ length: daysInMonth }, (_, idx) => ({
      key: `day-${idx + 1}`,
      day: idx + 1,
    }));
    return [...blanks, ...days];
  }, [view.month, view.year]);

  const toggleCalendar = () => {
    if (disabled) return;
    if (!open) {
      setView(initialViewMonth(value, todayCanonical));
    }
    setOpen((prev) => !prev);
  };

  const shiftMonth = (delta: number) => {
    setView((prev) => {
      let nextMonth = prev.month + delta;
      let nextYear = prev.year;
      while (nextMonth < 1) {
        nextMonth += 12;
        nextYear -= 1;
      }
      while (nextMonth > 12) {
        nextMonth -= 12;
        nextYear += 1;
      }
      return { year: Math.max(1, nextYear), month: nextMonth };
    });
  };

  const selectJalaliDay = (day: number) => {
    const canonical = jalaliDayToGregorianDay(
      formatDayParts({ year: view.year, month: view.month, day }),
    );
    if (canonical !== null) {
      setDraft(null);
      onValueChange(canonical);
      setOpen(false);
    }
  };

  const monthTitle = t.datePicker.months[view.month - 1] ?? '';

  return (
    <div ref={rootRef} className="relative flex w-full items-center">
      <Input
        {...props}
        disabled={disabled}
        type="text"
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder={formatBusinessDay('2026-03-21', 'JALALI')}
        data-calendar="JALALI"
        /*
         * The field is an explicit LTR island inside the RTL form, so its own
         * `pe-*` is the PHYSICAL right edge. The calendar trigger must sit on
         * that same physical edge (`start-*` of the RTL wrapper), otherwise the
         * Jalali digits start underneath the icon.
         */
        className={cn('pe-9', className)}
        value={
          draft ?? (value === '' ? '' : formatBusinessDay(value, 'JALALI'))
        }
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
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={
          open ? t.datePicker.closeCalendar : t.datePicker.openCalendar
        }
        aria-expanded={open}
        data-testid="jalali-calendar-trigger"
        onClick={toggleCalendar}
        className="action-press absolute start-1.5 inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-subtle hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        <Calendar className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <section
          aria-label={t.datePicker.dialogLabel}
          data-testid="jalali-calendar-popover"
          className="animate-rise-in absolute start-0 top-full z-40 mt-1.5 w-72 rounded-card border border-line bg-surface p-3 text-ink shadow-raised"
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              aria-label={t.datePicker.prevMonth}
              data-testid="jalali-calendar-prev-month"
              onClick={() => shiftMonth(-1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted hover:bg-sunken hover:text-ink"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <span
              className="text-xs font-semibold text-ink"
              data-testid="jalali-calendar-heading"
            >
              {monthTitle} {toPersianDigits(String(view.year))}
            </span>
            <button
              type="button"
              aria-label={t.datePicker.nextMonth}
              data-testid="jalali-calendar-next-month"
              onClick={() => shiftMonth(1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted hover:bg-sunken hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[0.6875rem] font-semibold text-ink-subtle">
            {t.datePicker.weekdaysShort.map((weekday) => (
              <span key={weekday} className="py-1">
                {weekday}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell) => {
              if (cell.day === null) {
                return <span key={cell.key} className="h-8" aria-hidden />;
              }
              const dayNumber = cell.day;
              const isSelected =
                selectedJalaliParts !== null &&
                selectedJalaliParts.year === view.year &&
                selectedJalaliParts.month === view.month &&
                selectedJalaliParts.day === dayNumber;
              const isToday =
                todayJalaliParts !== null &&
                todayJalaliParts.year === view.year &&
                todayJalaliParts.month === view.month &&
                todayJalaliParts.day === dayNumber;

              return (
                <button
                  key={cell.key}
                  type="button"
                  aria-pressed={isSelected}
                  data-testid={`jalali-day-${dayNumber}`}
                  onClick={() => selectJalaliDay(dayNumber)}
                  className={cn(
                    'flex h-8 w-full items-center justify-center rounded-control text-xs tabular-nums transition-colors',
                    isSelected
                      ? 'bg-brand font-semibold text-white'
                      : isToday
                        ? 'border border-brand text-brand-ink hover:bg-brand-soft'
                        : 'text-ink hover:bg-sunken',
                  )}
                >
                  {toPersianDigits(String(dayNumber))}
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              data-testid="jalali-calendar-today"
              onClick={() => {
                setDraft(null);
                onValueChange(todayCanonical);
                setOpen(false);
              }}
              className="rounded-control px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft"
            >
              {t.datePicker.today}
            </button>
            <button
              type="button"
              data-testid="jalali-calendar-clear"
              onClick={() => {
                setDraft(null);
                onValueChange('');
                setOpen(false);
              }}
              className="rounded-control px-2 py-1 text-xs text-ink-muted hover:bg-sunken hover:text-ink"
            >
              {t.datePicker.clear}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
