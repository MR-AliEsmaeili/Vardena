import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDateTimeSettings, setDateTimeSettings } from '@/lib/datetime';
import { DateInput } from './date-input';

beforeEach(() => {
  resetDateTimeSettings();
});

describe('DateInput', () => {
  it('always uses Jalali for supported days and emits the canonical day', async () => {
    const user = userEvent.setup();
    // A legacy Gregorian response value must not switch the fixed UI policy.
    setDateTimeSettings({
      calendarSystem: 'GREGORIAN',
      timeZone: 'Asia/Tehran',
    });
    const onValueChange = vi.fn();
    render(
      <DateInput id="day" value="2026-10-08" onValueChange={onValueChange} />,
    );

    const field = screen.getByRole('textbox');
    expect(field).toHaveAttribute('data-calendar', 'JALALI');
    expect(field).toHaveValue('۱۴۰۵/۰۷/۱۶');

    await user.clear(field);
    await user.type(field, '۱۴۰۵/۰۷/۱۷');
    expect(onValueChange).toHaveBeenLastCalledWith('2026-10-09');
  });

  it('keeps the form value while the Jalali day is incomplete', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <DateInput id="day" value="2026-10-08" onValueChange={onValueChange} />,
    );

    const field = screen.getByRole('textbox');
    await user.clear(field);
    expect(onValueChange).toHaveBeenLastCalledWith('');

    await user.type(field, '1405/07');
    expect(onValueChange).toHaveBeenLastCalledWith('');
  });

  it('automatically uses Gregorian input for an unrenderable historical day', () => {
    const onValueChange = vi.fn();
    render(
      <DateInput id="day" value="0600-01-01" onValueChange={onValueChange} />,
    );

    const field = screen.getByDisplayValue('0600-01-01');
    expect(field).toHaveAttribute('type', 'date');
    expect(field).toHaveAttribute('data-calendar', 'GREGORIAN');
    expect(field).toHaveAttribute('data-calendar-fallback', 'true');

    fireEvent.change(field, { target: { value: '0600-01-02' } });
    expect(onValueChange).toHaveBeenLastCalledWith('0600-01-02');
  });

  it('renders an empty day as an empty Jalali input', () => {
    render(<DateInput id="day" value="" onValueChange={() => {}} />);
    const field = screen.getByRole('textbox');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('data-calendar', 'JALALI');
  });

  it('opens the interactive Jalali calendar popover, navigates months, and emits canonical Gregorian day on selection', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <DateInput id="day" value="2026-10-08" onValueChange={onValueChange} />,
    );

    await user.click(screen.getByTestId('jalali-calendar-trigger'));
    expect(screen.getByTestId('jalali-calendar-popover')).toBeInTheDocument();
    expect(screen.getByTestId('jalali-calendar-heading')).toHaveTextContent(
      'مهر ۱۴۰۵',
    );

    // Navigate to next month (آبان ۱۴۰۵) and select day 10
    await user.click(screen.getByTestId('jalali-calendar-next-month'));
    expect(screen.getByTestId('jalali-calendar-heading')).toHaveTextContent(
      'آبان ۱۴۰۵',
    );

    await user.click(screen.getByTestId('jalali-day-10'));
    // 1405-08-10 Jalali === 2026-11-01 Gregorian
    expect(onValueChange).toHaveBeenLastCalledWith('2026-11-01');
    expect(
      screen.queryByTestId('jalali-calendar-popover'),
    ).not.toBeInTheDocument();
  });

  it('renders 30 days in Esfand of a leap Jalali year (1403) and 29 days in a non-leap year (1404), and supports Clear and Escape', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    // 1403-12-01 (leap year Esfand) === 2025-02-19
    const { rerender } = render(
      <DateInput id="day" value="2025-02-19" onValueChange={onValueChange} />,
    );

    await user.click(screen.getByTestId('jalali-calendar-trigger'));
    expect(screen.getByTestId('jalali-calendar-heading')).toHaveTextContent(
      'اسفند ۱۴۰۳',
    );
    expect(screen.getByTestId('jalali-day-30')).toBeInTheDocument();

    // Escape closes the popover cleanly
    await user.keyboard('{Escape}');
    expect(
      screen.queryByTestId('jalali-calendar-popover'),
    ).not.toBeInTheDocument();

    // 1404-12-01 (non-leap year Esfand) === 2026-02-20
    rerender(
      <DateInput id="day" value="2026-02-20" onValueChange={onValueChange} />,
    );
    await user.click(screen.getByTestId('jalali-calendar-trigger'));
    expect(screen.getByTestId('jalali-calendar-heading')).toHaveTextContent(
      'اسفند ۱۴۰۴',
    );
    expect(screen.getByTestId('jalali-day-29')).toBeInTheDocument();
    expect(screen.queryByTestId('jalali-day-30')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('jalali-calendar-clear'));
    expect(onValueChange).toHaveBeenLastCalledWith('');
  });

  it('reserves the same physical edge for the digits and the calendar trigger', () => {
    render(
      <DateInput id="day" value="2026-10-08" onValueChange={() => undefined} />,
    );

    const field = screen.getByRole('textbox');
    const trigger = screen.getByTestId('jalali-calendar-trigger');

    // The field is an intentional LTR island inside the RTL form, so its
    // `pe-*` padding is the PHYSICAL right edge. The trigger must sit on that
    // same edge (`start-*` of the RTL wrapper) — pairing `pe-9` with `end-*`
    // put the Jalali digits underneath the icon.
    expect(field.className).toContain('pe-9');
    expect(trigger.className).toContain('start-1.5');
    expect(trigger.className).not.toContain('end-1.5');
  });
});
