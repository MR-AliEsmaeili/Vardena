import { ApiProperty } from '@nestjs/swagger';
import { CALENDAR_SYSTEMS } from './calendar-system.js';

/**
 * OpenAPI classes for the standardized date/time representations (C-63 §10/§11,
 * ADR-0042).
 *
 * They live in the kernel for the same reason {@link IsUlid} does: every module
 * that exposes a derived calendar rendering reuses ONE documented schema
 * instead of re-declaring the shape (AR-06: technical DTO primitives, no
 * business rules). A module annotates its field with `type: ApiInstantDto` and
 * the shape is named, typed and stable in the generated frontend types.
 *
 * The `*Dto` classes are the transport declaration of the interfaces in
 * `api-date-time.ts`; the application layer builds the values with
 * `toApiBusinessDate` / `toApiInstant`, never by hand.
 */

/** `{ gregorian, jalali }` — canonical day and its nullable Jalali rendering. */
export class ApiBusinessDateDto {
  @ApiProperty({
    format: 'date',
    example: '2026-10-08',
    description: 'Canonical business day (Gregorian). Authoritative.',
  })
  gregorian!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '1405-07-16',
    nullable: true,
    description:
      'The same day in the Jalali calendar when representable; null outside the supported Jalali rendering range.',
  })
  jalali!: string | null;
}

/** `{ instant, timeZone, gregorian, jalali }` — an event timestamp. */
export class ApiInstantDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-10-08T08:32:14.421Z',
    description: 'The authoritative instant, ISO-8601 UTC. Never derived.',
  })
  instant!: string;

  @ApiProperty({
    example: 'Asia/Tehran',
    description: 'IANA zone the two renderings below were resolved in.',
  })
  timeZone!: string;

  @ApiProperty({
    example: '2026-10-08 12:02:14',
    description: 'Local Gregorian rendering, `YYYY-MM-DD HH:mm:ss`.',
  })
  gregorian!: string;

  @ApiProperty({
    type: String,
    example: '1405-07-16 12:02:14',
    nullable: true,
    description:
      'Local Jalali rendering, `YYYY-MM-DD HH:mm:ss` (derived), or null outside the supported conversion range.',
  })
  jalali!: string | null;
}

/**
 * The declared-calendar form of a business-date INPUT:
 * `{ "calendar": "JALALI", "value": "1405-07-16" }`.
 *
 * A separate class (not an inline object) so the OpenAPI document carries the
 * closed calendar vocabulary and the exact two-field shape — a client cannot
 * smuggle extra keys or an unknown calendar past validation.
 */
export class DeclaredBusinessDateInputDto {
  @ApiProperty({
    enum: CALENDAR_SYSTEMS,
    description:
      'The calendar `value` is written in. Required because `1405-07-16` and `2026-10-08` are the same shape.',
  })
  calendar!: string;

  @ApiProperty({
    example: '1405-07-16',
    description: 'The day in `calendar`, `YYYY-MM-DD`.',
  })
  value!: string;
}

/**
 * Optional `calendar`/`value` documentation helper for a field that accepts
 * both forms. Exported so a module's `@ApiPropertyOptional` can point at the
 * declared form without re-declaring it.
 */
export const DECLARED_BUSINESS_DATE_SCHEMA = {
  type: 'object' as const,
  properties: {
    calendar: { type: 'string' as const, enum: [...CALENDAR_SYSTEMS] },
    value: { type: 'string' as const, example: '1405-07-16' },
  },
  required: ['calendar', 'value'],
  additionalProperties: false as const,
};

/**
 * Legacy timestamp form accepted only for compatibility on BusinessDate
 * inputs. The parser resolves this value to its UTC calendar day, matching
 * the OQ-73 migration policy; it is never stored as an Instant.
 */
export const LEGACY_BUSINESS_DATE_INSTANT_SCHEMA = {
  type: 'string' as const,
  format: 'date-time' as const,
  example: '2026-10-08T21:30:00.000Z',
  description:
    'Legacy ISO-8601 instant accepted for compatibility; its UTC calendar day is used as the BusinessDate.',
};
