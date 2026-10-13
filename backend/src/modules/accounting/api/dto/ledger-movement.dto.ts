import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { DATE_ONLY_PATTERN } from '../../domain/date-range.js';

/** Column width of the immutable voucher serial snapshot (`varchar(32)`). */
const MAX_VOUCHER_NUMBER_LENGTH = 32;

/**
 * Ledger movement API contracts (Task 17A, contract §19.1/§19.2 AC-D-30).
 *
 * The read source exposes POSTED movements only. Four deliberate absences,
 * each one a property of the underlying facts rather than an omission:
 *
 * - **no `status`**: `accounting.ledger_entries` has no status column and no
 *   draft twin. A movement exists because the voucher became `final`
 *   (§15.2/§15.5) — "posted entry status" is not a filterable attribute, and
 *   accepting one would imply non-posted ledger rows exist.
 * - **no `currency`**: there is no currency/rate column yet (§24.1, OQ-03 →
 *   base-currency-only `numeric(18,2)`), so no currency filter or field is
 *   invented.
 * - **no account code/title or hierarchy**: the chart's classification inputs
 *   (`account_type`, `is_temporary`, control roles) are OQ-25-gated and not
 *   stored (§8.3), so the source returns the authoritative `accountId` only and
 *   infers no grouping or level meaning.
 * - **no branch/date-bucket/report layouts**: branch filters, calendar
 *   bucketing and statutory column sets belong to later, separately authorized
 *   work (OQ-23/OQ-25/OQ-43).
 *
 * Every amount crosses the wire as a decimal STRING (§13.1/§13.5, AC-I-07) —
 * never a JSON number, which would silently reintroduce binary floating point.
 */
export class ListLedgerMovementsQueryDto extends PageQueryDto {
  @ApiProperty({
    format: 'ulid',
    description:
      'Tenant scope (mandatory). The list is never cross-organization, and the value is resolved server-side against the deployment organization pin.',
  })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'One financial area of that organization (optional).',
  })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'One fiscal year (optional). Filters the STORED resolution — the source never recomputes a year from a date.',
  })
  @IsOptional()
  @IsUlid()
  fiscalYearId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'One accounting period (optional; same stored-resolution rule).',
  })
  @IsOptional()
  @IsUlid()
  accountingPeriodId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'One account (optional) — the account-ledger filter.',
  })
  @IsOptional()
  @IsUlid()
  accountId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'One source voucher (optional) — its posted movements.',
  })
  @IsOptional()
  @IsUlid()
  voucherId?: string;

  @ApiPropertyOptional({
    description: 'Exact voucher serial match (optional).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_VOUCHER_NUMBER_LENGTH)
  voucherNumber?: string;

  @ApiPropertyOptional({
    example: '2026-04-01',
    description: 'Inclusive lower bound of the business date (optional).',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'dateFrom must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-04-30',
    description: 'Inclusive upper bound of the business date (optional).',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'dateTo must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  dateTo?: string;
}

/** Wire format of one posted ledger movement. */
export class LedgerMovementResponseDto {
  @ApiProperty({
    format: 'ulid',
    description: 'Ledger entry identity (immutable, never reused).',
  })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  financialAreaId!: string;

  @ApiProperty({ format: 'ulid' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'ulid' })
  accountingPeriodId!: string;

  @ApiProperty({ format: 'ulid' })
  voucherId!: string;

  @ApiProperty({
    example: '00042',
    description:
      'Numeric-only serial snapshot, immutable after final (§18, AC-I-22).',
  })
  voucherNumber!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'Source voucher line — the 1:1 traceability key.',
  })
  voucherLineId!: string;

  @ApiProperty({
    example: 1,
    description: 'Dense 1-based ordinal inside the voucher (§12.5).',
  })
  lineNo!: number;

  @ApiProperty({ format: 'ulid' })
  accountId!: string;

  @ApiProperty({
    example: '1250.5',
    description:
      'Exact decimal string from `numeric(18,2)`, in the module’s canonical form (trailing zeros trimmed: `1250.50` → `1250.5`); non-negative, never a JSON number (§13.1/§13.5, AC-I-07).',
  })
  debitAmount!: string;

  @ApiProperty({
    example: '0',
    description: 'Exact decimal string; non-negative, canonical form.',
  })
  creditAmount!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Line narration (the voucher header narration is elsewhere).',
  })
  description!: string | null;

  @ApiProperty({ example: '2026-04-05', format: 'date' })
  documentDate!: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'System timestamp of the posting act (finalization) — distinct from the business date.',
  })
  postingTimestamp!: string;

  @ApiProperty({ enum: ['manual', 'system'] })
  origin!: string;

  @ApiPropertyOptional({ nullable: true, description: 'System origin only.' })
  sourceModule!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'System origin only.' })
  sourceEntityType!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'System origin only.' })
  sourceEntityId!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'System origin only.' })
  sourceOperation!: string | null;
}
