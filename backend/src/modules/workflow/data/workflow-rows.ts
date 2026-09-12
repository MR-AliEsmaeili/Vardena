/**
 * Shared row/delegate shapes for the Workflow Foundation's data layer
 * (Task 9, ADR-0024).
 *
 * Prisma models are private to their module (docs/database-strategy.md §2)
 * and codegen may not have run in a fresh checkout, so — like the
 * Organization, Inventory and Document data layers — the repositories declare
 * the *structural* surface they use. Services work with domain entities,
 * never with these shapes.
 *
 * The transition execution path is the module's documented
 * concurrency-critical SQL (docs/database-strategy.md §13, AR-11): the
 * instance row is locked with `SELECT … FOR UPDATE` (Prisma cannot express
 * it), the state change + history insert apply in the same transaction, and
 * the `(instance_id, sequence)` unique index is the hard backstop. Version
 * publish and draft-configuration writes serialize on the locked
 * definition/version rows so an active version can never be mutated by a
 * racing write.
 */

/** `created_at`/`updated_at`/`created_by`/`updated_by` (AR-12). */
export interface AuditColumns {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

/** Case-insensitive substring match (the repository's search convention). */
export interface SearchClause {
  contains: string;
  mode: 'insensitive';
}

// ---------------------------------------------------------------------------
// Workflow definitions
// ---------------------------------------------------------------------------

export type WorkflowDefinitionRow = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
} & AuditColumns;

export interface WorkflowDefinitionWhere {
  id?: string;
  organizationId?: string;
  code?: string;
  isActive?: boolean;
  OR?: Array<{
    code?: SearchClause;
    name?: SearchClause;
  }>;
}

export interface WorkflowDefinitionCreate {
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
}

