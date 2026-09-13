import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { MAX_WORKFLOW_COMMENT_LENGTH } from '../../domain/workflow-codes.js';

/**
 * Workflow approval API contracts (Task 9 §16).
 *
 * Single-level only: request, then approve/reject. There is no update
 * endpoint — a decided approval is evidence, and a stale one can neither
 * be decided nor consumed.
 */

export const WORKFLOW_APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
] as const;

export const WORKFLOW_APPROVAL_DECISIONS = ['approved', 'rejected'] as const;

export class RequestWorkflowApprovalDto {
  @ApiProperty({
    format: 'ulid',
    description: 'The approval-gated transition of the same version.',
  })
  @IsUlid()
  transitionId!: string;

  @ApiPropertyOptional({ maxLength: MAX_WORKFLOW_COMMENT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_WORKFLOW_COMMENT_LENGTH)
  comment?: string | null;
}

export class DecideWorkflowApprovalDto {
  @ApiProperty({ enum: WORKFLOW_APPROVAL_DECISIONS })
  @IsIn(WORKFLOW_APPROVAL_DECISIONS)
  decision!: string;

  @ApiPropertyOptional({ maxLength: MAX_WORKFLOW_COMMENT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_WORKFLOW_COMMENT_LENGTH)
  comment?: string | null;
}

export class ListWorkflowApprovalsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ enum: WORKFLOW_APPROVAL_STATUSES })
  @IsOptional()
  @IsIn(WORKFLOW_APPROVAL_STATUSES)
  status?: string;
}

export class WorkflowApprovalQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class WorkflowApprovalResponseDto {
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

  @ApiProperty({ enum: WORKFLOW_APPROVAL_STATUSES })
  status!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  requestedBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  requestedAt!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  decidedBy!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  decidedAt!: string | null;

  @ApiProperty({ nullable: true })
  comment!: string | null;

  @ApiProperty({
    description:
      'History length at request time. A decision or execution is stale when the instance moved since.',
  })
  baseSequence!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
