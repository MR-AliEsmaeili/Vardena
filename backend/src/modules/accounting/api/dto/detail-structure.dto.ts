import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  DETAIL_STRUCTURE_STATUSES,
  MAX_DETAIL_CODE_LENGTH,
  MAX_DETAIL_STRUCTURE_DEPTH,
  MIN_DETAIL_LEVEL_DIGIT_LENGTH,
} from '../../domain/detail-structure.js';
import { MAX_TITLE_LENGTH } from '../../domain/master-data.js';

export class DetailStructureLevelInputDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: MAX_DETAIL_STRUCTURE_DEPTH,
    description: '1-based ordinal inside the version (1..maxDepth).',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_DETAIL_STRUCTURE_DEPTH)
  levelIndex!: number;

  @ApiProperty({
    example: 'Detail Group',
    maxLength: MAX_TITLE_LENGTH,
    description: 'Level title the organization configures.',
  })
  @IsString()
  @MinLength(1, { message: 'Level title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiProperty({
    example: 4,
    minimum: MIN_DETAIL_LEVEL_DIGIT_LENGTH,
    maximum: MAX_DETAIL_CODE_LENGTH,
    description: 'Digits this level contributes to a detail code.',
  })
  @IsInt()
  @Min(MIN_DETAIL_LEVEL_DIGIT_LENGTH)
  @Max(MAX_DETAIL_CODE_LENGTH)
  digitLength!: number;
}

export class CreateDetailStructureVersionDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    example: 'Standard Detail Hierarchy',
    maxLength: MAX_TITLE_LENGTH,
    description: 'Optional human title for the detail structure.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @ApiProperty({
    example: 3,
    minimum: 1,
    maximum: MAX_DETAIL_STRUCTURE_DEPTH,
    description: 'Number of levels in this hierarchy.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_DETAIL_STRUCTURE_DEPTH)
  maxDepth!: number;

  @ApiProperty({
    type: [DetailStructureLevelInputDto],
    description: 'Levels in the structure (ordinals 1..maxDepth).',
    example: [
      { levelIndex: 1, title: 'Detail Group', digitLength: 2 },
      { levelIndex: 2, title: 'Detail Level 2', digitLength: 4 },
      { levelIndex: 3, title: 'Detail Level 3', digitLength: 4 },
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DetailStructureLevelInputDto)
  levels!: DetailStructureLevelInputDto[];
}

export class UpdateDetailStructureVersionDto {
  @ApiPropertyOptional({
    example: 'Updated Detail Hierarchy',
    maxLength: MAX_TITLE_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_DETAIL_STRUCTURE_DEPTH,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DETAIL_STRUCTURE_DEPTH)
  maxDepth?: number;

  @ApiPropertyOptional({
    type: [DetailStructureLevelInputDto],
    description: 'Replaces the level set (draft only).',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DetailStructureLevelInputDto)
  levels?: DetailStructureLevelInputDto[];
}

export class ListDetailStructuresQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ enum: DETAIL_STRUCTURE_STATUSES })
  @IsOptional()
  @IsIn([...DETAIL_STRUCTURE_STATUSES])
  status?: (typeof DETAIL_STRUCTURE_STATUSES)[number];
}

export class DetailStructureLevelResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty()
  levelIndex!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  digitLength!: number;
}

export class DetailStructureVersionResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 1 })
  versionNumber!: number;

  @ApiProperty({ enum: DETAIL_STRUCTURE_STATUSES })
  status!: (typeof DETAIL_STRUCTURE_STATUSES)[number];

  @ApiProperty({ nullable: true })
  title!: string | null;

  @ApiProperty()
  maxDepth!: number;

  @ApiProperty({
    example: '2 + 4 + 4',
    description: 'Derived summary pattern.',
  })
  pattern!: string;

  @ApiProperty({ type: [DetailStructureLevelResponseDto] })
  levels!: DetailStructureLevelResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
