# C-58 — Inventory business document runtime (Receipt / Issue / Transfer)

Status: **IMPLEMENTED on branch `arena/db3075eb-vardena` — not Owner-accepted**
Date: 2026-10-06

## 1. Scope

C-58 turns the already-merged business-document *foundation* (domain aggregate,
Prisma schema, migration) into a working vertical slice: Receipt, Issue and
Transfer can be drafted, edited, finalized, accounting-posted, sealed and
cancelled through real REST endpoints, and driven from a real Persian UI.

It composes the existing Inventory infrastructure and replaces none of it:

| Reused (authoritative) | Role in C-58 |
|---|---|
| `InventoryMovementsService` | posts every receipt/issue leg — the single ledger |
| `InventoryTransfersService` | posts the atomic two-leg transfer |
| `InventoryValuationService` | all cost assignment / repricing |
| `InventoryBalancesService`, Kardex | unchanged reads over the same ledger |
| `InventoryOperationsRepository` | idempotent operation replay |
| Documents/Numbering module | document type + number allocation at finalize |
| `AuthorizationGuard` + permission registry | every command re-authorized server-side |

Explicitly **not** in scope: GL/COGS posting, approval framework or
maker/checker (OQ-13/OQ-26 stay open), FIFO/LIFO, multi-currency, lot/serial
runtime, purchasing/sales, taxpayer integration.

## 2. Canonical decisions referenced

| Decision / question | C-58 treatment |
|---|---|
| C-58 Owner decision | **DECIDED**. Self-finalize with permission; no approval queue added. |
| PDR-05 / OD-VAL-05, OD-VAL-07 | **DECIDED**. Receipt cost optional and permissioned; issue cost derived, never typed. |
| OQ-54 / ADR-0040 | **DECIDED edit boundary**, implemented as Load → Validate → Detect side effects → Apply → Reconcile → Optional explicit repricing → Atomic persist. ADR-0040 stays **Proposed**; C-58 does not promote it. |
| OD-54-05 / OD-VAL-11 | **DECIDED**. A material edit requires `acknowledgeSideEffects` AND an explicit `repricing`; there is no default and `skip` persists an honestly stale valuation. |
| OD-VAL-10 | **DECIDED**. Backdated finalize requires `backdateConfirmed` plus a repricing answer. |
| OQ-67 | **OPEN**. Backdated transfers still fail closed; normal (non-backdated) transfers are fully operational. |
| OQ-68 / OQ-69 | **OPEN**. Reversal keeps the original movement's own value; no per-movement valuation-history table added. |

## 3. Implemented behavior

### 3.1 Lifecycle state machine

`draft → operational → accounting_posted → immutable`, plus
`draft|operational → cancelled`. Every other transition is refused with
`inventory.document.illegal_transition` — including `draft → accounting_posted`
(a document must post its stock effect first) and anything out of `immutable`
or `cancelled`. The transition table is domain code, unit-tested for every
legal and illegal pair.

### 3.2 One caller-owned transaction per command

Finalize allocates the number, posts the movement legs and writes the document
state inside a single transaction owned by the service; any failure (negative
stock, numbering conflict, authorization) rolls the whole command back, leaving
no partial movements, no consumed number and no changed document state. The
same holds for a material edit (reverse + repost + reconcile) and for
cancellation.

### 3.3 Costing

Receipt `cost` is optional, requires `Inventory.Valuation.AssignCost`, and is a
valuation assignment — never a purchase price. Issue and Transfer reject a
manual cost outright (`inventory.document.manual_cost_forbidden`). A receipt
cost is accepted only on a single-line document; apportioning one amount across
several lines is refused with `inventory.document.cost_apportionment_unsupported`
rather than invented.

### 3.4 Isolation, authorization and numbering

Every read and command is organization-scoped; another organization's document
answers **404**, never 403, so existence is not disclosed. Permissions
`Inventory.Document.{View,Create,Edit,Delete,Finalize,AccountingPost,Seal,Cancel}`
are enforced in the backend; finalize additionally requires the movement/transfer
create authority and cancel requires `Inventory.Movement.Reverse`. Numbers come
from the existing Documents/Numbering infrastructure at finalize and are never
reused — a cancelled document keeps its number.

## 4. REST surface

`@Controller({ path: 'inventory/business-documents', version: '1' })`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | filtered, sorted, paged list |
| `POST` | `/` | create draft |
| `GET` | `/:id` | one document with lines |
| `PATCH` | `/:id` | edit (draft or operational) |
| `DELETE` | `/:id` | delete a draft (204) |
| `POST` | `/:id/finalize` | allocate number + post ledger effect |
| `POST` | `/:id/accounting-post` | cross the immutability boundary |
| `POST` | `/:id/seal` | terminal |
| `POST` | `/:id/cancel` | reverse the posted effect |

There is deliberately no generic "set status" endpoint: each lifecycle step has
different preconditions, different permissions and different side effects.

## 5. Frontend

`frontend/src/features/inventory/documents/` — list, create, edit, detail and
the lifecycle dialogs, composed from the existing `src/ui` + `src/ui/patterns`
primitives, with URL-owned list state, TanStack Query server state, RHF+Zod
forms and all copy in `src/lib/i18n.ts`.

Two UI rules worth recording:

- the offered actions come from the response DTO's own
  `canEdit/canFinalize/canAccountingPost/canSeal/canCancel/canDelete` flags —
  the client never recomputes the lifecycle rule;
- a material edit is never retried silently: the backend's refusal opens a
  dialog that collects the acknowledgement and the repricing choice (with **no**
  preselected option) and resubmits the same intent.

API types were **regenerated** from the running OpenAPI document
(`npm run api:types`), not hand-edited.

## 6. Tests

- Domain: transition table (every legal/illegal pair), editability, validation,
  manual-cost rules.
- Application: authorization, organization isolation, idempotent replay,
  rollback on failure, edit classification and repricing gating.
- Live PostgreSQL E2E (`backend/test/**/inventory-business-documents-live.e2e-spec.ts`):
  atomicity, concurrency and isolation. These skip without a database and are
  verified in GitHub CI.
- Frontend integration (`inventory-documents.test.tsx`): list vocabulary,
  URL-owned filtering, capability-driven actions, mandatory cancellation reason,
  and the two-answer material-edit flow.

## 7. Known limitations

1. Receipt cost assignment is single-line only.
2. `accountingPostDocument` records the accounting boundary; it posts no journal
   entry (GL is out of scope).
3. Backdated transfers remain fail-closed pending OQ-67.
4. Correction/reversal after Accounting Post is an explicit future document;
   C-58 only forbids direct edit/delete at that point.
