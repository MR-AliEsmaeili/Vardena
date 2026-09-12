import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';

/**
 * Document type API contracts (Task 8 §6/§20).
 *
 * Types are READ-ONLY metadata here (the registry is code): the only write is
 * the organization's configuration (`draftRequired`). There is no endpoint
 * that creates a document type — that is a code change, never a client
 * operation.
 */

export class ListDocumentTypesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code, module or name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class DocumentTypeResponseDto {
  @ApiProperty({ example: 'inventory_receipt' })
  code!: string;

  @ApiProperty({ example: 'inventory' })
  module!: string;

  @ApiProperty({ example: 'Inventory receipt' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'Goods received into stock.' })
  description!: string | null;

  @ApiProperty({
    description: 'Whether the pre-issuance draft phase is available.',
  })
  draftCapable!: boolean;

  @ApiProperty({
    enum: ['temporary', 'final'],
    isArray: true,
    description: 'The states a document may enter issuance in.',
  })
  entryStates!: string[];

  @ApiProperty({
    enum: ['draft', 'temporary', 'final'],
    isArray: true,
    description: 'The phases in which deletion is permitted.',
  })
  deletablePhases!: string[];

  @ApiProperty({
    description:
      'Organization configuration: whether documents of this type must pass through draft before issuance.',
  })
  draftRequired!: boolean;

  @ApiProperty({
    description: 'Whether the organization has configured this type.',
  })
  configured!: boolean;
}

export class DocumentTypeCodeQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class ConfigureDocumentTypeDto {
  @ApiProperty({
    description:
      'Whether documents of this type enter the draft phase before issuance (Task 8 §8).',
  })
  @IsBoolean()
  draftRequired!: boolean;
}
