import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
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
  MAX_ACCOUNT_CODE_LENGTH,
  MAX_CODING_STRUCTURE_DEPTH,
} from '../../domain/coding-structure.js';
import { ACCOUNT_NATURES } from '../../domain/account.js';
import { BASE_CHART_VERSION_STATUSES } from '../../domain/base-chart-template.js';
import { MAX_CODE_LENGTH, MAX_TITLE_LENGTH } from '../../domain/master-data.js';

/**
 * Base Chart API contracts (Task 23; baseline §2/§3, task §17–§20).
 *
 * Deliberate absences, each one a rule rather than an omission:
 *
 * - **no `status` on any write**: a version's lifecycle moves only through the
 *   dedicated transition endpoints (approve / publish / supersede), so a
 *   client can never smuggle a status the transition table would refuse;
 * - **no `versionNumber`**: sequence assignment is server-side (`max + 1`,
 *   retrying on the ordinal unique index — the Workflow precedent);
 * - **no `organizationId` on template writes**: the template store is a
 *   tenant-NEUTRAL product asset (OD-20-1). The ONE place an organization id
 *   appears is the adoption boundary, where it is required;
 * - **no provenance fields on adoption**: adopted accounts are ORGANIZATION
 *   accounts (identity edges end at the adoption record; writing a source
 *   pointer into `accounts` would reopen the AR-29 schema decision the
 *   baseline deferred);
 * - **no `level` on node input**: node levels are DERIVED from the authored
 *   parent edges (root = 1), so accepting one would let a client disagree
 *   with the tree it is asking for (the `accounts` precedent);
 * - **no POST on `/adoptions` as a collection path**: adoption is a targeted
 *   mutation of the organization's own chart cells, so it rides on the
 *   `adopt-base-chart` action endpoint with a full audit-first DTO.
 */

// ---------------------------------------------------------------------------
// Template lifecycle (draft authoring + transitions)
// ---------------------------------------------------------------------------

export class BaseChartLevelInputDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: MAX_CODING_STRUCTURE_DEPTH,
    description:
      '1-based ordinal of the level inside the version (gapless 1..maxDepth).',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_CODING_STRUCTURE_DEPTH)
  levelIndex!: number;

  @ApiProperty({
    example: 2,
    minimum: 1,
    description: 'Digit width of this level segment.',
  })
  @IsInt()
  @Min(1)
  @Max(8)
  digitLength!: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'Authored postability default for nodes at this level (Task 21 §7). NEVER trusted by the adoption: it re-derives postability leaf-only (OD-20-5).',
  })
  @IsOptional()
  @IsBoolean()
  defaultIsPostable?: boolean;
}

export class BaseChartNodeInputDto {
  @ApiProperty({
    example: 'G-001',
    maxLength: 64,
    description:
      'Template-INTERNAL authoring key (Task 21 §2): unique within ONE version, non-blank, local to the template — it never survives into the organization’s accounts and is never mistaken for an account code. Max length follows the same master-data code width; no format policy is imposed (none is authored in the baseline).',
  })
  @IsString()
  @MinLength(1, { message: 'Node key is required.' })
  @MaxLength(64)
  nodeKey!: string;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description:
      'Authored tree edge in the template key space (null = a root). Self-parenting and cycles are refused by the content planner.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  parentNodeKey?: string | null;

  @ApiProperty({
    example: '10',
    minLength: 1,
    maxLength: MAX_ACCOUNT_CODE_LENGTH,
    description:
      'Canonical digits-only code relative to the version’s own level shape (validated by the same checkAccountCode decision table the chart of accounts uses). Codes of depth N exclusively occupy the first N level-segments and must extend the parent code; the emission never adds segments beyond version depth.',
  })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_ACCOUNT_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Assets',
    maxLength: MAX_TITLE_LENGTH,
    description:
      'Node title. The template carries NO Persian titles and no invented accounting content (task §12/§23); titles stay organization-localizable only AFTER adoption.',
  })
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiProperty({
    enum: ACCOUNT_NATURES,
    description: 'Account nature (the vocabulary of the chart contract).',
  })
  @IsIn([...ACCOUNT_NATURES])
  accountNature!: (typeof ACCOUNT_NATURES)[number];

  @ApiPropertyOptional({
    default: undefined,
    description:
      'Authored postability default. OMITTED = the node’s own level default; explicit false refuses only on non-leaf intent (a non-leaf node can never be postable — OD-20-5 — and an authored postable PARENT is refused at authoring).',
  })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Adoption-COMPLETENESS marker (Task 21 §5): when true, EVERY adoption of this version — full or partial — includes this node together with its ancestor chain in the final adoption set. The marker never survives as behavior on the created accounts (no post-adoption guard exists by design, D-R-4).',
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Storage default carried to the adopted account’s is_active.',
  })
  @IsOptional()
  @IsBoolean()
  defaultIsActive?: boolean;
}

