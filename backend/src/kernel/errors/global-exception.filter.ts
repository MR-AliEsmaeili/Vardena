import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '../correlation/correlation.middleware.js';
import { getCorrelationId } from '../correlation/request-context.js';
import type { JsonLogger } from '../logging/json-logger.service.js';
import { AppException } from './app-exception.js';
import {
  STATUS_TO_CODE,
  type ApiErrorBody,
  type ErrorCode,
} from './error-codes.js';

/**
 * Global exception filter — the single renderer of API error responses.
 *
 * Guarantees (AR-24):
 * - Every error leaves the API as `{ code, message, details?, correlationId }`.
 * - 5xx responses never contain implementation details (generic message).
 * - The full error (message + stack + request context) is logged server-side
 *   with the correlation id for diagnosis.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    this.render(
      http.getRequest<Request>(),
      http.getResponse<Response>(),
      exception,
    );
  }

  /**
   * Express-level fallback for unmatched routes (see `configureApp`): no Nest
   * handler ran, so the filter would never fire — render the same envelope.
   */
  handleUnmatchedRoute(req: Request, res: Response): void {
    this.render(req, res, AppException.notFound('Route'));
  }

  private render(req: Request, res: Response, exception: unknown): void {
    const correlationId =
      getCorrelationId() ??
      res.getHeader(CORRELATION_ID_HEADER)?.toString() ??
      'unknown';

    let status = 500;
    let code: ErrorCode = 'InternalError';
    let message = 'An unexpected error occurred.';
    let details: unknown;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code =
        STATUS_TO_CODE[status] ??
        (status >= 500 ? 'InternalError' : 'BadRequest');
      message =
        code === 'InternalError'
          ? message
          : normalizeMessage(exception.message);
    }
    // Anything else (bugs, driver errors, …) keeps the generic 500 above.

    const meta = {
      method: req.method,
      path: req.originalUrl ?? req.url,
      statusCode: status,
      code,
    };
    if (status >= 500) {
      this.logger.error(
        'Request failed',
        { ...meta, error: exception },
        GlobalExceptionFilter.name,
      );
    } else if (status === 401 || status === 403 || status === 429) {
      this.logger.warn('Request rejected', meta, GlobalExceptionFilter.name);
    } else {
      this.logger.log('Request rejected', meta, GlobalExceptionFilter.name);
    }

    if (!res.headersSent) {
      res.setHeader(CORRELATION_ID_HEADER, correlationId);
      const body: ApiErrorBody =
        details !== undefined
          ? { code, message, details, correlationId }
          : { code, message, correlationId };
      res.status(status).json(body);
    }
  }
}

function normalizeMessage(message: string | string[] | unknown): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map((m) => String(m)).join('; ');
  return 'Bad request.';
}
