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
  AccountingConfigurationsRepository,
  type AccountingConfigurationListFilter,
  type ConfigurationLevelWrite,
} from '../data/accounting-configurations.repository.js';
import {
  AccountingConfigurationNotDraftError,
  AccountingConfigurationPlanRejectedError,
  NoActiveAccountingConfigurationError,
} from '../data/accounting-structure-errors.js';
import type {
  AccountingConfigurationLevelInput,
  AccountingConfigurationProblem,
  AccountingConfigurationDto,
} from '../domain/accounting-configuration.js';
import {
  accountingConfigurationProblemMessage,
  isAccountingConfigurationStatus,
  planAccountingConfiguration,
  toAccountingConfigurationDto,
} from '../domain/accounting-configuration.js';
import { ACCOUNTING_CONFIGURATION_PERMISSIONS } from '../domain/accounting-permissions.js';
import { normalizeCode, normalizeTitle } from '../domain/master-data.js';
import { resolveSort } from './accounting-support.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  versionNumber: 'versionNumber',
  status: 'status',
  effectiveFrom: 'effectiveFrom',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListAccountingConfigurationsQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  code?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface ConfigurationLevelInput {
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind?: string | null | undefined;
}

export interface CreateAccountingConfigurationInput {
  organizationId: string;
  code: string;
  name: string;
  effectiveFrom?: Date | null | undefined;
  levels: readonly ConfigurationLevelInput[];
}

export interface UpdateAccountingConfigurationInput {
  name?: string | undefined;
  effectiveFrom?: Date | null | undefined;
  levels?: readonly ConfigurationLevelInput[] | undefined;
}

@Injectable()
export class AccountingConfigurationsService {
  constructor(
    private readonly repository: AccountingConfigurationsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listConfigurations(
    query: ListAccountingConfigurationsQuery,
  ): Promise<PaginatedResult<AccountingConfigurationDto>> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_CONFIGURATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    if (
      query.status !== undefined &&
      !isAccountingConfigurationStatus(query.status)
    ) {
      throw AppException.badRequest(
        'status must be one of: DRAFT, ACTIVE, SUPERSEDED.',
      );
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const where: AccountingConfigurationListFilter = {
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
      items.map((c) => toAccountingConfigurationDto(c as any)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getConfiguration(
    organizationId: string,
    id: string,
  ): Promise<AccountingConfigurationDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_CONFIGURATION_PERMISSIONS.VIEW,
    ]);
    return toAccountingConfigurationDto(
      (await this.mustFindInOrganization(organizationId, id)) as any,
    );
  }

  async getActiveConfiguration(
    organizationId: string,
  ): Promise<AccountingConfigurationDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_CONFIGURATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const active =
      await this.repository.findActiveForOrganization(organizationId);
    if (active === null) {
      throw AppException.notFound('AccountingConfiguration');
    }
    return toAccountingConfigurationDto(active as any);
  }

