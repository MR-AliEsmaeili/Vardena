import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { IsBusinessDate } from '../../../../kernel/http/is-business-date.decorator.js';
import { DECLARED_BUSINESS_DATE_SCHEMA } from '../../../../kernel/datetime/api-date-time.dto.js';
import type { BusinessDateInput } from '../../../../kernel/datetime/business-date-input.js';
import {
  MAX_REASON_LENGTH,
  MAX_TITLE_LENGTH,
} from '../../domain/master-data.js';
import {
  ACCOUNTING_PERIOD_KINDS,
  ACCOUNTING_PERIOD_STATUSES,
  type AccountingPeriodKind,
  type AccountingPeriodStatus,
} from '../../domain/accounting-period.js';

/**
 * Accounting period API contracts (contract §7).
 *
 * Opening a period IS creating it (the row is born `open`). There is no
 * update contract: periods have no `Edit` code (contract §22), so after
 * opening only the lifecycle moves (`close`, `reopen`, `seal`) apply.
 */

export class CreateAccountingPeriodDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid', description: 'Owning fiscal year.' })
  @IsUlid()
  fiscalYearId!: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: '1-based ordinal inside the year; unique per year.',
  })
  @IsInt()
  @Min(1)
  sequence!: number;

  @ApiProperty({
    example: 'Farvardin',
    maxLength: MAX_TITLE_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiProperty({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-03-21' },
      {
        type: 'string',
        format: 'date-time',
        example: '2026-03-21T08:30:00.000Z',
      },
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      'Inclusive start business date inside the year; Jalali input must be declared and legacy instants resolve by UTC day.',
  })
  @IsBusinessDate()
  startDate!: BusinessDateInput;

  @ApiProperty({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-04-20' },
      {
        type: 'string',
        format: 'date-time',
        example: '2026-04-20T08:30:00.000Z',
      },
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      'Inclusive end business date inside the year; Jalali input must be declared and legacy instants resolve by UTC day.',
  })
  @IsBusinessDate()
  endDate!: BusinessDateInput;
}

export class TransitionAccountingPeriodDto {
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

export class ListAccountingPeriodsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'Optional parent financial area. When combined with fiscalYearId, the server rejects a mismatched pair.',
  })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  fiscalYearId?: string;

  @ApiPropertyOptional({ enum: ACCOUNTING_PERIOD_STATUSES })
  @IsOptional()
  @IsIn([...ACCOUNTING_PERIOD_STATUSES])
  status?: AccountingPeriodStatus;
}

export class AccountingPeriodResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  financialAreaId!: string;

  @ApiProperty({ format: 'ulid' })
  fiscalYearId!: string;

  @ApiProperty({ example: 1 })
  sequence!: number;

  @ApiProperty({ example: 'Farvardin' })
  title!: string;

  @ApiProperty({ example: '2026-03-21', description: 'YYYY-MM-DD.' })
  startDate!: string;

  @ApiProperty({ example: '2026-04-20', description: 'YYYY-MM-DD.' })
  endDate!: string;

  @ApiProperty({ enum: ACCOUNTING_PERIOD_STATUSES })
  status!: AccountingPeriodStatus;

  @ApiProperty({
    enum: ACCOUNTING_PERIOD_KINDS,
    description: 'v1 vocabulary: normal only (OQ-23).',
  })
  periodKind!: AccountingPeriodKind;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
