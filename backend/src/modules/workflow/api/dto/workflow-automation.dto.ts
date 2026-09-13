import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_WORKFLOW_CODE_LENGTH,
  MAX_WORKFLOW_SORT_ORDER,
} from '../../domain/workflow-codes.js';

/**
 * Workflow automation binding API contracts (Task 9 §18).
 *
 * Bindings are draft configuration: WHICH catalogue action a transition
 * binds, with typed parameters. Actions must be REGISTERED application
 * code; parameters must fit the bounded envelope (a flat JSON object with
 * primitive values). Action and parameters are immutable after creation.
 */

const ACTION_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export class CreateWorkflowAutomationDto {
  @ApiProperty({
    example: 'notify',
    description: 'A registered automation action.',
    maxLength: MAX_WORKFLOW_CODE_LENGTH,
  })
  @IsString()
  @Matches(ACTION_PATTERN, {
    message: 'Action must be lowercase snake_case (e.g. "notify").',
  })
  @MaxLength(MAX_WORKFLOW_CODE_LENGTH)
  action!: string;

  @ApiPropertyOptional({
    description:
      'Flat JSON object (at most 50 keys) with string, number, boolean or null values.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  parameters?: unknown;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_WORKFLOW_SORT_ORDER)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkflowAutomationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_WORKFLOW_SORT_ORDER)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListWorkflowAutomationsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

export class WorkflowAutomationQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class WorkflowAutomationResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  versionId!: string;

  @ApiProperty({ format: 'ulid' })
  transitionId!: string;

  @ApiProperty({ example: 'notify' })
  action!: string;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  parameters!: Record<string, string | number | boolean | null> | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
