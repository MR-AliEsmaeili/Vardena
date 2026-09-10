import type { Request, Response } from 'express';
import type { GlobalExceptionFilter } from '../errors/global-exception.filter.js';

/**
 * Terminal middleware: reached only when no route matched. Express would
 * otherwise answer with its own HTML 404, bypassing the API error envelope —
 * delegate to the global filter so unknown routes render `EntityNotFound`.
 *
 * MUST be registered after Nest mounts its routes (see `configureApp`):
 * anything registered before the router would swallow every request.
 */
export function createNotFoundFallback(filter: GlobalExceptionFilter) {
  return function notFoundFallback(req: Request, res: Response): void {
    filter.handleUnmatchedRoute(req, res);
  };
}
