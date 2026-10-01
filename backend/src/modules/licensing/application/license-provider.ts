import type { InstallationLicense } from '../domain/license.js';

export const LICENSE_PROVIDER = Symbol('LICENSE_PROVIDER');

/**
 * Replaceable authority boundary; consumers never know the concrete source.
 *
 * `getLicense()` returns `null` when the installation holds no license at
 * all — the state of every fresh installation. A provider never invents an
 * active license, and `LicensingService` turns the null into the explicit
 * `UNLICENSED` evaluation instead of letting callers guess.
 *
 * `installationId()` is optional because installation identity is a fact
 * about the deployment, not about the license: a provider that knows the
 * identity (the persistent one) reports it even while unlicensed, so an
 * operator can obtain a license bound to exactly this installation.
 */
export interface LicenseProvider {
  /** Stable name reported as `provider` in the evaluated state. */
  readonly name?: string;
  getLicense(): Promise<InstallationLicense | null>;
  installationId?(): Promise<string | null>;
}
