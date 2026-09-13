import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key: names the route parameter that carries the organization id
 * for routes on the organization ROOT resource (`/organizations/:id`,
 * `/organizations/:id/enable`, …). Every other organization-scoped route
 * carries the id in `?organizationId=` or in the JSON body and needs no
 * marker — the deployment-scope guard inspects those uniformly.
 */
export const DEPLOYMENT_SCOPE_PATH_PARAM =
  'DeploymentOrganizationScopePathParam';

/**
 * Mark an organization-root route whose `:param` (default `id`) identifies
 * the organization, so the deployment pin guard can confine it (ADR-0025).
 */
export const DeploymentOrganizationRoot = (param = 'id') =>
  SetMetadata(DEPLOYMENT_SCOPE_PATH_PARAM, param);
