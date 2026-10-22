import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '@/ui/input';
import { FormField } from './form-field';

/**
 * The label/control/error wiring every form in the product inherits. The
 * required marker is pinned here as well: it is a visual hint only, so the
 * label's own text must stay exactly the translated label — otherwise every
 * `getByLabelText(label)` lookup (tests, password managers, user scripts) has
 * to know about the asterisk.
 */
describe('FormField', () => {
  it('associates the label with the control and keeps the marker out of it', () => {
    render(
      <FormField id="username" label="نام کاربری" required>
        {(fieldProps) => <Input {...fieldProps} />}
      </FormField>,
    );

    const control = screen.getByLabelText('نام کاربری');
    expect(control).toHaveAttribute('id', 'username');
    expect(control).toHaveAttribute('aria-required', 'true');

    const marker = screen.getByText('*');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(marker.closest('label')).toBeNull();
  });

  it('omits the requirement attributes for an optional field', () => {
    render(
      <FormField id="note" label="توضیح">
        {(fieldProps) => <Input {...fieldProps} />}
      </FormField>,
    );

    const control = screen.getByLabelText('توضیح');
    expect(control).not.toHaveAttribute('aria-required');
    expect(control).toHaveAttribute('aria-invalid', 'false');
    expect(control).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('*')).toBeNull();
  });

  it('describes the control with the hint and then the error', () => {
    render(
      <FormField
        id="amount"
        label="مبلغ"
        hint="مبلغ به ریال"
        error="مبلغ الزامی است"
      >
        {(fieldProps) => <Input {...fieldProps} />}
      </FormField>,
    );

    const control = screen.getByLabelText('مبلغ');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAttribute(
      'aria-describedby',
      'amount-hint amount-error',
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('id', 'amount-error');
    expect(alert).toHaveTextContent('مبلغ الزامی است');
    expect(screen.getByText('مبلغ به ریال')).toHaveAttribute(
      'id',
      'amount-hint',
    );
  });
});
