import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type {
  CodingStructureLevel,
  CodingStructureSeparator,
  CodingStructureStatus,
  CodingStructureVersion,
} from '../domain/coding-structure.js';
import {
  isAccountLevelKind,
  isCodingStructureSeparator,
  isCodingStructureStatus,
  orderedLevels,
  planCodingStructure,
} from '../domain/coding-structure.js';
import {
  CodingStructureNotDraftError,
  CodingStructurePlanRejectedError,
} from './accounting-structure-errors.js';
import {
  lockCodingStructureVersionRow,
  lockCodingStructureVersionsOfOrganization,
} from './accounting-locks.js';
import type {
  AccountingTransactionalClient,
  CodingStructureLevelCreate,
  CodingStructureLevelDelegate,
  CodingStructureLevelRow,
  CodingStructureVersionCreate,
  CodingStructureVersionDelegate,
  CodingStructureVersionRow,
  CodingStructureVersionWhere,
  OrderBy,
} from './accounting-rows.js';

/**
 * Data access for `accounting.coding_structure_versions` and
 * `accounting.coding_structure_levels`.
 *
 * Three writes own a transaction (everything else is a single-row read or a
 * plain update):
 *
 * - `createDraftWithLevels`: version + level rows in ONE transaction, so a
 *   draft never exists without the levels it was configured with. The ordinal
 *   `(organization_id, code, version_number)` unique index is authoritative;
 *   the service retries the max+1 assignment when two creates collide (the
 *   Workflow version precedent).
 * - `updateDraftChecked`: locks the version row, re-checks `draft`, then
 *   replaces the level set. A publish racing the edit is refused by exactly one
 *   of the two, so an ACTIVE or SUPERSEDED version is never mutated (§9.4,
 *   ADR-0024's draft-configuration rule). Deleting level rows is legal ONLY
 *   here: a draft is an unreferenced workspace no account can pin.
 * - `publishChecked`: locks every version row of the organization (ascending
 *   id), re-validates the locked snapshot, and only then supersedes the previous
 *   active version and activates this one — which is what makes "exactly one
 *   active version per organization" hold under concurrency (§9.4).
 */

type Client = {
  codingStructureVersion: CodingStructureVersionDelegate;
  codingStructureLevel: CodingStructureLevelDelegate;
};

/**
 * The domain cap on levels (`MAX_CODING_STRUCTURE_DEPTH`), repeated as a local
 * constant because a repository must not import a domain constant just to size a
 * `take` — the value is a bound, not a rule, and the rule is applied by the
 * domain validator.
 */
const MAX_LEVEL_ROWS = 8;

export interface CodingStructureListFilter {
  /** Always set by the service: a list is never cross-organization. */
  organizationId: string;
  code?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
}

/** One level row as the caller writes it (ids are generated in the service). */
export interface LevelWrite {
  id: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
}

