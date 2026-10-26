import { z } from 'zod';
import { t } from '@/lib/i18n';

/**
 * Form schemas for inventory master data (React Hook Form + Zod, AR-24).
 *
 * Each schema mirrors the matching backend DTO exactly — the same required
 * fields and the same length limits
 * (`backend/src/modules/inventory/domain/master-data.ts`,
 * `api/dto/*.dto.ts`). Nothing stricter and nothing looser is invented here:
 * this is client-side UX feedback only (AR-21), and the backend re-validates
 * and re-authorizes every request regardless of what these accept.
 */

export const MAX_CODE_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;
export const MAX_UNIT_CODE_LENGTH = 32;
export const MAX_UNIT_NAME_LENGTH = 120;
export const MAX_UNIT_SYMBOL_LENGTH = 16;
export const MAX_BARCODE_LENGTH = 64;
export const MAX_ITEM_DESCRIPTION_LENGTH = 2000;

// --- Unit -------------------------------------------------------------------

export const unitSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, t.inventoryMaster.codeRequired)
    .max(MAX_UNIT_CODE_LENGTH, t.inventoryMaster.unitCodeTooLong),
  name: z
    .string()
    .trim()
    .min(1, t.inventoryMaster.nameRequired)
    .max(MAX_UNIT_NAME_LENGTH, t.inventoryMaster.unitNameTooLong),
  symbol: z
    .string()
    .trim()
    .max(MAX_UNIT_SYMBOL_LENGTH, t.inventoryMaster.unitSymbolTooLong),
});
export type UnitFormValues = z.infer<typeof unitSchema>;

// --- Item group ---------------------------------------------------------------

export const itemGroupSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, t.inventoryMaster.codeRequired)
    .max(MAX_CODE_LENGTH, t.inventoryMaster.codeTooLong),
  name: z
    .string()
    .trim()
    .min(1, t.inventoryMaster.nameRequired)
    .max(MAX_NAME_LENGTH, t.inventoryMaster.nameTooLong),
  /** `''` = root group (the request then carries `null`). */
  parentId: z.string(),
});
export type ItemGroupFormValues = z.infer<typeof itemGroupSchema>;

// --- Warehouse ---------------------------------------------------------------

export const warehouseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, t.inventoryMaster.codeRequired)
    .max(MAX_CODE_LENGTH, t.inventoryMaster.codeTooLong),
  name: z
    .string()
    .trim()
    .min(1, t.inventoryMaster.nameRequired)
    .max(MAX_NAME_LENGTH, t.inventoryMaster.nameTooLong),
  branchId: z.string().min(1, t.inventoryMaster.branchRequired),
  allowNegativeStock: z.boolean(),
  reservationsReduceAvailable: z.boolean(),
  accountingPostingMode: z.enum(['direct_final', 'draft']),
});
export type WarehouseFormValues = z.infer<typeof warehouseSchema>;

// --- Item -------------------------------------------------------------------

export const ITEM_KINDS = [
  'goods',
  'service',
  'consumable',
  'asset',
  'raw_material',
  'semi_finished',
  'finished_good',
  'other',
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

/** Tri-state override: `null` = follow the warehouse policy (ADR-0022). */
export type NegativeStockOverride = 'follow' | 'allow' | 'forbid';

export const itemSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, t.inventoryMaster.codeRequired)
      .max(MAX_CODE_LENGTH, t.inventoryMaster.codeTooLong),
    name: z
      .string()
      .trim()
      .min(1, t.inventoryMaster.nameRequired)
      .max(MAX_NAME_LENGTH, t.inventoryMaster.nameTooLong),
    description: z
      .string()
      .trim()
      .max(MAX_ITEM_DESCRIPTION_LENGTH, t.inventoryMaster.descriptionTooLong),
    itemKind: z.enum(ITEM_KINDS, {
      message: t.inventoryMaster.itemKindRequired,
    }),
    /** `''` = no group. */
    itemGroupId: z.string(),
    baseUnitId: z.string().min(1, t.inventoryMaster.baseUnitRequired),
    isStockable: z.boolean(),
    isPurchasable: z.boolean(),
    isSellable: z.boolean(),
    isValued: z.boolean(),
    requiresLot: z.boolean(),
    requiresSerial: z.boolean(),
    requiresExpiry: z.boolean(),
    negativeStock: z.enum(['follow', 'allow', 'forbid']),
    barcode: z
      .string()
      .trim()
      .max(MAX_BARCODE_LENGTH, t.inventoryMaster.barcodeTooLong),
  })
  .superRefine((values, ctx) => {
    // Only the client-checkable rules live here; every other rule (unit in
    // the organization, valued⇒stockable at the service layer) arrives as a
    // 409/422 the error mapper renders. These two are form coherence, not
    // domain knowledge: a valued item without stock cannot enter stock.
    if (values.isValued && !values.isStockable) {
      ctx.addIssue({
        code: 'custom',
        path: ['isValued'],
        message: t.inventoryMaster.isValuedHint,
      });
    }
    const trackingSomething =
      values.requiresLot || values.requiresSerial || values.requiresExpiry;
    if (trackingSomething && !values.isStockable) {
      const path = values.requiresLot
        ? 'requiresLot'
        : values.requiresSerial
          ? 'requiresSerial'
          : 'requiresExpiry';
      ctx.addIssue({
        code: 'custom',
        path: [path],
        message: t.inventoryMaster.isStockableHint,
      });
    }
  });
export type ItemFormValues = z.infer<typeof itemSchema>;

// --- Unit conversion ----------------------------------------------------------

const FACTOR_PATTERN = /^\d+(\.\d{1,6})?$/;

export const unitConversionSchema = z
  .object({
    scope: z.enum(['global', 'item']),
    itemId: z.string(),
    fromUnitId: z.string().min(1, t.inventoryMaster.fromUnitRequired),
    toUnitId: z.string().min(1, t.inventoryMaster.toUnitRequired),
    factor: z
      .string()
      .trim()
      .min(1, t.inventoryMaster.factorRequired)
      .regex(FACTOR_PATTERN, t.inventoryMaster.factorInvalid),
    /** Jalali-first shared input: `''` = open-ended. */
    validFrom: z.string().min(1, t.inventoryMaster.validFrom),
    validTo: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.scope === 'item' && values.itemId === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['itemId'],
        message: t.inventoryMaster.conversionItemRequired,
      });
    }
  });
export type UnitConversionFormValues = z.infer<typeof unitConversionSchema>;
