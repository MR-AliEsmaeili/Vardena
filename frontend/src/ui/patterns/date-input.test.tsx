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
});
