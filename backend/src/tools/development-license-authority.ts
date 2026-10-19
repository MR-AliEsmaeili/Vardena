import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { generateId } from '../kernel/ids/ulid.js';
import {
  assertValidCustomerCode,
  assertValidCustomerId,
  assertValidCustomerName,
  LicenseCustomerError,
} from '../modules/licensing/domain/customer.js';
import {
  LicenseCodeError,
  parsePrivateKey,
  signLicenseCode,
  type LicensePayload,
} from '../modules/licensing/domain/license-code.js';
import {
  LICENSE_DOCUMENT_KIND,
  LicenseDocumentError,
  serializeLicenseFile,
  signLicenseDocument,
  type LicenseVersionPayload,
} from '../modules/licensing/domain/license-document.js';

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
 *
 * L-03 (ADR-0046): issuance produces the signed **document** — the `VLIC2`
 * artifact, optionally wrapped in the `vardena-license` file envelope — which
 * is the primary exchange form. The legacy `VLIC1` text code remains issuable
 * for compatibility. Nothing here runs inside the application: it is invoked
 * from the operator's machine, and it refuses `NODE_ENV=production`.
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

export interface IssueLicenseCustomerTarget {
  customerId: string;
  customerCode: string;
  displayName?: string;
}

export interface IssueLicenseOptions {
  installationId: string;
  /**
   * Explicit persisted customer record for which the license is issued, or
   * supply `customerId` and `customerCode` directly. Both `customerId` and
   * `customerCode` are required; issuance never auto-generates `customerId` or
   * `customerCode`, never derives `customerCode` from `customerName`, and
   * never defaults `customerCode` to `customerId` (PDR-14 / L-06).
   */
  customer?: IssueLicenseCustomerTarget;
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  licenseId?: string;
  status?: LicensePayload['status'];
  validFrom?: Date;
  validUntil?: Date | null;
  organizationLimit?: number | null;
  userLimit?: number | null;
  /** Signed device capacity for new VLIC2 documents; VLIC1 cannot express it. */
  deviceLimit?: number | null;
  moduleEntitlements?: readonly string[];
  featureEntitlements?: readonly string[];
}

function resolveIssuedCustomer(options: IssueLicenseOptions): {
  customerId: string;
  customerCode: string;
  customerName: string;
} {
  if (options.customer !== undefined) {
    if (typeof options.customer !== 'object' || options.customer === null) {
      throw new LicenseCustomerError(
        'customer-id',
        'customer record must be an object with customerId and customerCode.',
      );
    }
    const targetId = assertValidCustomerId(options.customer.customerId);
    const targetCode = assertValidCustomerCode(
      options.customer.customerCode,
      targetId,
    );
    if (options.customerId !== undefined && options.customerId !== targetId) {
      throw new LicenseCustomerError(
        'customer-code-mismatch',
        'The requested customerId does not match the customer record.',
      );
    }
    if (
      options.customerCode !== undefined &&
      options.customerCode !== targetCode
    ) {
      throw new LicenseCustomerError(
        'customer-code-mismatch',
        'The requested customerCode does not match the customer record.',
      );
    }
    const customerName = assertValidCustomerName(
      options.customerName ??
        options.customer.displayName ??
        'Development customer',
    );
    return {
      customerId: targetId,
      customerCode: targetCode,
      customerName,
    };
  }
  const customerId = assertValidCustomerId(options.customerId);
  const customerCode = assertValidCustomerCode(
    options.customerCode,
    customerId,
  );
  const customerName = assertValidCustomerName(
    options.customerName ?? 'Development customer',
  );
  return { customerId, customerCode, customerName };
}

