import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { IsBusinessDate } from '../../../../kernel/http/is-business-date.decorator.js';
import { IsBusinessDay } from '../../../../kernel/http/is-business-day.decorator.js';
import { DECLARED_BUSINESS_DATE_SCHEMA } from '../../../../kernel/datetime/api-date-time.dto.js';
import { CALENDAR_SYSTEMS } from '../../../../kernel/datetime/calendar-system.js';
import {
  MOVEMENT_TYPES,
  SINGLE_POST_TYPES,
} from '../../domain/movement-type.js';
import { RESERVATION_STATUSES } from '../../domain/inventory-reservation.js';
import {
  MOVEMENT_VALUATION_STATUSES,
  VALUATION_SOURCES,
} from '../../domain/inventory-valuation.js';
import { REPRICING_CHOICES } from '../../domain/backdating.js';
import {
  MAX_OPERATION_KEY_LENGTH,
  MAX_REASON_LENGTH,
  MAX_REFERENCE_ID_LENGTH,
  MAX_REFERENCE_TYPE_LENGTH,
} from '../../application/inventory-posting-support.js';

/**
 * Inventory Core API contracts (ADR-0022).
 *
 * One file for the four resources (movements, transfers, reservations,
 * balances) because the posting envelopes are shared: every mutating call
 * carries a client-supplied `operationKey` (required, opaque, at most 128
 * characters) that makes retries safe. Replaying a key with the identical
 * request returns the originally committed row; replaying it with different
 * intent is rejected with 409 and never applied.
 *
 * Quantities travel as decimal **strings**, never JSON numbers, so values
 * like `25.500` cross the wire without binary floating-point drift. The
 * transport validates shape (string, bounded length); the service layer
 * validates meaning (positive, fits `numeric(18,4)`) and resolves
 * entered → base conversion against the conversion version in force at the
 * operation's business date — never silently (OQ-29).
 */

/**
 * The API shape of a declared business date (OQ-73 / C-63): the SAME day a
 * Persian user types, plus the calendar that gives it meaning. Identical to
 * the inventory business-document contract.
 */
export type BusinessDateInputDto =
  string | { calendar: (typeof CALENDAR_SYSTEMS)[number]; value: string };

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export class ListInventoryMovementsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
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

  @ApiPropertyOptional({ enum: MOVEMENT_TYPES })
  @IsOptional()
  @IsIn(MOVEMENT_TYPES as readonly string[])
  movementType?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Both legs of one transfer share this id.',
  })
  @IsOptional()
  @IsUlid()
  transferId?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description:
      'Inclusive lower bound on the movement BUSINESS DAY, canonical Gregorian YYYY-MM-DD (OQ-73: movement_date is a PostgreSQL date). A Jalali day is converted to its canonical Gregorian day at the boundary.',
  })
  @IsOptional()
  @IsBusinessDay()
  dateFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description:
      'Inclusive upper bound on the movement BUSINESS DAY, canonical Gregorian YYYY-MM-DD.',
  })
  @IsOptional()
  @IsBusinessDay()
  dateTo?: string;
}

