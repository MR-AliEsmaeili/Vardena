import { ApiProperty } from '@nestjs/swagger';

/**
 * Safe user representation returned by the Users API (AR-24).
 *
 * Deliberately excludes `passwordHash`, `deletedAt`/`deletedBy`, and the audit
 * actor ids — admin clients need the account state, not security internals.
 * The shape matches the domain `UserDto`; the class exists so OpenAPI has a
 * schema (ADR-0014: DTOs are the contract).
 */
export class UserResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ example: 'alice' })
  username!: string;

  @ApiProperty({
    example: true,
    description:
      'False while the account is disabled. Disabled users cannot authenticate.',
  })
  isActive!: boolean;

  @ApiProperty({
    example: false,
    description:
      'True when the user must change their password before accessing normal application functionality.',
  })
  mustChangePassword!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
