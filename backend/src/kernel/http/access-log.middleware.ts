import type { NextFunction, Request, Response } from 'express';
import type { JsonLogger } from '../logging/json-logger.service.js';

/**
 * Minimal access log: one JSON line per finished request
 * (method, path, redacted query, status, duration). Health probes log at
 * debug so orchestrator polling does not drown production logs.
 */
export function createAccessLogger(logger: JsonLogger) {
  return function accessLog(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const startedAt = Date.now();
    res.on('finish', () => {
      const meta = {
        method: req.method,
        path: req.path,
        query: req.query,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      };
      if (req.path.startsWith('/api/v1/health')) {
        logger.debug('request', meta, 'Http');
      } else {
        logger.log('request', meta, 'Http');
      }
    });
    next();
  };
}
