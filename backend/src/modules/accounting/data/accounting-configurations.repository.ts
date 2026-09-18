import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type {
  AccountingConfiguration,
  AccountingConfigurationLevel,
} from '../domain/accounting-configuration.js';
import {
  isAccountingConfigurationStatus,
  orderedConfigurationLevels,
  planAccountingConfiguration,
} from '../domain/accounting-configuration.js';
import {
  AccountingConfigurationNotDraftError,
  AccountingConfigurationPlanRejectedError,
} from './accounting-structure-errors.js';
import {
  lockAccountingConfigurationRow,
  lockAccountingConfigurationsOfOrganization,
} from './accounting-locks.js';
import type {
  AccountingConfigurationCreate,
  AccountingConfigurationDelegate,
  AccountingConfigurationLevelCreate,
  AccountingConfigurationLevelDelegate,
  AccountingConfigurationLevelRow,
  AccountingConfigurationRow,
  AccountingTransactionalClient,
  OrderBy,
} from './accounting-rows.js';

type Client = {
  accountingConfiguration: AccountingConfigurationDelegate;
  accountingConfigurationLevel: AccountingConfigurationLevelDelegate;
};

const MAX_LEVEL_ROWS = 8;

export interface AccountingConfigurationListFilter {
  organizationId: string;
  code?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
}

export interface ConfigurationLevelWrite {
  id: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
}

export type AccountingConfigurationWithLevels = AccountingConfiguration & {
  levels: readonly AccountingConfigurationLevel[];
};

