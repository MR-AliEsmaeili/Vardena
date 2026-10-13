import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Login request body.
 *
 * Validation happens at the edge (AR-24); unknown fields are rejected by the
 * global pipe. Error messages stay generic to avoid leaking internals.
 */
export class LoginRequestDto {
  @ApiProperty({
    description: 'Login username (see security.md §2).',
    example: 'admin',
    minLength: 1,
  })
  @IsString()
  @MinLength(1, { message: 'Username is required.' })
  username!: string;

  @ApiProperty({
    description: 'Account password (plaintext, only over HTTPS in production).',
    minLength: 1,
  })
  @IsString()
  @MinLength(1, { message: 'Password is required.' })
  password!: string;
}
