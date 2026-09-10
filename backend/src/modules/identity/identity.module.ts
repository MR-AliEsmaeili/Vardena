import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { SessionsRepository } from './data/sessions.repository.js';
import { SessionTokenService } from './domain/session-token.service.js';
import { AuthenticationService } from './application/authentication.service.js';
import { AuthController } from './api/auth.controller.js';
import { AuthGuard } from './application/auth.guard.js';
import { LoginRateLimitMiddleware } from './api/login-rate-limit.middleware.js';

/**
 * Identity module (docs/modules.md §Identity, ADR-0007).
 *
 * Owns: `identity.sessions` and the mechanics of session-based auth
 * (login, logout, session validation, cookie). Password hashing lives in
 * the Users module (which owns `users.users.password_hash`).
 */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    SessionsRepository,
    SessionTokenService,
    AuthenticationService,
    AuthGuard,
    LoginRateLimitMiddleware,
  ],
  exports: [AuthenticationService, AuthGuard],
})
export class IdentityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Stricter rate limit on the login endpoint (security.md §5). Config is
    // read via the injected middleware (see file) so values come from
    // AppConfig / env.
    //
    // forRoutes accepts either the controller class (applies to every
    // method) or a path. We target the controller and let the middleware
    // itself skip non-login methods — cleanest way to apply a per-method
    // middleware in the presence of a global prefix + URI versioning
    // (both of which complicate explicit path strings).
    consumer.apply(LoginRateLimitMiddleware).forRoutes(AuthController);
  }
}
