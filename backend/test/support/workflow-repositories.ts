/**
 * In-memory stand-ins for the Workflow Foundation repositories (test support).
 *
 * Same purpose as `document-repositories.ts`: the e2e suite runs the FULL
 * HTTP stack — controllers, guards, real application services, the real
 * permission registry and its startup sync — with no Postgres, no Docker
 * and no Prisma codegen.
 *
 * What is faked and what is not:
 * - faked: the eight `workflow` repositories and `PrismaService`;
 * - NOT faked: version lifecycle + publish validation, transition shape and
 *   execution planning, approval staleness, automation envelopes,
 *   authorization checks, DTO validation, organization scoping.
 *
 * The fakes honour the contracts the real repositories guarantee:
 * - unique violations the services map to 409 (`P2002`) — duplicate
 *   (organization, code) definitions, (definition, number) versions,
 *   (version, code) states/transitions, double-bound entities and
 *   duplicate (transition, action) bindings;
 * - draft re-checks that throw `WorkflowVersionLockedError` when a
 *   configuration write meets a non-draft version;
 * - the execution/request/decide transactions mirror the real decision
 *   logic (the REAL domain `planTransitionExecution` and the REAL
 *   problem-coded errors), serialized through a promise-chain mutex that
 *   mirrors the observable effect of the row locks: two concurrent
 *   transitions for one instance serialize, the loser re-reads the
 *   winner's state and fails with `not_in_source_state` (409).
 *
 * Real `SELECT … FOR UPDATE` locking is exercised by the live suite
 * (`workflow-live.e2e-spec.ts`); this file mirrors its observable effect,
 * not its mechanism.
 */

import type { WorkflowDefinition } from '../../src/modules/workflow/domain/workflow-definition.js';
import type { WorkflowVersion } from '../../src/modules/workflow/domain/workflow-version.js';
import type { WorkflowState } from '../../src/modules/workflow/domain/workflow-state.js';
import type { WorkflowTransition } from '../../src/modules/workflow/domain/workflow-transition.js';
import { planTransitionExecution } from '../../src/modules/workflow/domain/workflow-transition.js';
import type { WorkflowInstance } from '../../src/modules/workflow/domain/workflow-instance.js';
import type { WorkflowTransitionHistory } from '../../src/modules/workflow/domain/workflow-history.js';
import type { WorkflowApproval } from '../../src/modules/workflow/domain/workflow-approval.js';
import type { WorkflowAutomationBinding } from '../../src/modules/workflow/domain/workflow-automation.js';
import {
  WorkflowApprovalPendingError,
  WorkflowApprovalStaleError,
  WorkflowExecutionError,
  WorkflowVersionLockedError,
} from '../../src/modules/workflow/data/workflow-errors.js';
import { uniqueViolation } from './in-memory-repositories.js';

export type WorkflowOrderBy = Array<Record<string, 'asc' | 'desc'>>;

interface WorkflowState_ {
  definitions: Map<string, WorkflowDefinition>;
  versions: Map<string, WorkflowVersion>;
  states: Map<string, WorkflowState>;
  transitions: Map<string, WorkflowTransition>;
  instances: Map<string, WorkflowInstance>;
  history: Map<string, WorkflowTransitionHistory>;
  approvals: Map<string, WorkflowApproval>;
  automations: Map<string, WorkflowAutomationBinding>;
  /** Serializes theimirror-transactions (see the file docs). */
  chain: Promise<void>;
}

function createWorkflowState(): WorkflowState_ {
  return {
    definitions: new Map(),
    versions: new Map(),
    states: new Map(),
    transitions: new Map(),
    instances: new Map(),
    history: new Map(),
    approvals: new Map(),
    automations: new Map(),
    chain: Promise.resolve(),
  };
}

