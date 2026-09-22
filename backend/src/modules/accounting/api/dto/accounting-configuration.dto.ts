import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  ACCOUNTING_CONFIGURATION_STATUSES,
  MAX_ACCOUNTING_CONFIGURATION_DEPTH,
  MAX_ACCOUNTING_CONFIGURATION_CODE_LENGTH,
  MAX_LEVEL_KIND_LENGTH,
  MIN_CONFIGURATION_LEVEL_DIGIT_LENGTH,
} from '../../domain/accounting-configuration.js';
import { MAX_CODE_LENGTH, MAX_TITLE_LENGTH } from '../../domain/master-data.js';

export class AccountingConfigurationLevelInputDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: MAX_ACCOUNTING_CONFIGURATION_DEPTH,
    description: '1-based ordinal inside the version; must cover 1..maxDepth.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_ACCOUNTING_CONFIGURATION_DEPTH)
  levelIndex!: number;

  @ApiProperty({
    example: 'Group',
    maxLength: MAX_TITLE_LENGTH,
    description: 'Level title the organization sees.',
  })
  @IsString()
  @MinLength(1, { message: 'Level title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @ApiProperty({
    example: 2,
    minimum: MIN_CONFIGURATION_LEVEL_DIGIT_LENGTH,
    maximum: MAX_ACCOUNTING_CONFIGURATION_CODE_LENGTH,
    description: 'Digits this level contributes to an account code.',
  })
  @IsInt()
  @Min(MIN_CONFIGURATION_LEVEL_DIGIT_LENGTH)
  @Max(MAX_ACCOUNTING_CONFIGURATION_CODE_LENGTH)
  digitLength!: number;

  @ApiProperty({
    description: 'Default isPostable for accounts created at this level.',
  })
  @IsBoolean()
  defaultIsPostable!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: MAX_LEVEL_KIND_LENGTH,
    description:
      `Informational level kind — explicit and configurable, not hardcoded (Task 11). ` +
      `At most ${MAX_LEVEL_KIND_LENGTH} characters: the declared width of ` +
      'accounting_configuration_levels.level_kind. Longer values are refused (400), never truncated.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LEVEL_KIND_LENGTH)
  levelKind?: string | null;
}

export class CreateAccountingConfigurationDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    example: 'DEFAULT',
    maxLength: MAX_CODE_LENGTH,
    description:
      'Configuration code: names one configurable structure inside the organization. Versions of one configuration share it.',
  })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Main Accounting Configuration',
    maxLength: MAX_TITLE_LENGTH,
    description: 'Human-readable name.',
  })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'When this configuration version becomes effective.',
  })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string | null;

  @ApiProperty({
    type: [AccountingConfigurationLevelInputDto],
    description:
      'Exactly one row per level (ordinals 1..maxDepth, no gaps, no duplicates).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AccountingConfigurationLevelInputDto)
  levels!: AccountingConfigurationLevelInputDto[];
}

export class UpdateAccountingConfigurationDto {
  @ApiPropertyOptional({
    example: 'Main Accounting Configuration v2',
    maxLength: MAX_TITLE_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TITLE_LENGTH)
  name?: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({
    type: [AccountingConfigurationLevelInputDto],
    description: 'Replaces the whole level set (draft only).',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AccountingConfigurationLevelInputDto)
  levels?: AccountingConfigurationLevelInputDto[];
}

export class ListAccountingConfigurationsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    example: 'DEFAULT',
    description: 'Only versions of one named configuration.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ enum: ACCOUNTING_CONFIGURATION_STATUSES })
  @IsOptional()
  @IsIn([...ACCOUNTING_CONFIGURATION_STATUSES])
  status?: (typeof ACCOUNTING_CONFIGURATION_STATUSES)[number];

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code or name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AccountingConfigurationLevelResponseDto {
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

export class AccountingConfigurationResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'DEFAULT' })
  code!: string;

  @ApiProperty({ example: 'Main Accounting Configuration' })
  name!: string;

  @ApiProperty({ example: 1 })
  versionNumber!: number;

  @ApiProperty({ enum: ACCOUNTING_CONFIGURATION_STATUSES })
  status!: (typeof ACCOUNTING_CONFIGURATION_STATUSES)[number];

  @ApiProperty({ format: 'date-time', nullable: true })
  effectiveFrom!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  operationallyUsedAt!: string | null;

  @ApiProperty()
  isOperationallyUsed!: boolean;

  @ApiProperty({
    example: '2 + 3 + 3',
    description: 'Derived summary of the level set (read-only).',
  })
  pattern!: string;

  @ApiProperty({ type: [AccountingConfigurationLevelResponseDto] })
  levels!: AccountingConfigurationLevelResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
