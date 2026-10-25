import type { KeyObject } from 'node:crypto';
import { KNOWN_MODULE_CODES } from './license-code.js';
import {
  LicenseDocumentError,
  licenseDocumentHash,
  signArmoredLicenseArtifact,
  verifyArmoredLicenseArtifact,
  type TrustedLicenseKey,
} from './license-document.js';
import type { LicenseEntitlement, LicenseStatus } from './license.js';

/**
 * Official offline Developer License protocol (ADR-0053).
 *
 * It is deliberately domain-separated from the immutable commercial VLIC2
 * contract: a VDEV1 artifact cannot be parsed as a commercial license, carries
 * no customer identity, and is verified only with the dedicated developer
 * trust list.
 */
export const DEVELOPER_LICENSE_FILE_FORMAT = 'vardena-developer-license';
export const DEVELOPER_LICENSE_FILE_VERSION = 1;
export const DEVELOPER_LICENSE_PREFIX = 'VDEV1';
export const DEVELOPER_LICENSE_VERSION = 1;
export const DEVELOPER_LICENSE_KIND = 'DEVELOPER_LICENSE_VERSION';
export const DEVELOPER_LICENSE_TYPE = 'DEVELOPER';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CODE_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const MAX_DEVELOPER_NAME = 200;
const MAX_DATABASE_INTEGER = 2_147_483_647;

export interface DeveloperLicensePayload {
  version: 1;
  kind: typeof DEVELOPER_LICENSE_KIND;
  licenseType: typeof DEVELOPER_LICENSE_TYPE;
  operationId: string;
  licenseId: string;
  /** Explicit non-commercial holder identity; never a customer id/code. */
  developerId: string;
  developerName: string;
  /** Exactly one backend-owned installation identity. */
  installationId: string;
  status: LicenseStatus;
  validFrom: Date;
  /** Developer licenses are intentionally finite; perpetual is unsupported. */
  validUntil: Date;
  organizationLimit: number;
  userLimit: number;
  deviceLimit: number;
  moduleEntitlements: readonly string[];
  featureEntitlements: readonly string[];
  /** Explicit replacement target; null for first issuance. */
  supersedesOperationId: string | null;
  /** Signed identity of the dedicated developer authority key. */
  issuerKeyId: string;
  issuedAt: Date;
}

interface WireDeveloperLicensePayload {
  v: 1;
  kind: string;
  licenseType: string;
  operationId: string;
  licenseId: string;
  developerId: string;
  developerName: string;
  installationId: string;
  status: string;
  validFrom: string;
  validUntil: string;
  organizationLimit: number;
  userLimit: number;
  deviceLimit: number;
  modules: string[];
  features: string[];
  supersedesOperationId: string | null;
  issuerKeyId: string;
  issuedAt: string;
}

export function canonicalizeDeveloperLicense(
  payload: DeveloperLicensePayload,
): string {
  const wire: WireDeveloperLicensePayload = {
    v: DEVELOPER_LICENSE_VERSION,
    kind: DEVELOPER_LICENSE_KIND,
    licenseType: DEVELOPER_LICENSE_TYPE,
    operationId: payload.operationId,
    licenseId: payload.licenseId,
    developerId: payload.developerId,
    developerName: payload.developerName,
    installationId: payload.installationId,
    status: payload.status,
    validFrom: payload.validFrom.toISOString(),
    validUntil: payload.validUntil.toISOString(),
    organizationLimit: payload.organizationLimit,
    userLimit: payload.userLimit,
    deviceLimit: payload.deviceLimit,
    modules: [...payload.moduleEntitlements].sort(),
    features: [...payload.featureEntitlements].sort(),
    supersedesOperationId: payload.supersedesOperationId,
    issuerKeyId: payload.issuerKeyId,
    issuedAt: payload.issuedAt.toISOString(),
  };
  return JSON.stringify(wire);
}

export function signDeveloperLicenseDocument(
  payload: DeveloperLicensePayload,
  privateKey: KeyObject,
): string {
  assertDeveloperLicensePayload(payload);
  return signArmoredLicenseArtifact(
    DEVELOPER_LICENSE_PREFIX,
    canonicalizeDeveloperLicense(payload),
    privateKey,
  );
}

