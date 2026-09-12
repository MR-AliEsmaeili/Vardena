import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_WORKFLOW_CODE_LENGTH,
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
} from '../../domain/workflow-codes.js';

/**
 * Workflow definition API contracts (Task 9 §5/§22).
 *
 * `organizationId` is required on every operation: there is no endpoint
 * that reads or writes definitions across organizations, which is the
 * structural half of organization isolation (Task 9 §10). Codes are
 * immutable after creation; behaviour changes ship as new versions.
 */

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export class CreateWorkflowDefinitionDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({
    example: 'inventory_receipt',
    description: 'Stable snake_case business key, unique per organization.',
    maxLength: MAX_WORKFLOW_CODE_LENGTH,
  })
  @IsString()
  @Matches(CODE_PATTERN, {
    message: 'Code must be lowercase snake_case (e.g. "inventory_receipt").',
  })
  @MaxLength(MAX_WORKFLOW_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Inventory receipt',
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
}

export class UpdateWorkflowDefinitionDto {
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

  @ApiPropertyOptional({
    description:
      'Disabling blocks new bindings and new version activations; in-flight instances keep transitioning.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListWorkflowDefinitionsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code or name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class WorkflowDefinitionQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class WorkflowDefinitionResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'inventory_receipt' })
  code!: string;

  @ApiProperty({ example: 'Inventory receipt' })
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