export function buildLicensePayload(
  options: IssueLicenseOptions,
): LicensePayload {
  let customer: {
    customerId: string;
    customerCode: string;
    customerName: string;
  };
  try {
    customer = resolveIssuedCustomer(options);
  } catch (error) {
    if (error instanceof LicenseCustomerError) {
      throw new LicenseCodeError('payload', error.message);
    }
    throw error;
  }
  return {
    version: 1,
    licenseId: options.licenseId ?? generateId(),
    customerId: customer.customerId,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    installationId: options.installationId,
    status: options.status ?? 'ACTIVE',
    validFrom: options.validFrom ?? new Date('2020-01-01T00:00:00.000Z'),
    validUntil: options.validUntil ?? null,
    organizationLimit: options.organizationLimit ?? null,
    userLimit: options.userLimit ?? null,
    deviceLimit: null,
    deviceLimitSpecified: false,
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

export interface IssueLicenseVersionOptions extends IssueLicenseOptions {
  /** Stable operation identity; generated when omitted. */
  operationId?: string;
  /** Operation id of the retained version this document retires. */
  supersedesOperationId?: string | null;
  /**
   * Operation id of the retained version this document RENEWS (OD-LIC-06).
   * A renewal extends the named version's term: it starts governing at that
   * version's effective end, never at its own `validFrom`. Mutually exclusive
   * with `supersedesOperationId`; the payload validator (shared by signing and
   * verification) refuses the combination before anything is signed.
   */
  renewsOperationId?: string | null;
  issuedAt?: Date;
}

/**
 * Build the v2 (signed document) payload. Semantics are identical to the v1
 * payload — the additional fields are the operation identity, the explicit
 * supersession and the issuance instant, which is exactly what the version
 * model needs and the legacy code could not express.
 */
export function buildLicenseVersionPayload(
  options: IssueLicenseVersionOptions,
): LicenseVersionPayload {
  let legacy: LicensePayload;
  try {
    legacy = buildLicensePayload(options);
  } catch (error) {
    if (error instanceof LicenseCodeError) {
      throw new LicenseDocumentError(error.reason, error.message);
    }
    throw error;
  }
  return {
    version: 2,
    kind: LICENSE_DOCUMENT_KIND,
    operationId: options.operationId ?? generateId(),
    licenseId: legacy.licenseId,
    customerId: legacy.customerId,
    customerCode: legacy.customerCode,
    customerName: legacy.customerName,
    installationId: legacy.installationId,
    status: legacy.status,
    validFrom: legacy.validFrom,
    validUntil: legacy.validUntil,
    organizationLimit: legacy.organizationLimit,
    userLimit: legacy.userLimit,
    // Omission is UNSPECIFIED, never an inferred unlimited commercial grant.
    // `--devices unlimited` explicitly supplies null and is signed as unlimited.
    deviceLimit: options.deviceLimit ?? null,
    deviceLimitSpecified: options.deviceLimit !== undefined,
    moduleEntitlements: legacy.moduleEntitlements,
    featureEntitlements: legacy.featureEntitlements,
    supersedesOperationId: options.supersedesOperationId ?? null,
    renewsOperationId: options.renewsOperationId ?? null,
    issuedAt: options.issuedAt ?? new Date(),
  };
}

/** Issue the signed `VLIC2` artifact for exactly one installation. */
export function issueLicenseDocument(
  options: IssueLicenseVersionOptions,
  privateKey: KeyObject | string,
): { document: string; payload: LicenseVersionPayload } {
  const payload = buildLicenseVersionPayload(options);
  const key =
    typeof privateKey === 'string' ? parsePrivateKey(privateKey) : privateKey;
  return { document: signLicenseDocument(payload, key), payload };
}

/** Issue the signed document and wrap it in the file envelope. */
export function issueLicenseFile(
  options: IssueLicenseVersionOptions,
  privateKey: KeyObject | string,
  file: { keyId?: string } = {},
): { file: string; document: string; payload: LicenseVersionPayload } {
  const { document, payload } = issueLicenseDocument(options, privateKey);
  return {
    file: serializeLicenseFile(document, file.keyId),
    document,
    payload,
  };
}

/** Issue a signed license code for exactly one installation. */
export function issueLicenseCode(
  options: IssueLicenseOptions,
  privateKey: KeyObject | string,
): { code: string; payload: LicensePayload } {
  if (options.deviceLimit !== undefined) {
    throw new LicenseCodeError(
      'limits',
      'VLIC1 cannot carry a deviceLimit; issue a signed VLIC2 document instead.',
    );
  }
  const payload = buildLicensePayload(options);
  const key =
    typeof privateKey === 'string' ? parsePrivateKey(privateKey) : privateKey;
  return { code: signLicenseCode(payload, key), payload };
}
