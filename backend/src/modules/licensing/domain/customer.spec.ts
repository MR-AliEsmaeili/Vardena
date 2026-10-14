import { describe, expect, it } from 'vitest';
import {
  assertValidCustomerCode,
  assertValidCustomerId,
  assertValidCustomerName,
  assertValidCustomerRecord,
  LicenseCustomerError,
} from './customer.js';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
  issueLicenseFile,
} from '../../../tools/development-license-authority.js';

describe('licensing customer domain & issuance authority (L-06, PDR-14)', () => {
  const authority = generateAuthorityKeyPair();
  const INSTALLATION = '01K7INSTALLATIONAAAAAAAAAA';
  const CUSTOMER_ID = '01K7CUSTOMERAAAAAAAAAAAAAA';
  const CUSTOMER_CODE = 'CUST-ACME-01';

  it('requires a valid, stable business customerCode distinct from customerId', () => {
    expect(assertValidCustomerCode('CUST-ACME-01', CUSTOMER_ID)).toBe(
      'CUST-ACME-01',
    );
    expect(assertValidCustomerId(CUSTOMER_ID)).toBe(CUSTOMER_ID);
    expect(assertValidCustomerName('  Acme Holding  ')).toBe('Acme Holding');

    expect(
      assertValidCustomerRecord({
        customerId: CUSTOMER_ID,
        customerCode: CUSTOMER_CODE,
        displayName: 'Acme Holding',
      }),
    ).toEqual({
      customerId: CUSTOMER_ID,
      customerCode: CUSTOMER_CODE,
      displayName: 'Acme Holding',
    });
  });

  it('rejects missing, blank, malformed, or customerId-equal customerCode', () => {
    for (const invalid of [
      undefined,
      null,
      '',
      '   ',
      'a',
      '-starts-with-dash',
      'contains spaces',
      'x'.repeat(65),
    ]) {
      expect(() => assertValidCustomerCode(invalid, CUSTOMER_ID)).toThrow(
        LicenseCustomerError,
      );
    }

    expect(() => assertValidCustomerCode(CUSTOMER_ID, CUSTOMER_ID)).toThrow(
      /must not equal customerId/,
    );
  });

  it('refuses to issue a license without an explicit persisted customer identity and customerCode', () => {
    expect(() =>
      issueLicenseFile(
        {
          installationId: INSTALLATION,
          customerId: '' as unknown as string,
          customerCode: CUSTOMER_CODE,
        },
        authority.privateKey,
      ),
    ).toThrow(/customerId must not be empty/);

    expect(() =>
      issueLicenseFile(
        {
          installationId: INSTALLATION,
          customerId: CUSTOMER_ID,
          customerCode: '' as unknown as string,
        },
        authority.privateKey,
      ),
    ).toThrow(/customerCode must not be empty/);

    expect(() =>
      issueLicenseFile(
        {
          installationId: INSTALLATION,
          customerId: CUSTOMER_ID,
          customerCode: CUSTOMER_ID,
        },
        authority.privateKey,
      ),
    ).toThrow(/must not equal customerId/);

    expect(() =>
      issueLicenseCode(
        {
          installationId: INSTALLATION,
          customerId: CUSTOMER_ID,
          customerCode: '' as unknown as string,
        },
        authority.privateKey,
      ),
    ).toThrow(/customerCode must not be empty/);
  });

  it('issues from a persisted customer record and rejects mismatched explicit customerId/customerCode', () => {
    const issued = issueLicenseFile(
      {
        installationId: INSTALLATION,
        customer: {
          customerId: CUSTOMER_ID,
          customerCode: CUSTOMER_CODE,
          displayName: 'Acme Industrial Ltd.',
        },
      },
      authority.privateKey,
    );
    expect(issued.payload.customerId).toBe(CUSTOMER_ID);
    expect(issued.payload.customerCode).toBe(CUSTOMER_CODE);
    expect(issued.payload.customerName).toBe('Acme Industrial Ltd.');

    expect(() =>
      issueLicenseFile(
        {
          installationId: INSTALLATION,
          customer: {
            customerId: CUSTOMER_ID,
            customerCode: CUSTOMER_CODE,
            displayName: 'Acme Industrial Ltd.',
          },
          customerCode: 'CUST-OTHER-99',
        },
        authority.privateKey,
      ),
    ).toThrow(/does not match the customer record/);
  });
});
