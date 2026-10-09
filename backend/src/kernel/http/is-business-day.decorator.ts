import { registerDecorator, type ValidationOptions } from 'class-validator';
import { BUSINESS_DATE_PATTERN } from '../datetime/business-date.js';

/**
 * Validates that a string is a canonical business-DAY value (OQ-73,
 * ADR-0042 §2): `YYYY-MM-DD`, nothing more — no time part, no zone, no
 * `T00:00:00.000Z` tail. This is the shape business-date FILTERS travel in
 * (query parameters), where a declared `{ calendar, value }` object is not an
 * option; the write-path input contract ({@link IsBusinessDate}) additionally
 * accepts a declared Jalali day and the legacy ISO instant.
 *
 * Shape-only, exactly like {@link IsBusinessDate}: whether the day actually
 * exists is decided by the application layer, which reports the precise
 * reason (`business_date_calendar`).
 */
export function IsBusinessDay(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isBusinessDay',
      target: object.constructor,
      propertyName: propertyName as string,
      // `exactOptionalPropertyTypes`: only pass `options` when provided.
      ...(validationOptions === undefined
        ? {}
        : { options: validationOptions }),
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === 'string' && BUSINESS_DATE_PATTERN.test(value),
        defaultMessage: (): string =>
          'Value must be a Gregorian business day: YYYY-MM-DD.',
      },
    });
  };
}
