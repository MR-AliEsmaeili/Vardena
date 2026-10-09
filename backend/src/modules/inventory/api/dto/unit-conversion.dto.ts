import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { IsBusinessDate } from '../../../../kernel/http/is-business-date.decorator.js';
import { IsBusinessDay } from '../../../../kernel/http/is-business-day.decorator.js';
import {
  DECLARED_BUSINESS_DATE_SCHEMA,
  LEGACY_BUSINESS_DATE_INSTANT_SCHEMA,
} from '../../../../kernel/datetime/api-date-time.dto.js';
import type { BusinessDateInput } from '../../../../kernel/datetime/business-date-input.js';

/**
 * Unit conversion API contracts (D-26, master-data-strategy.md §3.4, OQ-29).
 *
 * There is **no update DTO and no PATCH endpoint**: conversions are
 * effective-dated configuration and used configuration is never edited in place
 * (ADR-0020 §4). Changing a conversion means creating a new version, which
 * closes the previous one.
 *
 * `factor` is a decimal **string**, never a JSON number, so a value such as
 * `0.000001` or `12.5` is transmitted without binary floating-point drift.
 * There is no rounding field: fractional-conversion rounding is expert-gated
 * and unresolved (OQ-29).
 */

export const CONVERSION_SCOPES = ['global', 'item'] as const;

export type ConversionScope = (typeof CONVERSION_SCOPES)[number];

export class CreateUnitConversionDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'Set for an item-specific conversion (e.g. `1 BOX of THIS item = 12 PCS`); omit for a global unit-pair conversion.',
  })
  @IsOptional()
  @IsUlid()
  itemId?: string;

  @ApiProperty({ format: 'ulid', description: 'Source unit.' })
  @IsUlid()
  fromUnitId!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'Target unit (usually the base unit).',
  })
  @IsUlid()
  toUnitId!: string;

  @ApiProperty({
    example: '12',
    description:
      'Positive decimal factor, at most 6 decimal places, as a string.',
  })
  @IsString()
  @MaxLength(20)
  factor!: string;

  @ApiProperty({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-10-08' },
      LEGACY_BUSINESS_DATE_INSTANT_SCHEMA,
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      'Business date on which this version becomes effective. Gregorian dates use YYYY-MM-DD; declare { calendar, value } for a Jalali date. A legacy ISO instant resolves to its UTC calendar day.',
  })
  @IsBusinessDate()
  validFrom!: BusinessDateInput;

  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-10-08' },
      LEGACY_BUSINESS_DATE_INSTANT_SCHEMA,
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      'Exclusive business-date end (open-ended when omitted); legacy ISO instants resolve by UTC calendar day. A new open-ended version closes the previous one automatically.',
  })
  @IsOptional()
  @IsBusinessDate()
  validTo?: BusinessDateInput;
}

export class ListUnitConversionsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    enum: CONVERSION_SCOPES,
    default: 'global',
    description:
      "`global` lists organization-wide unit-pair conversions; `item` lists one item's conversions and requires `itemId`.",
  })
  @IsIn(CONVERSION_SCOPES as readonly string[])
  scope!: ConversionScope;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Required when `scope` is `item`.',
  })
  @IsOptional()
  @IsUlid()
  itemId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  fromUnitId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  toUnitId?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description: 'Only versions in force on this Gregorian business date.',
  })
  @IsOptional()
  @IsBusinessDay()
  activeAt?: string;
}

export class UnitConversionResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description: 'Null for a global conversion.',
  })
  itemId!: string | null;

  @ApiProperty({ format: 'ulid' })
  fromUnitId!: string;

  @ApiProperty({ format: 'ulid' })
  toUnitId!: string;

  @ApiProperty({ example: '12', description: 'Decimal string.' })
  factor!: string;

  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiProperty({
    format: 'date',
    nullable: true,
    description:
      'Null while this is the current version; set when a later version superseded it.',
  })
  validTo!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** Query for the version effective on business date X. */
export class ResolveUnitConversionQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'When set, an item-specific version is preferred over a global one for the same unit pair.',
  })
  @IsOptional()
  @IsUlid()
  itemId?: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  fromUnitId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  toUnitId!: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-08',
    description:
      'Canonical Gregorian business date. A past date returns the version that was effective then.',
  })
  @IsBusinessDay()
  asOf!: string;
}

export class ResolveUnitConversionResponseDto {
  @ApiPropertyOptional({
    type: () => UnitConversionResponseDto,
    nullable: true,
    description:
      'Null when no version covers `asOf`. Callers must not assume a 1:1 factor in that case.',
  })
  conversion!: UnitConversionResponseDto | null;
}
