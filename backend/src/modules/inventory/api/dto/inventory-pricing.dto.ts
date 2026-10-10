import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { IsBusinessDate } from '../../../../kernel/http/is-business-date.decorator.js';
import {
  DECLARED_BUSINESS_DATE_SCHEMA,
  LEGACY_BUSINESS_DATE_INSTANT_SCHEMA,
} from '../../../../kernel/datetime/api-date-time.dto.js';
import { CALENDAR_SYSTEMS } from '../../../../kernel/datetime/calendar-system.js';
import { MAX_OPERATION_KEY_LENGTH } from '../../application/inventory-posting-support.js';
import { INVENTORY_DOCUMENT_KINDS } from '../../domain/inventory-business-document.js';
import { PRICING_RUN_KINDS } from '../../domain/inventory-valuation.js';

/** The business-date INPUT shape (OQ-73 / C-63) — see the document DTOs. */
export type BusinessDateInputDto =
  string | { calendar: (typeof CALENDAR_SYSTEMS)[number]; value: string };

/**
 * Periodic Pricing Operation API contracts (C-59E, OD-PRC-05…07,
 * OD-PDP-01…05) and Reverse Pricing (C-59E+, OD-RVP-01…08).
 *
 * The operator chooses ONLY the scope and the range END. The range START is
 * computed by the service (immediately after the last completed run for the
 * same scope) and is never accepted from the client — contiguous,
 * non-overlapping runs are a server invariant, not a request field
 * (OD-PDP-01).
 *
 * `operationKey` is the idempotency unit for the WHOLE batch, exactly like
 * every other mutating command in the module.
 */

export class RunPricingDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Idempotency key for the WHOLE batch; a retry replays the stored run report.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'One warehouse, or omit for ALL warehouses (OD-PRC-06). The all-warehouses scope and any single-warehouse scope are separate run histories.',
  })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiProperty({
    enum: INVENTORY_DOCUMENT_KINDS,
    type: [String],
    description:
      'Which inventory document kinds the run prices. Part of the scope identity: a different kind set is a different run history.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5)
  @IsIn(INVENTORY_DOCUMENT_KINDS as readonly string[], { each: true })
  documentKinds!: string[];

  @ApiProperty({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-10-08' },
      LEGACY_BUSINESS_DATE_INSTANT_SCHEMA,
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      'Inclusive range END, a movement BUSINESS DAY (OQ-73) — the operator\u2019s only range choice. Canonical Gregorian day, declared Jalali day, or a legacy ISO instant resolved to its UTC calendar day. The start is automatic: the day after the last completed run for the same scope (OD-PDP-01).',
  })
  @IsBusinessDate()
  toDate!: BusinessDateInputDto;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReversePricingDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    format: 'ulid',
    description:
      'The run being reversed — explicitly named, never "the latest" (OD-RVP-01).',
  })
  @IsUlid()
  pricingRunId!: string;

  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description: 'Idempotency key; a retry replays the compensating run.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PricingRunScopeQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;
}

export class ListPricingRunsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiPropertyOptional({
    enum: PRICING_RUN_KINDS,
    description:
      'Filter by run kind: "pricing_operation" (a batch) or "reverse_pricing" (a compensation).',
  })
  @IsOptional()
  @IsIn(PRICING_RUN_KINDS as readonly string[])
  kind?: string;
}

export class PricingRunKeyOutcomeResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  pricingRunId!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({ enum: ['priced', 'failed', 'reversed'] })
  outcome!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Stable reason code when the outcome is "failed"; null otherwise.',
  })
  reason!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'The movements that made a failed key fail (OD-PRC-07: name the offenders).',
  })
  failedMovementIds!: string[];

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description:
      'The per-key inventory_valuation_runs row this outcome produced (the replay for a priced key, the compensation for a reversed key).',
  })
  valuationRunId!: string | null;

  @ApiProperty({ description: 'Movements the per-key replay read.' })
  movementsExamined!: number;

  @ApiProperty({
    description:
      'Movements the per-key replay changed (for a reversed key: the movements un-valued).',
  })
  movementsRevalued!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class PricingRunResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description: 'NULL = the all-warehouses scope (OD-PRC-06).',
  })
  warehouseId!: string | null;

  @ApiProperty({ type: [String] })
  documentKinds!: string[];

  @ApiProperty({
    format: 'date',
    nullable: true,
    description:
      'The run\u2019s automatic range start, a movement BUSINESS DAY (exclusive): the `to_date` of the previous COMPLETED run for the same scope (every key priced, not reversed since), or null when no run of this scope has fully completed yet. A run with failed keys does not advance the boundary — the next run re-covers its window so the failed key is retried, never skipped.',
  })
  fromDate!: string | null;

  @ApiProperty({ format: 'date' })
  toDate!: string;

  @ApiProperty({ enum: PRICING_RUN_KINDS })
  kind!: string;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description: 'Set on a compensating run: the run it reverses (OD-RVP-01).',
  })
  reversesRunId!: string | null;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description:
      'Set when THIS run has been reversed. The row is retained forever (OD-RVP-05).',
  })
  reversedByRunId!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  reversedAt!: string | null;

  @ApiProperty({ description: 'Stocking keys the run covered.' })
  keysExamined!: number;

  @ApiProperty({ description: 'Keys replayed successfully.' })
  keysPriced!: number;

  @ApiProperty({
    description:
      'Keys that failed with a named reason (OD-PDP-03: their facts are untouched).',
  })
  keysFailed!: number;

  @ApiProperty({
    description: 'Sum of the per-key replays\u2019 examined counts.',
  })
  movementsExamined!: number;

  @ApiProperty({
    description: 'Sum of the per-key replays\u2019 revalued counts.',
  })
  movementsRevalued!: number;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty({ description: 'The batch idempotency key.' })
  operationKey!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  executedBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  executedAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: PricingRunKeyOutcomeResponseDto, isArray: true })
  @ValidateNested({ each: true })
  @Type(() => PricingRunKeyOutcomeResponseDto)
  keyOutcomes!: PricingRunKeyOutcomeResponseDto[];
}
