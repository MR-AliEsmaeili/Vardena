import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { BaseChartAdoptionsRepository } from '../data/base-chart-adoptions.repository.js';
import { BaseChartTemplatesRepository } from '../data/base-chart-templates.repository.js';
import {
  NoActiveAccountingConfigurationError,
  AccountingConfigurationNotActiveError,
  AccountPinsIncoherentError,
  CodingStructureVersionNotActiveError,
} from '../data/accounting-structure-errors.js';
import {
  BaseChartAlreadyAdoptedError,
  BaseChartContentRejectedError,
  BaseChartIncompatibleError,
  BaseChartSelectionRejectedError,
  BaseChartVersionStatusError,
  OrganizationChartNotEmptyError,
} from '../data/base-chart-errors.js';
import {
  pinCoherenceProblemMessage,
  planPinCoherence,
} from '../domain/account.js';
import {
  baseChartCompatibilityProblemMessage,
  baseChartSelectionProblemMessage,
  planAdoptionSelection,
  planTemplateCompatibility,
  type PlannedAdoptionNode,
} from '../domain/base-chart-adoption.js';
import {
  toBaseChartAdoptionDto,
  type BaseChartAdoptionDto,
  type BaseChartTemplateVersion,
} from '../domain/base-chart-template.js';
import { ACCOUNT_CREATED_EVENT } from '../domain/accounting.events.js';
import { publishEvent } from './accounting-support.js';
import { CodingStructuresService } from './coding-structures.service.js';
import { AccountingConfigurationsService } from './accounting-configurations.service.js';
import { mapBaseChartGuardError } from './base-chart-templates.service.js';

/**
 * Explicit Base Chart adoption (Task 23; Task 21 §4, task §18/§20).
 *
 * The adoption is a COPY: it materializes the published template version as
 * ORGANIZATION-owned `accounts` rows — ordinary chart rows, identical in
 * every respect to accounts the organization could have authored by hand
 * (Task 21 §10.1: "Template identity ≠ ledger identity / Adoption = Copy /
 * Posting = Leaf-only / Aggregation = Reporting read-time"). No template
 * reference survives on the copied rows; `LedgerEntry.accountId → Account.id`
 * is untouched.
 *
 * Sequence (all validation BEFORE any mutation — a failed adoption writes
 * nothing):
 *
 *   organization scope/pin → version is PUBLISHED → organization has ONE
 *   ACTIVE pinned pair (config + coding version, ODR-1 coherent) → template
 *   ↔ organization compatibility → final adoption set (selection ∪ ancestor
 *   closure ∪ ALL mandatory nodes, topological order) → chart EMPTY → not a
 *   repeated adoption → insert accounts (parents first) + ONE adoption
 *   record, all inside ONE guarded transaction with the exact lock order
 *   `template version → coding-structure version → accounting configuration →
 *   accounts` (see `accounting-locks.ts`).
 *
 * Idempotency (task §18): a repeated adoption of the same (organization,
 * published version) is a DETERMINISTIC conflict — 409 — never a duplicate
 * hierarchy and never a silent no-op. The unique index
 * `uq_base_chart_adoptions_scope` is the database backstop for the same
 * outcome under concurrency.
 *
 * Post-adoption: the created accounts are the organization's own — they may
 * later be edited/disabled exactly like manually created ones; there is NO
 * retroactive propagation of template changes (Task 21 §4.2) and NO
 * post-adoption mandatory guard (Task 21 §5, D-R-4).
 *
 * Events/audit: no BaseChart vocabulary exists in the contract's §21 event
 * catalog, and none is invented. Each created account emits the EXISTING
 * `Account.Created` event (identical payload to the manual create path — the
 * accounts are indistinguishable to event consumers), and the immutable
 * adoption row carries the AR-12 audit columns (actor included).
 */

export type AdoptBaseChartInput = {
  organizationId: string;
  templateVersionId: string;
  /**
   * Partial selection in template node keys; `null`/`undefined` = the whole
   * version. Normalized to `null` when empty (an empty list is a FULL
   * adoption too — refusing it would make "select nothing" a different verb).
   */
  selectedNodeKeys?: readonly string[] | null | undefined;
};

export type BaseChartAdoptionPreviewDto = {
  verdict: 'compatible' | 'incompatible';
  problem?: string | undefined;
  subject?: string | undefined;
  finalNodeCount: number;
  finalSet: PlannedAdoptionNode[];
};

