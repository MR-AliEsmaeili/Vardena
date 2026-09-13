import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { WorkflowStateResponseDto } from './workflow-state.dto.js';
import { WorkflowTransitionResponseDto } from './workflow-transition.dto.js';
import {
  MAX_WORKFLOW_COMMENT_LENGTH,
  MAX_WORKFLOW_MODULE_LENGTH,
  MAX_WORKFLOW_ENTITY_TYPE_LENGTH,
  MAX_WORKFLOW_ENTITY_ID_LENGTH,
} from '../../domain/workflow-codes.js';

/**
 * Workflow runtime API contracts (Task 9 §11/§12/§13/§22).
 *
 * Bindings pin (definition, version) forever; the current state changes
 * only through `POST …/transitions`. There is deliberately no generic
 * entity-mutation API here: the bound entity stays owned by its module,
 * and Workflow stores the logical reference only.
 */

const MODULE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export class BindWorkflowInstanceDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  definitionId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'Explicit version (must be active). Omitted = the definition\u2019s active version.',
  })
  @IsOptional()
  @IsUlid()
  versionId?: string | null;

  @ApiProperty({ example: 'inventory' })
  @IsString()
  @Matches(MODULE_PATTERN, {
    message: 'Entity module must be lowercase snake_case (e.g. "inventory").',
  })
  @MaxLength(MAX_WORKFLOW_MODULE_LENGTH)
  entityModule!: string;

  @ApiProperty({ example: 'inventory_receipt' })
  @IsString()
  @Matches(ENTITY_TYPE_PATTERN, {
    message:
      'Entity type must be lowercase snake_case (e.g. "inventory_receipt").',
  })
  @MaxLength(MAX_WORKFLOW_ENTITY_TYPE_LENGTH)
  entityType!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  @MaxLength(MAX_WORKFLOW_ENTITY_ID_LENGTH)
  entityId!: string;
}

export class ListWorkflowInstancesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  definitionId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  versionId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  currentStateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_WORKFLOW_MODULE_LENGTH)
  entityModule?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_WORKFLOW_ENTITY_TYPE_LENGTH)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_WORKFLOW_ENTITY_ID_LENGTH)
  entityId?: string;
}

export class WorkflowInstanceQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class ExecuteWorkflowTransitionDto {
  @ApiProperty({ format: 'ulid', description: 'The transition to execute.' })
  @IsUlid()
  transitionId!: string;

  @ApiPropertyOptional({
    maxLength: MAX_WORKFLOW_COMMENT_LENGTH,
    description: 'Required when the transition requires a comment.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_WORKFLOW_COMMENT_LENGTH)
  comment?: string | null;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'The completed approval, when the transition requires approval.',
  })
  @IsOptional()
  @IsUlid()
  approvalId?: string | null;
}

export class ListWorkflowHistoryQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class WorkflowInstanceResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  definitionId!: string;

  @ApiProperty({ format: 'ulid' })
  versionId!: string;

  @ApiProperty({ example: 'inventory' })
  entityModule!: string;

  @ApiProperty({ example: 'inventory_receipt' })
  entityType!: string;

  @ApiProperty()
  entityId!: string;

  @ApiProperty({ format: 'ulid' })
  currentStateId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AvailableWorkflowTransitionDto extends WorkflowTransitionResponseDto {
  @ApiProperty({
    description:
      'Whether the caller holds the transition\u2019s required permission.',
  })
  permitted!: boolean;
}

export class AvailableTransitionsResponseDto {
  @ApiProperty({ type: WorkflowInstanceResponseDto })
  instance!: WorkflowInstanceResponseDto;

  @ApiProperty({ type: WorkflowStateResponseDto })
  currentState!: WorkflowStateResponseDto;

  @ApiProperty({ description: 'Terminal states have no outgoing transitions.' })
  isTerminal!: boolean;

  @ApiProperty({ type: [AvailableWorkflowTransitionDto] })
  transitions!: AvailableWorkflowTransitionDto[];
}

export class WorkflowTransitionHistoryResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  instanceId!: string;

  @ApiProperty({ format: 'ulid' })
  versionId!: string;

  @ApiProperty({ format: 'ulid' })
  transitionId!: string;

  @ApiProperty({ format: 'ulid' })
  fromStateId!: string;

  @ApiProperty({ format: 'ulid' })
  toStateId!: string;

  @ApiProperty({ example: 1, description: '1-based per instance.' })
  sequence!: number;

  @ApiProperty({ format: 'ulid', nullable: true })
  actorId!: string | null;

  @ApiProperty({ nullable: true })
  comment!: string | null;

  @ApiProperty({ format: 'ulid', nullable: true })
  approvalId!: string | null;

  @ApiProperty({ nullable: true })
  correlationId!: string | null;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ExecuteTransitionResponseDto {
  @ApiProperty({ type: WorkflowInstanceResponseDto })
  instance!: WorkflowInstanceResponseDto;

  @ApiProperty({ type: WorkflowTransitionHistoryResponseDto })
  history!: WorkflowTransitionHistoryResponseDto;

  @ApiProperty({ type: WorkflowTransitionResponseDto })
  transition!: WorkflowTransitionResponseDto;
}
