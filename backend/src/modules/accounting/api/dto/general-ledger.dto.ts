import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  PageQueryDto,
  SORT_PATTERN,
} from '../../../../kernel/pagination/page-query.dto.js';
import { DATE_ONLY_PATTERN } from '../../domain/date-range.js';

/**
 * General Ledger query contract. All fields are explicit; there is no generic
 * filter or SQL expression surface. Document Date is the financial date axis.
 */
export class GeneralLedgerQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Organization scope.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'Exactly one financial area for this report request.',
  })
  @IsUlid()
  financialAreaId!: string;

  @ApiProperty({ format: 'ulid', description: 'Exactly one fiscal year.' })
  @IsUlid()
  fiscalYearId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  accountingPeriodId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Exact account identity filter; identity is Account.id.',
  })
  @IsOptional()
  @IsUlid()
  accountId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'Account hierarchy root. The root and its descendants are included.',
  })
  @IsOptional()
  @IsUlid()
  accountHierarchyId?: string;

  @ApiPropertyOptional({ description: 'Exact current account-code filter.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accountCode?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive account-name contains filter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @ApiPropertyOptional({
    example: 'accountCode:asc',
    description:
      'Allow-listed deterministic sort fields: documentDate, postingTimestamp, documentId, ledgerLineId, accountCode, accountName, or accountId.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(SORT_PATTERN)
  sort: string = '';

  @ApiPropertyOptional({
    example: '2026-03-21',
    description: 'Inclusive Document Date lower bound within the fiscal year.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN)
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2027-03-20',
    description: 'Inclusive Document Date upper bound within the fiscal year.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN)
  dateTo?: string;
}

/** One bounded General Ledger row. Decimal fields are strings, never numbers. */
export class GeneralLedgerResponseDto {
  @ApiProperty({
    format: 'ulid',
    description: 'Organization scope echoed on every source row.',
  })
  organizationId!: string;

  @ApiProperty({ format: 'date' })
  documentDate!: string;

  @ApiProperty({ format: 'date-time' })
  postingTimestamp!: string;

  @ApiProperty({ description: 'Authoritative Accounting document type.' })
  documentType!: string;

  @ApiProperty({ format: 'ulid' })
  documentId!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'Own immutable `accounting.ledger_entries.id`.',
  })
  ledgerEntryId!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'Ledger-line identity used by this report contract.',
  })
  ledgerLineId!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'Immutable 1:1 source voucher-line identity.',
  })
  voucherLineId!: string;

  @ApiProperty({ format: 'ulid' })
  accountId!: string;

  @ApiProperty()
  accountCode!: string;

  @ApiProperty()
  accountName!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Existing voucher-line source reference. Null because the model has no generic reference field.',
  })
  reference!: string | null;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ example: '0.10', description: 'Exact Decimal string.' })
  debit!: string;

  @ApiProperty({ example: '0.20', description: 'Exact Decimal string.' })
  credit!: string;

  @ApiProperty({ example: '-0.1', description: 'Exact debit minus credit.' })
  net!: string;

  @ApiProperty({ format: 'ulid' })
  financialAreaId!: string;

  @ApiProperty({ format: 'ulid' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'ulid' })
  accountingPeriodId!: string;

  @ApiProperty({ description: 'Immutable voucher serial snapshot.' })
  voucherNumber!: string;

  @ApiProperty({ description: 'Immutable 1-based voucher-line number.' })
  lineNo!: number;

  @ApiProperty({ description: '`manual` or `system` origin snapshot.' })
  origin!: string;

  @ApiPropertyOptional({ nullable: true })
  sourceModule!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceEntityType!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceEntityId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceOperation!: string | null;
}
