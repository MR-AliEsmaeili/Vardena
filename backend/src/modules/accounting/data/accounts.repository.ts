import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type {
  Account,
  AccountImmutableField,
  AccountPlacementParent,
} from '../domain/account.js';
import {
  isAccountNature,
  planAccountEdit,
  planAccountMovePin,
  planAccountPlacement,
  planPostabilityChange,
  planRootAccountPin,
} from '../domain/account.js';
import type { HierarchyEdge } from '../domain/hierarchy.js';
import { collectDescendantIds } from '../domain/hierarchy.js';
import type { CodingStructureLevel } from '../domain/coding-structure.js';
import {
  AccountImmutableAfterUseError,
  AccountPlacementRejectedError,
  AccountPostabilityRejectedError,
  AccountingConfigurationNotActiveError,
  CodingStructureVersionNotActiveError,
} from './accounting-structure-errors.js';
import {
  lockAccountRow,
  lockAccountingConfigurationRow,
  lockCodingStructureVersionRow,
} from './accounting-locks.js';
import { countReferencingLinesInTx } from './accounting-document-lines.repository.js';
import type { LockedAccount } from './accounting-locks.js';
import type {
  AccountingTransactionalClient,
  AccountingTxClient,
  AccountCreate,
  AccountDelegate,
  AccountRow,
  AccountUpdate,
  AccountWhere,
  OrderBy,
} from './accounting-rows.js';

/**
 * Data access for `accounting.accounts` — the chart of accounts tree.
 *
 * The `(organization_id, code)` unique index is authoritative for duplicate
 * detection: the service pre-checks only to produce a 409 with a useful
 * message, and the repository still surfaces the database failure when two
 * writes race (SELECT-then-INSERT is never the guard).
 *
 * The tree invariants (AC-I-10, AC-I-11, §14) are re-evaluated INSIDE a locked
 * transaction with the SAME decision table the service applied for fast
 * feedback — `planAccountPlacement` / `planPostabilityChange` are imported here
 * for exactly that reason (the `checkFiscalYearRange` precedent):
 *
 * - CREATE locks the PARENT row, so a concurrent postability flip on that
 *   parent cannot slip past the "postable ⇒ leaf" rule;
 * - CREATE of a ROOT locks the pinned coding-structure VERSION row and the
 *   pinned ACCOUNTING CONFIGURATION row and re-checks BOTH are still `active`
 *   /`ACTIVE` (§9.4, D1) — the authoritative write boundary, so a root can
 *   never be pinned to a version or configuration that just stopped being the
 *   organization's active one;
 * - MOVE locks node + new parent in ascending id order, so two concurrent
 *   cycle-forming re-parentings serialize on the shared node and exactly one
 *   wins (a cycle can only be created by re-parenting a node under one of its
 *   descendants, which always involves that node's row). A move is validated
 *   against the pair the account is ALREADY pinned to, re-checked under the
 *   lock; a snapshot naming any other configuration/version is refused;
 * - the postability FLIP counts children under the node's own lock — the same
 *   lock a racing child create takes.
 *
 * Lock order is `[coding-structure version → accounting configuration] →
 * account`, never the reverse, and multi-row locks always ascend by id, so no
 * deadlock cycle exists (`accounting-locks.ts`): no other transaction takes an
 * accounting-configuration lock and then a coding-structure-version lock.
 */

type Client = {
  account: AccountDelegate;
};

/**
 * Bound of the single-read tree walk a MOVE needs to compute the moved node's
 * descendants. Charts are bounded by the coding structure's depth and are
 * organization-scoped; the walk is a `findFirst`-free bulk read, so the bound is
 * a memory guard, not a business rule (the calendar guards read siblings the same
 * way).
 */
const MAX_TREE_EDGES = 10_000;

export interface AccountListFilter {
  /** Always set by the service: a list is never cross-organization. */
  organizationId: string;
  /** `null` filters roots; `undefined` does not filter at all. */
  parentId?: string | null | undefined;
  level?: number | undefined;
  isActive?: boolean | undefined;
  isPostable?: boolean | undefined;
  codingStructureVersionId?: string | undefined;
  search?: string | undefined;
}

/**
 * The accounting-configuration snapshot the placement rules validate against.
 * The SERVICE resolves it (roots: the organization's ACTIVE accounting configuration;
 * children: the parent's pinned configuration), because reading another table's shape
 * from a repository of a different aggregate would hide that choice (`AR-08`).
 *
 * After Task 11 final per D1-D3:
 * - accounting_configuration_id is sole configuration scope NOT NULL
 * - coding_structure_version_id is code shape version NOT NULL (D2 untouched)
 * Both are required for isolation checks.
 */
