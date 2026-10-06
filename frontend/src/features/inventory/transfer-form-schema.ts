import { z } from 'zod';
import { t } from '@/lib/i18n';

/**
 * Transfer form schema — the two-leg warehouse-to-warehouse operation.
 *
 * Contract mirror of `PostInventoryTransferDto`: same quantity/unit/date
 * rules as the movement form, plus source ≠ destination. There is NO cost
 * field and NO backdate confirmation here: a backdated transfer is rejected
 * outright by the backend (`inventory.backdated_transfer_valuation_unresolved`,
 * OQ-67 open) and the form renders that refusal as a business error.
 */

const QUANTITY_PATTERN = /^\d+(\.\d{1,4})?$/;

export const transferFormSchema = z
  .object({
    sourceWarehouseId: z.string().min(1, t.inventory.sourceWarehouseRequired),
    destinationWarehouseId: z
      .string()
      .min(1, t.inventory.destinationWarehouseRequired),
    itemId: z.string().min(1, t.inventory.itemRequired),
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
  })
  .refine(
    (values) =>
      values.sourceWarehouseId === '' ||
      values.destinationWarehouseId === '' ||
      values.sourceWarehouseId !== values.destinationWarehouseId,
    {
      message: t.inventory.destinationMustDiffer,
      path: ['destinationWarehouseId'],
    },
  );

export type TransferFormValues = z.infer<typeof transferFormSchema>;
