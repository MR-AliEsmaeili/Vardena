import { ApiProperty } from '@nestjs/swagger';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { ACCOUNT_NATURES } from '../../domain/account.js';

/**
 * Chart Tree read-surface API contracts (ODR-2, Task 19 Slice 2).
 *
 * The chart tree is the ACCOUNTING-OWNED, READ-ONLY projection of the account
 * master for tree consumers: identity, hierarchy, code, name, level,
 * active/inactive and the one posting/aggregation semantic that is already
 * authoritative — `isPostable`. A postable node is a posting leaf
 * (`postable ⇒ leaf`, §14 rule 2); a non-postable node aggregates its
 * descendants. There is deliberately:
 *
 * - **no invented `account_type`/classification** — the gate exposes
 *   semantics only where a stored field already owns them;
 * - **no balances or turnovers** — Task 18's report surfaces own every
 *   financial figure; this surface never computes a second truth;
 * - **no client sort** — the order is FIXED (`code` ascending, the canonical
 *   tree order codes encode, §9.2/9.3); an explicit `sort` is rejected by the
 *   service with 400;
 * - **no mutation verb** — the surface is read-only; administration lives in
 *   the `accounts` endpoints;
 * - **no Reporting module** — Accounting owns the tree read (ODR-2, ADR-0009:
 *   Reporting stays a view/policy layer, never a second Account master).
 */
export class ListChartTreeQueryDto extends PageQueryDto {
  @ApiProperty({
    description:
      'Organization whose chart tree is read (tenant scope; foreign or unknown ids answer 404, disabled organizations 422).',
  })
  @IsUlid()
  organizationId!: string;
}

export class ChartTreeNodeDto {
  @ApiProperty({ format: 'ulid', description: 'Node identity (account id).' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({
    example: '02003',
    description:
      'Canonical code: the concatenation of the level segments (§9.2). The fixed response order is code ascending.',
  })
  code!: string;

  @ApiProperty({ example: 'Cash', description: 'Node name (account title).' })
  title!: string;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description:
      'Parent node id; null = a root. The tree is this parent relation — a consumer nests the flat page itself.',
  })
  parentId!: string | null;

  @ApiProperty({
    example: 2,
    description: 'Tree depth (root = 1), derived and authoritative.',
  })
  level!: number;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description: 'Pinned coding-structure version (code-shape half, ODR-1).',
  })
  codingStructureVersionId!: string | null;

  @ApiProperty({
    format: 'ulid',
    nullable: true,
    description:
      'Pinned accounting configuration (sole-scope half, ODR-1). The two pins are coherent on every write that establishes them.',
  })
  accountingConfigurationId!: string | null;

  @ApiProperty({
    enum: ACCOUNT_NATURES,
    description: 'Balance direction (`ماهیت`) — a reporting attribute.',
  })
  accountNature!: (typeof ACCOUNT_NATURES)[number];

  @ApiProperty({
    description:
      'Posting eligibility. true = a posting leaf; false = an aggregation node (rolls up posting descendants). There is no separate account classification.',
  })
  isPostable!: boolean;

  @ApiProperty({
    description:
      'Active/inactive lifecycle. Disabled nodes stay in the tree (accounts are never deleted, §8.6); history stays readable.',
  })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
