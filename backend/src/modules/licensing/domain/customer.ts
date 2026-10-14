/**
 * Licensing Customer domain model and invariants (L-06, PDR-14 / OD-LIC-03).
 *
 * Product Owner policy:
 * 1. Every licensing customer has a stable, independent business `customerCode`.
 * 2. `customerId` remains the internal database identity and is not replaced by
 *    `customerCode`.
 * 3. `customerName` (`displayName`) remains a mutable display name, not an
 *    identity key. Renaming it must not change `customerId` or `customerCode`.
 * 4. Neither `customerId` nor `customerCode` may ever be derived from
 *    `displayName` or defaulted to one another (`customerCode !== customerId`).
 */

export const MAX_CUSTOMER_CODE_LENGTH = 64;
export const MAX_CUSTOMER_NAME_LENGTH = 200;

/**
 * Valid identifier / business code pattern: 2..64 ASCII characters starting
 * with an alphanumeric character and containing only `[A-Za-z0-9._:-]`.
 * Matches the database check constraint `customers_customer_code_check`.
 */
export const CUSTOMER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
export const CUSTOMER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;

export interface LicenseCustomer {
  customerId: string;
  customerCode: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export type LicenseCustomerErrorReason =
  | 'customer-id'
  | 'customer-code'
  | 'customer-name'
  | 'duplicate-customer'
  | 'customer-code-mismatch'
  | 'customer-not-found';

export class LicenseCustomerError extends Error {
  constructor(
    public readonly reason: LicenseCustomerErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'LicenseCustomerError';
  }
}

export function assertValidCustomerId(customerId: unknown): string {
  if (typeof customerId !== 'string') {
    throw new LicenseCustomerError(
      'customer-id',
      'customerId is required and must be a string.',
    );
  }
  if (customerId.trim().length === 0) {
    throw new LicenseCustomerError(
      'customer-id',
      'customerId must not be empty or whitespace-only.',
    );
  }
  if (
    customerId !== customerId.trim() ||
    !CUSTOMER_ID_PATTERN.test(customerId)
  ) {
    throw new LicenseCustomerError(
      'customer-id',
      'customerId must be 2..64 ASCII code characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$.',
    );
  }
  return customerId;
}

export function assertValidCustomerCode(
  customerCode: unknown,
  customerId?: string,
): string {
  if (typeof customerCode !== 'string') {
    throw new LicenseCustomerError(
      'customer-code',
      'customerCode is required and must be a string.',
    );
  }
  if (customerCode.trim().length === 0) {
    throw new LicenseCustomerError(
      'customer-code',
      'customerCode must not be empty or whitespace-only.',
    );
  }
  if (
    customerCode !== customerCode.trim() ||
    !CUSTOMER_CODE_PATTERN.test(customerCode)
  ) {
    throw new LicenseCustomerError(
      'customer-code',
      'customerCode must be 2..64 ASCII code characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$.',
    );
  }
  if (customerId !== undefined && customerCode === customerId) {
    throw new LicenseCustomerError(
      'customer-code',
      'customerCode must be an independent business code and must not equal customerId.',
    );
  }
  return customerCode;
}

export function assertValidCustomerName(displayName: unknown): string {
  if (typeof displayName !== 'string') {
    throw new LicenseCustomerError(
      'customer-name',
      'customerName is required and must be a string.',
    );
  }
  const trimmed = displayName.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CUSTOMER_NAME_LENGTH) {
    throw new LicenseCustomerError(
      'customer-name',
      `customerName must be 1..${MAX_CUSTOMER_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

export function assertValidCustomerRecord(record: {
  customerId: unknown;
  customerCode: unknown;
  displayName: unknown;
}): {
  customerId: string;
  customerCode: string;
  displayName: string;
} {
  const customerId = assertValidCustomerId(record.customerId);
  const customerCode = assertValidCustomerCode(record.customerCode, customerId);
  const displayName = assertValidCustomerName(record.displayName);
  return { customerId, customerCode, displayName };
}
