import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { IsBusinessDate } from '../../../../kernel/http/is-business-date.decorator.js';
import { IsBusinessDay } from '../../../../kernel/http/is-business-day.decorator.js';
import type {
  ApiBusinessDate,
  ApiInstant,
} from '../../../../kernel/datetime/api-date-time.js';
import {
  ApiBusinessDateDto,
  ApiInstantDto,
  DECLARED_BUSINESS_DATE_SCHEMA,
  LEGACY_BUSINESS_DATE_INSTANT_SCHEMA,
} from '../../../../kernel/datetime/api-date-time.dto.js';
import { CALENDAR_SYSTEMS } from '../../../../kernel/datetime/calendar-system.js';
import { REPRICING_CHOICES } from '../../domain/backdating.js';
import {
  INVENTORY_DOCUMENT_KINDS,
  INVENTORY_DOCUMENT_STATUSES,
  INVENTORY_DOCUMENT_VALUATION_STATES,
  MAX_DOCUMENT_CANCELLATION_REASON_LENGTH,
  MAX_DOCUMENT_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_REFERENCE_LENGTH,
} from '../../domain/inventory-business-document.js';
import { INVENTORY_DOCUMENT_ACCOUNTING_POSTING_STATES } from '../../domain/inventory-accounting-posting-operation.js';
import { MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH } from '../../domain/inventory-accounting-posting-request.js';

/**
 * Inventory Business Document API contracts (C-58).
 *
 * Transport-only (AR-03): lifecycle rules, side-effect classification, unit
 * conversion, valuation and atomicity live in
 * `inventory-business-documents.service.ts` and the domain layer. These DTOs
 * only shape and bound the HTTP surface.
 *
 * Note the two asymmetries the business contract requires and this file
 * makes visible in the schema: a RECEIPT may carry an optional `cost`; an
 * ISSUE has no cost field at all (sending one is rejected, never silently
 * dropped), and a TRANSFER carries source/destination instead of a single
 * warehouse.
 */

/**
 * The API shape of a declared business date: the SAME `1405-07-16` a Persian
 * user types, plus the calendar that gives it meaning. `YYYY-MM-DD` is
 * identical in both calendars, so the declaration is not optional detail —
 * it is the only thing that distinguishes the two.
 */
export type BusinessDateInputDto =
  string | { calendar: (typeof CALENDAR_SYSTEMS)[number]; value: string };

export class InventoryDocumentLineInputDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiProperty({
    example: '10',
    description: 'Positive decimal magnitude in `unitId`, as an exact string.',
  })
  @IsString()
  @MaxLength(32)
  quantity!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  unitId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'RETURNS ONLY: the movement this return is issued against — the ' +
      'receipt movement for a purchase return (its value is mirrored ' +
      'pro-rata), the issue movement for a sales return (required when a ' +
      'commercial amount is entered). Refused for non-return kinds.',
  })
  @IsOptional()
  @IsUlid()
  basisMovementId?: string;
}

