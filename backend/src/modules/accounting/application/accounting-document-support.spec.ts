import { describe, expect, it } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  AccountingDocumentAccountRejectedError,
  AccountingDocumentAreaImmutableError,
  AccountingDocumentDateUnresolvableError,
  AccountingDocumentFinalProtectedError,
  AccountingDocumentLineRejectedError,
  AccountingDocumentMissingError,
  AccountingDocumentOriginRejectedError,
  AccountingDocumentPhaseConflictError,
  AccountingDocumentScopeRejectedError,
  AccountingDocumentStaleError,
  AccountingDocumentAlreadyReversedError,
} from '../data/accounting-document-errors.js';
import {
  mapDocumentGuardError,
  mapReverseUniqueViolation,
} from './accounting-documents.service.js';
import { uniqueViolation } from '../../../../test/support/in-memory-repositories.js';
import {
  assertDescription,
  assertVoucherComposition,
  buildRequestHash,
  normalizeLineDescription,
  normalizeLines,
  normalizeOriginSource,
  normalizeSourceLineReference,
  parseDocumentDate,
  parseOptionalDocumentDate,
  requireOperationKey,
} from './accounting-document-support.js';

/**
 * The voucher application layer's normalization, hashing and error mapping
 * (contract §12.3/§13/§16.4, §25).
 *
 * The hash tests are the important ones: §16.4/ADR-0022 §4 require the
 * fingerprint to cover the CLIENT'S INTENT ONLY, so a retry that generates
 * fresh ids or runs a millisecond later must hash identically, while any
 * material change of intent must not.
 */
