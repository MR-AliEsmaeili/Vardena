import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_DOCUMENT_TYPE_CODE_LENGTH,
  MAX_MODULE_NAME_LENGTH,
} from '../../domain/document-type.js';
import { RELATION_KINDS } from '../../domain/document-relation.js';

/**
 * Document relation API contracts (Task 8 §13/§20).
 *
 * Source and target are logical references (module + type + id + optional line
 * id) — the Foundation stores links, it does not dereference module tables.
 */

export class DocumentEndpointDto {
  @ApiProperty({ example: 'sales' })
  @IsString()
  @MaxLength(MAX_MODULE_NAME_LENGTH)
  module!: string;

  @ApiProperty({ example: 'sales_invoice' })
  @IsString()
  @MaxLength(MAX_DOCUMENT_TYPE_CODE_LENGTH)
  documentType!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  documentId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  lineId?: string;
}

/** A stored endpoint as the API returns it: `lineId` is explicit null. */
export class DocumentEndpointResponseDto {
  @ApiProperty({ example: 'sales' })
  module!: string;

  @ApiProperty({ example: 'sales_invoice' })
  documentType!: string;

  @ApiProperty({ format: 'ulid' })
  documentId!: string;

  @ApiProperty({ nullable: true, format: 'ulid' })
  lineId!: string | null;
}

export class CreateDocumentRelationDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ type: DocumentEndpointDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DocumentEndpointDto)
  source!: DocumentEndpointDto;

  @ApiProperty({ type: DocumentEndpointDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DocumentEndpointDto)
  target!: DocumentEndpointDto;

  @ApiProperty({ enum: RELATION_KINDS })
  @IsIn(RELATION_KINDS as readonly string[])
  relationKind!: string;

  @ApiPropertyOptional({
    pattern: '^\\d{1,14}(\\.\\d{1,4})?$',
    description:
      'Base-unit quantity. Required for `fulfill`, forbidden for every other kind.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,14}(\.\d{1,4})?$/)
  quantity?: string;
}

export class DocumentRelationResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ type: DocumentEndpointResponseDto })
  source!: DocumentEndpointResponseDto;

  @ApiProperty({ type: DocumentEndpointResponseDto })
  target!: DocumentEndpointResponseDto;

  @ApiProperty({ enum: RELATION_KINDS })
  relationKind!: string;

  @ApiProperty({ nullable: true })
  quantity!: string | null;

  @ApiProperty({
    description:
      'Whether an automation (true) or a user (false) created the link.',
  })
  createdByProcess!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ListDocumentRelationsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ enum: RELATION_KINDS })
  @IsOptional()
  @IsIn(RELATION_KINDS as readonly string[])
  relationKind?: string;

  @ApiPropertyOptional({ example: 'sales' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MODULE_NAME_LENGTH)
  sourceModule?: string;

  @ApiPropertyOptional({ example: 'sales_invoice' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_TYPE_CODE_LENGTH)
  sourceDocumentType?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  sourceDocumentId?: string;

  @ApiPropertyOptional({ example: 'accounting' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MODULE_NAME_LENGTH)
  targetModule?: string;

  @ApiPropertyOptional({ example: 'accounting_journal' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_TYPE_CODE_LENGTH)
  targetDocumentType?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  targetDocumentId?: string;
}