  async createConfiguration(
    input: CreateAccountingConfigurationInput,
  ): Promise<AccountingConfigurationDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE,
    ]);
    const code = normalizeCode(input.code);
    const name = normalizeTitle(input.name);
    const effectiveFrom = input.effectiveFrom ?? null;
    const levels = normalizeLevels(input.levels);
    this.assertPlan(code, name, effectiveFrom, levels);

    await this.organizations.requireUsableOrganization(input.organizationId);

    const actorId = getPrincipal()?.userId ?? null;
    const now = new Date();

    let created: any = null;
    for (let attempt = 0; attempt < 3 && created === null; attempt += 1) {
      const latest = await this.repository.findLatestForCode(
        input.organizationId,
        code,
      );
      try {
        const accountingConfigId = generateId();
        created = await this.repository.createDraftWithLevels({
          id: accountingConfigId,
          organizationId: input.organizationId,
          code,
          name,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          effectiveFrom,
          levels: withIds(levels),
          createdAt: now,
          actorId,
        });
      } catch (error) {
        const mapped = mapConfigurationGuardError(error);
        if (mapped !== null) throw mapped;
        if (!isUniqueViolation(error)) throw error;
        if (attempt === 2) {
          throw AppException.conflict(
            'An accounting configuration version was created concurrently. Retry the request.',
          );
        }
      }
    }

    this.logger.log(
      'Accounting configuration drafted',
      {
        configurationId: created.id,
        organizationId: created.organizationId,
        code: created.code,
        versionNumber: created.versionNumber,
      },
      AccountingConfigurationsService.name,
    );
    return toAccountingConfigurationDto(created);
  }

  async updateConfiguration(
    organizationId: string,
    id: string,
    input: UpdateAccountingConfigurationInput,
  ): Promise<AccountingConfigurationDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.status !== 'DRAFT') {
      throw AppException.businessRule(
        `Accounting configuration version ${current.versionNumber} is "${current.status}" and cannot be changed. Create a new version instead.`,
      );
    }
    if (current.operationallyUsedAt !== null) {
      throw AppException.businessRule(
        'The accounting configuration has already been used operationally and cannot be changed. Create a new version instead.',
      );
    }

    const levels =
      input.levels === undefined ? undefined : normalizeLevels(input.levels);

    const candidateName = input.name
      ? normalizeTitle(input.name)
      : current.name;
    const candidateEffectiveFrom =
      input.effectiveFrom !== undefined
        ? input.effectiveFrom
        : current.effectiveFrom;

    this.assertPlan(
      current.code,
      candidateName,
      candidateEffectiveFrom ?? null,
      (levels ?? (current as any).levels) as any,
    );

    const updated = await this.runGuarded(() =>
      this.repository.updateDraftChecked({
        id,
        name: input.name ? candidateName : undefined,
        effectiveFrom: input.effectiveFrom,
        levels: levels === undefined ? undefined : withIds(levels),
        updatedAt: new Date(),
        actorId: getPrincipal()?.userId ?? null,
      }),
    );
    return toAccountingConfigurationDto(updated as any);
  }

  async publishConfiguration(
    organizationId: string,
    id: string,
  ): Promise<AccountingConfigurationDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.status !== 'DRAFT') {
      throw AppException.businessRule(
        `Only a DRAFT accounting configuration can be published (this one is "${current.status}").`,
      );
    }
    this.assertPlan(
      current.code,
      current.name,
      current.effectiveFrom,
      (current as any).levels as any,
    );

    const published = await this.runGuarded(async () => {
      const result = await this.repository.publishChecked({
        configurationId: id,
        organizationId: current.organizationId,
        now: new Date(),
        actorId: getPrincipal()?.userId ?? null,
      });
      if (result === null) {
        throw AppException.notFound('AccountingConfiguration', id);
      }
      return result;
    });

    this.logger.log(
      'Accounting configuration published',
      {
        configurationId: published.configuration.id,
        organizationId: published.configuration.organizationId,
        code: published.configuration.code,
        versionNumber: published.configuration.versionNumber,
        supersededId: published.supersededId,
      },
      AccountingConfigurationsService.name,
    );
    return toAccountingConfigurationDto(published.configuration as any);
  }

  async deleteConfiguration(organizationId: string, id: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.status !== 'DRAFT') {
      throw AppException.businessRule(
        'Only DRAFT configurations can be deleted.',
      );
    }
    if (current.operationallyUsedAt !== null) {
      throw AppException.businessRule(
        'The accounting configuration has already been used operationally and cannot be deleted.',
      );
    }
    const deleted = await this.runGuarded(() =>
      this.repository.deleteDraft({ id }),
    );
    if (!deleted) {
      throw AppException.notFound('AccountingConfiguration', id);
    }
  }

  // Cross-service resolver for AccountsService — will use ACTIVE config to derive code shape.
  // Throws typed error NoActiveAccountingConfigurationError per R8 (no string matching)
  async requireActiveConfigurationOrThrow(
    organizationId: string,
  ): Promise<any> {
    const active =
      await this.repository.findActiveForOrganization(organizationId);
    if (active === null) {
      throw new NoActiveAccountingConfigurationError();
    }
    return active;
  }

  async requireConfigurationInOrganization(
    organizationId: string,
    id: string,
  ): Promise<any> {
    return this.mustFindInOrganization(organizationId, id);
  }

  /**
   * Operational-freeze marker (Task 11 D4 seam, connected by Task 13).
   *
   * STILL has no caller — by design. Task 13 connected the MARKER, not this
   * method: the production marking happens inside the finalization transaction
   * (`data/accounting-documents.repository.ts` → `accounting-configuration-usage.ts`)
   * and there is no endpoint, no permission and no service call that marks
   * usage on request, because usage is a fact about a committed business effect
   * and never a client-supplied state. This seam stays for the future
   * configuration types Task 11 named (dimensions, posting rules, …) and for
   * controlled repair of a data anomaly; it now writes through the same guarded
   * statement as the production path, and it is organization-scoped so it
   * cannot touch another tenant's configuration.
   *
   * Deliberately NOT called by `AccountsService.createAccount`: creating or
   * activating an account is not operational use (D4 — "first Voucher, not
   * Account"), which the live regression in
   * `test/accounting-configuration-live.e2e-spec.ts` keeps pinned.
   * See `docs/accounting/task-11-mark-operationally-used-decision-note.md` and
   * `docs/task-13-implementation-report.md`.
   */
  async markOperationallyUsed(
    organizationId: string,
    id: string,
    actorId: string | null = null,
  ): Promise<void> {
    await this.repository.markOperationallyUsed({
      id,
      organizationId,
      now: new Date(),
      actorId,
    });
  }

  // Internals

  private assertPlan(
    code: string,
    name: string,
    effectiveFrom: Date | null,
    levels: readonly AccountingConfigurationLevelInput[],
  ): void {
    const plan = planAccountingConfiguration({
      code,
      name,
      effectiveFrom,
      maxDepth: levels.length,
      levels,
    });
    if (plan.problem !== null) {
      throw AppException.badRequest(
        configurationProblemText(plan.problem, plan.subject),
      );
    }
  }

  private async runGuarded<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const mapped = mapConfigurationGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<any> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const config = await this.repository.findById(id);
    if (config === null || config.organizationId !== organizationId) {
      throw AppException.notFound('AccountingConfiguration', id);
    }
    return config;
  }
}

