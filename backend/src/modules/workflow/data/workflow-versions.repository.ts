import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type {
  WorkflowVersion,
  WorkflowVersionStatus,
} from '../domain/workflow-version.js';
import type { WorkflowState } from '../domain/workflow-state.js';
import type { WorkflowTransition } from '../domain/workflow-transition.js';
import { toStateDomain } from './workflow-states.repository.js';
import { toTransitionDomain } from './workflow-transitions.repository.js';
import { lockDefinitionRow, lockVersionRow } from './workflow-locks.js';
import type {
  OrderBy,
  WorkflowStateRow,
  WorkflowTransactionalClient,
  WorkflowTransitionRow,
  WorkflowTxClient,
  WorkflowVersionCreate,
  WorkflowVersionDelegate,
  WorkflowVersionRow,
  WorkflowVersionUpdate,
  WorkflowVersionWhere,
} from './workflow-rows.js';

/**
 * Data access for `workflow.workflow_versions` (Task 9, ADR-0024).
 *
 * `publish` owns ONE transaction shaped like the inventory posting path:
 *
 *   1. lock the definition row (`SELECT … FOR UPDATE`) — concurrent
 *      publishes for one definition serialize here;
 *   2. lock the version row and re-check `draft` (a racing configuration
 *      write either committed before and is validated, or waits);
 *   3. read the version's states + enabled transitions for validation;
 *   4. supersede the currently active version (if any) and activate this one.
 *
 * The lock is what makes "exactly one active version per definition" hold
 * under concurrency; validation itself lives in the domain
 * (`planPublish`) and the service.
 */

export interface WorkflowVersionListFilter {
  organizationId: string;
  definitionId: string;
  status?: string | undefined;
}

export interface PublishSnapshot {
  version: WorkflowVersion;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
}

type Client = {
  workflowVersion: WorkflowVersionDelegate;
};

@Injectable()
export class WorkflowVersionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<WorkflowTransactionalClient> {
    return this.prisma.getClient<WorkflowTransactionalClient>();
  }

  async findById(id: string): Promise<WorkflowVersion | null> {
    const { workflowVersion } = await this.client();
    const row = await workflowVersion.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findActiveForDefinition(
    definitionId: string,
  ): Promise<WorkflowVersion | null> {
    const { workflowVersion } = await this.client();
    const row = await workflowVersion.findFirst({
      where: { definitionId, status: 'active' },
    });
    return row === null ? null : toDomain(row);
  }

  async findLatestForDefinition(
    definitionId: string,
  ): Promise<WorkflowVersion | null> {
    const { workflowVersion } = await this.client();
    const row = await workflowVersion.findFirst({
      where: { definitionId },
      orderBy: [{ versionNumber: 'desc' }],
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: WorkflowVersionListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowVersion[]; total: number }> {
    const { workflowVersion } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      workflowVersion.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      workflowVersion.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: WorkflowVersionCreate): Promise<WorkflowVersion> {
    const { workflowVersion } = await this.client();
    return toDomain(await workflowVersion.create({ data: input }));
  }

  async update(
    id: string,
    patch: WorkflowVersionUpdate,
  ): Promise<WorkflowVersion | null> {
    const { workflowVersion } = await this.client();
    try {
      return toDomain(
        await workflowVersion.update({ where: { id }, data: patch }),
      );
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Read a version's states + transitions for publish validation. The
   * publish path calls this INSIDE its transaction (via `publish`), so the
   * snapshot cannot race a draft-configuration write.
   */
  async listStatesAndTransitions(
    versionId: string,
  ): Promise<{ states: WorkflowState[]; transitions: WorkflowTransition[] }> {
    const client = await this.prisma.getClient<{
      workflowState: {
        findMany(args: {
          where: { versionId: string };
          orderBy: OrderBy;
          skip: number;
          take: number;
        }): Promise<WorkflowStateRow[]>;
      };
      workflowTransition: {
        findMany(args: {
          where: { versionId: string };
          orderBy: OrderBy;
          skip: number;
          take: number;
        }): Promise<WorkflowTransitionRow[]>;
      };
    }>();
    const [states, transitions] = await Promise.all([
      client.workflowState.findMany({
        where: { versionId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        skip: 0,
        take: 10_000,
      }),
      client.workflowTransition.findMany({
        where: { versionId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        skip: 0,
        take: 10_000,
      }),
    ]);
    return {
      states: states.map(toStateDomain),
      transitions: transitions.map(toTransitionDomain),
    };
  }

  /**
   * Publish a draft version atomically: supersede the currently active
   * version of the definition (if any) and activate this one.
   *
   * The caller validates the snapshot FIRST (domain `planPublish`) — this
   * transaction locks, re-checks `draft`, re-reads the snapshot under the
   * lock for the caller to re-validate, and only then flips statuses. The
   * double validation is what keeps a racing configuration write from
   * slipping an unvalidated edge into an active version.
   *
   * @returns the locked snapshot plus the publish outcome, or null when the
   *   version/definition row no longer exists.
   */
  async publish(
    input: {
      definitionId: string;
      versionId: string;
      organizationId: string;
      actorId: string | null;
      now: Date;
    },
    validate: (snapshot: PublishSnapshot) => void,
  ): Promise<{
    version: WorkflowVersion;
    supersededVersionId: string | null;
  } | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const definitionExists = await lockDefinitionRow(tx, input.definitionId);
      if (!definitionExists) return null;
      const locked = await lockVersionRow(tx, input.versionId);
      if (locked === null) return null;
      if (
        locked.organizationId !== input.organizationId ||
        locked.definitionId !== input.definitionId
      ) {
        return null;
      }
      const snapshot = await readSnapshot(tx, input.versionId);
      // The caller re-validates under the lock; a throw rolls everything back.
      validate(snapshot);
      const active = await tx.workflowVersion.findFirst({
        where: { definitionId: input.definitionId, status: 'active' },
      });
      let supersededVersionId: string | null = null;
      if (active !== null && active.id !== input.versionId) {
        await tx.workflowVersion.update({
          where: { id: active.id },
          data: {
            status: 'superseded',
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        });
        supersededVersionId = active.id;
      }
      const updated = await tx.workflowVersion.update({
        where: { id: input.versionId },
        data: {
          status: 'active',
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
      return { version: toDomain(updated), supersededVersionId };
    });
  }
}

// ---- Internal helpers ----

async function readSnapshot(
  tx: WorkflowTxClient,
  versionId: string,
): Promise<PublishSnapshot> {
  const [states, transitions, version] = await Promise.all([
    tx.workflowState.findMany({
      where: { versionId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      skip: 0,
      take: 10_000,
    }),
    tx.workflowTransition.findMany({
      where: { versionId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      skip: 0,
      take: 10_000,
    }),
    tx.workflowVersion.findFirst({ where: { id: versionId } }),
  ]);
  if (version === null) {
    throw new Error(`Workflow version "${versionId}" no longer exists.`);
  }
  return {
    version: toDomain(version),
    states: states.map(toStateDomain),
    transitions: transitions.map(toTransitionDomain),
  };
}

function toWhere(filter: WorkflowVersionListFilter): WorkflowVersionWhere {
  const where: WorkflowVersionWhere = {
    organizationId: filter.organizationId,
    definitionId: filter.definitionId,
  };
  if (filter.status !== undefined) where.status = filter.status;
  return where;
}

function toDomain(row: WorkflowVersionRow): WorkflowVersion {
  return {
    id: row.id,
    organizationId: row.organizationId,
    definitionId: row.definitionId,
    versionNumber: row.versionNumber,
    status: row.status as WorkflowVersionStatus,
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}
