import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UIEvent } from 'react';
import {
  compareExactDecimals,
  isValidDecimalString,
  sumExactDecimals,
} from './decimal';
import { buildCsvContent, escapeCsvCell } from './export-table';
import { useVirtualWindow } from './use-virtual-window';

describe('exact BigInt decimal arithmetic', () => {
  it('sums large 18-digit decimals without IEEE-754 floating-point loss', () => {
    // Number('9999999999999999.99') rounds in JS float; BigInt keeps every digit.
    expect(
      sumExactDecimals(['9999999999999999.01', '0.98', '', 'invalid']),
    ).toBe('9999999999999999.99');
  });

  it('sums mixed-scale inventory quantities accurately', () => {
    expect(sumExactDecimals(['10', '2.5', '0.1255'])).toBe('12.6255');
  });

  it('compares debit and credit totals and computes exact absolute difference', () => {
    expect(compareExactDecimals('1500.50', '1500.5')).toEqual({
      equal: true,
      bothZero: false,
      absoluteDifference: '0.00',
    });

    expect(compareExactDecimals('2500.75', '2000.25')).toEqual({
      equal: false,
      bothZero: false,
      absoluteDifference: '500.50',
    });

    expect(compareExactDecimals('0', '0.00')).toEqual({
      equal: true,
      bothZero: true,
      absoluteDifference: '0.00',
    });
  });

  it('recognizes valid vs malformed decimal literals', () => {
    expect(isValidDecimalString('12500.50')).toBe(true);
    expect(isValidDecimalString('-42.1')).toBe(true);
    expect(isValidDecimalString('12.3.4')).toBe(false);
    expect(isValidDecimalString('')).toBe(false);
  });
});

describe('Excel UTF-8 BOM CSV export', () => {
  it('neutralizes formula injection while keeping valid negative numbers intact', () => {
    expect(escapeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell('@cmd')).toBe("'@cmd");
    expect(escapeCsvCell('-1250.50')).toBe('-1250.50');
    expect(escapeCsvCell('شرح با "گیومه" و, ویرگول')).toBe(
      '"شرح با ""گیومه"" و, ویرگول"',
    );
  });

  it('prepends UTF-8 BOM for Persian Excel compatibility', () => {
    const csv = buildCsvContent(
      [
        { header: 'شماره سند', value: (row) => row.no },
        { header: 'مبلغ', value: (row) => row.amount },
      ],
      [{ no: '1001', amount: '500000.00' }],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('شماره سند,مبلغ\r\n1001,500000.00');
  });
});

describe('useVirtualWindow', () => {
  it('renders all rows below threshold without spacers', () => {
    const { result } = renderHook(() =>
      useVirtualWindow({ totalCount: 30, threshold: 80 }),
    );
    expect(result.current.isVirtualized).toBe(false);
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(30);
    expect(result.current.topSpacerHeight).toBe(0);
    expect(result.current.bottomSpacerHeight).toBe(0);
  });

  it('windows large row counts and updates visible slice on scroll', () => {
    const { result } = renderHook(() =>
      useVirtualWindow({
        totalCount: 300,
        rowHeight: 40,
        viewportHeight: 400,
        threshold: 80,
        overscan: 5,
      }),
    );
    expect(result.current.isVirtualized).toBe(true);
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(15);
    expect(result.current.bottomSpacerHeight).toBe((300 - 15) * 40);

    act(() => {
      result.current.onScroll({
        currentTarget: { scrollTop: 4000 },
      } as unknown as UIEvent<HTMLElement>);
    });

    expect(result.current.startIndex).toBe(95);
    expect(result.current.endIndex).toBe(115);
    expect(result.current.topSpacerHeight).toBe(95 * 40);
  });
});