describe('accounting document input normalization (§12/§13)', () => {
  const lines = [
    { accountId: 'acct-b', debitAmount: '0', creditAmount: '1250.00' },
    { accountId: 'acct-a', debitAmount: '1250.00', creditAmount: '0' },
  ];

  it('requires a non-blank operationKey within the ledger column width', () => {
    expect(requireOperationKey(' op-1 ')).toBe('op-1');
    expect(() => requireOperationKey('   ')).toThrow(AppException);
    expect(() => requireOperationKey('x'.repeat(129))).toThrow(AppException);
    expect(requireOperationKey('x'.repeat(128))).toHaveLength(128);
  });

  it('requires a non-blank description and caps it at the column width', () => {
    expect(assertDescription('  Opening entry ')).toBe('Opening entry');
    expect(() => assertDescription('   ')).toThrow(AppException);
    expect(() => assertDescription('x'.repeat(501))).toThrow(AppException);
  });

  it('normalizes optional narrations and line references to null, not empty string', () => {
    expect(normalizeLineDescription(undefined)).toBeNull();
    expect(normalizeLineDescription('  ')).toBeNull();
    expect(normalizeLineDescription(' rent ')).toBe('rent');
    expect(normalizeSourceLineReference('')).toBeNull();
    expect(normalizeSourceLineReference(' inventory/movement/1 ')).toBe(
      'inventory/movement/1',
    );
    expect(() => normalizeSourceLineReference('x'.repeat(129))).toThrow(
      AppException,
    );
  });

  it('accepts date-only business dates and refuses instants (§12.3)', () => {
    const parsed = parseDocumentDate(' 2026-04-05 ');
    expect(parsed.toISOString()).toBe('2026-04-05T00:00:00.000Z');
    for (const value of [
      '2026-04-05T00:00:00Z',
      '2026-4-5',
      '2026-02-30',
      '05/04/2026',
      '',
    ]) {
      expect(() => parseDocumentDate(value)).toThrow(AppException);
    }
    expect(parseOptionalDocumentDate(undefined, 'dateFrom')).toBeUndefined();
    expect(() => parseOptionalDocumentDate('nope', 'dateFrom')).toThrow(
      AppException,
    );
  });

  it('assigns dense 1-based line numbers from submission order (§12.5)', () => {
    const normalized = normalizeLines(lines);
    expect(normalized.map((line) => line.lineNo)).toEqual([1, 2]);
    expect(normalized.map((line) => line.accountId)).toEqual([
      'acct-b',
      'acct-a',
    ]);
    expect(normalized.map((line) => line.debitAmount)).toEqual(['0', '1250']);
    expect(normalized.map((line) => line.creditAmount)).toEqual(['1250', '0']);
  });

  it('refuses a one-line document before it reaches the domain (400)', () => {
    let caught: unknown;
    try {
      normalizeLines([lines[0] as (typeof lines)[number]]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppException);
    expect((caught as AppException).getStatus()).toBe(400);
    expect((caught as AppException).details).toEqual([
      expect.objectContaining({ field: 'lines', code: 'minItems' }),
    ]);
  });

  it('refuses malformed, negative and over-precise amounts as bad requests (400)', () => {
    for (const amount of ['-1', '1.005', 'abc', '1e3', '10000000000000000']) {
      let caught: unknown;
      try {
        normalizeLines([
          { ...(lines[0] as object), debitAmount: amount } as never,
          lines[1] as never,
        ]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppException);
      expect((caught as AppException).getStatus()).toBe(400);
    }
  });

  it('maps a composed-but-invalid document to 422 carrying every problem (§13)', () => {
    let caught: unknown;
    try {
      assertVoucherComposition(
        normalizeLines([
          { accountId: 'a', debitAmount: '10', creditAmount: '0' },
          { accountId: 'b', debitAmount: '0', creditAmount: '9.99' },
        ]),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppException);
    expect((caught as AppException).getStatus()).toBe(422);
    expect((caught as AppException).details).toEqual({
      problems: ['unbalanced_document'],
    });
  });

  it('accepts a balanced composition silently', () => {
    expect(() => assertVoucherComposition(normalizeLines(lines))).not.toThrow();
  });

  it('keeps the origin/source pair mutually exclusive (§16.1/§16.3)', () => {
    expect(normalizeOriginSource({ origin: 'manual' })).toEqual({
      origin: 'manual',
      source: null,
    });
    expect(
      normalizeOriginSource({
        origin: 'system',
        source: {
          module: 'inventory',
          entityType: 'inventory_movement',
          entityId: '01J8ZQ9W7R6T5Y4U3I2O1P0ABC',
          operation: 'post',
        },
      }).source,
    ).toEqual({
      module: 'inventory',
      entityType: 'inventory_movement',
      entityId: '01J8ZQ9W7R6T5Y4U3I2O1P0ABC',
      operation: 'post',
    });
    expect(() =>
      normalizeOriginSource({
        origin: 'manual',
        source: { module: 'inventory' },
      }),
    ).toThrow(AppException);
    expect(() => normalizeOriginSource({ origin: 'system' })).toThrow(
      AppException,
    );
    expect(() => normalizeOriginSource({ origin: 'robot' })).toThrow(
      AppException,
    );
  });
});

describe('idempotency hashing (§16.4, ADR-0022 §4)', () => {
  const canonical = {
    organizationId: 'org-1',
    financialAreaId: 'area-1',
    documentDate: '2026-04-05',
    description: 'Opening entry',
    lines: [
      { accountId: 'a', debitAmount: '1250', creditAmount: '0' },
      { accountId: 'b', debitAmount: '0', creditAmount: '1250' },
    ],
  };

  it('is deterministic for one logical intent', () => {
    expect(buildRequestHash('document_create', canonical)).toBe(
      buildRequestHash('document_create', { ...canonical }),
    );
    // The same intent, a fresh set of generated ids and a later clock: the
    // payload never carries them, so the hash is unchanged.
    expect(buildRequestHash('document_create', canonical)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('covers the intent: any material difference changes the hash', () => {
    const base = buildRequestHash('document_create', canonical);
    expect(
      buildRequestHash('document_create', {
        ...canonical,
        documentDate: '2026-04-06',
      }),
    ).not.toBe(base);
    expect(
      buildRequestHash('document_create', {
        ...canonical,
        description: 'Opening entry ',
      }),
    ).not.toBe(base);
    expect(
      buildRequestHash('document_create', {
        ...canonical,
        lines: [...canonical.lines].reverse(),
      }),
    ).not.toBe(base);
  });

  it('separates the operations, so one key cannot replay across them', () => {
    expect(buildRequestHash('document_create', canonical)).not.toBe(
      buildRequestHash('document_finalize', canonical),
    );
  });
});

describe('guard-error mapping (§25, AC-I-01/16)', () => {
  it('maps a missing or foreign document to 404, never 403', () => {
    const mapped = mapDocumentGuardError(new AccountingDocumentMissingError());
    expect(mapped?.getStatus()).toBe(404);
    expect(mapped?.code).toBe('EntityNotFound');
  });

  it('maps a moved phase and a stale read to 409', () => {
    expect(
      mapDocumentGuardError(
        new AccountingDocumentPhaseConflictError('final', 'temporary'),
      )?.getStatus(),
    ).toBe(409);
    expect(
      mapDocumentGuardError(new AccountingDocumentStaleError())?.getStatus(),
    ).toBe(409);
  });

  it('maps the document rules to 422', () => {
    for (const error of [
      new AccountingDocumentFinalProtectedError('final'),
      new AccountingDocumentAreaImmutableError(),
      new AccountingDocumentLineRejectedError(['unbalanced_document']),
      new AccountingDocumentAccountRejectedError(
        'acct',
        'account_not_postable',
      ),
      new AccountingDocumentAccountRejectedError('acct', 'account_disabled'),
      new AccountingDocumentDateUnresolvableError(new Date()),
      new AccountingDocumentScopeRejectedError('period', 'sealed'),
      new AccountingDocumentScopeRejectedError('year', 'closed'),
      new AccountingDocumentScopeRejectedError('area', 'disabled'),
    ]) {
      expect(mapDocumentGuardError(error)?.getStatus()).toBe(422);
    }
  });

  it('maps a foreign or missing ACCOUNT to 404 like any other reference', () => {
    const mapped = mapDocumentGuardError(
      new AccountingDocumentAccountRejectedError('acct-9', 'account_not_found'),
    );
    expect(mapped?.getStatus()).toBe(404);
  });

  it('maps inconsistent origin evidence to 400 and leaves anything else alone', () => {
    expect(
      mapDocumentGuardError(
        new AccountingDocumentOriginRejectedError('source_required_for_system'),
      )?.getStatus(),
    ).toBe(400);
    expect(mapDocumentGuardError(new Error('boom'))).toBeNull();
    expect(mapDocumentGuardError('not even an error')).toBeNull();
  });

  it('maps already-reversed to 422', () => {
    const mapped = mapDocumentGuardError(
      new AccountingDocumentAlreadyReversedError('doc-1'),
    );
    expect(mapped?.getStatus()).toBe(422);
    expect(mapped?.details).toMatchObject({ problem: 'already_reversed' });
  });

  it('maps reverse unique races by constraint target, not as a blanket already-reversed', () => {
    const already = mapReverseUniqueViolation(
      uniqueViolation(['reversesDocumentId']),
    );
    expect(already.getStatus()).toBe(422);
    expect(already.details).toMatchObject({ problem: 'already_reversed' });

    const number = mapReverseUniqueViolation(
      uniqueViolation(['organizationId', 'financialAreaId', 'documentNumber']),
    );
    expect(number.getStatus()).toBe(409);
    expect(number.message).toMatch(/document number/);

    const operation = mapReverseUniqueViolation(
      uniqueViolation(['organizationId', 'operationKey']),
    );
    expect(operation.getStatus()).toBe(409);
    expect(operation.message).toMatch(/operationKey/);

    const unrelated = mapReverseUniqueViolation(
      uniqueViolation(['voucherLineId']),
    );
    expect(unrelated.getStatus()).toBe(409);
    expect(unrelated.message).toMatch(/uniqueness constraint/);
  });

  it('always produces an AppException the global filter can render', () => {
    const mapped = mapDocumentGuardError(
      new AccountingDocumentPhaseConflictError('draft', 'temporary'),
    );
    expect(mapped).toBeInstanceOf(AppException);
    expect(typeof mapped?.code).toBe('string');
    expect(typeof mapped?.message).toBe('string');
  });
});
