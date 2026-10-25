import { z } from 'zod';
import { t } from '@/lib/i18n';

/**
 * Shared financial-area form schema (ACC-01).
 *
 * One source of truth for BOTH financial-area creation surfaces: the
 * empty-context bootstrap form (`financial-area-create-form.tsx`) and the
 * accounting administration create/edit page
 * (`financial-area-form-page.tsx`). The limits mirror the backend DTO
 * exactly — `MAX_CODE_LENGTH = 64`, `MAX_TITLE_LENGTH = 200`
 * (`backend/src/modules/accounting/domain/master-data.ts`,
 * `api/dto/financial-area.dto.ts`) — nothing stricter and nothing looser:
 * client-side UX feedback only (AR-21); the backend re-validates,
 * re-authorizes and owns uniqueness/default rules regardless.
 */

export const MAX_FINANCIAL_AREA_CODE_LENGTH = 64;
export const MAX_FINANCIAL_AREA_TITLE_LENGTH = 200;

export const financialAreaSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, t.financialArea.codeRequired)
    .max(MAX_FINANCIAL_AREA_CODE_LENGTH, t.financialArea.codeTooLong),
  title: z
    .string()
    .trim()
    .min(1, t.financialArea.titleRequired)
    .max(MAX_FINANCIAL_AREA_TITLE_LENGTH, t.financialArea.titleTooLong),
});

export type FinancialAreaFormValues = z.infer<typeof financialAreaSchema>;
