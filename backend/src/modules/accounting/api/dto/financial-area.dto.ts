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
  MAX_CODE_LENGTH,
  MAX_TITLE_LENGTH,
} from '../../domain/master-data.js';

/**
 * Financial area API contracts (contract §5).
 *
 * `organizationId` is required on the list and on every by-id scope: there
 * is no endpoint that returns areas across organizations, which is the
 * structural half of organization isolation (AC-D-01).
 */

export class CreateFinancialAreaDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    example: 'MAIN',
    maxLength: MAX_CODE_LENGTH,
    description: 'Business code, unique within the organization.',
  })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Main books',
    maxLength: MAX_TITLE_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;
}

export class UpdateFinancialAreaDto {
  @ApiPropertyOptional({ maxLength: MAX_CODE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Code cannot be blank.' })
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: MAX_TITLE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Title cannot be blank.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    description:
      'Flag this area as the organization default (clears the previous default).',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ListFinancialAreasQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code or title.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class FinancialAreaResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'MAIN' })
  code!: string;

  @ApiProperty({ example: 'Main books' })
  title!: string;

  @ApiProperty({ description: 'Whether this is the organization default.' })
  isDefault!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