@Injectable()
export class CodingStructuresRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  async findById(id: string): Promise<CodingStructureVersion | null> {
    const { codingStructureVersion } = await this.client();
    const row = await codingStructureVersion.findUnique({ where: { id } });
    if (row === null) return null;
    return toDomain(row, await this.listLevelRows(id));
  }

  /** The version NEW root accounts are created under (§9.4). */
  async findActiveForOrganization(
    organizationId: string,
  ): Promise<CodingStructureVersion | null> {
    const { codingStructureVersion } = await this.client();
    const row = await codingStructureVersion.findFirst({
      where: { organizationId, status: 'active' },
    });
    if (row === null) return null;
    return toDomain(row, await this.listLevelRows(row.id));
  }

  /** Highest ordinal of one named structure (the next version is max + 1). */
  async findLatestForCode(
    organizationId: string,
    code: string,
  ): Promise<{ versionNumber: number } | null> {
    const { codingStructureVersion } = await this.client();
    const rows = await codingStructureVersion.findMany({
      where: { organizationId, code },
      orderBy: [{ versionNumber: 'desc' }],
      skip: 0,
      take: 1,
    });
    const [row] = rows;
    return row === undefined ? null : { versionNumber: row.versionNumber };
  }

  async list(params: {
    where: CodingStructureListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: CodingStructureVersion[]; total: number }> {
    const { codingStructureVersion, codingStructureLevel } =
      await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      codingStructureVersion.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      codingStructureVersion.count({ where }),
    ]);
    // ONE extra query for the whole page's levels instead of one per row.
    const versionIds = rows.map((row) => row.id);
    const levelRows =
      versionIds.length === 0
        ? []
        : await codingStructureLevel.findMany({
            where: { versionId: { in: versionIds } },
            orderBy: [{ levelIndex: 'asc' }],
            skip: 0,
            take: versionIds.length * MAX_LEVEL_ROWS,
          });
    return {
      items: rows.map((row) =>
        toDomain(
          row,
          levelRows.filter((level) => level.versionId === row.id),
        ),
      ),
      total,
    };
  }

  /**
   * Create a draft version with its levels, atomically. The unique index on
   * `(organization_id, code, version_number)` is the authoritative guard
   * against an ordinal race; the caller maps `P2002` to a retry.
   */
  async createDraftWithLevels(input: {
    id: string;
    organizationId: string;
    code: string;
    versionNumber: number;
    maxDepth: number;
    separator: string;
    levels: readonly LevelWrite[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<CodingStructureVersion> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const data: CodingStructureVersionCreate = {
        id: input.id,
        organizationId: input.organizationId,
        code: input.code,
        versionNumber: input.versionNumber,
        status: 'draft',
        maxDepth: input.maxDepth,
        separator: input.separator,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        createdBy: input.actorId,
      };
      const created = await tx.codingStructureVersion.create({ data });
      for (const level of input.levels) {
        await tx.codingStructureLevel.create({
          data: levelCreate(input.organizationId, created.id, level, input),
        });
      }
      const levels = await tx.codingStructureLevel.findMany({
        where: { versionId: created.id },
        orderBy: [{ levelIndex: 'asc' }],
        skip: 0,
        take: MAX_LEVEL_ROWS,
      });
      return toDomain(created, levels);
    });
  }

  /**
   * Replace a DRAFT version's configuration (depth, separator, level set).
   *
   * The shape check runs against the LOCKED row and the levels as they will be
   * stored — including the case where only `maxDepth` changes and the existing
   * level rows must still fit under it.
   *
   * @throws CodingStructureNotDraftError when the version is no longer a draft.
   * @throws CodingStructurePlanRejectedError when the resulting shape is not a
   *   valid coding structure.
   */
  async updateDraftChecked(input: {
    id: string;
    maxDepth?: number | undefined;
    separator?: string | undefined;
    levels?: readonly LevelWrite[] | undefined;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<CodingStructureVersion> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockCodingStructureVersionRow(tx, input.id);
      // The row was resolved by the service and versions are never deleted:
      // a row that disappeared mid-flight is a bug, not an API outcome.
      if (locked === null) {
        throw new Error(
          `Coding structure version "${input.id}" no longer exists.`,
        );
      }
      if (locked.status !== 'draft') {
        throw new CodingStructureNotDraftError(locked.status);
      }

      const maxDepth = input.maxDepth ?? locked.maxDepth;
      const separator = input.separator ?? locked.separator;
      const storedLevels =
        input.levels === undefined
          ? await tx.codingStructureLevel.findMany({
              where: { versionId: input.id },
              orderBy: [{ levelIndex: 'asc' }],
              skip: 0,
              take: MAX_LEVEL_ROWS,
            })
          : [];
      const candidateLevels =
        input.levels ??
        storedLevels.map((row) => ({
          id: row.id,
          levelIndex: row.levelIndex,
          title: row.title,
          digitLength: row.digitLength,
          defaultIsPostable: row.defaultIsPostable,
          levelKind: row.levelKind,
        }));

      const plan = planCodingStructure({
        code: locked.code,
        maxDepth,
        separator,
        levels: candidateLevels,
      });
      if (plan.problem !== null) {
        throw new CodingStructurePlanRejectedError(plan.problem, plan.subject);
      }

      await tx.codingStructureVersion.update({
        where: { id: input.id },
        data: {
          maxDepth,
          separator,
          updatedAt: input.updatedAt,
          updatedBy: input.actorId,
        },
      });
      if (input.levels !== undefined) {
        await tx.codingStructureLevel.deleteMany({
          where: { versionId: input.id },
        });
        for (const level of input.levels) {
          await tx.codingStructureLevel.create({
            data: levelCreate(locked.organizationId, input.id, level, {
              createdAt: input.updatedAt,
              actorId: input.actorId,
            }),
          });
        }
      }

      const rows = await tx.codingStructureVersion.findMany({
        where: { id: input.id },
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 1,
      });
      const row = rows[0];
      if (row === undefined) {
        throw new Error(
          `Coding structure version "${input.id}" no longer exists.`,
        );
      }
      const levels = await tx.codingStructureLevel.findMany({
        where: { versionId: input.id },
        orderBy: [{ levelIndex: 'asc' }],
        skip: 0,
        take: MAX_LEVEL_ROWS,
      });
      return toDomain(row, levels);
    });
  }

  /**
   * Activate a draft version and supersede the previously active version of the
   * SAME organization (§9.4: exactly one active version per organization).
   *
   * @returns the activated snapshot plus the superseded version id, or `null`
   *   when either row disappeared (the service maps it to 404).
   * @throws CodingStructureNotDraftError when the version is not a draft.
   * @throws CodingStructurePlanRejectedError when the locked snapshot is not
   *   publishable (a racing configuration write, or an unfinished draft).
   */
  async publishChecked(input: {
    versionId: string;
    organizationId: string;
    now: Date;
    actorId: string | null;
  }): Promise<{
    version: CodingStructureVersion;
    supersededVersionId: string | null;
  } | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Organization-wide lock FIRST: "exactly one active version" is an
      // organization-wide statement, so this is the serialization point.
      const lockedIds = await lockCodingStructureVersionsOfOrganization(
        tx,
        input.organizationId,
      );
      if (!lockedIds.includes(input.versionId)) return null;
      const locked = await lockCodingStructureVersionRow(tx, input.versionId);
      if (locked === null) return null;
      if (locked.status !== 'draft') {
        throw new CodingStructureNotDraftError(locked.status);
      }

      const levels = await tx.codingStructureLevel.findMany({
        where: { versionId: input.versionId },
        orderBy: [{ levelIndex: 'asc' }],
        skip: 0,
        take: MAX_LEVEL_ROWS,
      });
      const snapshot = toDomain(locked, levels);
      const plan = planCodingStructure({
        code: snapshot.code,
        maxDepth: snapshot.maxDepth,
        separator: snapshot.separator,
        levels: snapshot.levels,
      });
      if (plan.problem !== null) {
        throw new CodingStructurePlanRejectedError(plan.problem, plan.subject);
      }

      const previous = await tx.codingStructureVersion.findMany({
        where: { organizationId: input.organizationId, status: 'active' },
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 10_000,
      });
      let supersededVersionId: string | null = null;
      for (const row of previous) {
        if (row.id === input.versionId) continue;
        supersededVersionId = row.id;
        await tx.codingStructureVersion.update({
          where: { id: row.id },
          data: {
            status: 'superseded' satisfies CodingStructureStatus,
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        });
      }
      const activated = await tx.codingStructureVersion.update({
        where: { id: input.versionId },
        data: {
          status: 'active' satisfies CodingStructureStatus,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
      return {
        version: toDomain(activated, levels),
        supersededVersionId,
      };
    });
  }

  private async listLevelRows(
    versionId: string,
  ): Promise<CodingStructureLevelRow[]> {
    const { codingStructureLevel } = await this.client();
    return codingStructureLevel.findMany({
      where: { versionId },
      orderBy: [{ levelIndex: 'asc' }],
      skip: 0,
      take: MAX_LEVEL_ROWS,
    });
  }
}

