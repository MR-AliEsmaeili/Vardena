import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
} from '../../domain/role.js';
import { IsUlid } from './is-ulid.decorator.js';

/**
 * Role request bodies (validated at the edge, AR-24).
 *
 * Unknown fields are rejected by the global validation pipe, so a client
 * cannot smuggle e.g. `permissions` into an edit request.
 */
export class CreateRoleDto {
  @ApiProperty({ minLength: 1, maxLength: MAX_ROLE_NAME_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ROLE_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: MAX_ROLE_DESCRIPTION_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ROLE_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Initial permission set. Every code must exist in the permission registry; assignments are applied in the same transaction as the role.',
    example: ['Users.User.View'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissionCodes?: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: MAX_ROLE_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ROLE_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: MAX_ROLE_DESCRIPTION_LENGTH,
    description: 'Pass null to clear the description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ROLE_DESCRIPTION_LENGTH)
  description?: string | null;
}

export class AssignPermissionDto {
  @ApiProperty({
    description: 'Permission code to assign (`Module.Entity.Action`).',
    example: 'Users.User.View',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  code!: string;
}

export class AssignRoleToUserDto {
  @ApiProperty({
    format: 'ulid',
    description: 'User id to assign the role to.',
  })
  @IsUlid()
  userId!: string;
}
