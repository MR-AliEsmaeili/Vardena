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
import {
  MAX_EMPLOYEE_CODE_LENGTH,
  MAX_PERSON_NAME_LENGTH,
} from '../../domain/master-data.js';

/**
 * Employee API contracts — minimal reference data only (OQ-32).
 *
 * There is no `userId` field anywhere in these DTOs: an Employee is not a User
 * and the linkage is unresolved (OQ-37). Adding the field before the rule is
 * decided would be a speculative schema change (AR-29).
 */

export class CreateEmployeeDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ example: 'E-0001', maxLength: MAX_EMPLOYEE_CODE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Employee code is required.' })
  @MaxLength(MAX_EMPLOYEE_CODE_LENGTH)
  employeeCode!: string;

  @ApiProperty({ example: 'Sara', maxLength: MAX_PERSON_NAME_LENGTH })
  @IsString()
  @MinLength(1, { message: 'First name is required.' })
  @MaxLength(MAX_PERSON_NAME_LENGTH)
  firstName!: string;

  @ApiProperty({ example: 'Karimi', maxLength: MAX_PERSON_NAME_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Last name is required.' })
  @MaxLength(MAX_PERSON_NAME_LENGTH)
  lastName!: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Must belong to the same organization.',
  })
  @IsOptional()
  @IsUlid()
  departmentId?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Must belong to the same organization.',
  })
  @IsOptional()
  @IsUlid()
  branchId?: string;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ maxLength: MAX_EMPLOYEE_CODE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Employee code cannot be blank.' })
  @MaxLength(MAX_EMPLOYEE_CODE_LENGTH)
  employeeCode?: string;

  @ApiPropertyOptional({ maxLength: MAX_PERSON_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'First name cannot be blank.' })
  @MaxLength(MAX_PERSON_NAME_LENGTH)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: MAX_PERSON_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Last name cannot be blank.' })
  @MaxLength(MAX_PERSON_NAME_LENGTH)
  lastName?: string;

  @ApiPropertyOptional({ format: 'ulid', nullable: true })
  @IsOptional()
  @IsUlid()
  departmentId?: string | null;

  @ApiPropertyOptional({ format: 'ulid', nullable: true })
  @IsOptional()
  @IsUlid()
  branchId?: string | null;
}

export class ListEmployeesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  branchId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Case-insensitive substring match on employee code, first or last name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class EmployeeResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'E-0001' })
  employeeCode!: string;

  @ApiProperty({ example: 'Sara' })
  firstName!: string;

  @ApiProperty({ example: 'Karimi' })
  lastName!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  departmentId!: string | null;

  @ApiProperty({ format: 'ulid', nullable: true })
  branchId!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
