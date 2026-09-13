import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';

/**
 * Workflow version API contracts (Task 9 §6/§22/§23).
 *
 * Versions are created as drafts and published exactly once after
 * deterministic validation. There is no update endpoint: active and
 * superseded versions are immutable, and drafts carry no editable
 * version-level fields beyond what creation sets — behaviour changes ship
 * as a NEW version, never as an edit.
 */

export const WORKFLOW_VERSION_STATUSES = [
  'draft',
  'active',
  'superseded',
] as const;

export class CreateWorkflowVersionDto {
  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      'Informational effective metadata. v1 has no scheduled activation: publishing is the explicit act.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveFrom?: Date | null;
}

export class ListWorkflowVersionsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ enum: WORKFLOW_VERSION_STATUSES })
  @IsOptional()
  @IsIn(WORKFLOW_VERSION_STATUSES)
  status?: string;
}

export class WorkflowVersionQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}

export class WorkflowVersionResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  definitionId!: string;

  @ApiProperty({ example: 1, description: '1-based per definition.' })
  versionNumber!: number;

  @ApiProperty({ enum: WORKFLOW_VERSION_STATUSES })
  status!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  effectiveFrom!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
