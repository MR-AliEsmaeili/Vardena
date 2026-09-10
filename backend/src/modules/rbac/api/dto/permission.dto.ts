import { ApiProperty } from '@nestjs/swagger';

/**
 * Safe permission representation (AR-24): the code is the public identity of a
 * permission, the internal row id never leaves the backend.
 */
export class PermissionDto {
  @ApiProperty({
    description: 'Permission code in `Module.Entity.Action` form.',
    example: 'Inventory.Receipt.Create',
  })
  code!: string;

  @ApiProperty({
    description: 'Human-readable description (shown in role administration).',
  })
  description!: string;
}

/** Effective permissions of the current session (UI bootstrapping). */
export class EffectivePermissionsDto {
  @ApiProperty({ format: 'ulid' })
  userId!: string;

  @ApiProperty({
    type: [String],
    example: ['Users.User.View', 'Rbac.Role.View'],
    description:
      'Union of the permissions of every role assigned to the user. UI checks are UX-only; the backend enforces authorization (AR-21).',
  })
  permissions!: string[];
}
