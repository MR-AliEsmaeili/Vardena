import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { LicenseStatus } from '../../domain/license.js';
import type {
  LicenseVersionSource,
  LicenseVersionSummary,
} from '../../domain/license-version.js';
import type { LicenseStateView } from '../license-state.view.js';

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

/**
 * Response contracts (OpenAPI). The shapes mirror `LicenseStateView` and the
 * domain summaries exactly; each class `implements` its source type, so a field
 * added or renamed there fails the build here, and the licensing e2e suite
 * compares the documented property names with a real response.
 */
export class LicenseEntitlementDto {
  @ApiProperty({ description: 'Entitlement kind (module or feature).' })
  kind!: string;

  @ApiProperty({ description: 'Entitlement code.' })
  code!: string;
}

export class LicenseVersionSummaryDto implements LicenseVersionSummary {
  @ApiProperty({ description: 'Retained version identity (ULID).' })
  versionId!: string;

  @ApiProperty({
    description: 'The commercial license this version belongs to.',
  })
  licenseId!: string;

  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'SUSPENDED'] })
  status!: LicenseStatus;

  @ApiProperty({ format: 'date-time' })
  validFrom!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  validUntil!: string | null;

  @ApiProperty({ description: 'True for the one version that governs now.' })
  effective!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  supersededAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When this version stops governing, if it was retired.',
  })
  governsUntil!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
  })
  supersededByVersionId!: string | null;

  @ApiProperty({ format: 'date-time' })
  importedAt!: string;

  @ApiProperty({ enum: ['file', 'text', 'legacy-code'] })
  source!: LicenseVersionSource;
}

/**
 * The evaluated, non-secret license state (`GET /api/v1/license/current`).
 * Mirrors `LicenseStateView`; no key, signature, hash or document is part of it.
 */
export class LicenseStateDto implements LicenseStateView {
  @ApiProperty({ description: 'Whether an installation license is evaluated.' })
  licensed!: boolean;

  @ApiProperty({
    description: 'Evaluated status (ACTIVE, EXPIRED or SUSPENDED).',
  })
  status!: string;

  @ApiProperty({ description: 'True only while the license is active now.' })
  active!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why the license is not active.',
  })
  inactiveReason!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
  })
  installationId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
  })
  customerId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
  })
  licenseId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  validFrom!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  validUntil!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  organizationLimit!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  userLimit!: number | null;

  @ApiProperty({ type: [LicenseEntitlementDto] })
  entitlements!: LicenseEntitlementDto[];

  @ApiProperty({
    description: 'The license provider that evaluated the state.',
  })
  provider!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The version that governs now.',
  })
  effectiveVersionId!: string | null;

  @ApiProperty({
    type: () => LicenseVersionSummaryDto,
    nullable: true,
    description: 'The earliest retained version that is not effective yet.',
  })
  scheduledVersion!: LicenseVersionSummaryDto | null;

  @ApiProperty({
    type: [LicenseVersionSummaryDto],
    description: 'Bounded retained-version history, newest first.',
  })
  versions!: LicenseVersionSummaryDto[];
}

/**
 * Evaluated state plus mutation receipt. Returned by
 * `POST /api/v1/license/import` and the L-02 alias `POST /api/v1/license/activate`
 * after a fresh read (never the mutation's own opinion).
 */
export class LicenseImportResultDto extends LicenseStateDto {
  @ApiProperty({
    description:
      'False when a repeated legacy code was already the governing version.',
  })
  changed!: boolean;

  @ApiProperty({ enum: ['APPLIED', 'UNCHANGED'] })
  outcome!: 'APPLIED' | 'UNCHANGED';
}
