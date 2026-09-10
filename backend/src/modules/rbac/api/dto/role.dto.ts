import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionDto } from './permission.dto.js';

/** Role list/detail representation. */
export class RoleDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ example: 'Warehouse Clerk' })
  name!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Receives and issues stock.',
  })
  description!: string | null;

  @ApiProperty({
    example: 4,
    description: 'Number of permissions assigned to the role.',
  })
  permissionCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** Role detail: the role plus every permission it currently holds. */
export class RoleDetailDto extends RoleDto {
  @ApiProperty({ type: [PermissionDto] })
  permissions!: PermissionDto[];
}
