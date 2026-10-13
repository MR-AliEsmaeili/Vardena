import { describe, expect, it } from 'vitest';
import { REDACTED, isSensitiveKey, redact } from './redaction.js';

describe('isSensitiveKey', () => {
  it('matches common secret key spellings', () => {
    for (const key of [
      'password',
      'passwordHash',
      'passwd',
      'secret',
      'clientSecret',
      'api_secret',
      'token',
      'accessToken',
      'refresh-token',
      'authorization',
      'authHeader',
      'cookie',
      'set-cookie',
      'credentials',
      'privateKey',
      'apiKey',
      'accessKey',
      'DATABASE_URL',
      'databaseUrl',
      'connectionString',
      'jwt',
      'sessionKey',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it('does not match ordinary keys', () => {
    for (const key of [
      'username',
      'email',
      'author',
      'message',
      'statusCode',
      'correlationId',
      'entity',
      'id',
    ]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe('redact', () => {
  it('redacts secrets in nested objects and arrays', () => {
    const input = {
      username: 'alice',
      password: 'hunter2',
      nested: { tokens: ['a', 'b'], count: 3 },
      sessions: [{ token: 'abc', ip: '10.0.0.1' }],
    };
    expect(redact(input)).toEqual({
      username: 'alice',
      password: REDACTED,
      nested: { tokens: REDACTED, count: 3 },
      sessions: [{ token: REDACTED, ip: '10.0.0.1' }],
    });
    // Input is not mutated.
    expect(input.password).toBe('hunter2');
  });

  it('serializes Errors without losing the stack', () => {
    const error = new Error('boom');
    const out = redact({ error }) as {
      error: { name: string; message: string; stack: string };
    };
    expect(out.error.name).toBe('Error');
    expect(out.error.message).toBe('boom');
    expect(out.error.stack).toContain('boom');
  });

  it('survives circular references, bigint, and deep nesting', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    expect(redact(circular)).toEqual({ a: 1, self: '[Circular]' });
    expect(redact({ n: 10n })).toEqual({ n: '10' });

    let deep: unknown = { leaf: 'x' };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain('[Truncated]');
  });
});
