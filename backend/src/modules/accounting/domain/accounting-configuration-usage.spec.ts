import { describe, expect, it } from 'vitest';
import {
  ConfigurationUsageReferenceError,
  resolveUsedConfigurationIds,
} from './accounting-configuration-freeze.js';
import {
  isConfigurationFrozen,
  resolveFreezeState,
} from './accounting-configuration-freeze.js';

/**
 * The domain rule Task 13 wired to the marker: WHICH accounting configurations a
 * posted document used.
 *
 * The rule is deliberately tiny and total, because it is the only place that
 * answer is computed — the data layer reads the pins, this function decides, and
 * `finalizeChecked` commits the result inside the ledger transaction. Every case
 * the accepted model leaves open (a voucher across two configurations, a pin on a
 * SUPERSEDED version) resolves to "mark exactly what the posting touched", and
 * every reference the model cannot answer fails closed: a partial usage record
 * would silently un-freeze a configuration that was used.
 */

const CONFIG_A = '01CONFIGAAAAAAAAAAAAAAAAAA01';
const CONFIG_B = '01CONFIGAAAAAAAAAAAAAAAAAA02';
const ACCOUNT_1 = '01ACCOUNTAAAAAAAAAAAAAAAAA01';
const ACCOUNT_2 = '01ACCOUNTAAAAAAAAAAAAAAAAA02';
const ACCOUNT_3 = '01ACCOUNTAAAAAAAAAAAAAAAAA03';

describe('resolveUsedConfigurationIds — the usage reference rule (Task 13)', () => {
  it('resolves the single configuration every referenced account pins', () => {
    expect(
      resolveUsedConfigurationIds({
        accountIds: [ACCOUNT_1, ACCOUNT_2],
        pins: [
          { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
          { accountId: ACCOUNT_2, accountingConfigurationId: CONFIG_A },
        ],
      }),
    ).toEqual([CONFIG_A]);
  });

  it('deduplicates repeated lines over one account and one configuration', () => {
    expect(
      resolveUsedConfigurationIds({
        accountIds: [ACCOUNT_1],
        pins: [
          { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
          { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
          { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
        ],
      }),
    ).toEqual([CONFIG_A]);
  });

  it('marks EVERY configuration a mixed-configuration voucher touched, ascending', () => {
    // The Task 11 backfill's normal shape: some accounts pin LEGACY (now
    // SUPERSEDED), newer roots pin the published DEFAULT. Neither rule
    // "only the ACTIVE configuration" (would freeze an untouched version) nor
    // "refuse the voucher" (a new business rule) is applied — the marker
    // follows the money.
    const ids = resolveUsedConfigurationIds({
      accountIds: [ACCOUNT_1, ACCOUNT_2, ACCOUNT_3],
      pins: [
        { accountId: ACCOUNT_3, accountingConfigurationId: CONFIG_B },
        { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
        { accountId: ACCOUNT_2, accountingConfigurationId: CONFIG_B },
      ],
    });
    expect(ids).toEqual([CONFIG_A, CONFIG_B].sort());
    // Ascending and deduplicated is not cosmetic: the marker statement locks one
    // row per id in this exact order (the module's multi-row discipline).
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns nothing for a document without lines, and refuses nothing', () => {
    // An empty line set has no configuration to mark. (The document guards
    // refuse such a voucher anyway — this rule never invents a mark.)
    expect(resolveUsedConfigurationIds({ accountIds: [], pins: [] })).toEqual(
      [],
    );
  });

  it('refuses an account whose row could not be read (foreign or gone)', () => {
    // The read is organization-scoped, so a foreign account simply has no row:
    // the reference is unresolved and the operation must fail, not skip.
    expect(() =>
      resolveUsedConfigurationIds({
        accountIds: [ACCOUNT_1, ACCOUNT_2],
        pins: [{ accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A }],
      }),
    ).toThrow(ConfigurationUsageReferenceError);
    try {
      resolveUsedConfigurationIds({
        accountIds: [ACCOUNT_1, ACCOUNT_2],
        pins: [{ accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A }],
      });
      expect.unreachable('the unresolved reference must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationUsageReferenceError);
      expect((error as ConfigurationUsageReferenceError).problem).toBe(
        'account_pin_unresolved',
      );
      expect((error as ConfigurationUsageReferenceError).subject).toBe(
        ACCOUNT_2,
      );
    }
  });

  it('refuses a null or blank pin instead of treating it as “no configuration”', () => {
    // `accounts.accounting_configuration_id` is NOT NULL (Task 11 D1/D3): a null
    // here means the schema or a write path regressed. Marking nothing would
    // leave a used configuration mutable, so the whole posting is refused.
    for (const pin of [null, '', '   ']) {
      expect(() =>
        resolveUsedConfigurationIds({
          accountIds: [ACCOUNT_1],
          pins: [{ accountId: ACCOUNT_1, accountingConfigurationId: pin }],
        }),
      ).toThrow(/account_pin_missing/);
    }
  });

  it('refuses one account answering with two different pins', () => {
    expect(() =>
      resolveUsedConfigurationIds({
        accountIds: [ACCOUNT_1],
        pins: [
          { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
          { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_B },
        ],
      }),
    ).toThrow(/account_pin_conflict/);
  });

  it('refuses a pin for an account the document does not reference', () => {
    // The line set moved between the read and the check: the caller's set is
    // authoritative, so an extra row is a stale read, never a bonus mark.
    expect(() =>
      resolveUsedConfigurationIds({
        accountIds: [ACCOUNT_1],
        pins: [
          { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
          { accountId: ACCOUNT_2, accountingConfigurationId: CONFIG_B },
        ],
      }),
    ).toThrow(/account_pin_unexpected/);
  });

  it('refuses a caller that did not deduplicate its account set', () => {
    expect(() =>
      resolveUsedConfigurationIds({
        accountIds: [ACCOUNT_1, ACCOUNT_1],
        pins: [{ accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A }],
      }),
    ).toThrow(/account_pin_unexpected/);
  });

  it('freezes exactly what it marked — and nothing it did not', () => {
    // The link between the mark and the lifecycle protection: `frozen_used` is
    // reached through the marker alone, so an operation that never marked leaves
    // the configuration mutable (drafts stay editable until first real use).
    const usedAt = new Date('2026-04-05T06:00:00.000Z');
    expect(
      resolveFreezeState({ status: 'DRAFT', operationallyUsedAt: null }),
    ).toBe('mutable');
    expect(
      resolveFreezeState({ status: 'DRAFT', operationallyUsedAt: usedAt }),
    ).toBe('frozen_used');
    expect(
      resolveFreezeState({ status: 'ACTIVE', operationallyUsedAt: usedAt }),
    ).toBe('frozen_used');
    expect(
      isConfigurationFrozen({ status: 'DRAFT', operationallyUsedAt: null }),
    ).toBe(false);
    expect(
      isConfigurationFrozen({ status: 'DRAFT', operationallyUsedAt: usedAt }),
    ).toBe(true);
  });
});
