import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { isValidPermissionCode } from '../domain/permission-code.js';

/**
 * Declares the permission(s) a route requires (task §12, AR-21).
 *
 * Usage (controller is transport-only — declaration, not logic):
 *
 *   @RequirePermission('Users.User.View')
 *   @UseGuards(AuthGuard, AuthorizationGuard)
 *   @Get()
 *   list() { … }
 *
 * Semantics of several codes on one route: **all of them** are required
 * (task §13, documented in docs/security.md §3).
 */
export const REQUIRE_PERMISSION_METADATA = 'vardena:require-permission';

export function RequirePermission(
  ...codes: string[]
): MethodDecorator & ClassDecorator {
  if (codes.length === 0) {
    throw new Error(
      '@RequirePermission requires at least one permission code.',
    );
  }
  for (const code of codes) {
    if (!isValidPermissionCode(code)) {
      // Thrown while the module is being loaded: a typo in a decorator must
      // fail the process, not silently protect an endpoint with a permission
      // nobody can ever hold.
      throw new Error(
        `@RequirePermission received an invalid permission code: "${code}".`,
      );
    }
  }
  return SetMetadata(REQUIRE_PERMISSION_METADATA, [...codes]);
}

/** Read the declared permissions of a route (used by the guard and tests). */
export function getRequiredPermissions(
  context: ExecutionContext,
  reflector: Reflector,
): string[] {
  return (
    reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]) ?? []
  );
}
