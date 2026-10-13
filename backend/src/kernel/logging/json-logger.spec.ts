import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppConfig } from '../config/app-config.js';
import { runWithRequestContext } from '../correlation/request-context.js';
import { JsonLogger } from './json-logger.service.js';
import { REDACTED } from './redaction.js';

const DB = 'postgresql://vardena:secret@localhost:5432/vardena';

function makeLogger(
  logLevel: 'debug' | 'info' | 'warn' | 'error' = 'debug',
): JsonLogger {
  return new JsonLogger(
    loadAppConfig({ DATABASE_URL: DB, LOG_LEVEL: logLevel }),
  );
}

describe('JsonLogger', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((() => true) as typeof process.stdout.write);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  function lastRecord(): Record<string, unknown> {
    const calls = writeSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return JSON.parse(calls[calls.length - 1]?.[0] as string) as Record<
      string,
      unknown
    >;
  }

  it('writes one JSON object per line with timestamp, level, and message', () => {
    makeLogger().log('hello', 'Ctx');
    const record = lastRecord();
    expect(record['level']).toBe('info');
    expect(record['message']).toBe('hello');
    expect(record['context']).toBe('Ctx');
    expect(typeof record['timestamp']).toBe('string');
    expect(writeSpy.mock.calls[0]?.[0]).toMatch(/\n$/);
  });

  it('attaches the ambient correlation id automatically', () => {
    runWithRequestContext(
      { correlationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      () => {
        makeLogger().warn('careful');
      },
    );
    expect(lastRecord()['correlationId']).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('spreads redacted meta top-level and protects reserved keys', () => {
    makeLogger().log(
      'login',
      { username: 'a', password: 'x', level: 'forged', message: 'forged' },
      'Auth',
    );
    const record = lastRecord();
    expect(record['username']).toBe('a');
    expect(record['password']).toBe(REDACTED);
    expect(record['level']).toBe('info');
    expect(record['message']).toBe('login');
  });

  it('serializes errors with stack and honors the configured level', () => {
    const logger = makeLogger('warn');
    logger.debug('hidden');
    expect(writeSpy).not.toHaveBeenCalled();

    logger.error('failed', new Error('boom'), 'Svc');
    const record = lastRecord();
    expect(record['level']).toBe('error');
    expect((record['error'] as { message: string }).message).toBe('boom');
    expect((record['error'] as { stack: string }).stack).toContain('boom');
  });
});
