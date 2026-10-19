import type { InstallationLicense } from '../domain/license.js';
import type { LicenseVersionSummary } from '../domain/license-version.js';

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
/**
 * Retained-version evidence a provider may report alongside the evaluated
 * license (L-03). It is informational: `getLicense()` stays the single
 * authority on what the installation is, and the *effective* version is
 * resolved deterministically inside the provider (design §3.2).
 */
export interface LicenseVersionSnapshot {
  /** The version that governs now, or null when no version could be resolved. */
  effectiveVersionId: string | null;
  /** Earliest not-yet-effective version, if any (a scheduled renewal). */
  scheduled: LicenseVersionSummary | null;
  /** Retained versions, newest first (the caller bounds how many it shows). */
  versions: LicenseVersionSummary[];
  /**
   * Where the installation's unbroken coverage chain ends: the effective end of
   * the chain's tail, or null when the chain is perpetual or no version could be
   * resolved (OD-LIC-06 §6, PO decision Q-2 = `coverage_end`). A scheduled
   * renewal is inside the chain, so this is the end of the whole purchased
   * coverage — not the end of the version that governs now.
   */
  coverageEnd: string | null;
}

export interface LicenseProvider {
  /** Stable name reported as `provider` in the evaluated state. */
  readonly name?: string;
  /**
   * The license this installation holds. `at` is the evaluation instant: a
   * version-model provider resolves which retained version governs AT that
   * instant, so an as-of read (tests, audits, the caller's clock) is answered
   * by the same rules as the live read. Providers that hold no dated versions
   * may ignore it.
   */
  getLicense(at?: Date): Promise<InstallationLicense | null>;
  installationId?(): Promise<string | null>;
  /**
   * Optional: providers without retained versions (the configuration-backed
   * development authority) simply omit it and the API reports no history.
   */
  versionHistory?(at?: Date): Promise<LicenseVersionSnapshot>;
}
