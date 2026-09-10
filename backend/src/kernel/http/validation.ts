import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { AppException, type ValidationIssue } from '../errors/app-exception.js';

/**
 * Global request validation (AR-24, security.md section 5).
 *
 * - `whitelist` + `forbidNonWhitelisted`: unknown fields are rejected on
 *   every endpoint (write AND read paths) — typos and mass-assignment
 *   probes fail closed with `ValidationFailed`.
 * - `transform`: payloads are converted to their DTO classes so `@Type()`
 *   coercions (query-string numbers, nested DTOs) apply. Implicit
 *   conversion stays OFF: DTOs must declare `@Type(() => Number)` etc.
 * - Failures throw `AppException.validation()` with flattened issues.
 */

/** Flatten class-validator errors to dotted-path `ValidationIssue[]`. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const error of errors) {
    const field =
      parent === '' ? error.property : `${parent}.${error.property}`;
    if (error.constraints !== undefined) {
      for (const [code, message] of Object.entries(error.constraints)) {
        issues.push({ field, code, message });
      }
    }
    if (error.children !== undefined && error.children.length > 0) {
      issues.push(...flattenValidationErrors(error.children, field));
    }
  }
  return issues;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      AppException.validation(flattenValidationErrors(errors)),
  });
}
