import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FullPageLoading, LoadingState } from './states';

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
