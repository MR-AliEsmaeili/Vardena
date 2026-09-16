import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { MAX_OPERATION_KEY_LENGTH } from '../../domain/accounting-posting-operation.js';
import {
  ACCOUNTING_DOCUMENT_ORIGINS,
  ACCOUNTING_DOCUMENT_PHASES,
} from '../../domain/accounting-document.js';
import { DATE_ONLY_PATTERN } from '../../domain/date-range.js';
import { MONEY_INPUT_PATTERN } from '../../domain/money.js';
import { MIN_ACCOUNTING_DOCUMENT_LINES } from '../../domain/voucher-lines.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_SOURCE_LINE_REFERENCE_LENGTH,
} from '../../application/accounting-document-support.js';

/**
 * Accounting document (voucher) API contracts (§12/§13/§15/§18, §22).
 *
 * Four deliberate absences, each one a contract rule rather than an omission:
 *
 * - **no totals**: `Σ debit = Σ credit` is derived server-side (§13.5); a
 *   client-supplied total could only disagree with the lines;
 * - **no `lineNo`**: the ordinal is assigned from the submission order, dense
 *   and 1-based (§12.5) — the server owns it;
 * - **no `state` on edit**: the lifecycle moves through its own operations
 *   (`/issue`, `/finalize`), so a PATCH can never smuggle a state change
 *   (§15.1/§15.2);
 * - **no `origin`/`source*`**: the HTTP surface composes MANUAL documents.
 *   System origin (§16.3) is the posting contract's entry point, and no
 *   production system posting may be enabled before OQ-39 (§16.6, AC-D-26) —
 *   so the API does not accept a client's claim of being a source module.
 */

const AMOUNT_DESCRIPTION =
  'Non-negative exact decimal (numeric(18,2)): at most 16 integer digits and 2 decimal places. A negative amount is written as the opposite side, never as a sign (§13.2).';

export class AccountingDocumentLineInputDto {
  @ApiProperty({ format: 'ulid', description: 'Postable, active account.' })
  @IsUlid()
  accountId!: string;

  @ApiProperty({ example: '1250.00', description: AMOUNT_DESCRIPTION })
  @IsString()
  @Matches(MONEY_INPUT_PATTERN, {
    message: `debitAmount must be a non-negative decimal of at most 16 digits and 2 decimal places.`,
  })
  debitAmount!: string;

  @ApiProperty({ example: '0', description: AMOUNT_DESCRIPTION })
  @IsString()
  @Matches(MONEY_INPUT_PATTERN, {
    message: `creditAmount must be a non-negative decimal of at most 16 digits and 2 decimal places.`,
  })
  creditAmount!: string;