/** Run `fn` mutually excluded with every other mirror-transaction. */
async function runExclusive<T>(
  state: WorkflowState_,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = state.chain;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.chain = previous.then(() => current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function sortBy<T extends object>(rows: T[], orderBy: WorkflowOrderBy): T[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const clause of orderBy) {
      const entry = Object.entries(clause)[0];
      if (entry === undefined) continue;
      const [field, direction] = entry;
      const left = (a as Record<string, unknown>)[field];
      const right = (b as Record<string, unknown>)[field];
      let comparison: number;
      if (left instanceof Date && right instanceof Date) {
        comparison = left.getTime() - right.getTime();
      } else if (typeof left === 'number' && typeof right === 'number') {
        comparison = left - right;
      } else {
        comparison = String(left).localeCompare(String(right));
      }
      if (comparison !== 0) {
        return direction === 'desc' ? -comparison : comparison;
      }
    }
    return 0;
  });
  return sorted;
}

function historyLength(state: WorkflowState_, instanceId: string): number {
  let count = 0;
  for (const row of state.history.values()) {
    if (row.instanceId === instanceId) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export class InMemoryWorkflowDefinitionsRepository {
  constructor(private readonly state: WorkflowState_) {}

  async findById(id: string): Promise<WorkflowDefinition | null> {
    return this.state.definitions.get(id) ?? null;
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<WorkflowDefinition | null> {
    for (const row of this.state.definitions.values()) {
      if (row.organizationId === organizationId && row.code === code) {
        return row;
      }
    }
    return null;
  }

  async list(params: {
    where: {
      organizationId: string;
      isActive?: boolean;
      search?: string;
    };
    orderBy: WorkflowOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowDefinition[]; total: number }> {
    const search = params.where.search?.trim().toLowerCase() ?? '';
    const items = sortBy(
      [...this.state.definitions.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          (params.where.isActive === undefined ||
            row.isActive === params.where.isActive) &&
          (search === '' ||
            row.code.toLowerCase().includes(search) ||
            row.name.toLowerCase().includes(search)),
      ),
      params.orderBy,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async create(input: {
    id: string;
    organizationId: string;
    code: string;
    name: string;
    description: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Promise<WorkflowDefinition> {
    if ((await this.findByCode(input.organizationId, input.code)) !== null) {
      throw uniqueViolation();
    }
    const row: WorkflowDefinition = { ...input };
    this.state.definitions.set(row.id, row);
    return row;
  }

  async update(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      isActive?: boolean;
      updatedAt: Date;
      updatedBy: string | null;
    },
  ): Promise<WorkflowDefinition | null> {
    const row = this.state.definitions.get(id);
    if (row === undefined) return null;
    const updated: WorkflowDefinition = {
      ...row,
      name: patch.name ?? row.name,
      description: patch.description ?? row.description,
      isActive: patch.isActive ?? row.isActive,
      updatedAt: patch.updatedAt,
      updatedBy: patch.updatedBy,
    };
    this.state.definitions.set(id, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export class InMemoryWorkflowVersionsRepository {
  constructor(private readonly state: WorkflowState_) {}

  async findById(id: string): Promise<WorkflowVersion | null> {
    return this.state.versions.get(id) ?? null;
  }

  async findActiveForDefinition(
    definitionId: string,
  ): Promise<WorkflowVersion | null> {
    for (const row of this.state.versions.values()) {
      if (row.definitionId === definitionId && row.status === 'active') {
        return row;
      }
    }
    return null;
  }

  async findLatestForDefinition(
    definitionId: string,
  ): Promise<WorkflowVersion | null> {
    let latest: WorkflowVersion | null = null;
    for (const row of this.state.versions.values()) {
      if (
        row.definitionId === definitionId &&
        (latest === null || row.versionNumber > latest.versionNumber)
      ) {
        latest = row;
      }
    }
    return latest;
  }

  async list(params: {
    where: { organizationId: string; definitionId: string; status?: string };
    orderBy: WorkflowOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowVersion[]; total: number }> {
    const items = sortBy(
      [...this.state.versions.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          row.definitionId === params.where.definitionId &&
          (params.where.status === undefined ||
            row.status === params.where.status),
      ),
      params.orderBy,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async create(input: {
    id: string;
    organizationId: string;
    definitionId: string;
    versionNumber: number;
    status: string;
    effectiveFrom: Date | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Promise<WorkflowVersion> {
    for (const row of this.state.versions.values()) {
      if (
        row.definitionId === input.definitionId &&
        row.versionNumber === input.versionNumber
      ) {
        throw uniqueViolation();
      }
    }
    const row = { ...input } as WorkflowVersion;
    this.state.versions.set(row.id, row);
    return row;
  }

  async update(
    id: string,
    patch: { status?: string; updatedAt: Date; updatedBy: string | null },
  ): Promise<WorkflowVersion | null> {
    const row = this.state.versions.get(id);
    if (row === undefined) return null;
    const updated = {
      ...row,
      status: (patch.status ?? row.status) as WorkflowVersion['status'],
      updatedAt: patch.updatedAt,
      updatedBy: patch.updatedBy,
    };
    this.state.versions.set(id, updated);
    return updated;
  }

  async listStatesAndTransitions(versionId: string): Promise<{
    states: WorkflowState[];
    transitions: WorkflowTransition[];
  }> {
    return {
      states: [...this.state.states.values()]
        .filter((row) => row.versionId === versionId)
        .sort((a, b) => a.code.localeCompare(b.code)),
      transitions: [...this.state.transitions.values()]
        .filter((row) => row.versionId === versionId)
        .sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  async publish(
    input: {
      definitionId: string;
      versionId: string;
      organizationId: string;
      actorId: string | null;
      now: Date;
    },
    validate: (snapshot: {
      version: WorkflowVersion;
      states: WorkflowState[];
      transitions: WorkflowTransition[];
    }) => void,
  ): Promise<{
    version: WorkflowVersion;
    supersededVersionId: string | null;
  } | null> {
    return runExclusive(this.state, () => {
      const version = this.state.versions.get(input.versionId);
      if (
        version === undefined ||
        version.organizationId !== input.organizationId ||
        version.definitionId !== input.definitionId
      ) {
        return null;
      }
      validate({
        version,
        states: [...this.state.states.values()].filter(
          (row) => row.versionId === input.versionId,
        ),
        transitions: [...this.state.transitions.values()].filter(
          (row) => row.versionId === input.versionId,
        ),
      });
      let supersededVersionId: string | null = null;
      for (const row of this.state.versions.values()) {
        if (
          row.definitionId === input.definitionId &&
          row.status === 'active' &&
          row.id !== input.versionId
        ) {
          row.status = 'superseded';
          row.updatedAt = input.now;
          row.updatedBy = input.actorId;
          supersededVersionId = row.id;
        }
      }
      version.status = 'active';
      version.updatedAt = input.now;
      version.updatedBy = input.actorId;
      return { version: { ...version }, supersededVersionId };
    });
  }
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export class InMemoryWorkflowStatesRepository {
  constructor(private readonly state: WorkflowState_) {}

  async findById(id: string): Promise<WorkflowState | null> {
    return this.state.states.get(id) ?? null;
  }

  async findByCode(
    versionId: string,
    code: string,
  ): Promise<WorkflowState | null> {
    for (const row of this.state.states.values()) {
      if (row.versionId === versionId && row.code === code) return row;
    }
    return null;
  }

  async list(params: {
    where: { organizationId: string; versionId: string };
    orderBy: WorkflowOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowState[]; total: number }> {
    const items = sortBy(
      [...this.state.states.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          row.versionId === params.where.versionId,
      ),
      params.orderBy,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async countByVersion(versionId: string): Promise<number> {
    let count = 0;
    for (const row of this.state.states.values()) {
      if (row.versionId === versionId) count += 1;
    }
    return count;
  }

  async createInDraftVersion(
    versionId: string,
    input: {
      id: string;
      organizationId: string;
      versionId: string;
      code: string;
      name: string;
      description: string | null;
      isInitial: boolean;
      isTerminal: boolean;
      isActive: boolean;
      sortOrder: number;
      createdAt: Date;
      updatedAt: Date;
      createdBy: string | null;
      updatedBy: string | null;
    },
  ): Promise<WorkflowState> {
    return runExclusive(this.state, async () => {
      this.requireDraft(versionId);
      if ((await this.findByCode(versionId, input.code)) !== null) {
        throw uniqueViolation();
      }
      const row: WorkflowState = { ...input };
      this.state.states.set(row.id, row);
      return row;
    });
  }

  async updateInDraftVersion(
    versionId: string,
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      isInitial?: boolean;
      isTerminal?: boolean;
      isActive?: boolean;
      sortOrder?: number;
      updatedAt: Date;
      updatedBy: string | null;
    },
  ): Promise<WorkflowState | null> {
    return runExclusive(this.state, () => {
      this.requireDraft(versionId);
      const row = this.state.states.get(id);
      if (row === undefined) return null;
      const updated: WorkflowState = {
        ...row,
        name: patch.name ?? row.name,
        description: patch.description ?? row.description,
        isInitial: patch.isInitial ?? row.isInitial,
        isTerminal: patch.isTerminal ?? row.isTerminal,
        isActive: patch.isActive ?? row.isActive,
        sortOrder: patch.sortOrder ?? row.sortOrder,
        updatedAt: patch.updatedAt,
        updatedBy: patch.updatedBy,
      };
      this.state.states.set(id, updated);
      return updated;
    });
  }

  async deleteInDraftVersion(
    versionId: string,
    id: string,
  ): Promise<WorkflowState | null> {
    return runExclusive(this.state, () => {
      this.requireDraft(versionId);
      const row = this.state.states.get(id);
      if (row === undefined) return null;
      this.state.states.delete(id);
      return row;
    });
  }

  private requireDraft(versionId: string): void {
    const version = this.state.versions.get(versionId);
    if (version === undefined) {
      throw new Error(`Workflow version "${versionId}" no longer exists.`);
    }
    if (version.status !== 'draft') {
      throw new WorkflowVersionLockedError(versionId);
    }
  }
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export class InMemoryWorkflowTransitionsRepository {
  constructor(private readonly state: WorkflowState_) {}

  async findById(id: string): Promise<WorkflowTransition | null> {
    return this.state.transitions.get(id) ?? null;
  }

  async findByCode(
    versionId: string,
    code: string,
  ): Promise<WorkflowTransition | null> {
    for (const row of this.state.transitions.values()) {
      if (row.versionId === versionId && row.code === code) return row;
    }
    return null;
  }

  async list(params: {
    where: {
      organizationId: string;
      versionId: string;
      sourceStateId?: string;
      isActive?: boolean;
    };
    orderBy: WorkflowOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowTransition[]; total: number }> {
    const items = sortBy(
      [...this.state.transitions.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          row.versionId === params.where.versionId &&
          (params.where.sourceStateId === undefined ||
            row.sourceStateId === params.where.sourceStateId) &&
          (params.where.isActive === undefined ||
            row.isActive === params.where.isActive),
      ),
      params.orderBy,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async listEnabledFromState(
    versionId: string,
    sourceStateId: string,
  ): Promise<WorkflowTransition[]> {
    return [...this.state.transitions.values()]
      .filter(
        (row) =>
          row.versionId === versionId &&
          row.sourceStateId === sourceStateId &&
          row.isActive,
      )
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
      );
  }

  async countTouchingState(
    versionId: string,
    stateId: string,
  ): Promise<number> {
    let count = 0;
    for (const row of this.state.transitions.values()) {
      if (
        row.versionId === versionId &&
        (row.sourceStateId === stateId || row.targetStateId === stateId)
      ) {
        count += 1;
      }
    }
    return count;
  }

  async createInDraftVersion(
    versionId: string,
    input: {
      id: string;
      organizationId: string;
      versionId: string;
      code: string;
      name: string;
      description: string | null;
      sourceStateId: string;
      targetStateId: string;
      requiredPermission: string;
      requiresApproval: boolean;
      approvalPermission: string | null;
      requiresComment: boolean;
      requireDifferentActor: boolean;
      isActive: boolean;
      sortOrder: number;
      createdAt: Date;
      updatedAt: Date;
      createdBy: string | null;
      updatedBy: string | null;
    },
  ): Promise<WorkflowTransition> {
    return runExclusive(this.state, async () => {
      this.requireDraft(versionId);
      if ((await this.findByCode(versionId, input.code)) !== null) {
        throw uniqueViolation();
      }
      const row: WorkflowTransition = { ...input };
      this.state.transitions.set(row.id, row);
      return row;
    });
  }

  async updateInDraftVersion(
    versionId: string,
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      requiredPermission?: string;
      requiresApproval?: boolean;
      approvalPermission?: string | null;
      requiresComment?: boolean;
      requireDifferentActor?: boolean;
      isActive?: boolean;
      sortOrder?: number;
      updatedAt: Date;
      updatedBy: string | null;
    },
  ): Promise<WorkflowTransition | null> {
    return runExclusive(this.state, () => {
      this.requireDraft(versionId);
      const row = this.state.transitions.get(id);
      if (row === undefined) return null;
      const updated: WorkflowTransition = {
        ...row,
        name: patch.name ?? row.name,
        description: patch.description ?? row.description,
        requiredPermission: patch.requiredPermission ?? row.requiredPermission,
        requiresApproval: patch.requiresApproval ?? row.requiresApproval,
        approvalPermission: patch.approvalPermission ?? row.approvalPermission,
        requiresComment: patch.requiresComment ?? row.requiresComment,
        requireDifferentActor:
          patch.requireDifferentActor ?? row.requireDifferentActor,
        isActive: patch.isActive ?? row.isActive,
        sortOrder: patch.sortOrder ?? row.sortOrder,
        updatedAt: patch.updatedAt,
        updatedBy: patch.updatedBy,
      };
      this.state.transitions.set(id, updated);
      return updated;
    });
  }

  async deleteInDraftVersion(
    versionId: string,
    id: string,
  ): Promise<WorkflowTransition | null> {
    return runExclusive(this.state, () => {
      this.requireDraft(versionId);
      const row = this.state.transitions.get(id);
      if (row === undefined) return null;
      for (const [bindingId, binding] of this.state.automations) {
        if (binding.transitionId === id) {
          this.state.automations.delete(bindingId);
        }
      }
      this.state.transitions.delete(id);
      return row;
    });
  }

  private requireDraft(versionId: string): void {
    const version = this.state.versions.get(versionId);
    if (version === undefined) {
      throw new Error(`Workflow version "${versionId}" no longer exists.`);
    }
    if (version.status !== 'draft') {
      throw new WorkflowVersionLockedError(versionId);
    }
  }
}

// ---------------------------------------------------------------------------
// Instances (+ the execution mirror-transaction)
// ---------------------------------------------------------------------------

export class InMemoryWorkflowInstancesRepository {
  constructor(private readonly state: WorkflowState_) {}

  async findById(id: string): Promise<WorkflowInstance | null> {
    return this.state.instances.get(id) ?? null;
  }

  async findByEntity(
    organizationId: string,
    entityModule: string,
    entityType: string,
    entityId: string,
  ): Promise<WorkflowInstance | null> {
    for (const row of this.state.instances.values()) {
      if (
        row.organizationId === organizationId &&
        row.entityModule === entityModule &&
        row.entityType === entityType &&
        row.entityId === entityId
      ) {
        return row;
      }
    }
    return null;
  }

  async list(params: {
    where: {
      organizationId: string;
      definitionId?: string;
      versionId?: string;
      currentStateId?: string;
      entityModule?: string;
      entityType?: string;
      entityId?: string;
    };
    orderBy: WorkflowOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowInstance[]; total: number }> {
    const items = sortBy(
      [...this.state.instances.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          (params.where.definitionId === undefined ||
            row.definitionId === params.where.definitionId) &&
          (params.where.versionId === undefined ||
            row.versionId === params.where.versionId) &&
          (params.where.currentStateId === undefined ||
            row.currentStateId === params.where.currentStateId) &&
          (params.where.entityModule === undefined ||
            row.entityModule === params.where.entityModule) &&
          (params.where.entityType === undefined ||
            row.entityType === params.where.entityType) &&
          (params.where.entityId === undefined ||
            row.entityId === params.where.entityId),
      ),
      params.orderBy,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async create(input: {
    id: string;
    organizationId: string;
    definitionId: string;
    versionId: string;
    entityModule: string;
    entityType: string;
    entityId: string;
    currentStateId: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Promise<WorkflowInstance> {
    if (
      (await this.findByEntity(
        input.organizationId,
        input.entityModule,
        input.entityType,
        input.entityId,
      )) !== null
    ) {
      throw uniqueViolation();
    }
    const row: WorkflowInstance = { ...input };
    this.state.instances.set(row.id, row);
    return row;
  }

  async executeTransition(input: {
    instanceId: string;
    organizationId: string;
    transitionId: string;
    historyId: string;
    actorPermitted: boolean;
    actorId: string | null;
    comment: string | null;
    approvalId: string | null;
    correlationId: string | null;
    now: Date;
  }): Promise<{
    instance: WorkflowInstance;
    history: WorkflowTransitionHistory;
    transition: WorkflowTransition;
  } | null> {
    return runExclusive(this.state, () => {
      const instance = this.state.instances.get(input.instanceId);
      if (
        instance === undefined ||
        instance.organizationId !== input.organizationId
      ) {
        return null;
      }
      const transition = this.state.transitions.get(input.transitionId);
      if (
        transition === undefined ||
        transition.organizationId !== input.organizationId ||
        transition.versionId !== instance.versionId
      ) {
        throw new WorkflowExecutionError('version_mismatch');
      }
      const source = this.state.states.get(transition.sourceStateId);
      const target = this.state.states.get(transition.targetStateId);
      if (source === undefined || target === undefined) {
        throw new Error(
          `Workflow transition "${transition.id}" references a state that no longer exists.`,
        );
      }
      const length = historyLength(this.state, instance.id);

      let approvalSatisfied = !transition.requiresApproval;
      let approvalIsStale = false;
      if (transition.requiresApproval && input.approvalId !== null) {
        const approval = this.state.approvals.get(input.approvalId);
        const matches =
          approval !== undefined &&
          approval.instanceId === instance.id &&
          approval.transitionId === transition.id &&
          approval.status === 'approved';
        if (matches && (approval as WorkflowApproval).baseSequence === length) {
          approvalSatisfied = true;
        } else if (matches) {
          approvalIsStale = true;
        }
      }

      const { problem } = planTransitionExecution({
        versionMatches: true,
        sourceIsCurrent: instance.currentStateId === transition.sourceStateId,
        transitionEnabled: transition.isActive,
        statesEnabled: source.isActive && target.isActive,
        sourceIsTerminal: source.isTerminal,
        actorPermitted: input.actorPermitted,
        commentSatisfied:
          !transition.requiresComment ||
          (input.comment !== null && input.comment.trim() !== ''),
        actorDiffersSatisfied:
          !transition.requireDifferentActor ||
          input.actorId === null ||
          input.actorId !== instance.createdBy,
        approvalSatisfied,
      });
      if (problem !== null) {
        if (problem === 'approval_required' && approvalIsStale) {
          throw new WorkflowApprovalStaleError(
            'The approval is stale: the workflow moved since it was requested, so it can no longer be used.',
          );
        }
        throw new WorkflowExecutionError(problem);
      }

      const sequence = length + 1;
      for (const row of this.state.history.values()) {
        if (row.instanceId === instance.id && row.sequence === sequence) {
          throw uniqueViolation();
        }
      }
      const updated: WorkflowInstance = {
        ...instance,
        currentStateId: transition.targetStateId,
        updatedAt: input.now,
        updatedBy: input.actorId,
      };
      this.state.instances.set(updated.id, updated);
      const history: WorkflowTransitionHistory = {
        id: input.historyId,
        organizationId: instance.organizationId,
        instanceId: instance.id,
        versionId: instance.versionId,
        transitionId: transition.id,
        fromStateId: transition.sourceStateId,
        toStateId: transition.targetStateId,
        sequence,
        actorId: input.actorId,
        comment: input.comment,
        approvalId: transition.requiresApproval ? input.approvalId : null,
        correlationId: input.correlationId,
        occurredAt: input.now,
        createdAt: input.now,
      };
      this.state.history.set(history.id, history);
      return {
        instance: { ...updated },
        history,
        transition: { ...transition },
      };
    });
  }
}

// ---------------------------------------------------------------------------
// History (append-only reads)
// ---------------------------------------------------------------------------

export class InMemoryWorkflowHistoryRepository {
  constructor(private readonly state: WorkflowState_) {}

  async listByInstance(params: {
    where: { organizationId: string; instanceId: string };
    orderBy: WorkflowOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowTransitionHistory[]; total: number }> {
    const items = sortBy(
      [...this.state.history.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          row.instanceId === params.where.instanceId,
      ),
      params.orderBy,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async countByInstance(instanceId: string): Promise<number> {
    return historyLength(this.state, instanceId);
  }
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export class InMemoryWorkflowApprovalsRepository {
  constructor(private readonly state: WorkflowState_) {}

  async findById(id: string): Promise<WorkflowApproval | null> {
    return this.state.approvals.get(id) ?? null;
  }

  async findPending(
    instanceId: string,
    transitionId: string,
  ): Promise<WorkflowApproval | null> {
    let pending: WorkflowApproval | null = null;
    for (const row of this.state.approvals.values()) {
      if (
        row.instanceId === instanceId &&
        row.transitionId === transitionId &&
        row.status === 'pending' &&
        (pending === null || row.requestedAt > pending.requestedAt)
      ) {
        pending = row;
      }
    }
    return pending;
  }

  async list(params: {
    where: { organizationId: string; instanceId: string; status?: string };
    orderBy: WorkflowOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowApproval[]; total: number }> {
    const items = sortBy(
      [...this.state.approvals.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          row.instanceId === params.where.instanceId &&
          (params.where.status === undefined ||
            row.status === params.where.status),
      ),
      params.orderBy,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async requestInLock(input: {
    organizationId: string;
    instanceId: string;
    versionId: string;
    transitionId: string;
    sourceStateId: string;
    approvalId: string;
    actorId: string | null;
    comment: string | null;
    now: Date;
  }): Promise<WorkflowApproval | null> {
    return runExclusive(this.state, async () => {
      const instance = this.state.instances.get(input.instanceId);
      if (
        instance === undefined ||
        instance.organizationId !== input.organizationId
      ) {
        return null;
      }
      if (instance.currentStateId !== input.sourceStateId) {
        throw new WorkflowExecutionError('not_in_source_state');
      }
      if (
        (await this.findPending(input.instanceId, input.transitionId)) !== null
      ) {
        throw new WorkflowApprovalPendingError(
          input.instanceId,
          input.transitionId,
        );
      }
      const created: WorkflowApproval = {
        id: input.approvalId,
        organizationId: instance.organizationId,
        instanceId: instance.id,
        versionId: instance.versionId,
        transitionId: input.transitionId,
        status: 'pending',
        requestedBy: input.actorId,
        requestedAt: input.now,
        decidedBy: null,
        decidedAt: null,
        comment: input.comment,
        baseSequence: historyLength(this.state, instance.id),
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      };
      this.state.approvals.set(created.id, created);
      return created;
    });
  }

  async decideInLock(input: {
    organizationId: string;
    approvalId: string;
    decision: 'approved' | 'rejected';
    actorId: string | null;
    comment: string | null;
    now: Date;
  }): Promise<WorkflowApproval | null> {
    return runExclusive(this.state, () => {
      const approval = this.state.approvals.get(input.approvalId);
      if (
        approval === undefined ||
        approval.organizationId !== input.organizationId
      ) {
        return null;
      }
      if (approval.status !== 'pending') {
        throw new WorkflowApprovalStaleError(
          'The approval has already been decided and cannot be changed.',
        );
      }
      const instance = this.state.instances.get(approval.instanceId);
      if (instance === undefined) {
        throw new Error(
          `Workflow instance "${approval.instanceId}" no longer exists.`,
        );
      }
      if (approval.baseSequence !== historyLength(this.state, instance.id)) {
        throw new WorkflowApprovalStaleError(
          'The approval is stale: the workflow moved since it was requested, so it can no longer be decided.',
        );
      }
      const decided: WorkflowApproval = {
        ...approval,
        status: input.decision,
        decidedBy: input.actorId,
        decidedAt: input.now,
        comment: input.comment ?? approval.comment,
        updatedAt: input.now,
        updatedBy: input.actorId,
      };
      this.state.approvals.set(decided.id, decided);
      return decided;
    });
  }
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export class InMemoryWorkflowAutomationsRepository {
  constructor(private readonly state: WorkflowState_) {}

  async findById(id: string): Promise<WorkflowAutomationBinding | null> {
    return this.state.automations.get(id) ?? null;
  }

  async list(params: {
    where: {
      organizationId: string;
      versionId?: string;
      transitionId?: string;
      isActive?: boolean;
    };
    orderBy: WorkflowOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowAutomationBinding[]; total: number }> {
    const items = sortBy(
      [...this.state.automations.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          (params.where.versionId === undefined ||
            row.versionId === params.where.versionId) &&
          (params.where.transitionId === undefined ||
            row.transitionId === params.where.transitionId) &&
          (params.where.isActive === undefined ||
            row.isActive === params.where.isActive),
      ),
      params.orderBy,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async listEnabledForTransition(
    transitionId: string,
  ): Promise<WorkflowAutomationBinding[]> {
    return [...this.state.automations.values()]
      .filter((row) => row.transitionId === transitionId && row.isActive)
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.action.localeCompare(b.action),
      );
  }

  async createInDraftVersion(
    versionId: string,
    input: {
      id: string;
      organizationId: string;
      versionId: string;
      transitionId: string;
      action: string;
      parameters: Record<string, string | number | boolean | null> | null;
      sortOrder: number;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
      createdBy: string | null;
      updatedBy: string | null;
    },
  ): Promise<WorkflowAutomationBinding> {
    return runExclusive(this.state, () => {
      this.requireDraft(versionId);
      for (const row of this.state.automations.values()) {
        if (
          row.transitionId === input.transitionId &&
          row.action === input.action
        ) {
          throw uniqueViolation();
        }
      }
      const row: WorkflowAutomationBinding = { ...input };
      this.state.automations.set(row.id, row);
      return row;
    });
  }

  async updateInDraftVersion(
    versionId: string,
    id: string,
    patch: {
      sortOrder?: number;
      isActive?: boolean;
      updatedAt: Date;
      updatedBy: string | null;
    },
  ): Promise<WorkflowAutomationBinding | null> {
    return runExclusive(this.state, () => {
      this.requireDraft(versionId);
      const row = this.state.automations.get(id);
      if (row === undefined) return null;
      const updated: WorkflowAutomationBinding = {
        ...row,
        sortOrder: patch.sortOrder ?? row.sortOrder,
        isActive: patch.isActive ?? row.isActive,
        updatedAt: patch.updatedAt,
        updatedBy: patch.updatedBy,
      };
      this.state.automations.set(id, updated);
      return updated;
    });
  }

  async deleteInDraftVersion(
    versionId: string,
    id: string,
  ): Promise<WorkflowAutomationBinding | null> {
    return runExclusive(this.state, () => {
      this.requireDraft(versionId);
      const row = this.state.automations.get(id);
      if (row === undefined) return null;
      this.state.automations.delete(id);
      return row;
    });
  }

  private requireDraft(versionId: string): void {
    const version = this.state.versions.get(versionId);
    if (version === undefined) {
      throw new Error(`Workflow version "${versionId}" no longer exists.`);
    }
    if (version.status !== 'draft') {
      throw new WorkflowVersionLockedError(versionId);
    }
  }
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export interface WorkflowStores {
  definitions: InMemoryWorkflowDefinitionsRepository;
  versions: InMemoryWorkflowVersionsRepository;
  states: InMemoryWorkflowStatesRepository;
  transitions: InMemoryWorkflowTransitionsRepository;
  instances: InMemoryWorkflowInstancesRepository;
  history: InMemoryWorkflowHistoryRepository;
  approvals: InMemoryWorkflowApprovalsRepository;
  automations: InMemoryWorkflowAutomationsRepository;
}

export function createWorkflowStores(): WorkflowStores {
  const state = createWorkflowState();
  return {
    definitions: new InMemoryWorkflowDefinitionsRepository(state),
    versions: new InMemoryWorkflowVersionsRepository(state),
    states: new InMemoryWorkflowStatesRepository(state),
    transitions: new InMemoryWorkflowTransitionsRepository(state),
    instances: new InMemoryWorkflowInstancesRepository(state),
    history: new InMemoryWorkflowHistoryRepository(state),
    approvals: new InMemoryWorkflowApprovalsRepository(state),
    automations: new InMemoryWorkflowAutomationsRepository(state),
  };
}
