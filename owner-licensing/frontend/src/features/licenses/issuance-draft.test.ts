import { describe, expect, it } from 'vitest';
import { o } from '@/lib/owner-i18n';
import { emptyDraft, toPrepareInput, validateDraft } from './issuance-draft';

const customerId = '01K76ZC2C29NQRB7R7R3GZAGZZ';
const installationIdentityId = '01K7D0T5SET4HY654W9HREVCFT';
const signingKeyId = 'sha256-e6fc4307e011fd04';
const operationId = '01K76A539QMJGYGPW7HNW9BKWS';

function draft(overrides: Partial<ReturnType<typeof emptyDraft>> = {}) {
  return {
    ...emptyDraft(),
    customerId,
    installationIdentityId,
    signingKeyId,
    modules: ['accounting'],
    validUntil: '2027-10-20',
    ...overrides,
  };
}

describe('issuance draft validation', () => {
  it('accepts a complete time-limited draft', () => {
    expect(validateDraft(draft())).toBeNull();
  });

  it('refuses a missing customer, installation or key before any request', () => {
    expect(validateDraft(draft({ customerId: '' }))).toBe(
      o.licenses.errorCustomer,
    );
    expect(validateDraft(draft({ installationIdentityId: 'x' }))).toBe(
      o.licenses.errorInstallation,
    );
    expect(validateDraft(draft({ signingKeyId: '' }))).toBe(
      o.licenses.errorKey,
    );
  });

  it('requires at least one module and a future end date', () => {
    expect(validateDraft(draft({ modules: [] }))).toBe(o.licenses.errorModules);
    expect(validateDraft(draft({ validUntil: '' }))).toBe(
      o.licenses.errorEndDate,
    );
    expect(validateDraft(draft({ validUntil: '2021-01-01' }))).toBe(
      o.licenses.errorEndFuture,
    );
  });

  it('refuses non-positive ceilings and a negative device limit', () => {
    expect(validateDraft(draft({ organizationLimit: '0' }))).toContain(
      o.licenses.organizationLimit,
    );
    expect(validateDraft(draft({ userLimit: '2.5' }))).toContain(
      o.licenses.userLimit,
    );
    expect(
      validateDraft(draft({ deviceLimitSpecified: true, deviceLimit: '-1' })),
    ).toBe(o.licenses.errorDevice);
  });

  it('requires a ULID target when a lineage is selected', () => {
    expect(validateDraft(draft({ lineage: 'renew' }))).toBe(
      o.licenses.lineageNoTargets,
    );
    expect(
      validateDraft(
        draft({ lineage: 'renew', lineageOperationId: operationId }),
      ),
    ).toBeNull();
  });
});

describe('issuance draft payload', () => {
  it('turns the canonical business day into one UTC start instant', () => {
    // The Jalali → canonical conversion is `DateInput`'s job (covered by the
    // shared date foundation); the draft only ever holds `YYYY-MM-DD`.
    expect(toPrepareInput(draft()).validUntil).toBe('2027-10-20T00:00:00.000Z');
  });

  it('sends no end date for a perpetual license', () => {
    const input = toPrepareInput(draft({ kind: 'PERPETUAL' }));
    expect(input.validUntil).toBeNull();
  });

  it('maps an empty ceiling to null (no stored ceiling), never to zero', () => {
    const input = toPrepareInput(draft());
    expect(input.organizationLimit).toBeNull();
    expect(input.userLimit).toBeNull();
    expect(input.deviceLimit).toBeNull();
    expect(input.deviceLimitSpecified).toBe(false);
  });

  it('sends exactly one lineage reference', () => {
    const renew = toPrepareInput(
      draft({ lineage: 'renew', lineageOperationId: operationId }),
    );
    expect(renew.renewsOperationId).toBe(operationId);
    expect(renew.supersedesOperationId).toBeNull();
    const supersede = toPrepareInput(
      draft({ lineage: 'supersede', lineageOperationId: operationId }),
    );
    expect(supersede.supersedesOperationId).toBe(operationId);
    expect(supersede.renewsOperationId).toBeNull();
  });

  it('splits feature codes and drops empty entries', () => {
    const input = toPrepareInput(
      draft({ features: ' reports-basic , , audit ' }),
    );
    expect(input.features).toEqual(['reports-basic', 'audit']);
  });
});
