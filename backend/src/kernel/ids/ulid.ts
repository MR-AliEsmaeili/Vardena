import { ulid } from 'ulid';

/**
 * Kernel ID utilities (ADR-0008: ULIDs are the identity scheme).
 *
 * ULIDs are 26-char Crockford-Base32 strings, lexicographically sortable by
 * creation time. Generated in the application layer — never as DB defaults —
 * so ids are consistent across the API and the worker.
 */

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** Generate a new random ULID. */
export function generateId(): string {
  return ulid();
}

/** True when `value` is a well-formed ULID (case-insensitive). */
export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}
