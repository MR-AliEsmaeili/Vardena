import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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
  ACCOUNT_LEVEL_KINDS,
  CODING_STRUCTURE_SEPARATORS,
  CODING_STRUCTURE_STATUSES,
  MAX_ACCOUNT_CODE_LENGTH,
  MAX_CODING_STRUCTURE_DEPTH,
  MIN_LEVEL_DIGIT_LENGTH,
} from '../../domain/coding-structure.js';
import { MAX_CODE_LENGTH, MAX_TITLE_LENGTH } from '../../domain/master-data.js';

/**
 * Coding structure API contracts (§9, AC-D-10).
 *
 * The DTO validates the SHAPE (types, widths, closed lists, bounds); the
 * *meaning* of a structure — ordinals covering 1..maxDepth, digit lengths that
 * add up inside the architecture cap — is decided by
 * `domain/coding-structure.ts::planCodingStructure`, which runs on the write,
 * on the publish gate, and again inside the publish transaction.
 *
 * Nothing here hardcodes a coding layout: `maxDepth`, the per-level titles and
 * the per-level digit lengths are all request data, and the response carries a
 * derived `pattern` (e.g. `2 + 3 + 3`) so a client can render the configuration
 * without re-deriving it.
 */

/** One level definition as a caller supplies it. */
export class CodingStructureLevelInputDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: MAX_CODING_STRUCTURE_DEPTH,
    description: '1-based ordinal inside the version; must cover 1..maxDepth.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_CODING_STRUCTURE_DEPTH)
  levelIndex!: number;

  @ApiProperty({
    example: 'Group',
    maxLength: MAX_TITLE_LENGTH,
    description:
      'Level title the organization sees (Persian titles are first-class: `گروه / کل / معین / تفصیلی`). Level names carry no behaviour: nothing infers postability from a title (§8.1).',
  })
  @IsString()
  @MinLength(1, { message: 'Level title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiProperty({
    example: 2,
    minimum: MIN_LEVEL_DIGIT_LENGTH,
    maximum: MAX_ACCOUNT_CODE_LENGTH,
    description:
      'Digits this level contributes to an account code. The sum across the version is bounded by the code length cap.',
  })
  @IsInt()
  @Min(MIN_LEVEL_DIGIT_LENGTH)
  @Max(MAX_ACCOUNT_CODE_LENGTH)
  digitLength!: number;

  @ApiProperty({
    description:
      'Default `isPostable` for accounts created at this level (§14 rule 4) — a default, never a rule.',
  })
  @IsBoolean()
  defaultIsPostable!: boolean;

  @ApiPropertyOptional({
    enum: ACCOUNT_LEVEL_KINDS,
    nullable: true,
    description:
      'Informational label only (`group`/`general`/`subsidiary`/`detail`). Nothing derives behaviour from it (§8.1); repeat or omit as the organization prefers.',
  })
  @IsOptional()
  @IsIn([...ACCOUNT_LEVEL_KINDS])
  levelKind?: (typeof ACCOUNT_LEVEL_KINDS)[number] | null;
}

export class CreateCodingStructureVersionDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    example: 'DEFAULT',
    maxLength: MAX_CODE_LENGTH,
    description:
      'Structure code: names one configurable structure inside the organization. Versions of one structure share it.',
  })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 3,
    minimum: 1,
    maximum: MAX_CODING_STRUCTURE_DEPTH,
    description:
      'Number of levels (1..8 — an architecture cap, not business policy, §9.1).',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_CODING_STRUCTURE_DEPTH)
  maxDepth!: number;

  @ApiPropertyOptional({
    enum: CODING_STRUCTURE_SEPARATORS,
    default: '',
    description:
      'DISPLAY ONLY (§9.2): how a code renders. Never stored inside a code, never part of uniqueness.',
  })
  @IsOptional()
  @IsIn([...CODING_STRUCTURE_SEPARATORS])
  separator?: (typeof CODING_STRUCTURE_SEPARATORS)[number];

  @ApiProperty({
    type: [CodingStructureLevelInputDto],
    description:
      'Exactly one row per level (ordinals 1..maxDepth, no gaps, no duplicates).',
    example: [
      {
        levelIndex: 1,
        title: 'Group',
        digitLength: 2,
        defaultIsPostable: false,
        levelKind: 'group',
      },
      {
        levelIndex: 2,
        title: 'General',
        digitLength: 3,
        defaultIsPostable: false,
        levelKind: 'general',
      },
      {
        levelIndex: 3,
        title: 'Subsidiary',
        digitLength: 3,
        defaultIsPostable: true,
        levelKind: 'subsidiary',
      },
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CodingStructureLevelInputDto)
  levels!: CodingStructureLevelInputDto[];
}

export class UpdateCodingStructureVersionDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_CODING_STRUCTURE_DEPTH,
    description:
      'New depth. The stored level set is re-validated against it, so shrinking below the levels that exist is refused.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CODING_STRUCTURE_DEPTH)
  maxDepth?: number;

  @ApiPropertyOptional({ enum: CODING_STRUCTURE_SEPARATORS })
  @IsOptional()
  @IsIn([...CODING_STRUCTURE_SEPARATORS])
  separator?: (typeof CODING_STRUCTURE_SEPARATORS)[number];

  @ApiPropertyOptional({
    type: [CodingStructureLevelInputDto],
    description:
      'Replaces the whole level set (draft only). An omitted field keeps its stored value.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CodingStructureLevelInputDto)
  levels?: CodingStructureLevelInputDto[];
}

export class ListCodingStructuresQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    example: 'DEFAULT',
    description: 'Only versions of one named structure.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ enum: CODING_STRUCTURE_STATUSES })
  @IsOptional()
  @IsIn([...CODING_STRUCTURE_STATUSES])
  status?: (typeof CODING_STRUCTURE_STATUSES)[number];

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on the structure code.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class CodingStructureLevelResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty()
  levelIndex!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  digitLength!: number;

  @ApiProperty()
  defaultIsPostable!: boolean;

  @ApiProperty({ nullable: true })
  levelKind!: string | null;
}

export class CodingStructureVersionResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'DEFAULT' })
  code!: string;

  @ApiProperty({ example: 1 })
  versionNumber!: number;

  @ApiProperty({ enum: CODING_STRUCTURE_STATUSES })
  status!: (typeof CODING_STRUCTURE_STATUSES)[number];

  @ApiProperty()
  maxDepth!: number;

  @ApiProperty({ description: 'Display-only separator ("" = none).' })
  separator!: string;

  @ApiProperty({
    example: '2 + 3 + 3',
    description: 'Derived summary of the level set (read-only).',
  })
  pattern!: string;

  @ApiProperty({ type: [CodingStructureLevelResponseDto] })
  levels!: CodingStructureLevelResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