@Injectable()
export class BaseChartAdoptionsService {
  constructor(
    private readonly adoptions: BaseChartAdoptionsRepository,
    private readonly templates: BaseChartTemplatesRepository,
    private readonly structures: CodingStructuresService,
    private readonly configurations: AccountingConfigurationsService,
    private readonly organizations: OrganizationsService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  // ------------------------------------------------------------------ reads

  async listAdoptions(
    organizationId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<BaseChartAdoptionDto>> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const { skip, take } = toOffset(page, pageSize);
    const { rows, total } = await this.adoptions.listByOrganization(
      organizationId,
      { skip, take },
    );
    return toPaginatedResult(
      rows.map(toBaseChartAdoptionDto),
      total,
      page,
      pageSize,
    );
  }

  async getAdoption(
    organizationId: string,
    adoptionId: string,
  ): Promise<BaseChartAdoptionDto> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const view = await this.adoptions.findById(organizationId, adoptionId);
    if (view === null) {
      throw AppException.notFound('Base chart adoption', adoptionId);
    }
    return toBaseChartAdoptionDto(view);
  }

  // ----------------------------------------------------------------- preview

  /**
   * Read-only dry-run (R8): the same domain checks `adopt` performs BEFORE
   * mutation, rendered as a transport verdict. Never writes anything; the
   * write path's REFUSALS are surfaced here as `incompatible` outcomes so an
   * orchestration CANNOT succeed later without these passing (concurrency
   * refusals — lock races, the unique backstop — belong to the write).
   */
  async preview(
    input: AdoptBaseChartInput,
  ): Promise<BaseChartAdoptionPreviewDto> {
    const fail = (
      problem: string,
      subject?: string,
    ): BaseChartAdoptionPreviewDto => ({
      verdict: 'incompatible',
      problem,
      subject,
      finalNodeCount: 0,
      finalSet: [],
    });

    await this.organizations.assertOrganizationInScope(input.organizationId);
    const resolved = await this.templates.findVersionById(
      input.templateVersionId,
    );
    if (resolved === null) {
      throw AppException.notFound(
        'Base chart template version',
        input.templateVersionId,
      );
    }
    const version = resolved.version;
    if (version.status !== 'published') {
      return fail('version_not_published');
    }

    const pins = await this.tryResolvePins(input.organizationId);
    if (pins.problem !== null || pins.version === undefined) {
      return fail(pins.problem ?? 'configuration_missing');
    }

    const compatibility = planTemplateCompatibility({
      templateMaxDepth: version.maxDepth,
      templateLevels: version.levels,
      nodes: version.nodes,
      configurationLevels: pins.version.configurationLevels,
    });
    if (compatibility.problem !== null) {
      return fail(compatibility.problem, compatibility.subject);
    }
    const selection = planAdoptionSelection({
      nodes: version.nodes,
      selectedNodeKeys: this.normalizeSelection(input.selectedNodeKeys),
    });
    if (selection.problem !== null) {
      return fail(selection.problem, selection.subject);
    }
    const existingAccounts = await this.adoptions.countAccounts(
      input.organizationId,
    );
    if (existingAccounts > 0) {
      return fail('organization_chart_not_empty');
    }
    const duplicate = await this.adoptions.findByOrganizationAndVersion(
      input.organizationId,
      input.templateVersionId,
    );
    if (duplicate !== null) {
      return fail('already_adopted');
    }
    return {
      verdict: 'compatible',
      finalNodeCount: selection.nodes.length,
      finalSet: selection.nodes,
    };
  }

  // ------------------------------------------------------------------- adopt

