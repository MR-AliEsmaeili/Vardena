import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto';
import type { AppConfig } from '../../../kernel/config/app-config.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import {
  generateAuthorityKeyPair,
  issueLicenseFile,
} from '../../../tools/development-license-authority.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import {
  createLicensingStores,
  type LicensingStores,
} from '../../../../test/support/licensing-repositories.js';
import {
  canonicalizeRevocation,
  type RevocationPayload,
} from '../domain/license-revocation.js';
import { REVOCATION_FUTURE_TOLERANCE_MS } from './license-revocation.service.js';
import { LicenseImportService } from './license-import.service.js';
import {
  LicenseRevocationService,
  type LicenseRevocationImportResult,
} from './license-revocation.service.js';
import type { LicenseUsagePort } from './license-usage.js';
import { InstallationIdentityService } from './installation-identity.service.js';
import { LicensingService } from './licensing.service.js';
import { PersistentLicenseProvider } from './persistent-license.provider.js';

/**
 * The revocation import (`OD-LIC-17`, protocol
 * `docs/licensing/revocation-artifact-protocol.md` §4–§6).
 *
 * The harness is the SAME one the license-import suite uses: real services over
 * the in-memory stores that model the database guarantees. The artifact is
 * signed here with an independently generated Ed25519 authority key, so the
 * signature path is real; only authorization and the logger are stubs.
 */

const INSTALLATION = '01K7INSTALLATION0000000000';
const OTHER_INSTALLATION = '01K7OTHERINSTALLATION0000';
const AUTHORITY = generateAuthorityKeyPair();
const STRANGER = generateAuthorityKeyPair();
const CUSTOMER = '01K7CUSTOMER000000000000000';
const CUSTOMER_CODE = 'CUST-ACME-01';
const LICENSE = '01K7LICENSE0000000000000000';
const REVOCATION = '01K7REVOCATION000000000000';
const ISSUED_AT = new Date('2026-10-01T00:00:00.000Z');
const NOW = new Date('2026-10-20T09:00:00.000Z');

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as JsonLogger;
}

function authorizationStub(allowed = true): AuthorizationService {
  return {
    requireAllPermissions: async (): Promise<void> => {
      if (!allowed) throw AppException.forbidden();
    },
  } as unknown as AuthorizationService;
}

function configStub(keys: string[]): AppConfig {
  return {
    licensing: { provider: 'persistent', signingPublicKeys: keys },
  } as unknown as AppConfig;
}

function usageStub(): LicenseUsagePort {
  return {
    snapshot: async () => ({
      organizationCount: 0,
      activeUserCount: 0,
      registeredDeviceCount: 0,
    }),
  };
}

interface Harness {
  stores: LicensingStores;
  revocations: LicenseRevocationService;
  imports: LicenseImportService;
  licensing: LicensingService;
}

