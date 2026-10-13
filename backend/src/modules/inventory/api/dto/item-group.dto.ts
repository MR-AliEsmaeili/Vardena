import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { MAX_CODE_LENGTH, MAX_NAME_LENGTH } from '../../domain/master-data.js';

/**
 * Item group API contracts (master-data-strategy.md §3.2).
 *
 * A hierarchical classification, not a tag system: one nullable `parentId`, and
 * the hierarchy rules (same organization, no self-parenting, no cycles) are
 * enforced in the application service, so they surface as 422.
 */

export class CreateItemGroupDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Parent group; omit for a root group.',
  })
  @IsOptional()
  @IsUlid()
  parentId?: string;

  @ApiProperty({ example: 'FASTENERS', maxLength: MAX_CODE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({ example: 'Fasteners', maxLength: MAX_NAME_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;
}

export class UpdateItemGroupDto {
  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description: 'New parent group; `null` makes this a root group.',
  })
  @IsOptional()
  @IsUlid()
  parentId?: string | null;

  @ApiPropertyOptional({ maxLength: MAX_CODE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Code cannot be blank.' })
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name cannot be blank.' })
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;
}

export class ListItemGroupsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Restrict to the direct children of one group.',
  })
  @IsOptional()
  @IsUlid()
  parentId?: string;

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

export class ItemGroupResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ example: 'FASTENERS' })
  code!: string;

  @ApiProperty({ example: 'Fasteners' })
  name!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
