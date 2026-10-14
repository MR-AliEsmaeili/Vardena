import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../../../../kernel/config/app-config.js';

export class ChangePasswordRequestDto {
  @ApiProperty({ minLength: 1, maxLength: MAX_PASSWORD_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Current password is required.' })
  @MaxLength(MAX_PASSWORD_LENGTH)
  currentPassword!: string;

  @ApiProperty({
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
  })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: `New password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
  })
  newPassword!: string;
}
