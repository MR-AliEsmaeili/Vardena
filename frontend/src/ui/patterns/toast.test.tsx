import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '@/lib/i18n';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from './toast';

function Trigger() {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => showToast({ kind: 'success', message: 'saved' })}
    >
      notify
    </button>
  );
}

describe('ToastProvider placement', () => {
  it('keeps notifications above the sidebar and anchored away from the RTL rail', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'notify' }));
    expect(screen.getByRole('status')).toHaveTextContent('saved');
    const region = screen.getByLabelText(t.toasts.regionLabel);
    expect(region.className).toContain('end-4');
    expect(region.className).toContain('z-[70]');
    expect(screen.getByRole('status').className).toContain('animate-rise-in');
  });
});
