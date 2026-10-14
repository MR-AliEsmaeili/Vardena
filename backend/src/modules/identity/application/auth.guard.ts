import {
  CanActivate,
  type CustomDecorator,
  ExecutionContext,
  Injectable,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { AuthenticationService } from './authentication.service.js';

export const ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_METADATA =
  'identity:allowWhenPasswordChangeRequired';

export const PASSWORD_CHANGE_REQUIRED_REASON = 'password_change_required';
export const PASSWORD_CHANGE_REQUIRED_MESSAGE =
  'Password change is required before accessing this resource.';

/**
 * Marks an authenticated route as reachable while the authenticated user is
 * flagged with `mustChangePassword = true`. Applied only to the minimal
 * session-inspection (`GET /auth/me`) and self-service password-change
 * (`POST /auth/change-password`) endpoints.
 */
export const AllowWhenPasswordChangeRequired = (): CustomDecorator<string> =>
  SetMetadata(ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_METADATA, true);

/**
 * Authentication guard — reusable by future modules.
 *
 * Answers "Who is this user?" by validating the session cookie against the
 * server-side session store. Also enforces the mandatory password-change
 * quarantine: when the authenticated user has `mustChangePassword = true`,
 * every route except those explicitly decorated with
 * `@AllowWhenPasswordChangeRequired()` is rejected with 403 `PermissionDenied`
 * (`reason: 'password_change_required'`).
 *
 * On unauthenticated failure: throws `Unauthorized` with a generic message (AR-24).
 * On success: attaches the principal to request context; downstream code
 * uses `getPrincipal()` to retrieve userId/sessionId.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthenticationService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const authed = await this.auth.authenticateRequest(req);
    if (authed === null) {
      throw AppException.unauthorized('Authentication is required.');
    }

    if (authed.user.mustChangePassword) {
      const allowedWhileRestricted =
        this.reflector?.getAllAndOverride<boolean>(
          ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_METADATA,
          [context.getHandler(), context.getClass()],
        ) ?? false;
      if (!allowedWhileRestricted) {
        throw AppException.forbidden(PASSWORD_CHANGE_REQUIRED_MESSAGE, {
          reason: PASSWORD_CHANGE_REQUIRED_REASON,
        });
      }
    }

    // AuthenticatedContext is attached to request context inside
    // authenticateRequest; nothing more to do.
    void res;
    return true;
  }
}
