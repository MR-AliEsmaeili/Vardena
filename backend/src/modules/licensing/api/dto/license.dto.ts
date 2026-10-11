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

/**
 * Signed-document import (L-03). Like activation, the body carries exactly
 * ONE field: the document a client received. There is no way to post a status,
 * a limit, a validity window, a version or an entitlement — all of those are
 * read from the verified payload, so a client can never describe the license
 * it wants.
 *
 * The size limit is generous enough for a file envelope (the artifact is
 * base64url and the envelope adds a few fields) while still bounding the
 * unauthenticated-before-parse input.
 */
export class ImportLicenseDocumentDto {
  @ApiProperty({
    description:
      'A signed license document: either the vardena-license file envelope or the bare VLIC2 artifact (legacy VLIC1 codes are accepted as well).',
    example:
      '{"format":"vardena-license","fileVersion":1,"document":"VLIC2.eyJ2Ijoy...c2lnbmF0dXJl"}',
    maxLength: 65536,
  })
  @IsString()
  @MinLength(1, { message: 'A license document is required.' })
  @MaxLength(65536)
  document!: string;
}
