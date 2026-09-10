import { describe, expect, it } from 'vitest';
import { isSessionValid, type Session } from './session.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = new Date();
  return {
    id: 'sess_01',
    userId: 'user_01',
    tokenHash: 'hash',
    userAgent: null,
    ipAddress: null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  };
}

describe('isSessionValid', () => {
  it('accepts a fresh session', () => {
    expect(isSessionValid(makeSession())).toBe(true);
  });

  it('rejects a revoked session', () => {
    expect(isSessionValid(makeSession({ revokedAt: new Date() }))).toBe(false);
  });

  it('rejects an idle-expired session', () => {
    const past = new Date(Date.now() - 60_000);
    expect(
      isSessionValid(
        makeSession({
          expiresAt: past,
          absoluteExpiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).toBe(false);
  });

  it('rejects an absolute-expired session even if idle is in future', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    expect(
      isSessionValid(
        makeSession({ expiresAt: future, absoluteExpiresAt: past }),
      ),
    ).toBe(false);
  });
});
