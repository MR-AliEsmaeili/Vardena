import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import {
  MAX_SERIAL_LENGTH,
  MAX_SERIES_NAME_LENGTH,
  MAX_SCOPE_KEY_LENGTH,
  MAX_NUMBERING_WIDTH,
  NUMBERING_REUSE_POLICIES,
  NUMBERING_STRATEGIES,
} from '../../domain/numbering.js';
import {
  MAX_DOCUMENT_TYPE_CODE_LENGTH,
  MAX_MODULE_NAME_LENGTH,
} from '../../domain/document-type.js';

/**
 * Numbering API contracts (Task 8 §11/§20).
 *
 * Series are configured here; the numbering ledger (allocations) is exposed
 * read-only for inspection. There is no HTTP "allocate a number" endpoint:
 * allocation is a module-internal service call made inside the owning module's
 * document transaction (Task 8 §20).
 */

export class ListNumberingSeriesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ example: 'inventory_receipt' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_TYPE_CODE_LENGTH)
  documentType?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

export class CreateNumberingSeriesDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ example: 'inventory_receipt' })
  @IsString()
  @MaxLength(MAX_DOCUMENT_TYPE_CODE_LENGTH)
  documentType!: string;

  @ApiPropertyOptional({
    maxLength: MAX_SCOPE_KEY_LENGTH,
    description:
      'Opaque series token; empty = the type’s default series. Metadata about where the number comes from — never part of the serial itself.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SCOPE_KEY_LENGTH)
  scopeKey?: string;

  @ApiProperty({
    example: 'Default receipts',
    maxLength: MAX_SERIES_NAME_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_SERIES_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    enum: NUMBERING_STRATEGIES,
    default: 'monotonic',
    description: 'Numbering strategy. Only `monotonic` is implemented.',
  })
  @IsOptional()
  @IsIn(NUMBERING_STRATEGIES as readonly string[])
  strategy?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_NUMBERING_WIDTH,
    default: 0,
    description: 'Zero-padding width for the numeric serial (0 = no padding).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_NUMBERING_WIDTH)
  width?: number;

  @ApiPropertyOptional({
    enum: NUMBERING_REUSE_POLICIES,
    default: 'never',
    description:
      'Reuse policy. `never` is the implemented behaviour; `recycle` is the documented seam for later document-deletion integration (OQ-12).',
  })
  @IsOptional()
  @IsIn(NUMBERING_REUSE_POLICIES as readonly string[])
  reusePolicy?: string;
}

export class UpdateNumberingSeriesDto {
  @ApiPropertyOptional({ maxLength: MAX_SERIES_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name cannot be blank.' })
  @MaxLength(MAX_SERIES_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: NUMBERING_STRATEGIES })
  @IsOptional()
  @IsIn(NUMBERING_STRATEGIES as readonly string[])
  strategy?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_NUMBERING_WIDTH })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_NUMBERING_WIDTH)
  width?: number;

  @ApiPropertyOptional({ enum: NUMBERING_REUSE_POLICIES })
  @IsOptional()
  @IsIn(NUMBERING_REUSE_POLICIES as readonly string[])
  reusePolicy?: string;

  @ApiPropertyOptional({
    description:
      'Disable blocks new allocations; allocated numbers stay valid.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class NumberingSeriesResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'inventory_receipt' })
  documentType!: string;

  @ApiProperty({ example: '' })
  scopeKey!: string;

  @ApiProperty({ example: 'Default receipts' })
  name!: string;

  @ApiProperty({ example: 'monotonic' })
  strategy!: string;

  @ApiProperty({ example: 0 })
  width!: number;

  @ApiProperty({ example: 'never' })
  reusePolicy!: string;

  @ApiProperty({
    example: '42',
    description: 'Highest serial allocated so far (string — exact integer).',
  })
  lastValue!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ListNumberingAllocationsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  seriesId?: string;

  @ApiPropertyOptional({ example: 'inventory_receipt' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_TYPE_CODE_LENGTH)
  documentType?: string;

  @ApiPropertyOptional({ maxLength: MAX_MODULE_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MODULE_NAME_LENGTH)
  referenceModule?: string;

  @ApiPropertyOptional({ maxLength: MAX_DOCUMENT_TYPE_CODE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DOCUMENT_TYPE_CODE_LENGTH)
  referenceDocumentType?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  referenceDocumentId?: string;
}

export class NumberingAllocationResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  seriesId!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'inventory_receipt' })
  documentType!: string;

  @ApiProperty({ example: '00042', maxLength: MAX_SERIAL_LENGTH })
  number!: string;

  @ApiProperty({ nullable: true, maxLength: MAX_MODULE_NAME_LENGTH })
  referenceModule!: string | null;

  @ApiProperty({ nullable: true, maxLength: MAX_DOCUMENT_TYPE_CODE_LENGTH })
  referenceDocumentType!: string | null;

  @ApiProperty({ nullable: true, format: 'ulid' })
  referenceDocumentId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
