import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Licensing API contracts (ADR-0014: DTOs are the OpenAPI contract).
 *
 * Activation accepts exactly ONE field: the signed license code. There is no
 * way to post a status, a limit, a validity window or an entitlement — those
 * are derived from the verified payload inside the code, so the client can
 * never describe the license it wants (L-02, security review §9).
 */
export class ActivateLicenseDto {
  @ApiProperty({
    description:
      'The signed license code issued for this installation (VLIC1.<payload>.<signature>).',
    example: 'VLIC1.eyJ2IjoxLC4uLn0.c2lnbmF0dXJl',
    maxLength: 8192,
  })
  @IsString()
  @MinLength(1, { message: 'A license code is required.' })
  @MaxLength(8192)
  code!: string;
}