function buildHarness(options: { allowed?: boolean } = {}): Harness {
  const stores = createLicensingStores({
    installation: {
      installationId: INSTALLATION,
      name: 'Vardena',
      customerId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const identity = new InstallationIdentityService(
    stores.installations,
    loggerStub(),
  );
  const provider = new PersistentLicenseProvider(
    identity,
    stores.licenses,
    loggerStub(),
  );
  const licensing = new LicensingService(provider);
  const config = configStub([AUTHORITY.publicKey]);
  const imports = new LicenseImportService(
    config,
    authorizationStub(),
    identity,
    stores.licenses,
    licensing,
    usageStub(),
    loggerStub(),
  );
  const revocations = new LicenseRevocationService(
    config,
    authorizationStub(options.allowed ?? true),
    identity,
    stores.licenses,
    loggerStub(),
  );
  return { stores, revocations, imports, licensing };
}

/** Import the installation's baseline license and return its operation id. */
async function seedLicense(
  harness: Harness,
  overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
): Promise<{ operationId: string; issuedAt: Date }> {
  const issued = issueLicenseFile(
    {
      installationId: INSTALLATION,
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      customerName: 'Acme Holding',
      licenseId: LICENSE,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2027-01-01T00:00:00.000Z'),
      issuedAt: ISSUED_AT,
      ...overrides,
    },
    AUTHORITY.privateKey,
  );
  await harness.imports.importDocument(issued.file);
  return { operationId: issued.payload.operationId, issuedAt: ISSUED_AT };
}

function revocationPayload(
  operationId: string,
  overrides: Partial<RevocationPayload> = {},
): RevocationPayload {
  return {
    v: 1,
    kind: 'SERVER_LICENSE_REVOCATION',
    revocationId: REVOCATION,
    licenseId: LICENSE,
    targetOperationId: operationId,
    customerId: CUSTOMER,
    customerCode: CUSTOMER_CODE,
    installationId: INSTALLATION,
    effect: 'LICENSE_ONLY',
    reason: 'CONTRACT_TERMINATION',
    reasonDetail: 'Contract 2026-114 ended.',
    issuerKeyId: keyIdOf(AUTHORITY.publicKey),
    issuedAt: new Date('2026-10-15T00:00:00.000Z'),
    ...overrides,
  };
}

function keyIdOf(publicKeyBase64: string): string {
  const der = createPublicKey({
    key: Buffer.from(publicKeyBase64, 'base64'),
    format: 'der',
    type: 'spki',
  }).export({ format: 'der', type: 'spki' });
  return `sha256-${createHash('sha256').update(der).digest('hex').slice(0, 16)}`;
}

/** The suite's authority private key as a signing `KeyObject`. */
function privateKeyOf(base64Pkcs8: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(base64Pkcs8, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Sign exactly the canonical payload bytes and armor them as `VREV1`. */
function signRevocation(
  payload: RevocationPayload,
  privateKey: KeyObject = privateKeyOf(AUTHORITY.privateKey),
): string {
  const body = Buffer.from(canonicalizeRevocation(payload), 'utf8');
  return [
    'VREV1',
    body.toString('base64url'),
    cryptoSign(null, body, privateKey).toString('base64url'),
  ].join('.');
}

function fileEnvelope(artifact: string, keyId?: string): string {
  return JSON.stringify({
    format: 'vardena-revocation',
    fileVersion: 1,
    revocation: artifact,
    ...(keyId === undefined ? {} : { keyId }),
  });
}

const OPERATOR = '01K7OPERATOR00000000000000';

/** Run one test body as an authenticated operator (audit attribution). */
function asOperator<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    {
      correlationId: 'test-correlation',
      principal: { userId: OPERATOR, sessionId: '01K7SESSION000000000000000' },
    },
    fn,
  );
}

async function rejectionOf(run: Promise<unknown>): Promise<{
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}> {
  try {
    await run;
    throw new Error('expected the revocation to be rejected');
  } catch (error) {
    if (error instanceof AppException) {
      return {
        status: error.getStatus(),
        code: error.code,
        message: error.message,
        details: error.details as Record<string, unknown>,
      };
    }
    throw error;
  }
}

/**
 * Every test runs inside a real request context as an authenticated operator:
 * audit attribution and the rejection path both read the ambient principal.
 */
const itOperator = (name: string, fn: () => Promise<void>): void => {
  it(name, () => asOperator(fn));
};

describe('signed revocation import (OD-LIC-17)', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    harness = buildHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  itOperator(
    'revokes exactly the targeted license and records the typed audit event',
    async () => {
      const { operationId } = await seedLicense(harness);
      const payload = revocationPayload(operationId);
      const before = structuredClone(harness.stores.versions);

      const result: LicenseRevocationImportResult =
        await harness.revocations.importRevocation(
          fileEnvelope(signRevocation(payload), keyIdOf(AUTHORITY.publicKey)),
        );

      expect(result).toMatchObject({
        changed: true,
        outcome: 'APPLIED',
        alreadyApplied: false,
        revocation: {
          revocationId: REVOCATION,
          licenseId: LICENSE,
          installationId: INSTALLATION,
          customerId: CUSTOMER,
          customerCode: CUSTOMER_CODE,
          targetOperationId: operationId,
          reason: 'CONTRACT_TERMINATION',
          reasonDetail: 'Contract 2026-114 ended.',
          issuerKeyId: keyIdOf(AUTHORITY.publicKey),
          issuedAt: '2026-10-15T00:00:00.000Z',
          importedAt: NOW.toISOString(),
          importedBy: OPERATOR,
        },
      });
      expect(harness.stores.revocations).toHaveLength(1);
      expect(harness.stores.revoked.get(LICENSE)).toEqual({
        revokedAt: NOW,
        revocationId: REVOCATION,
      });

      // The retained signed history is NOT rewritten (ADR-0046 Decision 2).
      expect(harness.stores.versions).toHaveLength(before.length);
      expect(
        harness.stores.versions.map((version) => ({
          operationId: version.operationId,
          documentHash: version.documentHash,
          supersededAt: version.supersededAt,
          validFrom: version.validFrom.toISOString(),
        })),
      ).toEqual(
        before.map((version) => ({
          operationId: version.operationId,
          documentHash: version.documentHash,
          supersededAt: version.supersededAt,
          validFrom: version.validFrom.toISOString(),
        })),
      );

      const applied = harness.stores.auditEvents.filter(
        (event) => event.eventType === 'license.revocation.imported',
      );
      expect(applied).toHaveLength(1);
      expect(applied[0]).toMatchObject({
        outcome: 'APPLIED',
        licenseId: LICENSE,
        operationId,
        reason: 'CONTRACT_TERMINATION',
        revocationId: REVOCATION,
        documentHash: result.revocation.artifactSha256,
      });

      // The read model now reports revocation — never expiry, never Grace.
      const state = await harness.licensing.currentState();
      expect(state.license).toMatchObject({
        licensed: true,
        active: false,
        inactiveReason: 'revoked',
        accessMode: 'BLOCKED',
        graceEndsAt: null,
        revokedAt: NOW,
      });
    },
  );

  itOperator(
    'returns the historical first result for a byte-identical duplicate',
    async () => {
      const { operationId } = await seedLicense(harness);
      const artifact = signRevocation(revocationPayload(operationId));
      const first = await harness.revocations.importRevocation(artifact);
      const auditAfterFirst = harness.stores.auditEvents.length;

      const second = await harness.revocations.importRevocation(artifact);

      expect(second).toMatchObject({
        changed: false,
        outcome: 'UNCHANGED',
        alreadyApplied: true,
      });
      expect(second.revocation).toEqual(first.revocation);
      expect(harness.stores.revocations).toHaveLength(1);
      expect(harness.stores.auditEvents).toHaveLength(auditAfterFirst);
    },
  );

  itOperator(
    'refuses the same revocation identity with different signed bytes',
    async () => {
      const { operationId } = await seedLicense(harness);
      await harness.revocations.importRevocation(
        signRevocation(revocationPayload(operationId)),
      );
      // Different bytes, same revocationId: a second, VALIDLY signed artifact.
      const other = signRevocation(
        revocationPayload(operationId, {
          reason: 'FRAUD',
          reasonDetail: 'Chargeback confirmed.',
        }),
      );

      const rejection = await rejectionOf(
        harness.revocations.importRevocation(other),
      );
      expect(rejection.status).toBe(409);
      expect(rejection.details).toEqual({ reason: 'conflicting-replay' });
      expect(harness.stores.revocations).toHaveLength(1);
      expect(harness.stores.revocations[0]?.reason).toBe(
        'CONTRACT_TERMINATION',
      );
    },
  );

  itOperator(
    'refuses a second revocation for an already-revoked license and keeps the original',
    async () => {
      const { operationId } = await seedLicense(harness);
      await harness.revocations.importRevocation(
        signRevocation(revocationPayload(operationId)),
      );
      const later = signRevocation(
        revocationPayload(operationId, {
          revocationId: '01K7REVOCATION000000000001',
        }),
      );

      const rejection = await rejectionOf(
        harness.revocations.importRevocation(later),
      );
      expect(rejection.status).toBe(409);
      expect(rejection.details).toEqual({
        reason: 'already-revoked',
        revocationId: REVOCATION,
      });
      expect(harness.stores.revocations).toHaveLength(1);
    },
  );

  itOperator(
    'refuses another installation, another customer and an unknown target',
    async () => {
      const { operationId } = await seedLicense(harness);

      const wrongInstallation = await rejectionOf(
        harness.revocations.importRevocation(
          signRevocation(
            revocationPayload(operationId, {
              installationId: OTHER_INSTALLATION,
              revocationId: '01K7REVOCATION000000000010',
            }),
          ),
        ),
      );
      expect(wrongInstallation.status).toBe(422);
      expect(wrongInstallation.details).toEqual({
        reason: 'wrong-installation',
      });

      const wrongCustomer = await rejectionOf(
        harness.revocations.importRevocation(
          signRevocation(
            revocationPayload(operationId, {
              customerCode: 'CUST-SOMEONE-ELSE',
              revocationId: '01K7REVOCATION000000000011',
            }),
          ),
        ),
      );
      expect(wrongCustomer.details).toEqual({ reason: 'wrong-customer' });

      const unknownLicense = await rejectionOf(
        harness.revocations.importRevocation(
          signRevocation(
            revocationPayload(operationId, {
              licenseId: '01K7UNKNOWNLICENSE000000000',
              revocationId: '01K7REVOCATION000000000012',
            }),
          ),
        ),
      );
      expect(unknownLicense.details).toEqual({ reason: 'unknown-target' });

      const unknownVersion = await rejectionOf(
        harness.revocations.importRevocation(
          signRevocation(
            revocationPayload('01K7UNKNOWNOPERATION0000000', {
              revocationId: '01K7REVOCATION000000000013',
            }),
          ),
        ),
      );
      expect(unknownVersion.details).toEqual({ reason: 'unknown-target' });

      // Nothing was written by any of the four refusals.
      expect(harness.stores.revocations).toHaveLength(0);
      expect(harness.stores.revoked.size).toBe(0);
    },
  );

  itOperator(
    'refuses a future-dated artifact beyond the transport tolerance',
    async () => {
      const { operationId } = await seedLicense(harness);
      const rejection = await rejectionOf(
        harness.revocations.importRevocation(
          signRevocation(
            revocationPayload(operationId, {
              issuedAt: new Date(
                NOW.getTime() + REVOCATION_FUTURE_TOLERANCE_MS + 1000,
              ),
            }),
          ),
        ),
      );
      expect(rejection.status).toBe(422);
      expect(rejection.details).toEqual({ reason: 'future-dated' });
      expect(harness.stores.revocations).toHaveLength(0);
    },
  );

  itOperator(
    'refuses an artifact issued before the version it targets',
    async () => {
      const { operationId } = await seedLicense(harness, {
        issuedAt: new Date('2026-10-10T00:00:00.000Z'),
      });
      const rejection = await rejectionOf(
        harness.revocations.importRevocation(
          signRevocation(
            revocationPayload(operationId, {
              issuedAt: new Date('2026-10-05T00:00:00.000Z'),
            }),
          ),
        ),
      );
      expect(rejection.status).toBe(422);
      expect(rejection.details).toEqual({ reason: 'stale-revocation' });
      expect(harness.stores.revocations).toHaveLength(0);
    },
  );

  itOperator(
    'refuses an untrusted signature, bad transport and non-canonical bytes',
    async () => {
      const { operationId } = await seedLicense(harness);
      const strangerKeyId = keyIdOf(STRANGER.publicKey);

      const untrusted = await rejectionOf(
        harness.revocations.importRevocation(
          signRevocation(
            revocationPayload(operationId, { issuerKeyId: strangerKeyId }),
            privateKeyOf(STRANGER.privateKey),
          ),
        ),
      );
      expect(untrusted.status).toBe(422);
      expect(untrusted.details).toEqual({ reason: 'signature' });

      const malformed = await rejectionOf(
        harness.revocations.importRevocation('not-a-document'),
      );
      expect(malformed.details).toEqual({ reason: 'malformed' });

      const wrongFormat = await rejectionOf(
        harness.revocations.importRevocation(
          JSON.stringify({
            format: 'vardena-license',
            fileVersion: 1,
            document: 'VLIC2.abc.def',
          }),
        ),
      );
      expect(wrongFormat.details).toEqual({ reason: 'malformed' });

      // Signed but not canonical: the parser refuses, so nothing is applied.
      const prettyBody = Buffer.from(
        JSON.stringify(revocationPayload(operationId), null, 2),
        'utf8',
      );
      const nonCanonical = [
        'VREV1',
        prettyBody.toString('base64url'),
        cryptoSign(
          null,
          prettyBody,
          privateKeyOf(AUTHORITY.privateKey),
        ).toString('base64url'),
      ].join('.');
      const notCanonical = await rejectionOf(
        harness.revocations.importRevocation(nonCanonical),
      );
      expect(notCanonical.details).toEqual({ reason: 'canonical' });

      expect(harness.stores.revocations).toHaveLength(0);
      const rejected = harness.stores.auditEvents.filter(
        (event) => event.eventType === 'license.revocation.rejected',
      );
      // Four refusals, each attributed to this installation with its reason.
      expect(rejected.map((event) => event.reason)).toEqual([
        'signature',
        'malformed',
        'malformed',
        'canonical',
      ]);
    },
  );

  itOperator(
    'checks authorization before reading the artifact and writes nothing when denied',
    async () => {
      const denied = buildHarness({ allowed: false });
      const rejection = await rejectionOf(
        denied.revocations.importRevocation('VREV1.anything.anything'),
      );
      expect(rejection.status).toBe(403);
      expect(denied.stores.auditEvents).toHaveLength(0);
      expect(denied.stores.revocations).toHaveLength(0);
    },
  );

  itOperator(
    'refuses every license artifact for a revoked license, including a renewal',
    async () => {
      const { operationId } = await seedLicense(harness);
      await harness.revocations.importRevocation(
        signRevocation(revocationPayload(operationId)),
      );

      // A renewal issued AFTER the revocation must not resurrect the license.
      const renewal = issueLicenseFile(
        {
          installationId: INSTALLATION,
          customerId: CUSTOMER,
          customerCode: CUSTOMER_CODE,
          customerName: 'Acme Holding',
          licenseId: LICENSE,
          // The signed start of a renewal is the issuance-day fact; the renewal
          // governs from the renewed version's end (OD-LIC-06 §3.2).
          validFrom: new Date('2026-10-16T00:00:00.000Z'),
          validUntil: new Date('2028-01-01T00:00:00.000Z'),
          renewsOperationId: operationId,
          issuedAt: new Date('2026-10-16T00:00:00.000Z'),
        },
        AUTHORITY.privateKey,
      );

      const rejection = await rejectionOf(
        harness.imports.importDocument(renewal.file),
      );
      expect(rejection.status).toBe(409);
      expect(rejection.details).toEqual({ reason: 'license-revoked' });
      expect(harness.stores.versions).toHaveLength(1);
    },
  );

  itOperator(
    'never reports a revoked license as expired or in Grace',
    async () => {
      // Issue while the term is still live, then evaluate after it ended.
      vi.setSystemTime(new Date('2026-10-17T00:00:00.000Z'));
      const { operationId } = await seedLicense(harness, {
        validUntil: new Date('2026-10-18T00:00:00.000Z'),
      });
      vi.setSystemTime(NOW);
      // Evaluate after the signed end but inside the Grace window.
      const beforeRevocation = await harness.licensing.current(
        new Date('2026-10-20T00:00:00.000Z'),
      );
      expect(beforeRevocation.inactiveReason).toBe('expired');
      expect(beforeRevocation.accessMode).toBe('GRACE');
      expect(beforeRevocation.graceEndsAt).not.toBeNull();

      await harness.revocations.importRevocation(
        signRevocation(
          revocationPayload(operationId, {
            issuedAt: new Date('2026-10-19T00:00:00.000Z'),
          }),
        ),
      );
      const afterRevocation = await harness.licensing.current(
        new Date('2026-10-20T00:00:00.000Z'),
      );
      expect(afterRevocation.inactiveReason).toBe('revoked');
      expect(afterRevocation.accessMode).toBe('BLOCKED');
      expect(afterRevocation.graceEndsAt).toBeNull();
    },
  );
});
