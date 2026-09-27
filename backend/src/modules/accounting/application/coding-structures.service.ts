import { Injectable } from '@nestjs/common';
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
  CodingStructuresRepository,
  type CodingStructureListFilter,
  type LevelWrite,
} from '../data/coding-structures.repository.js';
import {
  CodingStructureNotDraftError,
  CodingStructurePlanRejectedError,
  NoActiveCodingStructureError,
} from '../data/accounting-structure-errors.js';
import type {
  CodingStructureLevelInput,
  CodingStructureProblem,
  CodingStructureVersion,
  CodingStructureVersionDto,
} from '../domain/coding-structure.js';
import {
  codingStructureProblemMessage,
  isCodingStructureStatus,
  planCodingStructure,
  toCodingStructureVersionDto,
} from '../domain/coding-structure.js';
import { CODING_STRUCTURE_PERMISSIONS } from '../domain/accounting-permissions.js';
import { normalizeCode, normalizeTitle } from '../domain/master-data.js';
import { resolveSort } from './accounting-support.js';

/**
 * Coding structure administration (§9, AC-D-10, ADR-0026 §1).
 *
 * The organization's account coding is CONFIGURATION: callers draft a version
 * (depth + one level row per level, each with its digit length and its default
 * postability), publish it, and every new root account is then coded against the
 * active version. Nothing in this service knows what a code "looks like" — the
 * shape lives in the stored level rows, and the same `planCodingStructure`
 * decision table runs on the draft write (fast feedback), on the publish gate,
 * and again inside the publish transaction (the repository re-applies it under
 * the organization-wide lock, so "exactly one active version per organization"
 * cannot be raced — §9.4).
 *
 * Version lifecycle is one-way (`draft → active → superseded`): `active` and
 * `superseded` versions are immutable, so a structure change is always a NEW
 * version, and accounts keep pinning the version they were created under — a
 * later change never reinterprets an existing code (§9.4, AC-I-14).
 *
 * This service publishes NO domain event: contract §21 has no `CodingStructure.*`
 * row, and inventing an event name would extend the event contract (AR-29). The
 * change is durable in the AR-12 audit columns; its consequences surface as
 * `Account.Created` events.
 *
 * Organization scoping and authorization follow the Task 10.2 posture exactly:
 * the permission is checked in the service as well as on the route, and any id
 * from another organization answers 404, never 403 (AC-D-01, AC-I-01/16).
 */

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  versionNumber: 'versionNumber',
  status: 'status',
  maxDepth: 'maxDepth',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListCodingStructuresQuery {
  /** Mandatory: a structure list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  code?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface LevelInput {
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind?: string | null | undefined;
}

export interface CreateCodingStructureVersionInput {
  organizationId: string;
  code: string;
  maxDepth: number;
  separator?: string | undefined;
  levels: readonly LevelInput[];
}

export interface UpdateCodingStructureVersionInput {
  maxDepth?: number | undefined;
  separator?: string | undefined;
  levels?: readonly LevelInput[] | undefined;
}

@Injectable()
export class CodingStructuresService {
  constructor(
    private readonly repository: CodingStructuresRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listVersions(
    query: ListCodingStructuresQuery,
  ): Promise<PaginatedResult<CodingStructureVersionDto>> {
    await this.authorization.requireAllPermissions([
      CODING_STRUCTURE_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    if (query.status !== undefined && !isCodingStructureStatus(query.status)) {
      throw AppException.badRequest(
        'status must be one of: draft, active, superseded.',
      );
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const where: CodingStructureListFilter = {
      organizationId: query.organizationId,
      code: query.code,
      status: query.status,
      search: query.search,
    };
    const { items, total } = await this.repository.list({
      where,
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { code: 'asc' },
        { versionNumber: 'desc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toCodingStructureVersionDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getVersion(
    organizationId: string,
    id: string,
  ): Promise<CodingStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      CODING_STRUCTURE_PERMISSIONS.VIEW,
    ]);
    return toCodingStructureVersionDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  /** The version new root accounts are coded against (§9.4). */
  async getActiveVersion(
    organizationId: string,
  ): Promise<CodingStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      CODING_STRUCTURE_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const active =
      await this.repository.findActiveForOrganization(organizationId);
    if (active === null) {
      // No id was named, so this is not an existence leak: the organization
      // simply has nothing active to read.
      throw AppException.notFound('CodingStructureVersion');
    }
    return toCodingStructureVersionDto(active);
  }

  async createVersion(
    input: CreateCodingStructureVersionInput,
  ): Promise<CodingStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      CODING_STRUCTURE_PERMISSIONS.CONFIGURE,
    ]);
    const code = normalizeCode(input.code);
    const separator = input.separator ?? '';
    const levels = normalizeLevels(input.levels);
    this.assertPlan(code, input.maxDepth, separator, levels);
    // A disabled organization blocks new organization-scoped records
    // (master-data-strategy.md §7.4).
    await this.organizations.requireUsableOrganization(input.organizationId);

    const actorId = getPrincipal()?.userId ?? null;
    const now = new Date();
    // Ordinals are max + 1 per (organization, code); two concurrent creates
    // collide on the unique index and the loser retries with the recomputed
    // number — so no read-then-write window ever decides the ordinal.
    let created: CodingStructureVersion | null = null;
    for (let attempt = 0; attempt < 3 && created === null; attempt += 1) {
      const latest = await this.repository.findLatestForCode(
        input.organizationId,
        code,
      );
      try {
        created = await this.repository.createDraftWithLevels({
          id: generateId(),
          organizationId: input.organizationId,
          code,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          maxDepth: input.maxDepth,
          separator,
          levels: withIds(levels),
          createdAt: now,
          actorId,
        });
      } catch (error) {
        const mapped = mapStructureGuardError(error);
        if (mapped !== null) throw mapped;
        if (!isUniqueViolation(error)) throw error;
        if (attempt === 2) {
          throw AppException.conflict(
            'A coding structure version was created concurrently. Retry the request.',
          );
        }
      }
    }
    const version = created as CodingStructureVersion;
    this.logger.log(
      'Coding structure version drafted',
      {
        versionId: version.id,
        organizationId: version.organizationId,
        code: version.code,
        versionNumber: version.versionNumber,
      },
      CodingStructuresService.name,
    );
    return toCodingStructureVersionDto(version);
  }

  async updateVersion(
    organizationId: string,
    id: string,
    input: UpdateCodingStructureVersionInput,
  ): Promise<CodingStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      CODING_STRUCTURE_PERMISSIONS.CONFIGURE,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.status !== 'draft') {
      throw AppException.businessRule(
        `Coding structure version ${current.versionNumber} is "${current.status}" and cannot be changed. Create a new version instead.`,
      );
    }
    const levels =
      input.levels === undefined ? undefined : normalizeLevels(input.levels);
    // Fast feedback with the SAME decision table the transaction re-applies
    // under the version lock (so a shrinking maxDepth is caught against the
    // level rows that remain).
    this.assertPlan(
      current.code,
      input.maxDepth ?? current.maxDepth,
      input.separator ?? current.separator,
      levels ?? current.levels,
    );

    const updated = await this.runGuarded(() =>
      this.repository.updateDraftChecked({
        id,
        maxDepth: input.maxDepth,
        separator: input.separator,
        levels: levels === undefined ? undefined : withIds(levels),
        updatedAt: new Date(),
        actorId: getPrincipal()?.userId ?? null,
      }),
    );
    return toCodingStructureVersionDto(updated);
  }

  async publishVersion(
    organizationId: string,
    id: string,
  ): Promise<CodingStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      CODING_STRUCTURE_PERMISSIONS.CONFIGURE,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.status !== 'draft') {
      throw AppException.businessRule(
        `Only a draft coding structure version can be published (this one is "${current.status}").`,
      );
    }
    this.assertPlan(
      current.code,
      current.maxDepth,
      current.separator,
      current.levels,
    );

    const published = await this.runGuarded(async () => {
      const result = await this.repository.publishChecked({
        versionId: id,
        organizationId: current.organizationId,
        now: new Date(),
        actorId: getPrincipal()?.userId ?? null,
      });
      if (result === null) {
        throw AppException.notFound('CodingStructureVersion', id);
      }
      return result;
    });
    this.logger.log(
      'Coding structure version published',
      {
        versionId: published.version.id,
        organizationId: published.version.organizationId,
        code: published.version.code,
        versionNumber: published.version.versionNumber,
        supersededVersionId: published.supersededVersionId,
      },
      CodingStructuresService.name,
    );
    return toCodingStructureVersionDto(published.version);
  }

  // ---- cross-service resolvers (no permission of their own) ---------------

  /**
   * The version NEW ROOT accounts pin (§9.4), for `AccountsService`.
   *
   * A missing active version answers 422 rather than 404: no id was supplied,
   * so there is nothing "not found" — the organization is simply not
   * configured yet, which contract §28.2 explicitly allows ("the mechanism may
   * be built first with configuration empty").
   */
  async requireActiveVersionOrThrow(
    organizationId: string,
  ): Promise<CodingStructureVersion> {
    const active =
      await this.repository.findActiveForOrganization(organizationId);
    if (active === null) {
      throw AppException.businessRule(
        'This organization has no active coding structure. Configure one and publish it before creating accounts.',
      );
    }
    return active;
  }

  /** Scope-qualified version lookup (the accounts service resolves parents). */
  async requireVersionInOrganization(
    organizationId: string,
    versionId: string,
  ): Promise<CodingStructureVersion> {
    return this.mustFindInOrganization(organizationId, versionId);
  }

  // ---- internals ----------------------------------------------------------

  private assertPlan(
    code: string,
    maxDepth: number,
    separator: string,
    levels: readonly CodingStructureLevelInput[],
  ): void {
    const plan = planCodingStructure({ code, maxDepth, separator, levels });
    if (plan.problem !== null) {
      throw AppException.badRequest(
        structureProblemText(plan.problem, plan.subject),
      );
    }
  }

  /** Runs a guarded repository write, mapping its plain errors to the API. */
  private async runGuarded<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const mapped = mapStructureGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<CodingStructureVersion> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const version = await this.repository.findById(id);
    if (version === null || version.organizationId !== organizationId) {
      throw AppException.notFound('CodingStructureVersion', id);
    }
    return version;
  }
}