export class CreateBaseChartTemplateDto {
  @ApiProperty({
    maxLength: MAX_CODE_LENGTH,
    description:
      'Stable template code (unique across the product). Trimmed; the master-data convention, no invented format.',
  })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    maxLength: MAX_TITLE_LENGTH,
    description: 'Template title (Persian-capable display name).',
  })
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_CODING_STRUCTURE_DEPTH,
    description:
      'Configured chart depth of version 1 (never hard-coded; the existing 8-level ceiling applies).',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_CODING_STRUCTURE_DEPTH)
  maxDepth!: number;

  @ApiProperty({
    type: [BaseChartLevelInputDto],
    description:
      'The version’s OWN level set: gapless ordinals 1..maxDepth with digit widths. No titles/kinds (the template owns no level vocabulary beyond shape).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BaseChartLevelInputDto)
  levels!: BaseChartLevelInputDto[];

  @ApiProperty({
    type: [BaseChartNodeInputDto],
    description:
      'The full drafted node tree of version 1 (roots first not required — the content planner is input-order independent).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BaseChartNodeInputDto)
  nodes!: BaseChartNodeInputDto[];
}

export class CreateBaseChartVersionDto {
  @ApiProperty({ format: 'ulid', description: 'Owning template.' })
  @IsUlid()
  templateId!: string;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_CODING_STRUCTURE_DEPTH,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_CODING_STRUCTURE_DEPTH)
  maxDepth!: number;

  @ApiProperty({ type: [BaseChartLevelInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BaseChartLevelInputDto)
  levels!: BaseChartLevelInputDto[];

  @ApiProperty({ type: [BaseChartNodeInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BaseChartNodeInputDto)
  nodes!: BaseChartNodeInputDto[];
}

/** The three replaceable draft-content fields (all optional on update). */
class BaseChartVersionContentFields {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_CODING_STRUCTURE_DEPTH,
    description:
      'Replacement chart depth of the draft version (the stored levels/nodes must still fit when only the depth changes).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CODING_STRUCTURE_DEPTH)
  maxDepth?: number;

  @ApiPropertyOptional({
    type: [BaseChartLevelInputDto],
    description:
      'Replacement level set — when present it replaces the whole stored level set (delete-and-replace is legal ONLY on drafts).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BaseChartLevelInputDto)
  levels?: BaseChartLevelInputDto[];

  @ApiPropertyOptional({
    type: [BaseChartNodeInputDto],
    description:
      'Replacement node tree — when present it replaces the whole stored node set.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BaseChartNodeInputDto)
  nodes?: BaseChartNodeInputDto[];
}

/** Draft-content replacement (every field optional; omitted = keep). */
export class UpdateBaseChartVersionContentDto extends PartialType(
  BaseChartVersionContentFields,
) {}

export class RenameBaseChartTemplateDto {
  @ApiProperty({
    maxLength: MAX_TITLE_LENGTH,
    description: 'New template title.',
  })
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;
}

export class TransitionBaseChartVersionDto {
  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'For `supersede` only: the published version that replaces this one (null while the next published version is still being authored).',
  })
  @IsOptional()
  @IsUlid()
  supersededByVersionId?: string | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export class BaseChartTemplateResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class BaseChartTemplateLevelResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;
  @ApiProperty()
  levelIndex!: number;
  @ApiProperty()
  digitLength!: number;
  @ApiProperty()
  defaultIsPostable!: boolean;
}

export class BaseChartTemplateNodeResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;
  @ApiProperty({ description: 'Template-internal key (of THIS version).' })
  nodeKey!: string;
  @ApiProperty({ nullable: true })
  parentNodeKey!: string | null;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty({ enum: ACCOUNT_NATURES })
  accountNature!: string;
  @ApiProperty()
  isPostable!: boolean;
  @ApiProperty()
  isMandatory!: boolean;
  @ApiProperty()
  defaultIsActive!: boolean;
  @ApiProperty()
  level!: number;
}

export class BaseChartTemplateVersionResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;
  @ApiProperty({ format: 'ulid' })
  templateId!: string;
  @ApiProperty()
  versionNumber!: number;
  @ApiProperty({ description: 'Owning template code.' })
  templateCode!: string;
  @ApiProperty({ enum: BASE_CHART_VERSION_STATUSES })
  status!: string;
  @ApiProperty()
  maxDepth!: number;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  approvedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  publishedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  supersededAt!: string | null;
  @ApiProperty({ nullable: true, format: 'ulid' })
  supersededByVersionId!: string | null;
  @ApiProperty({ type: [BaseChartTemplateLevelResponseDto] })
  levels!: BaseChartTemplateLevelResponseDto[];
  @ApiProperty({ type: [BaseChartTemplateNodeResponseDto] })
  nodes!: BaseChartTemplateNodeResponseDto[];
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class ListBaseChartTemplatesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Filter by exact template code.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ description: 'Search code or title (insensitive).' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  search?: string;
}

export class ListBaseChartVersionsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning template.' })
  @IsUlid()
  templateId!: string;

  @ApiPropertyOptional({ enum: BASE_CHART_VERSION_STATUSES })
  @IsOptional()
  @IsIn([...BASE_CHART_VERSION_STATUSES])
  status?: (typeof BASE_CHART_VERSION_STATUSES)[number];
}

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

export class AdoptBaseChartDto {
  @ApiProperty({
    format: 'ulid',
    description:
      'The organization adopting the base chart (its CURRENT empty chart is the only legal target).',
  })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'The PUBLISHED base chart template version to adopt.',
  })
  @IsUlid()
  templateVersionId!: string;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description:
      'Partial adoption selection in template node keys. Omitted or null = the WHOLE version. The FINAL adoption set is always requested ∪ ALL ancestor chains ∪ ALL mandatory nodes, computed and validated BEFORE any write — a partial adoption can never leave the tree broken, and a failed adoption writes nothing.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  selectedNodeKeys?: string[] | null;
}

export class BaseChartAdoptionResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;
  @ApiProperty({ format: 'ulid' })
  organizationId!: string;
  @ApiProperty({ format: 'ulid' })
  templateVersionId!: string;
  @ApiProperty({ format: 'ulid' })
  templateId!: string;
  @ApiProperty()
  templateCode!: string;
  @ApiProperty()
  versionNumber!: number;
  @ApiProperty({ format: 'ulid' })
  accountingConfigurationId!: string;
  @ApiProperty({ format: 'ulid' })
  codingStructureVersionId!: string;
  @ApiProperty({
    description: 'Final adoption set size (selected ∪ ancestors ∪ mandatory).',
  })
  accountCount!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  adoptedAt!: string;
  @ApiProperty({ nullable: true })
  adoptedBy!: string | null;
}

export class ListBaseChartAdoptionsQueryDto extends PageQueryDto {
  @ApiProperty({
    format: 'ulid',
    description: 'Owning organization (never cross-organization).',
  })
  @IsUlid()
  organizationId!: string;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export class BaseChartPlannedNodeDto {
  @ApiProperty()
  nodeKey!: string;
  @ApiProperty({ nullable: true })
  parentNodeKey!: string | null;
  @ApiProperty()
  level!: number;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty({ enum: ACCOUNT_NATURES })
  accountNature!: string;
  @ApiProperty({
    description:
      'Derived, leaf-only (OD-20-5): false whenever the node has children in the FINAL adoption set.',
  })
  isPostable!: boolean;
  @ApiProperty()
  isMandatory!: boolean;
  @ApiProperty({
    description: 'The is_active default carried to the adopted account copy.',
  })
  defaultIsActive!: boolean;
}

export class BaseChartAdoptionPreviewResponseDto {
  @ApiProperty({
    enum: ['compatible', 'incompatible'],
    description:
      'The outcome of re-validating template compatibility AND computing the final adoption set WITHOUT writing anything.',
  })
  verdict!: 'compatible' | 'incompatible';
  @ApiPropertyOptional({
    description:
      'When incompatible: the refusal problem (template/selection domain vocabulary), never the internal message.',
  })
  problem?: string | undefined;
  @ApiPropertyOptional({
    description: 'The offending node key, when one is named.',
  })
  subject?: string | undefined;
  @ApiProperty({
    description:
      'The FINAL adoption set (requested ∪ ancestors ∪ mandatory), in deterministic topological order — what an adoption WOULD insert.',
  })
  finalNodeCount!: number;
  @ApiProperty({ type: [BaseChartPlannedNodeDto] })
  finalSet!: BaseChartPlannedNodeDto[];
}
