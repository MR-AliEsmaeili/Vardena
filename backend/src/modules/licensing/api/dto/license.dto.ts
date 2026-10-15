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
 * Explicit installation customer transfer (Owner decision 2026-10-12, Q4).
 *
 * The body carries the signed document and the operator's reason — never a
 * customer id, a limit or any other licensing fact: those are read from the
 * verified payload. The *intent* to transfer is what the caller supplies, and
 * it is the only thing that authorizes the operation (together with the
 * dedicated permission); a document naming a different customer on the normal
 * import path is still refused.
 */
export class TransferLicenseCustomerDto {
  @ApiProperty({
    description:
      'The signed license document of the customer this installation is being transferred to: the vardena-license file envelope or the bare VLIC2 artifact. A legacy VLIC1 text code cannot express a transfer and is refused.',
    example:
      '{"format":"vardena-license","fileVersion":1,"document":"VLIC2.eyJ2Ijoy...c2lnbmF0dXJl"}',
    maxLength: 65536,
  })
  @IsString()
  @MinLength(1, { message: 'A license document is required.' })
  @MaxLength(65536)
  document!: string;

  @ApiProperty({
    description:
      'Why the installation changes customer. Recorded on the typed transfer audit event; required, because an unexplained commercial rebinding is not auditable.',
    minLength: 3,
    maxLength: 500,
    example:
      'Contract 2026-114 moved this server from Acme to Acme Industrial.',
  })
  @IsString()
  @MinLength(3, {
    message: 'A transfer reason of at least 3 characters is required.',
  })
  @MaxLength(500)
  reason!: string;
}

/**
 * The dedicated post-gap recovery request (Owner decision 2026-10-12, OQ-87
 * Option B, PDR-13). Like the transfer: the body carries the signed document
 * and the operator's reason — never a license id, a window or any other
 * licensing fact, all of which are read from the verified payload.
 */
export class RecoverAfterGapDto {
  @ApiProperty({
    description:
      'The signed license document that covers the lapsed window: the vardena-license file envelope or the bare VLIC2 artifact. A legacy VLIC1 text code cannot carry a recovery and is refused.',
    example:
      '{"format":"vardena-license","fileVersion":1,"document":"VLIC2.eyJ2Ijoy...c2lnbmF0dXJl"}',
    maxLength: 65536,
  })
  @IsString()
  @MinLength(1, { message: 'A license document is required.' })
  @MaxLength(65536)
  document!: string;

  @ApiProperty({
    description:
      'Why coverage is being restored after a lapse. Recorded on the typed recovery audit event; required, because an unexplained recovery is not auditable.',
    minLength: 3,
    maxLength: 500,
    example:
      'Renewal order 2026-1182 arrived after the previous contract had already expired.',
  })
  @IsString()
  @MinLength(3, {
    message: 'A recovery reason of at least 3 characters is required.',
  })
  @MaxLength(500)
  reason!: string;
}

/**
 * The explicit reduction-resolution request (PDR-11 §8.6, L-04). The caller
 * has already seen the explained conflicts on the refused import (409 with
 * concrete limits, usage and entitlements); this operation applies the
 * document WITH the operator's reasoned resolution of exactly those
 * conflicts.
 */
export class ResolveReductionDto {
  @ApiProperty({
    description:
      'The signed license document whose reduction conflicts with current usage or the retained grant: the vardena-license file envelope or the bare VLIC2 artifact.',
    example:
      '{"format":"vardena-license","fileVersion":1,"document":"VLIC2.eyJ2Ijoy...c2lnbmF0dXJl"}',
    maxLength: 65536,
  })
  @IsString()
  @MinLength(1, { message: 'A license document is required.' })
  @MaxLength(65536)
  document!: string;

  @ApiProperty({
    description:
      'Why the capacity or entitlement reduction is being authorized. Recorded on the typed resolution audit event with the conflicts it authorized; required, because an unexplained reduction is not auditable.',
    minLength: 3,
    maxLength: 500,
    example:
      'Customer confirmed the user-count reduction; three unused seats were revoked before the new version applies.',
  })
  @IsString()
  @MinLength(3, {
    message: 'A resolution reason of at least 3 characters is required.',
  })
  @MaxLength(500)
  reason!: string;
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

  @ApiProperty({ type: Number, nullable: true })
  deviceLimit!: number | null;

  @ApiProperty({
    description:
      'Whether deviceLimit was explicitly present in the signed payload.',
  })
  deviceLimitSpecified!: boolean;
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
    description: 'Stable business customer code (L-06, PDR-14).',
  })
  customerCode!: string | null;

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

  @ApiProperty({ type: Number, nullable: true })
  deviceLimit!: number | null;

  @ApiProperty({
    description:
      'False when the governing signed license predates the deviceLimit field; a missing field is not treated as unlimited.',
  })
  deviceLimitSpecified!: boolean;

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

