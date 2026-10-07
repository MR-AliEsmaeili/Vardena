# C-60 — Inventory → Accounting Boundary & Decision Package

- **Type:** Decision & Architecture Package (audit, decision space, epic plan) — **documentation only**
- **Status:** **PROPOSED FOR PRODUCT OWNER REVIEW.** This package authorizes no implementation, no migration, no schema change, no API, no event consumer and no posting rule. It records evidence and asks for decisions.
- **Sprint:** C-60 — Inventory → Accounting Boundary & Decision Sprint
- **Baseline:** `main` @ `24474ac6b28f89e5799057370d86fb603bb89897` (merge of PR #128, 2026-10-07T17:00:50Z)
- **Working branch:** `arena/6f3fecd4-vardena`
- **Date:** 2026-10-07 (UTC)
- **Supersedes nothing.** The canonical product records ([PDR-05](../decisions/product/PDR-05-inventory-valuation-and-cost-optional-operations.md), [PDR-07](../decisions/product/PDR-07-inventory-pricing-sources-and-periodic-pricing-operation.md), [PDR-08](../decisions/product/PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md), [OQ-54](../decisions/product/OQ-54-finalized-document-deletion-editing.md), [C-58](../decisions/product/C-58-inventory-business-documents.md)) and the accepted contracts ([`docs/accounting/domain-contract.md`](../accounting/domain-contract.md), ADR-0005, ADR-0026, ADR-0017/ADR-0022) remain the decision authority. Where this package and a canonical record disagree, the canonical record wins.

> **Governing rule of this sprint: OPEN OQ = NO IMPLEMENTATION.**
> Every question this package could not answer from the repository is listed in §21 as a
> Product Owner decision and mapped to the OQ row it belongs to. Nothing in this
> document invents a business rule, a mapping, a default or a journal entry.

---

## 0. How to read this package

**Evidence labels** (the repository's own convention, `STATE.md` §1):

| Label | Meaning here |
|---|---|
| **verified (code)** | The statement was read out of the checked-out source in this audit, with the file named. |
| **recorded (doc)** | The statement comes from an existing repository document (contract, PDR, ADR, OQ row) and was not re-derived from code. |
| **UNKNOWN** | The repository does not answer it. |

**Three things this document never merges:**

1. **Inventory eligibility** (may this operational document ever produce an accounting document?) — a domain predicate, implemented.
2. **Accounting delivery** (does an accounting document exist, and what links to it?) — not implemented, not decided.
3. **Accounting correctness policy** (what happens when the value changes after posting?) — owned by open OQs.

**What "not implemented" means in this document.** A DTO field, an interface, a permission constant or a docblock is never counted as an implementation. A flow is "implemented" only where an application service composes real writes inside a transaction and a test exercises it.

---

## 1. Executive Summary

### 1.1 What the repository actually contains today

- **Inventory valuation is a complete, hardened runtime.** Receipt, issue, transfer (including
  coupled backdated transfer replay), purchase return, sales return, reversal, Moving Weighted
  Average, one-key recalculation, the scoped Periodic Pricing Operation, Reverse Pricing with a
  compensating run, stale-state honesty, negative-inventory hard block, idempotency, organization
  isolation and concurrency locks are all merged (C-59 slices, PRs #124–#128).
- **The Inventory "Accounting Post" command exists and is a status flag, not an accounting
  effect.** `InventoryBusinessDocumentsService.accountingPostDocument` verifies the domain
  eligibility gate, locks the document + valuation-state rows, and writes
  `status = 'accounting_posted'` with `accounting_posted_at/by`. It creates **no** accounting
  document, stores **no** accounting reference, and cannot tell whether an accounting document
  exists anywhere — because none can exist for it.
- **Accounting is a complete manual-voucher subsystem.** Chart of accounts, coding structures,
  configurations with an operational freeze, accounts, detail structures, accounting documents
  (draft → temporary → final), the `accounting_posting_operations` idempotency ledger, immutable
  ledger entries, the rebuildable balance projection, period-close enforcement inside the
  finalization transaction, and **reversal** (`Accounting.Document.Reverse`, a new final
  counter-document) are implemented and tested. 27 migrations, 21 `accounting` Prisma models.
- **Accounting has no mapping layer at all.** There is no `PostingRule`, `ControlRole` or
  `SystemPosting` model, no such permission code (49 `Accounting.*` codes are registered,
  none of them is a posting rule or a control role), and `PostingService`'s own docblock says it
  is "NOT a Posting Engine. There is no posting-rules engine, no automatic account mapping, no
  control-role resolution, no account selection". `docs/modules.md` states the same in the
  Accounting entry: "**Still absent:** posting rules/mapping, control roles".
- **The integration infrastructure cannot carry the integration yet.** The kernel
  `DomainEventBus` is an in-memory `Map` with no persistence, no retry, no ordering and no
  dedup; publishers on the Inventory business-document path emit **after** their transaction
  commits; the entire backend contains **one** event subscriber
  (`identity/application/session-revocation.consumer.ts`). There is no `core.domain_events`
  table, no `sync.outbox_events` table, no `jobs.job_runs` table, and the worker runs no
  dispatch loop. ADR-0005 (Accepted) describes transactional, persisted, in-unit-of-work
  dispatch; the code does not do that, and `docs/architecture.md` §8 already carries a
  dated "do not treat the rows below as available infrastructure" note.
- **The system-origin accounting entry point exists but has no caller and no HTTP surface.**
  `AccountingDocumentsService.createDocument` accepts `origin: 'system'` with
  `sourceModule/sourceEntityType/sourceEntityId/sourceOperation` evidence and writes it into
  the idempotency hash; the HTTP DTO deliberately refuses to accept a client claim of being a
  source module. `AccountingModule` exports the service precisely as the future posting seam
  and states "no such caller exists yet, because no production system posting is enabled
  before OQ-39."

### 1.2 The real gap

The gap is **not** "Inventory must emit an event Accounting consumes". It is four separable
gaps, in dependency order:

| # | Gap | Owner | Blocked by |
|---|---|---|---|
| G1 | **Posting policy**: which account (or control role) an inventory fact posts to, and whether postings are direct-final (Mode A) or reviewed (Mode B) | Accounting + accountant | OQ-25, OQ-30, OQ-42, OQ-24 |
| G2 | **Delivery + idempotency identity**: transactional or durable; what key prevents a double journal; what happens when a posting is refused | Architecture + Product Owner | OQ-39 (gate), and the identity decision in §8 |
| G3 | **Value immutability after posting**: today a valuation *can* change after Accounting Post (only Reverse Pricing is guarded); nothing decides what must happen then | Accountant + Owner | OQ-27, OQ-71, OQ-24 |
| G4 | **Truthful boundary state**: `accountingEligible` and `status = accounting_posted` currently mean "the inventory side says so", not "a journal exists" | Architecture | G1–G3 |

### 1.3 The two findings with the highest architectural consequence

1. **`accountingEligible = true` must never be read as "an accounting journal exists".**
   The predicate (`status === 'operational' && valuationState === 'priced' && !valuationStale`)
   is a *precondition* for a future posting, not evidence of one. Because the current
   `accountingPostDocument` command writes the boundary flag itself, a future implementation
   that treats the flag as the delivery acknowledgement would create an unverifiable state.
   §5.E of this package separates the two axes explicitly and §21 (PO-10) asks the Owner to
   ratify the separation as a standing rule.
2. **After Accounting Post, Inventory value is still mutable — except through Reverse
   Pricing.** Verified: `runPricing`, the one-key `recalculate`, the backdated-edit repricing
   path and `assignCost` contain **no** accounting-posted awareness; only
   `reversePricing` refuses, and it refuses by reading the *Inventory* document header's
   status, not an accounting document. So the sentence "its economic result is immutable and
   may only be changed by an explicit accounting correction" (thrown by `assertCancellable`)
   overstates today's guarantee. What must replace it is precisely the open decision in §8/§16.

### 1.4 Recommendation snapshot (each item is a Product Owner decision, §21)

| Topic | Recommendation | Why |
|---|---|---|
| Delivery mechanism | **Transactional in-process subscription** (ADR-0005's accepted shape) through Accounting's public application service, invoked inside the Inventory command's transaction; **not** the outbox | The Accounting Post command is already synchronous and user-invoked; "safe for the books" is achievable without adding a second state axis or dead-letter surface; the outbox stays for *external* destinations (ADR-0004) |
| Mapping ownership | Accounting-owned **control roles + posting rules** (contract §8.7/D-12, AC-D-34) | Source modules must not hardcode chart codes; the contract already forbids it (AR-16) |
| Idempotency identity | Accounting-side operation key `invdoc:<inventoryDocumentId>:accounting-post` **plus** a request hash over the exact movement money facts | Same key + same money replays; same key + different money must conflict (409), never silently replay |
| Post-post value change | **Block** forward valuation changes on facts whose document crossed the boundary, and require an explicit correction/reversal flow for anything else | Consistent with OD-RVP-03's fail-closed posture; the alternative (silent divergence between Inventory value and posted journals) is the one outcome the whole C-59 honesty model exists to prevent |
| Boundary state | Inventory document keeps its status flag; the **accounting document id becomes the delivery evidence** (stored as a logical reference + Documents relation) | Keeps `accounting_posted` verifiable and answers the two-way traceability requirement of contract §20.3 |

---

## 2. Current State

### 2.1 Baseline and method

| Item | Value |
|---|---|
| Repository | `MR-AliEsmaeili/Vardena` |
| Audited revision | `24474ac6b28f89e5799057370d86fb603bb89897` (`main`, merge of PR #128, 2026-10-07T17:00:50Z) |
| Working branch | `arena/6f3fecd4-vardena` |
| Migrations | **27** directories, latest `20261008000000_inventory_returns_and_pricing_runs` |
| Unit specs | **140** files (53 Accounting, 32 Inventory) |
| E2E specs | **48** files, including the live-PostgreSQL `*-live.e2e-spec.ts` suites |
| Merged C-59 lineage | #122 C-58 runtime → #123 pricing decision baseline → #124 C-59A receipt slice → #125 valuation-based accounting eligibility → #126 C-59D/E/E+ (returns, periodic pricing, reverse pricing, concurrency hardening) → #127 coupled backdated transfer replay → #128 `forceUnvalued` replay propagation |
| Open registry rows that matter here | OQ-24, OQ-25, OQ-27, OQ-30, OQ-39, OQ-42, OQ-69, OQ-70, OQ-71 (+ OQ-23, OQ-31, OQ-40, OQ-03, OQ-11, OQ-13, OQ-17, OQ-43 as secondary dependencies) |

**Local test policy.** Per the sprint's verification rules, this audit ran **no** test suite,
no migration, no live PostgreSQL, no E2E. Everything below is static inspection of the
checked-out source plus the repository's own documents. Heavy verification belongs to CI.

### 2.2 Inventory — what exists (verified in code)

| Capability | State | Evidence |
|---|---|---|
| Movement ledger as the single source of stock truth | **Implemented** | `inventory_movements` carries signed `base_quantity` **and** signed `total_cost`, `valuation_status`, `valuation_source`, `valued_at`, `valuation_run_id`, plus logical `reference_type`/`reference_id` (`backend/prisma/schema/inventory.prisma`) |
| Business documents (receipt, issue, transfer, purchase return, sales return) | **Implemented** | `inventory_business_documents` + lines, lifecycle `draft → operational → accounting_posted → immutable` (+`cancelled`), `INVENTORY_DOCUMENT_TRANSITIONS` in `backend/src/modules/inventory/domain/inventory-business-document.ts` |
| Receipt costing (optional manual cost) | **Implemented** | `receipt_cost` nullable on the header; `Valuation.AssignCost` permission; `resolveEnteredCost` |
| Issue valuation (derived, never typed) | **Implemented** | `inventory/application/inventory-valuation.service.ts` (`assignCost` refuses outbound movements) |
| Transfer valuation (source-valued; coupled backdated replay) | **Implemented** | `domain/transfer-replay.ts`, `data/inventory-transfer-replay.ts`, PR #127 |
| Purchase return (basis → original receipt cost; else current MWA) | **Implemented** | `domain/return-valuation.ts` (`purchaseReturnValueFromBasis`), `VALUATION_SOURCES` includes `return_basis` |
| Sales return (inventory cost; explicit amount requires a basis) | **Implemented** | Same service; `OD-RET-05…07` enforced in `normalizeHeader` |
| Reversal (mirrors the original's own value; `unvalued` stays `unvalued`) | **Implemented** | `VALUATION_SOURCES` includes `reversal`; OD-REV-01…06; OD-68 resolved |
| Moving Weighted Average (only method) | **Implemented** | `domain/moving-weighted-average.ts`, `domain/valuation-method.ts` |
| One-key bounded recalculation | **Implemented** | `POST /inventory/valuation/recalculations` → `recalculateKeyWithinBatch` |
| Periodic Pricing Operation (scoped batch, per-key outcomes) | **Implemented** | `application/inventory-pricing.service.ts` (1128 lines), `inventory_pricing_runs` + `inventory_pricing_run_key_outcomes` |
| Reverse Pricing (run-scoped, latest-only, compensating run) | **Implemented** | `reversePricing` in the same service; `reverses_run_id` unique; outcome `reversed` |
| Stale-state honesty (`stale` outranks `pending_cost`) | **Implemented** | `inventory_valuation_states.status`, sticky `stale_since`; `resolveValuationStatus` |
| Accounting eligibility predicate | **Implemented (predicate only)** | `isAccountingEligible` + `deriveDocumentValuationState` |
| **Accounting Post command** | **Implemented as a boundary flag** | `accountingPostDocument`: lock → re-derive → refuse if ineligible → write status/timestamps → publish event. **Creates no journal.** |
| Accounting reference on the Inventory document | **Missing** | No `accounting_document_id` (or equivalent) column on `inventory_business_documents` / lines |
| Post-boundary valuation freeze | **Missing except Reverse Pricing** | No accounting awareness in `runPricing`, `recalculate`, backdated repricing or `assignCost` |
| Valuation history beyond the current value (OQ-69) | **Partial — deliberately** | `inventory_valuation_runs` stores counts, trigger, actor and the *resulting* state; superseded per-movement amounts are not stored |

**Key vocabulary (verified, `inventory/domain/inventory-valuation.ts`):**
movement status `unvalued | provisional | valued`; value source
`entered | average_cost | transfer | reversal | return_basis`; unvalued reason
`no_cost_supplied | uncosted_stock | insufficient_valued_quantity` (derived, never stored);
key status `valued | pending_cost | stale`; run trigger
`backdated_document | cost_assignment | manual | pricing_operation | reverse_pricing`;
pricing run kind `pricing_operation | reverse_pricing`; per-key outcome
`priced | failed | reversed`.

**Document-level valuation state (verified, `deriveDocumentValuationState`):**
`unpriced` (all facts unvalued / no facts) · `partially_priced` (any `provisional`, or a mix) ·
`priced` (all facts `valued`). `provisional` is deliberately **not** accounting-complete.

**Eligibility (verified):**

```
accountingEligible = status === 'operational'
                  && valuationState === 'priced'
                  && valuationStale === false
```

Note what is **not** in the predicate: any permission, any accounting document, any accounting
configuration, any fiscal period, any mapping. That is correct — it is a *domain* predicate —
and it is exactly why §5.E requires that the two axes never be merged.

### 2.3 Accounting — what exists (verified in code)

| Capability | State | Evidence |
|---|---|---|
| Financial areas, fiscal years, accounting periods | **Implemented** | 21 models in `backend/prisma/schema/accounting.prisma`; `AccountingPeriod` lifecycle `open/closed/sealed`, several periods of a year may be open |
| Coding structures + chart of accounts + account Nature/Type + details | **Implemented** | `accounting_*` models; 49 registered `Accounting.*` permission codes |
| Accounting configurations (DRAFT/ACTIVE/SUPERSEDED, operational freeze) | **Implemented** | `accounting_configurations`, `isConfigurationUsedOperationally` |
| Accounting documents (draft → temporary → final) | **Implemented** | `accounting_documents` + lines; domain `planVoucherCreate/Edit/Issue/Delete` |
| Posting = finalization (single locked transaction) | **Implemented** | `AccountingDocumentsRepository.finalizeChecked`, `domain/posting.ts` AC-D-23 |
| Ledger entries (immutable, 1:1 per line) | **Implemented** | `accounting_ledger_entries` |
| Balance projection (turnover-only, rebuildable) | **Implemented** | `account_balance_projections` + `Accounting.Balance.{View,Rebuild}` |
| Idempotency ledger | **Implemented** | `accounting_posting_operations`, unique `(organization_id, operation_key)` + `request_hash` |
| Source evidence on a voucher | **Implemented (unused)** | `origin`, `source_module/entity_type/entity_id/operation`, `idempotency_reference`, `request_hash`; `sourceModule/EntityType/EntityId` are **indexed** so the backward query of contract §20.3 is cheap |
| System-origin composition | **Implemented at the service, unreachable from HTTP** | `createDocument` accepts `origin: 'system'` + source; the DTO refuses it by design |
| Reversal | **Implemented** | `POST /accounting-documents/:id/reverse`, `Accounting.Document.Reverse`, `domain/document-reversal.ts`, new final counter-document, original untouched but for `reversed_by`, **must resolve to an OPEN period** |
| Correction kinds beyond reversal | **Missing** | `ACCOUNTING_CORRECTION_KINDS = ['reversal']` |
| Posting rules / control roles / account auto-mapping | **Missing** | No model, no permission code, no service; `PostingService` docblock and `docs/modules.md` say so |
| Durable system-posting delivery, retry, dead-letter | **Missing** | `docs/architecture.md` §8 dated status note |
| Worker dispatch loop | **Missing** | `worker.service.ts`: "Actual dispatch loops (outbox, jobs) arrive with the Sync and Jobs modules"; logs the handler registry only |
| `core.domain_events` / `sync.outbox_events` / `jobs.job_runs` tables | **Missing** | `base.prisma` datasource `schemas` list has no `core`; no migration mentions those tables |
| Permission codes for the missing pieces | **Deliberately absent** | 49 registered codes; no `Accounting.PostingRule.*`, `Accounting.ControlRole.*`, `Accounting.SystemPosting.*` |

### 2.4 Integration infrastructure — what exists (verified in code)

| Aspect | Reality | Evidence |
|---|---|---|
| Bus | In-memory `Map<string, Set<handler>>`, synchronous `await` per handler | `backend/src/kernel/events/domain-event-bus.ts` |
| Handler failure | **Swallowed** (`catch {}`) — a subscriber cannot fail a publisher, and a failure leaves no trace | Same file |
| Persistence | None. The docblock says events "are also appended to `core.domain_events`"; that table does not exist | Same file vs `base.prisma` |
| Publish timing (Inventory documents) | **After** the transaction commits | `inventory/domain/inventory-document.events.ts` ("Published on the existing in-process bus AFTER the transaction commits") |
| Payload policy | Identifiers + routing + status; **no quantities, no money** | Same file; `accounting.events.ts` ("NO amounts") |
| Subscribers | **Exactly one in the repository** | `identity/application/session-revocation.consumer.ts` (`User.Disabled`, `User.PasswordReset`) |
| Accounting events | Catalog exists (`AccountingDocument.{Created,Updated,Finalized,Deleted,Reversed}`, calendar events, `AccountBalance.Rebuilt`) and is published post-commit | `accounting/domain/accounting.events.ts` |
| Jobs | `JobsRegistry` (a handler-name map) exists; no queue table, no dispatcher, no registered handler | `kernel/jobs/jobs.registry.ts`, `worker.service.ts` |
| Cross-module calls | Accounting **exports** `AccountingDocumentsService` for a future source module; no module imports it. Inventory imports only Rbac/Organization/Documents/Identity | `accounting.module.ts` exports block; `inventory.module.ts` |

**Conclusion for §7.** The existing mechanism is a *notification seam*, not a delivery
mechanism. Any design that assumes it carries a durable or atomic accounting effect is
contradicted by the code. This is not a defect — `docs/architecture.md` §8 already records it,
and ADR-0026 §6 turns it into a gate: *"no production system-generated posting may be enabled
before OQ-39 is resolved."*

### 2.5 Documented intent vs implemented reality

| Document | Says | Reality (verified) |
|---|---|---|
| ADR-0005 (Accepted) | Domain events dispatched **synchronously in the publisher's unit of work**, **persisted to `core.domain_events` in the same transaction**; a posting failure fails the receipt | Not implemented: publish is post-commit, nothing is persisted, failures cannot fail the publisher |
| `docs/architecture.md` §5 | "synchronous in-process dispatch in v1, persisted in `core.domain_events`" | Superseded by the §8 dated status note in the same file; no `core` schema exists |
| `docs/architecture.md` §8 | Target model table **plus** a status note: no core schema, no outbox, no job_runs, no dispatch loop, no cross-module subscriber | **Matches the code** |
| Contract §16.6 / AC-D-26 | Two delivery shapes are available; the choice is OQ-39; nothing may be enabled before it is resolved | Matches; no system posting exists |
| Contract §20.4 | Activation gate: OQ-24 + accountant-reviewed posting rules + OQ-39 | Matches; none of the three is satisfied |
| ADR-0026 §6 | Delivery semantics stay open and are a gate | Matches |
| `docs/modules.md` Accounting | "Still absent: posting rules/mapping, control roles" | Matches |
| PDR-08 §8 | OD-PRC-11 (the eligibility gate) assigned to slice C-59F, "the accounting-eligibility gate that `accountingPostDocument` does not yet enforce" | **Stale row**: PR #125 implemented the gate; `accountingPostDocument` now refuses with `inventory.document.accounting_ineligible`. The record should be read as historical |

The one **documentation defect** this audit found is therefore a stale row in PDR-08 §8, not a
code defect. It is recorded here rather than edited into the canonical product record, because
changing a decision record is the Owner's act.

---
## 3. Inventory → Accounting Gap Matrix

**Status legend**

| Code | Meaning |
|---|---|
| **IMPL** | Implemented: real writes composed in a transaction, exercised by tests |
| **PART** | Partially implemented: a piece exists, the composition does not |
| **ARCH** | Architecture only: decided in a contract/ADR, no code |
| **CONTRACT** | Contract only: an interface/field/DTO exists with no producer or consumer |
| **MISSING** | Nothing exists |
| **BLOCKED** | Deliberately deferred behind an open OQ; implementing it now would invent a rule |

### 3.1 The required matrix

| Inventory Flow | Inventory Runtime | Valuation | Accounting Eligibility | Accounting Consumer | Accounting Journal | Current Gap |
|---|---|---|---|---|---|---|
| **Receipt** | **IMPL** — document + movement + balance, `receipt_cost` optional | **IMPL** — manual cost, MWA, stale honesty | **IMPL** — `operational && priced && !stale` | **MISSING** — no consumer, no caller | **MISSING** | G1 mapping (debit inventory / credit **what?**), G2 delivery, and the "receipt was unpriced when posted, priced later" route — the journal's *date* and *single-vs-two-journal* shape are undecided |
| **Issue** | **IMPL** | **IMPL** — value derived by MWA, never typed | **IMPL** | **MISSING** | **MISSING** | G1 COGS/inventory-expense account mapping (OQ-24/OQ-25); whether COGS is recognized per issue or by a periodic roll-up (OQ-11 "cost accounting method"; Rahkaran evidence S4 posts aggregated over ranges) |
| **Transfer** | **IMPL** — two atomic legs, coupled replay | **IMPL** — source-valued; destination inherits (OD-TRF-01) | **IMPL** — per-leg movements aggregated to document lines | **MISSING** | **MISSING** | **Whether a transfer produces a journal at all is undecided**: within one legal entity it is a location move (net zero at organization level), but branch-as-cost-centre (OQ-55), inter-branch settlement (OQ-31) and financial-area scoping (OQ-40) can require two lines or none |
| **Purchase Return** | **IMPL** — basis link optional | **IMPL** — basis cost or current MWA; cold start fails closed | **IMPL** | **MISSING** | **MISSING** | G1: the payable/supplier side needs a Party/Factor counterparty account (Factor domain does not exist); **OQ-70** owns the settlement-variance account; no agreed-amount field is accepted today, so the variance cannot even be recorded yet |
| **Sales Return** | **IMPL** — basis link optional, explicit amount requires basis | **IMPL** — re-enters at inventory cost, never at sales price | **IMPL** | **MISSING** | **MISSING** | G1: the revenue/receivable and COGS-reversal sides need the **Sales** module's invoice (OQ-15/OQ-16 territory); inventory-side value is complete, the accounting counterparty is not |
| **Reversal** | **IMPL** — movement reversal mirrors the original's own value; document cancel reverses its own facts in one transaction | **IMPL** | **PART** — *document* reversal is eligible while the document is `operational`; **direct ledger reversals have no document at all** | **MISSING** | **MISSING** | Two separate gaps: (a) post-boundary correction is refused on the Inventory side with `inventory.document.accounting_posted_requires_correction` and has **no** implemented counterpart (OQ-27/OQ-71); (b) the ledger writers that are not business documents (direct movements, direct transfers, material-request invocation) have no accounting path at all — see §3.2 |
| **Periodic Pricing** | **IMPL** — scoped batch, per-key outcomes | **IMPL** — replays each key; preserves manual/derived values | **PART** — a run can make a document **ineligible** (stale) or change the value a future journal would carry; it must never *create* a journal (OD-PDP-05) | **MISSING** | **N/A by decision** (OD-PDP-05: "Pricing never … posts accounting") | The undecided part is the **after-post** interaction: nothing stops a run from changing values that a posted journal was (or would be) based on — §16 |
| **Reverse Pricing** | **IMPL** — run-scoped, latest-only, compensating run, quantity untouched | **IMPL** | **IMPL (Inventory-side guard)** — refuses while any affected document is `accounting_posted`/`immutable`, and names the blockers (`inventory.pricing.reverse_accounting_posted`) | **MISSING** | **MISSING** | **OQ-71's counterpart**: the guard asks for "an explicit accounting correction (OQ-27)", which does not exist. The guard also tests the **Inventory flag**, not an accounting document — correct today, insufficient later |
| **Backdated Recalculation** | **IMPL** — coupled replay, stale marking, `forceUnvalued` propagation | **IMPL** | **PART** — a backdated fact marks the key `stale`, which makes affected documents ineligible | **MISSING** | **MISSING** | After the boundary, a backdated repricing can still rewrite the value of facts behind an accounting-posted document (verified: no guard in `recalculate`/`runPricing`); no compensating-journal policy exists (OQ-24/OQ-27) |

### 3.2 The matrix's hidden row: ledger writers that are not business documents

The C-58/C-59 boundary is defined on **business documents**. The ledger has other writers, and
none of them is in the matrix above because none of them has a document to attach accounting
eligibility to (verified in `backend/src/modules/inventory/application/`):

| Writer | Creates | Accounting eligibility today | Consequence |
|---|---|---|---|
| `InventoryMovementsService` (direct `POST /inventory/movements`) | raw movement row | none (no document) | An accounting integration keyed only on business documents would silently skip these facts |
| `InventoryTransfersService` (direct `POST /inventory/transfers`) | two transfer legs | none | Same |
| `MaterialRequestsService.invoke` | movements consuming reservations | none (Material Request is not an accounting-aware document type) | Same |
| `InventoryBusinessDocumentsService` (finalize/edit/cancel/accountingPost) | movements + boundary flag | the only path that has one | This is the designed posting subject today |

**Decision required (§21, PO-03):** is the accounting boundary defined on *business documents*
only (with the other writers explicitly out of scope until their own documents exist), or on
*ledger facts* (in which case every writer needs a subject and the direct-movement endpoints
need a decided accounting meaning, or must be restricted)? Both are defensible; choosing by
omission is not.

### 3.3 What is *not* missing

For completeness, these are **not** gaps and must not be "fixed" by this or a later sprint:

- Moving Weighted Average is the only method (OD-VAL-02/18) — FIFO/LIFO are explicitly out.
- Money is `numeric(18,2)`; precision/currency are OQ-03/OQ-11 and are deliberately unchanged (PDR-07 §6).
- There is no second inventory ledger and there must not be one (OD-DOC-01).
- Landed cost, lot/serial valuation, multi-currency valuation and negative stock are out of scope by decision.
- Accounting reuses the Document Foundation for numbering (AC-D-29) — no Accounting-side counter exists or is wanted.

---

## 4. OQ Dependency Matrix

Every row below was read from `docs/open-questions.md` at the audited revision. "Blocks" = a
decision that cannot be made (let alone implemented) without it. "Does not block" = explicitly
outside the row's scope, so work may proceed.

### 4.1 Primary rows (the C-60 core)

| OQ | Status | What it blocks | What it does **not** block | Owner | Epics |
|---|---|---|---|---|---|
| **OQ-24** — Inventory valuation and stock policy | **OPEN** (OD-VAL-01…19 partially resolved) | COGS/journal posting of inventory value; landed cost; purchase-price variance; valuation precision/currency; write-down/NRV | Receipt/issue/transfer/return **valuation** (decided and implemented); the eligibility predicate; pricing runs | Accountant + inventory expert | C-61, C-63, C-64 |
| **OQ-69** — Per-movement valuation history | **OPEN** (OD-VH-01 fixed the architecture: ledger authority + immutable history) | The *sufficiency* question: is the current run record enough for an auditor, or is an append-only per-movement history table required? | Anything already built: history is **additive** and does not change the ledger; reconciliation and audit work may start on today's evidence | Accountant + auditor | C-66 |
| **OQ-70** — Return costing | **OPEN for the Accounting side only** (costing decided: OD-RET-01…07) | The **variance account mapping** of a settlement difference (OD-RET-04); the Factor domain's agreed-amount capture | Purchase/sales return **valuation**, which is implemented; nothing else | Accountant + inventory expert | C-64 |
| **OQ-71** — Reverse Pricing constraints | **OPEN for the Accounting side only** (inventory constraints decided: OD-RVP-01…08) | The compliant accounting-side reversal/deletion flow that must exist before a user can satisfy `reverse_accounting_posted`'s precondition | Reverse Pricing itself (implemented, fails closed) | Accountant + inventory expert | C-65 |
| **OQ-39** — Durable integration semantics | **OPEN** | **Any production system-generated posting** (contract AC-D-26, ADR-0026 §6); retry/dead-letter design; rejection semantics for a source document | Manual accounting documents; every Inventory flow; the *interface* design (AC-D-26 makes the interface delivery-agnostic) | Architecture + product | **C-62 gates C-63…C-65** |
| **OQ-42** — System-generated posting policy | **OPEN** | Mode A vs Mode B default; who finalizes; self-approval; rejection meaning; backlog governance | The mechanism (AC-D-28: configuration over Foundation entry states + Workflow approvals) | Product + accountant + auditor | C-61, C-62 |
| **OQ-25** — Chart of accounts / control roles | **OPEN** (mechanism decided; role **catalog** open) | Which control roles are mandatory and what each role means; therefore every posting rule's content | The account model itself (implemented) | Accountant | C-61 |
| **OQ-30** — Tax model | **OPEN** | Tax accounts/rates if a receipt or return involves tax; tax lines in mapped journals | Inventory valuation (tax is not inventory cost) | Tax expert + accountant | C-61, C-64 |
| **OQ-27** — Correction policy | **OPEN** | Post-posting correction windows; whether a reversal may cross a closed period; what must never be corrected; statutory reporting of corrections | Document-level **reversal** of a final voucher (implemented, open-period-only) | Accountant + legal/tax | C-65 |
| **OQ-31** — Inter-branch / inter-company treatment | **OPEN** (interim: transfers are inventory-only within one legal entity) | Whether a transfer ever produces accounting entries or settlement documents | Transfer **valuation** (implemented) | Product + accountant | C-64 |
| **OQ-72 (NEW — opened by this audit)** — Authorization of system-origin postings | **OPEN** | Which authority authorizes the creation of a `system`-origin accounting document: the source module's permission alone, an Accounting code, or both; today `Accounting.Document.Create` is required for manual composition and is the only create authority that exists | Nothing; the OQ exists so no future implementation picks an authority by accident | Product + architecture | C-61, C-62 |

### 4.2 Secondary dependencies (checked because they touch the same surfaces)

| OQ | Why it matters here | Effect |
|---|---|---|
| **OQ-23** — Fiscal calendar | A system posting's business date resolves a year/period; a closed period refuses finalization (verified, `assertOpenScope`, repository line ≈1082) | Does **not** block design; decides the "period closed at delivery time" semantics (§9 #10) |
| **OQ-40** — Financial areas (n ≥ 1) | Contract §16.7 resolves an area fail-closed: explicit → only area → default area → **fail** | Does not block; decides which area a system posting lands in when an organization has several |
| **OQ-03 / OQ-11** — Money precision/currency & ledger policy | Money remains `numeric(18,2)`; the balancing invariant is single-currency | Does not block the boundary work; a currency change would be a cross-module migration |
| **OQ-13 / OQ-26** — Approvals, maker-checker | Mode B (AC-D-28) is expressed with the Workflow Foundation; self-approval policy is OQ-26 | Does not block the boundary; blocks the *default mode* |
| **OQ-43** — Iranian statutory requirements | Immutability, chronological journal, no deletion from electronic books | Does not block; constrains the correction model (C-65) |
| **OQ-55 / OQ-56** — Branch as cost centre; two-book accounting | May add dimension/branch requirements to every journal line | Does not block; if decided later, additive to the posting payload (the `dimensionAssignments` seam exists in the contract, OQ-41 deferred) |
| **OQ-17** — Retention/archival | Event-log retention if a durable log is added | Does not block |
| **OQ-21** — No wildcards | Constrains any new permission design: no `Accounting.*` superuser | Does not block |
| **OQ-14** — Role baselines | Who gets `Inventory.Document.AccountingPost` / `Accounting.Document.*` in practice | Does not block the technical boundary |

### 4.3 Reading the matrix

- **The single hard gate is OQ-39.** Even with every mapping decided, AC-D-26/ADR-0026 §6 forbid
  enabling production system posting before the delivery semantics are chosen.
- **Only two rows block *design* work** (as opposed to activation): OQ-25's role catalog
  (posting rules cannot be written without roles) and OQ-72 (the authority model).
- **OQ-69, OQ-70 and OQ-71 do not block the boundary work**; each blocks a specific downstream
  slice, and each is already scoped in PDR-07/PDR-08.

---
## 5. The Accounting Boundary

### 5.A Who owns the inventory value — and how Accounting consumes it

**Inventory remains authoritative.** This is not a new decision; it is the standing
architecture: ADR-0017/ADR-0022 (the movement ledger is the truth), PDR-07 `OD-DOC-01/02`
(the document layer is orchestration, never a second ledger), PDR-07 `OD-VH-01` (ledger
authority + immutable valuation history), and contract §20.1 (`Inventory owns stock facts`).

What must be decided is the *shape* in which Accounting receives that value. Three shapes exist
in the repository's own vocabulary (contract §16.3, "contract A" vs "contract B"):

| Shape | What Inventory sends | What Accounting owns | Verdict |
|---|---|---|---|
| **A1 — Accounting reads Inventory at posting time** | an event carrying only ids | the money, read through Inventory's public service | **Rejected**: it makes Accounting depend on Inventory's availability inside the books' transaction, and AC-I-13/AR-07 forbid Accounting reading `inventory.*` |
| **A2 — Facts + Accounting-owned rule** (contract's *preferred* form) | business facts **including the valuation amounts it owns** (movement ids, quantities, signed total costs, valuation source, business date) + source identity | which accounts/control roles those facts map to, the posting mode, the period, the area, the voucher | **Recommended** |
| **A3 — Fully composed payload** (contract B) | accounts + debit/credit lines | validation only | Allowed by the contract "only where a rule cannot express the mapping"; hardcodes chart codes in Inventory — refusal recommended for V1 |

The distinction that must not blur: **the amount is a fact (Inventory's) and the account is a
policy (Accounting's).** A2 keeps them with their owners. It also means the money in the journal
is exactly the money in the ledger, with no second computation — which is what makes the
`SUM(movement total_cost)` invariant reconcilable (§17).

### 5.B Who creates the accounting journal — the five candidate architectures

| Option | Shape | Repository support | Atomic with the Inventory write | Verdict |
|---|---|---|---|---|
| **B1** | Inventory writes `accounting.*` directly | **Forbidden** — AC-I-13, AR-07/AR-16, ADR-0026 §5 | yes (by cheating) | **Rejected outright** |
| **B2** | Inventory publishes a domain event; a post-commit, in-memory Accounting subscriber creates the voucher | Partially: bus exists; it is post-commit and non-durable; the only subscriber in the repo is Identity's | **no** — a crash between commit and dispatch loses the effect (ADR-0024 §9 gap, restated in `architecture.md` §8) | **Rejected for the books** — it can only ever be a notification |
| **B3** | **Transactional subscription**: Inventory publishes the integration event **inside** its transaction; Accounting's subscriber performs the posting in the same unit of work (ADR-0005's accepted shape) | The *events* exist; the bus must be tightened (propagate handler errors; publish pre-commit) — a kernel change, ADR-0005-aligned, no new concept | **yes** | **Recommended** |
| **B4** | An application-level orchestration service (Inventory → orchestrator → Accounting) | None exists; a new module needs its own ADR (AR-01/AR-07); it would duplicate the event contract | yes | **Rejected as a V1 step** — it adds a module to solve a problem the event seam already expresses |
| **B5** | Durable outbox: Inventory writes an outbox row in-transaction; a worker posts later | AR-14/ADR-0004 describe the pattern for **external** destinations; the table does not exist, the worker has no dispatch loop | **no** (eventual) | **Viable but not recommended as the first step** — see §7 |

**One clarification that matters.** B3 is *not* "Inventory imports Accounting". AR-07 says a
side effect in another module goes through a domain event; the shipping mechanism is the
kernel bus and an Accounting-registered subscriber. Inventory would carry an event vocabulary
and a payload schema — never an Accounting import, never an `accounting.*` write, never a
posting rule. This is exactly what ADR-0005 already accepted, and it is the only option that
needs **no new architecture**, only the closure of the gap between ADR-0005's written semantics
and the current bus's behavior.

**Whose command is it?** The posting is triggered by the **Inventory** command
(`POST /inventory/business-documents/:id/accounting-post`) because the Inventory lifecycle owns
the boundary (OD-54-01). Accounting owns everything after that: mapping, mode, voucher,
idempotency ledger, period resolution, ledger entries. Accounting must never *call back* into
Inventory (ADR-0005: "Accounting never calls Inventory").

### 5.C Transaction boundary

If B3 is chosen (recommended), **one database transaction** contains:

1. the inventory document's status write (`operational → accounting_posted`) and its stamps;
2. the exact valuation facts the journal will carry, read **after** the valuation-state locks;
3. the accounting voucher + lines (or the Mode-B temporary document);
4. the ledger entries (Mode A) or the temporary state (Mode B);
5. the `accounting_posting_operations` row (the idempotency evidence);
6. the balance-projection update;
7. the link between the two aggregates (accounting document id stored as a logical reference on
   the Inventory side and/or a `documents.document_relations` row — §5.B/§11);
8. the domain event(s) — **inside** the transaction if a durable log is wanted, otherwise after
   commit for pure notification.

**What must never be partially committed** (in any option):

| Forbidden state | Why |
|---|---|
| Voucher without its lines / ledger entries | Contract §15.5: finalization is one transaction; a final voucher with missing entries would break the trial balance |
| Ledger entries without the final voucher | Same |
| `accounting_posted` on the Inventory document with no accounting effect and no delivery record | It would make the boundary flag a lie — the exact failure this package warns about (§5.E) |
| A journal whose source document is not (yet) accounting-posted | The reverse lie: the books would show an effect the operation disowns |
| Two vouchers for one posting intent | Duplicate delivery; prevented by the idempotency identity (§8) |

**If Inventory succeeds but Accounting fails.** Under B3 the two are one transaction, so there is
no such state: the command fails, the document stays `operational`, nothing is written, and the
caller sees a named reason (ineligible / period closed / mapping missing / account not postable).
This is the "safe for the books" property ADR-0005 asks for. Under B5 the state exists and must
be *named*: an accounting-delivery state on the Inventory side
(`pending / delivered / failed / blocked`), a retry surface, and an exception queue — all of which
are new concepts the current model does not have.

**If Accounting succeeds but acknowledgement fails.** Under B3 there is no separate
acknowledgement: the commit is the acknowledgement. A transport-level failure after commit is
retried by the client with the *same* `operationKey`; both the Inventory side
(`accountingPostDocument` already returns the DTO when the boundary is already crossed) and the
Accounting side (`replayOrReject` on `accounting_posting_operations`) replay instead of
duplicating. Under B5 the consumer must be idempotent on the same key, which is exactly what
`accounting_posting_operations` already provides.

**Retries.** The retry rule is already implemented on both sides and must simply be respected:
same key + same canonical intent ⇒ replay the stored result; same key + different intent ⇒
**409, nothing applied**. The subtlety is that "intent" for a system posting includes the
*money* (§8).

**Cross-module lock ordering — a new obligation.** Today each module has its own fixed lock
order: Inventory locks valuation-state rows in ascending `(warehouse, item)` order
(`inventory-locks.ts`), Accounting locks `area → year → period → accounts (FOR SHARE) →
document (FOR UPDATE)` (`accounting-locks.ts`). A single transaction that takes **both** sets
introduces a cross-module ordering that no document currently specifies. C-62 must define one
(and test it) or a deadlock becomes a production incident. This is the single most concrete
technical debt the recommended option creates.

### 5.D Idempotency identity — see §8 for the options and recommendation

The short version: the identity must be stable across retries **and** sensitive to the money,
because Inventory value is explicitly mutable before the boundary. A pure
"source document + operation" key cannot express that.

### 5.E `accountingEligible` and the two axes that must never be merged

This is the semantic rule the whole boundary rests on, stated once, explicitly, because the
codebase already *looks* as if the two axes were one.

**Axis 1 — domain eligibility (Inventory-owned, implemented).**

```
accountingEligible = status === 'operational'
                  && valuationState === 'priced'
                  && valuationStale === false
```

It answers exactly one question: *may this operational document ever become the subject of an
accounting posting?* It is a **precondition**, computed from the document's own facts and the
movements' `valuation_status`. It is not a promise: it knows nothing about accounting
configuration, mappings, modes, areas, periods, permissions or the existence of any accounting
document, and it must never be extended to pretend otherwise.

**Axis 2 — accounting delivery / posting (Accounting-owned, not implemented).**

It answers: *does an accounting document exist for this inventory document, which one is it,
what state is it in, and what links the two?* Under the recommended architecture (B3) this axis
gains a single verifiable artefact: the accounting document id (plus the `documents`
relation), written in the same transaction as the Inventory status flip. Under a durable
option (O4/B5) this axis additionally carries a delivery state
(`pending / delivered / failed / blocked`) and an exception surface — a new concept, not
present today.

**The rule.** The two axes are stored adjacently but must never be inferred from one another:

| Forbidden inference | Why it is false |
|---|---|
| `accountingEligible = true` ⇒ a journal exists | Eligibility is computed before any posting exists; today's `accounting_posted` flag has no journal behind it |
| `accountingEligible = true` ⇒ a journal will certainly be produced | Mapping, mode, area, period, permission and configuration may all refuse; eligibility is necessary, not sufficient |
| `status = accounting_posted` ⇒ the value is frozen and final | Verified false today: only Reverse Pricing guards; the other four valuation writers can still change the facts (F7) |
| A valuation change ⇒ "just re-post" | Posting is once-only by identity (§8); a change after the boundary is a correction event (OQ-27/71), not a retry |

**The vocabulary consequence.** The two axes must remain separately named in every DTO, API
error and UI surface: `accountingEligible`/`valuationState`/`valuationStale` stay the *domain*
axis; a future `accountingReference` (and, only under a durable option, `accountingState`) is
the *delivery* axis. No single field may be overloaded to mean both, and no client may compute
one from the other. §21 (PO-10) asks the Owner to ratify this as a standing rule, because the
opposite shortcut — treating the existing flag as the delivery acknowledgement — is exactly the
unverifiable state the current implementation would produce if C-61+ were built carelessly.

---

## 6. Transaction Boundary — the four questions answered

| Question | Answer under the recommended architecture | Answer under the durable-outbox alternative |
|---|---|---|
| What must be atomic? | The Inventory boundary flag, the valuation facts read under lock, the voucher + lines, the ledger entries, the posting-operation row, the projection update, the cross-reference | The Inventory write + the outbox row (not the voucher) |
| What may be eventually consistent? | Notifications, alerts, external integrations (outbox), reporting/reconciliation projections | The whole accounting effect |
| What must never be partially committed? | See §5.C's forbidden-state table | A source document claiming "posted" without a terminal delivery state; a voucher created twice |
| Inventory succeeds, Accounting fails | Impossible: one transaction ⇒ the command fails and nothing changes | A `failed`/`pending` delivery row and a retry surface; the source document must expose the state |
| Accounting succeeds, ack fails | The commit *is* the ack; retry replays via the operation key | At-least-once delivery; the consumer must be idempotent |
| Retries | Same key + same canonical intent ⇒ replay; different intent ⇒ 409 | Same |
| Duplicate prevention | `accounting_posting_operations` unique `(organization_id, operation_key)` + the Inventory `inventory_operations` key + the document's own terminal status | Same, plus the outbox `dedup_key` |

**Failure surface ownership.** Contract §16.6 keeps an open policy question (`OQ-39`): what
happens to a source document whose posting is *refused* (period closed, mapping missing,
account disabled). The three possible answers — block the source operation (recommended under
B3, and the only one that keeps the books and the operation coherent), leave the document
posted with an accounting exception queue, or fall back to a manual draft — are all legitimate;
the Owner must pick one, because each implies a different UX and a different failure semantics
table (§9).

---

## 7. Event / Integration Architecture Options

### 7.1 What the repository supports *today* (verified)

| Capability | Available? |
|---|---|
| In-process publish/subscribe with typed event names | **Yes** |
| Publish inside a transaction with commit/rollback coupling | **No** — the bus has no transaction awareness; Inventory publishes after commit by convention, and Setting aside the docs, the bus's `catch {}` means a subscriber **cannot** fail a publisher |
| Event persistence / replay | **No** — no `core.domain_events` table or schema exists |
| Retry / backoff / dead-letter | **No** |
| Consumer registration for cross-module side effects | **No** — exactly one subscriber exists in the whole backend (Identity's session revocation) |
| Outbox write + worker dispatch | **No** — `sync.outbox_events` and `jobs.job_runs` do not exist; the worker logs its (empty) handler registry and exits its bootstrap |
| Idempotent consumer infrastructure | **Yes, accounting-side** — `accounting_posting_operations` is exactly this |
| Cross-module application service call | **Available and exported** — `AccountingDocumentsService` is exported by `AccountingModule` for this purpose |

### 7.2 The options

| # | Option | Pros | Cons | Repository fit |
|---|---|---|---|---|
| **O1** | **Status quo / manual bridge**: Accounting Post marks the document; an accountant composes the voucher manually, using the Inventory document number as the reference | Works today with zero new infrastructure; no OQ-39 dependency; nothing to invent | Not an integration; the value is re-keyed by hand; no reconciliation guarantee; contradicts AC-D-27's chain when accounting is enabled | Current code |
| **O2** | **Post-commit in-memory event + subscriber** | Smallest diff; uses the existing vocabulary | The effect can be lost on crash; a posting failure cannot fail the source; violates AC-I-12's spirit and the "safe for the books" rule | Bus exists, guarantees do not |
| **O3** | **Transactional in-process subscription** (ADR-0005's accepted shape) | Atomic; no new state axis; the Inventory boundary flag becomes true by construction; no worker/queue to operate; matches the already-synchronous Accounting Post command | Needs the kernel bus to propagate handler errors and permit in-transaction dispatch; creates a cross-module lock order (§5.C); a slow/broken Accounting blocks a warehouse operation (by design) | Events + exported application service exist; kernel change is small and ADR-aligned |
| **O4** | **Durable outbox + worker** (AR-14/ADR-0004 mechanics) | Warehouse never blocked by accounting; retry/dead-letter; needed anyway for external integrations | The books lag the operation; a new delivery-state axis appears on the Inventory document; duplicate-suppression and ordering must be engineered; the tables and dispatcher do not exist; a period-closed rejection must be resolved asynchronously — the exact question OQ-39 leaves open | Pattern accepted for **external** destinations; internal use is new |
| **O5** | **Hybrid**: O3 for the explicit Accounting Post command; O4 (outbox) for external systems (taxpayer, legacy ERP) and for future autonomous posting | Each mechanism used where it is strong | Requires the boundary to state that internal posting is synchronous | Best fit for the accepted ADRs |

### 7.3 Recommendation

**Adopt O3 for the Inventory → Accounting boundary, with O5's division of labour: the outbox
stays an external-integration mechanism.**

Reasons, in the repository's own terms:

1. `ADR-0005` is **Accepted** and already specifies exactly O3's semantics ("dispatched
   synchronously in-process within the publisher's unit of work", "the accounting effect commits
   or rolls back **with** the inventory write", "a posting failure fails the receipt — safe for
   the books"). O3 closes the gap between that accepted decision and the current bus instead of
   introducing a second, contradicting mechanism.
2. `ADR-0004`'s outbox is scoped to **external synchronization** ("without making core
   transactions dependent on their availability"). Using it internally would import external
   semantics (lag, at-least-once, dead-letter) into an internal invariant.
3. The Accounting Post command is **already synchronous, explicit and user-invoked**; it is not
   an autonomous background effect. Making it atomic changes one command's failure semantics,
   not the warehouse's behavior — and the warehouse is never blocked by *valuation* (OD-PRC-10),
   only by the accountant's explicit act of posting.
4. The alternative's cost is not only infrastructure: O4 forces a new state axis on the
   Inventory document and a policy for "refused near period close", which is precisely the
   question OQ-39 is still open on. O3's failure is immediate, named, and already has a refusal
   vocabulary.

**What O3 requires before it can ship** (all in C-61/C-62, none of it invented here):

- a bus/dispatch path that (a) propagates handler failures, (b) can run inside a caller-owned
  transaction, and (c) distinguishes *notification* events (today's post-commit Inventory events)
  from *integration* events (the posting request) — mixing them would silently change the
  failure semantics of every existing publisher;
- a decided authority for system postings (OQ-72);
- a decided posting mode (OQ-42) and mapping content (OQ-25/OQ-30);
- a cross-module lock order and a test that proves it.

**If the Owner chooses O4 instead**, this package's boundary sections still hold; what changes
is §5.C/§6 (the atomicity claim becomes an eventual-consistency claim) and §9's failure rows
3–5, 10, 14, which acquire a delivery-state axis and an exception queue. That is a legitimate
choice — it is simply a *different product promise* about when the books reflect the warehouse,
and it must be written down as such.

---

## 8. Idempotency Strategy Options

### 8.1 Why the obvious key is not enough

The natural identity is the contract's own (§16.3/§16.4):
`(organizationId, sourceModule, sourceEntityType, sourceEntityId, sourceOperation)` — e.g.
`(org, inventory, inventory_business_document, <docId>, accounting_post)`. Stored once, it makes
duplicate delivery impossible.

But Inventory value is **explicitly mutable before the boundary**: a backdated receipt, a late
cost assignment, a pricing run or a reverse pricing can change the amounts a document's facts
carry *between two attempts of the same command* (for example, a first attempt refused because
the period was closed, then repriced, then retried). With a value-insensitive key, the retry
after a value change would be treated as a replay and the second attempt would either reuse a
stale journal or conflict misleadingly.

### 8.2 The options

| # | Identity | Replay behavior on a value change | Verdict |
|---|---|---|---|
| **I1** | `(source identity + operation)` only | Replays — **wrong**: silently ignores the new value | Insufficient alone |
| **I2** | I1 + an explicit **valuation version** on the document (a new counter/pointer) | Correct, but requires a new versioning concept on the Inventory side, effective-dated semantics and migration | Viable; more model than the problem needs |
| **I3** | I1 + **content hash of the exact money facts** (movement ids + signed base quantities + signed total costs + valuation sources + the mapping/rule version) | Same facts ⇒ replay; changed facts ⇒ **409 conflict**, which is the honest answer | **Recommended** |

### 8.3 Recommended identity

```
operationKey  = "invdoc:<inventoryDocumentId>:accounting-post"
requestHash   = sha256(canonical{
                  organizationId, sourceModule="inventory",
                  sourceEntityType="inventory_business_document",
                  sourceEntityId=<documentId>, sourceOperation="accounting_post",
                  documentKind, businessDate, number,
                  financialAreaId, postingRuleVersionId, mode,
                  facts: [ { movementId, movementType, baseQuantity, totalCost,
                             valuationSource, itemId, warehouseId } ... ]   // canonical order
                })
```

Properties:

- **Stable across retries** of the same unchanged document (the facts are read under the same
  locks that serialize valuation writers).
- **Sensitive to every monetary change** — a repriced fact changes the hash and produces a
  conflict instead of a silent replay.
- **Includes the mapping version**: a rule change between attempts is a different intent, not a
  replay.
- **Requires no new Inventory model** — every element already exists on the movement rows
  (`total_cost`, `valuation_status`, `valuation_source`, `base_quantity`).
- **Extends naturally**: `invdoc:<id>:accounting-reverse:<voucherId>` for a reversal
  (mirroring the Accounting module's own `document_reverse` kind), and one key per correction
  mechanism once OQ-27 decides them.

**Where the key is enforced.** Two ledgers, one intent: the Inventory side already writes its
own `inventory_operations` row for the posting command (the command is replay-safe today), and
the Accounting side must write `accounting_posting_operations` in the same transaction. The
Inventory row is the *command* idempotency; the Accounting row is the *posting* idempotency.
Neither replaces the other.

**What must NOT be the key.** The valuation-run id (a document's facts may be touched by
several runs, and a reverse pricing writes a compensating run), the document's `updated_at`
(fragile), and the event id (correct only if the event is durably persisted, which it is not
today).

---
## 9. Failure Semantics — the sixteen required scenarios

Each row states **today's verified behavior**, the **required future behavior** under the
recommended boundary (§5.B/O3), the **architectural consequence**, and the **unresolved OQ**.
"Current behavior" always means *the code as audited*; where the accounting effect does not
exist yet, the honest current behavior is "nothing happens".

### F1 — Inventory operational but unpriced

- **Current:** `accountingPostDocument` refuses with `inventory.document.accounting_ineligible`
  (`valuationState: 'unpriced'`). Quantity operations are unaffected (OD-PRC-09/10).
- **Required:** unchanged; the refusal must name the route out (assign cost → recalculate →
  post) and must never block the warehouse.
- **Consequence:** eligibility is the single gate; no new state needed.
- **OQ:** none (decided).

### F2 — Inventory priced but stale

- **Current:** the **document-level** flag `valuationStale` blocks eligibility. **Key-level**
  staleness (`inventory_valuation_states.status = 'stale'`) does **not** — see §11.4, finding
  **E-1**. Verified: `isAccountingEligible` reads only `document.valuationStale` plus the
  movements' own `valuation_status`.
- **Required:** one decision: either key-stale also blocks (recommended — the value may not
  reflect the method), or the current behavior is declared intended and documented as such.
- **Consequence:** if key-stale blocks, the accounting-post command must read the keys' state
  (it already locks those rows, so the data is there).
- **OQ:** none; this is a **Product Owner decision** (PO-05).

### F3 — Inventory eligible but Accounting unavailable / not configured

- **Current:** nothing happens beyond the flag — there is no consumer. An organization with no
  ACTIVE configuration would fail contract §16.7's area resolution if a posting were attempted.
- **Required (O3):** the command fails atomically; the document stays `operational`; the caller
  receives the named reason (no area / no mapping / no mode).
- **Consequence:** the Inventory Post button becomes a joint operation; its error model must
  carry Accounting's refusal codes (an API-contract decision for C-62).
- **OQ:** **OQ-39** (gate), OQ-42, OQ-40.

### F4 — Accounting receives duplicate delivery

- **Current:** no delivery exists. The *command* is replay-safe (already-crossed documents return
  the DTO without a second write).
- **Required:** `accounting_posting_operations` unique `(organization_id, operation_key)` makes a
  second voucher impossible; a same-key/same-hash retry replays the stored result.
- **Consequence:** the operation key must be derived deterministically from the Inventory
  document (§8.3), never generated per attempt.
- **OQ:** none (mechanism implemented; only the key naming is new).

### F5 — Accounting succeeds but acknowledgement fails

- **Current:** not applicable (no delivery). The Inventory retry path already proves the pattern:
  a re-post returns the existing state instead of writing twice.
- **Required (O3):** the commit **is** the acknowledgement; a post-commit transport failure is
  retried with the same key and replays on both sides.
- **Consequence:** no "ack" state, no delivery table — provided O3 is chosen.
- **OQ:** **OQ-39** (the alternative shape introduces the state).

### F6 — Inventory valuation changes before accounting posting

- **Current:** allowed and intended (OD-PRC-04/05, OD-VAL-10/11); the posting reads the facts
  **after** the valuation-state locks, so it can never use a value a concurrent writer replaced.
- **Required:** unchanged; the journal must carry exactly the value read under the locks.
- **Consequence:** the idempotency hash must include the money facts (§8.3), otherwise a retry
  after a repricing would silently replay a stale intent.
- **OQ:** none.

### F7 — Inventory valuation changes after accounting posting

- **Current:** **possible for every path except Reverse Pricing.** Verified: `runPricing`, the
  one-key `recalculate`, the backdated-edit `repricing: recalculate` path and `assignCost`
  contain no accounting-posted awareness; Reverse Pricing alone refuses
  (`inventory.pricing.reverse_accounting_posted`), and it refuses by reading the **Inventory**
  document header's status.
- **Required:** a decision — **block** post-boundary valuation writes on affected facts
  (recommended; consistent with OD-RVP-03 and with the immutability the Inventory lifecycle
  already claims), or **compensate** with an explicit accounting correction (which does not
  exist yet).
- **Consequence:** whichever is chosen becomes a shared guard in every valuation writer, not a
  Reverse-Pricing special case; if "block" is chosen the guards need the same lock tier the
  Accounting Post command uses.
- **OQ:** **OQ-71** (accounting-side counterpart), **OQ-27** (correction windows),
  **OQ-24** (posting policy).

### F8 — Reverse Pricing attempts to affect an accounting-posted document

- **Current:** refused before any write, with the blocking document ids named
  (`inventory.pricing.reverse_accounting_posted`; message: *"blocked until those documents are
  handled by an explicit accounting correction (OQ-27)"*). The guard runs **after** the
  valuation-state locks, so the check cannot read a stale header.
- **Required:** keep fail-closed and never cascade into Accounting (OD-RVP-03). When a real
  voucher exists, the guard should verify the **accounting document**, not only the flag
  (otherwise deleting/ignoring the flag would bypass the guard).
- **Consequence:** the guard's data source changes once the boundary has delivery evidence.
- **OQ:** **OQ-71** (the counterpart flow it names does not exist).

### F9 — Return variance exists but the account mapping is unresolved

- **Current:** the variance cannot even be *recorded*: no agreed-amount/settlement field is
  accepted on a return (OD-RET-01…04; `opens_amount` are refused). Return **valuation** is
  implemented and correct.
- **Required:** nothing until OQ-70 decides the variance account; the return's inventory leg can
  be posted only when the mapping exists — and the counterparty (supplier/customer) side needs a
  Party account, which the Factor domain does not yet own.
- **Consequence:** a purchase-return journal is blocked twice over: OQ-70 (variance) and the
  absence of a payable/receivable counterparty mapping.
- **OQ:** **OQ-70**, OQ-25 (roles), OQ-24.

### F10 — Accounting period is closed (or sealed)

- **Current:** refusal inside the finalization transaction
  (`accounting-documents.repository.ts`, `if (scope.period.status !== 'open')`), and the same
  for reversal; several periods of one year may be open; reopening requires the year to be
  unsealed.
- **Required:** identical fail-closed behavior for a system posting, with a named reason. What
  happens to the *Inventory* document then (block, retry later, exception queue) is **the**
  question OQ-39 leaves open.
- **Consequence:** under O3 a closed period blocks the warehouse's posting button — acceptable
  and honest; under O4 it creates a backlog and an exception surface.
- **OQ:** **OQ-23**, **OQ-39**, OQ-27.

### F11 — Inventory document is reversed/cancelled after accounting posting

- **Current:** refused on the Inventory side:
  `inventory.document.accounting_posted_requires_correction` (cancel) and
  `inventory.document.accounting_posted_is_immutable` (edit/delete).
- **Required:** an explicit correction flow (OQ-27) that produces an Accounting counter-document
  (the reversal machinery exists: a new final voucher with debit/credit inverted, open period
  required) **and** a decided Inventory-side effect. Whether an Inventory document may be
  corrected at all after the boundary, or only reversed through a new document, is undecided.
- **Consequence:** C-65 is the first slice that can make the refusal message truthful.
- **OQ:** **OQ-27**, **OQ-71**, OQ-54 (resolved for the Inventory side).

### F12 — Organization mismatch

- **Current:** every Inventory command calls `assertOrganizationInScope` (404 posture) and every
  repository read is organization-qualified; the Accounting voucher carries `organizationId` and
  resolves area/year/period within it. A cross-organization document id is not found, and a
  mismatched movement is never interpreted as priced
  (`toDtoWithCostAccess`'s `complete` check).
- **Required:** the posting request must carry the organization and both sides must re-assert
  scope; **no cross-organization journal creation** under any circumstance; the source identity
  must be validated in the same organization before use.
- **Consequence:** a system posting executes under the caller's organization only; a worker
  context has no ambient principal and must not become a scope bypass (contract §16.5).
- **OQ:** none (implemented rule; must be preserved verbatim).

### F13 — Permission mismatch

- **Current:** `Inventory.Document.AccountingPost` authorizes the boundary; Accounting's manual
  create requires `Accounting.Document.Create`. **Nothing decides what a system-origin posting
  requires** — this is the concrete gap that opened **OQ-72**.
- **Required:** a decided authority with no wildcard and no implicit bypass (OQ-21), and a stated
  relationship to the Inventory permission (e.g. the source permission *plus* a specific
  Accounting code, or the source permission alone under the contract's §16.5 reading).
- **Consequence:** the guard placement (route/application service) and the denial semantics
  (403 vs 422) follow from the decision.
- **OQ:** **OQ-72 (new)**, OQ-21, OQ-14.

### F14 — Retry after a partial failure

- **Current:** no cross-module partial state exists; within Inventory, a failed command leaves
  the document `operational` and consumes no number beyond the allocation key (the number is
  allocated at finalize, and a retry replays the same allocation).
- **Required (O3):** no partial state by construction; the retry path is the idempotency key pair
  (§8.3). Under O4, an explicit delivery state and retry surface are mandatory.
- **Consequence:** the choice of delivery shape *is* the answer to this scenario.
- **OQ:** **OQ-39**.

### F15 — Concurrent Accounting Post and Pricing

- **Current:** both take the **same** valuation-state lock tier in the same ascending order
  (`lockValuationStateRowsInOrder`), so they serialize; the Accounting Post re-derives the
  valuation state **after** acquiring the locks, and refuses if the repricing left the document
  ineligible.
- **Required:** preserve the lock tier and add a proof (test) that the boundary is never crossed
  on facts that changed after the eligibility check. With Accounting joining the transaction,
  the cross-module lock order (§5.C) must be specified and tested.
- **Consequence:** a cross-module lock-order document and a concurrency test belong in C-62.
- **OQ:** none for Inventory; the accounting side inherits the requirement.

### F16 — Concurrent Accounting Post and Reverse Pricing

- **Current:** Reverse Pricing takes the same valuation-state locks **before** reading its
  guards, and the Accounting Post takes the document row lock and then the valuation-state
  locks. Both orderings are safe: if the reverse commits first, the post's post-lock re-read
  sees `unvalued` facts and refuses; if the post commits first, the reverse's post-lock guard
  reads `accounting_posted` and refuses.
- **Required:** keep the read-after-lock discipline in every new writer; a future Accounting
  participant must not read the boundary outside the transaction.
- **Consequence:** the invariant to protect is *"no guard reads state it has not serialized
  against"*, not just the specific code path.
- **OQ:** none.

### 9.1 Additional states worth naming (beyond the required sixteen)

| State | Today | Required |
|---|---|---|
| Organization has no ACTIVE accounting configuration / no financial area | Nothing (no posting path) | Contract §16.7's fail-closed resolution; a named refusal |
| Mapping/rule version changed between two attempts of the same posting | Nothing (no posting path) | The hash includes the rule version → 409, not a silent replay (§8.3) |
| Two documents share a key and one is posted while the other is backdated | Posted document's facts may be repriced (F7) | F7's decision applies to *all* facts on the key, not only the document's own |
| Worker-originated posting (no HTTP principal) | Not possible (no worker dispatch) | Actor evidence carried as data; never an authorization bypass (contract §16.5) |

---

## 10. Receipt Accounting Analysis

### 10.1 The inventory side is complete

A receipt is `finalized` (stock and value move) and then crossing the boundary requires
`operational && priced && !stale`. Cost may be: a **Manual Price** entered with the receipt
(OD-PRC-02), or supplied **later** via `Inventory.Valuation.AssignCost` on the still-`unvalued`
movement, optionally followed by an explicit recalculation (OD-VAL-06/07). If the operator chose
"do not reprice" on a backdated receipt, the document is honestly flagged `valuation_stale` and
cannot cross the boundary until a recalculation clears it.

### 10.2 The accounting side is a blank sheet

| Question | Answer in the repository |
|---|---|
| Debit | Inventory asset account — **role undecided** (OQ-25: which control roles are mandatory) |
| Credit / offset | **Undecided.** Candidates: goods-received-not-invoiced / accrual, supplier payable, or a clearing account. The choice depends on whether Purchasing exists — the Purchasing module does **not** exist (OQ-16 puts it post-V1, `docs/modules.md` lists it as planned) |
| Amount | The receipt's `SUM(base movement total_cost)` — the valuation facts, read under lock |
| Date | The receipt's `business_date` (contract §16.3: the business date drives period resolution) |
| Later-known price | Two sub-cases: (a) unpriced at post time → **ineligible**, no journal, no partial state; (b) priced at post time, repriced later → F7's decision |
| Manual vs derived vs pricing-operation value | All three produce the *same* stored fact shape (`valuation_source` differs); the journal does not depend on which route produced the value — which is exactly OD-PRC-01's point |
| Purchasing dependency | The *inventory* journal does not need Purchasing. The **counterparty** does: a supplier payable requires a Party/vendor and a payable mapping, neither of which is in the Inventory boundary. A goods-received/clearing account avoids that dependency |

### 10.3 Unresolved decisions for a receipt

1. **The offset account's nature and role** (OQ-25/OQ-24) — is it a clearing account until an
   invoice arrives, or a direct payable? Both are legitimate ERP designs and the repository
   does not decide.
2. **Whether the receipt's journal is one voucher per document or per movement.** The document
   is the natural unit (the aggregate exists, the numbers are lines); per-movement postings
   would multiply vouchers and require a new accounting-document-per-movement policy.
   Recommendation: **per document**, with one line pair per valuation key (or per source line),
   because that is what reconciles with the document report an accountant reads.
3. **Whether unpriced receipts should even be postable later in one step**, i.e. whether the
   "assign cost → post" path should be a single guided operation (a UX/domain convenience). No
   rule change is implied; noted for C-63.

---

## 11. Issue Accounting Analysis

### 11.1 Inventory side

The issue takes its value from the key's Moving Weighted Average at the issue's own date,
computed by the replay; a manual cost is **never** accepted (OD-VAL-06/07). The value can be
`provisional` (derived while the key was backdated or partly uncosted), which makes the document
`partially_priced` and therefore **ineligible** — a deliberate honesty rule: Accounting may only
consume final monetary facts.

### 11.2 Accounting side

- **Credit:** inventory asset (same role as the receipt's debit).
- **Debit:** COGS / cost of goods sold **or** an expense account — **undecided** (OQ-24 states
  that "COGS/journal posting of inventory value into Accounting" is still open; OQ-25 governs
  which roles exist).
- **Amount:** the issue's negative `total_cost` (the magnitude is what posts).
- **Recognition timing:** this is a genuine fork with vendor evidence behind both sides —
  Sepidar prices documents then issues accounting documents per document; Rahkaran
  (per PDR-08's evidence table, S4) posts **aggregated over defined time ranges**. Both are
  representable in Vardena (per-document vouchers vs a periodic aggregation run), and choosing
  one changes the accounting document granularity, the reconciliation query and the rejection
  surface. **Recommendation: per document** for V1 (it matches the boundary as implemented and
  the Audit Post command is already document-scoped), with aggregation explicitly deferred as a
  reporting convenience, not a posting mechanism.
- **Repricing implications:** an issue valued at a provisional average and repriced later is
  F7/F15; an issue whose key is stale is F2's open decision.

### 11.3 Unresolved decisions for an issue

1. The COGS account/role and whether a per-item or per-category split is required (OQ-24/OQ-25).
2. Per-document vs aggregated recognition (§11.2).
3. Whether an issue may be posted while *another* document on the same key is ineligible
   (recommendation: yes — eligibility is per document; keys are not gatekeepers).

---

## 12. Transfer Accounting Analysis

### 12.1 Inventory side

Implemented: two legs (source out, destination in) in one transaction; the source leg is valued
and the destination inherits (OD-TRF-01); a backdated transfer is replayed as a coupled pair
(PR #127); a transfer is never left `valuation_stale` by a successful backdated finalize.

### 12.2 Should a transfer create a journal? — the alternatives

**The repository does not decide this, and it must not be assumed.** Three defensible models:

| Model | Journal | When it is right | Repository evidence |
|---|---|---|---|
| **T1 — No journal** (location move) | none; both legs post to the *same* inventory account, so the net effect is zero | one legal entity, one inventory account, no branch/area P&L | The strongest current fit: OQ-31's interim posture ("internal transfers are inventory-only documents within one legal entity; internal settlement and multi-company accounting are deferred") and OQ-40's "an area is a bookkeeping scope, a document belongs to exactly one area" |
| **T2 — Two-line journal** | one voucher: destination inventory/warehouse dimension debit, source credit | branches/areas are cost centres or separate books, or a warehouse-level P&L is required | Needs the branch/area dimension decision (OQ-55, OQ-41, OQ-40); the charts have no warehouse dimension today |
| **T3 — Inter-branch settlement** | in-transit clearing + settlement documents | branches are separate legal/accounting entities | Explicitly deferred (OQ-31, ADR-0026 §3 "no inter-area settlement", "no `company_id`") |

**Recommendation:** **T1 for V1** — a transfer produces *no* accounting document unless the Owner
decides that branch or area accounting is in scope; and if T2 is ever chosen, it must be a
deliberate, owner-approved configuration per organization, not a silent default.

### 12.3 Backdated transfer replay after accounting post

The replay legitimately restates **both** keys' values. If the transfer already crossed the
boundary, its journal would be stale — the same F7 decision, with one extra twist: the coupled
replay touches two keys, so a "block" policy must block on **either** leg.

### 12.4 Unresolved decisions for a transfer

1. T1/T2/T3 (PO-06).
2. If T1: whether the *absence* of a journal must still be recorded (e.g. a delivery record
   saying "internal move — no accounting effect"), so reconciliation can prove completeness.
3. If T2: which dimension carries the warehouse/branch (OQ-55/OQ-41) and whether inter-warehouse
   transfers inside one branch are exempt.

---

## 13. Purchase Return Analysis

### 13.1 What is decided and implemented (Inventory side — do not reopen)

`OD-RET-01` a return is a first-class document with an optional basis; `OD-RET-02` basis-linked
purchase returns leave at the **original receipt's own cost**; `OD-RET-03` without a basis they
leave at the key's **current MWA**; `OD-RET-04` an agreed/settlement amount is **never** absorbed
into the average — it is a variance recognized outside inventory; `OD-RET-07` cold start fails
closed. Implementation evidence: `purchaseReturnValueFromBasis` (one division, one rounding,
over-return refused, unvalued basis ⇒ unvalued return).

### 13.2 The separation this package insists on

| Layer | Status |
|---|---|
| **Inventory valuation decision** | **DECIDED + IMPLEMENTED.** No open question. |
| **Accounting mapping of the return's own legs** | **OPEN.** Dr (payable/clearing) + Cr (inventory) requires a control-role catalog (OQ-25) and, for the payable leg, a Party/payable mapping that the Factor domain does not yet own. |
| **Accounting mapping of the variance (OD-RET-04)** | **OPEN — OQ-70.** The repository accepts **no** settlement amount today, so the variance cannot even be captured yet. |

Because no settlement amount is accepted, the *current* system cannot produce a variance
finding; when the Factor domain adds one, the variance needs an account. This is exactly what
OQ-70's residual open part means: **"purchase-return settlement variance account — BLOCKED —
OQ-70 (Accounting side)"** (`docs/tasks/c-59-readiness-and-scope-proposal.md` §2.3).

### 13.3 Unresolved decisions

1. OQ-70: the variance account/role and whether the variance is a Factor-domain concern.
2. The counterparty account for a return without an invoice: the same clearing-vs-payable
   decision as §10.3.
3. Whether a return may be posted while its basis receipt is *not* (the basis is a valuation
   link, not an accounting link) — recommendation: yes, with the basis id stored as source
   evidence.

---

## 14. Sales Return Analysis

### 14.1 Inventory side (decided and implemented)

A sales return re-enters inventory at **inventory cost**, never at the sales price
(OD-RET-05): the key's current MWA at the return date, or — only when the return carries a
**basis** on the original issue and the operator supplies an amount — that amount as a Manual
Price (OD-RET-06), with any difference treated under OD-RET-04's variance rule. Cold start
fails closed (OD-RET-07).

### 14.2 The accounting side depends on Sales, which does not exist

A correct sales-return journal is not a two-line entry; it has two independent halves:

| Half | Lines | Source needed | Exists? |
|---|---|---|---|
| Inventory half | Dr inventory / Cr COGS (or a returns-inventory account) | the return document's valuation (available) | inventory value ✅, mapping ❌ |
| Revenue half | Dr revenue (or a returns contra-revenue account) / Cr receivable (or cash) | the **original sales invoice**, its price, tax and settlement | ❌ — there is no Sales module, no invoice entity, no receivable sub-ledger, no customer-side Factor accounting |

The repository's own rule forbids inventing the missing half: the sales price "has no inventory
valuation meaning" (OD-RET-05) and the tax/revenue mapping is OQ-30/OQ-25 territory. The
conclusion is structural, not a gap in C-60's scope: **a sales return cannot be fully posted
until Sales exists; only its inventory half could be, and splitting a business event into two
partial postings is itself a policy decision nobody has made.**

### 14.3 Unresolved decisions

1. Whether a sales return is posted at all before Sales exists (recommendation: **no** — the
   inventory document stays `operational` and the accounting side waits; alternatively a
   documented interim inventory-only posting if the Owner prefers, with the revenue half
   posting later).
2. The revenue/COGS accounts and the returns-contra accounts (OQ-25/OQ-30).
3. Whether the customer-side settlement follows the credit note or the return (Sales/OQ-35).

---

## 15. Reversal / Correction Analysis

### 15.1 What exists

| Capability | State |
|---|---|
| Inventory movement reversal (mirror the original's own value; `unvalued` stays `unvalued`) | **Implemented** (OD-REV-01…06) |
| Inventory document cancellation (reverses its own ledger facts atomically, keeps the number, keeps the document visible) | **Implemented**, refused after the boundary |
| Accounting document reversal (new final counter-voucher, debit/credit inverted, one reversal per original, **open period required**, idempotent on `document_reverse`) | **Implemented** (`POST /accounting-documents/:id/reverse`, `Accounting.Document.Reverse`) |
| Correction kinds beyond reversal | **Missing** — the vocabulary is `['reversal']` |
| A flow that ties an Inventory correction to an Accounting correction | **Missing** — OQ-27/OQ-71 |

### 15.2 The four mechanisms the contract allows, and what each would need

`AC-D-22` names four additive mechanisms: **reversal**, **correction/difference**,
**replacement pair**, **adjustment**. Only reversal is implemented. For the Inventory boundary:

- **Reversal** is the natural counterpart of cancelling a posted inventory document; it needs
  the linkage decision (which Inventory document a reversal voucher belongs to) and the
  OQ-27 window policy.
- **Correction/difference** is the natural home of a *value* correction after posting (e.g. a
  later-known cost): a new voucher for the difference only. This is precisely the mechanism the
  post-post change decision of §16/§8 would need if "compensate" is chosen instead of "block".
- **Replacement pair** and **adjustment** have no Inventory-side subject today.

### 15.3 Immutability after Accounting Post — what is true today

| Claim | Reality |
|---|---|
| "The Inventory document is immutable to direct edit and delete" | **True** (verified: `assertEditable`, `assertDeletable`, `assertCancellable`, transition table) |
| "Its economic result is immutable" | **False today** for the valuation paths (F7): the document cannot be edited, but its *facts can be repriced* by a pricing run, a recalculation or a backdated edit elsewhere on the same key |
| "Accounting history is immutable" | **True** for ledger entries and final vouchers (structural: no update/delete routes) |
| "A correction exists when the boundary is crossed" | **False** — the refusal message points at a flow that does not exist (OQ-27) |

### 15.4 Correction vs cancellation — the distinction to preserve

- **Cancellation** is an Inventory lifecycle act before the boundary; it reverses the *whole*
  document and leaves an auditable cancelled record with a mandatory reason.
- **Correction** is an Accounting act after the boundary; it never rewrites the original
  (ADR-0013/AR-13), it creates counter-documents, and its *scope* (what may still be corrected,
  for how long, in which period) is OQ-27.

The two must not be merged: a "cancel" that silently deletes a posted voucher would break
ADR-0022 and the statutory posture (OQ-43). Conversely an accounting reversal that leaves the
Inventory document marked `operational` would create the reverse inconsistency. **The linkage
rule is a Product Owner decision (PO-08).**

---

## 16. Pricing / Reverse Pricing ↔ Accounting

### 16.1 Before Accounting Post — what may change (verified)

- A backdated document may be finalized with an explicit repricing choice: `recalculate`
  (replay the key, restate values) or `skip` (keep the numbers, mark the document and the key
  honestly stale). No default exists (OD-VAL-10/11).
- A receipt's still-`unvalued` movement may receive a cost
  (`Inventory.Valuation.AssignCost`), optionally with a recalculation.
- The one-key `recalculate` command and the scoped Pricing Operation may restate any key's
  derived values; manual and derived values are preserved verbatim (OD-PRC-04).
- Reverse Pricing may un-price a completed run and restore the pre-run position.

All of this is *legal before the boundary* and *the reason the boundary exists*: it is the last
moment the value is provisional.

### 16.2 After Accounting Post — what must be forbidden

Nothing in the repository currently forbids valuation changes after the boundary except Reverse
Pricing. The honest enumeration of candidates that must be decided (PO-07):

| Change | Today | Options |
|---|---|---|
| Reverse Pricing over a posted document's facts | **Blocked** (`reverse_accounting_posted`) | keep blocked |
| One-key recalculation over such facts | **Allowed** | block / allow-with-variance / allow-and-flag |
| Period Pricing Operation over such facts | **Allowed** | block per key / skip posted facts and report them / allow with a compensating run |
| Backdated edit elsewhere that restates a posted document's value | **Allowed** | same as above |
| Late cost assignment on a posted receipt's own movement | **Not possible** (the movement is already `valued`; `assignCost` refuses `!= unvalued`) | no change needed |

### 16.3 If valuation changes after Accounting Post — the four models

| Model | Mechanism | Cost | Fit |
|---|---|---|---|
| **P1 — Block** | every valuation writer refuses when any affected document is past the boundary; the operator must first run an explicit accounting correction (which does not exist yet) | the warehouse/accounting gets stuck until C-65 ships; requires a shared guard in 4 writers | **Recommended as the terminal state**, consistent with OD-RVP-03's posture; it makes the Inventory lifecycle's immutability claim true |
| **P2 — Compensating journal** | allow the reprice; post a difference voucher automatically | needs the difference mechanism (AC-D-22) + an automatic posting mode + a variance account; risks silent books churn | Viable later; not first |
| **P3 — Correction document** | allow; require the operator to create an explicit correction document carrying the delta | needs OQ-27's policy and a new document type | Viable; the "manual honesty" path |
| **P4 — Reversal + repost** | reverse the voucher, reprice, post again | destroys the audit chain's simplicity; two lock scopes; the reversal window may be closed | Not recommended |

**OQ-71 is authoritative while it is open**: Reverse Pricing's guard must keep refusing until the
Accounting-side counterpart flow exists. This package adds the missing half of the observation:
the *other* valuation writers are not guarded at all, so "Reverse Pricing is blocked" is today a
partial guarantee, not the general rule it appears to be.

### 16.4 What pricing must never do (restated, decided)

OD-PDP-05: pricing never changes quantity, never posts accounting and never blocks a quantity
posting. OD-PRC-10: unpriced status must never block inventory operations. OD-RVP-04: Reverse
Pricing never changes quantity. These are decisions; nothing in this package reopens them.

---

## 17. Valuation History / Auditability (OQ-69)

### 17.1 The auditor's two questions

> **Q-A.** Why does this inventory value have this amount?
> **Q-B.** What changed between the original value and the current value?

### 17.2 What the current evidence answers (verified)

| Evidence | Where | Answers |
|---|---|---|
| The current value of every fact | `inventory_movements.total_cost` + `valuation_status` + `valuation_source` + `valued_at` | Q-A partially: the amount and *which route* produced it |
| The key's value and its composition | `inventory_valuation_states` (`valued_quantity`, `uncosted_quantity`, `total_value`, `status`, `stale_since`) | Q-A at the key level, and the split between valued and uncosted stock |
| The repricing commands | `inventory_valuation_runs` (`trigger`, `method`, `movements_examined`, `movements_revalued`, `operation_key`, `reason`, `executed_by`, `executed_at`) and the resulting snapshot (`resulting_*`) | *Who* repriced *what key* *when* and *how many facts changed* — but **not the superseded amounts** |
| The batch layer | `inventory_pricing_runs` + `inventory_pricing_run_key_outcomes` (`priced/failed/reversed`, named reason, `failed_movement_ids`, scope, from/to date, `reverses_run_id`, `reversed_by_run_id`) | *Why a run was scoped as it was*, *which keys failed and why*, *which run a compensating run reverses* |
| The link from a fact to its run | `inventory_movements.valuation_run_id` | Which run **last** assigned the value |
| The movement's own provenance | `movement_type`, `transfer_id`, `reversal_of_movement_id`, `reference_type/reference_id`, `operation_key` | Whether the fact is a receipt/issue/transfer leg/reversal and which document owns it |
| The document's history | `inventory_business_documents` (`status`, `finalized_*`, `accounting_posted_*`, `sealed_*`, `cancelled_*`, `cancellation_reason`, `valuation_stale`, `operation_key`) | The lifecycle's who/when/why |
| The double-entry side | `accounting_documents` + `accounting_ledger_entries` (immutable, with `source_*` evidence columns) | What the books recorded — **once a posting exists** |

### 17.3 What is missing (the honest gaps)

| # | Missing fact | Consequence |
|---|---|---|
| **M1** | The **superseded amount** of each movement (old value → new value, by whom, under which run) | Q-B is unanswerable from stored data alone: the previous value is gone. It is *reconstructable* in principle (replay the key's facts in date order, re-deriving each state), but that is a computation, not evidence |
| **M2** | The **per-movement method** actually applied by a run | `inventory_valuation_runs.method` records the method in force for the key at run time; individual facts may have been valued under an earlier effective-dated method version |
| **M3** | A **durable record of the accounting boundary crossing** (which accounting document, if any) | The Inventory document stores only the flag and timestamps; `accounting_posted_at` cannot be verified against a voucher |
| **M4** | Any durable **event log** | Events are fire-and-forget; a boundary crossing leaves no independent trace |
| **M5** | An explicit **stale reason/cause** | `stale_since` records *when*, not *which document/run* caused the staleness |
| **M6** | A **reconciliation record** between inventory value and posted journals | No such report or evidence exists (see C-66) |

### 17.4 Assessment against OD-VH-01

`OD-VH-01` decides the *architecture*: **Ledger Authority + Immutable Valuation History** — the
ledger stays the single authority for the current value, and immutable valuation history is kept
*in addition*, never as a second ledger anything reads for current truth. The repository today
implements the "Ledger Authority" half completely and the "Immutable Valuation History" half
only at *run* granularity. OQ-69's residual question is exactly whether run-granularity +
reconstructability is sufficient for an auditor, or whether M1/M2 must be persisted.

### 17.5 Proposed architecture (documented, not implemented)

Following OD-VH-01 without inventing new authority:

- an **append-only movement-valuation history** table (one row per *value assignment event*:
  movement id, run id, previous value, new value, previous status, new status, source, actor,
  instant, reason), written **inside the same transaction** as the valuation write;
- **no reader uses it for current truth** — current truth stays on the movement/state rows;
- the run rows keep their role (command evidence) and gain an explicit link to the history rows
  they wrote;
- per-movement method/version recorded on the run's *facts* (or on the history row) to close M2;
- nothing is backfilled retroactively by inventing history: the table starts empty and fills
  from the slice that introduces it, with the pre-existing period honestly marked as
  "reconstructable, not recorded".

**Schema implications (for the future slice, not this one):** one new additive table + indexes
on `(organization_id, movement_id, created_at)` and `(valuation_run_id)`; no change to
`inventory_movements` or `inventory_valuation_states`, no change to any accounting table, and
no migration in C-60.

**OQ decisions required:** (a) is run-granularity sufficient (OQ-69 answered "yes") or is M1/M2
required; (b) if required, is the history written for *every* value change or only for run-based
ones; (c) is M5 (stale cause) part of the same slice.

### 17.6 The reconciliation question (feeds C-66)

Even with perfect history, an auditor's third question — *"does the Inventory value match the
Accounting ledger, and if not, why?"* — needs a comparison surface:
`SUM(inventory value per account-mapped key)` against the posted inventory-account balance, with
the unposted/unvalued/stale buckets visible. Nothing like it exists. Its design depends on the
mapping decision (OQ-25) and therefore belongs to C-66, not to the boundary slice.

---
## 18. Security and Organization Isolation

### 18.1 The standing rules this integration must preserve (verified)

| Rule | Where it is enforced today |
|---|---|
| Permission **and** organization scope, independently | `AuthorizationService.requireAllPermissions` + `OrganizationsService.assertOrganizationInScope` at every organization-scoped entry point; failure semantics 401/403 vs 404 (`docs/security.md` §3) |
| Principal → organization binding | `organization.organization_memberships` + the `assertOrganizationInScope` chokepoint (Task 19/ODR-3) |
| Granular, code-registered permissions only | `Module.Entity.Action` registries mirrored into `rbac.permissions` at startup; 49 Accounting, 39 Inventory codes; **no wildcards, no superuser** (OQ-21) |
| No cross-module table access | Module-A code never reads/writes module-B tables (AC-I-13, AR-07) |
| Sensitive-write audit inside the business transaction | Contract §23's list includes document finalization, corrections/reversals, period operations, configuration changes |
| Denied paths are tested | AG-13 requires the failing-path test in the same change |

### 18.2 What the future integration must add — and must not weaken

1. **Authority for system postings (OQ-72).** Today the only create authority is
   `Accounting.Document.Create` (manual). If a system posting executes under a warehouse user's
   principal, either that code becomes a hidden requirement on the Warehouse role, or the
   posting contract defines its own code. Neither may be introduced by accident.
2. **No implicit system bypass.** A worker-dispatched posting has no HTTP request context; the
   authorization service treats a missing request context as **trusted system context**. That
   is an explicit, documented posture — and it is exactly the surface a posting consumer must
   not exploit. The consumer must carry actor evidence as *data* (contract §16.5) and must not
   rely on system context to skip scope assertions.
3. **Scope assertion on both sides.** The posting request carries `organizationId`; the
   Inventory side already proves the document belongs to it, and the Accounting side must
   re-assert (it does: `requireUsableOrganization`/`assertOrganizationInScope` inside
   `createDocument`). A future consumer must call the same service, not a "trusted" shortcut.
4. **No cross-organization journal creation, ever.** The Audit Post command resolves the
   document inside the organization (`mustFind(id, organizationId)`); a mismatched id yields 404,
   never a cross-tenant write.
5. **Permission separation must survive.** The Inventory permission that crosses the boundary
   (`Inventory.Document.AccountingPost`) must remain distinct from every Accounting document
   authority, and the accounting reversal authority (`Accounting.Document.Reverse`) must remain
   distinct from the valuation authorities (`Inventory.Valuation.ReversePricing`). Merging any
   two of these would collapse a separation-of-duties boundary that the repository deliberately
   built (`inventory-valuation-permissions.ts`'s docblock argues this explicitly).
6. **New permission codes must be registered, never assumed.** If C-61/C-62 need
   `Accounting.PostingRule.*`, `Accounting.SystemPosting.*` or a rework of `ControlRole.*`, they
   are *code-registered* with failing-path tests (AG-13, `docs/security.md` §3).
7. **Read-only valuation isolation must be preserved.** `Inventory.Valuation.View` gates money
   fields; a warehouse user sees documents with the money *blanked*, never a different shape.
   An accounting posting must not become a side channel that exposes per-unit costs to a
   principal without the valuation permission — its responses must respect the same rule.

### 18.3 Organization-boundary test obligations for the future epics

Every boundary slice must ship, at minimum: a cross-organization document id (404, no write); a
mismatched-organization movement (never counted as priced); a permission-denied posting (403,
no partial write); a scope-denied read of a system-generated voucher (404, no leak of its
existence); and a proof that the posting did not create a row under a different organization.

---

## 19. Frontend Impact

**Audit scope.** The frontend was inspected only to identify *future integration surfaces*. No
frontend change is made by this sprint. What exists today (verified in
`frontend/src/features/inventory/` and `frontend/src/features/accounting/`):

| Surface | Exists today |
|---|---|
| Inventory documents (list, create/edit, detail, lifecycle actions incl. **Accounting Post**, cancel with reason, seal, delete) | **Yes** — `documents/document-lifecycle-actions.tsx` (`data-testid="accounting-post-document"`), `inventory-document-detail-page.tsx` (shows `accountingPostedAt`, warns on `valuationStale`) |
| Valuation worklist (per-key state, stale/pending badges, one-key recalculate) | **Yes** — `valuation-states-page.tsx` |
| Kardex, movements, transfers | **Yes** |
| Periodic Pricing Operation (batch scope, run report, per-key failures) | **No** — backend API only (`POST/GET /inventory/pricing/runs`) |
| Reverse Pricing | **No** — backend only |
| Return documents | **Backend only** — the frontend document form is kind-generic; no dedicated return UX/basis picker was found |
| Accounting documents (manual compose, issue, finalize, reverse, list/detail) | **Yes** — `features/accounting/documents/`, `document-action-dialogs.tsx` |
| Chart, accounts, periods, years, areas, GL, trial balance, account statement | **Yes** |
| Anything showing a **link between an inventory document and its voucher** | **No** |
| Anything showing an **accounting delivery state, error, or retry** | **No** |
| **Reconciliation** (inventory value vs ledger) | **No** |

### 19.1 Required MVP surface (must ship with the boundary epics)

1. **Accounting Post must show its outcome, not just a toast.** Today the dialog confirms the
   boundary; with the recommended architecture the command can fail for accounting reasons. The
   MVP must show the refusal reason (`accounting_ineligible` variants, no area, no mapping,
   period closed) with the route out, in the user's language.
2. **A voucher reference on the inventory document.** Detail view: "Accounting document
   `#1234`" (link) or "not posted yet"; list column optional. This is what makes
   `accounting_posted` verifiable by the user.
3. **Eligibility reason.** The document detail must explain *why* it is not eligible
   (unpriced / partially priced / stale) — the DTO already carries `valuationState`,
   `valuationStale` and `accountingEligible`.
4. **Delivery/exception surface (only if O4 is chosen).** A worklist of documents whose posting
   is pending/failed, with a retry action — the `Accounting.SystemPosting.{View,Retry}`
   vocabulary the contract reserves.

### 19.2 Useful later surface

- A pricing-run page (scope form, run report with per-key failures) and a reverse-pricing action
  — the backend API and the permission codes exist; only the UI is missing.
- A return-document UX with a basis picker (the ledger's `basisMovementId` is already recorded).
- An inventory-accounting **reconciliation view** (posted vs unposted vs unvalued vs stale value)
  once the mapping exists.
- An audit view over valuation history (depends on OQ-69's answer).

### 19.3 Explicitly deferred

- Any pricing/reverse-pricing UI before the accounting interaction is decided (F7/F16) — a UI
  that offers a repricing which may silently invalidate a posted journal would encode the wrong
  promise.
- Two-book/consolidation views, dimension assignment UI (OQ-41/OQ-56), statutory book layouts
  (OQ-43), and a report builder (OQ-49).
- Any Sales-facing surface: Sales does not exist.

### 19.4 Frontend constraints that apply when these are built

`AGENTS.md` requires `docs/frontend/standards.md` to be read and followed, base components to
come from `src/shared`, pages to compose patterns, and §17 rule-as-code checks to pass in CI.
Money and quantities are strings end to end and the UI must never recompute a valuation
(`inventory.api.ts` docblock); permissions gate routes *and* actions; RTL/Persian labels live in
`lib/i18n.ts`.

---
## 20. Proposed Epic Breakdown

Six vertical epics. They are deliberately **large**: each is an independently reviewable,
independently testable increment that a Product Owner can accept or reject on its own, and each
delivers something a user or an auditor can observe. Names follow the repository's C-numbered
convention but the structure is derived from the audit, not from the suggested list: the
evidence forced **two foundations** (mapping, then delivery) where the prompt suggested one, and
merged reconciliation/audit/frontend into one operational epic.

> **Gating.** C-61 cannot start before the control-role catalog exists (**OQ-25**). C-62 cannot
> be *enabled* before **OQ-39** is resolved (contract AC-D-26, ADR-0026 §6) and cannot be
> *designed* finally before **OQ-72** (authority) and **OQ-42** (mode) are answered. Everything
> downstream inherits those gates.

### C-61 — Accounting Posting-Rule & Control-Role Foundation (Accounting)

| Field | Content |
|---|---|
| **Objective** | Make Accounting able to answer, for a given inventory fact: *which accounts does this entry use, under which authority, and in which mode?* — the mapping layer that does not exist today |
| **Business scope** | The organization adopts a control-role catalog once (roles → accounts); an accountant configures a posting rule per source operation (receipt, issue, transfer, purchase return, sales return, reversal/correction) and per organization; the mode (A/B) and the organization-level accounting enable switch are configuration, not code |
| **Technical scope** | New Accounting models (rule + role mapping, pinned to the ACTIVE accounting configuration and versioned per the existing configuration posture); domain validation (role applicability, account postable/active, no silent default); application services with the module's lock/idempotency conventions; permissions `Accounting.ControlRole.{View,Map}` and `Accounting.PostingRule.{View,Configure}` registered in code per the contract §22 vocabulary; a **resolver** the future posting seam calls (facts in → lines/roles out, or a named refusal); a preview endpoint so an accountant can see the lines a rule would produce for a real document |
| **Dependencies** | The implemented chart/config/account foundation (Tasks 10.3–11, 19, 30); ADR-0037 (Proposed) as the conceptual model; C-62 consumes the resolver |
| **Blocked OQs** | **OQ-25** (role catalog + mandatory set — hard blocker), **OQ-42** (Mode A/B default and authorities), **OQ-24** (the COGS/offset *content*), OQ-30 (tax roles, if any), OQ-40 (area applicability), OQ-62/63 (configuration pin coherence — already constrained) |
| **Expected migrations** | 1–2 additive migrations: `accounting_posting_rules` (+ levels/versions as needed) and `accounting_control_role_mappings`; varchar status columns per the module's convention; **no** change to documents, ledger, projections or any Inventory table |
| **Expected API changes** | `POST/GET/PATCH /accounting/control-role-mappings`, `POST/GET/PATCH /accounting/posting-rules`, `GET /accounting/posting-rules/resolve` (preview); every endpoint declares its code and tests its denial path (AG-13) |
| **Expected tests** | Domain: role resolution, missing role ⇒ named refusal (never a fallback account), non-postable/inactive account refusal, rule version pinning. Application: permission + scope + operational-freeze interaction. E2E: configure → preview → resolve for a synthetic fact set; denial paths |
| **Expected CI verification** | The standard `backend` job (unit, lint, typecheck, format, build, migrate, live e2e). No new CI surface |
| **Acceptance criteria** | (1) An accountant can map every mandatory role to an account and configure one rule per inventory document kind; (2) the resolver produces balanced, postable lines for a real receipt/issue fact set and refuses, naming the missing role, when a mapping is absent; (3) no code outside Accounting knows an account code; (4) nothing in Inventory changes |
| **Explicitly out of scope** | Any Inventory integration or consumer; automatic posting; a generic rule/expression engine (rejected by ADR-0018 §4); dimension handling beyond the existing detail seam; statutory layouts; tax content |

### C-62 — Inventory → Accounting Delivery Foundation

| Field | Content |
|---|---|
| **Objective** | Implement the decided delivery shape end-to-end on the seam only: an explicit Accounting Post that either **fully posts** or **fully refuses**, with one identity, one lock order and one failure vocabulary |
| **Business scope** | The Inventory Post button becomes a real joint operation: crossing the boundary produces a voucher (or a Mode-B temporary document); failing produces a named, human-readable reason and leaves the document exactly as it was |
| **Technical scope** | (a) The chosen dispatch path — under the recommended option, an in-transaction integration dispatch in the kernel that **propagates** subscriber failures and coexists with today's post-commit notification events; (b) the integration contract (facts payload: document identity, kind, business date, organization, lines with movement ids, base quantities, signed costs, valuation sources, area, rule version); (c) Accounting's system-posting entry point (a service that composes through the C-61 resolver and the existing `AccountingDocumentsService`/`PostingService`, never a new voucher engine); (d) the idempotency identity of §8.3, written in the same transaction; (e) the cross-reference between the two aggregates (recommended: `documents.document_relations`, which already models `sourceModule/sourceDocumentType/sourceDocumentId → targetModule/…`, plus a readable `accountingReference` in the Inventory DTO); (f) refusal→API error mapping shared by both modules; (g) the cross-module lock order (§5.C) and its test; (h) the per-organization enable switch (disabled by default) |
| **Dependencies** | C-61 (resolver), the implemented `AccountingDocumentsService`/`PostingService`, the Documents Foundation relations + numbering, the Inventory lock tier |
| **Blocked OQs** | **OQ-39** (delivery shape — the gate to *enabling*), **OQ-72** (authority), **OQ-42** (Mode A/B), OQ-40 (area resolution), OQ-23/OQ-27 (period-closed semantics) |
| **Expected migrations** | Recommended: **none** (link via `documents.document_relations`; idempotency via the existing `accounting_posting_operations`). If the Owner prefers a direct column, one additive nullable column on `inventory_business_documents` — never a change to existing columns |
| **Expected API changes** | No new endpoint (the existing `POST /inventory/business-documents/:id/accounting-post` gains real semantics and new refusal codes); optionally `GET /inventory/business-documents/:id/accounting` returning voucher reference + state; Swagger updates |
| **Expected tests** | Atomicity: an accounting refusal leaves zero accounting rows and the document `operational`. Idempotency: same key+hash replays to the same voucher; changed money ⇒ 409. Authority/permission denial paths. Cross-organization refusal. Concurrency: Accounting Post vs Pricing and vs Reverse Pricing (F15/F16) with live PostgreSQL. Lock-order/deadlock regression |
| **Expected CI verification** | `backend` job incl. live e2e; the concurrency cases must run there (they are not "local" tests under this sprint's policy) |
| **Acceptance criteria** | (1) For a mapped receipt with a manual cost, one command produces exactly one final voucher with ledger entries and a consistent balance projection; (2) a re-run of the same command never produces a second voucher; (3) any refusal is atomic and named; (4) with the feature switch off, behavior is byte-for-byte today's behavior; (5) two-way traceability works from a movement to the voucher and back without cross-module SQL |
| **Explicitly out of scope** | COGS/offset *content* (C-63), returns/transfers (C-64), corrections (C-65), reconciliation and history (C-66), any frontend beyond the minimum reason/reference display, autonomous/background posting |

### C-63 — Receipt & Issue Accounting Delivery

| Field | Content |
|---|---|
| **Objective** | Deliver the first real business value: receipts and issues produce correct, reconciled journals under the decided mappings |
| **Business scope** | Inventory value enters the books on receipt (asset vs offset) and leaves them on issue (asset vs COGS/expense); unpriced/partially-priced/stale documents are refused with a route out; an accountant can see, from the inventory document, the voucher that carries it |
| **Technical scope** | The fact→payload composition for receipt and issue (sign conventions, one line pair per valuation key or per document line — PO-04); the offset/COGS role adoption with the accountant; refusal surfacing in the Inventory command's error model; the DTO additions (`accountingReference`, `eligibilityReason`); the reconciliation-ready source evidence (movement ids per voucher line via `sourceLineReference`); the mapping-version pin in the idempotency hash |
| **Dependencies** | C-61, C-62; the implemented valuation runtime (C-59) |
| **Blocked OQs** | **OQ-24** (offset/COGS semantics and any variance accounts), **OQ-25** (the roles themselves), OQ-30 (tax, if a receipt carries it), OQ-03/OQ-11 (currency/precision — unchanged) |
| **Expected migrations** | None expected (optionally a base-chart/rule seed for the sandbox) |
| **Expected API changes** | None beyond C-62's DTO additions; `GET /inventory/valuation/states` may gain an "accounting posted" filter for the worklist |
| **Expected tests** | Unit: composition (amounts equal the ledger facts exactly, `numeric(18,2)`, no rounding to force balance), refusal taxonomy. Application: end-to-end posting paths and denial paths. Live e2e: receipt (manual cost and late-assigned cost) + issue, each asserting the voucher, its entries, the projection and the traceability query |
| **Expected CI verification** | `backend` job; a live e2e suite extending `accounting-documents-live` / `inventory-valuation` patterns |
| **Acceptance criteria** | (1) A receipt posts asset debit + offset credit equal to the document's value; (2) an issue posts asset credit + COGS debit equal to the derived value; (3) an unpriced receipt is refused and never posts zero; (4) the sum of posted inventory-account movements equals the ledger value of posted documents (reconciliation seed); (5) no manual re-keying is required |
| **Explicitly out of scope** | Transfers, returns, reversals, correction flows, aggregated/periodic COGS runs, write-downs, landed cost, multi-currency, Sales/Purchasing modules |

### C-64 — Transfer & Return Accounting Delivery

| Field | Content |
|---|---|
| **Objective** | Decide and deliver the non-trivial flows: transfers (journal or explicit no-journal), purchase returns (including the OQ-70 variance if decided), sales returns to the extent Sales does not exist |
| **Business scope** | A transfer is an internal move (or a two-line/dimensioned entry, if the Owner chooses T2); a purchase return reverses inventory value at the decided costing and settles with the counterparty; a sales return's inventory half is handled, with the revenue half deferred until Sales exists |
| **Technical scope** | Transfer: the chosen model, the destination-leg treatment, and — for T1 — an explicit, queryable "internal move, no accounting effect" delivery record so completeness is provable; Returns: the counterparty side (clearing vs payable/receivable), the variance capture/account when OQ-70 is decided, basis-linked source evidence; the reversal-vs-return separation restated in code (OD-REV-08) |
| **Dependencies** | C-61/C-62/C-63; the implemented return costing and transfer replay |
| **Blocked OQs** | **OQ-31** (transfer accounting), **OQ-70** (variance account + the Factor domain's agreed amount), **OQ-25** (counterparty roles), OQ-15 (sales→inventory workflow) |
| **Expected migrations** | Possibly one additive migration for the variance role mapping or the Factor-side amount field — **only** if OQ-70 decides it; otherwise none |
| **Expected API changes** | Return endpoints may gain settlement-amount fields *only* when OQ-70 decides; transfer delivery state in the document DTO |
| **Expected tests** | Transfer: T1 net-zero proof (or T2 balanced two-line); backdated transfer replay after posting (F7 on both keys). Returns: basis cost mirroring, current-MWA route, cold-start refusal, variance posting with the decided account, over-return refusal |
| **Expected CI verification** | `backend` job with live e2e |
| **Acceptance criteria** | (1) Posting a transfer either produces the decided journal or an explicit recorded absence of one; (2) a basis-linked purchase return posts inventory credit + counterparty debit at the original receipt cost; (3) a settlement variance, if captured, posts to the OQ-70 account and never touches the average; (4) a sales return posts inventory cost and never the sales price |
| **Explicitly out of scope** | The Sales module, purchasing, inter-company/inter-area settlement, landed cost, multi-currency, tax on returns unless OQ-30 decides |

### C-65 — Correction, Reverse Pricing & Post-Post Change Control

| Field | Content |
|---|---|
| **Objective** | Remove the largest remaining lie in the boundary: today a document claims immutability it does not have (F7), and Reverse Pricing demands a correction flow that does not exist (OQ-71) |
| **Business scope** | After the boundary, changing an economic result requires an explicit, authorized, reasoned correction; the operator is told exactly what is possible (reverse the voucher, correct the difference, or nothing) and what is not |
| **Technical scope** | The chosen post-post policy (P1 block / P2 compensating / P3 correction document / P4 reversal+repost) implemented **in every valuation writer** (one-key recalculation, backdated repricing, Pricing Operation, Reverse Pricing, cost assignment), not as a special case; the accounting-side counterpart flow (reverse a voucher from the Inventory document, with the linkage written both ways); the correction vocabulary extension (AC-D-22's `correction`/`difference` kinds) if chosen; the guard's data source upgraded from the Inventory flag to the real voucher reference; refusal codes and UI text |
| **Dependencies** | C-62/C-63 (a voucher reference must exist); the implemented reversal machinery in both modules |
| **Blocked OQs** | **OQ-27** (correction policy/windows), **OQ-71** (the counterpart flow), **OQ-24** (difference-account semantics), OQ-43 (statutory constraints on corrections) |
| **Expected migrations** | Additive only: possibly new `correction_kind` values and a link column/relation kind; no change to ledger-entry or reversal semantics |
| **Expected API changes** | An accounting-side reverse-from-inventory action, or a documented two-step flow; new refusal codes on the valuation endpoints; no widening of existing authorities |
| **Expected tests** | Every valuation writer refuses a post-boundary mutation (five paths); the correction flow produces exactly one counter-voucher and marks both aggregates; idempotency of the correction; closed-period reversal refusal; retry after partial failure |
| **Expected CI verification** | `backend` job incl. live e2e and the concurrency suites |
| **Acceptance criteria** | (1) `accounting_posted` genuinely means "no valuation write can change this document's numbers"; (2) when a change is needed, exactly one auditable correction path exists and is discoverable from both the inventory document and the voucher; (3) Reverse Pricing's guard message points at a flow the user can actually perform |
| **Explicitly out of scope** | Automatic/silent compensating journals (unless P2 is chosen), statutory correction reporting, correction windows content (OQ-27), deletion of anything ever posted |

### C-66 — Inventory Accounting Reconciliation, Auditability & Frontend Completion

| Field | Content |
|---|---|
| **Objective** | Make the integration **provable** — to an accountant, an auditor and a warehouse user |
| **Business scope** | "Does inventory value match the books, and if not, why?" answerable in the product; "why does this value have this amount / what changed?" answerable from evidence; the operational UI complete (pricing runs, reverse pricing, returns, reconciliation, correction) |
| **Technical scope** | Reconciliation surface (inventory value vs posted inventory-account balance, partitioned into posted / unposted / unvalued / stale buckets, with drill-down to documents and vouchers); the OQ-69 decision implemented (append-only valuation history + per-movement method record, if required) with the pre-existing period honestly marked non-recorded; pricing-run and reverse-pricing UI; return UX with a basis picker; the voucher-reference and eligibility surfaces from C-62/C-63 completed; permission codes registered per the contract vocabulary (`Accounting.SystemPosting.{View,Retry}` if a delivery state exists) |
| **Dependencies** | C-61…C-65; `docs/frontend/standards.md`; the reporting conventions (module-owned views, raw SQL allowed only there) |
| **Blocked OQs** | **OQ-69** (history sufficiency), OQ-25 (reconciliation needs the mapping), OQ-41/OQ-55 (dimension-aware views, deferred), OQ-49 (report-builder depth — not needed for a purpose-built view) |
| **Expected migrations** | One additive migration **if** OQ-69 requires a history table (append-only, indexed by `(organization_id, movement_id, created_at)` and `(valuation_run_id)`); otherwise none |
| **Expected API changes** | `GET /inventory-accounting/reconciliation` (or the module-owned equivalent), `GET /inventory/valuation/history`, plus the frontend-facing list endpoints already present; `Accounting.SystemPosting.*` codes only if a delivery state exists |
| **Expected tests** | Reconciliation regression fixtures (the repository's reporting-view convention: fixture data → expected rows), bucket edge cases (unvalued/stale/unposted), history append-only invariants, frontend component/page tests per the frontend job |
| **Expected CI verification** | `backend` + `frontend` jobs; live e2e for the reconciliation read |
| **Acceptance criteria** | (1) For a closed period with every document posted, reconciliation reports zero unexplained difference; (2) with unposted/unvalued/stale documents present, each is named and drillable; (3) an auditor can answer Q-A and Q-B of §17.1 from product surfaces; (4) a user can run and reverse a pricing batch and see, before doing so, whether it touches posted documents |
| **Explicitly out of scope** | Report builder, statutory book layouts (OQ-43), write-down/NRV/ageing, dimension model rework, two-book accounting (OQ-56), any Sales/Purchasing UI |

### Dependency graph

Legend: **B** = blocking (the dependent cannot be accepted without it) · **N** = non-blocking
(constrains, but work may proceed) · **O** = optional future.

```
                        ┌──────────────────────────────────────────┐
                        │  PO DECISIONS (§21) — no code            │
                        │  OQ-25 roles · OQ-42 mode · OQ-39 shape  │
                        │  OQ-72 authority · OQ-24 content         │
                        └───────────────┬──────────────────────────┘
                                        │
                 ┌──────────────────────┴───────────────────────┐
                 ▼                                              ▼
      ┌───────────────────────┐                     ┌────────────────────────┐
      │ C-61 Accounting       │─────── B ──────────▶│ C-62 Delivery          │
      │ Posting-Rule &        │                     │ Foundation             │
      │ Control-Role          │                     │ (idempotency, locks,   │
      │ Foundation            │                     │  link, refusal model)  │
      └───────────────────────┘                     └───────────┬────────────┘
                                                                │ B
                        ┌───────────────────────────────────────┼─────────────────────────┐
                        ▼                                       ▼                         ▼
             ┌────────────────────┐                 ┌──────────────────────┐   ┌────────────────────┐
             │ C-63 Receipt &     │─────── B ──────▶ │ C-64 Transfer &      │   │ C-65 Correction &  │
             │ Issue Delivery     │                 │ Returns (OQ-31/OQ-70)│   │ Post-Post Control  │
             └─────────┬──────────┘                 └───────────┬──────────┘   │ (OQ-27/OQ-71)      │
                       │                                        │              └─────────┬──────────┘
                       └────────────────┬───────────────────────┴────────────────────────┘
                                        ▼
                          ┌───────────────────────────────────┐
                          │ C-66 Reconciliation, Auditability,│
                          │ Frontend (OQ-69)                  │
                          └───────────────────────────────────┘

Non-blocking / optional edges:
  OQ-23 (fiscal calendar)        ──N──▶ C-62 (period-closed semantics)
  OQ-40 (financial areas)        ──N──▶ C-62 (area resolution)
  OQ-30 (tax)                    ──N──▶ C-61/C-63/C-64 (tax roles/lines)
  OQ-31 (transfer accounting)    ──B──▶ C-64
  OQ-70 (variance account)       ──B──▶ the variance half of C-64 only
  OQ-55/OQ-41 (branch/dimensions) ──O──▶ C-66 dimension-aware views
  OQ-43 (statutory)              ──O──▶ C-66 report layouts
  OQ-56 (two-book)               ──O──▶ future, affects rule scoping
  OQ-03/OQ-11 (money precision)  ──O──▶ any future precision change; blocks nothing today
  Sales module (does not exist)  ──B──▶ the revenue half of a sales return only
```

---

## 21. Decisions Required from the Product Owner, and the Final-Report Format

### 21.1 How to use this register

Every item below is a decision **only the Product Owner (with the accountant where named) can
take**. Nothing in this package takes one by implication: an unanswered item is not permission
to proceed, and a recommendation recorded here is not a decision until the Owner records it in
the canonical record named by the row (`docs/decisions/product/*`, `docs/open-questions.md`, or
an ADR for the architectural ones). Each row states the options, this audit's recommendation,
and what the decision unblocks. **PO-01…PO-12 are choices the repository does not itself
answer** (several of them intersect an existing OQ — cross-referenced in the row); **§21.3** lists
the registry rows that must be moved or narrowed, and the content their resolution must contain.

### 21.2 Product Owner decision list

| ID | Decision | Options (where analyzed) | Recommendation and why | Unblocks |
|---|---|---|---|---|
| **PO-01** | **Who owns the inventory value, and what does Accounting consume?** | A1 Accounting keeps its own copy · **A2 Inventory stores the facts (per movement: quantity, signed cost, valuation source) and Accounting stores accounts + policy; the posting reads amounts from the facts** · A3 dual storage with reconciliation | **A2** (§5.A) — the C-59 runtime already *is* the value authority (OD-VAL-01…19, contract §20.1); a second copy would create two truths and require reconciliation from day one | The Accounting posting input contract; the reconciliation design (C-66) |
| **PO-02** | **How is the accounting journal created for an inventory fact?** (this is the C-60 core; the delivery shape is OQ-39) | B1 Inventory writes the ledger directly (**forbidden**) · B2 post-commit event consumed by Accounting (**rejected**: non-atomic, lossy) · **B3 transactional in-process subscription through Accounting's public application service, inside the Inventory command's transaction (ADR-0005's accepted shape)** · B4 request/response via a new service endpoint · B5 durable outbox + worker (O4), inventory commit independent | **B3**, implemented as the O1–O5 analysis's **O3**, with **O5 split**: the outbox stays for *external* destinations (ADR-0004). §7's recommendation — atomic, no new state axis, no worker to operate, matches the already-synchronous command; the concrete costs (kernel must propagate subscriber failures, one cross-module lock order) are named in §5.C/§7.3 | Whether C-62 can start at all; the shape of every refusal and of the idempotency obligation |
| **PO-03** | **Is the accounting boundary defined on business documents, or on every ledger fact?** | Documents only (the four non-document writers — direct movement, direct transfer, material-request invocation — stay explicitly outside the boundary with their own future documents) · Ledger facts (every writer needs a subject and the direct endpoints need a decided accounting meaning or must be restricted) | **Documents only for C-61…C-66**, with the exclusion recorded as a decision rather than an omission (§3.2). The direct endpoints are internal/legacy surfaces; giving raw movements an accounting meaning without a document to carry eligibility, approval and correction would reopen exactly the problems the C-58 document runtime solved | The scope of the boundary epics; whether `POST /inventory/movements` and `POST /inventory/transfers` need deprecation or a document-level replacement first |
| **PO-04** | **What is one accounting voucher for one inventory document?** | One voucher per document, one line pair per **valuation key** · one line pair per **document line** · a periodically aggregated voucher per key/period | **One voucher per document; line composition decided with the accountant in C-63** (per key is the natural fit for MWA, per line preserves line-level traceability; both are honestly supportable — §10.3/§11.3). Voucher-per-document is required either way for traceability (contract §20.3) and for the single-use idempotency identity | The C-61 rule shape, the C-63 composition, the reconciliation drill-down |
| **PO-05** | **Does a key-level `stale` valuation state block accounting eligibility?** (finding E-1) | Status quo: only the document-level `valuationStale` blocks · Add: key `stale` blocks too | **Add it** (§9 F2) — the document-level flag can be false while the key that produced the value is `stale`; posting a value the valuation runtime itself declares untrustworthy contradicts OD-VAL-11's honesty rule | A small C-62 guard change (the keys are already locked on that path); the eligibility DTO's reason field |
| **PO-06** | **Does a warehouse transfer create a journal?** | T1 no journal for a one-legal-entity location move · T2 two-line entry with a branch/warehouse dimension · T3 inter-branch/inter-company settlement (deferred) | **T1 now** (§12.2): transferring stock between warehouses of one legal entity does not change the organization's inventory value, and the organization model is one legal entity (OQ-22/ADR-0021). T2 becomes meaningful only with the dimension decision (OQ-41/OQ-55); T3 belongs with OQ-31 and ADR-0026 §3 | The C-64 transfer delivery + the completeness record ("internal move — no accounting effect") that reconciliation needs |
| **PO-07** | **What happens when a valuation change would alter a posted document's value?** | P1 **block** the forward valuation change (fail closed) · P2 allow it and post a compensating journal automatically · P3 allow it only through an explicit correction document · P4 reverse the voucher, change, re-post | **P1** (§16.3), as a terminal state until the correction policy (OQ-27) and the counterpart flow (OQ-71) are decided; it is the only option that cannot silently make Inventory value and the ledger disagree, and it matches OD-RVP-03's fail-closed precedent. Whichever is chosen must be enforced in **all five** valuation writers, not only Reverse Pricing | C-65's whole design; the credibility of `accounting_posted` as an immutability statement |
| **PO-08** | **What is the linkage rule between an inventory document's lifecycle and its accounting document?** | (a) cancellation of an accounting-posted document is refused while a live voucher exists · (b) reversal of the voucher reopens the inventory document · (c) reversal of the voucher and correction of inventory are two independent, separately-authorized acts | **(c), with (a) as its guard** (§15.4): the ledger is append-only and the inventory document is not a voucher; a reversal must not silently reopen an operational document, and a cancellation must not silently destroy an accounting effect (ADR-0022). The two acts are linked by the cross-reference and by permissions, never by a cascade | The C-65 correction flow's two-way linkage; the `accounting_posted → immutable` transition's meaning |
| **PO-09** | **Is the proposed idempotency identity adopted as the permanent contract?** | I1 document key only · I2 document + rule version · I3 **operation key `invdoc:<id>:accounting-post` + request hash over source identity, document facts and the movement money facts (movementId, type, baseQuantity, totalCost, valuationSource), plus the rule version** | **I3** (§8.3) — same key + same money replays the stored voucher; same key + different money is a **409**, never a silent replay; the hash is what makes "posting is once-only" true while Inventory value remains mutable before the boundary | C-62's storage choice (`accounting_posting_operations` + the Inventory operation row); the retry semantics in §9 |
| **PO-10** | **Ratify the two-axis rule** (§5.E): domain eligibility (`accountingEligible`) and accounting delivery/posting are separate axes — no field may be overloaded, and no client may infer one from the other | Ratify as a standing rule · Leave it implicit | **Ratify.** Today the same command writes the boundary flag that a future integration will need as delivery evidence; without this rule the cheapest future implementation is also the wrong one (treat the flag as the acknowledgement) | §5.E becomes a documented contract; C-62's DTO/error vocabulary |
| **PO-11** | **Purchase return: what may post before the counterparty exists?** | Post the inventory half only and defer the settlement/variance half (OQ-70) and the payable/Party counterpart (no Purchasing/Party domain) · block the whole purchase-return posting until those exist · invent a clearing account (forbidden while OQ-70 is open) | **Block the accounting posting for purchase returns for now** (§13.3), inventory costing being already decided and implemented (OD-RET-01…07): a half-entry (inventory credit with no counterparty) would be an unbalanced voucher, and any offset would be an invented mapping | C-64's purchase-return half; the variance decision in OQ-70 |
| **PO-12** | **Sales return: what may post before Sales exists?** | Block all accounting for sales returns · post only the inventory-cost half (inventory re-entry) and defer revenue/receivable · build a revenue side without Sales (forbidden) | **Defer the whole sales-return accounting posting** until the Sales module defines revenue/receivable semantics (§14.2): the inventory half alone has no counterparty and no invoice base; the inventory costing itself is already decided (OD-RET-05…07) and is untouched by this deferral | C-64's sales-return half; the Sales module's dependency record (OQ-15) |

### 21.3 Open-Question resolution checklist

These registry rows **must move (or be explicitly narrowed) before the epic in the last column
can be enabled**. The middle column is what the resolution has to contain — it is written from
the audit, not invented.

| OQ | What its resolution must state | Blocks |
|---|---|---|
| **OQ-39** | The delivery shape for internal system postings: transactional (recommended, per PO-02) or durable; what happens to a source document whose posting is **refused** (period closed, mapping missing, account disabled) — block the source operation, or accept it with an exception queue; whether an internal outbox is ever required | **Any** production system-generated posting (AC-D-26, ADR-0026 §6) — C-62's enabling, C-63…C-66 |
| **OQ-24** | The accounting content the Inventory side cannot own: COGS/expense offset semantics, the return variance account, any write-down/NRV, cost-method precision effects on posting | C-61 rule content, C-63 receipt/issue posting, C-64 variance |
| **OQ-25** | The concrete control-role catalog and the mandatory set, and the base chart's approved content (Task 21 narrowed the governance, not the content) | **C-61 cannot start** — the resolver cannot name roles that do not exist |
| **OQ-42** | Posting mode: direct-final (Mode A) or reviewed temporary (Mode B), and the authority/permission combination for each; whether the mode is per-organization configuration | C-62's entry point and C-63's confirmation UX |
| **OQ-72 (NEW — opened by this audit)** | The authority for system-origin postings: the source module's permission (e.g. `Inventory.Document.AccountingPost`), a dedicated Accounting code, or both; and what audit evidence a worker-originated posting carries when no interactive principal exists | C-62's authorization contract and the audit trail of every system posting |
| **OQ-70** | The account mapping of a return's settlement variance (the costing rule is decided) | The variance half of C-64 |
| **OQ-31** | Transfer accounting beyond T1: inter-branch/inter-company meaning | T2/T3 and any inter-branch reporting (C-66 dimension views) |
| **OQ-27** | Correction policy: what may be corrected, in what window, by whom, and through which of AC-D-22's mechanisms | C-65's correction flow |
| **OQ-71** | The Accounting-side counterpart of Reverse Pricing: what reversing/deleting an accounting document involves and how Reverse Pricing is blocked or coordinated with it | C-65's reverse-pricing guard upgrade |
| **OQ-69** | Whether per-movement valuation history is required, and if so its shape (§17.5 proposes an append-only history inside the valuation transaction) | C-66's auditability surface and its migration |
| **OQ-40** | How the financial area is selected for a system posting (single area, warehouse→area, configuration default) | C-62's area resolution |
| **OQ-23** | Whether a posting may ever target a closed period with a special authority (the mechanism is implemented; the policy is not) | F10's final semantics |
| **OQ-30** | Whether tax lines belong in inventory-related postings at all | Any tax line in C-61/C-63/C-64 |
| **OQ-43** | Statutory constraints on corrections/retention, with authoritative legal validation | C-65/C-66 report and correction windows |
| **OQ-41 / OQ-55 / OQ-56** | Dimensions, branch/dimension model, two-book accounting — recorded as deferred by the Owner; the boundary design must stay additive to them | Only the later C-66 dimension-aware views; not the boundary itself |
| **OQ-03 / OQ-11 / OQ-15 / OQ-17** | Secondary and untouched: money precision, ledger-policy restatement, sales→inventory workflow, retention — checked in §4.2, none blocks C-61/C-62 | Nothing in the boundary epics |

### 21.4 Decision → epic map

| Decision | Unblocks | Does not unblock |
|---|---|---|
| PO-01, PO-02, PO-03, PO-04, PO-05, PO-09, PO-10 + OQ-39 + OQ-42 + OQ-72 | C-62 (and therefore C-63…C-66) | — |
| OQ-25 + PO-04 + OQ-24 | C-61 → and with it the resolver every later epic consumes | — |
| PO-06 + OQ-70 + OQ-31 | C-64 | — |
| PO-07 + PO-08 + OQ-27 + OQ-71 | C-65 | — |
| OQ-69 + the mapping decisions | C-66 | — |
| PO-11, PO-12 | C-64's return halves (inventory-side costing is already legal and implemented) | Their accounting sides until Purchasing/Sales exist |

### 21.5 Standing preconditions this register does not reopen

The contract's activation gate (AC-D-27/§20.4) stands: a system posting may be *enabled* only
when (1) the accounting content decisions are recorded, (2) the posting rules exist and have
been reviewed by an accountant, and (3) the delivery shape is resolved (OQ-39). The enablement
itself must be an explicit, per-organization switch that defaults to **off**, and with it off
the runtime behaves exactly as it does today (C-62's acceptance criterion 4). Nothing in this
package authorizes enabling anything.

### 21.6 Final-report format (used by §22 and required for every following slice)

```
C-6x <slice name>
Status:  READY FOR REVIEW | READY FOR CI VERIFICATION | BLOCKED
Scope:   what was authorized; what was changed (files/areas); explicit non-changes
Evidence: local verification (commands + exact results); CI run reference
Deliverables: path — one line each
Decisions requested (PO-xx) and OQs opened/narrowed/closed
Not done / deferred / out of scope
Verdict: one line, ending in exactly one of the three status values
```

A report may claim `READY FOR REVIEW` only when every required artefact is committed, local
gates are green and no known defect remains; `READY FOR CI VERIFICATION` when local gates are
green but the required CI evidence is still pending; `BLOCKED` when an open question, a missing
decision or an environment gate prevents completion — with the blocking ID named.

---

## 22. Sprint Final Report — C-60

**C-60 — Inventory → Accounting Boundary & Decision Sprint**

**Status: READY FOR REVIEW**

**Scope.** Documentation and audit only, exactly as authorized. **Zero** production change: no
backend or frontend source file, no Prisma schema, no migration, no API, no permission, no event
consumer, no posting rule, no test, no CI configuration, no dependency. The deliverable is this
package plus the registry change named below. The C-59 decisions are not reopened and no
valuation behaviour is redesigned.

**Deliverables.**

- `docs/tasks/c-60-inventory-accounting-boundary-and-decision-package.md` — this package:
  current-state matrix, boundary definition and options, per-flow analysis (receipt, issue,
  transfer, purchase return, sales return, reversal/correction), Pricing↔Accounting analysis,
  OQ-69 auditability assessment, event/integration options with one recommendation,
  `accountingEligible` semantics, frontend surfaces, security/organization isolation, sixteen
  failure scenarios (plus extras), a dependency graph, six proposed epics (C-61…C-66) and the
  Product Owner decision register (PO-01…PO-12).
- `docs/open-questions.md` — **OQ-72 opened** (authorization of system-origin postings), the one
  genuinely new question this audit found.
- `STATE.md` — the C-60 record added to the task history.

**Evidence (local, lightweight by policy — no suites, no live database, no E2E, no migration
rehearsal).** `git diff --check` clean; the package's cross-references, OQ/PDR/ADR identifiers
and code/anchor references checked against the tree; the only files in the diff are
documentation files. Heavy verification is delegated to the PR pipeline, whose run reference is
recorded in the pull request.

**Decisions requested.** PO-01…PO-12 (§21.2) and the resolutions in §21.3, of which **OQ-25**
blocks C-61, **OQ-39** blocks any production posting, and **OQ-72** (new) blocks C-62's
authorization contract.

**Opened / narrowed / closed.** Opened: **OQ-72**. Narrowed: none — the audit deliberately
records the existing rows as they are. Closed: none (only the Owner resolves registry rows).

**Not done / deferred / out of scope.** No implementation of the boundary, no posting rules, no
delivery mechanism (OQ-39 open), no correction flow, no valuation-history table (OQ-69 open), no
frontend change, no epic scheduling or estimates, no reopening of C-59 decisions or of the
implemented valuation semantics. The stale PDR-08 §8 row (OD-PRC-11) is **recorded, not
edited** — changing a decision record is the Owner's act.

**One documentation defect recorded, not fixed:** PDR-08 §8's OD-PRC-11 row still describes the
accounting-eligibility gate as unimplemented; PR #125 implemented it. Recorded in §2.5.

**Verdict: READY FOR REVIEW** — the audit is complete, the decision space is enumerated with
options, recommendations and named blocking OQs, local gates are green, and no implementation
claim is made anywhere.

---

*End of C-60 package. This document authorizes nothing; every implementation item above is
gated on a Product Owner decision in §21.*
