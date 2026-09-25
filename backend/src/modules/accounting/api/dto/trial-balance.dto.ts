import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  PageQueryDto,
  SORT_PATTERN,
} from '../../../../kernel/pagination/page-query.dto.js';
import { DATE_ONLY_PATTERN } from '../../domain/date-range.js';

/** Trial Balance query contract: one area/year, explicit account filters only. */
export class TrialBalanceQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  financialAreaId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  fiscalYearId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  accountingPeriodId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  accountId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Roll up the selected hierarchy root and descendants.',
  })
  @IsOptional()
  @IsUlid()
  accountHierarchyId?: string;

  @ApiPropertyOptional({ description: 'Exact current account-code filter.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accountCode?: string;

  @ApiPropertyOptional({ description: 'Account-name contains filter.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @ApiPropertyOptional({
    example: 'closing:desc',
    description:
      'Allow-listed deterministic sort fields: accountCode, accountName, accountId, opening, debit, credit, periodNet, or closing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(SORT_PATTERN)
  sort: string = '';

  @ApiPropertyOptional({ example: '2026-03-21', format: 'date' })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2027-03-20', format: 'date' })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN)
  dateTo?: string;
}

/**
 * Trial Balance row. `role` is the existing POSTING/AGGREGATION account
 * semantic, not an account-classification taxonomy.
 */
export class TrialBalanceResponseDto {
  @ApiProperty({ format: 'ulid' })
  accountId!: string;

  @ApiProperty()
  accountCode!: string;

  @ApiProperty()
  accountName!: string;

  @ApiProperty({ enum: ['POSTING', 'AGGREGATION'] })
  role!: 'POSTING' | 'AGGREGATION';

  @ApiProperty({
    example: '0.10',
    description: 'Opening, exact Decimal string.',
  })
  opening!: string;

  @ApiProperty({ example: '0.10', description: 'Debit turnover.' })
  debitTurnover!: string;

  @ApiProperty({ example: '0.20', description: 'Credit turnover.' })
  creditTurnover!: string;

  @ApiProperty({
    example: '-0.1',
    description: 'Debit turnover minus credit turnover.',
  })
  periodNet!: string;

  @ApiProperty({ example: '-0.1', description: 'Opening plus period net.' })
  closing!: string;
}
