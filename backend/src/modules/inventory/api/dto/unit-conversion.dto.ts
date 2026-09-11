import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';

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

  @ApiProperty({ format: 'ulid', description: 'Target unit (usually the base unit).' })
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
    format: 'date-time',
    description: 'Instant from which this version applies.',
  })
  @Type(() => Date)
  @IsDate({ message: 'validFrom must be an ISO-8601 date-time.' })
  validFrom!: Date;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Usually omitted (open-ended). A new open-ended version closes the previous one automatically.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'validTo must be an ISO-8601 date-time.' })
  validTo?: Date;
}

export class ListUnitConversionsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    enum: CONVERSION_SCOPES,
    default: 'global',
    description:
      '`global` lists organization-wide unit-pair conversions; `item` lists one item\'s conversions and requires `itemId`.',
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
    format: 'date-time',
    description: 'Only versions in force at this instant.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'activeAt must be an ISO-8601 date-time.' })
  activeAt?: Date;
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

  @ApiProperty({ format: 'date-time' })
  validFrom!: string;

  @ApiProperty({
    format: 'date-time',
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

/** Query for the "which version applies at instant X" read. */
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
    format: 'date-time',
    description:
      'The instant to resolve at. A past date returns the version that was in force then.',
  })
  @Type(() => Date)
  @IsDate({ message: 'asOf must be an ISO-8601 date-time.' })
  asOf!: Date;
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
