import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_CODE_LENGTH,
  MAX_REASON_LENGTH,
  MAX_TITLE_LENGTH,
} from '../../domain/master-data.js';
import { DATE_ONLY_PATTERN } from '../../domain/date-range.js';
import {
  FISCAL_YEAR_STATUSES,
  type FiscalYearStatus,
} from '../../domain/fiscal-year.js';

/**
 * Fiscal year API contracts (contract §6).
 *
 * Dates are date-only `YYYY-MM-DD` strings (inclusive bounds). The DTO
 * validates the SHAPE; calendar validity (`2026-02-30` does not exist) and
 * range meaning (end on/after start, no overlap) are validated by the
 * service and domain layers.
 */

export class CreateFiscalYearDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid', description: 'Owning financial area.' })
  @IsUlid()
  financialAreaId!: string;

  @ApiProperty({
    example: 'FY-1405',
    maxLength: MAX_CODE_LENGTH,
    description: 'Business code, unique within the financial area.',
  })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Fiscal year 1405',
    maxLength: MAX_TITLE_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiProperty({
    example: '2026-03-21',
    description: 'Inclusive start date (YYYY-MM-DD).',
  })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'startDate must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  startDate!: string;

  @ApiProperty({
    example: '2027-03-20',
    description: 'Inclusive end date (YYYY-MM-DD).',
  })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'endDate must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  endDate!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'Previous year of the same financial area (the transition chain).',
  })
  @IsOptional()
  @IsUlid()
  priorYearId?: string | null;
}

export class UpdateFiscalYearDto {
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

  @ApiPropertyOptional({ description: 'Inclusive start date (YYYY-MM-DD).' })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'startDate must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  startDate?: string;

  @ApiPropertyOptional({ description: 'Inclusive end date (YYYY-MM-DD).' })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'endDate must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  endDate?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'Set, replace, or (null) clear the prior-year link. Must belong to the same financial area.',
  })
  @IsOptional()
  @IsUlid()
  priorYearId?: string | null;
}

export class TransitionFiscalYearDto {
  @ApiProperty({
    maxLength: MAX_REASON_LENGTH,
    description:
      'Mandatory reason for the lifecycle operation (audit evidence).',
  })
  @IsString()
  @MinLength(1, { message: 'Reason is required.' })
  @MaxLength(MAX_REASON_LENGTH)
  reason!: string;
}

export class ListFiscalYearsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;

  @ApiPropertyOptional({ enum: FISCAL_YEAR_STATUSES })
  @IsOptional()
  @IsIn([...FISCAL_YEAR_STATUSES])
  status?: FiscalYearStatus;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code or title.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class FiscalYearResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  financialAreaId!: string;

  @ApiProperty({ example: 'FY-1405' })
  code!: string;

  @ApiProperty({ example: 'Fiscal year 1405' })
  title!: string;

  @ApiProperty({ example: '2026-03-21', description: 'YYYY-MM-DD.' })
  startDate!: string;

  @ApiProperty({ example: '2027-03-20', description: 'YYYY-MM-DD.' })
  endDate!: string;

  @ApiProperty({ enum: FISCAL_YEAR_STATUSES })
  status!: FiscalYearStatus;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'ulid', nullable: true })
  priorYearId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
