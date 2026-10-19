import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

/**
 * The button is the only piece of the loading system that guards against
 * duplicate mutations: `loading` must disable the control, expose the busy
 * state to assistive tech, and render one decorative orb beside the label.
 */
describe('Button loading', () => {
  it('exposes aria-busy and a loading marker without changing the label', () => {
    render(<Button loading>ثبت سند</Button>);

    const button = screen.getByRole('button', { name: 'ثبت سند' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('data-loading', 'true');
  });

  it('blocks the second submit of the same operation', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        ثبت
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'ثبت' }));
    await user.keyboard('{Enter}');

    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a decorative inline orb beside the visible label', () => {
    render(<Button loading>ثبت</Button>);

    const orb = document.querySelector('canvas');
    expect(orb).not.toBeNull();
    expect(orb).toHaveAttribute('aria-hidden', 'true');
    expect(orb).toHaveAttribute('width', '20');
    expect(orb).toHaveStyle({ width: '20px', height: '20px' });
  });

  it('leaves asChild buttons untouched so links keep their single child', () => {
    render(
      <Button asChild loading>
        <a href="/reports">گزارش‌ها</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'گزارش‌ها' });
    expect(link).toHaveAttribute('aria-busy', 'true');
    expect(link.querySelector('canvas')).toBeNull();
  });

  it('is a normal, clickable button when not loading', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>ثبت</Button>);

    const button = screen.getByRole('button', { name: 'ثبت' });
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).not.toHaveAttribute('data-loading');

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
