import { Inject, Injectable } from '@nestjs/common';
import type { KeyObject } from 'node:crypto';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { LicensesRepository } from '../data/licenses.repository.js';
import {
  LicenseCodeError,
  licenseCodeHash,
  parseLicenseCode,
  parsePublicKey,
  toInstallationLicense,
} from '../domain/license-code.js';
import type { EvaluatedLicense } from '../domain/license.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import { InstallationIdentityService } from './installation-identity.service.js';
import { LicensingService } from './licensing.service.js';
import { PERSISTENT_LICENSE_PROVIDER_NAME } from './persistent-license.provider.js';

export interface ActivationResult {
  /** False when the submitted code was already the current license. */
  changed: boolean;
  license: EvaluatedLicense;
}

/**
 * Activation of the installation license from a signed license code (L-02).
 *
 * The client supplies ONE thing: the code. Everything trusted — identifiers,
 * validity, limits, entitlements, customer — is derived from the verified
 * payload inside it, so a caller can never post a license object and grant
 * itself capabilities.
 *
 * Rejection order is deliberate and total (no ambiguous outcome):
 *   1. authorization  — `Licensing.License.Activate`;
 *   2. authenticity   — format, version, Ed25519 signature, canonical form;
 *   3. binding        — the payload names THIS installation;
 *   4. semantics      — validity interval, limits, known entitlements;
 *   5. lifecycle      — expired / not-yet-valid / suspended / revoked.
 * A license that fails any step is never persisted, so an invalid activation
 * can never silently replace or deactivate a valid current license.
 *
 * Re-submitting the current code is idempotent success (`changed: false`); a
 * different valid code is an explicit replacement that stamps the previous
 * row as replaced inside the same transaction.
 */
@Injectable()
export class LicenseActivationService {
  /**
   * Parsed once at startup so a malformed authority key fails the boot with
   * a clear message instead of surfacing as a server error on activation.
   */
  private readonly publicKeys: KeyObject[];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authorization: AuthorizationService,
    private readonly identity: InstallationIdentityService,
    private readonly licenses: LicensesRepository,
    private readonly licensing: LicensingService,
    private readonly logger: JsonLogger,
  ) {
    this.publicKeys = config.licensing.signingPublicKeys.map(
      (material, index) => {
        try {
          return parsePublicKey(material);
        } catch {
          throw new Error(
            `LICENSE_SIGNING_PUBLIC_KEYS entry ${index + 1} is not a valid Ed25519 public key (PEM or base64 DER).`,
          );
        }
      },
    );
  }

  async activate(rawCode: string): Promise<ActivationResult> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
    ]);

    const code = rawCode.trim();
    const installation = await this.identity.current();
    const payload = this.parse(code);

    // 3. Installation binding. A license issued for another installation is
    //    rejected here; the frontend never chooses the trusted identity.
    if (payload.installationId !== installation.installationId) {
      this.logger.warn(
        'License activation rejected: installation mismatch',
        {
          installationId: installation.installationId,
          licenseInstallationId: payload.installationId,
        },
        LicenseActivationService.name,
      );
      throw AppException.businessRule(
        'This license code was issued for a different Vardena installation.',
      );
    }

    // 5. Lifecycle. Evaluation is shared with the read path so activation and
    //    `GET /license/current` can never disagree about what "active" means.
    const candidate = toInstallationLicense(
      payload,
      PERSISTENT_LICENSE_PROVIDER_NAME,
    );
    const evaluation = this.licensing.evaluate(candidate);
    if (!evaluation.active) {
      throw AppException.businessRule(
        inactiveActivationMessage(evaluation.inactiveReason),
      );
    }

    const codeHash = licenseCodeHash(code);
    const current = await this.licenses.findCurrent(
      installation.installationId,
    );
    if (current !== null && current.codeHash === codeHash) {
      // Idempotent: the same license is already the current one. Nothing is
      // written, nothing is replaced, and the caller sees the same state.
      return { changed: false, license: await this.licensing.current() };
    }

    const principal = getPrincipal();
    await this.licenses.activate({
      installationId: installation.installationId,
      customerId: payload.customerId,
      customerName: payload.customerName,
      license: candidate,
      code,
      codeHash,
      activatedBy: principal?.userId ?? null,
      now: new Date(),
    });

    this.logger.log(
      'Installation license activated',
      {
        installationId: installation.installationId,
        licenseId: payload.licenseId,
        replacedLicenseId: current?.licenseId ?? null,
      },
      LicenseActivationService.name,
    );

    return { changed: true, license: await this.licensing.current() };
  }

  private parse(code: string): ReturnType<typeof parseLicenseCode> {
    try {
      return parseLicenseCode(code, this.publicKeys);
    } catch (error) {
      if (error instanceof LicenseCodeError) {
        this.logger.warn(
          'License activation rejected',
          { reason: error.reason },
          LicenseActivationService.name,
        );
        throw AppException.businessRule(error.message);
      }
      throw error;
    }
  }
}

function inactiveActivationMessage(
  reason: EvaluatedLicense['inactiveReason'],
): string {
  switch (reason) {
    case 'expired':
      return 'This license code has expired and cannot be activated.';
    case 'not-yet-valid':
      return 'This license code is not valid yet and cannot be activated.';
    case 'status':
      return 'This license code is suspended or revoked and cannot be activated.';
    default:
      return 'This license code cannot be activated.';
  }
}
