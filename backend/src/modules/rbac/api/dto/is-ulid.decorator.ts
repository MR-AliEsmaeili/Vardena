import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isUlid } from '../../../../kernel/ids/ulid.js';

/**
 * Validates that a value is a well-formed ULID (the project's id format,
 * ADR-0008). The format check itself lives in the kernel (`kernel/ids`) so
 * there is exactly one definition of "valid id".
 *
 * A malformed id is a validation error (400), not a 404: the client sent
 * something that cannot be an id at all.
 */
export function IsUlid(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isUlid',
      target: object.constructor,
      propertyName: propertyName as string,
      // `exactOptionalPropertyTypes`: only pass `options` when provided.
      ...(validationOptions === undefined
        ? {}
        : { options: validationOptions }),
      validator: {
        validate: (value: unknown): boolean => isUlid(value),
        defaultMessage: (): string => 'Value must be a valid ULID.',
      },
    });
  };
}
