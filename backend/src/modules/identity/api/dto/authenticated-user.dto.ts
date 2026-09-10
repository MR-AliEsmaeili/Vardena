import { ApiProperty } from '@nestjs/swagger';

/**
 * Safe, public representation of the authenticated user (returned by login
 * and /auth/me). Deliberately omits password hash, session secrets, and
 * internal security state (AR-24).
 */
export class AuthenticatedUserDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
