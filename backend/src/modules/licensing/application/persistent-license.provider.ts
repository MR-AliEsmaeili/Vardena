import { Injectable } from '@nestjs/common';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { LicensesRepository } from '../data/licenses.repository.js';
import type { InstallationLicense } from '../domain/license.js';
import {
  coverageEndOf,
  findScheduledVersion,
  resolveEffectiveVersion,
  sortVersionsNewestFirst,
  toInstallationLicense,
  toLicenseVersionSummary,
} from '../domain/license-version.js';
import { InstallationIdentityService } from './installation-identity.service.js';
import type {
  LicenseProvider,
  LicenseVersionSnapshot,
} from './license-provider.js';

export const PERSISTENT_LICENSE_PROVIDER_NAME = 'persistent';

/**
 * The default licensing authority: the license this installation has
 * actually activated, read from `licensing.licenses` (L-02).
 *
 * Properties that matter:
 * - **restart-safe** — the license lives in the database, so a backend,
 *   container or frontend restart re-reads the same license and never asks
 *   for the code again;
 * - **no startup activation** — reading is a query; activation happens only
 *   through `POST /api/v1/license/activate`;
 * - **no implicit grant** — no persisted license means `UNLICENSED`,
 *   whatever `NODE_ENV` says;
 * - **offline** — no CRM or external licensing server is contacted.
 *
 * The row is the evaluation input, not the verdict: expiry, suspension and
 * validity windows are decided by `evaluateLicense` on every read, so a
 * license that expires while the process runs becomes inactive without any
 * restart or background job.
 */
@Injectable()
export class PersistentLicenseProvider implements LicenseProvider {
  readonly name = PERSISTENT_LICENSE_PROVIDER_NAME;

  constructor(
    private readonly identity: InstallationIdentityService,
    private readonly licenses: LicensesRepository,
    private readonly logger: JsonLogger,
  ) {}

  async getLicense(at = new Date()): Promise<InstallationLicense | null> {
    const installation = await this.identity.current();
    const versions = await this.licenses.listVersions(
      installation.installationId,
    );
    if (versions.length === 0) return null;
    const resolution = resolveEffectiveVersion(versions, at);
    if (resolution.version === null) return null;
    if (resolution.kind === 'ambiguous') {
      // Defensive failure mode for corrupted data, not a precedence policy
      // (design §3.2 rule 7): report the deterministic choice, loudly.
      this.logger.warn(
        'Multiple retained license versions cover the same instant',
        {
          installationId: installation.installationId,
          chosenVersionId: resolution.version.versionId,
          covering: resolution.covering.length,
        },
        PersistentLicenseProvider.name,
      );
    }
    return toInstallationLicense(resolution.version, this.name);
  }

  /**
   * Retained-version evidence for the state endpoint. The effective id is the
   * SAME resolution `getLicense()` used, so the UI can never label a version
   * "effective" that the evaluation did not choose.
   */
  async versionHistory(at = new Date()): Promise<LicenseVersionSnapshot> {
    const installation = await this.identity.current();
    const versions = await this.licenses.listVersions(
      installation.installationId,
    );
    if (versions.length === 0) {
      return {
        effectiveVersionId: null,
        scheduled: null,
        versions: [],
        coverageEnd: null,
      };
    }
    const resolution = resolveEffectiveVersion(versions, at);
    const effectiveVersionId = resolution.version?.versionId ?? null;
    const scheduled = findScheduledVersion(versions, at);
    return {
      effectiveVersionId,
      scheduled:
        scheduled === null
          ? null
          : toLicenseVersionSummary(scheduled, effectiveVersionId),
      versions: sortVersionsNewestFirst(versions).map((version) =>
        toLicenseVersionSummary(version, effectiveVersionId),
      ),
      // The chain tail is resolved from the same rows and the same instant as
      // the effective version above, so the reported coverage end is the end of
      // the term the installation actually holds (OD-LIC-06 §6).
      coverageEnd: coverageEndOf(versions, at)?.toISOString() ?? null,
    };
  }

  async installationId(): Promise<string | null> {
    return this.identity.currentIdOrNull();
  }
}
