import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tooltip } from './tooltip';

/**
 * Tooltip behaviour that the icon-only sidebar depends on.
 *
 * The rail scrolls inside its own box, so an in-flow absolutely positioned
 * bubble is clipped by `overflow-y: auto`. The bubble is therefore portalled
 * to `document.body`; that is asserted here, together with the interaction
 * contract (hover, keyboard focus, Escape, opt-out).
 */
describe('Tooltip', () => {
  it('stays closed until the anchor is hovered', () => {
    render(
      <Tooltip content="درخت حساب‌ها">
        <button type="button">آیکون</button>
      </Tooltip>,
    );

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the content on hover and hides it again on leave', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="درخت حساب‌ها">
        <button type="button">آیکون</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole('button', { name: 'آیکون' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('درخت حساب‌ها');

    await user.unhover(screen.getByRole('button', { name: 'آیکون' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens for keyboard users when the anchor takes focus', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="تراز آزمایشی">
        <button type="button">آیکون</button>
      </Tooltip>,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'آیکون' })).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('تراز آزمایشی');
  });

  it('closes on Escape without moving focus away from the anchor', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="دفتر کل">
        <button type="button">آیکون</button>
      </Tooltip>,
    );

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'آیکون' })).toHaveFocus();
  });

  it('portals the bubble out of the scrolling rail so it is never clipped', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div style={{ overflowY: 'auto', height: 40 }}>
        <Tooltip content="کاردکس">
          <a href="/kardex">آیکون</a>
        </Tooltip>
      </div>,
    );

    await user.hover(screen.getByRole('link', { name: 'آیکون' }));
    const bubble = screen.getByRole('tooltip');

    expect(container.contains(bubble)).toBe(false);
    expect(bubble.parentElement).toBe(document.body);
    expect(bubble.className).toContain('fixed');
  });

  it('renders the anchor alone when disabled or when content is blank', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <Tooltip content="پنهان" enabled={false}>
          <button type="button">بدون راهنما</button>
        </Tooltip>
        <Tooltip content="   ">
          <button type="button">محتوای خالی</button>
        </Tooltip>
      </>,
    );

    await user.hover(screen.getByRole('button', { name: 'بدون راهنما' }));
    await user.hover(screen.getByRole('button', { name: 'محتوای خالی' }));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    // A disabled/blank tooltip adds NO wrapper markup at all — the trigger is
    // rendered exactly as the caller wrote it.
    expect(container.querySelectorAll('[role="presentation"]')).toHaveLength(0);
  });

  it('keeps the bubble anchored to the measured rect of its own trigger', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="انبار" side="end">
        <button
          type="button"
          style={{ position: 'absolute', top: 120, left: 40 }}
        >
          آیکون
        </button>
      </Tooltip>,
    );

    // jsdom has no layout: give the trigger a real rect so the placement math
    // is exercised rather than the zero-rect fallback.
    const rect = {
      top: 100,
      bottom: 132,
      left: 200,
      right: 232,
      height: 32,
      width: 32,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);

    await user.hover(screen.getByRole('button', { name: 'آیکون' }));
    const bubble = screen.getByRole('tooltip');

    // side="end" in RTL = inline-end; the bubble sits centred on the trigger's
    // vertical middle and is translated fully to its left by the gap.
    expect(bubble).toHaveStyle({ top: '116px', left: '192px' });
  });
});