export function serializeDeveloperLicenseFile(
  document: string,
  keyId: string,
): string {
  return `${JSON.stringify(
    {
      format: DEVELOPER_LICENSE_FILE_FORMAT,
      fileVersion: DEVELOPER_LICENSE_FILE_VERSION,
      keyId,
      document,
    },
    null,
    2,
  )}\n`;
}

export function parseDeveloperLicenseDocument(
  document: string,
  trustedKeys: readonly TrustedLicenseKey[],
  options: { keyId?: string | null } = {},
): { payload: DeveloperLicensePayload; keyId: string } {
  const verified = verifyArmoredLicenseArtifact(
    DEVELOPER_LICENSE_PREFIX,
    document,
    trustedKeys,
    options,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(verified.body);
  } catch {
    throw new LicenseDocumentError(
      'malformed',
      'The developer license payload is not readable.',
    );
  }
  const payload = readDeveloperLicensePayload(raw);
  assertDeveloperLicensePayload(payload);
  if (payload.issuerKeyId !== verified.keyId) {
    throw new LicenseDocumentError(
      'unknown-key',
      'The developer license issuer key id does not match the trusted key that verified it.',
    );
  }
  if (canonicalizeDeveloperLicense(payload) !== verified.body) {
    throw new LicenseDocumentError(
      'payload',
      'The developer license payload is not in canonical form.',
    );
  }
  return { payload, keyId: verified.keyId };
}

export function developerLicenseDocumentHash(document: string): string {
  return licenseDocumentHash(document);
}

export function developerLicenseEntitlements(
  payload: DeveloperLicensePayload,
): LicenseEntitlement[] {
  return [
    ...payload.moduleEntitlements.map((code) => ({
      kind: 'MODULE' as const,
      code,
    })),
    ...payload.featureEntitlements.map((code) => ({
      kind: 'FEATURE' as const,
      code,
    })),
  ];
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDeveloperLicensePayload(raw: unknown): DeveloperLicensePayload {
  if (!isUnknownRecord(raw)) {
    throw new LicenseDocumentError(
      'payload',
      'The developer license payload is not an object.',
    );
  }
  const wire = raw;
  if (wire.v !== DEVELOPER_LICENSE_VERSION) {
    throw new LicenseDocumentError(
      'unsupported-version',
      `Only developer license version ${DEVELOPER_LICENSE_VERSION} is supported.`,
    );
  }
  if (
    wire.kind !== DEVELOPER_LICENSE_KIND ||
    wire.licenseType !== DEVELOPER_LICENSE_TYPE
  ) {
    throw new LicenseDocumentError(
      'payload',
      'The document is not a DEVELOPER license.',
    );
  }
  return {
    version: DEVELOPER_LICENSE_VERSION,
    kind: DEVELOPER_LICENSE_KIND,
    licenseType: DEVELOPER_LICENSE_TYPE,
    operationId: readId(wire.operationId, 'operationId'),
    licenseId: readId(wire.licenseId, 'licenseId'),
    developerId: readId(wire.developerId, 'developerId'),
    developerName: readName(wire.developerName),
    installationId: readId(wire.installationId, 'installationId'),
    status: readStatus(wire.status),
    validFrom: readDate(wire.validFrom, 'validFrom'),
    validUntil: readDate(wire.validUntil, 'validUntil'),
    organizationLimit: readPositiveLimit(
      wire.organizationLimit,
      'organizationLimit',
    ),
    userLimit: readPositiveLimit(wire.userLimit, 'userLimit'),
    deviceLimit: readNonNegativeLimit(wire.deviceLimit, 'deviceLimit'),
    moduleEntitlements: readCodes(wire.modules, 'modules'),
    featureEntitlements: readCodes(wire.features, 'features'),
    supersedesOperationId:
      wire.supersedesOperationId === null
        ? null
        : readId(wire.supersedesOperationId, 'supersedesOperationId'),
    issuerKeyId: readKeyId(wire.issuerKeyId),
    issuedAt: readDate(wire.issuedAt, 'issuedAt'),
  };
}

export function assertDeveloperLicensePayload(
  payload: DeveloperLicensePayload,
): void {
  readId(payload.operationId, 'operationId');
  readId(payload.licenseId, 'licenseId');
  readId(payload.developerId, 'developerId');
  readName(payload.developerName);
  readId(payload.installationId, 'installationId');
  readStatus(payload.status);
  readKeyId(payload.issuerKeyId);
  assertDate(payload.validFrom, 'validFrom');
  assertDate(payload.validUntil, 'validUntil');
  assertDate(payload.issuedAt, 'issuedAt');
  if (payload.supersedesOperationId !== null) {
    readId(payload.supersedesOperationId, 'supersedesOperationId');
    if (payload.supersedesOperationId === payload.operationId) {
      throw new LicenseDocumentError(
        'payload',
        'A developer license cannot supersede itself.',
      );
    }
  }
  if (payload.validUntil.getTime() <= payload.validFrom.getTime()) {
    throw new LicenseDocumentError(
      'validity',
      'The developer license validUntil must be later than validFrom.',
    );
  }
  readPositiveLimit(payload.organizationLimit, 'organizationLimit');
  readPositiveLimit(payload.userLimit, 'userLimit');
  readNonNegativeLimit(payload.deviceLimit, 'deviceLimit');
  // VDEA1 device enrollment is a commercial-customer protocol. Developer
  // Licenses therefore fail closed for device enrollment instead of inventing
  // a customer identity; a future domain-separated device protocol can add a
  // positive quota explicitly.
  if (payload.deviceLimit !== 0) {
    throw new LicenseDocumentError(
      'limits',
      'Developer License deviceLimit must be 0 in VDEV1.',
    );
  }
  const modules = new Set(payload.moduleEntitlements);
  if (
    modules.size === 0 ||
    modules.size !== payload.moduleEntitlements.length
  ) {
    throw new LicenseDocumentError(
      'entitlements',
      'The developer license must contain distinct module entitlements.',
    );
  }
  for (const code of modules) {
    if (!KNOWN_MODULE_CODES.includes(code)) {
      throw new LicenseDocumentError(
        'entitlements',
        `The developer license names an unknown module entitlement "${code}".`,
      );
    }
  }
  const features = new Set(payload.featureEntitlements);
  if (features.size !== payload.featureEntitlements.length) {
    throw new LicenseDocumentError(
      'entitlements',
      'The developer license repeats a feature entitlement.',
    );
  }
  for (const code of features) {
    if (!CODE_PATTERN.test(code)) {
      throw new LicenseDocumentError(
        'entitlements',
        `The developer license names a malformed feature entitlement "${code}".`,
      );
    }
  }
}

function readId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new LicenseDocumentError(
      'payload',
      `The developer license ${field} is missing or malformed.`,
    );
  }
  return value;
}

