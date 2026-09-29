import { z } from 'zod';
import type { Account } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { DATE_ONLY_PATTERN } from '../shared/report-filters';

/**
 * Compose/edit form schema (React Hook Form + Zod, standards.md §9).
 *
 * The schema mirrors the TRANSPORT contract only — the DTO constraints the
 * request must satisfy (`CreateAccountingDocumentDto` /
 * `UpdateAccountingDocumentDto`): required non-blank description (≤ 500),
 * date-only date, at least two lines, postable account per line, non-negative
 * `numeric(18,2)` amounts with at most 16 integer digits and 2 decimals, and
 * the one-side-per-line rule (§13.2 — a negative amount is written as the
 * opposite side, never as a sign).
 *
 * Deliberately NOT validated here: the document-level balance
 * (`Σ debit = Σ credit`) and the fiscal-calendar resolution of the date.
 * Those are DOMAIN rules the backend owns (§13.5, §6.2); this form does not
 * compute or display any aggregate, and their violations come back as mapped
 * Persian business-rule messages (`t.documents.lineProblems` /
 * `dateUnresolvable`).
 */

/** The backend's own money input pattern (`domain/money.ts`). */
export const MONEY_INPUT_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

/** The backend's header/line description cap (`MAX_DESCRIPTION_LENGTH`). */
export const MAX_DOCUMENT_DESCRIPTION_LENGTH = 500;

/** `MIN_ACCOUNTING_DOCUMENT_LINES` — a double-entry document has two sides. */
export const MIN_DOCUMENT_LINES = 2;

/** True when an exact decimal string carries no value (`''`, `'0'`, `'0.00'`). */
export function isZeroAmount(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^0+(\.0*)?$/.test(trimmed);
}

export interface DocumentLineValues {
  accountId: string;
  /** `''` = no detail allocation. */
  detailId: string;
  /** `''` renders as the `'0'` side on submit. */
  debitAmount: string;
  creditAmount: string;
  description: string;
}

export interface DocumentFormValues {
  financialAreaId: string;
  documentDate: string;
  description: string;
  lines: DocumentLineValues[];
}

/** A fresh blank row (always a NEW object — RHF field arrays key by identity). */
export function emptyDocumentLine(): DocumentLineValues {
  return {
    accountId: '',
    detailId: '',
    debitAmount: '',
    creditAmount: '',
    description: '',
  };
}
const lineSchema = z
  .object({
    accountId: z.string(),
    detailId: z.string(),
    debitAmount: z.string().trim(),
    creditAmount: z.string().trim(),
    description: z.string().trim(),
  })
  .superRefine((line, ctx) => {
    if (line.accountId === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['accountId'],
        message: t.documents.validation.accountRequired,
      });
    }
    for (const field of ['debitAmount', 'creditAmount'] as const) {
      const value = line[field];
      if (value !== '' && !MONEY_INPUT_PATTERN.test(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: t.documents.validation.amountInvalid,
        });
      }
    }
    // One side per line (§13.2): exactly one of the two amounts is non-zero.
    const hasDebit = !isZeroAmount(line.debitAmount);
    const hasCredit = !isZeroAmount(line.creditAmount);
    if (hasDebit === hasCredit) {
      ctx.addIssue({
        code: 'custom',
        path: ['debitAmount'],
        message: t.documents.validation.amountSides,
      });
      ctx.addIssue({
        code: 'custom',
        path: ['creditAmount'],
        message: t.documents.validation.amountSides,
      });
    }
    if (line.description.length > MAX_DOCUMENT_DESCRIPTION_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['description'],
        message: t.documents.validation.lineDescriptionTooLong,
      });
    }
  });

/**
 * Build the form schema. `accountById` resolves a selected account (from the
 * TanStack cache the pickers already fill) so the detail-required rule
 * (OD-29-03: a line on an account linked to a detail group MUST allocate a
 * detail) can be checked client-side with a precise inline error. When the
 * account is not (yet) resolved the check is skipped — the backend enforces
 * it authoritatively either way.
 */
export function documentFormSchema(
  accountById: (accountId: string) => Account | undefined,
) {
  return z
    .object({
      financialAreaId: z.string().min(1, t.documents.validation.areaRequired),
      documentDate: z
        .string()
        .trim()
        .min(1, t.documents.validation.dateRequired)
        .regex(DATE_ONLY_PATTERN, t.documents.validation.dateInvalid),
      description: z
        .string()
        .trim()
        .min(1, t.documents.validation.descriptionRequired)
        .max(
          MAX_DOCUMENT_DESCRIPTION_LENGTH,
          t.documents.validation.descriptionTooLong,
        ),
      lines: z.array(lineSchema).min(MIN_DOCUMENT_LINES, {
        message: t.documents.validation.minLines,
      }),
    })
    .superRefine((values, ctx) => {
      values.lines.forEach((line, index) => {
        const account =
          line.accountId === '' ? undefined : accountById(line.accountId);
        if (account === undefined) return;
        if (account.detailGroupId !== null && line.detailId === '') {
          ctx.addIssue({
            code: 'custom',
            path: ['lines', index, 'detailId'],
            message: t.documents.validation.detailRequired,
          });
        }
      });
    });
}
