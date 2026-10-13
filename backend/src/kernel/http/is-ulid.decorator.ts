import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isUlid } from '../ids/ulid.js';

/**
 * Validates that a value is a well-formed ULID — the project's id format
 * (ADR-0008). This is the kernel copy of the decorator: the format check
 * itself lives in `kernel/ids`, so there is exactly one definition of
 * "valid id", and `kernel/` is allowed to hold technical DTO primitives
 * (AR-06).
 *
 * New modules use this copy instead of importing a decorator out of another
 * module's `api/` folder, which would couple two modules' transport layers
 * (AR-07). `modules/rbac/api/dto/is-ulid.decorator.ts` predates it and is
 * left untouched (no drive-by refactoring, AG-03); consolidating the two is
 * a separate, deliberate change.
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