@Injectable()
export class AccountingConfigurationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  async findById(
    id: string,
  ): Promise<AccountingConfigurationWithLevels | null> {
    const { accountingConfiguration } = await this.client();
    const row = await accountingConfiguration.findUnique({ where: { id } });
    if (row === null) return null;
    return toDomain(row, await this.listLevelRows(id));
  }

  async findActiveForOrganization(
    organizationId: string,
  ): Promise<AccountingConfigurationWithLevels | null> {
    const { accountingConfiguration } = await this.client();
    const row = await accountingConfiguration.findFirst({
      where: { organizationId, status: 'ACTIVE' },
    });
    if (row === null) return null;
    return toDomain(row, await this.listLevelRows(row.id));
  }

  async findLatestForCode(
    organizationId: string,
    code: string,
  ): Promise<{ versionNumber: number } | null> {
    const { accountingConfiguration } = await this.client();
    const rows = await accountingConfiguration.findMany({
      where: { organizationId, code },
      orderBy: [{ versionNumber: 'desc' }],
      skip: 0,
      take: 1,
    });
    const [row] = rows;
    return row === undefined ? null : { versionNumber: row.versionNumber };
  }

  async list(params: {
    where: AccountingConfigurationListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: AccountingConfigurationWithLevels[]; total: number }> {
    const { accountingConfiguration, accountingConfigurationLevel } =
      await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      accountingConfiguration.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      accountingConfiguration.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    const levelRows =
      ids.length === 0
        ? []
        : await accountingConfigurationLevel.findMany({
            where: { configurationId: { in: ids } },
            orderBy: [{ levelIndex: 'asc' }],
            skip: 0,
            take: ids.length * MAX_LEVEL_ROWS,
          });
    return {
      items: rows.map((row) =>
        toDomain(
          row,
          levelRows.filter((l) => l.configurationId === row.id),
        ),
      ),
      total,
    };
  }

  async createDraftWithLevels(input: {
    id: string;
    organizationId: string;
    code: string;
    name: string;
    versionNumber: number;
    effectiveFrom: Date | null;
    levels: readonly ConfigurationLevelWrite[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<AccountingConfigurationWithLevels> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const data: AccountingConfigurationCreate = {
        id: input.id,
        organizationId: input.organizationId,
        code: input.code,
        name: input.name,
        versionNumber: input.versionNumber,
        status: 'DRAFT',
        effectiveFrom: input.effectiveFrom,
        operationallyUsedAt: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        createdBy: input.actorId,
      };
      const created = await tx.accountingConfiguration.create({ data });
      for (const level of input.levels) {
        await tx.accountingConfigurationLevel.create({
          data: levelCreate(
            input.organizationId,
            created.id,
            level,
            input.createdAt,
            input.actorId,
          ),
        });
      }
      const levels = await tx.accountingConfigurationLevel.findMany({
        where: { configurationId: created.id },
        orderBy: [{ levelIndex: 'asc' }],
        skip: 0,
        take: MAX_LEVEL_ROWS,
      });
      return toDomain(created, levels);
    });
  }

  async updateDraftChecked(input: {
    id: string;
    name?: string | undefined;
    effectiveFrom?: Date | null | undefined;
    levels?: readonly ConfigurationLevelWrite[] | undefined;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<AccountingConfigurationWithLevels> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockAccountingConfigurationRow(tx, input.id);
      if (locked === null) {
        throw new Error(
          `Accounting configuration "${input.id}" no longer exists.`,
        );
      }
      if (locked.status !== 'DRAFT') {
        throw new AccountingConfigurationNotDraftError(locked.status);
      }
      if (locked.operationallyUsedAt !== null) {
        throw new AccountingConfigurationNotDraftError('operationally_used');
      }

      const candidateName = input.name ?? locked.name;
      const candidateEffectiveFrom =
        input.effectiveFrom !== undefined
          ? input.effectiveFrom
          : locked.effectiveFrom;

      const storedLevels =
        input.levels === undefined
          ? await tx.accountingConfigurationLevel.findMany({
              where: { configurationId: input.id },
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

      if (candidateLevels.length > 0) {
        const plan = planAccountingConfiguration({
          code: locked.code,
          name: candidateName,
          effectiveFrom: candidateEffectiveFrom,
          maxDepth: candidateLevels.length,
          levels: candidateLevels,
        });
        if (plan.problem !== null) {
          throw new AccountingConfigurationPlanRejectedError(
            plan.problem,
            plan.subject,
          );
        }
      }

      await tx.accountingConfiguration.update({
        where: { id: input.id },
        data: {
          name: candidateName,
          effectiveFrom: candidateEffectiveFrom,
          updatedAt: input.updatedAt,
          updatedBy: input.actorId,
        },
      });

      if (input.levels !== undefined) {
        await tx.accountingConfigurationLevel.deleteMany({
          where: { configurationId: input.id },
        });
        for (const level of input.levels) {
          await tx.accountingConfigurationLevel.create({
            data: levelCreate(
              locked.organizationId,
              input.id,
              level,
              input.updatedAt,
              input.actorId,
            ),
          });
        }
      }

      const row = await tx.accountingConfiguration.findFirst({
        where: { id: input.id },
      });
      if (row === null) {
        throw new Error(
          `Accounting configuration "${input.id}" no longer exists.`,
        );
      }
      const levels = await tx.accountingConfigurationLevel.findMany({
        where: { configurationId: input.id },
        orderBy: [{ levelIndex: 'asc' }],
        skip: 0,
        take: MAX_LEVEL_ROWS,
      });
      return toDomain(row, levels);
    });
  }

  async publishChecked(input: {
    configurationId: string;
    organizationId: string;
    now: Date;
    actorId: string | null;
  }): Promise<{
    configuration: AccountingConfigurationWithLevels;
    supersededId: string | null;
  } | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const lockedIds = await lockAccountingConfigurationsOfOrganization(
        tx,
        input.organizationId,
      );
      if (!lockedIds.includes(input.configurationId)) return null;

      const locked = await lockAccountingConfigurationRow(
        tx,
        input.configurationId,
      );
      if (locked === null) return null;
      if (locked.status !== 'DRAFT') {
        throw new AccountingConfigurationNotDraftError(locked.status);
      }
      if (locked.operationallyUsedAt !== null) {
        throw new AccountingConfigurationNotDraftError('operationally_used');
      }

      const levels = await tx.accountingConfigurationLevel.findMany({
        where: { configurationId: input.configurationId },
        orderBy: [{ levelIndex: 'asc' }],
        skip: 0,
        take: MAX_LEVEL_ROWS,
      });

      const plan = planAccountingConfiguration({
        code: locked.code,
        name: locked.name,
        effectiveFrom: locked.effectiveFrom,
        maxDepth: levels.length,
        levels: levels.map((l) => ({
          levelIndex: l.levelIndex,
          title: l.title,
          digitLength: l.digitLength,
          defaultIsPostable: l.defaultIsPostable,
          levelKind: l.levelKind,
        })),
      });
      if (plan.problem !== null) {
        throw new AccountingConfigurationPlanRejectedError(
          plan.problem,
          plan.subject,
        );
      }

      const previous = await tx.accountingConfiguration.findMany({
        where: { organizationId: input.organizationId, status: 'ACTIVE' },
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 10000,
      });

      let supersededId: string | null = null;
      for (const row of previous) {
        if (row.id === input.configurationId) continue;
        supersededId = row.id;
        await tx.accountingConfiguration.update({
          where: { id: row.id },
          data: {
            status: 'SUPERSEDED',
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        });
      }

      const activated = await tx.accountingConfiguration.update({
        where: { id: input.configurationId },
        data: {
          status: 'ACTIVE',
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });

      return {
        configuration: toDomain(activated, levels),
        supersededId,
      };
    });
  }

  async markOperationallyUsed(input: {
    id: string;
    now: Date;
  }): Promise<AccountingConfigurationWithLevels | null> {
    const { accountingConfiguration } = await this.client();
    const existing = await accountingConfiguration.findUnique({
      where: { id: input.id },
    });
    if (existing === null) return null;
    if (existing.operationallyUsedAt !== null) {
      return toDomain(existing, await this.listLevelRows(input.id));
    }
    const updated = await accountingConfiguration.update({
      where: { id: input.id },
      data: {
        operationallyUsedAt: input.now,
        updatedAt: input.now,
        updatedBy: null,
      },
    });
    return toDomain(updated, await this.listLevelRows(input.id));
  }

  async deleteDraft(input: { id: string }): Promise<boolean> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockAccountingConfigurationRow(tx, input.id);
      if (locked === null) return false;
      if (locked.status !== 'DRAFT') {
        throw new AccountingConfigurationNotDraftError(locked.status);
      }
      if (locked.operationallyUsedAt !== null) {
        throw new AccountingConfigurationNotDraftError('operationally_used');
      }
      await tx.accountingConfigurationLevel.deleteMany({
        where: { configurationId: input.id },
      });
      await tx.$queryRaw`DELETE FROM "accounting"."accounting_configurations" WHERE "id" = ${input.id}`;
      return true;
    });
  }

  private async listLevelRows(
    configurationId: string,
  ): Promise<AccountingConfigurationLevelRow[]> {
    const { accountingConfigurationLevel } = await this.client();
    return accountingConfigurationLevel.findMany({
      where: { configurationId },
      orderBy: [{ levelIndex: 'asc' }],
      skip: 0,
      take: MAX_LEVEL_ROWS,
    });
  }
}

