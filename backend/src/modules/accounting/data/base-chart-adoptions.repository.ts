import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  isAccountNature,
  planPinCoherence,
  planRootAccountPin,
} from '../domain/account.js';
import type { BaseChartAdoptionView } from '../domain/base-chart-template.js';
import {
  planAdoptionSelection,
  planTemplateCompatibility,
} from '../domain/base-chart-adoption.js';
import { planBaseChartVersionContent } from '../domain/base-chart-template.js';
import {
  AccountingConfigurationNotActiveError,
  AccountPinsIncoherentError,
  CodingStructureVersionNotActiveError,
} from './accounting-structure-errors.js';
import {
  BaseChartAlreadyAdoptedError,
  BaseChartContentRejectedError,
  BaseChartIncompatibleError,
  BaseChartSelectionRejectedError,
  BaseChartVersionStatusError,
  OrganizationChartNotEmptyError,
} from './base-chart-errors.js';
import {
  lockAccountingConfigurationRow,
  lockBaseChartTemplateVersionRow,
  lockCodingStructureVersionRow,
} from './accounting-locks.js';
import type {
  AccountCreate,
  AccountDelegate,
  AccountingTransactionalClient,
  BaseChartAdoptionCreate,
  BaseChartAdoptionDelegate,
  BaseChartAdoptionRow,
  BaseChartAdoptionWhere,
  BaseChartTemplateDelegate,
  BaseChartTemplateNodeRow,
  BaseChartTemplateVersionDelegate,
} from './accounting-rows.js';
import type { BaseChartTemplateNode } from '../domain/base-chart-template.js';

/**
 * Data access for `accounting.base_chart_adoptions` plus the COPY the
 * adoption performs into the tenant-owned `accounting.accounts` tree.
 *
 * `adoptChecked` is the adoption write boundary. Inside ONE transaction it:
 *
 *   1. locks the template-version row and re-asserts `status = 'published'`
 *      (an adoption that raced a supersede is refused, never stale);
 *   2. re-runs the template content plan against the LOCKED rows (integrity
 *      replay — published versions are immutable, so this is a belt-and-braces
 *      guard, the same discipline `publishChecked` applies);
 *   3. locks the organization's pinned coding-structure-version and
 *      accounting-configuration rows — AFTER the template-version lock, in the
 *      global order documented in `accounting-locks.ts` — and re-asserts the
 *      root-pin decision table (`planRootAccountPin`, the very boundary the
 *      manual root-create path uses, D1 + §9.4) plus the ODR-1 coherence of
 *      the pinned pair (`planPinCoherence`);
 *   4. re-validates template ↔ configuration compatibility
 *      (`planTemplateCompatibility`, task §3/§6 option C) and computes the
 *      final adoption set (`planAdoptionSelection` — selection ∪ ancestors ∪
 *      mandatory, topological order);
 *   5. refuses ANY non-empty tenant chart (`OrganizationChartNotEmptyError` —
 *      adoption never merges, upserts or overwrites, task §20) and any
 *      repeated adoption of the same version (`BaseChartAlreadyAdoptedError`,
 *      the deterministic idempotency conflict, task §18; the
 *      `uq_base_chart_adoptions_scope` unique index is the database
 *      backstop, whose P2002 the service maps to the same 409);
 *   6. inserts the copied `accounts` rows parents-before-children (planner
 *      order) with the pin of BOTH active roots, and finally the ONE
 *      immutable `base_chart_adoptions` record.
 *
 * Nothing else is written: the adopted accounts are ordinary organization
 * accounts (LedgerEntry.accountId semantics untouched; no provenance column
 * is invented — task §17, AR-29).
 */

type Client = {
  baseChartAdoption: BaseChartAdoptionDelegate;
  baseChartTemplate: BaseChartTemplateDelegate;
  baseChartTemplateVersion: BaseChartTemplateVersionDelegate;
  account: Pick<AccountDelegate, 'count'>;
};

const MAX_ROWS = 20_000;

