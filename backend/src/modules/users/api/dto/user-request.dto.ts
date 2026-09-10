import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * User write bodies (validated at the edge, AR-24).
 *
 * Unknown fields are rejected by the global validation pipe, so a caller
 * cannot set fields the API does not own — notably `isActive`, `roles`, or
 * `passwordHash` (state changes go through the enable/disable and role
 * assignment endpoints, both permission-checked).
 *
 * No password *policy* is enforced here beyond "non-empty": password rules are
 * an open product question (OQ-06) and inventing them in a DTO would be a
 * business rule.
 */

const MAX_USERNAME_LENGTH = 64;

export class CreateUserDto {
  @ApiProperty({
    example: 'alice',
    minLength: 1,
    maxLength: MAX_USERNAME_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Username is required.' })
  @MaxLength(MAX_USERNAME_LENGTH)
  username!: string;

  @ApiProperty({ minLength: 1, description: 'Initial account password.' })
  @IsString()
  @MinLength(1, { message: 'Password is required.' })
  password!: string;
}

export class UpdateUserDto {
  @ApiProperty({
    example: 'alice.b',
    minLength: 1,
    maxLength: MAX_USERNAME_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Username is required.' })
  @MaxLength(MAX_USERNAME_LENGTH)
  username!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: 1, description: "The user's new password." })
  @IsString()
  @MinLength(1, { message: 'New password is required.' })
  newPassword!: string;
}
