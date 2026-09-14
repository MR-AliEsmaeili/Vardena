import { ApiProperty } from '@nestjs/swagger';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';

/**
 * Organization scope for by-id Accounting operations (Task 10.2, AC-D-01).
 *
 * Every direct by-id access — get/update a financial area, fiscal year or
 * accounting period, including the lifecycle actions — carries the owning
 * organization as a query parameter, exactly like every list endpoint and
 * the already-scoped Organization/Document/Workflow modules.
 *
 * The service resolves the record inside that scope: a row whose
 * `organization_id` differs (or that does not exist) answers 404 — never
 * 403 — so the API never confirms that an id belonging to another
 * organization exists (ADR-0021 §4, no IDOR).
 */
export class AccountingScopeQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}
