import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_OPERATION_KEY_LENGTH,
  MAX_REASON_LENGTH,
} from '../../application/inventory-posting-support.js';
import { REPRICING_CHOICES } from '../../domain/backdating.js';
import {
  VALUATION_METHODS,
  ACTIVE_VALUATION_METHODS,
} from '../../domain/valuation-method.js';
import {
  VALUATION_RUN_TRIGGERS,
  VALUATION_STATE_STATUSES,
} from '../../domain/inventory-valuation.js';

/**
 * Inventory Valuation API contracts (PDR-05, ADR-0039).
 *
 * Money travels as decimal **strings**, exactly like quantities, so an
 * amount never passes through a binary float. The transport validates shape
 * (string, bounded length); the service validates meaning (positive, fits
 * `numeric(18,2)` EXACTLY — an entered amount is never rounded).
 *
 * Two things deliberately have no default anywhere in this file:
 *
 * - `repricing`, the explicit decision whether existing values are
 *   recalculated. Defaulting it would make the system decide an accounting
 *   question on the operator's behalf;
 * - the valuation `method` when configuring an item — only implemented
 *   methods are accepted, and the API says which those are
 *   (`activeMethods`), so no UI can offer a strategy nobody wrote.
 */

export class InventoryValuationScopeQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;
}

export class ListValuationMethodsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  itemId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Only the version in force at this instant.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  activeAt?: Date;
}

export class ConfigureValuationMethodDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiProperty({
    enum: VALUATION_METHODS,
    description: `Known methods. Only ${ACTIVE_VALUATION_METHODS.join(', ')} is implemented; configuring any other is rejected with 422 rather than silently accepted.`,
  })
  @IsIn(VALUATION_METHODS as readonly string[])
  method!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Start of the validity window; defaults to now. The previous open-ended version is closed at this instant (effective dating, D-21).',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Optional end of the window; must be after validFrom.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ResolveValuationMethodQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'The instant to resolve at; defaults to now. A past instant resolves the version that was in force then, not today.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  asOf?: Date;
}

export class ListValuationStatesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  branchId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  itemId?: string;

  @ApiPropertyOptional({
    enum: VALUATION_STATE_STATUSES,
    description:
      'Filter the Inventory Accounting worklist: "pending_cost" = stock waiting for a cost, "stale" = values an explicit recalculation must repair.',
  })
  @IsOptional()
  @IsIn(VALUATION_STATE_STATUSES as readonly string[])
  status?: string;
}

export class ValuationStateKeyQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;
}

export class BackdateCheckQueryDto extends ValuationStateKeyQueryDto {
  @ApiProperty({
    format: 'date-time',
    description: 'The business date the operator intends to post with.',
  })
  @Type(() => Date)
  @IsDate()
  movementDate!: Date;
}

export class ListValuationRunsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  itemId?: string;

  @ApiPropertyOptional({ enum: VALUATION_RUN_TRIGGERS })
  @IsOptional()
  @IsIn(VALUATION_RUN_TRIGGERS as readonly string[])
  trigger?: string;
}

