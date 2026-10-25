import { Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { AccountsRepository } from '../data/accounts.repository.js';
import type { OrderBy } from '../data/accounting-rows.js';
import {
  toAccountDto,
  type Account,
  type AccountDto,
} from '../domain/account.js';
import { localSegmentOfAccountCode } from '../domain/account-code.js';
import { ACCOUNT_PERMISSIONS } from '../domain/accounting-permissions.js';

/**
 * The Accounting-owned Chart Tree read surface (ODR-2, Task 19 Slice 2).
 *
 * WHAT IT IS: the read-only projection of the account master for tree
 * consumers — identity, hierarchy, code, name, level, active/inactive and
 * `isPostable` (posting leaf vs aggregation node), deterministically ordered
 * by the canonical code. It reuses the same repository the administration
 * surface reads (`AccountsRepository.list/findById`) — there is no second
 * Account master, no second table and no Reporting module involved
 * (ADR-0009; ODR-2 Decision A).
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 * - NO financial figures. Balances and turnovers belong to the Task 18 report
 *   surfaces; this service never computes or proxies a second truth.
 * - NO invented classification. `account_type` and friends do not exist in
 *   the model; `isPostable` is the only posting/aggregation semantic the
 *   store already owns.
 * - NO client-controlled ordering. The order is fixed (`code` ascending, the
 *   tree order the canonical codes themselves encode); an explicit `sort` is
 *   rejected with 400 exactly like the fixed-order report surfaces.
 * - NO write verb. The class exposes `list` and `get` only; administration
 *   stays on `AccountsService`.
 * - NO weakened tenant posture. The organization scope passes through the
 *   same chokepoint as every other Accounting read (`requireUsableOrganization`
 *   → ODR-3 membership binding), so a foreign or unknown organization id
 *   answers 404 and a disabled organization 422.
 */

/** The fixed, single, deterministic order of the chart tree surface. */
const CHART_TREE_ORDER: OrderBy = [{ code: 'asc' }];

export interface ListChartTreeQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  /** Rejected when explicitly supplied: the order is fixed, not a choice. */
  sort?: string | undefined;
}

@Injectable()
export class ChartTreeService {
  constructor(
    private readonly repository: AccountsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(query: ListChartTreeQuery): Promise<PaginatedResult<AccountDto>> {
    await this.authorization.requireAllPermissions([ACCOUNT_PERMISSIONS.VIEW]);
    if (query.sort !== undefined) {
      // The tree order is part of the contract (canonical code order), not a
      // client choice — an explicitly-sent `sort` must fail loudly instead of
      // silently re-defining what "the chart" is.
      throw AppException.badRequest(
        'The chart tree order is fixed (code ascending); the sort parameter is not accepted.',
      );
    }
    await this.organizations.requireUsableOrganization(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: { organizationId: query.organizationId },
      orderBy: CHART_TREE_ORDER,
      skip,
      take,
    });
    return toPaginatedResult(
      await toChartTreeDtos(this.repository, items),
      total,
      query.page,
      query.pageSize,
    );
  }

  async get(organizationId: string, id: string): Promise<AccountDto> {
    await this.authorization.requireAllPermissions([ACCOUNT_PERMISSIONS.VIEW]);
    await this.organizations.requireUsableOrganization(organizationId);
    const account = await this.repository.findById(id);
    if (account === null || account.organizationId !== organizationId) {
      // Cross-organization ids answer 404, indistinguishable from unknown
      // ones (the established Accounting isolation posture).
      throw AppException.notFound('Account', id);
    }
    const [dto] = await toChartTreeDtos(this.repository, [account]);
    return dto as AccountDto;
  }
}

/**
 * DTOs with the derived LOCAL segment — the same derivation the
 * administration surface performs (`AccountsService`): the segment is the
 * stored full code minus the parent's code (§9.3; FK authority, prefix
 * proof), never a stored value. Parents inside the batch are reused; only
 * missing distinct parents are read, and an unresolvable parent presents
 * the full code as the segment instead of blocking the read (read-total
 * derivation, see `localSegmentOfAccountCode`).
 *
 * A module function, not a method: the service's structural surface is
 * pinned to exactly `get`/`list` (the read-only guarantee test).
 */
async function toChartTreeDtos(
  repository: AccountsRepository,
  accounts: readonly Account[],
): Promise<AccountDto[]> {
  if (accounts.length === 0) return [];
  const organizationId = (accounts[0] as Account).organizationId;
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));
  const missingParentIds = [
    ...new Set(
      accounts
        .map((a) => a.parentId)
        .filter(
          (parentId): parentId is string =>
            parentId !== null && !codeById.has(parentId),
        ),
    ),
  ];
  for (const parentId of missingParentIds) {
    const parent = await repository.findById(parentId);
    if (parent !== null && parent.organizationId === organizationId) {
      codeById.set(parentId, parent.code);
    }
  }
  return accounts.map((account) =>
    toAccountDto(
      account,
      localSegmentOfAccountCode({
        code: account.code,
        parentCode:
          account.parentId === null
            ? null
            : (codeById.get(account.parentId) ?? null),
      }),
    ),
  );
}
