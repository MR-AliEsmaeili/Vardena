import { z } from 'zod';
import type {
  CreateMaterialRequestInput,
  MaterialRequestLineInput,
  UpdateMaterialRequestInput,
} from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * Client feedback mirrors `MaterialRequestLineInputDto`; the server remains
 * authoritative. `quantity` is a STRING all the way to the wire — never parsed,
 * never rounded (standards.md §7).
 */
const QUANTITY_PATTERN = /^\d+\.?\d{0,4}$/;
const QUANTITY_LENGTH = 32;
const DESCRIPTION_MAX_LENGTH = 1000;

export const materialRequestLineSchema = z.object({
  itemId: z.string().min(1, t.materialRequests.itemRequired),
  warehouseId: z.string().min(1, t.materialRequests.warehouseRequired),
  quantity: z
    .string()
    .min(1, t.materialRequests.quantityRequired)
    .max(QUANTITY_LENGTH, t.materialRequests.quantityInvalid)
    .regex(QUANTITY_PATTERN, t.materialRequests.quantityInvalid)
    .refine(
      (value) => !/^0+(?:\.0+)?$/.test(value),
      t.materialRequests.quantityInvalid,
    ),
  unitId: z.string().min(1, t.materialRequests.unitRequired),
  reservationRequested: z.boolean(),
});

export const materialRequestFormSchema = z.object({
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, t.materialRequests.descriptionTooLong),
  lines: z
    .array(materialRequestLineSchema)
    .min(1, t.materialRequests.atLeastOneLine),
});

export type MaterialRequestLineValues = z.infer<
  typeof materialRequestLineSchema
>;
export type MaterialRequestFormValues = z.infer<
  typeof materialRequestFormSchema
>;

/** One empty line; the item/unit pickers stay empty until chosen. */
export function emptyMaterialRequestLine(): MaterialRequestLineValues {
  return {
    itemId: '',
    warehouseId: '',
    quantity: '',
    unitId: '',
    reservationRequested: false,
  };
}

export function toMaterialRequestLineInputs(
  values: MaterialRequestFormValues,
): MaterialRequestLineInput[] {
  return values.lines.map((line) => ({
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    quantity: line.quantity,
    unitId: line.unitId,
    reservationRequested: line.reservationRequested,
  }));
}

function normalizedDescription(values: MaterialRequestFormValues): string {
  return values.description.trim();
}

/** `POST` body: an empty description is simply omitted (the DTO is optional). */
export function toCreateMaterialRequestInput(
  organizationId: string,
  values: MaterialRequestFormValues,
): CreateMaterialRequestInput {
  const description = normalizedDescription(values);
  return {
    organizationId,
    ...(description !== '' ? { description } : {}),
    lines: toMaterialRequestLineInputs(values),
  };
}

/**
 * `PATCH` body: `lines` is sent WHOLESALE (the backend replaces the set), and
 * an emptied description is sent as `null` so clearing it is a real edit.
 */
export function toUpdateMaterialRequestInput(
  values: MaterialRequestFormValues,
): UpdateMaterialRequestInput {
  const description = normalizedDescription(values);
  return {
    description: description === '' ? null : description,
    lines: toMaterialRequestLineInputs(values),
  };
}
