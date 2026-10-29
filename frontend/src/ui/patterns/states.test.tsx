import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FullPageLoading, LoadingState, UnavailableState } from './states';

/**
 * The shared placeholders must keep the content's shape (standards §10) while
 * the Thinking Orb is the only animation and the visible Persian label is the
 * only announced text.
 */
describe('LoadingState', () => {
  it('renders one orb, one label and a hidden skeleton', () => {
    render(<LoadingState label="در حال دریافت اسناد…" rows={4} />);

    const state = screen.getByTestId('loading-state');
    expect(state.tagName).toBe('OUTPUT');
    expect(state).toHaveAttribute('aria-busy', 'true');
    expect(state).toHaveAttribute('aria-live', 'polite');
    expect(state).toHaveTextContent('در حال دریافت اسناد…');

    const orb = state.querySelector('canvas');
    expect(orb).not.toBeNull();
    expect(orb).toHaveAttribute('aria-hidden', 'true');

    const skeletonRows = state.querySelectorAll('[aria-hidden="true"] .h-9');
    expect(skeletonRows).toHaveLength(4);
  });
});

describe('FullPageLoading', () => {
  it('is reserved for bootstrap and uses the 64px orb', () => {
    render(<FullPageLoading label="در حال بررسی نشست…" />);

    const state = screen.getByTestId('full-page-loading');
    expect(state).toHaveAttribute('aria-busy', 'true');
    expect(state).toHaveTextContent('در حال بررسی نشست…');

    const orb = state.querySelector('canvas');
    expect(orb).not.toBeNull();
    expect(orb).toHaveAttribute('width', '64');
  });
});

/**
 * The availability notice (no permission / no scope) is one shared pattern —
 * the six hand-copied dashed boxes must stay visually identical.
 */
describe('UnavailableState', () => {
  it('renders the availability message in the shared dashed box', () => {
    render(<UnavailableState description="دسترسی لازم را ندارید" />);

    const state = screen.getByTestId('unavailable-state');
    expect(state).toHaveTextContent('دسترسی لازم را ندارید');
    expect(state.className).toContain('rounded-card');
    expect(state.className).toContain('border-dashed');
  });

  it('keeps caller layout adjustments through className', () => {
    render(
      <UnavailableState
        description="دامنه مالی فعالی وجود ندارد"
        className="m-4"
      />,
    );

    const state = screen.getByTestId('unavailable-state');
    expect(state.className).toContain('m-4');
    expect(state.className).toContain('rounded-card');
  });
});