export class PostInventoryMovementDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Idempotency key for this posting. Retrying with the same key and the same request returns the original movement; the same key with different intent is rejected with 409.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiProperty({
    enum: SINGLE_POST_TYPES,
    description:
      'Transfer legs and reversals cannot be posted directly: transfers go through POST /inventory/transfers, corrections through the reverse action.',
  })
  @IsIn(SINGLE_POST_TYPES as readonly string[])
  movementType!: string;

  @ApiProperty({
    example: '25.5',
    description:
      'Positive decimal magnitude in the entered unit, as a string. The base-unit equivalent is resolved server-side.',
  })
  @IsString()
  @MaxLength(32)
  quantity!: string;

  @ApiProperty({
    format: 'ulid',
    description:
      'Unit the quantity is entered in. A conversion to the item base unit must cover the movement date (or be the base unit itself).',
  })
  @IsUlid()
  unitId!: string;

  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-10-08' },
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      'Business DATE of the movement — a calendar DAY, not an instant (OQ-73). Canonical Gregorian "2026-10-08", a declared Jalali day { calendar, value }, or a legacy ISO instant resolved to the day it falls on in the organization zone. Defaults to today\'s business day in the organization zone. A backdated posting resolves the conversion version in force then, not today.',
  })
  @IsOptional()
  @IsBusinessDate()
  movementDate?: BusinessDateInputDto;

  @ApiPropertyOptional({
    maxLength: MAX_REASON_LENGTH,
    description:
      'Free-text reason. Required for adjustments; an optional note for receipts and issues.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;

  @ApiPropertyOptional({
    maxLength: MAX_REFERENCE_TYPE_LENGTH,
    description:
      'Opaque source-document type (e.g. a future purchase invoice). Must be set together with referenceId; stored, never dereferenced.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_TYPE_LENGTH)
  referenceType?: string;

  @ApiPropertyOptional({
    maxLength: MAX_REFERENCE_ID_LENGTH,
    description:
      'Opaque source-document id. Must be set together with referenceType.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  referenceId?: string;

  @ApiPropertyOptional({
    example: '12500.00',
    description:
      'OPTIONAL cost per ENTERED unit, as an exact decimal string with at most 2 decimals. Never required: a warehouse receipt posts without any cost and the stock is tracked as uncosted until a value is assigned. Mutually exclusive with totalCost, rejected on issues, and requires Inventory.Valuation.AssignCost.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  unitCost?: string;

  @ApiPropertyOptional({
    example: '250000.00',
    description:
      'OPTIONAL total cost of the whole posting, as an exact decimal string with at most 2 decimals. Same rules as unitCost; provide one or the other, never both.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  totalCost?: string;

  @ApiPropertyOptional({
    description:
      'Acknowledges that the document is dated before the latest movement on this item and warehouse. A backdated posting is rejected (422 inventory.backdated_document) until this is true.',
  })
  @IsOptional()
  @IsBoolean()
  backdateConfirmed?: boolean;

  @ApiPropertyOptional({
    enum: REPRICING_CHOICES,
    description:
      'The second, separate decision a backdated posting requires: "recalculate" reprices this item and warehouse immediately, "skip" keeps the existing values and marks them inconsistent (stale). There is no default — valuation is never recalculated silently.',
  })
  @IsOptional()
  @IsIn(REPRICING_CHOICES as readonly string[])
  repricing?: string;
}

export class ReverseInventoryMovementDto {
  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Idempotency key for this reversal. A key that already reversed this movement replays the original reversal row.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;

  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-10-08' },
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      "Business DATE of the reversal movement — a calendar DAY, not an instant (OQ-73). Same accepted forms as posting. Defaults to today's business day in the organization zone. If this day precedes later movements on the same item and warehouse, the reversal requires the same explicit backdating acknowledgement and repricing choice as a normal posting.",
  })
  @IsOptional()
  @IsBusinessDate()
  movementDate?: BusinessDateInputDto;

  @ApiPropertyOptional({
    description:
      'Acknowledges that the reversal is dated before the latest movement on this item and warehouse. A backdated reversal is rejected (422 inventory.backdated_document) until this is true.',
  })
  @IsOptional()
  @IsBoolean()
  backdateConfirmed?: boolean;

  @ApiPropertyOptional({
    enum: REPRICING_CHOICES,
    description:
      'The second, separate decision a backdated reversal requires: "recalculate" reprices this item and warehouse immediately, "skip" keeps the existing values and marks them inconsistent (stale). There is no default — valuation is never recalculated silently.',
  })
  @IsOptional()
  @IsIn(REPRICING_CHOICES as readonly string[])
  repricing?: string;
}

export class InventoryMovementResponseDto {
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

  @ApiProperty({ enum: MOVEMENT_TYPES })
  movementType!: string;

  @ApiProperty({
    example: '25.5',
    description: 'Entered magnitude. Decimal string.',
  })
  quantity!: string;

  @ApiProperty({ format: 'ulid' })
  enteredUnitId!: string;

  @ApiProperty({
    example: '25.5',
    description: 'Base-unit magnitude. Decimal string.',
  })
  baseQuantity!: string;

  @ApiProperty({ format: 'ulid' })
  baseUnitId!: string;

  @ApiProperty({
    example: '1',
    description: 'Exact factor applied. Decimal string.',
  })
  conversionFactor!: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-08',
    description:
      'Business DAY of the movement — canonical Gregorian YYYY-MM-DD (OQ-73: a calendar day, never an instant). The registration instant is createdAt.',
  })
  movementDate!: string;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description: 'Set on both legs of a transfer; null otherwise.',
  })
  transferId!: string | null;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description:
      'The movement this row reverses; null unless this row is a reversal.',
  })
  reversalOfMovementId!: string | null;

  @ApiProperty({ nullable: true })
  referenceType!: string | null;

  @ApiProperty({ nullable: true })
  referenceId!: string | null;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty({
    description: 'Idempotency key this movement was posted with.',
  })
  operationKey!: string;

  @ApiProperty({
    nullable: true,
    example: '-250000.00',
    description:
      'SIGNED value effect of this movement (+ inbound, - outbound), mirroring baseQuantity. Null when the movement carries no value yet, and null for callers without Inventory.Valuation.View.',
  })
  totalCost!: string | null;

  @ApiProperty({
    enum: MOVEMENT_VALUATION_STATUSES,
    description:
      'Finality of the value: "unvalued" (no value), "provisional" (a value an explicit recalculation will change), "valued" (final).',
  })
  valuationStatus!: string;

  @ApiProperty({
    enum: VALUATION_SOURCES,
    nullable: true,
    description:
      'Where the value came from. Everything except average_cost is preserved verbatim by a recalculation.',
  })
  valuationSource!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  valuedAt!: string | null;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description: 'The recalculation run that last wrote these fields, if any.',
  })
  valuationRunId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export class PostInventoryTransferDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Idempotency key for this transfer. Retrying replays the original pair of legs.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  sourceWarehouseId!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'Must differ from the source warehouse.',
  })
  @IsUlid()
  destinationWarehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiProperty({
    example: '10',
    description:
      'Positive decimal magnitude in the entered unit, as a string. Both legs carry the identical magnitude.',
  })
  @IsString()
  @MaxLength(32)
  quantity!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  unitId!: string;

  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-10-08' },
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      "Business DATE of both legs — a calendar DAY, not an instant (OQ-73). Same accepted forms as posting. Defaults to today's business day in the organization zone.",
  })
  @IsOptional()
  @IsBusinessDate()
  movementDate?: BusinessDateInputDto;

  @ApiPropertyOptional({
    maxLength: MAX_REASON_LENGTH,
    description: 'Optional note, stored on both legs.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;

  @ApiPropertyOptional({
    maxLength: MAX_REFERENCE_TYPE_LENGTH,
    description:
      'Opaque source reference, stored on both legs. Both-or-neither with referenceId.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_TYPE_LENGTH)
  referenceType?: string;

  @ApiPropertyOptional({
    maxLength: MAX_REFERENCE_ID_LENGTH,
    description:
      'Opaque source reference, stored on both legs. Both-or-neither with referenceType.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  referenceId?: string;

  @ApiPropertyOptional({
    description:
      'Acknowledges that the transfer is dated before the latest movement on one of its two warehouses. A backdated transfer is rejected (422 inventory.backdated_document) until this is true; once confirmed it also requires Inventory.Valuation.Recalculate, because the coupled two-key replay restates both warehouses from the transfer date onward. There is no repricing choice: the pair is valued together (PDR-08 OD-TRF-01/05).',
  })
  @IsOptional()
  @IsBoolean()
  backdateConfirmed?: boolean;
}

export class InventoryTransferResponseDto {
  @ApiProperty({
    format: 'ulid',
    description:
      'The id shared by both legs; use it to list the pair via GET /inventory/movements.',
  })
  transferId!: string;

  @ApiProperty({ type: () => InventoryMovementResponseDto })
  outLeg!: InventoryMovementResponseDto;

  @ApiProperty({ type: () => InventoryMovementResponseDto })
  inLeg!: InventoryMovementResponseDto;
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export class ListInventoryReservationsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
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

  @ApiPropertyOptional({ enum: RESERVATION_STATUSES })
  @IsOptional()
  @IsIn(RESERVATION_STATUSES as readonly string[])
  status?: string;
}

export class CreateInventoryReservationDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Idempotency key for this reservation. Retrying replays the original reservation.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiProperty({
    example: '5',
    description:
      'Positive decimal magnitude in the entered unit, as a string. The claim is held in base units against availability.',
  })
  @IsString()
  @MaxLength(32)
  quantity!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  unitId!: string;

  @ApiPropertyOptional({
    maxLength: MAX_REASON_LENGTH,
    description: 'Optional note explaining the claim.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;

  @ApiPropertyOptional({
    maxLength: MAX_REFERENCE_TYPE_LENGTH,
    description:
      'Opaque owner reference (the future sales document, an external order). Both-or-neither with referenceId; stored, never dereferenced.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_TYPE_LENGTH)
  referenceType?: string;

  @ApiPropertyOptional({
    maxLength: MAX_REFERENCE_ID_LENGTH,
    description: 'Opaque owner reference. Both-or-neither with referenceType.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_ID_LENGTH)
  referenceId?: string;
}

export class ReleaseInventoryReservationDto {
  @ApiProperty({
    maxLength: MAX_OPERATION_KEY_LENGTH,
    description:
      'Idempotency key for this release. Releasing an already-released reservation is rejected with 422, not silently double-applied.',
  })
  @IsString()
  @MinLength(1, { message: 'operationKey is required.' })
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey!: string;
}

export class InventoryReservationResponseDto {
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

  @ApiProperty({
    example: '5',
    description: 'Entered magnitude. Decimal string.',
  })
  quantity!: string;

  @ApiProperty({ format: 'ulid' })
  enteredUnitId!: string;

  @ApiProperty({
    example: '5',
    description: 'Base-unit magnitude. Decimal string.',
  })
  baseQuantity!: string;

  @ApiProperty({ format: 'ulid' })
  baseUnitId!: string;

  @ApiProperty({
    example: '1',
    description: 'Exact factor applied. Decimal string.',
  })
  conversionFactor!: string;

  @ApiProperty({ enum: RESERVATION_STATUSES })
  status!: string;

  @ApiProperty({ nullable: true })
  referenceType!: string | null;

  @ApiProperty({ nullable: true })
  referenceId!: string | null;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty({
    description: 'Idempotency key this reservation was created with.',
  })
  operationKey!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  releasedAt!: string | null;

  @ApiProperty({ nullable: true })
  releasedBy!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Idempotency key the release was posted with.',
  })
  releaseOperationKey!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

// ---------------------------------------------------------------------------
// Balances, availability, reconciliation
// ---------------------------------------------------------------------------

export class ListInventoryBalancesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
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
}

export class InventoryAvailabilityQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;
}

export class InventoryBalanceResponseDto {
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

  @ApiProperty({ example: '100', description: 'Decimal string.' })
  onHand!: string;

  @ApiProperty({ example: '5', description: 'Decimal string.' })
  reserved!: string;

  @ApiProperty({
    example: '95',
    description: 'Derived: onHand − reserved. Decimal string, never stored.',
  })
  available!: string;

  @ApiProperty({
    format: 'date',
    nullable: true,
    example: '2026-10-08',
    description:
      'The newest movement BUSINESS DAY posted to this key — canonical Gregorian YYYY-MM-DD (OQ-73: a calendar day projection of movement_date, never an instant). Null before the first movement.',
  })
  lastMovementDate!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class InventoryAvailabilityResponseDto {
  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  branchId!: string;

  @ApiProperty({ format: 'ulid' })
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({ example: '100', description: 'Decimal string.' })
  onHand!: string;

  @ApiProperty({ example: '5', description: 'Decimal string.' })
  reserved!: string;

  @ApiProperty({
    example: '95',
    description:
      'Derived: onHand − reserved. A key with no stored row reads as zero — absence of facts is absence of stock, not an error.',
  })
  available!: string;

  @ApiProperty({
    description:
      'Effective negative-stock policy for this key: the item override when set, else the warehouse default.',
  })
  allowNegativeStock!: boolean;

  @ApiProperty({
    description:
      "This warehouse's setting: whether ACTIVE reservations reduce the reported `available` figure (C-50). `onHand` above is never affected by this setting either way.",
  })
  reservationsReduceAvailable!: boolean;
}

export class ItemAvailabilityAcrossWarehousesQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;
}

export class ItemWarehouseAvailabilityResponseDto extends InventoryAvailabilityResponseDto {
  @ApiProperty({ description: "The warehouse's code, for display." })
  warehouseCode!: string;

  @ApiProperty({ description: "The warehouse's name, for display." })
  warehouseName!: string;
}

export class ReconcileInventoryBalancesDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Restrict the report to one warehouse.',
  })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Restrict the report to one item.',
  })
  @IsOptional()
  @IsUlid()
  itemId?: string;
}

export class ReconciliationQuantitiesDto {
  @ApiProperty({ example: '100', description: 'Decimal string.' })
  onHand!: string;

  @ApiProperty({ example: '5', description: 'Decimal string.' })
  reserved!: string;
}

export class ReconciliationMismatchDto {
  @ApiProperty({ format: 'ulid' })
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({
    example: '100',
    description: 'Ledger-derived on-hand. Decimal string.',
  })
  expectedOnHand!: string;

  @ApiProperty({
    example: '5',
    description: 'Open-reservations total. Decimal string.',
  })
  expectedReserved!: string;

  @ApiProperty({ format: 'date', nullable: true })
  expectedLastMovementDate!: string | null;

  @ApiProperty({
    type: () => ReconciliationQuantitiesDto,
    nullable: true,
    description: 'Stored projection; null when no row exists for the key.',
  })
  stored!: ReconciliationQuantitiesDto | null;

  @ApiProperty()
  matches!: boolean;
}

export class ReconciliationReportDto {
  @ApiProperty()
  checked!: number;

  @ApiProperty()
  matched!: number;

  @ApiProperty()
  mismatched!: number;

  @ApiProperty({ type: () => ReconciliationMismatchDto, isArray: true })
  mismatches!: ReconciliationMismatchDto[];
}

export class RebuildInventoryBalancesDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Restrict the rebuild to one warehouse.',
  })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Restrict the rebuild to one item.',
  })
  @IsOptional()
  @IsUlid()
  itemId?: string;
}

