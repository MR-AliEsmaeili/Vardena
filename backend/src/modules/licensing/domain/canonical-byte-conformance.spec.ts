import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalizeLicenseVersion } from './license-document.js';
import type { LicenseVersionPayload } from './license-document.js';
import { canonicalizeLicenseCodePayload } from './license-code.js';
import type { LicensePayload } from './license-code.js';
import {
  canonicalizeEnrollmentChallenge,
  canonicalizeDeviceReplacementChallenge,
  canonicalizeDeviceReplacementResponse,
} from './client-device.js';

const VECTORS_ROOT = join(process.cwd(), '..', 'docs', 'licensing', 'vectors');

function loadCanonical(): any[] {
  const dir = join(VECTORS_ROOT, 'canonical');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

function adaptVlic2(input: any): LicenseVersionPayload {
  return {
    version: 2,
    kind: 'SERVER_LICENSE_VERSION',
    operationId: input.operationId,
    licenseId: input.licenseId,
    customerId: input.customerId,
    customerCode: input.customerCode,
    customerName: input.customerName,
    installationId: input.installationId,
    status: input.status,
    validFrom: new Date(input.validFrom),
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
    organizationLimit: input.organizationLimit,
    userLimit: input.userLimit,
    deviceLimit: input.deviceLimitSpecified
      ? (input.deviceLimit ?? null)
      : null,
    deviceLimitSpecified: !!input.deviceLimitSpecified,
    moduleEntitlements: input.modules ?? [],
    featureEntitlements: input.features ?? [],
    supersedesOperationId: input.supersedesOperationId ?? null,
    issuedAt: new Date(input.issuedAt),
  };
}

function adaptVlic1(input: any): LicensePayload {
  return {
    version: 1,
    licenseId: input.licenseId,
    customerId: input.customerId,
    customerCode: input.customerCode,
    customerName: input.customerName,
    installationId: input.installationId,
    status: input.status,
    validFrom: new Date(input.validFrom),
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
    organizationLimit: input.organizationLimit,
    userLimit: input.userLimit,
    deviceLimit: null,
    deviceLimitSpecified: false,
    moduleEntitlements: input.modules ?? [],
    featureEntitlements: input.features ?? [],
  };
}

describe('canonical byte conformance (exact bytes from vectors)', () => {
  const vecs = loadCanonical();

  it('has canonical vectors', () => {
    expect(vecs.length).toBeGreaterThan(0);
  });

  for (const v of vecs) {
    if (v.protocolVersion === 'VLIC2') {
      it(`VLIC2 ${v.id}: exact canonical bytes`, () => {
        const out = canonicalizeLicenseVersion(adaptVlic2(v.input));
        expect(out).toBe(v.expectedCanonicalUtf8);
        expect(Buffer.from(out, 'utf8').toString('hex')).toBe(
          v.expectedCanonicalUtf8Hex,
        );
      });
    } else if (v.protocolVersion === 'VLIC1') {
      it(`VLIC1 ${v.id}: exact canonical bytes`, () => {
        const out = canonicalizeLicenseCodePayload(adaptVlic1(v.input));
        expect(out).toBe(v.expectedCanonicalUtf8);
        expect(Buffer.from(out, 'utf8').toString('hex')).toBe(
          v.expectedCanonicalUtf8Hex,
        );
      });
    } else if (v.protocolVersion === 'VDEA1') {
      it(`VDEA1 ${v.id}: exact canonical bytes`, () => {
        const out = canonicalizeEnrollmentChallenge(v.input);
        expect(out).toBe(v.expectedCanonicalUtf8);
        expect(Buffer.from(out, 'utf8').toString('hex')).toBe(
          v.expectedCanonicalUtf8Hex,
        );
      });
    } else if (v.protocolVersion === 'VDRQ1') {
      it(`VDRQ1 ${v.id}: exact canonical bytes`, () => {
        const out = canonicalizeDeviceReplacementChallenge(v.input);
        expect(out).toBe(v.expectedCanonicalUtf8);
        expect(Buffer.from(out, 'utf8').toString('hex')).toBe(
          v.expectedCanonicalUtf8Hex,
        );
      });
    } else if (v.protocolVersion === 'VDRP1') {
      it(`VDRP1 ${v.id}: exact canonical bytes`, () => {
        const out = canonicalizeDeviceReplacementResponse(v.input);
        expect(out).toBe(v.expectedCanonicalUtf8);
        expect(Buffer.from(out, 'utf8').toString('hex')).toBe(
          v.expectedCanonicalUtf8Hex,
        );
      });
    }
  }
});
