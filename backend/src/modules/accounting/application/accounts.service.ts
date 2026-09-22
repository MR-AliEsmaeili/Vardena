import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import {
  AccountsRepository,
  type AccountListFilter,
  type AccountStructureSnapshot,
} from '../data/accounts.repository.js';
import {
  AccountImmutableAfterUseError,
  AccountPlacementRejectedError,
  AccountPostabilityRejectedError,
  AccountingConfigurationNotActiveError,
  CodingStructureVersionNotActiveError,
  NoActiveAccountingConfigurationError,
} from '../data/accounting-structure-errors.js';
import { AccountingDocumentLinesRepository } from '../data/accounting-document-lines.repository.js';
import type {
  Account,
  AccountDto,
  AccountPlacementParent,
  AccountPlacementProblem,
} from '../domain/account.js';
import {
  accountPlacementProblemMessage,
  defaultIsPostableForLevel,
  isAccountNature,
  planAccountEdit,
  planAccountPlacement,
  toAccountDto,
} from '../domain/account.js';
import type { AccountImmutableField } from '../domain/account.js';
import { collectDescendantIds } from '../domain/hierarchy.js';
import type { CodingStructureVersion } from '../domain/coding-structure.js';
import { ACCOUNT_PERMISSIONS } from '../domain/accounting-permissions.js';
import { normalizeCode, normalizeTitle } from '../domain/master-data.js';
import {
  ACCOUNT_CREATED_EVENT,
  ACCOUNT_DISABLED_EVENT,
  ACCOUNT_ENABLED_EVENT,
  ACCOUNT_UPDATED_EVENT,
} from '../domain/accounting.events.js';
import {
  assertAccountCode,
  assertTitle,
  assertUsable,
  publishEvent,
  resolveSort,
} from './accounting-support.js';
import { CodingStructuresService } from './coding-structures.service.js';
import { AccountingConfigurationsService } from './accounting-configurations.service.js';

/**
 * Chart of accounts (§8/§14; AC-D-06…AC-D-09, AC-D-19, AC-I-10/AC-I-11).
 *
 * ONE Account model for the whole tree: `Group / General / Subsidiary / Detail`
 * are the *level titles* an organization configures in its coding structure,
 * not entities, not tables and not code constants (§8.1). Every node is placed
 * by four derived rules, none of them client input:
 *
 *   level      = parent.level + 1   (a root is exactly level 1)
 *   code       = parent.code + the level's digit segment, digits only (§9.2/9.3)
 *   version    = the parent's pinned coding-structure version (roots take the
 *                organization's ACTIVE one) — so a subtree never mixes versions
 *   config     = the parent's pinned accounting configuration (roots take the
 *                organization's ACTIVE one); an EXISTING account is always
 *                validated against the configuration it REFERENCES, never
 *                against whichever configuration is currently ACTIVE
 *   postable   = the level's default unless the caller overrides it (§14 rule 4)
 *
 * What is REFUSED, with 422, is any placement that would make the tree lie: a
 * missing/foreign/disabled parent, a postable parent (a parent that both posts
 * and rolls up double-counts, §14 rule 2), a skipped level, a depth beyond the
 * structure, a code that does not extend its parent's code, a cycle, and
 * re-parenting that would shift the level of a node with children (its
 * descendants keep immutable codes; the restructuring policy that would decide
 * how is OQ-25).
 *
 * Immutability: `code` is immutable from creation (§8.3) — there is no code
 * field on the update path. The structural fields freeze once a document line
 * references the account (AC-I-11); lines are future work, so the predicate is
 * the single documented seam in `domain/account.ts` and no fake usage table
 * exists here.
 *
 * Deletion does not exist: `is_active` is the whole lifecycle, and an inactive
 * account blocks new children and (later) new posting lines while history stays
 * readable (§8.6, OQ-36).
 */

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  title: 'title',
  level: 'level',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListAccountsQuery {
  /** Mandatory: an account list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  parentId?: string | null | undefined;
  level?: number | undefined;
  isActive?: boolean | undefined;
  isPostable?: boolean | undefined;
  codingStructureVersionId?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateAccountInput {
  organizationId: string;
  code: string;
  title: string;
  parentId?: string | null | undefined;
  accountNature: string;
  /** Omitted = the coding structure's default for the resolved level. */
  isPostable?: boolean | undefined;
}