export interface WorkflowDefinitionUpdate {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface WorkflowDefinitionDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<WorkflowDefinitionRow | null>;
  findFirst(args: {
    where: WorkflowDefinitionWhere;
  }): Promise<WorkflowDefinitionRow | null>;
  findMany(args: {
    where: WorkflowDefinitionWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<WorkflowDefinitionRow[]>;
  count(args: { where: WorkflowDefinitionWhere }): Promise<number>;
  create(args: {
    data: WorkflowDefinitionCreate;
  }): Promise<WorkflowDefinitionRow>;
  update(args: {
    where: { id: string };
    data: WorkflowDefinitionUpdate;
  }): Promise<WorkflowDefinitionRow>;
}

// ---------------------------------------------------------------------------
// Workflow versions
// ---------------------------------------------------------------------------

export type WorkflowVersionRow = {
  id: string;
  organizationId: string;
  definitionId: string;
  versionNumber: number;
  status: string;
  effectiveFrom: Date | null;
} & AuditColumns;

export interface WorkflowVersionWhere {
  id?: string;
  organizationId?: string;
  definitionId?: string;
  status?: string;
}

export interface WorkflowVersionCreate {
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
}

export interface WorkflowVersionUpdate {
  status?: string;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface WorkflowVersionDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<WorkflowVersionRow | null>;
  findFirst(args: {
    where: WorkflowVersionWhere;
    orderBy?: OrderBy;
  }): Promise<WorkflowVersionRow | null>;
  findMany(args: {
    where: WorkflowVersionWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<WorkflowVersionRow[]>;
  count(args: { where: WorkflowVersionWhere }): Promise<number>;
  create(args: { data: WorkflowVersionCreate }): Promise<WorkflowVersionRow>;
  update(args: {
    where: { id: string };
    data: WorkflowVersionUpdate;
  }): Promise<WorkflowVersionRow>;
}

// ---------------------------------------------------------------------------
// Workflow states
// ---------------------------------------------------------------------------

export type WorkflowStateRow = {
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
} & AuditColumns;

export interface WorkflowStateWhere {
  id?: string;
  organizationId?: string;
  versionId?: string;
  code?: string;
}

export interface WorkflowStateCreate {
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
}

export interface WorkflowStateUpdate {
  name?: string;
  description?: string | null;
  isInitial?: boolean;
  isTerminal?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface WorkflowStateDelegate {
  findUnique(args: { where: { id: string } }): Promise<WorkflowStateRow | null>;
  findFirst(args: {
    where: WorkflowStateWhere;
  }): Promise<WorkflowStateRow | null>;
  findMany(args: {
    where: WorkflowStateWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<WorkflowStateRow[]>;
  count(args: { where: WorkflowStateWhere }): Promise<number>;
  create(args: { data: WorkflowStateCreate }): Promise<WorkflowStateRow>;
  update(args: {
    where: { id: string };
    data: WorkflowStateUpdate;
  }): Promise<WorkflowStateRow>;
  delete(args: { where: { id: string } }): Promise<WorkflowStateRow>;
}

// ---------------------------------------------------------------------------
// Workflow transitions
// ---------------------------------------------------------------------------

export type WorkflowTransitionRow = {
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
} & AuditColumns;

export interface WorkflowTransitionWhere {
  id?: string;
  organizationId?: string;
  versionId?: string;
  code?: string;
  sourceStateId?: string;
  targetStateId?: string;
  isActive?: boolean;
}

export interface WorkflowTransitionCreate {
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
}

export interface WorkflowTransitionUpdate {
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
}

export interface WorkflowTransitionDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<WorkflowTransitionRow | null>;
  findFirst(args: {
    where: WorkflowTransitionWhere;
  }): Promise<WorkflowTransitionRow | null>;
  findMany(args: {
    where: WorkflowTransitionWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<WorkflowTransitionRow[]>;
  count(args: { where: WorkflowTransitionWhere }): Promise<number>;
  create(args: {
    data: WorkflowTransitionCreate;
  }): Promise<WorkflowTransitionRow>;
  update(args: {
    where: { id: string };
    data: WorkflowTransitionUpdate;
  }): Promise<WorkflowTransitionRow>;
  delete(args: { where: { id: string } }): Promise<WorkflowTransitionRow>;
}

// ---------------------------------------------------------------------------
// Workflow instances
// ---------------------------------------------------------------------------

export type WorkflowInstanceRow = {
  id: string;
  organizationId: string;
  definitionId: string;
  versionId: string;
  entityModule: string;
  entityType: string;
  entityId: string;
  currentStateId: string;
} & AuditColumns;

export interface WorkflowInstanceWhere {
  id?: string;
  organizationId?: string;
  definitionId?: string;
  versionId?: string;
  currentStateId?: string;
  entityModule?: string;
  entityType?: string;
  entityId?: string;
}

export interface WorkflowInstanceCreate {
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
}

export interface WorkflowInstanceUpdate {
  currentStateId: string;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface WorkflowInstanceDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<WorkflowInstanceRow | null>;
  findFirst(args: {
    where: WorkflowInstanceWhere;
  }): Promise<WorkflowInstanceRow | null>;
  findMany(args: {
    where: WorkflowInstanceWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<WorkflowInstanceRow[]>;
  count(args: { where: WorkflowInstanceWhere }): Promise<number>;
  create(args: { data: WorkflowInstanceCreate }): Promise<WorkflowInstanceRow>;
  update(args: {
    where: { id: string };
    data: WorkflowInstanceUpdate;
  }): Promise<WorkflowInstanceRow>;
}

// ---------------------------------------------------------------------------
// Workflow transition history (append-only)
// ---------------------------------------------------------------------------

export type WorkflowTransitionHistoryRow = {
  id: string;
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  sequence: number;
  actorId: string | null;
  comment: string | null;
  approvalId: string | null;
  correlationId: string | null;
  occurredAt: Date;
  createdAt: Date;
  createdBy: string | null;
};

export interface WorkflowTransitionHistoryWhere {
  organizationId?: string;
  instanceId?: string;
  transitionId?: string;
}

export interface WorkflowTransitionHistoryCreate {
  id: string;
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  sequence: number;
  actorId: string | null;
  comment: string | null;
  approvalId: string | null;
  correlationId: string | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowTransitionHistoryDelegate {
  findMany(args: {
    where: WorkflowTransitionHistoryWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<WorkflowTransitionHistoryRow[]>;
  count(args: { where: WorkflowTransitionHistoryWhere }): Promise<number>;
  create(args: {
    data: WorkflowTransitionHistoryCreate;
  }): Promise<WorkflowTransitionHistoryRow>;
}

// ---------------------------------------------------------------------------
// Workflow approvals
// ---------------------------------------------------------------------------

export type WorkflowApprovalRow = {
  id: string;
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  status: string;
  requestedBy: string | null;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment: string | null;
  baseSequence: number;
} & AuditColumns;

export interface WorkflowApprovalWhere {
  id?: string;
  organizationId?: string;
  instanceId?: string;
  transitionId?: string;
  status?: string;
}

export interface WorkflowApprovalCreate {
  id: string;
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  status: string;
  requestedBy: string | null;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment: string | null;
  baseSequence: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowApprovalUpdate {
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment?: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface WorkflowApprovalDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<WorkflowApprovalRow | null>;
  findFirst(args: {
    where: WorkflowApprovalWhere;
    orderBy?: OrderBy;
  }): Promise<WorkflowApprovalRow | null>;
  findMany(args: {
    where: WorkflowApprovalWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<WorkflowApprovalRow[]>;
  count(args: { where: WorkflowApprovalWhere }): Promise<number>;
  create(args: { data: WorkflowApprovalCreate }): Promise<WorkflowApprovalRow>;
  update(args: {
    where: { id: string };
    data: WorkflowApprovalUpdate;
  }): Promise<WorkflowApprovalRow>;
}

// ---------------------------------------------------------------------------
// Workflow automation bindings
// ---------------------------------------------------------------------------

export type WorkflowAutomationBindingRow = {
  id: string;
  organizationId: string;
  versionId: string;
  transitionId: string;
  action: string;
  parameters: Record<string, string | number | boolean | null> | null;
  sortOrder: number;
  isActive: boolean;
} & AuditColumns;

export interface WorkflowAutomationBindingWhere {
  id?: string;
  organizationId?: string;
  versionId?: string;
  transitionId?: string;
  action?: string;
  isActive?: boolean;
}

export interface WorkflowAutomationBindingCreate {
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
}

export interface WorkflowAutomationBindingUpdate {
  sortOrder?: number;
  isActive?: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface WorkflowAutomationBindingDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<WorkflowAutomationBindingRow | null>;
  findFirst(args: {
    where: WorkflowAutomationBindingWhere;
  }): Promise<WorkflowAutomationBindingRow | null>;
  findMany(args: {
    where: WorkflowAutomationBindingWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<WorkflowAutomationBindingRow[]>;
  count(args: { where: WorkflowAutomationBindingWhere }): Promise<number>;
  create(args: {
    data: WorkflowAutomationBindingCreate;
  }): Promise<WorkflowAutomationBindingRow>;
  update(args: {
    where: { id: string };
    data: WorkflowAutomationBindingUpdate;
  }): Promise<WorkflowAutomationBindingRow>;
  delete(args: {
    where: { id: string };
  }): Promise<WorkflowAutomationBindingRow>;
  deleteMany(args: {
    where: WorkflowAutomationBindingWhere;
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Transaction client
// ---------------------------------------------------------------------------

/** Parameterized raw SQL inside a transaction — the row-locking paths. */
export type RawQuery = <T>(
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

/**
 * The delegates the workflow transactions work with. One shared shape (like
 * the inventory core's) so the publish, configuration, approval and
 * execution transactions cannot drift apart.
 */
export interface WorkflowTxClient {
  $queryRaw: RawQuery;
  workflowVersion: {
    findFirst(args: {
      where: WorkflowVersionWhere;
      orderBy?: OrderBy;
    }): Promise<WorkflowVersionRow | null>;
    update(args: {
      where: { id: string };
      data: WorkflowVersionUpdate;
    }): Promise<WorkflowVersionRow>;
  };
  workflowState: {
    findUnique(args: {
      where: { id: string };
    }): Promise<WorkflowStateRow | null>;
    findMany(args: {
      where: WorkflowStateWhere;
      orderBy: OrderBy;
      skip: number;
      take: number;
    }): Promise<WorkflowStateRow[]>;
    create(args: { data: WorkflowStateCreate }): Promise<WorkflowStateRow>;
    update(args: {
      where: { id: string };
      data: WorkflowStateUpdate;
    }): Promise<WorkflowStateRow>;
    delete(args: { where: { id: string } }): Promise<WorkflowStateRow>;
  };
  workflowTransition: {
    findUnique(args: {
      where: { id: string };
    }): Promise<WorkflowTransitionRow | null>;
    findMany(args: {
      where: WorkflowTransitionWhere;
      orderBy: OrderBy;
      skip: number;
      take: number;
    }): Promise<WorkflowTransitionRow[]>;
    create(args: {
      data: WorkflowTransitionCreate;
    }): Promise<WorkflowTransitionRow>;
    update(args: {
      where: { id: string };
      data: WorkflowTransitionUpdate;
    }): Promise<WorkflowTransitionRow>;
    delete(args: { where: { id: string } }): Promise<WorkflowTransitionRow>;
  };
  workflowInstance: {
    update(args: {
      where: { id: string };
      data: WorkflowInstanceUpdate;
    }): Promise<WorkflowInstanceRow>;
  };
  workflowTransitionHistory: {
    create(args: {
      data: WorkflowTransitionHistoryCreate;
    }): Promise<WorkflowTransitionHistoryRow>;
    count(args: { where: WorkflowTransitionHistoryWhere }): Promise<number>;
  };
  workflowApproval: {
    findUnique(args: {
      where: { id: string };
    }): Promise<WorkflowApprovalRow | null>;
    findFirst(args: {
      where: WorkflowApprovalWhere;
      orderBy?: OrderBy;
    }): Promise<WorkflowApprovalRow | null>;
    create(args: {
      data: WorkflowApprovalCreate;
    }): Promise<WorkflowApprovalRow>;
    update(args: {
      where: { id: string };
      data: WorkflowApprovalUpdate;
    }): Promise<WorkflowApprovalRow>;
  };
  workflowAutomationBinding: {
    create(args: {
      data: WorkflowAutomationBindingCreate;
    }): Promise<WorkflowAutomationBindingRow>;
    update(args: {
      where: { id: string };
      data: WorkflowAutomationBindingUpdate;
    }): Promise<WorkflowAutomationBindingRow>;
    delete(args: {
      where: { id: string };
    }): Promise<WorkflowAutomationBindingRow>;
    deleteMany(args: {
      where: WorkflowAutomationBindingWhere;
    }): Promise<{ count: number }>;
  };
}

export interface WorkflowTransactionalClient {
  $transaction: <T>(fn: (tx: WorkflowTxClient) => Promise<T>) => Promise<T>;
}