export interface AccountStructureSnapshot {
  /** Accounting configuration id — sole authority after Task 11 (D1) NOT NULL */
  accountingConfigurationId: string;
  /** Coding version id — code shape version (D2 untouched) NOT NULL */
  versionId: string;
  maxDepth: number;
  levels: readonly Pick<
    CodingStructureLevel,
    'levelIndex' | 'digitLength' | 'defaultIsPostable'
  >[];
}

@Injectable()
export class AccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  async findById(id: string): Promise<Account | null> {
    const { account } = await this.client();
    const row = await account.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<Account | null> {
    const { account } = await this.client();
    const row = await account.findFirst({ where: { organizationId, code } });
    return row === null ? null : toDomain(row);
  }

  /** One child of an account, for a rejection message that names it. */
  async findChild(
    organizationId: string,
    parentId: string,
  ): Promise<Account | null> {
    const { account } = await this.client();
    const row = await account.findFirst({
      where: { organizationId, parentId },
    });
    return row === null ? null : toDomain(row);
  }

  /** The whole organization's parent edges — the input of the tree walk. */
  async listHierarchyEdges(organizationId: string): Promise<HierarchyEdge[]> {
    const { account } = await this.client();
    const rows = await account.findMany({
      where: { organizationId },
      orderBy: [{ id: 'asc' }],
      skip: 0,
      take: MAX_TREE_EDGES,
    });
    return rows.map((row) => ({ id: row.id, parentId: row.parentId }));
  }

