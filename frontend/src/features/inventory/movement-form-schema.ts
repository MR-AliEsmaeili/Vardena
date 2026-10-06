import { z } from 'zod';
import { t } from '@/lib/i18n';

/**
 * Movement form schema — a receipt (inbound) or an issue (outbound).
 *
 * Contract mirror of `PostInventoryMovementDto`:
 * - `quantity` is a POSITIVE decimal string (max `numeric(18,4)` scale — 4
 *   fractional digits), never a float;
 * - `movementDate` is optional (backend defaults to now) and, when present,
 *   a `YYYY-MM-DD` day sent as that day's UTC midnight instant;
 * - `totalCost` is OPTIONAL: a warehouse receipt posts without any cost
 *   (OD-VAL-05) and the field is only rendered for sessions holding
 *   `Inventory.Valuation.AssignCost`; an issue NEVER carries one (OD-VAL-07
 *   — the schema has no cost field for issues at all).
 */

import type { SinglePostMovementType } from '@/api/contracts';

export type MovementFormKind = 'receipt' | 'issue';

export const MOVEMENT_FORM_KINDS: readonly MovementFormKind[] = [
  'receipt',
  'issue',
];

const QUANTITY_PATTERN = /^\d+(\.\d{1,4})?$/;

const movementBaseSchema = z.object({
  itemId: z.string().min(1, t.inventory.itemRequired),
  warehouseId: z.string().min(1, t.inventory.warehouseRequired),
  quantity: z
    .string()
    .min(1, t.inventory.quantityRequired)
    .regex(QUANTITY_PATTERN, t.inventory.quantityPositive)
    .refine(
      (value) => value !== '0' && !/^0+(?:\.0+)?$/.test(value),
      t.inventory.quantityPositive,
    ),
  unitId: z.string().min(1, t.inventory.unitRequired),
  movementDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, t.filters.invalidDate)
    .or(z.literal('')),
  reason: z.string().max(500),
});

export const receiptFormSchema = movementBaseSchema.extend({
  totalCost: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, t.inventory.totalCostInvalid)
    .refine((value) => !/^0+(?:\.0+)?$/.test(value), {
      message: t.inventory.totalCostInvalid,
    })
    .or(z.literal('')),
});

export const issueFormSchema = movementBaseSchema;

export type ReceiptFormValues = z.infer<typeof receiptFormSchema>;
export type IssueFormValues = z.infer<typeof issueFormSchema>;

/** Movement type the backend expects for each form kind. */
export function movementTypeForKind(
  kind: MovementFormKind,
): SinglePostMovementType {
  return kind === 'receipt' ? 'inbound' : 'outbound';
}
