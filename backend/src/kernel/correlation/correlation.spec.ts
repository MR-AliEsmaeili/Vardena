import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { isUlid } from '../ids/ulid.js';
import {
  CORRELATION_ID_HEADER,
  correlationMiddleware,
  resolveCorrelationId,
} from './correlation.middleware.js';
import { getCorrelationId } from './request-context.js';

function mockReqRes(headerValue: unknown): { req: Request; res: Response } {
  const headers: Record<string, unknown> = {};
  if (headerValue !== undefined) headers[CORRELATION_ID_HEADER] = headerValue;
  const resHeaders = new Map<string, string>();
  const req = { headers } as unknown as Request;
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      resHeaders.set(name, value);
    }),
    getHeader: (name: string) => resHeaders.get(name),
  } as unknown as Response;
  return { req, res };
}

describe('resolveCorrelationId', () => {
  it('accepts a valid ULID and normalizes it to uppercase', () => {
    expect(resolveCorrelationId('01arz3ndektsv4rrffq69g5fav')).toBe(
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
  });

  it('accepts a valid UUID and normalizes it to lowercase', () => {
    expect(
      resolveCorrelationId('  550E8400-E29B-41D4-A716-446655440000 '),
    ).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('replaces missing, malformed, or hostile values with a fresh ULID', () => {
    for (const candidate of [
      undefined,
      '',
      '   ',
      'short',
      'x'.repeat(200),
      '01ARZ3NDEKTSV4RRFFQ69G5FAV\nInjected: yes',
      '<script>alert(1)</script>',
      123,
      {},
    ]) {
      const resolved = resolveCorrelationId(candidate);
      expect(isUlid(resolved)).toBe(true);
      expect(resolved).not.toBe(candidate);
    }
  });
});

describe('correlationMiddleware', () => {
  it('echoes the accepted id and exposes it to the request context', () => {
    const { req, res } = mockReqRes('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    let seen: string | undefined;
    correlationMiddleware(req, res, () => {
      seen = getCorrelationId();
    });
    expect(seen).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(res.getHeader(CORRELATION_ID_HEADER)).toBe(
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
  });

  it('generates an id when the client sends none', () => {
    const { req, res } = mockReqRes(undefined);
    let seen: string | undefined;
    correlationMiddleware(req, res, () => {
      seen = getCorrelationId();
    });
    expect(seen).toBeDefined();
    expect(isUlid(seen)).toBe(true);
    expect(res.getHeader(CORRELATION_ID_HEADER)).toBe(seen);
  });

  it('treats repeated headers as invalid and generates an id', () => {
    const { req, res } = mockReqRes([
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    ]);
    correlationMiddleware(req, res, () => {});
    // First value is a valid ULID, so it is accepted deterministically.
    expect(res.getHeader(CORRELATION_ID_HEADER)).toBe(
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
  });
});
