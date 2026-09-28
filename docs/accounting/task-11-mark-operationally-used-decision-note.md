# Task 11 D4 — `markOperationallyUsed`: decision note (documentation only, no implementation)

Status: **Decision note** (no code, no schema change) · Date: 2026-09-22 · Task: Task 11 remediation §9 (Operational freeze)
Related: ADR-0028, [`configuration.md`](./configuration.md) §Operational Freeze, OQ-64 (registered by this note)

> **IMPLEMENTED — 2026-09-23 (Task 13).** The three questions this note left open
> are decided and wired: the marker is written from
> `AccountingDocumentsRepository.finalizeChecked` through
> `markConfigurationsUsedByDocumentInTx`
> (`backend/src/modules/accounting/data/accounting-configuration-usage.ts`) for
> the distinct configurations the voucher's lines pinned; it sits at the module's
> existing configuration position of the lock order, recorded as row `D4″` in
> `docs/accounting/lock-order-matrix.md`; and `operationally_used_at` is
> first-use-wins by a single guarded statement. §5's recommended resolution is
> what was implemented, including its two open sub-points (Account creation/
> activation marks nothing; `PostingService.markConfigurationUsed` was NOT added —
> the seam stays in the data layer and the service method is caller-free).
> Evidence: `docs/task-13-implementation-report.md` + the real-PostgreSQL
> rehearsal log `docs/accounting/task-13-evidence/postgres-rehearsal.log`.
> **OQ-64: RESOLVED** (moved to the Resolved table in `docs/open-questions.md`).
>
> The text below is the **2026-09-22 analysis, preserved verbatim as the decision
> record** — including §1's "what exists today" inspection, which described the
> pre-Task-13 state (no caller, no resolution, no ledger read path). It is not
> maintained as current architecture; `docs/accounting/configuration.md` §Operational
> freeze — wired (Task 13) is.