function normalizeLevels(
  levels: readonly ConfigurationLevelInput[],
): AccountingConfigurationLevelInput[] {
  return levels.map((level) => ({
    levelIndex: level.levelIndex,
    title: normalizeTitle(level.title),
    digitLength: level.digitLength,
    defaultIsPostable: level.defaultIsPostable,
    levelKind: level.levelKind ?? null,
  }));
}

function withIds(
  levels: readonly AccountingConfigurationLevelInput[],
): ConfigurationLevelWrite[] {
  return levels.map((level) => ({
    ...level,
    id: generateId(),
    levelKind: level.levelKind ?? null,
  }));
}

function configurationProblemText(
  problem: AccountingConfigurationProblem,
  subject: string | undefined,
): string {
  const base = accountingConfigurationProblemMessage(problem);
  return subject === undefined ? base : `${base} (level ${subject})`;
}

export function mapConfigurationGuardError(
  error: unknown,
): AppException | null {
  if (error instanceof AccountingConfigurationPlanRejectedError) {
    return AppException.badRequest(
      configurationProblemText(error.problem, error.subject),
    );
  }
  if (error instanceof AccountingConfigurationNotDraftError) {
    if (error.status === 'operationally_used') {
      return AppException.businessRule(
        'The accounting configuration has already been used operationally and cannot be changed or deleted.',
      );
    }
    return AppException.businessRule(
      'The accounting configuration is no longer a DRAFT and cannot be changed. Create a new version instead.',
    );
  }
  if (error instanceof NoActiveAccountingConfigurationError) {
    return AppException.businessRule(
      'This organization has no active accounting configuration. Configure one and publish it before creating accounts.',
    );
  }
  return null;
}
