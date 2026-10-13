import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes a password with argon2id and never returns plaintext', async () => {
    const password = 'correct horse battery staple';
    const hash = await svc.hash(password);
    expect(hash).not.toBe(password);
    expect(hash).not.toContain(password);
    expect(svc.isArgon2idHash(hash)).toBe(true);
  });

  it('verifies correct password against its hash', async () => {
    const password = 's3cret!';
    const hash = await svc.hash(password);
    expect(await svc.verify(hash, password)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await svc.hash('right-password');
    expect(await svc.verify(hash, 'wrong-password')).toBe(false);
  });

  it('returns false (does not throw) for malformed hashes', async () => {
    expect(await svc.verify('not-a-real-hash', 'whatever')).toBe(false);
    expect(await svc.verify('', 'x')).toBe(false);
  });

  it('produces distinct hashes for the same password (salted)', async () => {
    const a = await svc.hash('same-password');
    const b = await svc.hash('same-password');
    expect(a).not.toBe(b);
  });
});
