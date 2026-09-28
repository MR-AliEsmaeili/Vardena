# ADR-0024: Workflow Foundation — Reusable Platform Capability

Status: Accepted (implemented by Task 9, 2026-09-12)
Date: 2026-09-12

## Context

ADR-0018 (`bounded-versioned-workflow`) decides that Vardena configures bounded,
versioned state machines instead of a generic BPMN engine, and
`docs/architecture/domain/workflow-architecture.md` designs the concepts
(definitions, versions, states, transitions, approvals, automations). What
remained open was the *implementation binding*: where the primitives live, how
business modules consume them without schema coupling, how concurrent
transitions serialize, and how authorization composes with the existing RBAC
system. Task 9 implements the bounded part of ADR-0018 as a reusable platform
capability — no Accounting/Inventory/Sales/Purchasing workflows ship with it.

## Decision

1. **One `workflow` module, one `workflow` schema, eight tables**
   (`workflow_definitions`, `workflow_versions`, `workflow_states`,
   `workflow_transitions`, `workflow_instances`, `workflow_transition_history`,
   `workflow_approvals`, `workflow_automation_bindings`). All FKs
   `ON DELETE RESTRICT ON UPDATE CASCADE`. No per-business-module workflow
   tables; no universal documents table.
2. **Logical entity binding (no cross-module coupling).** An instance binds a
   business entity as `(entity_module, entity_type, entity_id)` — module + type
   are snake_case, the id is a ULID (ADR-0008). There is deliberately NO
   database FK into business tables (AR-07/08), mirroring ADR-0019's logical
   numbering references and relation endpoints. One entity has exactly one
   live binding (unique index).
3. **Draft → active → superseded, pinned bindings.** Exactly one version per
   definition is `active`. Configuration writes are draft-only (service
   pre-check 422 + `requireDraftVersion` re-check inside every write
   transaction, lost races → 409). Instances pin `version_id` at bind time and
   are never migrated; new bindings resolve the active version.
4. **Bounded transition model.** Explicit source/target, `is_active` flag,
   immutable endpoints, no arbitrary jumps, no outgoing transitions from
   terminal states. Conditions are bounded columns (`requires_approval`,
   `requires_comment`, `require_different_actor`) interpreted by application
   code — no expression language, no user scripts, no EAV.
5. **Authorization composes, never bypasses.** Endpoint guards check the
   module's own 10 `Workflow.*` permissions; execution additionally requires
   the transition's OWN `required_permission` (any registered RBAC code),
   re-checked in the service (AR-04/AR-21). There is no wildcard, no
   superuser, and no "bypass workflow rules" permission (OQ-21). Approval
   decisions require the effective approval permission (explicit
   `approval_permission`, else the transition permission).
6. **Atomic state + history with row-lock serialization.** Each execution,
   approval request/decision and publish runs in one transaction behind
   `SELECT … FOR UPDATE` on the instance/version row. The concurrency loser
   fails with `not_in_source_state` → 409; `(instance_id, sequence)` is the
   hard backstop. History is append-only (no update/delete routes).
7. **Single-level approvals with staleness pinning.** An approval request pins
   `base_sequence` (the history length at request time); deciding or executing
   against a moved workflow fails with 422. One pending approval per
   (instance, transition); decisions are immutable. Multi-level, delegation
   and escalation stay out (OQ-26).
8. **Automation catalogue is code; v1 reports, never runs.** Actions exist only
   if application code registers them in `AutomationActionRegistry` (starts
   empty); bindings may reference registered actions only. Execution publishes
   the bound actions on the transition event — no external effects run in v1.
9. **Events reuse the existing bus.** `WorkflowVersion.Published`,
   `WorkflowInstance.Bound`, `WorkflowTransition.Completed`,
   `WorkflowApproval.Decided` publish on the kernel `DomainEventBus` (AR-15).
   No second event architecture, no competing outbox table. Durable dispatch
   is an explicit gap (see Consequences).

## Consequences

- Business modules consume workflows through the module's public services and
  the 10 `Workflow.*` permissions — never by reading `workflow.*` tables
  (AR-07). Adding a business workflow is configuration + permission codes, not
  a framework change.
- Lost-update races (publish-vs-configure, transition-vs-transition,
  approval-vs-move) all surface as retryable 409s or explanatory 422s; the
  live-database suite proves the locking behaviour against real Postgres.
- Cross-module referential integrity for bindings is application-enforced (as
  with ADR-0019 links); an orphan binding is possible only through a bug.
- **Gap accepted:** events are in-memory only. If the process crashes after
  commit but before a future durable consumer reads the bus, the effect is
  lost. The first transactional consumer (Audit/dispatcher) must move
  dispatch behind the outbox (AR-14) before v1 automations execute effects.
- **Gap accepted:** `organization_id` is caller-supplied (same as Task 6–8);
  binding principals to organizations stays a pre-multi-tenancy requirement
  (OQ-01/OQ-22, ADR-0021).

## Links

- Design: `docs/architecture/domain/workflow-architecture.md`, ADR-0018
- Prior art: ADR-0019 (logical references), ADR-0006/0016 (RBAC), ADR-0007 (sessions)
- Implementation report: `docs/task-9-implementation-report.md`
