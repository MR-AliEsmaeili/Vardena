import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  getPrincipal,
  getCorrelationId,
} from '../../../kernel/correlation/request-context.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  getRequiredPermissions,
  REQUIRE_PERMISSION_METADATA,
} from './require-permission.decorator.js';
import { AuthorizationService } from './authorization.service.js';

/**
 * Authorization guard (task §11/§12, docs/security.md §3).
 *
 * Runs *after* the authentication guard: authentication answers "who is this?"
 * (Identity), authorization answers "may they do this?" (RBAC). A valid
 * session does not imply authorization — without the declared permission the
 * request is rejected with 403 before any controller code runs.
 *
 * Failure semantics:
 * - no `@RequirePermission` metadata → **fail closed**. A protected route that
 *   forgot to declare its permission is a programming error: it returns 500
 *   (never a silently allowed endpoint).
 * - request context without a principal → 401 (authentication is not the
 *   caller's to fake; the authentication guard normally handles this first).
 * - principal lacking every required code → 403 `PermissionDenied`.
 *
 * Multiple required permissions are ALL required (task §13). The denial is
 * logged with actor + codes + correlation id so the future Audit module has a
 * trail to consume; nothing about the *required* permissions is returned to
 * the client.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSION_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined || required.length === 0) {
      // Fail closed: an endpoint without declared permissions must not become
      // an unprotected endpoint by accident.
      throw new InternalServerErrorException(
        'Route is not configured: missing @RequirePermission declaration.',
      );
    }

    const principal = getPrincipal();
    if (principal === undefined) {
      throw AppException.unauthorized('Authentication is required.');
    }

    const allowed = await this.authorization.hasAllPermissions(
      principal.userId,
      required,
    );
    if (!allowed) {
      const request = context.switchToHttp().getRequest<Request>();
      this.logger.warn(
        'Authorization denied',
        {
          userId: principal.userId,
          requiredPermissions: getRequiredPermissions(context, this.reflector),
          method: request.method,
          path: request.originalUrl ?? request.url,
          correlationId: getCorrelationId(),
        },
        AuthorizationGuard.name,
      );
      // Generic message: the client learns "denied", not which permission it
      // would need (AR-24 — no security internals in responses).
      throw AppException.forbidden();
    }

    return true;
  }
}