export class CreateInventoryDocumentDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ enum: INVENTORY_DOCUMENT_KINDS })
  @IsIn(INVENTORY_DOCUMENT_KINDS as readonly string[])
  kind!: string;

  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-10-08' },
      LEGACY_BUSINESS_DATE_INSTANT_SCHEMA,
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      'C-63 business date — a calendar DAY (OQ-73: stored as PostgreSQL date, no time-of-day, no time zone). The calendar a day is written in must be declared when it is Jalali: "2026-10-08" (Gregorian, the default), { "calendar": "JALALI", "value": "1405-07-16" }. A full ISO-8601 instant is accepted for backward compatibility and resolved to its UTC calendar day (not the organization display zone). Omitted = today\'s business day in the organization time zone (send an explicit day).',
  })
  @IsOptional()
  @IsBusinessDate()
  businessDate?: BusinessDateInputDto;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Receipt/Issue warehouse. Required for those kinds.',
  })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'Transfer source.' })
  @IsOptional()
  @IsUlid()
  sourceWarehouseId?: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'Transfer destination.' })
  @IsOptional()
  @IsUlid()
  destinationWarehouseId?: string;

  @ApiPropertyOptional({
    example: '1250.00',
    description:
      'RECEIPT ONLY and always optional: an Inventory valuation assignment, never a purchase price. Requires `Inventory.Valuation.AssignCost`. Rejected on an issue or a transfer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  cost?: string;

  @ApiPropertyOptional({ maxLength: MAX_DOCUMENT_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_DESCRIPTION_LENGTH)
  description?: string;

  @ApiPropertyOptional({ maxLength: MAX_DOCUMENT_REFERENCE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_REFERENCE_LENGTH)
  reference?: string;

  @ApiProperty({ type: [InventoryDocumentLineInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InventoryDocumentLineInputDto)
  lines!: InventoryDocumentLineInputDto[];
}

export class UpdateInventoryDocumentDto {
  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', format: 'date', example: '2026-10-08' },
      LEGACY_BUSINESS_DATE_INSTANT_SCHEMA,
      DECLARED_BUSINESS_DATE_SCHEMA,
    ],
    description:
      'C-63 business date. Same three accepted forms as create: a canonical Gregorian day, a declared Jalali day ({ calendar, value }), or a legacy ISO instant (resolved to its UTC calendar day). Omitted = the document keeps its current business date.',
  })
  @IsOptional()
  @IsBusinessDate()
  businessDate?: BusinessDateInputDto;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  sourceWarehouseId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  destinationWarehouseId?: string;

  @ApiPropertyOptional({
    description:
      'Receipt only. Send an empty string to clear the assigned cost.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  cost?: string;

  @ApiPropertyOptional({ maxLength: MAX_DOCUMENT_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_DESCRIPTION_LENGTH)
  description?: string;

  @ApiPropertyOptional({ maxLength: MAX_DOCUMENT_REFERENCE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_REFERENCE_LENGTH)
  reference?: string;

  @ApiPropertyOptional({
    type: [InventoryDocumentLineInputDto],
    minItems: 1,
    description: 'Omit to keep the current lines; provide to REPLACE them.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InventoryDocumentLineInputDto)
  lines?: InventoryDocumentLineInputDto[];

  @ApiPropertyOptional({
    description:
      'OD-54-05: required when the edit changes an already-posted inventory effect. Without it the edit is refused with `inventory.document.side_effect_acknowledgement_required`.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeSideEffects?: boolean;

  @ApiPropertyOptional({
    enum: REPRICING_CHOICES,
    description:
      'OD-VAL-11: required alongside the acknowledgement for a material edit. There is no default — `skip` persists an honestly stale valuation state.',
  })
  @IsOptional()
  @IsIn(REPRICING_CHOICES as readonly string[])
  repricing?: string;
}

export class FinalizeInventoryDocumentDto {
  @ApiPropertyOptional({
    description:
      "OD-VAL-10 acknowledgement, required when the business date is before the key's latest movement.",
  })
  @IsOptional()
  @IsBoolean()
  backdateConfirmed?: boolean;

  @ApiPropertyOptional({ enum: REPRICING_CHOICES })
  @IsOptional()
  @IsIn(REPRICING_CHOICES as readonly string[])
  repricing?: string;
}

export class AccountingPostInventoryDocumentDto {
  @ApiPropertyOptional({
    maxLength: MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH,
    description:
      'Idempotency key (C62-OD-06). Omit it and one is derived from the document, so a UI retry still replays the same durable operation instead of creating a second one. The same key with a different request conflicts (409).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH)
  operationKey?: string;

  @ApiPropertyOptional({
    description:
      'The document revision the caller read. When supplied, the request is refused (409) if the document changed since.',
  })
  @IsOptional()
  @IsString()
  expectedDocumentRevision?: string;
}

export class CancelInventoryDocumentDto {
  @ApiPropertyOptional({ maxLength: MAX_DOCUMENT_CANCELLATION_REASON_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_CANCELLATION_REASON_LENGTH)
  reason?: string;
}

/**
 * ONE durable C-62 Accounting posting operation (C62-OD-05/OD-06).
 *
 * This is the audit record, and the only place a refusal reason is visible:
 * when Accounting refuses, the DOCUMENT keeps its own standing
 * (`not_posted`) rather than absorbing Accounting's verdict, so the reason an
 * operator needs lives here. `null` on `refusalCode`/`refusalReason` means the
 * operation is either still open or succeeded.
 */
export class InventoryAccountingPostingOperationResponseDto {
  @ApiProperty({ format: 'ulid' }) id!: string;
  @ApiProperty({ format: 'ulid' }) organizationId!: string;
  @ApiProperty({ format: 'ulid' }) documentId!: string;
  @ApiProperty({ enum: ['accounting_post', 'accounting_post:cancel'] })
  action!: string;
  @ApiProperty({
    description:
      'The idempotency key this operation is keyed by (C62-OD-06). The same key replays the same answer; a different request under it conflicts.',
  })
  operationKey!: string;
  @ApiProperty({
    description:
      'sha256 over the canonical request payload, so a replay can prove it asks for exactly the same thing.',
  })
  requestHash!: string;
  @ApiProperty({
    description: 'The document revision the request was built from.',
  })
  documentVersion!: string;
  @ApiProperty({ enum: ['direct_final', 'draft'] }) postingMode!: string;
  @ApiProperty({
    enum: [
      'REQUESTED',
      'PENDING',
      'DRAFT_CREATED',
      'POSTED',
      'REFUSED',
      'FAILED',
      'CANCELLED',
    ],
    description:
      'REQUESTED/PENDING mean Accounting has not answered yet — re-query, never infer failure (C62-OD-06).',
  })
  state!: string;
  @ApiProperty({ type: String, nullable: true })
  refusalCode!: string | null;
  @ApiProperty({ type: String, nullable: true })
  refusalReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  accountingDocumentId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The Accounting document serial. `null` while it is still a draft, because numbers allocate at issuance.',
  })
  accountingDocumentNumber!: string | null;
  @ApiProperty({ enum: ['draft', 'temporary', 'final'], nullable: true })
  accountingDocumentPhase!: string | null;
  @ApiProperty({ type: String, nullable: true })
  accountingOperationKey!: string | null;
  @ApiProperty({
    description:
      'True once a FINAL Accounting voucher exists, i.e. the GL effect is real.',
  })
  glPosted!: boolean;
  @ApiProperty({
    description: 'True when this answer replayed an earlier identical request.',
  })
  replayed!: boolean;
  @ApiProperty({ type: String, nullable: true }) actorUserId!: string | null;
  @ApiProperty({
    description:
      'The Inventory permission the initiating human held (C62-OD-03) — the authority this operation ran under.',
  })
  actorPermission!: string;
  @ApiProperty({ format: 'date-time' }) requestedAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  completedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ListInventoryDocumentsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ enum: INVENTORY_DOCUMENT_KINDS })
  @IsOptional()
  @IsIn(INVENTORY_DOCUMENT_KINDS as readonly string[])
  kind?: string;

  @ApiPropertyOptional({ enum: INVENTORY_DOCUMENT_STATUSES })
  @IsOptional()
  @IsIn(INVENTORY_DOCUMENT_STATUSES as readonly string[])
  status?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  warehouseId?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description:
      'INCLUSIVE lower bound on the business day, canonical Gregorian YYYY-MM-DD. A Jalali day is converted to its canonical Gregorian day at the boundary and never filters the database as Jalali text.',
  })
  @IsOptional()
  @IsBusinessDay()
  dateFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description:
      'INCLUSIVE upper bound on the business day, canonical Gregorian YYYY-MM-DD.',
  })
  @IsOptional()
  @IsBusinessDay()
  dateTo?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class InventoryDocumentLineResponseDto {
  @ApiProperty({ format: 'ulid' }) id!: string;
  @ApiProperty() lineNumber!: number;
  @ApiProperty({ format: 'ulid' }) itemId!: string;
  @ApiProperty({ example: '10' }) quantity!: string;
  @ApiProperty({ format: 'ulid' }) unitId!: string;
  @ApiProperty({ example: '120' }) baseQuantity!: string;
  @ApiProperty({ format: 'ulid' }) baseUnitId!: string;
  @ApiProperty({ example: '12' }) conversionFactor!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The receipt/issue movement this line currently owns.',
  })
  movementId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  outMovementId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  inMovementId!: string | null;
}

export class InventoryDocumentResponseDto {
  @ApiProperty({ format: 'ulid' }) id!: string;
  @ApiProperty({ format: 'ulid' }) organizationId!: string;
  @ApiProperty({ enum: INVENTORY_DOCUMENT_KINDS }) kind!: string;
  @ApiProperty({
    enum: INVENTORY_DOCUMENT_VALUATION_STATES,
    nullable: true,
    description:
      'OD-PRC-12 valuation completeness, independent from lifecycle. C-59A supplies it for Receipt; null for document kinds owned by later slices.',
  })
  valuationState!: string;
  @ApiProperty({
    description:
      'True only when lifecycle and authoritative movement valuation permit crossing the Accounting boundary. Permission is separate.',
  })
  accountingEligible!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Allocated at finalize; null while draft. Never reused.',
  })
  number!: string | null;
  @ApiProperty({
    format: 'date',
    example: '2026-10-08',
    description:
      'The document business day — canonical Gregorian YYYY-MM-DD (OQ-73: a calendar day, never an instant). The { gregorian, jalali } rendering is businessDateCalendar.',
  })
  businessDate!: string;

  @ApiProperty({
    type: ApiBusinessDateDto,
    description:
      'C-63: the same canonical business day with a derived Jalali rendering when representable. For a Gregorian organization, `jalali` is null outside the shared rendering range; `businessDate` above remains authoritative.',
  })
  businessDateCalendar!: ApiBusinessDate;
  @ApiProperty({ type: String, nullable: true })
  warehouseId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  sourceWarehouseId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  destinationWarehouseId!: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Receipt only, and only for a caller holding `Inventory.Valuation.View`. Absent (not null) otherwise.',
  })
  cost?: string | null;
  @ApiProperty({ enum: INVENTORY_DOCUMENT_STATUSES }) status!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
  @ApiProperty({ type: String, nullable: true })
  operationKey!: string | null;
  @ApiProperty({
    description:
      'OD-54-06: true when the operator explicitly continued without repricing.',
  })
  valuationStale!: boolean;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty() canFinalize!: boolean;
  @ApiProperty() canAccountingPost!: boolean;
  @ApiProperty() canSeal!: boolean;
  @ApiProperty() canCancel!: boolean;
  @ApiProperty() canDelete!: boolean;
  @ApiProperty({ type: String, nullable: true }) finalizedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) finalizedBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  accountingPostedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  accountingPostedBy!: string | null;

  @ApiProperty({
    enum: INVENTORY_DOCUMENT_ACCOUNTING_POSTING_STATES,
    description:
      'C-62 Accounting standing: `not_posted` | `draft_created` | `final_posted` | `draft_cancelled`. A draft is NOT Accounting Posted; only a final Accounting voucher is.',
  })
  accountingPostingState!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description:
      'The durable C-62 posting operation behind the standing above. The authoritative record; this is its reference.',
  })
  accountingPostingOperationId?: string | null;

  @ApiPropertyOptional({
    description: 'The Accounting-owned document reference, when one exists.',
  })
  accountingDocumentId?: string | null;

  @ApiPropertyOptional({
    description:
      'The Accounting document serial. `null` while the document is still a draft, because numbers allocate at issuance.',
  })
  accountingDocumentNumber?: string | null;

  @ApiPropertyOptional({
    enum: ['draft', 'temporary', 'final'],
    description: 'The Accounting document phase, as Accounting reported it.',
  })
  accountingDocumentPhase?: string | null;
  @ApiProperty({ type: String, nullable: true }) sealedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) sealedBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  cancellationReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;

  @ApiProperty({
    type: ApiInstantDto,
    description:
      'C-63: the creation EVENT timestamp in both calendars, plus the zone it was resolved in. `createdAt` above stays the authoritative instant.',
  })
  createdAtCalendar!: ApiInstant;

  @ApiProperty({
    type: ApiInstantDto,
    description: 'C-63: the last-update EVENT timestamp in both calendars.',
  })
  updatedAtCalendar!: ApiInstant;

  @ApiProperty({ type: [InventoryDocumentLineResponseDto] })
  lines!: InventoryDocumentLineResponseDto[];
}