@Injectable()
export class BaseChartAdoptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  // ------------------------------------------------------------------ reads

  async findById(
    organizationId: string,
    adoptionId: string,
  ): Promise<BaseChartAdoptionView | null> {
    const { baseChartAdoption } = await this.client();
    const row = await baseChartAdoption.findUnique({
      where: { id: adoptionId },
    });
    if (row === null || row.organizationId !== organizationId) return null;
    return this.hydrateView(row);
  }

  async listByOrganization(
    organizationId: string,
    page: { skip: number; take: number },
  ): Promise<{ rows: BaseChartAdoptionView[]; total: number }> {
    const { baseChartAdoption } = await this.client();
    const where: BaseChartAdoptionWhere = { organizationId };
    const [rows, total] = await Promise.all([
      baseChartAdoption.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      baseChartAdoption.count({ where }),
    ]);
    const list: BaseChartAdoptionView[] = [];
    for (const row of rows) {
      list.push(await this.hydrateView(row));
    }
    return { rows: list, total };
  }

  /** Advisory emptiness probe for the preview path (the authoritative check runs under locks). */
  async countAccounts(organizationId: string): Promise<number> {
    const { account } = await this.client();
    return account.count({ where: { organizationId } });
  }

  /** Advisory duplicate probe (the authoritative check runs under locks). */
  async findByOrganizationAndVersion(
    organizationId: string,
    templateVersionId: string,
  ): Promise<BaseChartAdoptionRow | null> {
    const { baseChartAdoption } = await this.client();
    return baseChartAdoption.findFirst({
      where: { organizationId, templateVersionId },
    });
  }

  // ----------------------------------------------------------------- writes

  /**
   * Execute the adoption. All parameters marked "resolved" were obtained by
   * the service at pre-flight; EVERY one of them is re-verified under locks
   * inside the transaction, so a stale resolution is refused, never trusted.
   *
   * `accountIdFor` maps templateNodeId → the ULID the service pre-assigned to
   * every node of the final adoption set. The planner is deterministic and
   * the version content immutable, so the re-plan under locks covers exactly
   * the nodes the service planned; a node outside the map is a bug, not an
   * API outcome.
   *
   * @returns the created adoption row, or null when the template-version row
   *   does not exist (the service maps it to 404).
   * @throws BaseChartVersionStatusError the version is not published (422).
   * @throws BaseChartContentRejectedError integrity replay failed (422).
   * @throws AccountingConfigurationNotActiveError /
   *   CodingStructureVersionNotActiveError the pinned roots are no longer the
   *   organization's ACTIVE ones (the guard-race refusal, mapped to the
   *   existing 422 codes by the service).
   * @throws AccountPinsIncoherentError ODR-1 coherence of the pinned pair
   *   failed (422).
   * @throws BaseChartIncompatibleError template and organization shapes do
   *   not match (422).
   * @throws BaseChartSelectionRejectedError the final adoption set cannot be
   *   computed from the request (422).
   * @throws OrganizationChartNotEmptyError the organization already has
   *   accounts (422).
   * @throws BaseChartAlreadyAdoptedError repeated adoption of the same
   *   version (409).
   */
  async adoptChecked(input: {
    adoptionId: string;
    organizationId: string;
    templateVersionId: string;
    selectedNodeKeys: readonly string[] | null;
    accountingConfigurationId: string;
    codingStructureVersionId: string;
    accountIdFor: ReadonlyMap<string, string>;
    now: Date;
    actorId: string | null;
  }): Promise<BaseChartAdoptionRow | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // 1. Template-version lock FIRST (before any tenant lock): re-assert
      //    adoptability at the write boundary.
      const lockedVersion = await lockBaseChartTemplateVersionRow(
        tx,
        input.templateVersionId,
      );
      if (lockedVersion === null) return null;
      if (lockedVersion.status !== 'published') {
        throw new BaseChartVersionStatusError(lockedVersion.status, 'adopt');
      }

      const [levelRows, nodeRows] = await Promise.all([
        tx.baseChartTemplateLevel.findMany({
          where: { versionId: input.templateVersionId },
          orderBy: [{ levelIndex: 'asc' }],
          skip: 0,
          take: MAX_ROWS,
        }),
        tx.baseChartTemplateNode.findMany({
          where: { versionId: input.templateVersionId },
          orderBy: [{ level: 'asc' }, { code: 'asc' }],
          skip: 0,
          take: MAX_ROWS,
        }),
      ]);

      // 2. Integrity replay against the LOCKED rows.
      const contentResult = planBaseChartVersionContent({
        maxDepth: lockedVersion.maxDepth,
        levels: levelRows.map((row) => ({
          levelIndex: row.levelIndex,
          digitLength: row.digitLength,
          defaultIsPostable: row.defaultIsPostable,
        })),
        nodes: nodeRows.map((row) => ({
          nodeKey: row.nodeKey,
          parentNodeKey: row.parentNodeKey,
          code: row.code,
          title: row.title,
          accountNature: row.accountNature,
          isPostable: row.isPostable,
          isMandatory: row.isMandatory,
          defaultIsActive: row.defaultIsActive,
        })),
      });
      if (contentResult.plan.problem !== null) {
        throw new BaseChartContentRejectedError(
          contentResult.plan.problem,
          contentResult.plan.subject,
        );
      }

      // 3. Tenant pins, locked in the global order (template version →
      //    coding-structure version → accounting configuration → accounts).
      const pinnedVersion = await lockCodingStructureVersionRow(
        tx,
        input.codingStructureVersionId,
      );
      const pinnedConfiguration = await lockAccountingConfigurationRow(
        tx,
        input.accountingConfigurationId,
      );
      const pinProblem = planRootAccountPin({
        organizationId: input.organizationId,
        snapshot: {
          accountingConfigurationId: input.accountingConfigurationId,
          versionId: input.codingStructureVersionId,
        },
        configuration: pinnedConfiguration,
        version: pinnedVersion,
      });
      if (pinProblem === 'configuration_missing') {
        throw new AccountingConfigurationNotActiveError('missing');
      }
      if (pinProblem === 'configuration_not_active') {
        throw new AccountingConfigurationNotActiveError(
          pinnedConfiguration!.status,
        );
      }
      if (pinProblem === 'coding_version_missing') {
        throw new CodingStructureVersionNotActiveError('missing');
      }
      if (pinProblem === 'coding_version_not_active') {
        throw new CodingStructureVersionNotActiveError(pinnedVersion!.status);
      }

      // ODR-1 (Task 19): the pinned pair must still describe ONE code shape.
      const [codingLevelRows, configurationLevelRows] = await Promise.all([
        tx.codingStructureLevel.findMany({
          where: { versionId: input.codingStructureVersionId },
          orderBy: [{ levelIndex: 'asc' }],
          skip: 0,
          take: MAX_ROWS,
        }),
        tx.accountingConfigurationLevel.findMany({
          where: { configurationId: input.accountingConfigurationId },
          orderBy: [{ levelIndex: 'asc' }],
          skip: 0,
          take: MAX_ROWS,
        }),
      ]);
      const codingLevels = codingLevelRows.map((row) => ({
        levelIndex: row.levelIndex,
        digitLength: row.digitLength,
      }));
      const configurationLevels = configurationLevelRows.map((row) => ({
        levelIndex: row.levelIndex,
        digitLength: row.digitLength,
      }));
      const coherenceProblem = planPinCoherence({
        codingLevels,
        configurationLevels,
      });
      if (coherenceProblem !== null) {
        throw new AccountPinsIncoherentError(coherenceProblem);
      }

      // 4. Compatibility + final adoption set, both against the LOCKED rows.
      const nodes = nodeRows.map(toDomainNode);
      const compatibility = planTemplateCompatibility({
        templateMaxDepth: lockedVersion.maxDepth,
        templateLevels: levelRows.map((row) => ({
          levelIndex: row.levelIndex,
          digitLength: row.digitLength,
        })),
        nodes,
        configurationLevels,
      });
      if (compatibility.problem !== null) {
        throw new BaseChartIncompatibleError(
          compatibility.problem,
          compatibility.subject,
        );
      }
      const selection = planAdoptionSelection({
        nodes,
        selectedNodeKeys: input.selectedNodeKeys,
      });
      if (selection.problem !== null) {
        throw new BaseChartSelectionRejectedError(
          selection.problem,
          selection.subject,
        );
      }

      // 5. Non-empty-chart refusal and the duplicate check (both under the
      //    same locks; the unique index remains the database backstop).
      const existingAccounts = await tx.account.count({
        where: { organizationId: input.organizationId },
      });
      if (existingAccounts > 0) {
        throw new OrganizationChartNotEmptyError();
      }
      const duplicate = await tx.baseChartAdoption.findFirst({
        where: {
          organizationId: input.organizationId,
          templateVersionId: input.templateVersionId,
        },
      });
      if (duplicate !== null) {
        throw new BaseChartAlreadyAdoptedError();
      }

      // 6. The COPY: ordinary accounts rows, parents first, ONE adoption row.
      //    `accountIdFor` is keyed by the stored template-node row id, which
      //    the dry-run and this under-lock re-read share by construction
      //    (published versions are immutable).
      const adoptedAccountIdByKey = new Map<string, string>();
      for (const planned of selection.nodes) {
        const accountId = input.accountIdFor.get(planned.templateNodeId);
        if (accountId === undefined) {
          throw new Error(
            `No account id was pre-assigned for adopted template node "${planned.nodeKey}".`,
          );
        }
        const parentId =
          planned.parentNodeKey === null
            ? null
            : (adoptedAccountIdByKey.get(planned.parentNodeKey) ?? null);
        if (planned.parentNodeKey !== null && parentId === null) {
          // The planner emits parents first, so a missing parent here is a
          // bug in the ordering, not an API outcome.
          throw new Error(
            `Adoption ordering bug: parent "${planned.parentNodeKey}" of node "${planned.nodeKey}" was not inserted first.`,
          );
        }
        const data: AccountCreate = {
          id: accountId,
          organizationId: input.organizationId,
          code: planned.code,
          title: planned.title,
          parentId,
          level: planned.level,
          codingStructureVersionId: input.codingStructureVersionId,
          accountingConfigurationId: input.accountingConfigurationId,
          accountNature: planned.accountNature,
          isPostable: planned.isPostable,
          isActive: planned.defaultIsActive,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actorId,
        };
        await tx.account.create({ data });
        adoptedAccountIdByKey.set(planned.nodeKey, accountId);
      }
      const created = await tx.baseChartAdoption.create({
        data: adoptionCreate(input, selection.nodes.length),
      });
      return created;
    });
  }

  // ---------------------------------------------------------------- helpers

  private async hydrateView(
    row: BaseChartAdoptionRow,
  ): Promise<BaseChartAdoptionView> {
    const { baseChartTemplateVersion, baseChartTemplate } = await this.client();
    const version = await baseChartTemplateVersion.findUnique({
      where: { id: row.templateVersionId },
    });
    if (version === null) {
      throw new Error(
        `Base chart adoption "${row.id}" references missing template version "${row.templateVersionId}".`,
      );
    }
    const template = await baseChartTemplate.findUnique({
      where: { id: version.templateId },
    });
    if (template === null) {
      throw new Error(
        `Base chart adoption "${row.id}" references missing template "${version.templateId}".`,
      );
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      templateVersionId: row.templateVersionId,
      templateId: version.templateId,
      templateCode: template.code,
      versionNumber: version.versionNumber,
      accountingConfigurationId: row.accountingConfigurationId,
      codingStructureVersionId: row.codingStructureVersionId,
      accountCount: row.accountCount,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
}

function toDomainNode(row: BaseChartTemplateNodeRow): BaseChartTemplateNode {
  if (!isAccountNature(row.accountNature)) {
    throw new Error(
      `Base chart template node "${row.id}" has an invalid account nature "${row.accountNature}".`,
    );
  }
  return {
    id: row.id,
    versionId: row.versionId,
    nodeKey: row.nodeKey,
    parentNodeKey: row.parentNodeKey,
    parentId: row.parentId,
    code: row.code,
    title: row.title,
    accountNature: row.accountNature,
    isPostable: row.isPostable,
    isMandatory: row.isMandatory,
    defaultIsActive: row.defaultIsActive,
    level: row.level,
  };
}

function adoptionCreate(
  input: {
    adoptionId: string;
    organizationId: string;
    templateVersionId: string;
    accountingConfigurationId: string;
    codingStructureVersionId: string;
    now: Date;
    actorId: string | null;
  },
  accountCount: number,
): BaseChartAdoptionCreate {
  return {
    id: input.adoptionId,
    organizationId: input.organizationId,
    templateVersionId: input.templateVersionId,
    accountingConfigurationId: input.accountingConfigurationId,
    codingStructureVersionId: input.codingStructureVersionId,
    accountCount,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actorId,
  };
}
