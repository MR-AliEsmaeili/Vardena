import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isBusinessDateInput } from '../datetime/business-date-input.js';

/**
 * Validates that a value is a well-formed BUSINESS DATE input (C-63 §16,
 * ADR-0042): the canonical `YYYY-MM-DD` day, a full ISO-8601 instant (the
 * legacy shape these fields carried), or an explicitly declared
 * `{ calendar, value }` day.
 *
 * Kernel copy, exactly like {@link IsUlid}: the shape rule lives in
 * `kernel/datetime`, so every module's transport layer shares ONE definition
 * and no module (Inventory, Accounting, the next consumer) implements its own
 * Jalali parser.
 *
 * Shape-only: whether the day actually exists in the declared calendar is
 * decided by `parseBusinessDateInput` in the application layer, which can
 * report the precise reason (`business_date_calendar` — "30 Esfand does not
 * exist this year" — versus a format error).
 */
export function IsBusinessDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isBusinessDate',
      target: object.constructor,
      propertyName: propertyName as string,
      // `exactOptionalPropertyTypes`: only pass `options` when provided.
      ...(validationOptions === undefined
        ? {}
        : { options: validationOptions }),
      validator: {
        validate: (value: unknown): boolean => isBusinessDateInput(value),
        defaultMessage: (): string =>
          'Value must be a business date: "YYYY-MM-DD", an ISO-8601 instant, ' +
          'or { calendar, value } declaring GREGORIAN or JALALI.',
      },
    });
  };
}
