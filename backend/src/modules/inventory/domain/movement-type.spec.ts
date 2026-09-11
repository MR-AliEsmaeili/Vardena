import { describe, expect, it } from 'vitest';
import {
  isMovementType,
  isSinglePostType,
  MOVEMENT_TYPES,
  movementSign,
  requiresReason,
  reversalTypeFor,
  SINGLE_POST_TYPES,
} from './movement-type.js';

describe('movement type vocabulary', () => {
  it('is a closed list of eight types', () => {
    expect([...MOVEMENT_TYPES].sort()).toEqual(
      [
        'adjustment_in',
        'adjustment_out',
        'inbound',
        'outbound',
        'reversal_in',
        'reversal_out',
        'transfer_in',
        'transfer_out',
      ].sort(),
    );
  });

  it('recognizes its own types and rejects anything else', () => {
    for (const type of MOVEMENT_TYPES) {
      expect(isMovementType(type)).toBe(true);
    }
    for (const other of [
      '',
      'INBOUND',
      'purchase_receipt',
      'sales_issue',
      'opening',
      'in',
      'out',
    ]) {
      expect(isMovementType(other)).toBe(false);
    }
  });

  it('signs every type so balances stay SUM-consistent', () => {
    expect(movementSign('inbound')).toBe(1);
    expect(movementSign('transfer_in')).toBe(1);
    expect(movementSign('adjustment_in')).toBe(1);
    expect(movementSign('reversal_in')).toBe(1);
    expect(movementSign('outbound')).toBe(-1);
    expect(movementSign('transfer_out')).toBe(-1);
    expect(movementSign('adjustment_out')).toBe(-1);
    expect(movementSign('reversal_out')).toBe(-1);
  });
});

describe('single-posting channel', () => {
  it('accepts plain postings but never transfer legs or reversals', () => {
    expect([...SINGLE_POST_TYPES].sort()).toEqual(
      ['adjustment_in', 'adjustment_out', 'inbound', 'outbound'].sort(),
    );
    expect(isSinglePostType('transfer_in')).toBe(false);
    expect(isSinglePostType('transfer_out')).toBe(false);
    expect(isSinglePostType('reversal_in')).toBe(false);
    expect(isSinglePostType('reversal_out')).toBe(false);
  });
});

describe('adjustment reasons', () => {
  it('requires a reason for adjustments only', () => {
    expect(requiresReason('adjustment_in')).toBe(true);
    expect(requiresReason('adjustment_out')).toBe(true);
    for (const type of MOVEMENT_TYPES) {
      if (type === 'adjustment_in' || type === 'adjustment_out') continue;
      expect(requiresReason(type)).toBe(false);
    }
  });
});

describe('reversal mirroring', () => {
  it('reverses an outbound original as an inbound', () => {
    expect(reversalTypeFor('-7')).toBe('reversal_in');
    expect(reversalTypeFor('-0.0001')).toBe('reversal_in');
  });

  it('reverses an inbound original as an outbound', () => {
    expect(reversalTypeFor('10')).toBe('reversal_out');
    expect(reversalTypeFor('0.5')).toBe('reversal_out');
  });
});