function readKeyId(value: unknown): string {
  if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value)) {
    throw new LicenseDocumentError(
      'payload',
      'The developer license issuerKeyId is missing or malformed.',
    );
  }
  return value;
}

function readName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_DEVELOPER_NAME
  ) {
    throw new LicenseDocumentError(
      'payload',
      'The developerName is missing or malformed.',
    );
  }
  return value;
}

function readStatus(value: unknown): LicenseStatus {
  if (value !== 'ACTIVE' && value !== 'EXPIRED' && value !== 'SUSPENDED') {
    throw new LicenseDocumentError(
      'payload',
      'The developer license status is unknown.',
    );
  }
  return value;
}

function readDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new LicenseDocumentError(
      'payload',
      `The developer license ${field} is missing.`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LicenseDocumentError(
      'payload',
      `The developer license ${field} must be a canonical ISO-8601 UTC instant.`,
    );
  }
  return parsed;
}

function assertDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new LicenseDocumentError(
      'payload',
      `The developer license ${field} must be a valid date.`,
    );
  }
}

function readPositiveLimit(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_DATABASE_INTEGER
  ) {
    throw new LicenseDocumentError(
      'limits',
      `The developer license ${field} must be a positive 32-bit integer.`,
    );
  }
  return value;
}

function readNonNegativeLimit(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_DATABASE_INTEGER
  ) {
    throw new LicenseDocumentError(
      'limits',
      `The developer license ${field} must be a non-negative 32-bit integer.`,
    );
  }
  return value;
}

function readCodes(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new LicenseDocumentError(
      'entitlements',
      `The developer license ${field} must be an array.`,
    );
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new LicenseDocumentError(
        'entitlements',
        `The developer license ${field} must contain only string codes.`,
      );
    }
    return entry;
  });
}
