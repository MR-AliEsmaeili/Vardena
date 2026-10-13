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
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_WORKFLOW_CODE_LENGTH,
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
  MAX_WORKFLOW_SORT_ORDER,
} from '../../domain/workflow-codes.js';

/**
 * Workflow transition API contracts (Task 9 §8/§22).
 *
 * Transitions are configured inside DRAFT versions only. Codes and the
 * (source → target) endpoints are immutable after creation. Permissions
 * must be REGISTERED `Module.Entity.Action` RBAC codes — the workflow
 * permission vocabulary is not extended here.
 */

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const PERMISSION_PATTERN =
  /^[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]*$/;
const MAX_PERMISSION_LENGTH = 160;

export class CreateWorkflowTransitionDto {
  @ApiProperty({
    example: 'submit_for_approval',
    description: 'Stable snake_case code, unique per version.',
    maxLength: MAX_WORKFLOW_CODE_LENGTH,
  })
  @IsString()
  @Matches(CODE_PATTERN, {
    message: 'Code must be lowercase snake_case (e.g. "submit_for_approval").',
  })
  @MaxLength(MAX_WORKFLOW_CODE_LENGTH)
  code!: string;

  @ApiProperty({
    example: 'Submit for approval',
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

  @ApiProperty({
    format: 'ulid',
    description: 'Source state of the same version.',
  })
  @IsUlid()
  sourceStateId!: string;

  @ApiProperty({
    format: 'ulid',
    description: 'Target state of the same version.',
  })
  @IsUlid()
  targetStateId!: string;

  @ApiProperty({
    example: 'Inventory.Receipt.Submit',
    description: 'Registered RBAC code the transition actor must hold.',
    maxLength: MAX_PERMISSION_LENGTH,
  })
  @IsString()
  @Matches(PERMISSION_PATTERN, {
    message:
      'Permission must use the "Module.Entity.Action" form (for example "Inventory.Receipt.Submit").',
  })
  @MaxLength(MAX_PERMISSION_LENGTH)
  requiredPermission!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: MAX_PERMISSION_LENGTH,
    description:
      'Registered RBAC code an approver must hold. Null = the transition permission.',
  })
  @IsOptional()
  @IsString()
  @Matches(PERMISSION_PATTERN, {
    message:
      'Permission must use the "Module.Entity.Action" form (for example "Inventory.Receipt.Approve").',
  })
  @MaxLength(MAX_PERMISSION_LENGTH)
  approvalPermission?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresComment?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Separation of duties: the actor must differ from the binding creator.',
  })
  @IsOptional()
  @IsBoolean()
  requireDifferentActor?: boolean;

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

export class UpdateWorkflowTransitionDto {
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

  @ApiPropertyOptional({ maxLength: MAX_PERMISSION_LENGTH })
  @IsOptional()
  @IsString()
  @Matches(PERMISSION_PATTERN, {
    message:
      'Permission must use the "Module.Entity.Action" form (for example "Inventory.Receipt.Submit").',
  })
  @MaxLength(MAX_PERMISSION_LENGTH)
  requiredPermission?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: MAX_PERMISSION_LENGTH,
    description: 'Null = the transition permission.',
  })
  @IsOptional()
  @IsString()
  @Matches(PERMISSION_PATTERN, {
    message:
      'Permission must use the "Module.Entity.Action" form (for example "Inventory.Receipt.Approve").',
  })
  @MaxLength(MAX_PERMISSION_LENGTH)
  approvalPermission?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresComment?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireDifferentActor?: boolean;

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

export class ListWorkflowTransitionsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Filter by source state.',
  })
  @IsOptional()
  @IsUlid()
  sourceStateId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

export class WorkflowTransitionQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class WorkflowTransitionResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  versionId!: string;

  @ApiProperty({ example: 'submit_for_approval' })
  code!: string;

  @ApiProperty({ example: 'Submit for approval' })
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ format: 'ulid' })
  sourceStateId!: string;

  @ApiProperty({ format: 'ulid' })
  targetStateId!: string;

  @ApiProperty({ example: 'Inventory.Receipt.Submit' })
  requiredPermission!: string;

  @ApiProperty()
  requiresApproval!: boolean;

  @ApiProperty({ nullable: true })
  approvalPermission!: string | null;

  @ApiProperty({
    description:
      'The explicit approval permission, or the transition permission.',
  })
  effectiveApprovalPermission!: string;

  @ApiProperty()
  requiresComment!: boolean;

  @ApiProperty()
  requireDifferentActor!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