  async list(params: {
    where: AccountListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Account[]; total: number }> {
    const { account } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      account.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      account.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  /**
   * Insert one account, validating placement against the LOCKED parent (or the
   * LOCKED active configuration + coding-structure version for a root).
   *
   * @throws AccountPlacementRejectedError for any violated tree invariant.
   * @throws CodingStructureVersionNotActiveError when the coding-structure
   *   version a ROOT would be pinned to is not (or is no longer) the
   *   organization's `active` one (stale request: retry).
   * @throws AccountingConfigurationNotActiveError when the accounting
   *   configuration a ROOT would be pinned to is not `ACTIVE`.
   * @throws `P2002` when the code is taken (the service maps it to 409).
   */
  async createChecked(input: {
    id: string;
    organizationId: string;
    code: string;
    title: string;
    parentId: string | null;
    accountNature: string;
    isPostable: boolean;
    structure: AccountStructureSnapshot;
    now: Date;
    actorId: string | null;
  }): Promise<Account> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      let parent: AccountPlacementParent | null = null;
      if (input.parentId !== null) {
        const lockedParent = await lockAccountRow(tx, input.parentId);
        if (lockedParent === null) {
          throw new AccountPlacementRejectedError('parent_not_found');
        }
        parent = placementParent(lockedParent);
        // Child must belong to same accounting configuration AND same coding version as parent (D1 sole scope + D2 code shape)
        if (
          lockedParent.accountingConfigurationId !==
          input.structure.accountingConfigurationId
        ) {
          throw new AccountPlacementRejectedError('version_mismatch');
        }
        if (
          lockedParent.codingStructureVersionId !== input.structure.versionId
        ) {
          throw new AccountPlacementRejectedError('version_mismatch');
        }
      } else {
        // Root account — D1 + §9.4: BOTH rows the new root is pinned to are
        // locked and re-checked here, at the authoritative write boundary.
        // The levels the snapshot validated against come from this very
        // configuration (the service resolved it by id), and an ACTIVE
        // configuration/version is immutable, so the locked rows cannot
        // disagree with the snapshot.
        //
        // Lock order: coding-structure version, then accounting
        // configuration, then (implicitly) the new account row. No other
        // transaction takes these two in the opposite order.
        const version = await lockCodingStructureVersionRow(
          tx,
          input.structure.versionId,
        );
        const config = await lockAccountingConfigurationRow(
          tx,
          input.structure.accountingConfigurationId,
        );
        const pinProblem = planRootAccountPin({
          organizationId: input.organizationId,
          snapshot: {
            accountingConfigurationId:
              input.structure.accountingConfigurationId,
            versionId: input.structure.versionId,
          },
          configuration: config,
          version,
        });
        if (pinProblem === 'configuration_missing') {
          throw new AccountingConfigurationNotActiveError('missing');
        }
        if (pinProblem === 'configuration_not_active') {
          // `planRootAccountPin` returns this only for a non-null row, so the
          // status is the locked row's own.
          throw new AccountingConfigurationNotActiveError(config!.status);
        }
        if (pinProblem === 'coding_version_missing') {
          throw new CodingStructureVersionNotActiveError('missing');
        }
        if (pinProblem === 'coding_version_not_active') {
          throw new CodingStructureVersionNotActiveError(version!.status);
        }
      }

      const plan = planAccountPlacement({
        id: '',
        organizationId: input.organizationId,
        parentId: input.parentId,
        code: input.code,
        parent,
        descendantIds: [],
        current: null,
        levels: input.structure.levels,
        maxDepth: input.structure.maxDepth,
      });
      if (plan.problem !== null) {
        throw new AccountPlacementRejectedError(plan.problem);
      }
      // A brand-new account has no children, so `is_postable` cannot violate
      // the leaf rule here; the placement check covered the parent's side.

      const data: AccountCreate = {
        id: input.id,
        organizationId: input.organizationId,
        code: input.code,
        title: input.title,
        parentId: input.parentId,
        level: plan.level,
        codingStructureVersionId: input.structure.versionId,
        accountingConfigurationId: input.structure.accountingConfigurationId,
        accountNature: input.accountNature,
        isPostable: input.isPostable,
        isActive: true,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
      };
      return toDomain(await tx.account.create({ data }));
    });
  }

  /**
   * Apply an account edit under the locks the invariants need:
   *
   * - a MOVE re-runs the whole placement table against the locked rows — cycle,
   *   level derivation, code prefix, postable/disabled parent, one-version
   *   subtree, depth — and refuses a snapshot that is not the pair the account is
   *   already pinned to, so validation can never read another configuration's or
   *   version's levels;
   * - a postability flip counts children under the node lock;
   * - structural fields are refused once a document line references the
   *   account (AC-I-11; see `isReferencedByDocumentLine` for why that predicate
   *   is a seam in this task).
   *
   * `code` is never part of the patch — it is immutable once created (§8.3) —
   * and `level` is always re-derived, never client input.
   */
  async updateChecked(input: {
    id: string;
    title?: string | undefined;
    accountNature?: string | undefined;
    isPostable?: boolean | undefined;
    parentId?: string | null | undefined;
    /** Required for a move only (the code/prefix rules read the level rows). */
    structure: AccountStructureSnapshot | null;
    now: Date;
    actorId: string | null;
  }): Promise<Account> {
    const requestedParentId =
      input.parentId === undefined ? undefined : input.parentId;
    const willLockParent =
      requestedParentId !== undefined && requestedParentId !== null;

    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Lock BOTH rows in ascending id order BEFORE reading either of them, so
      // two racing moves of the same pair serialize instead of deadlocking.
      const ids = [
        ...new Set([input.id, ...(willLockParent ? [requestedParentId] : [])]),
      ];
      ids.sort();
      const locked = new Map<string, LockedAccount>();
      for (const id of ids) {
        const row = await lockAccountRow(tx, id);
        if (row === null) {
          if (id === input.id) {
            // Resolved by the service; rows are never deleted → a bug.
            throw new Error(`Account "${input.id}" no longer exists.`);
          }
          throw new AccountPlacementRejectedError('parent_not_found');
        }
        locked.set(id, row);
      }
      const nodeRow = locked.get(input.id);
      if (nodeRow === undefined) {
        throw new Error(`Account "${input.id}" no longer exists.`);
      }
      const node = toDomain(nodeRow);
      const parentRow =
        requestedParentId === undefined || requestedParentId === null
          ? undefined
          : locked.get(requestedParentId);
      const parentChanged =
        requestedParentId !== undefined && requestedParentId !== node.parentId;
      const parent: AccountPlacementParent | null =
        parentRow === undefined ? null : placementParent(parentRow);

      // AC-I-11's predicate, evaluated UNDER the account's `FOR UPDATE` lock:
      // a concurrent voucher write holds the same row `FOR SHARE` while it
      // inserts lines (`lockAccountsForLinesInTx`), so the count below either
      // sees the committed lines or waits until they are committed.
      const referencedByDocumentLine =
        (await countReferencingLinesInTx(tx, node.id)) > 0;
      const refused = this.immutableRefusals(
        input,
        node,
        parentChanged,
        referencedByDocumentLine,
      );
      if (refused.length > 0) {
        throw new AccountImmutableAfterUseError(refused);
      }

      const children = await tx.account.findMany({
        where: { organizationId: node.organizationId, parentId: node.id },
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 2,
      });
      const hasChildren = children.length > 0;

      if (input.isPostable !== undefined) {
        const problem = planPostabilityChange({
          isPostable: input.isPostable,
          hasChildren,
        });
        if (problem !== null) {
          const [blocking] = children;
          throw new AccountPostabilityRejectedError(blocking?.id ?? '');
        }
      }

      let level = node.level;
      if (parentChanged) {
        if (input.structure === null) {
          // The service always resolves the pinned configuration/version for a
          // move; getting here without it is a caller bug, not an API outcome.
          throw new Error(
            'Account move requires the pinned configuration snapshot.',
          );
        }
        // The authoritative pin check (D1 + D2): a move is validated against
        // the configuration and version the account is pinned to — nothing
        // else. A snapshot naming another configuration/version is refused
        // here even if a caller bypassed the service pre-check.
        const pinProblem = planAccountMovePin({
          pinned: {
            accountingConfigurationId: node.accountingConfigurationId,
            codingStructureVersionId: node.codingStructureVersionId,
          },
          snapshot: input.structure,
        });
        if (pinProblem !== null) {
          throw new AccountPlacementRejectedError('version_mismatch');
        }
        const plan = planAccountPlacement({
          id: node.id,
          organizationId: node.organizationId,
          parentId: requestedParentId ?? null,
          code: node.code,
          parent: parent as any,
          descendantIds: descendantsOf(
            await edgesOf(tx, node.organizationId),
            node.id,
          ),
          current: {
            level: node.level,
            codingStructureVersionId: node.codingStructureVersionId,
            accountingConfigurationId: node.accountingConfigurationId,
            hasChildren,
          },
          levels: input.structure?.levels ?? [],
          maxDepth: input.structure?.maxDepth ?? 0,
        });
        if (plan.problem !== null) {
          throw new AccountPlacementRejectedError(plan.problem);
        }
        level = plan.level;
      }

      const patch: AccountUpdate = {
        updatedAt: input.now,
        updatedBy: input.actorId,
      };
      if (input.title !== undefined) patch.title = input.title;
      if (input.accountNature !== undefined) {
        patch.accountNature = input.accountNature;
      }
      if (input.isPostable !== undefined) patch.isPostable = input.isPostable;
      if (parentChanged) {
        patch.parentId = requestedParentId ?? null;
        patch.level = level;
      }
      return toDomain(
        await tx.account.update({ where: { id: node.id }, data: patch }),
      );
    });
  }

  /** Lifecycle flip (`is_active`) — no cross-row guard, so no transaction. */
  async update(id: string, patch: AccountUpdate): Promise<Account | null> {
    const { account } = await this.client();
    try {
      return toDomain(await account.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Which requested changes AC-I-11 freezes for a referenced account. The
   * caller passes the line count's verdict (Task 10.4 wires it to
   * `accounting_document_lines`); the decision itself stays in the domain.
   */
  private immutableRefusals(
    input: {
      isPostable?: boolean | undefined;
      accountNature?: string | undefined;
    },
    node: Account,
    parentChanged: boolean,
    referencedByDocumentLine: boolean,
  ): AccountImmutableField[] {
    return planAccountEdit({
      referencedByDocumentLine,
      changes: {
        parentId: parentChanged,
        // `level` moves with the parent; it is never an independent input.
        level: parentChanged,
        accountNature:
          input.accountNature !== undefined &&
          input.accountNature !== node.accountNature,
        isPostable:
          input.isPostable !== undefined &&
          input.isPostable !== node.isPostable,
      },
    }).refused;
  }
}

// ---- Internal helpers ----

async function edgesOf(
  tx: AccountingTxClient,
  organizationId: string,
): Promise<HierarchyEdge[]> {
  const rows = await tx.account.findMany({
    where: { organizationId },
    orderBy: [{ id: 'asc' }],
    skip: 0,
    take: MAX_TREE_EDGES,
  });
  return rows.map((row) => ({ id: row.id, parentId: row.parentId }));
}

function descendantsOf(
  edges: readonly HierarchyEdge[],
  rootId: string,
): string[] {
  return collectDescendantIds(edges, rootId);
}

function toWhere(filter: AccountListFilter): AccountWhere {
  const where: AccountWhere = { organizationId: filter.organizationId };
  if (filter.parentId !== undefined) where.parentId = filter.parentId;
  if (filter.level !== undefined) where.level = filter.level;
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.isPostable !== undefined) where.isPostable = filter.isPostable;
  if (filter.codingStructureVersionId !== undefined) {
    where.codingStructureVersionId = filter.codingStructureVersionId;
  }
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { title: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function placementParent(
  row: LockedAccount | AccountRow,
): AccountPlacementParent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    level: row.level,
    isPostable: row.isPostable,
    isActive: row.isActive,
    codingStructureVersionId: (row as any).codingStructureVersionId,
    accountingConfigurationId: (row as any).accountingConfigurationId,
  };
}

function toDomain(row: AccountRow | LockedAccount): Account {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    title: row.title,
    parentId: row.parentId,
    level: row.level,
    codingStructureVersionId: row.codingStructureVersionId,
    accountingConfigurationId: (row as AccountRow).accountingConfigurationId,
    // Unreachable by construction (writes go through the closed list); the
    // fallback picks the reading no report should silently treat as credit.
    accountNature: isAccountNature(row.accountNature)
      ? row.accountNature
      : 'debit',
    isPostable: row.isPostable,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
