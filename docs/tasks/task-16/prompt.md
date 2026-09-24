# Task 16 — Implementation Prompt

## Status

**NOT YET PREPARED — IMPLEMENTATION NOT AUTHORIZED**

The Task 16 domain contract is now formalized in [`brief.md`](./brief.md), and the
Owner decisions are reconciled in
[`decision-reconciliation.md`](./decision-reconciliation.md). This file remains a
handoff placeholder, not an implementation authorization.

## Settled inputs that must not be re-asked

The future implementation prompt must carry forward, without reopening:

- same-Organization Source and Target documents;
- directional Source → Target allocation;
- positive amounts bounded by current availability;
- partial and multi-stage/multiple allocations;
- `allocatableAmount`, `allocatedAmount` and `remainingAmount` concepts;
- compatible currencies only, with FX outside Task 16;
- reversed and supported voided/cancelled documents are not allocatable;
- atomicity, organization isolation and concurrent over-allocation prevention;
- organization-scoped `operationKey` idempotency: same key/payload replays and a
  different payload conflicts;
- immutable allocation history and compensating/reversal correction;
- Create/Read permissions and a distinct reversal permission when enabled;
- real PostgreSQL concurrency verification; and
- the bounded Accounting Settlement / Allocation scope and all exclusions in the
  brief.

## Remaining implementation gate

Before the implementation prompt can authorize production work, the Owner must
record the narrow repository-owned document-type allow-list and the owning amount and
currency authority for each supported endpoint. The current repository has no
approved AR/AP, Sales, Purchase or Treasury settlement document contract, and the
Accounting voucher contract does not define a settlement amount. This gate prevents
Task 16 from becoming a generic settlement engine; it does not reopen any settled
Owner decision.

The implementation prompt must also identify any ADR required if the chosen design
changes an existing module boundary, currency ownership/communication pattern,
lifecycle, security model or deployment topology. The canonical ADR location remains
`docs/adr/`.

## Explicit non-authorization

Until the remaining gate is recorded, do not add:

- production services, controllers, repositories, Prisma models or migrations;
- allocation API endpoints or permission registry entries;
- frontend code;
- AR/AP, Treasury, Sales/Purchase, FX, workflow/rules or universal settlement
  infrastructure; or
- claims of implementation, acceptance or production readiness.

## Final Prompt

**NOT YET PREPARED.** The implementation prompt will be recorded only after the
supported document/amount authority gate is resolved and the later implementation
work is separately authorized.
