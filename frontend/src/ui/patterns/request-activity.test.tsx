import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginRequest,
  endRequest,
  resetRequestActivityForTests,
  type RequestActivityMessage,
} from '@/api/request-activity';
import { t } from '@/lib/i18n';
import {
  AMBIENT_INDICATOR_DELAY_MS,
  GLOBAL_INDICATOR_DELAY_MS,
  GlobalRequestIndicator,
  BackgroundActivityIndicator,
  LOCAL_FETCHING_DELAY_MS,
  LocalFetchingIndicator,
} from './request-activity';

/**
 * The orb is mocked to a plain canvas so these tests exercise the ONE thing
 * they own: when an indicator appears, which text it carries, and that
 * concurrent/background requests cannot duplicate or misrepresent it. The
 * real `thinking-orbs` canvas is covered in `src/ui/thinking-orb.test.tsx`.
 */
vi.mock('thinking-orbs', () => ({
  ThinkingOrb: (props: {
    size?: number;
    theme?: string;
    state?: string;
    'data-testid'?: string;
    'aria-hidden'?: boolean;
  }) => (
    <canvas
      data-testid={props['data-testid'] ?? 'thinking-orb'}
      data-size={String(props.size)}
      data-theme={props.theme}
      data-state={props.state}
      aria-hidden={props['aria-hidden']}
    />
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
  resetRequestActivityForTests();
});

afterEach(() => {
  resetRequestActivityForTests();
  vi.useRealTimers();
});

function start(
  scope: 'global' | 'background',
  message: RequestActivityMessage,
): number {
  let token = 0;
  act(() => {
    token = beginRequest({ scope, message });
  });
  return token;
}

function finish(token: number): void {
  act(() => {
    endRequest(token);
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The live region is always mounted; `data-visible` is its state. */
function globalPanel(): HTMLElement {
  return screen.getByTestId('global-request-indicator');
}

function expectGlobalHidden(): void {
  expect(globalPanel()).toHaveAttribute('data-visible', 'false');
  expect(globalPanel()).toHaveTextContent('');
}

describe('GlobalRequestIndicator', () => {
  it('stays hidden until the display threshold has passed', () => {
    render(<GlobalRequestIndicator />);
    const token = start('global', 'saving');

    advance(GLOBAL_INDICATOR_DELAY_MS - 1);
    expectGlobalHidden();

    advance(1);
    expect(globalPanel()).toHaveAttribute('data-visible', 'true');
    expect(globalPanel()).toHaveTextContent(t.loading.saving);

    finish(token);
  });

  it('does not flash for a request that settles before the threshold', () => {
    render(<GlobalRequestIndicator />);
    const token = start('global', 'saving');

    advance(100);
    finish(token);
    advance(5_000);

    // Not even after a later threshold: the request had already settled.
    expect(globalPanel()).toHaveAttribute('data-visible', 'false');
    expect(globalPanel()).toHaveTextContent('');
  });

  it('hides immediately when the request settles', () => {
    render(<GlobalRequestIndicator />);
    const token = start('global', 'saving');
    advance(GLOBAL_INDICATOR_DELAY_MS);
    expect(globalPanel()).toHaveAttribute('data-visible', 'true');

    finish(token);

    expectGlobalHidden();
  });

  it('renders one panel for two concurrent global requests', () => {
    render(<GlobalRequestIndicator />);
    const first = start('global', 'saving');
    const second = start('global', 'saving');

    advance(GLOBAL_INDICATOR_DELAY_MS);
    expect(screen.getAllByTestId('global-request-indicator')).toHaveLength(1);

    finish(first);
    expect(globalPanel()).toHaveTextContent(t.loading.saving);

    finish(second);
    expectGlobalHidden();
  });

  it('uses the neutral message when concurrent operations disagree', () => {
    render(<GlobalRequestIndicator />);
    const save = start('global', 'saving');
    const remove = start('global', 'deleting');

    advance(GLOBAL_INDICATOR_DELAY_MS);
    expect(globalPanel()).toHaveTextContent(t.loading.processing);

    finish(save);
    finish(remove);
  });

  it('is a polite live region in RTL with a light-theme inline orb', () => {
    render(<GlobalRequestIndicator />);
    const token = start('global', 'receiving');
    advance(GLOBAL_INDICATOR_DELAY_MS);

    const panel = globalPanel();
    expect(panel.tagName).toBe('OUTPUT');
    expect(panel).toHaveAttribute('dir', 'rtl');
    expect(panel).toHaveAttribute('aria-live', 'polite');
    expect(panel).toHaveAttribute('aria-atomic', 'true');
    expect(panel).toHaveAttribute('aria-busy', 'true');

    const orb = panel.querySelector('canvas');
    expect(orb).not.toBeNull();
    expect(orb).toHaveAttribute('data-theme', 'auto');
    expect(orb).toHaveAttribute('data-size', '20');
    expect(orb).toHaveAttribute('aria-hidden', 'true');

    finish(token);
  });

  it('never covers the page from a background request', () => {
    render(
      <>
        <GlobalRequestIndicator />
        <BackgroundActivityIndicator />
      </>,
    );

    const token = start('background', 'receiving');
    advance(AMBIENT_INDICATOR_DELAY_MS);

    expectGlobalHidden();
    expect(screen.getByTestId('background-activity-indicator')).toHaveAttribute(
      'data-visible',
      'true',
    );

    finish(token);
    expect(screen.getByTestId('background-activity-indicator')).toHaveAttribute(
      'data-visible',
      'false',
    );
  });

  it('keeps one empty live region mounted while idle (announcement safety)', () => {
    render(<GlobalRequestIndicator />);

    expect(globalPanel()).toHaveAttribute('aria-live', 'polite');
    expectGlobalHidden();
  });

  it('shows the ambient indicator only after its own threshold', () => {
    render(<BackgroundActivityIndicator />);
    const token = start('background', 'receiving');

    advance(AMBIENT_INDICATOR_DELAY_MS - 1);
    expect(screen.getByTestId('background-activity-indicator')).toHaveAttribute(
      'data-visible',
      'false',
    );

    advance(1);
    const indicator = screen.getByTestId('background-activity-indicator');
    expect(indicator).toHaveAttribute('data-visible', 'true');
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
    expect(indicator).toHaveAttribute('title', t.loading.background);

    finish(token);
  });
});

describe('LocalFetchingIndicator', () => {
  it('waits for the local threshold and hides as soon as refreshing ends', () => {
    const { rerender } = render(<LocalFetchingIndicator active />);

    advance(LOCAL_FETCHING_DELAY_MS - 1);
    expect(screen.getByTestId('local-fetching-indicator')).toHaveAttribute(
      'data-visible',
      'false',
    );

    advance(1);
    expect(screen.getByTestId('local-fetching-indicator')).toHaveTextContent(
      t.table.refreshing,
    );
    expect(screen.getByTestId('local-fetching-indicator')).toHaveAttribute(
      'aria-live',
      'polite',
    );

    rerender(<LocalFetchingIndicator active={false} />);
    expect(screen.getByTestId('local-fetching-indicator')).toHaveAttribute(
      'data-visible',
      'false',
    );
    expect(screen.getByTestId('local-fetching-indicator')).toHaveTextContent(
      '',
    );
  });
});
