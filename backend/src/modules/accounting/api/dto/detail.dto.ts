import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_DETAIL_CODE_LENGTH,
  MAX_DETAIL_STRUCTURE_DEPTH,
} from '../../domain/detail-structure.js';
import { MAX_TITLE_LENGTH } from '../../domain/master-data.js';

export class CreateDetailDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    example: '01',
    minLength: 1,
    maxLength: MAX_DETAIL_CODE_LENGTH,
    description: 'Canonical code matching the level segment digits.',
  })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_DETAIL_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Bank Melli Branches',
    maxLength: MAX_TITLE_LENGTH,
    description: 'Detail title.',
  })
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'Parent detail record. Omitted or null = Level 1 (Detail Group).',
  })
  @IsOptional()
  @IsUlid()
  parentId?: string | null;

  @ApiPropertyOptional({
    description: 'Posting eligibility (default: true). Must be a leaf.',
  })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;
}

export class UpdateDetailDto {
  @ApiPropertyOptional({ maxLength: MAX_TITLE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Title cannot be blank.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    description: 'Posting eligibility. Refused when the record has children.',
  })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description: 'Re-parent the detail record.',
  })
  @IsOptional()
  @IsUlid()
  parentId?: string | null;
}

export class ListDetailsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  parentId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_DETAIL_STRUCTURE_DEPTH,
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_DETAIL_STRUCTURE_DEPTH)
  level?: number;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isPostable?: boolean;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  detailStructureVersionId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code or title.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class DetailResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: '01' })
  code!: string;

  @ApiProperty({ example: 'Bank Melli Branches' })
  title!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ example: 1 })
  level!: number;

  @ApiProperty({ format: 'ulid' })
  detailStructureVersionId!: string;

  @ApiProperty()
  isPostable!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
