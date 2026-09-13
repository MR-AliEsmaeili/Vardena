import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { DEPLOYMENT_SCOPE_PATH_PARAM } from './deployment-scope.decorator.js';

/**
 * Deployment organization pin guard (ADR-0025) — the missing principal →
 * organization binding for single-organization deployments.
 *
 * When `DEPLOYMENT_ORGANIZATION_ID` is configured, EVERY request that names
 * an organization — body field, query parameter, or (on organization-root
 * routes) the marked path parameter — must name that one organization. A
 * mismatch answers 404 `EntityNotFound`, the same answer a non-existent id
 * gets, so the HTTP surface never confirms an out-of-scope organization
 * exists (ADR-0021 §4). Routes that carry no organization id (login, health,
 * users, RBAC, the organizations list) pass through; the services bound the
 * same way confine the remaining paths.
 *
 * When no pin is configured the guard is a complete no-op: the system stays
 * in ADR-0021 "structural scoping" mode, where `organizationId` is a
 * caller-supplied parameter and multi-organization isolation is unresolved
 * (OQ-01/OQ-22).
 *
 * Registered globally (`APP_GUARD`) by OrganizationModule so that future
 * modules are confined automatically — a new organization-scoped route
 * cannot forget its check.
 */
@Injectable()
export class DeploymentOrganizationScopeGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const pin = this.config.deploymentOrganizationId;
    if (pin === null) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const named: string[] = [];

    const pathParam = this.reflector.getAllAndOverride<string | undefined>(
      DEPLOYMENT_SCOPE_PATH_PARAM,
      [context.getHandler(), context.getClass()],
    );
    if (pathParam !== undefined) {
      const value = req.params?.[pathParam];
      if (typeof value === 'string' && value !== '') named.push(value);
    }

    const bodyOrg = (req.body as { organizationId?: unknown } | undefined)
      ?.organizationId;
    if (typeof bodyOrg === 'string' && bodyOrg !== '') named.push(bodyOrg);

    const queryOrg = req.query?.['organizationId'];
    if (typeof queryOrg === 'string') {
      named.push(queryOrg);
    } else if (Array.isArray(queryOrg)) {
      for (const value of queryOrg) {
        if (typeof value === 'string') named.push(value);
      }
    }

    for (const id of named) {
      if (id !== pin) throw AppException.notFound('Organization', id);
    }
    return true;
  }
}