export interface UpdateAccountInput {
  title?: string | undefined;
  accountNature?: string | undefined;
  isPostable?: boolean | undefined;
  parentId?: string | null | undefined;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly repository: AccountsRepository,
    /**
     * AC-I-11's predicate (Task 10.4): structural account fields (parent,
     * level, nature, postability) freeze once ANY document line references the
     * account. The count is a read on another aggregate's lines — the account
     * is the aggregate being guarded, so the dependency points this way only.
     */
    private readonly documentLines: AccountingDocumentLinesRepository,
    private readonly structures: CodingStructuresService,
    private readonly configurations: AccountingConfigurationsService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listAccounts(
    query: ListAccountsQuery,
  ): Promise<PaginatedResult<AccountDto>> {
    await this.authorization.requireAllPermissions([ACCOUNT_PERMISSIONS.VIEW]);
    if (query.parentId !== undefined && query.parentId !== null) {
      // A parent filter is a scope filter: resolve it in-organization first so
      // a foreign id answers 404 instead of silently returning nothing.
      await this.mustFindInOrganization(query.organizationId, query.parentId);
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const where: AccountListFilter = {
      organizationId: query.organizationId,
      parentId: query.parentId,
      level: query.level,
      isActive: query.isActive,
      isPostable: query.isPostable,
      codingStructureVersionId: query.codingStructureVersionId,
      search: query.search,
    };
    const { items, total } = await this.repository.list({
      where,
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toAccountDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getAccount(organizationId: string, id: string): Promise<AccountDto> {
    await this.authorization.requireAllPermissions([ACCOUNT_PERMISSIONS.VIEW]);
    return toAccountDto(await this.mustFindInOrganization(organizationId, id));
  }

  async createAccount(input: CreateAccountInput): Promise<AccountDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNT_PERMISSIONS.CREATE,
    ]);
    const code = normalizeCode(input.code);
    const title = normalizeTitle(input.title);
    assertAccountCode(code);
    assertTitle(title);
    this.assertNature(input.accountNature);

    await this.organizations.requireUsableOrganization(input.organizationId);

    const parentId = input.parentId ?? null;
    let parent: AccountPlacementParent | null = null;
    let structure: { maxDepth: number; levels: any[] };
    let accountingConfigurationId: string;
    let codingStructureVersionId: string;

    try {
      if (parentId !== null) {
        const parentAccount = await this.mustFindInOrganization(
          input.organizationId,
          parentId,
        );
        // Child inherits parent's accounting configuration — sole scope D1/D3 NOT NULL
        // Legacy fixtures may have null, guard with typed errors for typecheck + D6 compliance
        if (parentAccount.accountingConfigurationId === null) {
          throw new NoActiveAccountingConfigurationError();
        }
        if (parentAccount.codingStructureVersionId === null) {
          throw new CodingStructureVersionNotActiveError('no_active_version');
        }
        accountingConfigurationId = parentAccount.accountingConfigurationId;
        codingStructureVersionId = parentAccount.codingStructureVersionId;
        const parentConfig =
          await this.configurations.requireConfigurationInOrganization(
            input.organizationId,
            parentAccount.accountingConfigurationId,
          );
        structure = {
          maxDepth: parentConfig.levels.length,
          levels: parentConfig.levels,
        };
        parent = {
          id: parentAccount.id,
          organizationId: parentAccount.organizationId,
          code: parentAccount.code,
          level: parentAccount.level,
          isPostable: parentAccount.isPostable,
          isActive: parentAccount.isActive,
          codingStructureVersionId: parentAccount.codingStructureVersionId,
          accountingConfigurationId: parentAccount.accountingConfigurationId,
        };
      } else {
        // Root account — D1: MUST require ACTIVE accounting configuration, no legacy fallback
        // D2: coding_structure_versions untouched, still required as code shape version
        const activeConfig =
          await this.configurations.requireActiveConfigurationOrThrow(
            input.organizationId,
          );
        const activeCoding = await this.structures.requireActiveVersionOrThrow(
          input.organizationId,
        );
        accountingConfigurationId = activeConfig.id;
        codingStructureVersionId = activeCoding.id;
        structure = {
          maxDepth: activeConfig.levels.length,
          levels: activeConfig.levels,
        };
      }
    } catch (error) {
      const mapped = mapAccountGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }

    const level = parent === null ? 1 : parent.level + 1;
    // The same decision table the repository re-applies under the lock.
    this.assertPlacement({
      id: '',
      organizationId: input.organizationId,
      parentId,
      code,
      parent,
      descendantIds: [],
      current: null,
      structure: structure as any,
    });

    const isPostable =
      input.isPostable ??
      defaultIsPostableForLevel((structure as any).levels, level);

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'An account with that code already exists in this organization.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let created: Account;
    try {
      created = await this.repository.createChecked({
        id: generateId(),
        organizationId: input.organizationId,
        code,
        title,
        parentId,
        accountNature: input.accountNature,
        isPostable,
        structure: snapshot(
          structure as any,
          accountingConfigurationId,
          codingStructureVersionId,
        ),
        now,
        actorId,
      });
    } catch (error) {
      const mapped = mapAccountGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }

    // D4: markOperationallyUsed NOT called in Task 11 — deferred to Posting/System Posting (first Voucher, not Account)
    // The method remains as deferred abstraction without caller, documented in ADR-0028 and docs/accounting/configuration.md

    await this.publishAccountEvent(ACCOUNT_CREATED_EVENT, created);
    this.logger.log(
      'Account created',
      {
        accountId: created.id,
        organizationId: created.organizationId,
        code: created.code,
        level: created.level,
        accountingConfigurationId: created.accountingConfigurationId,
      },
      AccountsService.name,
    );
    return toAccountDto(created);
  }

  async updateAccount(
    organizationId: string,
    id: string,
    input: UpdateAccountInput,
  ): Promise<AccountDto> {
    await this.authorization.requireAllPermissions([ACCOUNT_PERMISSIONS.EDIT]);
    const current = await this.mustFindInOrganization(organizationId, id);

    const title =
      input.title === undefined ? undefined : normalizeTitle(input.title);
    if (title !== undefined) {
      assertTitle(title);
    }
    if (
      input.accountNature !== undefined &&
      !isAccountNature(input.accountNature)
    ) {
      throw AppException.badRequest(
        'accountNature must be "debit" or "credit".',
      );
    }

    const parentChanging =
      input.parentId !== undefined &&
      (input.parentId ?? null) !== current.parentId;
    let parent: AccountPlacementParent | null = null;
    let structureForMove: { maxDepth: number; levels: any[] } | null = null;
    // The pair a MOVE is validated against — the account's OWN configuration
    // and coding-structure version (Task 11 remediation). Resolved once, used
    // for both the pre-flight check here and the repository's locked
    // re-check, so the two can never disagree.
    let pinned: {
      accountingConfigurationId: string;
      codingStructureVersionId: string;
    } | null = null;

    try {
      if (
        parentChanging &&
        input.parentId !== undefined &&
        input.parentId !== null
      ) {
        const parentAccount = await this.mustFindInOrganization(
          current.organizationId,
          input.parentId,
        );
        if (parentAccount.accountingConfigurationId === null) {
          throw new NoActiveAccountingConfigurationError();
        }
        if (parentAccount.codingStructureVersionId === null) {
          throw new CodingStructureVersionNotActiveError('no_active_version');
        }
        parent = {
          id: parentAccount.id,
          organizationId: parentAccount.organizationId,
          code: parentAccount.code,
          level: parentAccount.level,
          isPostable: parentAccount.isPostable,
          isActive: parentAccount.isActive,
          codingStructureVersionId: parentAccount.codingStructureVersionId,
          accountingConfigurationId: parentAccount.accountingConfigurationId,
        };
        const parentConfig =
          await this.configurations.requireConfigurationInOrganization(
            current.organizationId,
            parentAccount.accountingConfigurationId,
          );
        // A child may only join the parent's own configuration + version
        // (D1/D2), and the move is validated against the levels of THAT
        // configuration — never another one's.
        pinned = this.pinnedPairForMove(current);
        structureForMove = {
          maxDepth: parentConfig.levels.length,
          levels: parentConfig.levels,
        };
      } else if (parentChanging && input.parentId === null) {
        // Moving to root keeps the account pinned to ITS OWN configuration and
        // version (Task 11 remediation): the levels used for validation are
        // read from the configuration this account actually references — never
        // from whatever configuration happens to be ACTIVE for the
        // organization. Mixing the two would validate an account's code
        // against another configuration's level widths.
        //
        // The account's own configuration is deliberately NOT required to be
        // ACTIVE: existing accounts stay pinned to the configuration they were
        // created under when a newer version becomes ACTIVE (children inherit
        // it the same way). ACTIVE is required when a configuration is
        // *chosen* for a new root, not when an existing pin is re-validated.
        pinned = this.pinnedPairForMove(current);
        const ownConfig =
          await this.configurations.requireConfigurationInOrganization(
            current.organizationId,
            pinned.accountingConfigurationId,
          );
        structureForMove = {
          maxDepth: ownConfig.levels.length,
          levels: ownConfig.levels,
        };
      }
    } catch (error) {
      const mapped = mapAccountGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }

    if (parentChanging && structureForMove !== null) {
      const edges = await this.repository.listHierarchyEdges(
        current.organizationId,
      );
      this.assertPlacement({
        id: current.id,
        organizationId: current.organizationId,
        parentId: input.parentId ?? null,
        code: current.code,
        parent,
        descendantIds: collectDescendantIds(edges, current.id),
        current: {
          level: current.level,
          codingStructureVersionId: current.codingStructureVersionId,
          accountingConfigurationId: current.accountingConfigurationId,
          hasChildren:
            (await this.repository.findChild(
              current.organizationId,
              current.id,
            )) !== null,
        },
        structure: structureForMove as any,
      });
    }

    const refused = planAccountEditFor(
      input,
      current,
      parentChanging,
      (await this.documentLines.countForAccount(current.id)) > 0,
    );
    if (refused.length > 0) {
      throw AppException.businessRule(
        `The account is referenced by accounting documents; ${refused.join(', ')} can no longer change. Create a new account and disable this one instead.`,
        { refused },
      );
    }

    try {
      const updated = await this.repository.updateChecked({
        id,
        title,
        accountNature: input.accountNature,
        isPostable: input.isPostable,
        parentId: input.parentId,
        structure:
          structureForMove === null || pinned === null
            ? null
            : snapshot(
                structureForMove as any,
                pinned.accountingConfigurationId,
                pinned.codingStructureVersionId,
              ),
        now: new Date(),
        actorId: getPrincipal()?.userId ?? null,
      });
      await this.publishAccountEvent(ACCOUNT_UPDATED_EVENT, updated);
      return toAccountDto(updated);
    } catch (error) {
      const mapped = mapAccountGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
  }

  async enableAccount(organizationId: string, id: string): Promise<AccountDto> {
    return this.setActive(
      organizationId,
      id,
      true,
      ACCOUNT_PERMISSIONS.ENABLE,
      ACCOUNT_ENABLED_EVENT,
    );
  }

  async disableAccount(
    organizationId: string,
    id: string,
  ): Promise<AccountDto> {
    return this.setActive(
      organizationId,
      id,
      false,
      ACCOUNT_PERMISSIONS.DISABLE,
      ACCOUNT_DISABLED_EVENT,
    );
  }

  /**
   * Reference resolution for the future posting flow (AR-07 inside the module):
   * a line's account must exist, belong to the organization and be usable. A
   * foreign account is reported as NOT FOUND (§4 rule 6, AC-I-16).
   *
   * Postability is deliberately NOT checked here: `account_not_postable` is a
   * posting-time rule (AC-I-09) and this module has no posting yet. The
   * invariant a poster relies on — a postable account is always a leaf — holds
   * by construction of the chart, not by this method.
   */
  async requireUsableAccountInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Account> {
    const account = await this.repository.findById(id);
    if (account === null || account.organizationId !== organizationId) {
      throw AppException.notFound('Account', id);
    }
    assertUsable('Account', account.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return account;
  }

  // ---- internals ----------------------------------------------------------

  /**
   * The pair an account's MOVE is validated against: the configuration the
   * account REFERENCES and the coding-structure version it is pinned to
   * (D1/D2, Task 11 remediation). Both are NOT NULL after the Task 11
   * migration; an incomplete legacy row is reported with the same typed errors
   * the create path uses (D6) instead of an unmapped 500.
   */
  private pinnedPairForMove(current: Account): {
    accountingConfigurationId: string;
    codingStructureVersionId: string;
  } {
    if (current.accountingConfigurationId === null) {
      throw new NoActiveAccountingConfigurationError();
    }
    if (current.codingStructureVersionId === null) {
      throw new CodingStructureVersionNotActiveError('no_active_version');
    }
    return {
      accountingConfigurationId: current.accountingConfigurationId,
      codingStructureVersionId: current.codingStructureVersionId,
    };
  }

  private assertNature(nature: string): void {
    if (!isAccountNature(nature)) {
      throw AppException.badRequest(
        'accountNature must be "debit" or "credit".',
      );
    }
  }

  /** Pre-flight placement check with the repository's own decision table. */
  private assertPlacement(input: {
    id: string;
    organizationId: string;
    parentId: string | null;
    code: string;
    parent: AccountPlacementParent | null;
    descendantIds: readonly string[];
    current: {
      level: number;
      codingStructureVersionId: string | null;
      accountingConfigurationId: string | null;
      hasChildren: boolean;
    } | null;
    structure: { maxDepth: number; levels: any[] };
  }): void {
    const plan = planAccountPlacement({
      id: input.id,
      organizationId: input.organizationId,
      parentId: input.parentId,
      code: input.code,
      parent: input.parent,
      descendantIds: input.descendantIds,
      current: input.current,
      levels: (input.structure as any).levels,
      maxDepth: (input.structure as any).maxDepth,
    });
    if (plan.problem !== null) {
      throw placementException(plan.problem, plan.field);
    }
  }

  private async setActive(
    organizationId: string,
    id: string,
    isActive: boolean,
    permission: string,
    eventType: typeof ACCOUNT_ENABLED_EVENT | typeof ACCOUNT_DISABLED_EVENT,
  ): Promise<AccountDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.isActive === isActive) return toAccountDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Account', id);
    await this.publishAccountEvent(eventType, updated);
    return toAccountDto(updated);
  }

  private async publishAccountEvent(
    type: string,
    account: Account,
  ): Promise<void> {
    await publishEvent(this.events, {
      type,
      aggregateType: 'Account',
      aggregateId: account.id,
      payload: {
        id: account.id,
        organizationId: account.organizationId,
        code: account.code,
        level: account.level,
        codingStructureVersionId: account.codingStructureVersionId,
        accountingConfigurationId: account.accountingConfigurationId,
      },
    });
  }

  /**
   * Scoped by-id resolution (ADR-0021 §4, AC-I-01): an account in another
   * organization is reported as NOT FOUND, so the boundary cannot be crossed by
   * guessing an id. The deployment pin (ADR-0025) is enforced here too, so a
   * direct service caller is bounded exactly like an HTTP caller.
   */
  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<Account> {
    this.organizations.assertOrganizationInScope(organizationId);
    const account = await this.repository.findById(id);
    if (account === null || account.organizationId !== organizationId) {
      throw AppException.notFound('Account', id);
    }
    return account;
  }
}

// ---- Internal helpers ----

function snapshot(
  structure: { maxDepth: number; levels: any[] },
  accountingConfigurationId: string,
  codingStructureVersionId: string,
): AccountStructureSnapshot {
  return {
    accountingConfigurationId,
    versionId: codingStructureVersionId,
    maxDepth: structure.maxDepth,
    levels: structure.levels,
  };
}

/**
 * AC-I-11's after-use refusal, decided by the SAME domain function the
 * repository applies under its row lock (one decision table, two call sites —
 * fast feedback here, authority there).
 */
function planAccountEditFor(
  input: UpdateAccountInput,
  current: Account,
  parentChanging: boolean,
  referencedByDocumentLine: boolean,
): readonly AccountImmutableField[] {
  return planAccountEdit({
    referencedByDocumentLine,
    changes: {
      parentId: parentChanging,
      level: parentChanging,
      accountNature:
        input.accountNature !== undefined &&
        input.accountNature !== current.accountNature,
      isPostable:
        input.isPostable !== undefined &&
        input.isPostable !== current.isPostable,
    },
  }).refused;
}

/**
 * The single mapping from the chart guard errors (plain errors thrown inside
 * the repository's locked transactions) onto the stable API error model.
 *
 * Shape problems (`not_digits_only`, `code_too_long`) are 400s — the request
 * itself was unusable; every other placement problem is a 422 business rule
 * (AC-I-10), a duplicate code is a 409 (AC-I-11), and a stale
 * active-version pin is a 409 retry (a concurrent publish superseded it).
 */
/** Returns `null` for anything that is not a chart guard error, so an
 * unexpected failure keeps propagating as a 500 instead of being relabelled. */
function mapAccountGuardError(error: unknown): AppException | null {
  if (error instanceof AccountPlacementRejectedError) {
    return placementException(error.problem, 'parentId');
  }
  if (error instanceof AccountPostabilityRejectedError) {
    return AppException.businessRule(
      accountPlacementProblemMessage('parent_postable'),
      { blockingAccountId: error.childId },
    );
  }
  if (error instanceof AccountImmutableAfterUseError) {
    return AppException.businessRule(
      `The account is referenced by accounting documents; ${error.fields.join(
        ', ',
      )} can no longer change. Create a new account and disable this one instead.`,
      { refused: error.fields },
    );
  }
  if (error instanceof CodingStructureVersionNotActiveError) {
    return AppException.conflict(
      'The organization’s active coding structure changed while this request was running. Retry it.',
    );
  }
  if (error instanceof NoActiveAccountingConfigurationError) {
    return AppException.businessRule(
      'This organization has no active accounting configuration. Configure one and publish it before creating accounts.',
    );
  }
  if (error instanceof AccountingConfigurationNotActiveError) {
    return AppException.businessRule(
      'The active accounting configuration is not ACTIVE. Publish it before creating accounts.',
    );
  }
  if (isUniqueViolation(error)) {
    return AppException.conflict(
      'An account with that code already exists in this organization.',
    );
  }
  return null;
}

function placementException(
  problem: AccountPlacementProblem,
  field: 'code' | 'parentId',
): AppException {
  const message = accountPlacementProblemMessage(problem);
  if (problem === 'not_digits_only' || problem === 'code_too_long') {
    return AppException.badRequest(message);
  }
  if (problem === 'cross_organization' || problem === 'parent_not_found') {
    // A parent id that does not resolve inside the caller's scope must not be
    // distinguished from one that does not exist at all (AC-I-16).
    return AppException.notFound('Account');
  }
  return AppException.businessRule(message, { rule: problem, field });
}
