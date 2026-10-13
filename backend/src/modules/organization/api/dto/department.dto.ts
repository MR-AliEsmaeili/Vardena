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
 * Department API contracts.
 *
 * `parentDepartmentId` is optional on create (a root department) and nullable
 * on update (detach from the parent). The hierarchy rules — same organization,
 * no self-parenting, no cycles — are enforced in the application service, not
 * here: they need rows, not syntax.
 */

export class CreateDepartmentDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Parent department; omit for a root department.',
  })
  @IsOptional()
  @IsUlid()
  parentDepartmentId?: string;

  @ApiProperty({ example: 'SALES', maxLength: MAX_CODE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({ example: 'Sales', maxLength: MAX_NAME_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional({
    format: 'ulid',
    description: 'New parent department; `null` makes this a root department.',
    nullable: true,
  })
  @IsOptional()
  @IsUlid()
  parentDepartmentId?: string | null;

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

export class ListDepartmentsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Restrict to the direct children of one department.',
  })
  @IsOptional()
  @IsUlid()
  parentDepartmentId?: string;

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

export class DepartmentResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  parentDepartmentId!: string | null;

  @ApiProperty({ example: 'SALES' })
  code!: string;

  @ApiProperty({ example: 'Sales' })
  name!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