export class RebuildCorrectionDto {
  @ApiProperty({ format: 'ulid' })
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({
    example: '100',
    description: 'Ledger-derived on-hand. Decimal string.',
  })
  expectedOnHand!: string;

  @ApiProperty({
    example: '5',
    description: 'Open-reservations total. Decimal string.',
  })
  expectedReserved!: string;

  @ApiProperty({ format: 'date', nullable: true })
  expectedLastMovementDate!: string | null;

  @ApiProperty({
    type: () => ReconciliationQuantitiesDto,
    nullable: true,
    description:
      'Stored projection before the rebuild; null when no row existed.',
  })
  storedBefore!: ReconciliationQuantitiesDto | null;

  @ApiProperty({
    enum: ['created', 'updated', 'deleted', 'noop'],
    description:
      'What the rebuild did: created a missing row, updated a drifted row, deleted a phantom row with no facts behind it, or confirmed the row already matched.',
  })
  @IsIn(['created', 'updated', 'deleted', 'noop'])
  action!: string;
}

export class RebuildReportDto {
  @ApiProperty()
  checked!: number;

  @ApiProperty()
  rebuilt!: number;

  @ApiProperty({ type: () => RebuildCorrectionDto, isArray: true })
  corrections!: RebuildCorrectionDto[];
}
