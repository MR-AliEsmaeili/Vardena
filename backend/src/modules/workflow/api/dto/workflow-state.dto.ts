import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_WORKFLOW_CODE_LENGTH,
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
  MAX_WORKFLOW_SORT_ORDER,
} from '../../domain/workflow-codes.js';

/**
 * Workflow state API contracts (Task 9 §7/§22).
 *
 * States are configured inside DRAFT versions only. Codes are immutable
 * after creation; several initial states are tolerated in a draft but
 * publishing requires exactly one.
 */

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export class CreateWorkflowStateDto {
  @ApiProperty({
    example: 'pending_approval',
    description: 'Stable snake_case code, unique per version.',
    maxLength: MAX_WORKFLOW_CODE_LENGTH,
  })
  @IsString()
  @Matches(CODE_PATTERN, {
    message: 'Code must be lowercase snake_case (e.g. "pending_approval").',
  })
  @MaxLength(MAX_WORKFLOW_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Pending approval',
    maxLength: MAX_WORKFLOW_NAME_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_WORKFLOW_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: MAX_WORKFLOW_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_WORKFLOW_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'The deterministic bind target. Exactly one per publishable version.',
  })
  @IsOptional()
  @IsBoolean()
  isInitial?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Terminal states accept no outgoing transitions.',
  })
  @IsOptional()
  @IsBoolean()
  isTerminal?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_WORKFLOW_SORT_ORDER)
  sortOrder?: number;
}

export class UpdateWorkflowStateDto {
  @ApiPropertyOptional({ maxLength: MAX_WORKFLOW_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name cannot be blank.' })
  @MaxLength(MAX_WORKFLOW_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    maxLength: MAX_WORKFLOW_DESCRIPTION_LENGTH,
    description: 'Null clears the description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_WORKFLOW_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isInitial?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isTerminal?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_WORKFLOW_SORT_ORDER)
  sortOrder?: number;
}

export class ListWorkflowStatesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class WorkflowStateQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class WorkflowStateResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  versionId!: string;

  @ApiProperty({ example: 'pending_approval' })
  code!: string;

  @ApiProperty({ example: 'Pending approval' })
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty()
  isInitial!: boolean;

  @ApiProperty()
  isTerminal!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