  async adopt(input: AdoptBaseChartInput): Promise<BaseChartAdoptionDto> {
    // ---- read-side, unlocked fast path (the authoritative twins of every
    // one of these checks run UNDER locks inside the guarded transaction;
    // failing fast here only avoids paying for a doomed transaction) ----
    await this.organizations.assertOrganizationInScope(input.organizationId);
    const resolved = await this.templates.findVersionById(
      input.templateVersionId,
    );
    if (resolved === null) {
      throw AppException.notFound(
        'Base chart template version',
        input.templateVersionId,
      );
    }
    const version = resolved.version;
    if (version.status !== 'published') {
      throw AppException.businessRule(
        `Only a published base chart version can be adopted (this version is "${version.status}").`,
      );
    }

    const pins = await this.tryResolvePins(input.organizationId);
    if (
      pins.problem === 'configuration_missing' ||
      pins.version === undefined
    ) {
      throw AppException.businessRule(
        'This organization has no active accounting configuration and coding structure. Publish both before adopting a base chart.',
      );
    }
    if (pins.problem === 'pins_incoherent') {
      throw AppException.businessRule(
        pinCoherenceProblemMessage(
          planPinCoherence({
            codingLevels: pins.version.codingLevels,
            configurationLevels: pins.version.configurationLevels,
          })!,
        ),
      );
    }

    const compatibility = planTemplateCompatibility({
      templateMaxDepth: version.maxDepth,
      templateLevels: version.levels,
      nodes: version.nodes,
      configurationLevels: pins.version.configurationLevels,
    });
    if (compatibility.problem !== null) {
      throw AppException.businessRule(
        baseChartCompatibilityProblemMessage(compatibility.problem),
        { problem: compatibility.problem, subject: compatibility.subject },
      );
    }
    const selection = planAdoptionSelection({
      nodes: version.nodes,
      selectedNodeKeys: this.normalizeSelection(input.selectedNodeKeys),
    });
    if (selection.problem !== null) {
      throw AppException.businessRule(
        baseChartSelectionProblemMessage(selection.problem),
        { problem: selection.problem, subject: selection.subject },
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    // Pre-assign account ids so the guarded write (which re-derives the
    // identical deterministic plan under locks) can bind parents to children.
    const accountIdFor = new Map(
      selection.nodes.map((node) => [node.templateNodeId, generateId()]),
    );

    let created;
    try {
      created = await this.adoptions.adoptChecked({
        adoptionId: generateId(),
        organizationId: input.organizationId,
        templateVersionId: input.templateVersionId,
        selectedNodeKeys: this.normalizeSelection(input.selectedNodeKeys),
        accountingConfigurationId: pins.version.accountingConfigurationId,
        codingStructureVersionId: pins.version.codingStructureVersionId,
        accountIdFor,
        now,
        actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Database backstrokes: either the adoption unique scope (a concurrent
        // twin of THIS adoption) or an account-code collision — both are
        // deterministic conflicts, never silent partial adoptions.
        throw AppException.conflict(
          'The adoption conflicts with the current chart state of this organization (a concurrent adoption may have applied first). Retry the request.',
        );
      }
      const mapped = mapAdoptionGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
    if (created === null) {
      throw AppException.notFound(
        'Base chart template version',
        input.templateVersionId,
      );
    }

    // Post-commit side effects: one Account.Created event per copied account
    // with the IDENTICAL payload the manual create path publishes — event
    // consumers cannot (and must not) distinguish adopted accounts.
    for (const node of selection.nodes) {
      await publishEvent(this.events, {
        type: ACCOUNT_CREATED_EVENT,
        aggregateType: 'Account',
        aggregateId: accountIdFor.get(node.templateNodeId)!,
        payload: {
          id: accountIdFor.get(node.templateNodeId)!,
          organizationId: input.organizationId,
          code: node.code,
          level: node.level,
          codingStructureVersionId: pins.version.codingStructureVersionId,
          accountingConfigurationId: pins.version.accountingConfigurationId,
        },
      });
    }
    this.logger.log(
      'Base chart version adopted',
      {
        adoptionId: created.id,
        organizationId: input.organizationId,
        templateVersionId: input.templateVersionId,
        accountCount: created.accountCount,
      },
      BaseChartAdoptionsService.name,
    );
    const view = await this.adoptions.findById(
      input.organizationId,
      created.id,
    );
    if (view === null) {
      // The row is committed but the same-session read missed it: log loudly,
      // the caller can re-read; NOT retried here (never turn a committed
      // adoption into a second one by accident).
      this.logger.error(
        'Committed adoption could not be re-read',
        { adoptionId: created.id },
        BaseChartAdoptionsService.name,
      );
      throw AppException.serviceUnavailable(
        'The adoption was committed but could not be read back. Query it by organization.',
      );
    }
    return toBaseChartAdoptionDto(view);
  }

  // ---------------------------------------------------------------- helpers

  private normalizeSelection(
    selection: readonly string[] | null | undefined,
  ): readonly string[] | null {
    if (selection === undefined || selection === null) return null;
    if (selection.length === 0) return null;
    return selection;
  }

  /**
   * Resolve the organization's ONE ACTIVE pinned pair (accounting
   * configuration + coding-structure version) the adoption will bind the
   * copied account pins to, reusing the configuration/structure services'
   * own ACTIVE lookups — the exact resolution the manual chart-write path
   * performs, so an adoption can never bind to a shape the chart could not.
   */
  private async tryResolvePins(organizationId: string): Promise<{
    problem: 'configuration_missing' | 'pins_incoherent' | null;
    version?: {
      accountingConfigurationId: string;
      codingStructureVersionId: string;
      configurationLevels: { levelIndex: number; digitLength: number }[];
      codingLevels: { levelIndex: number; digitLength: number }[];
    };
  }> {
    let activeConfiguration;
    let activeVersion;
    try {
      activeConfiguration =
        await this.configurations.requireActiveConfigurationOrThrow(
          organizationId,
        );
      activeVersion =
        await this.structures.requireActiveVersionOrThrow(organizationId);
    } catch (error) {
      if (
        error instanceof NoActiveAccountingConfigurationError ||
        (error instanceof AppException &&
          error.code === 'BusinessRuleViolation')
      ) {
        return { problem: 'configuration_missing' };
      }
      throw error;
    }
    const configurationLevels = (
      activeConfiguration.levels as {
        levelIndex: number;
        digitLength: number;
      }[]
    ).map((level) => ({
      levelIndex: level.levelIndex,
      digitLength: level.digitLength,
    }));
    const codingLevels = activeVersion.levels.map((level) => ({
      levelIndex: level.levelIndex,
      digitLength: level.digitLength,
    }));
    // ODR-1 (Task 19): the Explicit Coherence Rule — the ACTIVE pair must
    // describe ONE code shape; an adoption never picks a silent winner.
    if (planPinCoherence({ codingLevels, configurationLevels }) !== null) {
      return {
        problem: 'pins_incoherent',
        version: {
          accountingConfigurationId: activeConfiguration.id,
          codingStructureVersionId: activeVersion.id,
          configurationLevels,
          codingLevels,
        },
      };
    }
    return {
      problem: null,
      version: {
        accountingConfigurationId: activeConfiguration.id,
        codingStructureVersionId: activeVersion.id,
        configurationLevels,
        codingLevels,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Guard mapping (composes the templates-side mapping and extends it with the
// adoption-specific refusals).
// ---------------------------------------------------------------------------

export function mapAdoptionGuardError(error: unknown): AppException | null {
  const shared = mapBaseChartGuardError(error);
  if (shared !== null) return shared;

  if (error instanceof BaseChartIncompatibleError) {
    return AppException.businessRule(
      baseChartCompatibilityProblemMessage(error.problem),
      { problem: error.problem, subject: error.subject },
    );
  }
  if (error instanceof BaseChartSelectionRejectedError) {
    return AppException.businessRule(
      baseChartSelectionProblemMessage(error.problem),
      { problem: error.problem, subject: error.subject },
    );
  }
  if (error instanceof BaseChartAlreadyAdoptedError) {
    // Idempotency semantics (task §18): repeated adoption is a deterministic
    // conflict, never a duplicate hierarchy, never a silent no-op.
    return AppException.conflict(
      'This organization has already adopted this base chart version. Repeated adoption never creates a duplicate chart.',
    );
  }
  if (error instanceof OrganizationChartNotEmptyError) {
    return AppException.conflict(
      'This organization already has accounts. Base chart adoption is refused into a non-empty chart (no merge/overwrite semantics).',
    );
  }
  if (error instanceof CodingStructureVersionNotActiveError) {
    return AppException.conflict(
      'The organization’s active coding structure changed while this request was running. Retry it.',
    );
  }
  if (error instanceof AccountingConfigurationNotActiveError) {
    return AppException.businessRule(
      'The active accounting configuration is not ACTIVE. Publish it before adopting a base chart.',
    );
  }
  if (error instanceof AccountPinsIncoherentError) {
    // ODR-1 (Task 19): an incoherent ACTIVE pair refuses the adoption — no
    // pin is silently picked as the code-shape winner.
    return AppException.businessRule(
      pinCoherenceProblemMessage(error.problem),
      { rule: error.problem },
    );
  }
  if (error instanceof BaseChartContentRejectedError) {
    return AppException.businessRule(
      'The published version’s stored content failed integrity re-validation; adoption of a corrupted template version is refused.',
      { problem: error.problem, subject: error.subject },
    );
  }
  if (error instanceof BaseChartVersionStatusError) {
    return AppException.businessRule(
      `The base chart template version is "${error.status}". Only a published version may be adopted.`,
    );
  }
  return null;
}

// ---- message helpers wired to the preview verdict vocabulary ----

export const BASE_CHART_PREVIEW_PROBLEMS = [
  'version_not_published',
  'configuration_missing',
  'pins_incoherent',
  'template_depth_exceeded',
  'digit_length_mismatch',
  'code_incompatible',
  'unknown_node_key',
  'ancestor_missing',
  'organization_chart_not_empty',
  'already_adopted',
] as const;

export type BaseChartPreviewProblem =
  (typeof BASE_CHART_PREVIEW_PROBLEMS)[number];

export type { BaseChartTemplateVersion };
