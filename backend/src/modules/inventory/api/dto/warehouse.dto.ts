import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { MAX_CODE_LENGTH, MAX_NAME_LENGTH } from '../../domain/master-data.js';

/**
 * Warehouse API contracts (master-data-strategy.md §4, ADR-0020 §1).
 *
 * A warehouse is master data here: a named stock location belonging to a
 * branch. No locations, zones, stock balances, movements or reservations —
 * those belong to the future Inventory transactional work (ADR-0017, OQ-24).
 */

export class CreateWarehouseDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    format: 'ulid',
    description:
      'Branch this warehouse belongs to. Must be in the same organization and enabled.',
  })
  @IsUlid()
  branchId!: string;

  @ApiProperty({ example: 'WH-TEH-01', maxLength: MAX_CODE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Tehran central warehouse',
    maxLength: MAX_NAME_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Default negative-stock policy for this warehouse (ADR-0022). An item-level override takes precedence.',
  })
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @ApiPropertyOptional({
    default: true,
    description:
      'Whether ACTIVE reservations reduce the read-time "available" figure for this warehouse (C-50 §3.7). Reservations never change on-hand stock regardless of this setting.',
  })
  @IsOptional()
  @IsBoolean()
  reservationsReduceAvailable?: boolean;
}

export class UpdateWarehouseDto {
  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'Move the warehouse to another branch of the same organization.',
  })
  @IsOptional()
  @IsUlid()
  branchId?: string;

  @ApiPropertyOptional({ maxLength: MAX_CODE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Code cannot be blank.' })
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name cannot be blank.' })
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Default negative-stock policy for this warehouse (ADR-0022). An item-level override takes precedence.',
  })
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether ACTIVE reservations reduce the read-time "available" figure for this warehouse (C-50 §3.7).',
  })
  @IsOptional()
  @IsBoolean()
  reservationsReduceAvailable?: boolean;
}

export class ListWarehousesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  branchId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code or name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class WarehouseResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  branchId!: string;

  @ApiProperty({ example: 'WH-TEH-01' })
  code!: string;

  @ApiProperty({ example: 'Tehran central warehouse' })
  name!: string;

  @ApiProperty({
    description:
      'Default negative-stock policy for this warehouse; an item-level override takes precedence (ADR-0022).',
  })
  allowNegativeStock!: boolean;

  @ApiProperty({
    description:
      'Whether ACTIVE reservations reduce the read-time "available" figure for this warehouse (C-50 §3.7). Reservations never change on-hand stock regardless of this setting.',
  })
  reservationsReduceAvailable!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
