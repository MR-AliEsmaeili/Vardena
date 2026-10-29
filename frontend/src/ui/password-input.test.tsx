import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { FormField } from './patterns/form-field';
import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  it('toggles visibility with localized Persian labels while preserving LTR isolation and FormField labelling', async () => {
    const user = userEvent.setup();
    const inputRef = createRef<HTMLInputElement>();

    render(
      <FormField id="test-password" label={t.auth.password} required>
        {(fieldProps) => (
          <PasswordInput
            {...fieldProps}
            ref={inputRef}
            defaultValue="s3cr3t!"
          />
        )}
      </FormField>,
    );

    const input = screen.getByLabelText(t.auth.password);
    expect(input).toBe(inputRef.current);
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input.parentElement).toHaveAttribute('dir', 'ltr');

    const toggle = screen.getByRole('button', { name: t.auth.showPassword });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(
      screen.getByRole('button', { name: t.auth.hidePassword }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: t.auth.hidePassword }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('disables the visibility toggle when the field is disabled', () => {
    render(<PasswordInput aria-label={t.auth.password} disabled />);
    expect(
      screen.getByRole('button', { name: t.auth.showPassword }),
    ).toBeDisabled();
  });
});
