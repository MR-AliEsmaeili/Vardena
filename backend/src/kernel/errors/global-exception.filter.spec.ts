import {
  ArgumentsHost,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { CORRELATION_ID_HEADER } from '../correlation/correlation.middleware.js';
import { runWithRequestContext } from '../correlation/request-context.js';
import type { JsonLogger } from '../logging/json-logger.service.js';
import { AppException } from './app-exception.js';
import { GlobalExceptionFilter } from './global-exception.filter.js';

function mockHost(): {
  host: ArgumentsHost;
  res: Response;
  json: ReturnType<typeof vi.fn>;
} {
  const headers = new Map<string, string>();
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  const req = { method: 'GET', originalUrl: '/api/v1/widgets' } as Request;
  const res = {
    headersSent: false,
    getHeader: vi.fn((name: string) => headers.get(name)),
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
    status,
    json,
  } as unknown as Response;
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res, json };
}

function mockLogger(): JsonLogger {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as JsonLogger;
}

describe('GlobalExceptionFilter', () => {
  it('renders AppException with its code, message, details, and correlation id', () => {
    const logger = mockLogger();
    const { host, res, json } = mockHost();
    runWithRequestContext({ correlationId: 'cid-1' }, () => {
      new GlobalExceptionFilter(logger).catch(
        AppException.notFound('Widget', 'w1'),
        host,
      );
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      code: 'EntityNotFound',
      message: 'Widget was not found.',
      details: { entity: 'Widget', id: 'w1' },
      correlationId: 'cid-1',
    });
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'cid-1');
  });

  it('sanitizes unexpected errors to a generic 500 and logs the original', () => {
    const logger = mockLogger();
    const { host, res, json } = mockHost();
    const boom = new Error("SELECT * FROM secret -- '; DROP");
    new GlobalExceptionFilter(logger).catch(boom, host);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = (json as unknown as { mock: { calls: [unknown][] } }).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(body['code']).toBe('InternalError');
    expect(body['message']).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('SELECT');
    expect(logger.error).toHaveBeenCalled();
  });

  it('maps framework HttpExceptions onto stable codes without leaking 5xx messages', () => {
    const logger = mockLogger();
    const router404 = mockHost();
    new GlobalExceptionFilter(logger).catch(
      new NotFoundException('Cannot GET /api/v1/nope'),
      router404.host,
    );
    expect(router404.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'EntityNotFound',
        message: 'Cannot GET /api/v1/nope',
      }),
    );

    const teapot = mockHost();
    new GlobalExceptionFilter(logger).catch(
      new HttpException('short and stout', 418),
      teapot.host,
    );
    expect(teapot.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BadRequest' }),
    );

    const raw500 = mockHost();
    new GlobalExceptionFilter(logger).catch(
      new HttpException('db exploded at 10.1.2.3', 500),
      raw500.host,
    );
    const body = (raw500.json as unknown as { mock: { calls: [unknown][] } })
      .mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'InternalError',
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(body)).not.toContain('10.1.2.3');
  });

  it('falls back to "unknown" correlation id and skips sent responses', () => {
    const logger = mockLogger();
    const { host, json } = mockHost();
    new GlobalExceptionFilter(logger).catch(AppException.conflict(), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'unknown' }),
    );

    const sent = mockHost();
    (sent.res as unknown as { headersSent: boolean }).headersSent = true;
    new GlobalExceptionFilter(logger).catch(AppException.conflict(), sent.host);
    expect(sent.json).not.toHaveBeenCalled();
  });
});
