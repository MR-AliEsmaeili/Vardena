import { ApiProperty } from '@nestjs/swagger';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';

/**
 * Organization membership API contracts (Task 19, ODR-3).
 *
 * Deliberately minimal, mirroring the RBAC user-role assignment DTOs: a grant
 * names exactly one user for the organization addressed by the route; the
 * member listing is a plain page. There is no membership PATCH — presence is
 * the authorization, and nothing about a membership is editable.
 */

export class GrantMembershipDto {
  @ApiProperty({
    format: 'ulid',
    description: 'The user to grant access to this organization.',
  })
  @IsUlid()
  userId!: string;
}

export class ListMembersQueryDto extends PageQueryDto {}

export class OrganizationMembershipResponseDto {
  @ApiProperty({ format: 'ulid', description: 'The member (user) id.' })
  userId!: string;

  @ApiProperty({ format: 'ulid', description: 'The organization id.' })
  organizationId!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the membership was granted.',
  })
  createdAt!: string;
}
