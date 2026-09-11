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
import {
  MAX_UNIT_CODE_LENGTH,
  MAX_UNIT_NAME_LENGTH,
  MAX_UNIT_SYMBOL_LENGTH,
} from '../../domain/master-data.js';

/**
 * Unit API contracts.
 *
 * Units are organization-scoped master data; the list requires
 * `organizationId`, so no endpoint returns units across organizations. There is
 * deliberately no per-unit precision field — it is expert-gated and unresolved
 * (OQ-29).
 */

export class CreateUnitDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ example: 'PCS', maxLength: MAX_UNIT_CODE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_UNIT_CODE_LENGTH)
  code!: string;

  @ApiProperty({ example: 'Piece', maxLength: MAX_UNIT_NAME_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_UNIT_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({ example: 'pc', maxLength: MAX_UNIT_SYMBOL_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UNIT_SYMBOL_LENGTH)
  symbol?: string;
}

export class UpdateUnitDto {
  @ApiPropertyOptional({ maxLength: MAX_UNIT_CODE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Code cannot be blank.' })
  @MaxLength(MAX_UNIT_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: MAX_UNIT_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name cannot be blank.' })
  @MaxLength(MAX_UNIT_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: MAX_UNIT_SYMBOL_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UNIT_SYMBOL_LENGTH)
  symbol?: string;
}

export class ListUnitsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

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

export class UnitResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'PCS' })
  code!: string;

  @ApiProperty({ example: 'Piece' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'pc' })
  symbol!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
