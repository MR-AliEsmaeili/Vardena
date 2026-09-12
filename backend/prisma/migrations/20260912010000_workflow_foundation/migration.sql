-- Workflow Foundation: reusable workflow primitives (Task 9, ADR-0024,
-- bounded part of ADR-0018).
--
-- Module + intent (docs/database-strategy.md §2): the `workflow` module owns
-- the versioned state-machine primitives future business modules consume —
-- definitions, versions, states, transitions, entity bindings, transition
-- history, single-level approvals and automation bindings. It owns NO
-- business document: the bound entity is always a LOGICAL reference
-- (module + type + id), never a cross-module foreign key (AR-07/08) — the
-- same decision the Document Foundation makes for numbering references and
-- relation endpoints (ADR-0019).
--
-- Design notes:
--   * Version lifecycle is `draft → active → superseded` (one-way, stored as
--     text). Exactly one version per definition is `active`; publishing a
--     newer version supersedes the previous active one. Active/superseded
--     versions are immutable — behaviour changes ship as a NEW version.
--     Instances pin `version_id` at bind time and are never migrated.
--   * Transition conditions are BOUNDED columns (`requires_approval`,
--     `requires_comment`, `require_different_actor`), interpreted by
--     application code. There is no expression language, no user scripting,
--     no EAV model (Task 9 §4/§17).
--   * `required_permission` / `approval_permission` are RBAC codes from the
--     EXISTING registry — never a second authorization system (Task 9 §9).
--   * Transition history is append-only: one row per successful transition,
--     written in the same transaction as the state change. `sequence` is
--     1-based per instance; `(instance_id, sequence)` is the hard backstop
--     under the instance-row lock (`SELECT … FOR UPDATE` in the data layer).
--   * Approvals are single-level records (v1). `base_sequence` pins the
--     request to the history length it was requested in: stale approvals can
--     never authorize a later state (Task 9 §16).
--   * Automation bindings reference the code-defined action catalogue — no
--     stored code. v1 records the binding and reports it on the transition
--     event; executing external effects via outbox/worker is future work.
--   * Closed code-defined lists (version/approval statuses, code formats) are
--     stored as TEXT with NO CHECK constraints — the same decision Task 6/7/8
--     made (`item_kind`, `movement_type`, `relation_kind`, numbering
--     strategies): value rules live in the framework-free domain layer and
--     are unit-tested (AR-24).
--   * Deliberately NOT created: per-module workflow tables (Accounting,
--     Inventory, Sales, Purchasing stay out of Task 9), multi-level
--     approvals, delegation/escalation, a rules/scripting engine, any
--     competing event/outbox table (the module publishes on the existing
--     in-memory domain-event bus; durable dispatch is a documented gap).
--   * All foreign keys are ON DELETE RESTRICT ON UPDATE CASCADE.

CREATE SCHEMA IF NOT EXISTS "workflow";

-- ---- `workflow.workflow_definitions` ----------------------------------------
CREATE TABLE "workflow"."workflow_definitions" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "code"            VARCHAR(64)     NOT NULL,
    "name"            VARCHAR(200)    NOT NULL,
    "description"     TEXT,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_workflow_definitions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_workflow_definitions_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- A definition code is the organization's stable business key for the template.
CREATE UNIQUE INDEX "uq_workflow_definitions_org_code"
    ON "workflow"."workflow_definitions" ("organization_id", "code");

CREATE INDEX "idx_workflow_definitions_org"
    ON "workflow"."workflow_definitions" ("organization_id");

-- ---- `workflow.workflow_versions` -------------------------------------------
CREATE TABLE "workflow"."workflow_versions" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "definition_id"   TEXT            NOT NULL,
    "version_number"  INTEGER         NOT NULL,
    "status"          VARCHAR(16)     NOT NULL DEFAULT 'draft',
    "effective_from"  TIMESTAMPTZ(6),
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_workflow_versions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_workflow_versions_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_versions_definition"
        FOREIGN KEY ("definition_id")
        REFERENCES "workflow"."workflow_definitions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Version numbers are 1-based per definition (max + 1 at creation).
CREATE UNIQUE INDEX "uq_workflow_versions_definition_number"
    ON "workflow"."workflow_versions" ("definition_id", "version_number");

-- The publish path resolves "the active version of this definition" here.
CREATE INDEX "idx_workflow_versions_org_definition_status"
    ON "workflow"."workflow_versions" ("organization_id", "definition_id", "status");