> This note inspects the operational-freeze abstraction that Task 11 (D4) left
> without a caller and records what must be decided before it is wired up. It
> deliberately implements nothing: the invariant ("which configuration does a
> voucher use?") and the transaction semantics are **not** unambiguous yet, and
> §9 forbids guessing.

## 1. What exists today (inspection result)

| Piece                                                                                                                                                                                       | Location                                                                                  | State                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Freeze state resolver / guard (`resolveFreezeState`, `isConfigurationFrozen`, `assertConfigurationMutable`, `assertConfigurationDeletable`, `ConfigurationFrozenError`, `OperationalUsage`) | `domain/accounting-configuration-freeze.ts`                                               | Pure, framework-free, unit-tested. No production consumer.                                                                                                                                                                     |
| Marker column `operationally_used_at TIMESTAMPTZ(6)` NULL                                                                                                                                   | `accounting.accounting_configurations`                                                    | Created by the Task 11 migration; nullable, no default, no index.                                                                                                                                                              |
| Repository seam `markOperationallyUsed({ id, now })`                                                                                                                                        | `data/accounting-configurations.repository.ts:396`                                        | **Idempotent by read-then-write**: returns the existing row when `operationally_used_at` is already set, otherwise one `UPDATE`. **Not** transaction-aware (`this.client()`, not `transacting()`); a single writer is assumed. |
| Application seam `AccountingConfigurationsService.markOperationallyUsed(id)`                                                                                                                | `application/accounting-configurations.service.ts`                                        | **No production caller.** Kept deliberately as the freeze seam; documented as deferred.                                                                                                                                        |
| Callers in code                                                                                                                                                                             | –                                                                                         | none; only unit tests and the in-memory fake exercise it.                                                                                                                                                                      |
| Regression that keeps it honest                                                                                                                                                             | `test/accounting-configuration-live.e2e-spec.ts` ("D4: … NOT called on Account creation") | Asserts `operationallyUsedAt` stays `NULL` after `AccountsService.createAccount`.                                                                                                                                              |

D4 (ADR-0028) already decided **what** the marker means: a configuration that has
affected Transaction/Posting/Reporting is frozen for destructive change; a new
version or a controlled migration is the way forward. D4 also decided the caller
is **not** account creation: it is Posting / System Posting at the first
Voucher. What was left open is everything below.

## 2. Proposed caller

`PostingService.postVoucher(...)` — specifically the branch that actually
transitions the voucher to `final` and writes ledger entries
(`data/accounting-documents.repository.ts: finalizeChecked`), **not**:

- `AccountsService.createAccount` (creating a chart is not operational use);
- `AccountingDocumentsService.createDocument` / `issue` (a draft or temporary
  voucher has no ledger effect);
- `PostingService` replays (see §5).

Rationale: the first ledger entry written against a configuration is the exact
moment the configuration starts affecting Posting/Reporting — the trigger D4
names.

## 3. Transaction boundary (the blocking issue)

The marker must be written **in the same transaction** as the first ledger
entries, otherwise a crash between "entries committed" and "marker written"
leaves a used configuration that looks unused (the freeze guarantee would be
silently void).

That collides with a documented invariant: the module's lock order is
`area → year → period → account → document` (`data/accounting-locks.ts`), and
posting additionally takes `FOR SHARE` on the referenced account rows
(`lockAccountsForLinesInTx`). A configuration row lock has **no assigned
position** in that order today. Root-account creation takes
`coding-structure version → accounting configuration → account row`
(`AccountsRepository.createChecked`), so naively updating configuration rows at
the end of finalization could invert that pair and deadlock a concurrent root
create against a concurrent finalize.

Deciding this needs: (a) a position for the configuration lock in the global
order (candidates: before accounts, or lock-free single-statement update), and
(b) a written deadlock analysis against `createChecked`, `publishChecked`
(`lockAccountingConfigurationsOfOrganization`) and `updateChecked`. None of that
exists yet — hence this note.

## 4. Failure behavior

Options considered:

1. **Marker failure aborts the finalization** (same statement/transaction;
   FK guarantees the configuration row exists while accounts reference it, so
   failure means a real anomaly). Deterministic: nothing is posted unless the
   freeze marker is recorded. **Recommended.**
2. Best-effort + log/audit: rejected — it re-creates exactly the hole D4 exists
   to close (a used configuration that can still be destructively mutated).
3. Async/worker marking: rejected — no outbox/queue in scope (ADR-0028
   non-goals) and it reintroduces the crash window of §3.

## 5. Idempotency and replay

- **Idempotency shape:** the current read-then-write repository method is
  idempotent for sequential calls but racy under concurrent finalizations (both
  read `NULL`, both write a timestamp; last writer wins). The implementation
  must become a single guarded statement, e.g.
  `UPDATE … SET operationally_used_at = :now WHERE id = ANY(:ids) AND operationally_used_at IS NULL`,
  followed by a re-read for the response — **first use wins**, later timestamps
  never overwrite.
- **Replay behavior:** `postVoucher` replays on the existing
  `(organization_id, operation_key)` + `request_hash` identity by re-reading
  current rows. Replay must not touch the marker (the first-finalization branch
  already returns early); a _rejected_ or rolled-back finalization must leave
  `operationally_used_at` `NULL` — guaranteed by §3's same-transaction rule.
- **Idempotent request, different hash** (409) and readiness refusals never
  reach the write branch, so they never mark.

## 6. Multi-configuration vouchers (second blocking issue)

A voucher's **lines** reference accounts; every account carries its own
`accounting_configuration_id` (D1). Nothing constrains a voucher to accounts of
one configuration, and Task 11's own backfill produces organizations where that
is normal: after the LEGACY configuration is created, older accounts stay
pinned to `LEGACY` while new roots pin the newly published `DEFAULT`
configuration — a single voucher may legitimately reference both.

Therefore "mark **the** configuration" is undefined. Candidate rules:

| Rule                                                                | Effect                                   | Problem                                                                                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mark every distinct configuration referenced by the voucher's lines | Freezes exactly what the posting touched | Needs the line→account→configuration read inside the finalization transaction; more rows/locks per finalization                                                  |
| Mark the organization's currently `ACTIVE` configuration            | One row, simple                          | Wrong when the voucher references only LEGACY/pinned-superseded accounts — it would freeze a configuration the voucher never used and leave the used one mutable |
| Forbid mixed-configuration vouchers at posting                      | One configuration per voucher            | A new business rule (needs a decision + a migration plan for existing data), and it would refuse legitimate legacy vouchers — out of Task 11 scope               |

Also open: whether a `SUPERSEDED` configuration referenced by a new voucher
should be marked (it is already immutable, so the marker is audit-only) or left
alone.

## 7. Recommendation

1. Keep the abstraction unwired. Keep the regression that account creation does
   not mark (§1) so the deferral cannot silently regress.
2. Resolve OQ-64 (voucher → configuration cardinality and the lock-order
   position) before implementing; the decision belongs to the Posting /
   System-Posting task, with an ADR-level statement if a mixed-configuration
   voucher is to be refused.
3. When implemented, the shape is fixed by this note: same transaction as the
   first ledger entries, single-statement first-use-wins idempotency, failure
   aborts finalization, replay does not re-mark, and the set of marked
   configurations is the decided one from §6.
