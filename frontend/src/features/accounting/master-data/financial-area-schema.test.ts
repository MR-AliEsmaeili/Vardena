import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import {
  financialAreaSchema,
  MAX_FINANCIAL_AREA_CODE_LENGTH,
  MAX_FINANCIAL_AREA_TITLE_LENGTH,
} from './financial-area-schema';

/**
 * The shared schema is the ONE validation source for both the bootstrap
 * create form and the administration create/edit page (ACC-01). Its limits
 * mirror the backend DTO (`MAX_CODE_LENGTH = 64`, `MAX_TITLE_LENGTH = 200`)
 * and its messages are the `t.financialArea.*` dictionary strings.
 */

type ParseResult = ReturnType<typeof financialAreaSchema.safeParse>;

/** Validation messages of one field, `[]` when the parse succeeded. */
function fieldMessages(result: ParseResult, field: 'code' | 'title'): string[] {
  return result.success
    ? []
    : result.error.issues
        .filter((entry) => entry.path[0] === field)
        .map((entry) => entry.message);
}

/** Parsed data, or a marker that can never equal a valid expectation. */
function parsedData(result: ParseResult) {
  return result.success ? result.data : null;
}

describe('financialAreaSchema', () => {
  it('accepts a valid code and title and trims surrounding whitespace', () => {
    const result = financialAreaSchema.safeParse({
      code: '  MAIN  ',
      title: '  دفاتر اصلی  ',
    });

    expect(result.success).toBe(true);
    expect(parsedData(result)).toEqual({
      code: 'MAIN',
      title: 'دفاتر اصلی',
    });
  });

  it('rejects an empty (or whitespace-only) code with the dictionary message', () => {
    for (const code of ['', '   ']) {
      const result = financialAreaSchema.safeParse({ code, title: 'نام' });
      expect(result.success).toBe(false);
      expect(fieldMessages(result, 'code')).toContain(
        t.financialArea.codeRequired,
      );
    }
  });

  it('rejects an empty (or whitespace-only) title with the dictionary message', () => {
    for (const title of ['', '   ']) {
      const result = financialAreaSchema.safeParse({ code: 'MAIN', title });
      expect(result.success).toBe(false);
      expect(fieldMessages(result, 'title')).toContain(
        t.financialArea.titleRequired,
      );
    }
  });

  it('enforces the backend code length limit (64) at the boundary', () => {
    const atLimit = financialAreaSchema.safeParse({
      code: 'a'.repeat(MAX_FINANCIAL_AREA_CODE_LENGTH),
      title: 'نام',
    });
    expect(atLimit.success).toBe(true);

    const overLimit = financialAreaSchema.safeParse({
      code: 'a'.repeat(MAX_FINANCIAL_AREA_CODE_LENGTH + 1),
      title: 'نام',
    });
    expect(overLimit.success).toBe(false);
    expect(fieldMessages(overLimit, 'code')).toContain(
      t.financialArea.codeTooLong,
    );
  });

  it('enforces the backend title length limit (200) at the boundary', () => {
    const atLimit = financialAreaSchema.safeParse({
      code: 'MAIN',
      title: 'ب'.repeat(MAX_FINANCIAL_AREA_TITLE_LENGTH),
    });
    expect(atLimit.success).toBe(true);

    const overLimit = financialAreaSchema.safeParse({
      code: 'MAIN',
      title: 'ب'.repeat(MAX_FINANCIAL_AREA_TITLE_LENGTH + 1),
    });
    expect(overLimit.success).toBe(false);
    expect(fieldMessages(overLimit, 'title')).toContain(
      t.financialArea.titleTooLong,
    );
  });
});
