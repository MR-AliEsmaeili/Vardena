import type { InstallationLicense } from '../domain/license.js';

export const LICENSE_PROVIDER = Symbol('LICENSE_PROVIDER');

/** Replaceable authority boundary; consumers never know the concrete source. */
export interface LicenseProvider {
  getLicense(): Promise<InstallationLicense>;
}