// ---- Internal helpers ----

/** Level titles follow the shared name normalization; the rest is data. */
function normalizeLevels(
  levels: readonly LevelInput[],
): CodingStructureLevelInput[] {
  return levels.map((level) => ({
    levelIndex: level.levelIndex,
    title: normalizeTitle(level.title),
    digitLength: level.digitLength,
    defaultIsPostable: level.defaultIsPostable,
    levelKind: level.levelKind ?? null,
  }));
}

/** Row ids are generated in the application layer, never in the database. */
function withIds(levels: readonly CodingStructureLevelInput[]): LevelWrite[] {
  return levels.map((level) => ({ ...level, id: generateId() }));
}

function structureProblemText(
  problem: CodingStructureProblem,
  subject: string | undefined,
): string {
  const base = codingStructureProblemMessage(problem);
  return subject === undefined ? base : `${base} (level ${subject})`;
}

/**
 * The single mapping from the structure guard errors (plain errors thrown by
 * the repository inside its transactions) onto the stable API error model.
 * Returns `null` for anything that is not one of them.
 */
export function mapStructureGuardError(error: unknown): AppException | null {
  if (error instanceof CodingStructurePlanRejectedError) {
    return AppException.badRequest(
      structureProblemText(error.problem, error.subject),
    );
  }
  if (error instanceof CodingStructureNotDraftError) {
    return AppException.businessRule(
      'The coding structure version is no longer a draft and cannot be changed. Create a new version instead.',
    );
  }
  if (error instanceof NoActiveCodingStructureError) {
    return AppException.businessRule(
      'This organization has no active coding structure. Configure one and publish it before creating accounts.',
    );
  }
  return null;
}
