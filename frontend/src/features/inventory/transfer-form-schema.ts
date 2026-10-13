import { z } from 'zod';
import { isBusinessDay } from '@/lib/datetime';
import { t } from '@/lib/i18n';

/**
 * Transfer form schema — the two-leg warehouse-to-warehouse operation.
 *
 * Contract mirror of `PostInventoryTransferDto`: same quantity/unit/date
 * rules as the movement form, plus source ≠ destination. There is NO cost
 * field (OD-TRF-06) and — until the recorded UI follow-up — no backdate
 * confirmation step: the backend answers a backdated transfer with the shared
 * refusal (`inventory.backdated_document`, C-59C) and the form renders that
 * as a business error.
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
      .refine(
        (value) => value === '' || isBusinessDay(value),
        t.filters.invalidDate,
      ),
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