export class AssignMovementCostDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Idempotency key. Retrying with the same key and amount replays the stored result instead of pricing twice.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;

  @ApiProperty({
    example: '250000.00',
    description:
      'Total value of the movement, as an exact decimal string with at most 2 decimals. Never rounded: an amount that does not fit exactly is rejected.',
  })
  @IsString()
  @MaxLength(32)
  totalCost!: string;

  @ApiProperty({
    enum: REPRICING_CHOICES,
    description:
      'Required: "recalculate" reprices this item and warehouse now, "skip" records the cost and marks the key inconsistent (stale) for a later, explicit recalculation.',
  })
  @IsIn(REPRICING_CHOICES as readonly string[])
  repricing!: string;

  @ApiPropertyOptional({ maxLength: MAX_REASON_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;
}

export class RecalculateValuationDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description: 'Idempotency key; a retry replays the original run.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;

  @ApiProperty({
    format: 'ulid',
    description:
      'Required: a recalculation always targets exactly ONE warehouse and item. There is no "recalculate everything".',
  })
  @IsUlid()
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiPropertyOptional({
    enum: VALUATION_RUN_TRIGGERS,
    description: 'Why the recalculation was requested; defaults to "manual".',
  })
  @IsOptional()
  @IsIn(VALUATION_RUN_TRIGGERS as readonly string[])
  trigger?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Recorded on the run for audit. The replay always covers the whole key: a partial replay cannot produce a deterministic average.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fromDate?: Date;

  @ApiPropertyOptional({ maxLength: MAX_REASON_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;
}

// ---- responses -------------------------------------------------------------

export class ItemValuationMethodResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({ enum: VALUATION_METHODS })
  method!: string;

  @ApiProperty({ format: 'date-time' })
  validFrom!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  validTo!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ResolvedValuationMethodResponseDto {
  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({ format: 'date-time' })
  asOf!: string;

  @ApiProperty({ enum: VALUATION_METHODS })
  method!: string;

  @ApiProperty({
    enum: ['configured', 'default'],
    description:
      '"default" means no configuration row covers this instant and the code-defined MVP default applies — not that a row exists saying so.',
  })
  source!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  configurationId!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  validFrom!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  validTo!: string | null;

  @ApiProperty({
    description: 'Whether this method is actually implemented in this MVP.',
  })
  active!: boolean;
}

export class InventoryValuationStateResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  branchId!: string;

  @ApiProperty({ format: 'ulid' })
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({ enum: VALUATION_METHODS })
  method!: string;

  @ApiProperty({
    example: '120.0000',
    description: 'Base-unit quantity that carries a value. Decimal string.',
  })
  valuedQuantity!: string;

  @ApiProperty({
    example: '30.0000',
    description:
      'Base-unit quantity with no cost yet. Decimal string. The whole point of cost-optional operations: this number is visible instead of being averaged away.',
  })
  uncostedQuantity!: string;

  @ApiProperty({
    example: '1500000.00',
    description: 'Value of valuedQuantity. Decimal string.',
  })
  totalValue!: string;

  @ApiProperty({
    example: '150.0000',
    description:
      'valuedQuantity + uncostedQuantity. Always equals the stock balance on-hand for this key.',
  })
  totalQuantity!: string;

  @ApiProperty({
    nullable: true,
    example: '12500.000000',
    description:
      'Derived totalValue / valuedQuantity, rounded for display only. Null when nothing is valued; never stored.',
  })
  averageUnitCost!: string | null;

  @ApiProperty({
    enum: VALUATION_STATE_STATUSES,
    description:
      '"valued" = complete and consistent; "pending_cost" = some stock still has no cost; "stale" = the stored value is inconsistent and needs an explicit recalculation.',
  })
  status!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  staleSince!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastValuedAt!: string | null;

  @ApiProperty({ format: 'ulid', nullable: true })
  lastRecalculationId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class InventoryValuationRunResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  branchId!: string;

  @ApiProperty({ format: 'ulid' })
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({ enum: VALUATION_METHODS })
  method!: string;

  @ApiProperty({ enum: VALUATION_RUN_TRIGGERS })
  trigger!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  fromDate!: string | null;

  @ApiProperty({ description: 'How many movements the replay read.' })
  movementsExamined!: number;

  @ApiProperty({
    description:
      'How many movement rows actually changed. Zero is a valid, honest outcome.',
  })
  movementsRevalued!: number;

  @ApiProperty({ example: '120.0000' })
  resultingValuedQuantity!: string;

  @ApiProperty({ example: '0.0000' })
  resultingUncostedQuantity!: string;

  @ApiProperty({ example: '1500000.00' })
  resultingTotalValue!: string;

  @ApiProperty({ enum: VALUATION_STATE_STATUSES })
  resultingStatus!: string;

  @ApiProperty()
  operationKey!: string;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty({ format: 'date-time' })
  executedAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class BackdateCheckResponseDto {
  @ApiProperty({
    description:
      'True when movementDate is strictly before the latest movement on this key. Equal instants are NOT backdating.',
  })
  backdated!: boolean;

  @ApiProperty({ format: 'date-time' })
  movementDate!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  latestMovementDate!: string | null;

  @ApiProperty({ description: 'Movements dated strictly after movementDate.' })
  affectedMovements!: number;

  @ApiProperty({
    description:
      'How many of those currently carry a value that a recalculation could change.',
  })
  affectedValuedMovements!: number;

  @ApiProperty({
    description: 'Whether this key already reports an inconsistent value.',
  })
  alreadyStale!: boolean;

  @ApiProperty({
    description:
      'The posting will be rejected until backdateConfirmed is sent as true.',
  })
  confirmationRequired!: boolean;

  @ApiProperty({
    description:
      'The posting will be rejected until an explicit repricing choice is sent.',
  })
  repricingChoiceRequired!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Stable machine-readable code the UI keys its Persian warning off (inventory.backdated_document), or null when the posting is not backdated.',
  })
  code!: string | null;
}

export class ValuationCommandResponseDto {
  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'The movement the command touched, re-read after the write (null for a key-level recalculation).',
  })
  movement!: Record<string, unknown> | null;

  @ApiProperty({ type: InventoryValuationStateResponseDto })
  state!: InventoryValuationStateResponseDto;

  @ApiProperty({
    type: InventoryValuationRunResponseDto,
    nullable: true,
    description:
      'The recalculation that ran, or null when the operator chose "skip" — in which case the key is now stale on purpose.',
  })
  run!: InventoryValuationRunResponseDto | null;
}

export class RecalculationResponseDto {
  @ApiProperty({ type: InventoryValuationRunResponseDto })
  run!: InventoryValuationRunResponseDto;

  @ApiProperty({ type: InventoryValuationStateResponseDto })
  state!: InventoryValuationStateResponseDto;
}
