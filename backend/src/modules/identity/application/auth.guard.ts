import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { AuthenticationService } from './authentication.service.js';

/**
 * Authentication guard — reusable by future modules.
 *
 * Answers "Who is this user?" by validating the session cookie against the
 * server-side session store. It does NOT check permissions (that is RBAC's
 * job — authorization lands in a later session). Controllers that require
 * an authenticated user apply this guard; controllers that need to be
 * anonymous (login) explicitly do NOT.
 *
 * On failure: throws `Unauthorized` with a generic message (AR-24).
 * On success: attaches the principal to request context; downstream code
 * uses `getPrincipal()` to retrieve userId/sessionId.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const authed = await this.auth.authenticateRequest(req);
    if (authed === null) {
      throw AppException.unauthorized('Authentication is required.');
    }
    // AuthenticatedContext is attached to request context inside
    // authenticateRequest; nothing more to do.
    void res;
    return true;
  }
}
