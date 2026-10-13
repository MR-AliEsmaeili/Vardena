import { ApiProperty } from '@nestjs/swagger';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';

/**
 * Organization scope for by-id Document Foundation operations (Task 8 §20).
 *
 * Every direct by-id access — get/update a numbering series, inspect a
 * numbering ledger, get/delete a document relation — carries the owning
 * organization as a query parameter, exactly like the document-type
 * `organizationId` query and every list endpoint in this module.
 *
 * The services resolve the record the same way the Organization/Inventory
 * reference resolvers do: a record whose `organization_id` differs (or that
 * does not exist) answers 404 — never 403 — so the API never confirms that an
 * id belonging to another organization exists.
 */
export class DocumentScopeQueryDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;
}
