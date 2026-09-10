import { describe, expect, it } from 'vitest';
import { SessionTokenService } from './session-token.service.js';

describe('SessionTokenService', () => {
  const svc = new SessionTokenService();

  it('generates a high-entropy base64url token (256 bits = ~43 chars)', () => {
    const a = svc.generateToken();
    const b = svc.generateToken();
    expect(a).not.toBe(b);
    // 32 bytes base64url-encoded = 43 characters.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes tokens to a stable SHA-256 hex digest', () => {
    const token = 'some-random-token-value';
    const h1 = svc.hashToken(token);
    const h2 = svc.hashToken(token);
    expect(h1).toBe(h2);
    // SHA-256 hex digest is 64 hex chars.
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(token);
  });

  it('produces different hashes for different tokens', () => {
    expect(svc.hashToken('a')).not.toBe(svc.hashToken('b'));
  });
});