// ---- Internal helpers ----

function toWhere(
  filter: CodingStructureListFilter,
): CodingStructureVersionWhere {
  const where: CodingStructureVersionWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.code !== undefined) where.code = filter.code;
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [{ code: { contains: filter.search, mode: 'insensitive' } }];
  }
  return where;
}

function levelCreate(
  organizationId: string,
  versionId: string,
  level: LevelWrite,
  stamp: { createdAt: Date; actorId: string | null },
): CodingStructureLevelCreate {
  return {
    id: level.id,
    organizationId,
    versionId,
    levelIndex: level.levelIndex,
    title: level.title,
    digitLength: level.digitLength,
    defaultIsPostable: level.defaultIsPostable,
    levelKind: level.levelKind,
    createdAt: stamp.createdAt,
    updatedAt: stamp.createdAt,
    createdBy: stamp.actorId,
  };
}

/**
 * The columns the domain entity needs. Deliberately narrower than the full row
 * type so the LOCKED row (`LockedCodingStructureVersion`, read by the publish
 * transaction) and the delegate row map through one function — no second
 * mapper that could drift.
 */
type CodingStructureVersionRowLike = Pick<
  CodingStructureVersionRow,
  | 'id'
  | 'organizationId'
  | 'code'
  | 'versionNumber'
  | 'status'
  | 'maxDepth'
  | 'separator'
  | 'createdAt'
  | 'updatedAt'
>;

function toDomain(
  row: CodingStructureVersionRowLike,
  levelRows: readonly CodingStructureLevelRow[],
): CodingStructureVersion {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    versionNumber: row.versionNumber,
    // The fallbacks are unreachable by construction (every write goes through
    // the closed lists) and each picks the SAFEST reading: an unknown status
    // is treated as immutable and never active, an unknown separator as
    // "render plainly", an unknown kind as "no label".
    status: isCodingStructureStatus(row.status) ? row.status : 'superseded',
    maxDepth: row.maxDepth,
    separator: isCodingStructureSeparator(row.separator)
      ? row.separator
      : ('' satisfies CodingStructureSeparator),
    levels: orderedLevels(levelRows).map((level) =>
      toLevelDomain(row.id, level),
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLevelDomain(
  versionId: string,
  row: CodingStructureLevelRow,
): CodingStructureLevel {
  return {
    id: row.id,
    versionId,
    levelIndex: row.levelIndex,
    title: row.title,
    digitLength: row.digitLength,
    defaultIsPostable: row.defaultIsPostable,
    levelKind:
      row.levelKind !== null && isAccountLevelKind(row.levelKind)
        ? row.levelKind
        : null,
  };
}
