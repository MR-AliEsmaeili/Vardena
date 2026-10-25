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
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_ACCOUNT_CODE_LENGTH,
  MAX_CODING_STRUCTURE_DEPTH,
} from '../../domain/coding-structure.js';
import {
  ACCOUNT_DETAIL_UNLINK_WARNING,
  ACCOUNT_NATURES,
  ACCOUNT_TYPES,
} from '../../domain/account.js';
import { MAX_TITLE_LENGTH } from '../../domain/master-data.js';

/**
 * Account API contracts (§8/§9/§14).
 *
 * Three deliberate absences, each one a contract rule rather than an omission:
 *
 * - **no `level`**: a level is DERIVED (root = 1, child = parent + 1,
 *   AC-I-10 rule 1), so accepting one would let a client disagree with the
 *   tree it is asking for;
 * - **no `code` on update**: the code is immutable once created (§8.3) and is
 *   never reused (§8.6), so there is no field to send;
 * - **no DELETE endpoint / permission**: accounts are never deleted (§8.6,
 *   OQ-36 posture); deactivation is the whole lifecycle.
 *
 * The DTO validates the SHAPE (digits only, width); the MEANING — that the
 * code's length matches the configured level segments and that a child extends
 * its parent's code — is decided by `domain/account-code.ts` against the
 * pinned coding-structure version.
 */

export class CreateAccountDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    example: '02003',
    minLength: 1,
    maxLength: MAX_ACCOUNT_CODE_LENGTH,
    description:
      'Canonical FULL code: the concatenation of the level segments, DIGITS only (§9.2). Exactly one of `code` / `localCode` must be sent. The value is stored TRIMMED (the master-data convention) and then validated digits-only by the service — the "wrong shape" 400 comes from the same rule whether a padded code reaches it or not. Uniqueness is per organization; the code is immutable once created.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_ACCOUNT_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({
    example: '003',
    minLength: 1,
    maxLength: MAX_ACCOUNT_CODE_LENGTH,
    description:
      'LOCAL code segment of this account’s own level only (e.g. `003` under parent `101` in a 1+2+3 structure). Exactly one of `code` / `localCode` must be sent. The backend composes the stored full code as `parent.code + localCode` (a root’s segment is its whole code) and validates that the segment is digits-only and exactly the configured digit length of the derived level — leading zeros are significant and are never added or stripped silently.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Local code is required.' })
  @MaxLength(MAX_ACCOUNT_CODE_LENGTH)
  localCode?: string;

  @ApiProperty({
    example: 'Cash',
    maxLength: MAX_TITLE_LENGTH,
    description:
      'Account title (Persian-capable). Titles stay editable; codes and structure do not.',
  })
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'Parent account. Omitted or null = a root (level 1). The parent must belong to the same organization, be enabled, not be postable, and its code must be a prefix of this code.',
  })
  @IsOptional()
  @IsUlid()
  parentId?: string | null;

  @ApiProperty({
    enum: ACCOUNT_NATURES,
    description:
      'Balance direction (`ماهیت`). A reporting attribute only — it does not restrict which side a future line uses (§13.4).',
  })
  @IsIn([...ACCOUNT_NATURES])
  accountNature!: (typeof ACCOUNT_NATURES)[number];

  @ApiPropertyOptional({
    enum: ACCOUNT_TYPES,
    description:
      'Account type (OD-29-02: BALANCE_SHEET, INCOME_STATEMENT, MEMORANDUM). Immutable once operationally used.',
  })
  @IsOptional()
  @IsIn([...ACCOUNT_TYPES])
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'Level-1 Detail Group reference (OD-29-03). Account links to Level-1 group, not leaf details.',
  })
  @IsOptional()
  @IsUlid()
  detailGroupId?: string | null;

  @ApiPropertyOptional({
    description:
      'Posting eligibility. Omitted = the coding structure default for the account’s level (§14 rule 4). A postable account must be a leaf (§14 rule 2).',
  })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;
}

export class UpdateAccountDto {
  @ApiPropertyOptional({ maxLength: MAX_TITLE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Title cannot be blank.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_NATURES })
  @IsOptional()
  @IsIn([...ACCOUNT_NATURES])
  accountNature?: (typeof ACCOUNT_NATURES)[number];

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES })
  @IsOptional()
  @IsIn([...ACCOUNT_TYPES])
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional({ format: 'ulid', nullable: true })
  @IsOptional()
  @IsUlid()
  detailGroupId?: string | null;

  @ApiPropertyOptional({
    description:
      'Posting eligibility. Refused when the account has children (a postable account is always a leaf, §14 rule 2).',
  })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'Re-parent the account (same organization, no cycles, level re-derived, code must still extend the new parent’s code). Refused once a document line references the account.',
  })
  @IsOptional()
  @IsUlid()
  parentId?: string | null;
}

export class UnlinkDetailGroupDto {
  @ApiProperty({
    description: `Explicit confirmation required to unlink Detail Group and atomically clear historical detail allocations (OD-29-03). Warning: "${ACCOUNT_DETAIL_UNLINK_WARNING}"`,
    example: true,
  })
  @IsBoolean()
  confirmUnlink!: boolean;
}

export class ListAccountsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Direct children of this account.',
  })
  @IsOptional()
  @IsUlid()
  parentId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_CODING_STRUCTURE_DEPTH,
    description:
      'Only accounts at this tree depth (`level=1` lists the roots).',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_CODING_STRUCTURE_DEPTH)
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

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Only accounts pinned to this coding-structure version.',
  })
  @IsOptional()
  @IsUlid()
  codingStructureVersionId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code or title.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AccountResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: '02003' })
  code!: string;

  @ApiProperty({
    example: '003',
    description:
      'The LOCAL segment of this account’s own level, derived from `code` by removing the parent’s code (a root’s segment is its whole code). Derived-only — never stored, never a second source of truth.',
  })
  localCode!: string;

  @ApiProperty({ example: 'Cash' })
  title!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ example: 2 })
  level!: number;

  @ApiProperty({ format: 'ulid', nullable: true })
  codingStructureVersionId!: string | null;

  @ApiProperty({ format: 'ulid', nullable: true })
  accountingConfigurationId!: string | null;

  @ApiProperty({ enum: ACCOUNT_NATURES })
  accountNature!: (typeof ACCOUNT_NATURES)[number];

  @ApiProperty({ enum: ACCOUNT_TYPES })
  accountType!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty({ format: 'ulid', nullable: true })
  detailGroupId!: string | null;

  @ApiProperty()
  isPostable!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
