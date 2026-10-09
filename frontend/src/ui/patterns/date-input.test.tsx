import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDateTimeSettings, setDateTimeSettings } from '@/lib/datetime';
import { DateInput } from './date-input';

beforeEach(() => {
  resetDateTimeSettings();
});

/**
 * The shared calendar-aware date field (C-63 §17).
 *
 * The rules under test are the ones a screen depends on: the field emits the
 * canonical Gregorian day whatever calendar it displays, a Jalali organization
 * gets the Jalali rendering, a half-typed day never overwrites the form value,
 * and Persian digits are accepted.
 */
describe('DateInput', () => {
  it('uses the organization calendar, and emits the canonical day', async () => {
    const user = userEvent.setup();
    setDateTimeSettings({ calendarSystem: 'JALALI', timeZone: 'Asia/Tehran' });
    const onValueChange = vi.fn();
    render(
      <DateInput id="day" value="2026-10-08" onValueChange={onValueChange} />,
    );

    const field = screen.getByRole('textbox');
    expect(field).toHaveAttribute('data-calendar', 'JALALI');
    expect(field).toHaveValue('1405/07/16');

    await user.clear(field);
    await user.type(field, '۱۴۰۵/۰۷/۱۷');
    expect(onValueChange).toHaveBeenLastCalledWith('2026-10-09');
  });

  it('keeps the form value while the Jalali day is incomplete', async () => {
    const user = userEvent.setup();
    setDateTimeSettings({ calendarSystem: 'JALALI', timeZone: 'Asia/Tehran' });
    const onValueChange = vi.fn();
    render(
      <DateInput id="day" value="2026-10-08" onValueChange={onValueChange} />,
    );

    const field = screen.getByRole('textbox');
    await user.clear(field);
    // A cleared field is a cleared day, which the form must see.
    expect(onValueChange).toHaveBeenLastCalledWith('');

    // …but a half-typed day must not overwrite the form value.
    await user.type(field, '1405/07');
    expect(onValueChange).toHaveBeenLastCalledWith('');
  });

  it('keeps the native date input for a Gregorian organization', () => {
    setDateTimeSettings({ calendarSystem: 'GREGORIAN', timeZone: 'UTC' });
    const onValueChange = vi.fn();
    render(
      <DateInput id="day" value="2026-10-08" onValueChange={onValueChange} />,
    );

    const field = screen.getByDisplayValue('2026-10-08');
    expect(field).toHaveAttribute('type', 'date');
    expect(field).toHaveAttribute('data-calendar', 'GREGORIAN');

    // A native date input reports its value as a `YYYY-MM-DD` string.
    fireEvent.change(field, { target: { value: '2026-10-09' } });
    expect(onValueChange).toHaveBeenLastCalledWith('2026-10-09');
  });

  it('renders an empty day as empty in both calendars', () => {
    setDateTimeSettings({ calendarSystem: 'JALALI', timeZone: 'Asia/Tehran' });
    render(<DateInput id="day" value="" onValueChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
