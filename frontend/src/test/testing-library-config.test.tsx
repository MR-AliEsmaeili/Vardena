import { render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';

/**
 * The suite-wide `asyncUtilTimeout` (src/test/setup.ts) exists because
 * full-shell integration tests wait on a chain of providers. This test proves
 * the setting is actually in effect: the heading appears after 1.5 s, which the
 * 1 s default would have failed, and the assertion still resolves.
 */
function Deferred() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  return ready ? <h1>آماده</h1> : <p>در حال آماده‌سازی</p>;
}

describe('testing-library configuration', () => {
  it('keeps findBy queries retrying past the 1s default', async () => {
    render(<Deferred />);

    expect(
      await screen.findByRole('heading', { name: 'آماده' }),
    ).toBeInTheDocument();
  });
});
