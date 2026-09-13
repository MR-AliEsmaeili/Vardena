import type { AppConfig } from '../../src/kernel/config/app-config.js';

/**
 * Minimal `AppConfig` doubles for specs that wire application services by
 * hand (the real configuration is validated and loaded by `loadAppConfig` in
 * the running app and in the e2e harness).
 *
 * Only the deployment-organization pin (ADR-0025) is read by the services
 * under test, so the other technical settings are irrelevant here; the cast
 * keeps this helper honest about being a partial double.
 */

/** Default fixture configuration: no deployment pin (ADR-0021 structural mode). */
export const UNPINNED_APP_CONFIG: AppConfig = {
  deploymentOrganizationId: null,
} as unknown as AppConfig;

/** Fixture configuration pinned to exactly one organization (ADR-0025). */
export function pinnedAppConfig(organizationId: string): AppConfig {
  return {
    deploymentOrganizationId: organizationId,
  } as unknown as AppConfig;
}
