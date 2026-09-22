import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';

/**
 * Balance projection API contracts (Task 12, ADR-0031, contract §19.3).
 *
 * The projection is a REPORTING-ONLY, rebuildable materialization over
 * `ledger_entries`. Stored measures are ONLY period turnover (debit/credit);
 * opening/closing are DERIVED and never stored, never requested from clients.
 *
 * Absence = zero turnover (AC-I-19c): the API never synthesizes zero rows —
 * if a key has no row, it has no turnover. Callers that need dense period
 * series must LEFT JOIN `accounting_periods` explicitly (§19.2).
 *
 * Every read is org-scoped (AC-I-01 → 404 for foreign keys); every filter is
 * optional except `organizationId`. Sorting follows the module convention
 * (`sort` is validated in the service, never passed raw to Prisma).
 */

export class ListBalancesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Tenant scope (the list is never cross-organization).' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'One financial area of the organization (optional).' })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'One fiscal year (must belong to the org + area when area is set).' })
  @IsOptional()
  @IsUlid()
  fiscalYearId?: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'One accounting period (must belong to the year when year is set).' })
  @IsOptional()
  @IsUlid()
  accountingPeriodId?: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'One account (must be in-organization, postable leaf).' })
  @IsOptional()
  @IsUlid()
  accountId?: string;

}

export class GetAccountBalanceQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Tenant scope — the account must be in this organization (404 otherwise).' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  fiscalYearId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  accountingPeriodId?: string;

  @ApiPropertyOptional({ description: 'Page (derived series paginated).', minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size (1–100).', minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ReconciliationQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  fiscalYearId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  accountingPeriodId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Filter by mismatch kind.', enum: ['missing_projection', 'extra_projection', 'debit_mismatch', 'credit_mismatch', 'both_mismatch'] })
  @IsOptional()
  @IsString()
  mismatchKind?: string;

  @ApiPropertyOptional({ description: 'Page', minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class RebuildBalancesDto {
  @ApiProperty({ format: 'ulid', description: 'Tenant scope — rebuild never crosses organizations.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'Restrict rebuild to one financial area (when omitted — org-wide).' })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'Restrict rebuild to one fiscal year (must belong to area/organization).' })
  @IsOptional()
  @IsUlid()
  fiscalYearId?: string;

  @ApiProperty({ description: 'Optional reason for the audit trail (mirrors fiscal-year transitions — same evidence posture).', example: 'Quarter-end reconciliation drift detected' })
  @IsOptional()
  @IsString()
  reason?: string;
}

/** Wire-format for a derived balance row (stored turnover + derived net/opening/closing). */
export class BalanceDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  financialAreaId!: string;

  @ApiProperty({ format: 'ulid' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'ulid' })
  accountingPeriodId!: string;

  @ApiProperty({ description: 'Authoritative intra-year ordering (AccountingPeriod.sequence).', minimum: 1 })
  periodSequence!: number;

  @ApiProperty({ format: 'ulid' })
  accountId!: string;

  @ApiProperty({ example: '12000.00', description: 'Period turnover debit (stored, non-negative, numeric(18,2)).' })
  periodDebitAmount!: string;

  @ApiProperty({ example: '3000.50', description: 'Period turnover credit (stored, non-negative, numeric(18,2)).' })
  periodCreditAmount!: string;

  @ApiProperty({ example: '8999.50', description: 'Period net = debit − credit (derived, exact, may be negative).' })
  periodNetAmount!: string;

  @ApiProperty({ example: '0', description: 'Cumulative closing up to prior period (derived, intra-year, never crosses year).' })
  openingBalanceAmount!: string;

  @ApiProperty({ example: '8999.50', description: 'Opening + periodNet (derived).' })
  closingBalanceAmount!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ReconciliationItemDto {
  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  financialAreaId!: string;

  @ApiProperty({ format: 'ulid' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'ulid' })
  accountingPeriodId!: string;

  @ApiProperty({ format: 'ulid' })
  accountId!: string;

  @ApiProperty({ enum: ['missing_projection', 'extra_projection', 'debit_mismatch', 'credit_mismatch', 'both_mismatch'] })
  mismatchKind!: string;

  @ApiPropertyOptional({ example: '1000.00', nullable: true })
  ledgerDebitAmount!: string | null;

  @ApiPropertyOptional({ example: '0.00', nullable: true })
  ledgerCreditAmount!: string | null;

  @ApiPropertyOptional({ nullable: true })
  projectionDebitAmount!: string | null;

  @ApiPropertyOptional({ nullable: true })
  projectionCreditAmount!: string | null;
}

export class RebuildResultDto {
  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid', nullable: true })
  financialAreaId!: string | null;

  @ApiPropertyOptional({ format: 'ulid', nullable: true })
  fiscalYearId!: string | null;

  @ApiProperty({ description: 'Rows deleted in the scoped slice (audit evidence).' })
  deleted!: number;

  @ApiProperty({ description: 'Rows re-derived from ledger and inserted (audit evidence).' })
  inserted!: number;
}
