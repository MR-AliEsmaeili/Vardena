import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
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
    format: 'date-time',
    description: 'Business date. Defaults to now when omitted.',
  })
  @IsOptional()
  @IsDateString()
  businessDate?: string;

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
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  businessDate?: string;

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

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
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
  @ApiProperty({ format: 'date-time' }) businessDate!: string;
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
  @ApiProperty({ type: [InventoryDocumentLineResponseDto] })
  lines!: InventoryDocumentLineResponseDto[];
}