  @ApiPropertyOptional({
    maxLength: MAX_DESCRIPTION_LENGTH,
    description: 'Optional line narration.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;
}

export class CreateAccountingDocumentDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    format: 'ulid',
    description:
      'Financial area the document is booked in. It is resolved into the fiscal year and accounting period of the document date, and it is the numbering series scope (§18).',
  })
  @IsUlid()
  financialAreaId!: string;

  @ApiProperty({
    example: '2026-04-05',
    description:
      'Business/occurrence date (date-only). Drives the fiscal-year and period resolution and chronological reporting (§12.3); never an instant.',
  })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'documentDate must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  documentDate!: string;

  @ApiProperty({
    maxLength: MAX_DESCRIPTION_LENGTH,
    description: 'Header narration. Required and non-blank (§12.2).',
  })
  @IsString()
  @MinLength(1, { message: 'Description is required.' })
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'Optional operational scope, header-level only (§12.4, AC-D-17). A document that must span branches is composed as several documents.',
  })
  @IsOptional()
  @IsUlid()
  branchId?: string | null;

  @ApiProperty({
    type: [AccountingDocumentLineInputDto],
    minItems: MIN_ACCOUNTING_DOCUMENT_LINES,
    description:
      'The composed lines, in rendering order. The server assigns the dense 1-based line numbers; at least two lines are required and the exact balance is checked again inside the finalization transaction.',
  })
  @IsArray()
  @ArrayMinSize(MIN_ACCOUNTING_DOCUMENT_LINES)
  @ValidateNested({ each: true })
  @Type(() => AccountingDocumentLineInputDto)
  lines!: AccountingDocumentLineInputDto[];

  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Client idempotency key for this composition (§16.4, AC-I-12). A retry with the same key and the same intent replays the stored document; the same key with a different intent is refused with 409 and never applied. It is also the numbering allocation key, so one composition consumes at most one serial (§18).',
  })
  @IsString()
  @MinLength(1, { message: 'An operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;
}

export class UpdateAccountingDocumentDto {
  @ApiPropertyOptional({
    example: '2026-04-05',
    description:
      'New business date. Re-resolves the fiscal year and period, which must still be open (a closed period refuses documents dated in it, §7.2 rule 4).',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'documentDate must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  documentDate?: string;

  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Description cannot be blank.' })
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @ApiPropertyOptional({ format: 'ulid', nullable: true })
  @IsOptional()
  @IsUlid()
  branchId?: string | null;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'Move the document to another financial area. Allowed only while the document is still a draft: an issued document’s number belongs to its area’s series (AC-D-03, §18).',
  })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;

  @ApiPropertyOptional({
    type: [AccountingDocumentLineInputDto],
    minItems: MIN_ACCOUNTING_DOCUMENT_LINES,
    description:
      'Replacement line set. Omitted = keep the stored lines. Lines are replaced as a whole (they are one aggregate part, §12.5), and the replaced numbering is re-assigned densely by the server.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(MIN_ACCOUNTING_DOCUMENT_LINES)
  @ValidateNested({ each: true })
  @Type(() => AccountingDocumentLineInputDto)
  lines?: AccountingDocumentLineInputDto[];
}

export class DocumentTransitionDto {
  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Client idempotency key for this operation (§16.4, AC-I-12). Issuance uses it as the numbering allocation key, so a retried issuance replays the serial instead of burning another one; finalization writes it into the posting-operation ledger, so a double submission replays instead of finalizing twice.',
  })
  @IsString()
  @MinLength(1, { message: 'An operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;
}

export class ListAccountingDocumentsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
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

  @ApiPropertyOptional({ enum: ACCOUNTING_DOCUMENT_PHASES })
  @IsOptional()
  @IsIn([...ACCOUNTING_DOCUMENT_PHASES])
  state?: string;

  @ApiPropertyOptional({ enum: ACCOUNTING_DOCUMENT_ORIGINS })
  @IsOptional()
  @IsIn([...ACCOUNTING_DOCUMENT_ORIGINS])
  origin?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Exact serial match.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  documentNumber?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'dateFrom must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'dateTo must be a valid calendar date (YYYY-MM-DD).',
  })
  @MaxLength(10)
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive match on the narration.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AccountingDocumentLineResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ example: 1, description: 'Dense 1-based ordinal (§12.5).' })
  lineNo!: number;

  @ApiProperty({ format: 'ulid' })
  accountId!: string;

  @ApiProperty({ example: '1250.00', description: 'Canonical decimal string.' })
  debitAmount!: string;

  @ApiProperty({ example: '0', description: 'Canonical decimal string.' })
  creditAmount!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: MAX_SOURCE_LINE_REFERENCE_LENGTH,
    description: 'Optional logical source-line reference (§20.3).',
  })
  sourceLineReference!: string | null;
}

export class AccountingDocumentResponseDto {
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

  @ApiProperty({ example: 'accounting_voucher' })
  documentType!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Numeric-only serial; null until the voucher is issued. Never changes once assigned (§18, AC-I-22).',
  })
  documentNumber!: string | null;

  @ApiProperty({ example: '2026-04-05', format: 'date' })
  documentDate!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: ACCOUNTING_DOCUMENT_PHASES })
  state!: string;

  @ApiProperty({ enum: ACCOUNTING_DOCUMENT_ORIGINS })
  origin!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'System origin only.' })
  sourceModule!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceEntityType!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceEntityId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceOperation!: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'Finalization evidence (§15.5, §23). Null while not final.',
  })
  finalizedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  finalizedBy!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'End-to-end request trace (§23).',
  })
  correlationId!: string | null;

  @ApiProperty({ type: [AccountingDocumentLineResponseDto] })
  lines!: AccountingDocumentLineResponseDto[];

  @ApiProperty({
    example: '1250.00',
    description:
      'Derived exact decimal string — never client-supplied (§13.5). Equal to `totalCredit` for every persisted document.',
  })
  totalDebit!: string;

  @ApiProperty({ example: '1250.00' })
  totalCredit!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
