import { z } from 'zod';
import { t } from '@/lib/i18n';
import type { InventoryDocumentKind } from '@/api/contracts';

/**
 * Business-document form schema — the client-side mirror of
 * `CreateInventoryDocumentDto` / `UpdateInventoryDocumentDto`.
 *
 * It mirrors the backend rules, it does not own them: every rule here
 * (positive decimal quantities, transfer source ≠ destination, receipt-only
 * cost) is re-enforced server-side, and the server's refusal is authoritative.
 */

const QUANTITY_PATTERN = /^\d+(\.\d{1,4})?$/;
const COST_PATTERN = /^\d+(\.\d{1,2})?$/;

export const documentLineSchema = z.object({
  itemId: z.string().min(1, t.inventoryDocuments.itemRequired),
  quantity: z
    .string()
    .min(1, t.inventoryDocuments.quantityRequired)
    .regex(QUANTITY_PATTERN, t.inventoryDocuments.quantityPositive)
    .refine(
      (value) => !/^0+(?:\.0+)?$/.test(value),
      t.inventoryDocuments.quantityPositive,
    ),
  unitId: z.string().min(1, t.inventoryDocuments.unitRequired),
});

export const documentFormSchema = z
  .object({
    kind: z.enum(['receipt', 'issue', 'transfer']),
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, t.filters.invalidDate)
      .or(z.literal('')),
    warehouseId: z.string(),
    sourceWarehouseId: z.string(),
    destinationWarehouseId: z.string(),
    cost: z
      .string()
      .regex(COST_PATTERN, t.inventoryDocuments.costInvalid)
      .refine((value) => !/^0+(?:\.0+)?$/.test(value), {
        message: t.inventoryDocuments.costInvalid,
      })
      .or(z.literal('')),
    description: z.string().max(500),
    reference: z.string().max(200),
    lines: z
      .array(documentLineSchema)
      .min(1, t.inventoryDocuments.linesRequired),
  })
  .superRefine((values, context) => {
    if (values.kind === 'transfer') {
      if (values.sourceWarehouseId === '') {
        context.addIssue({
          code: 'custom',
          path: ['sourceWarehouseId'],
          message: t.inventoryDocuments.sourceWarehouseRequired,
        });
      }
      if (values.destinationWarehouseId === '') {
        context.addIssue({
          code: 'custom',
          path: ['destinationWarehouseId'],
          message: t.inventoryDocuments.destinationWarehouseRequired,
        });
      }
      if (
        values.sourceWarehouseId !== '' &&
        values.sourceWarehouseId === values.destinationWarehouseId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['destinationWarehouseId'],
          message: t.inventoryDocuments.sameWarehouse,
        });
      }
      return;
    }

    if (values.warehouseId === '') {
      context.addIssue({
        code: 'custom',
        path: ['warehouseId'],
        message: t.inventoryDocuments.warehouseRequired,
      });
    }
    // A cost is a RECEIPT valuation assignment only, and only for a single
    // line — the backend refuses to apportion one amount across many.
    if (values.cost !== '') {
      if (values.kind !== 'receipt') {
        context.addIssue({
          code: 'custom',
          path: ['cost'],
          message: t.inventoryDocuments.issueNoCost,
        });
      } else if (values.lines.length > 1) {
        context.addIssue({
          code: 'custom',
          path: ['cost'],
          message: t.inventoryDocuments.costMultiLineDisabled,
        });
      }
    }
  });

export type DocumentFormValues = z.infer<typeof documentFormSchema>;

/** A blank form for one kind, dated today (the backend's own default). */
export function emptyDocumentForm(
  kind: InventoryDocumentKind,
): DocumentFormValues {
  return {
    kind,
    businessDate: new Date().toLocaleDateString('en-CA'),
    warehouseId: '',
    sourceWarehouseId: '',
    destinationWarehouseId: '',
    cost: '',
    description: '',
    reference: '',
    lines: [{ itemId: '', quantity: '', unitId: '' }],
  };
}
