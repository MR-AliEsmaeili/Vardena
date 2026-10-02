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
import {
  MAX_DOCUMENT_TYPE_CODE_LENGTH,
  MAX_MODULE_NAME_LENGTH,
} from '../../../documents/domain/document-type.js';
import {
  MATERIAL_REQUEST_STATUSES,
  MAX_DESCRIPTION_LENGTH,
  MAX_REASON_LENGTH,
} from '../../domain/material-request.js';

/**
 * Material Request API contracts (C-50).
 *
 * Transport-only (AR-03): every business rule (status transitions, unit
 * conversion, reservation availability, approver-only reversal, invocation
 * caps) lives in `material-requests.service.ts` / the domain layer. DTOs
 * here only shape and bound the HTTP surface.
 */

export class MaterialRequestLineInputDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiProperty({
    format: 'ulid',
    description:
      "The line's OWN warehouse (Owner decision: the system never splits a " +
      'line across warehouses — a 60/40 split is two lines the caller creates).',
  })
  @IsUlid()
  warehouseId!: string;

  @ApiProperty({
    example: '10',
    description: 'Positive decimal magnitude in `unitId`, as a string.',
  })
  @IsString()
  @MaxLength(32)
  quantity!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  unitId!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Optional per line (Owner decision): when true, approval reserves ' +
      'this exact item/warehouse/quantity if available, or the whole ' +
      'approval is refused — never a partial reservation for this line.',
  })
  @IsOptional()
  @IsBoolean()
  reservationRequested?: boolean;
}

export class CreateMaterialRequestDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiProperty({ type: [MaterialRequestLineInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MaterialRequestLineInputDto)
  lines!: MaterialRequestLineInputDto[];
}

export class UpdateMaterialRequestDto {
  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    type: [MaterialRequestLineInputDto],
    minItems: 1,
    description:
      'Omit to leave the line set unchanged; provide to REPLACE it ' +
      'wholesale. Only valid while the request is still a draft.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MaterialRequestLineInputDto)
  lines?: MaterialRequestLineInputDto[];
}

export class ListMaterialRequestsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ enum: MATERIAL_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(MATERIAL_REQUEST_STATUSES as readonly string[])
  status?: string;

  @ApiPropertyOptional({ format: 'ulid', description: 'Filter by requester.' })
  @IsOptional()
  @IsUlid()
  requestedBy?: string;
}

export class RejectMaterialRequestDto {
  @ApiProperty({
    maxLength: MAX_REASON_LENGTH,
    description: 'Required — rejection must carry a reason.',
  })
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason!: string;
}

export class ReverseMaterialRequestApprovalDto {
  @ApiPropertyOptional({ maxLength: MAX_REASON_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;
}

export class InvokeMaterialRequestLineDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  lineId!: string;

  @ApiProperty({
    example: 'inventory',
    description: 'The destination process module (not hardcoded to one type).',
  })
  @IsString()
  @MaxLength(MAX_MODULE_NAME_LENGTH)
  destinationModule!: string;

  @ApiProperty({
    example: 'inventory_movement',
    description:
      'Must be a Documents type the destination module registered — ' +
      'checked before the invocation is recorded.',
  })
  @IsString()
  @MaxLength(MAX_DOCUMENT_TYPE_CODE_LENGTH)
  destinationDocumentType!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  destinationDocumentId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  destinationLineId?: string;

  @ApiProperty({
    example: '10',
    description:
      "Entered in the line's OWN unit, converted with the line's own " +
      'recorded conversion factor. Capped at the quantity still remaining ' +
      'on the line; multiple/partial invocations are allowed.',
  })
  @IsString()
  @MaxLength(32)
  quantity!: string;
}

export class MaterialRequestLineResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  materialRequestId!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  branchId!: string;

  @ApiProperty()
  lineNumber!: number;

  @ApiProperty({ format: 'ulid' })
  itemId!: string;

  @ApiProperty({ format: 'ulid' })
  warehouseId!: string;

  @ApiProperty({ description: 'Decimal string, entered magnitude.' })
  quantity!: string;

  @ApiProperty({ format: 'ulid' })
  unitId!: string;

  @ApiProperty({ description: 'Decimal string, base-unit equivalent.' })
  baseQuantity!: string;

  @ApiProperty({ format: 'ulid' })
  baseUnitId!: string;

  @ApiProperty({ description: 'Decimal string.' })
  conversionFactor!: string;

  @ApiProperty()
  reservationRequested!: boolean;

  @ApiProperty({
    nullable: true,
    format: 'ulid',
    description: 'Set only once approval successfully reserved this line.',
  })
  reservationId!: string | null;

  @ApiProperty({ description: 'Derived from document relations, never stored.' })
  invokedBaseQuantity!: string;

  @ApiProperty({ description: 'baseQuantity − invokedBaseQuantity.' })
  remainingBaseQuantity!: string;

  @ApiProperty()
  invocationCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class MaterialRequestResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ nullable: true, description: 'Allocated at submission.' })
  number!: string | null;

  @ApiProperty({ enum: MATERIAL_REQUEST_STATUSES })
  status!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ format: 'ulid' })
  requestedBy!: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  submittedAt!: string | null;

  @ApiProperty({ nullable: true, format: 'ulid' })
  submittedBy!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  approvedAt!: string | null;

  @ApiProperty({ nullable: true, format: 'ulid' })
  approvedBy!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  rejectedAt!: string | null;

  @ApiProperty({ nullable: true, format: 'ulid' })
  rejectedBy!: string | null;

  @ApiProperty({ nullable: true })
  rejectionReason!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  approvalReversedAt!: string | null;

  @ApiProperty({ nullable: true, format: 'ulid' })
  approvalReversedBy!: string | null;

  @ApiProperty({ nullable: true })
  approvalReversalReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class MaterialRequestDetailResponseDto extends MaterialRequestResponseDto {
  @ApiProperty({ type: [MaterialRequestLineResponseDto] })
  lines!: MaterialRequestLineResponseDto[];
}

export class MaterialRequestEventResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  materialRequestId!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ nullable: true })
  fromStatus!: string | null;

  @ApiProperty({ nullable: true })
  toStatus!: string | null;

  @ApiProperty({ nullable: true, format: 'ulid' })
  actorId!: string | null;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Opaque pointer (a line id, reservation id, or document-relation id ' +
      'depending on eventType). Never a foreign key.',
  })
  referenceId!: string | null;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
