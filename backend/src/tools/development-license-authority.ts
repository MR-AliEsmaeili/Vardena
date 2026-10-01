import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { generateId } from '../kernel/ids/ulid.js';
import {
  parsePrivateKey,
  signLicenseCode,
  type LicensePayload,
} from '../modules/licensing/domain/license-code.js';

/**
 * Development/test licensing authority (L-02).
 *
 * This is the ONLY license-issuing code in the repository and it is not part
 * of the HTTP surface: there is no `POST /license/generate`, in any
 * environment. Issuing is a deliberate operator action performed with
 * `npm run license:issue`, which signs with a private key supplied by the
 * operator on the command line / environment and never persisted by the
 * application. The server only ever holds the matching PUBLIC key.
 *
 * The functions live in `src/` (not in a loose script) so the issuing format
 * and the verifying format are literally the same module — a test can issue a
 * license and feed it to the real activation path, which is what keeps the
 * two from drifting apart.
 */

export interface GeneratedKeyPair {
  /** base64 DER (SPKI) — this is what `LICENSE_SIGNING_PUBLIC_KEYS` takes. */
  publicKey: string;
  /** base64 DER (PKCS8) — kept by the issuing authority, never by the app. */
  privateKey: string;
}

export function generateAuthorityKeyPair(): GeneratedKeyPair {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
    privateKey: pair.privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
  };
}

export interface IssueLicenseOptions {
  installationId: string;
  customerId?: string;
  customerName?: string;
  licenseId?: string;
  status?: LicensePayload['status'];
  validFrom?: Date;
  validUntil?: Date | null;
  organizationLimit?: number | null;
  userLimit?: number | null;
  moduleEntitlements?: readonly string[];
  featureEntitlements?: readonly string[];
}

export function buildLicensePayload(
  options: IssueLicenseOptions,
): LicensePayload {
  return {
    version: 1,
    licenseId: options.licenseId ?? generateId(),
    customerId: options.customerId ?? generateId(),
    customerName: options.customerName ?? 'Development customer',
    installationId: options.installationId,
    status: options.status ?? 'ACTIVE',
    validFrom: options.validFrom ?? new Date('2020-01-01T00:00:00.000Z'),
    validUntil: options.validUntil ?? null,
    organizationLimit: options.organizationLimit ?? null,
    userLimit: options.userLimit ?? null,
    moduleEntitlements: options.moduleEntitlements ?? [
      'accounting',
      'documents',
      'inventory',
      'organization',
      'rbac',
      'users',
      'workflow',
    ],
    featureEntitlements: options.featureEntitlements ?? [],
  };
}

/** Issue a signed license code for exactly one installation. */
export function issueLicenseCode(
  options: IssueLicenseOptions,
  privateKey: KeyObject | string,
): { code: string; payload: LicensePayload } {
  const payload = buildLicensePayload(options);
  const key =
    typeof privateKey === 'string' ? parsePrivateKey(privateKey) : privateKey;
  return { code: signLicenseCode(payload, key), payload };
}