-- ---- `workflow.workflow_states` ---------------------------------------------
CREATE TABLE "workflow"."workflow_states" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "version_id"      TEXT            NOT NULL,
    "code"            VARCHAR(64)     NOT NULL,
    "name"            VARCHAR(200)    NOT NULL,
    "description"     TEXT,
    "is_initial"      BOOLEAN         NOT NULL DEFAULT FALSE,
    "is_terminal"     BOOLEAN         NOT NULL DEFAULT FALSE,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "sort_order"      INTEGER         NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_workflow_states" PRIMARY KEY ("id"),
    CONSTRAINT "fk_workflow_states_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_states_version"
        FOREIGN KEY ("version_id")
        REFERENCES "workflow"."workflow_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- State codes are stable within their version (history and bindings resolve them).
CREATE UNIQUE INDEX "uq_workflow_states_version_code"
    ON "workflow"."workflow_states" ("version_id", "code");

CREATE INDEX "idx_workflow_states_org_version"
    ON "workflow"."workflow_states" ("organization_id", "version_id");

-- ---- `workflow.workflow_transitions` ----------------------------------------
CREATE TABLE "workflow"."workflow_transitions" (
    "id"                      TEXT            NOT NULL,
    "organization_id"         TEXT            NOT NULL,
    "version_id"              TEXT            NOT NULL,
    "code"                    VARCHAR(64)     NOT NULL,
    "name"                    VARCHAR(200)    NOT NULL,
    "description"             TEXT,
    "source_state_id"         TEXT            NOT NULL,
    "target_state_id"         TEXT            NOT NULL,
    "required_permission"     VARCHAR(160)    NOT NULL,
    "requires_approval"       BOOLEAN         NOT NULL DEFAULT FALSE,
    "approval_permission"     VARCHAR(160),
    "requires_comment"        BOOLEAN         NOT NULL DEFAULT FALSE,
    "require_different_actor" BOOLEAN         NOT NULL DEFAULT FALSE,
    "is_active"               BOOLEAN         NOT NULL DEFAULT TRUE,
    "sort_order"              INTEGER         NOT NULL DEFAULT 0,
    "created_at"              TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"              TEXT,
    "updated_by"              TEXT,
    CONSTRAINT "pk_workflow_transitions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_workflow_transitions_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_transitions_version"
        FOREIGN KEY ("version_id")
        REFERENCES "workflow"."workflow_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_transitions_source"
        FOREIGN KEY ("source_state_id")
        REFERENCES "workflow"."workflow_states"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_transitions_target"
        FOREIGN KEY ("target_state_id")
        REFERENCES "workflow"."workflow_states"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Transition codes are stable within their version.
CREATE UNIQUE INDEX "uq_workflow_transitions_version_code"
    ON "workflow"."workflow_transitions" ("version_id", "code");

CREATE INDEX "idx_workflow_transitions_org_version"
    ON "workflow"."workflow_transitions" ("organization_id", "version_id");

-- The runtime resolves "available transitions" by (version, current state).
CREATE INDEX "idx_workflow_transitions_version_source"
    ON "workflow"."workflow_transitions" ("version_id", "source_state_id");

-- ---- `workflow.workflow_instances` ------------------------------------------
CREATE TABLE "workflow"."workflow_instances" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "definition_id"   TEXT            NOT NULL,
    "version_id"      TEXT            NOT NULL,
    "entity_module"   VARCHAR(64)     NOT NULL,
    "entity_type"     VARCHAR(64)     NOT NULL,
    "entity_id"       TEXT            NOT NULL,
    "current_state_id" TEXT           NOT NULL,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_workflow_instances" PRIMARY KEY ("id"),
    CONSTRAINT "fk_workflow_instances_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_instances_definition"
        FOREIGN KEY ("definition_id")
        REFERENCES "workflow"."workflow_definitions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_instances_version"
        FOREIGN KEY ("version_id")
        REFERENCES "workflow"."workflow_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_instances_current_state"
        FOREIGN KEY ("current_state_id")
        REFERENCES "workflow"."workflow_states"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One live binding per entity: an entity is never in two workflows at once.
CREATE UNIQUE INDEX "uq_workflow_instances_entity"
    ON "workflow"."workflow_instances"
    ("organization_id", "entity_module", "entity_type", "entity_id");

CREATE INDEX "idx_workflow_instances_org_definition"
    ON "workflow"."workflow_instances" ("organization_id", "definition_id");

CREATE INDEX "idx_workflow_instances_org_version"
    ON "workflow"."workflow_instances" ("organization_id", "version_id");

-- Worklists ("instances awaiting action in state X") resolve here.
CREATE INDEX "idx_workflow_instances_version_state"
    ON "workflow"."workflow_instances" ("version_id", "current_state_id");

-- ---- `workflow.workflow_approvals` (single-level, v1) ------------------------
CREATE TABLE "workflow"."workflow_approvals" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "instance_id"     TEXT            NOT NULL,
    "version_id"      TEXT            NOT NULL,
    "transition_id"   TEXT            NOT NULL,
    "status"          VARCHAR(16)     NOT NULL DEFAULT 'pending',
    "requested_by"    TEXT,
    "requested_at"    TIMESTAMPTZ(6)  NOT NULL,
    "decided_by"      TEXT,
    "decided_at"      TIMESTAMPTZ(6),
    "comment"         TEXT,
    "base_sequence"   INTEGER         NOT NULL,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_workflow_approvals" PRIMARY KEY ("id"),
    CONSTRAINT "fk_workflow_approvals_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_approvals_instance"
        FOREIGN KEY ("instance_id")
        REFERENCES "workflow"."workflow_instances"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_approvals_version"
        FOREIGN KEY ("version_id")
        REFERENCES "workflow"."workflow_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_approvals_transition"
        FOREIGN KEY ("transition_id")
        REFERENCES "workflow"."workflow_transitions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_workflow_approvals_org_instance"
    ON "workflow"."workflow_approvals" ("organization_id", "instance_id");

-- The runtime resolves "the live approval for (instance, transition)" here.
-- No partial-unique on pending: exactly-one-pending is enforced by the
-- service inside the instance lock (PostgreSQL treats the nullable companions
-- as distinct, so a unique index would not express it anyway).
CREATE INDEX "idx_workflow_approvals_instance_transition_status"
    ON "workflow"."workflow_approvals" ("instance_id", "transition_id", "status");

-- ---- `workflow.workflow_transition_history` (append-only) --------------------
CREATE TABLE "workflow"."workflow_transition_history" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "instance_id"     TEXT            NOT NULL,
    "version_id"      TEXT            NOT NULL,
    "transition_id"   TEXT            NOT NULL,
    "from_state_id"   TEXT            NOT NULL,
    "to_state_id"     TEXT            NOT NULL,
    "sequence"        INTEGER         NOT NULL,
    "actor_id"        TEXT,
    "comment"         TEXT,
    "approval_id"     TEXT,
    "correlation_id"  VARCHAR(64),
    "occurred_at"     TIMESTAMPTZ(6)  NOT NULL,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_workflow_transition_history" PRIMARY KEY ("id"),
    CONSTRAINT "fk_workflow_history_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_history_instance"
        FOREIGN KEY ("instance_id")
        REFERENCES "workflow"."workflow_instances"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_history_version"
        FOREIGN KEY ("version_id")
        REFERENCES "workflow"."workflow_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_history_transition"
        FOREIGN KEY ("transition_id")
        REFERENCES "workflow"."workflow_transitions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_history_from_state"
        FOREIGN KEY ("from_state_id")
        REFERENCES "workflow"."workflow_states"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_history_to_state"
        FOREIGN KEY ("to_state_id")
        REFERENCES "workflow"."workflow_states"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_history_approval"
        FOREIGN KEY ("approval_id")
        REFERENCES "workflow"."workflow_approvals"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The hard backstop under the instance-row lock: two concurrent transitions
-- for one instance can never share a sequence number.
CREATE UNIQUE INDEX "uq_workflow_history_instance_sequence"
    ON "workflow"."workflow_transition_history" ("instance_id", "sequence");

CREATE INDEX "idx_workflow_history_org_instance_sequence"
    ON "workflow"."workflow_transition_history"
    ("organization_id", "instance_id", "sequence");

-- ---- `workflow.workflow_automation_bindings` ---------------------------------
CREATE TABLE "workflow"."workflow_automation_bindings" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "version_id"      TEXT            NOT NULL,
    "transition_id"   TEXT            NOT NULL,
    "action"          VARCHAR(64)     NOT NULL,
    "parameters"      JSONB,
    "sort_order"      INTEGER         NOT NULL DEFAULT 0,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_workflow_automation_bindings" PRIMARY KEY ("id"),
    CONSTRAINT "fk_workflow_automations_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_automations_version"
        FOREIGN KEY ("version_id")
        REFERENCES "workflow"."workflow_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_workflow_automations_transition"
        FOREIGN KEY ("transition_id")
        REFERENCES "workflow"."workflow_transitions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One binding per (transition, action): the same action with different
-- parameters is a second action registration, not a second binding row.
CREATE UNIQUE INDEX "uq_workflow_automations_transition_action"
    ON "workflow"."workflow_automation_bindings" ("transition_id", "action");

CREATE INDEX "idx_workflow_automations_org_version"
    ON "workflow"."workflow_automation_bindings" ("organization_id", "version_id");