function toWhere(
  filter: AccountingConfigurationListFilter,
): import('./accounting-rows.js').AccountingConfigurationWhere {
  const where: import('./accounting-rows.js').AccountingConfigurationWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.code !== undefined) where.code = filter.code;
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function levelCreate(
  organizationId: string,
  configurationId: string,
  level: ConfigurationLevelWrite,
  createdAt: Date,
  actorId: string | null,
): import('./accounting-rows.js').AccountingConfigurationLevelCreate {
  return {
    id: level.id,
    organizationId,
    configurationId,
    levelIndex: level.levelIndex,
    title: level.title,
    digitLength: level.digitLength,
    defaultIsPostable: level.defaultIsPostable,
    levelKind: level.levelKind,
    createdAt,
    updatedAt: createdAt,
    createdBy: actorId,
  };
}

function toDomain(
  row: AccountingConfigurationRow,
  levelRows: readonly AccountingConfigurationLevelRow[],
): AccountingConfigurationWithLevels {
  const levels: AccountingConfigurationLevel[] = orderedConfigurationLevels(
    levelRows,
  ).map((l) => ({
    id: l.id,
    configurationId: l.configurationId,
    levelIndex: l.levelIndex,
    title: l.title,
    digitLength: l.digitLength,
    defaultIsPostable: l.defaultIsPostable,
    levelKind: l.levelKind,
  }));
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    versionNumber: row.versionNumber,
    status: isAccountingConfigurationStatus(row.status)
      ? row.status
      : 'SUPERSEDED',
    effectiveFrom: row.effectiveFrom,
    operationallyUsedAt: row.operationallyUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    levels,
  };
}
