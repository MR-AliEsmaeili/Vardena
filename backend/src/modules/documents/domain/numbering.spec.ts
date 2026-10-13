import { describe, expect, it } from 'vitest';
import {
  formatSerial,
  isNumericSerial,
  isNumberingReusePolicy,
  isNumberingStrategy,
  isValidScopeKey,
  isValidWidth,
  nextSerialValue,
  normalizeScopeKey,
  NUMBERING_REUSE_POLICIES,
  NUMBERING_STRATEGIES,
  parseSerial,
} from './numbering.js';

describe('numeric-only serials (Task 8 §11)', () => {
  it('accepts pure digits', () => {
    expect(isNumericSerial('140500001')).toBe(true);
    expect(isNumericSerial('1')).toBe(true);
    expect(isNumericSerial('00042')).toBe(true);
  });

  it('rejects every separator, prefix and symbol', () => {
    for (const bad of [
      '1405-00001',
      '1405/00001',
      'INV-140500001',
      '1405.0001',
      '1405_0001',
      ' 1405',
      '1405 ',
      '',
      '-42',
      '+42',
    ]) {
      expect(isNumericSerial(bad)).toBe(false);
    }
  });

  it('rejects non-decimal digits and over-long serials', () => {
    expect(isNumericSerial('١٤٠٥')).toBe(false);
    expect(isNumericSerial('١٢٣')).toBe(false);
    expect(isNumericSerial('9'.repeat(33))).toBe(false);
  });

  it('parses serials exactly (no float drift)', () => {
    expect(parseSerial('42')).toBe(42n);
    expect(parseSerial('140500001')).toBe(140500001n);
    expect(parseSerial('nope')).toBeNull();
  });
});

describe('serial formatting (zero padding, never truncating)', () => {
  it('pads up to the configured width', () => {
    expect(formatSerial(42n, 5)).toBe('00042');
    expect(formatSerial(140500001n, 0)).toBe('140500001');
  });

  it('never truncates a value wider than the width', () => {
    expect(formatSerial(123456n, 3)).toBe('123456');
  });

  it('keeps the output numeric-only', () => {
    expect(isNumericSerial(formatSerial(1n, 8))).toBe(true);
  });
});

describe('numbering strategies (configurable, extensible)', () => {
  it('is a closed list with only monotonic implemented', () => {
    expect([...NUMBERING_STRATEGIES]).toEqual(['monotonic']);
    expect(isNumberingStrategy('monotonic')).toBe(true);
    expect(isNumberingStrategy('fiscal_year')).toBe(false);
  });

  it('computes the next value as last + 1', () => {
    expect(nextSerialValue(0n, 'monotonic')).toBe(1n);
    expect(nextSerialValue(41n, 'monotonic')).toBe(42n);
  });
});

describe('reuse policy (Task 8 §12)', () => {
  it('is a closed, per-series configurable list', () => {
    expect([...NUMBERING_REUSE_POLICIES].sort()).toEqual(['never', 'recycle']);
    expect(isNumberingReusePolicy('never')).toBe(true);
    expect(isNumberingReusePolicy('recycle')).toBe(true);
    expect(isNumberingReusePolicy('sometimes')).toBe(false);
  });
});

describe('scope keys and width', () => {
  it('normalizes an empty scope key to the default', () => {
    expect(normalizeScopeKey(undefined)).toBe('');
    expect(normalizeScopeKey('  ')).toBe('');
    expect(normalizeScopeKey('series-a')).toBe('series-a');
  });

  it('accepts lowercase token scope keys only', () => {
    expect(isValidScopeKey('')).toBe(true);
    expect(isValidScopeKey('branch-tehran_01')).toBe(true);
    expect(isValidScopeKey('BRANCH')).toBe(false);
    expect(isValidScopeKey('a b')).toBe(false);
  });

  it('bounds the padding width', () => {
    expect(isValidWidth(0)).toBe(true);
    expect(isValidWidth(32)).toBe(true);
    expect(isValidWidth(-1)).toBe(false);
    expect(isValidWidth(33)).toBe(false);
    expect(isValidWidth(1.5)).toBe(false);
  });
});
