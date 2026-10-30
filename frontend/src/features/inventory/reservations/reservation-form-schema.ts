import { z } from 'zod';
import { t } from '@/lib/i18n';
import { MATERIAL_REQUEST_LINE_RESERVATION_REFERENCE_TYPE } from './reservation-reference';
import { hasCompleteReservationReference } from './reference-pair';

const QUANTITY_PATTERN = /^\d+(\.\d{1,4})?$/;

/** Client feedback mirrors the write DTO; the server remains authoritative. */
export const reservationFormSchema = z
  .object({
    warehouseId: z.string().min(1, t.reservations.warehouseRequired),
    itemId: z.string().min(1, t.reservations.itemRequired),
    quantity: z
      .string()
      .min(1, t.reservations.quantityRequired)
      .max(32, t.reservations.quantityInvalid)
      .regex(QUANTITY_PATTERN, t.reservations.quantityInvalid)
      .refine(
        (value) => !/^0+(?:\.0+)?$/.test(value),
        t.reservations.quantityInvalid,
      ),
    unitId: z.string().min(1, t.reservations.unitRequired),
    reason: z.string().max(500, t.reservations.reasonTooLong),
    referenceType: z.string().max(64, t.reservations.referenceTooLong),
    referenceId: z.string().max(128, t.reservations.referenceTooLong),
  })
  .refine(
    (values) =>
      hasCompleteReservationReference(values.referenceType, values.referenceId),
    {
      message: t.reservations.referencePairHint,
      path: ['referenceId'],
    },
  )
  .refine(
    (values) =>
      values.referenceType.trim() !==
      MATERIAL_REQUEST_LINE_RESERVATION_REFERENCE_TYPE,
    {
      message: t.reservations.materialRequestReferenceReserved,
      path: ['referenceType'],
    },
  );

export type ReservationFormValues = z.infer<typeof reservationFormSchema>;