/**
 * The receipt of `POST /api/v1/license/customer-transfer`: the import receipt
 * plus the two facts the transaction committed — the customer the installation
 * was bound to before, and whether the binding changed. Both come from the
 * same transaction as the typed audit event, so a receipt can never disagree
 * with the trail.
 */
export class LicenseCustomerTransferResultDto extends LicenseImportResultDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The commercial customer this installation was bound to before the transfer.',
  })
  previousCustomerId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The business customer code this installation was bound to before the transfer (L-06).',
  })
  previousCustomerCode!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The license that governed this installation immediately before the transfer, observed under the installation transaction lock (L-06, PDR-14 §3.5.4). Null when no license was governing then. The new license identity is `licenseId` in this same response.',
  })
  previousLicenseId!: string | null;

  @ApiProperty({ description: 'True when the transfer changed the binding.' })
  bindingChanged!: boolean;

  @ApiProperty({
    description:
      'The operator-supplied transfer reason exactly as recorded on the typed `license.installation.customer-transferred` audit event (L-06, PDR-14 §3.5.4).',
  })
  reason!: string;
}

/**
 * One explained reduction conflict (PDR-11 §8.6). The explain contract is
 * bounded on purpose: the machine-readable kind plus the numbers that make
 * the conflict checkable — never unrelated installation or customer data.
 */
export class ReductionConflictDto {
  @ApiProperty({
    enum: [
      'organization-capacity',
      'user-capacity',
      'device-capacity',
      'device-entitlement-removed',
      'entitlement-removed',
      'open-end-closed',
      'usage-unavailable',
    ],
    description:
      'organization-capacity / user-capacity / device-capacity: the new finite limit is below current usage. Under PDR-15 §2.15, device conflicts may be resolved by explicitly deactivating devices or using the existing authorized, audited reduction-resolution flow; that flow never auto-deactivates, and new enrollment remains blocked while active usage is at or above the finite limit. device-entitlement-removed: the signed version removes device capacity while devices remain registered. entitlement-removed: the retired version grants an entitlement the new one does not. open-end-closed: a perpetual version would be handed over to a time-limited one (never operator-resolvable). usage-unavailable: current usage could not be counted, so the check fails closed.',
  })
  kind!:
    | 'organization-capacity'
    | 'user-capacity'
    | 'device-capacity'
    | 'device-entitlement-removed'
    | 'entitlement-removed'
    | 'open-end-closed'
    | 'usage-unavailable';

  @ApiProperty({
    type: Number,
    nullable: true,
    required: false,
    description: 'The new (lower) limit, for a capacity conflict.',
  })
  limit?: number;

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Current counted usage the new limit would fall below.',
  })
  currentUsage?: number;

  @ApiProperty({
    type: () => ReductionConflictEntitlementDto,
    nullable: true,
    required: false,
    description: 'The removed entitlement, for an entitlement conflict.',
  })
  entitlement?: ReductionConflictEntitlementDto | null;

  @ApiProperty({
    enum: ['organizations', 'active-users', 'devices'],
    nullable: true,
    required: false,
    description:
      'Which count was unavailable, for a usage-unavailable conflict.',
  })
  scope?: 'organizations' | 'active-users' | 'devices' | null;
}

export class ReductionConflictEntitlementDto {
  @ApiProperty({ description: 'Entitlement kind of the removed grant.' })
  kind!: string;

  @ApiProperty({ description: 'Entitlement code of the removed grant.' })
  code!: string;
}

/**
 * The receipt of `POST /api/v1/license/gap-recovery` (OQ-87 Option B,
 * PDR-13): the import receipt plus the lapsed-license facts the transaction
 * committed, from the same transaction as the typed
 * `license.import.recovered` audit event.
 */
export class GapRecoveryResultDto extends LicenseImportResultDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The license whose retained coverage had ended before the recovery.',
  })
  lapsedLicenseId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'When that coverage ended; the recovery started strictly after it (ISO instant).',
  })
  coverageEnd!: string | null;
}

/**
 * The receipt of `POST /api/v1/license/reduction-resolution` (PDR-11 §8.6):
 * the import receipt plus the conflicts the resolution authorized, recomputed
 * inside the transaction under the locks — the same facts the typed
 * `license.import.reduction-resolved` audit event records.
 */
export class ReductionResolutionResultDto extends LicenseImportResultDto {
  @ApiProperty({
    description:
      'The version whose grant was reduced with explicit authorization.',
  })
  resolvedPredecessorVersionId!: string;

  @ApiProperty({
    type: [ReductionConflictDto],
    description: 'The conflicts the resolution authorized.',
  })
  resolvedConflicts!: ReductionConflictDto[];
}
