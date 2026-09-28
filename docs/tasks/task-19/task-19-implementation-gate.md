# Task 19 — Implementation Gate

- **Document type:** implementation gate — **DOCUMENTATION ONLY**
- **Date:** 2026-09-25
- **Status:** **READY FOR IMPLEMENTATION** (decision gate completed; production implementation **NOT STARTED**)
- **Branch:** `arena/01a0daa9-vardena`
- **Owner decisions:** [ODR-1…ODR-3](../../accounting/owner-decision-baseline.md#odr-1odr-3--task-19) — **DECIDED**
- **Investigation:** [`accounting-chart-configuration-investigation.md`](./accounting-chart-configuration-investigation.md)

> This document defines the **bounded implementation phase** of Task 19 after the
> Owner approved ODR-1, ODR-2 and ODR-3. It authorizes **no production change in
> this documentation task**. A later implementation task must still pass
> `docs/accounting/task-index.md` §7 execution (code, tests, PR) without
> expanding scope.

**Identifier mapping.** The investigation's §21 used provisional labels
`ODR-1…ODR-10` for *questions*. The Owner's approved identifiers **supersede**
that numbering for the three decided items:

| Owner identifier (authoritative) | Investigation §21 label | Investigation candidate |
|---|---|---|
| **ODR-1** Dual Configuration Pin / Explicit Coherence Rule | investigation ODR-3 | NEW-OQ-CANDIDATE-A / OQ-62 |
| **ODR-2** Chart Tree Read Ownership / Accounting-owned | investigation ODR-2 | NEW-OQ-CANDIDATE-B |
| **ODR-3** Organization Authorization Boundary / Principal-bound | investigation ODR-9 | S-1 / OQ-01 |

Investigation ODR-1 (“authorize a Task 19 slice”) is satisfied by this gate.
Investigation ODR-4…ODR-8 and ODR-10 remain **undecided** and **out of scope**
for Task 19 implementation.

---

## A. Task objective

Implement the **minimum** repository-consistent production changes required by
the three Owner decisions:

1. **ODR-1** — reject operations whose Account configuration pins are not
   explicitly coherent (no silent fallback between `coding_structure_version_id`
   and `accounting_configuration_id`).
2. **ODR-2** — expose a **read-only, Accounting-owned** Chart Tree / Chart of
   Accounts read surface (no Reporting Account master).
3. **ODR-3** — bind organization access to the authenticated Principal's
   authorized organization context so permission + arbitrary `organizationId`
   cannot cross tenants.

Task 19 does **not** implement OQ-25 content (base chart, control roles,
code history, deletion, non-leaf POSTING), OQ-43 legal books, or the
code-structure migration service.

---

## B. Accepted decisions

| ID | Decision | Status | Implementation complete? |
|---|---|---|---|
| **ODR-1** | Explicit Coherence Rule (Decision C) | **DECIDED** | **No** |
| **ODR-2** | Chart Tree reads are Accounting-owned (Decision A) | **DECIDED** | **No** |
| **ODR-3** | Principal-bound Organization Authorization (Decision A) | **DECIDED** | **No** |

`Decision resolved ≠ implementation complete.`

---

## C. Current repository baseline

Inspected against `main` @ `5f5a3c0` (merge of PR #51, the Task 19
investigation) and the Accounting schema/services.

### Already implemented (must be preserved)

| Area | Evidence |
|---|---|
| Account master, hierarchy, identity (`Account.id` ULID), immutable `code`, `level` derived, `is_postable` / `is_active` | `accounting.prisma` `Account`; `accounts.service.ts`; `accounts.controller.ts` (list/get/create/patch/enable/disable — **no tree endpoint**, **no DELETE**) |
| Dual pins, both NOT NULL | `accounts.coding_structure_version_id`, `accounts.accounting_configuration_id` |
| Code-shape validation uses **accounting configuration levels**; coding-structure version is pinned/`active` but **digit lengths are not consulted** | investigation §3.3; `AccountsService.createAccount` |
| Pin divergence is **possible** (OQ-62 OPEN; Task 11 rehearsal) | `docs/open-questions.md` OQ-62 |
| Accounting configuration root, single ACTIVE, freeze | ADR-0028 Accepted; Task 11/13 |
| Chart reads today: list/get Account APIs (flat), not a tree | `GET /api/v1/accounting/accounts` |
| Reporting reads: Task 17A/17B/18 ledger/statement/GL/TB | Accounting-owned; **not** a Chart Tree |
| RBAC: permission codes, no wildcards | ADR-0006/0016; `AuthorizationGuard` |
| Organization scoping: structural `organization_id` + optional ADR-0025 deployment pin | `requireUsableOrganization` / `assertOrganizationInScope` |
| **No principal→organization membership model** | `users`/`rbac` schemas; STATE.md §2 security inventory; OQ-01 |
| Foreign/unknown org keys → **404** on Accounting reads | Task 17A/17B/18 org-first 404/422 matrix |
| Permission + caller-supplied `organizationId` can currently reach another org's chart when the deployment pin is unset | investigation §1 finding 5 / S-1 |

### Not implemented (Task 19 slices)

- Coherence guard that **rejects** conflicting pins.
- Accounting-owned Chart Tree read API.
- Principal-bound organization authorization (membership/context).

Exact Chart Tree API shape and the exact coherence algorithm are
**Implementation detail — requires Task 19 implementation design** (must be
derived from existing models, not invented as a second configuration system).

---

## D. Proposed bounded implementation slices

### Slice 1 — Configuration Coherence Guard (ODR-1)

**Must:** inspect existing Account / CodingStructureVersion /
AccountingConfiguration relationship; enforce explicit coherence on write (and
on any validation path that would otherwise silently use one pin); refuse
divergent pins rather than pick a winner.

**Must not:** invent a second configuration system; duplicate coding-structure
state; silently choose one pin; rewrite historical ledger data; introduce EAV /
generic configuration; migrate code lengths; change ADR-0028 lifecycle.

If the implementation design cannot name a repository-backed comparison of the
two level sets, stop and record `REQUIRES OWNER CONFIRMATION` — do not invent
an algorithm beyond “reject on defined incoherence.”

### Slice 2 — Accounting-owned Chart Tree Read Surface (ODR-2)

**Must:** read-only; Accounting-owned; organization-scoped; deterministic
ordering; expose identity, hierarchy, code, name, level, active/inactive,
posting/aggregation semantics **where already authoritative** (`is_postable`
today; no invented `account_type`).

**Must not:** duplicate Account master in Reporting; transfer ownership to
Reporting; couple UI to Accounting tables; create a Reporting module; compute
balances/turnovers (Task 18 already owns those); claim a complete tree API
already exists (it does not — only list/get).

A read/query layer may be used internally (Task 18 `AccountingReadQueryRepository`
conventions) while ownership stays with Accounting.

### Slice 3 — Organization Authorization Boundary (ODR-3)

**Must:** bind requested `organizationId` to the Principal's authorized
organization membership/context; deny cross-org access even when Accounting
permissions are present; preserve existing RBAC; preserve 404/not-found tenant
isolation posture already used by Accounting reads.

**Must not:** trust arbitrary caller-supplied `organizationId`; introduce
wildcard organization access; duplicate membership data if a repository model
already exists (none found — **do not invent a second identity system**; use
the smallest repository-consistent membership/context the Organization module
already supports, or add the minimum Organization-owned binding with an
explicit design in the implementation task); weaken 404 isolation; bypass
ADR-0025.

Conceptual chain:

```text
Principal
  → Authorized Organization Membership / Context
  → Requested Organization
  → Module Permission
  → Resource Access
```

Multi-organization users may access multiple Organizations **only** where
repository-supported membership/access explicitly authorizes that Organization.

ODR-3 is **DECIDED**, not implemented.

---

## E. Explicit exclusions

Task 19 implementation **must not** include:

- full Reporting module / Report Builder / `/api/v1/reports`
- statutory/legal books / Legal Profile / Journal Book
- XLSX/CSV export, print/PDF
- Account Overview UI / frontend
- Treasury / AR / AP / Sales / Purchase / Settlement
- code-length migration; level-count migration; ADR-0035 service
- generic workflow/rules engine; generic configuration engine; EAV/JSONB
- unrelated security refactor or RBAC redesign
- OQ-25 content (base chart, control roles, code history, deletion, non-leaf POSTING)
- changing `postable ⇒ leaf` (D-1 stays in force)
- rewriting ledger history

---

## F. Dependencies (repository-backed)

| Dependency | Role |
|---|---|
| Organization module | `organization_id`, deployment pin, future membership/context for Slice 3 |
| Identity | Principal / session (`AuthGuard`) |
| RBAC | existing permission evaluation (unchanged semantics) |
| Accounting Account / configuration / coding-structure models | Slice 1 and 2 |
| Task 18 read conventions | Slice 2 scoping/narrowing; no financial recalculation |
| ADR-0028 / ADR-0026 / ADR-0021 / ADR-0025 / ADR-0006 / ADR-0016 | constraints |

Not required: Workflow, Inventory posting, License (ADR-0030), Documents
Foundation (shared), Reporting module.

---

## G. Acceptance criteria (testable)

### Configuration (ODR-1)

- Conflicting configuration pins **cannot** silently produce ambiguous code
  validation (operation refused).
- Valid coherent pins remain accepted.
- Historical ledger identity (`account_id`) and immutable codes remain intact.
- No second configuration root invented.

### Chart Tree (ODR-2)

- Read-only; Accounting-owned; organization-scoped; deterministic order.
- No duplicate Account master; no Reporting ownership.
- Respects existing hierarchy/domain invariants (`postable ⇒ leaf`, freeze-over-delete).
- Does not compute a second financial truth.

### Authorization (ODR-3)

- Permission alone cannot cross organization boundaries.
- Authorized organization access works.
- Unauthorized organization access is denied with the repository's approved
  isolation posture (Accounting reads: **404** for foreign/unknown org keys;
  do not leak existence via 403 unless an existing module already does so for
  that resource — preserve current Accounting 404 matrix).
- Existing permission semantics remain intact.
- Tests cover organization isolation (success + denial).

---

## H. OQ / ADR handling for implementers

| Item | After this gate |
|---|---|
| OQ-25, OQ-43 | **OPEN** (unchanged) |
| OQ-62 | **OPEN** — architectural reject-on-divergence **DECIDED** (ODR-1); exact comparison algorithm is implementation design |
| OQ-63 | **OPEN** (legacy fallback shape) |
| OQ-01 / OQ-22 | **OPEN** — target invariant **DECIDED** (ODR-3); membership schema still absent |
| ADR-0028 | **Accepted** — do not rewrite; Slice 1 must preserve D1/D2 concepts |
| ADR-0033…0037 | **Proposed** — `Owner decision exists; implementation adoption remains pending.` Do not self-accept |
| ADR-0009 | **Accepted** — Reporting remains view/SQL policy; Chart Tree ownership is Accounting (ODR-2) |

---

## I. Gate verdict

The three architectural questions that blocked the investigation (§20) are now
Owner-decided. Remaining open items are **implementation design** (coherence
algorithm derived from existing models; Chart Tree API shape derived from
existing Account fields; membership binding derived from Organization/Identity)
or **out-of-scope OQs** (OQ-25/OQ-43).

No additional architectural Owner decision is required to start the three
slices.

# READY FOR IMPLEMENTATION

Production implementation has **not** started. This documentation task stays
**READY FOR REVIEW**.
