# ADR-0018: Bounded, Versioned Workflow Configuration (No Workflow Engine)

Status: Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21)
Date: 2026-09-11

## Context

Vardena must support substantially different business document flows (the task's
Business A/B/C examples) without a code change per customer, but must not become a
low-code workflow platform. The alternative — hard-coding one flow — is also
unacceptable. `docs/architecture/domain/workflow-architecture.md` separates status,
transition, permission, approval, business rule, automation, domain event and side
effect, and shows that a generic engine cannot guarantee type safety, reportability,
auditability or security.

## Decision

1. **Structure is code.** Each document type declares, in code, its status set, its
   legal transitions, the permission codes each transition may require, and the side
   effects it performs. Statuses and transitions cannot be invented by configuration.
2. **Selection is versioned configuration.** A `workflow definition` (per organization
   and document type) has immutable **versions** with `draft → published → superseded`
   states and an `effective_from` date. A version selects: which transitions are
   enabled, which declared permission each requires, whether an approval is required
   (single-level in v1) and under which bounded conditions, and which registered
   automations are bound.
3. **Approvals are recorded evidence**, not a boolean: document, required permission,
   requested/decided actor and time, comment, workflow version.
4. **Automations come from a registered catalogue** (typed parameters, stable
   idempotency key). Automations bound to a transition run in the transition's
   transaction; automations reacting to events use the existing event/outbox
   machinery (AR-14/15). No scripting, no free-form expressions; conditions use a
   bounded, code-supported vocabulary.
5. **Documents pin the workflow version** they were created under; every transition
   row stores the version too. Changing configuration affects future documents and,
   explicitly and auditably, documents that a business chooses to migrate.
6. **Transitions are append-only history** (`document_transitions`), consumed by
   Audit (AR-23) and used for worklists and cycle-time reports.

## Consequences

- Real business variation (Business A/B/C) is configuration rows over code-defined
  edges — no per-customer codebase.
- New states or transition semantics require code + this ADR's review process; that
  friction is intentional.
- The ERP gains approval worklists, transition history and auditability without a BPMN
  engine.
- Configuration needs its own permissions, publish workflow, export/import (R3) and
  version metadata in document history UIs.
- Multi-level/parallel approvals, delegation and escalation are **explicitly out of
  scope** for the first release (OQ-26 tracks the policy questions).
- Historical integrity: no configuration change can reinterpret a recorded document
  (see also the effective-dating rules in
  `docs/architecture/domain/configurability-architecture.md` §4).

## Links

- Design: `docs/architecture/domain/workflow-architecture.md`
- Related: ADR-0006/0016 (RBAC + enforcement), AR-21/22/23/31, OQ-26, OQ-14, OQ-27.
