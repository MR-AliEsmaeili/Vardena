# Task 10.8 — Posting Orchestration Seam: Implementation Report

Date: 2026-09-16 · Branch: `arena/01a0ab4d-vardena` · Base: `1784216` (merge of
PR #22, Task 10.7 accepted) · Task 10.7 implementation commit:
`6946ea6e3892f1408212f7b6e215fbf9164f675a`

---

## 1. Implementation summary

**Status: READY FOR REVIEW.**

One new application use case exists after this task: **`PostingService`**
(`backend/src/modules/accounting/application/posting.service.ts`), with one
public method, `postVoucher({ organizationId, voucherId, operationKey })`. It
is the single boundary through which posting is reached, and it _coordinates_ —
it decides no accounting rule of its own:

```
PostVoucherCommand { organizationId, voucherId, operationKey }
  │
  ├─ 1. resolve the voucher in the organization scope        (404, AC-I-01/16)
  ├─ 2. idempotency: replay │ conflict │ proceed             (§16.4, AC-I-12)
  ├─ 3. lifecycle verdict (`planVoucherFinalize`)            (§15.1/§15.5)
  ├─ 4. ATOMIC posting persistence — Task 10.7's ONE transaction,
  │      called, never wrapped: fixed lock order, in-transaction
  │      re-validation, state=final, N immutable LedgerEntries
  │      (one per stored line), `accounting_posting_operations` LAST
  ├─ 5. publish `AccountingDocument.Finalized`               (§21, AC-D-20)
  ├─ 6. Task 10.5 readiness verdict on the FINAL voucher
  └─ 7. result: `PostingInput` + `PostingResult` (Task 10.6) built
         from the STORED rows, ledger completeness + snapshot re-checked
  ▼
PostingOutcome { kind: 'posted' │ 'replayed', document, input, result }
```

`AccountingDocumentsService.finalizeDocument` is now the **HTTP-facing shell**
of that seam: authorize `Accounting.Document.Finalize` → delegate → map the
outcome onto the document DTO and the repository's guard errors onto the API
error model. Nothing else changed in the module.

**No duplicate abstraction was created.** The reconnaissance the brief asks for
(§3) found that the posting orchestration _already existed_ — but it existed
**inside** `AccountingDocumentsService.finalizeDocument`, mixed with the
voucher aggregate's other six operations, and `PostingReadinessService`
(Task 10.5) plus `toPostingResult`/`PostingResult` (Task 10.6) had **no
production caller at all** (verified: `grep` found only specs). This task
therefore _extracted and refined_ the existing boundary into a named use case
and wired the two orphaned contract seams into it, rather than adding a second
orchestrator beside it. `git grep finalizeChecked` now has exactly **one**
production call site (`posting.service.ts:193`), which is the mechanical proof
that there is one boundary and that the HTTP finalize route provably runs
through it.

**This is not a Posting Engine.** §6 audits every non-goal; nothing was added.

## 2. Files changed

| File                                                                         | Kind                           | Why it was necessary                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/modules/accounting/application/posting.service.ts`              | **new** (534 lines, ~50 % doc) | The seam itself: `PostingService`, `PostVoucherCommand`, `PostingOutcome`/`PostingOutcomeKind`, and `assertPostedLedger` (the stored-row integrity assertion). AC-01…AC-08, AC-12.                                                                                                                                                                                                                        |
| `backend/src/modules/accounting/application/posting.service.spec.ts`         | **new** (1127 lines, 18 tests) | Proves the seam: valid posting, replay, conflict, readiness rejection, lifecycle refusal, org isolation, four rollback classes, concurrency, ledger completeness/snapshot, immutability, delegation. §5.                                                                                                                                                                                                  |
| `backend/src/modules/accounting/application/accounting-documents.service.ts` | modified (−133/+36)            | `finalizeDocument` delegates to the seam (AC-01: callers must not duplicate orchestration). The two private helpers the seam also needs moved to the shared support file (§3.4). No other operation touched.                                                                                                                                                                                              |
| `backend/src/modules/accounting/application/accounting-document-support.ts`  | modified (+86)                 | Received `documentOperationRow` and `publishDocumentEvent` **verbatim** from the service, so the idempotency ROW shape and the `AccountingDocument.*` payload have exactly one definition each. This is the file's own stated role ("the things that must not drift between the voucher's operations"); it previously documented the guard-error mapping as belonging here while it lived in the service. |
| `backend/src/modules/accounting/accounting.module.ts`                        | modified (+11)                 | Registers `PostingService` as a provider — **provided, not exported** (its only caller is in-module; a cross-module caller needs §16.3 + OQ-39 first, AR-07).                                                                                                                                                                                                                                             |
| `docs/modules.md`                                                            | modified (+30/−2)              | AG-07 doc sync: the Accounting entry gains a "Posting orchestration seam (Task 10.8)" bullet beside the Task 10.5 readiness bullet, and the `POST :id/finalize` line records that the route is now the seam's shell (and that there is still no `POST :id/post`).                                                                                                                                         |
| `docs/task-10.8-implementation-report.md`                                    | **new**                        | This report (the 10.4/10.5/10.7 convention).                                                                                                                                                                                                                                                                                                                                                              |

**Not touched** (verified with `git status`): `prisma/schema/*`, `prisma/migrations/*`,
every `api/` controller and DTO, `domain/accounting-permissions.ts`,
`application/accounting-permission-registration.ts`, `domain/accounting.events.ts`,
`data/accounting-locks.ts`, `data/accounting-documents.repository.ts`,
`data/ledger-entries.repository.ts`, `data/accounting-posting-operations.repository.ts`,
`domain/posting.ts`, `domain/posting-readiness.ts`, `domain/ledger-entry.ts`,
`domain/money.ts`, `application/posting-readiness.service.ts`, every other module,
`docs/open-questions.md`, every ADR, `test/**` (no existing test was edited), and
the CI workflow. There is no frontend in this repository.

## 3. Contract verification (how 10.6 / 10.5 / 10.7 were reused)

### 3.1 Task 10.6 — the Posting contract, reused, not competing (AC-02)

No new input type was declared. The seam consumes `domain/posting.ts` exactly
as written:

- `toPostingInput({ document, operationKey, requestHash })` builds the
  `PostingInput` from the FINAL aggregate, so its preconditions (final,
  numbered, `finalizedAt` evidence) are enforced by the contract itself;
- `checkPostingInput(input)` re-asserts the whole input contract on the
  produced snapshot, and a non-empty verdict is a loud internal error — the
  seam never repairs and never posts anyway;
- `PostingResult` (Task 10.6's corrected shape, **no `id`**) is the outcome's
  result type. The spec pins `'id' in outcome.result === false` and that no
  entry id equals the evidence row's id, a line id or the voucher id.

`toPostingResult` is deliberately **not** called: it _generates_ entries with
fresh ULIDs as the pure contract transform, and re-deriving identities for
evidence that is already persisted would invent a second identity for the same
rows. The `PostingResult` is assembled from the entries read back through
`LedgerEntriesRepository.findByVoucher`, so the reported ids are the stored
ones. That reasoning is in the code comment, not only here.

The conceptual field list in the brief maps 1:1 onto the existing
`PostingInput` (`sourceIdentity` → the existing `source: PostingSource | null`,
which is the repository's naming; every other name matches verbatim).

### 3.2 Task 10.5 — readiness, consumed, never re-implemented (AC-03)

`PostingReadinessService.evaluateReadiness` is the seam's only readiness
source; no reason code, no decision and no snapshot assembly is duplicated
here. Because Task 10.5's contract evaluates a **final** voucher
(`document_not_final` otherwise), the verdict is consulted where a final
voucher exists, and it means one thing per path — both documented in the class
header:

- **replay path** — a _refusal_: `not_ready` ⇒ `422` with
  `{ problem: 'posting_not_ready', reasons }` (the Task 10.5 reason objects,
  verbatim). This request mutated nothing, so refusing is truthful, and §16.4's
  "replay the stored result (re-reading **current** rows, never a stale
  snapshot)" is exactly what the evaluation does. The spec reaches it through
  the one _reachable_ drift Task 10.5 documents (a fiscal year's dates edited
  while it is open), not through a mock.
- **fresh path** — an _assertion_: `finalizeChecked` re-validated every
  readiness dimension under the area/year/period/account/document locks
  microseconds earlier and a `ready` verdict on a final voucher is stable
  (Task 10.5), so `not_ready` there means the stored books contradict the
  module's own guarantee. It throws a plain internal `Error`, **not** a 4xx:
  the posting DID commit, and a 422 would tell the caller the opposite.

A pre-transaction readiness _gate_ on a `temporary` voucher was considered and
rejected: it would either be the constant `document_not_final` (no
information) or require filtering reasons out of the Task 10.5 verdict — which
is re-interpreting the contract, i.e. the duplication AC-03 forbids. The
`document_not_final` dimension is enforced by the existing lifecycle table
(`planVoucherFinalize`), and the spec asserts both verdicts side by side for a
draft.

### 3.3 Task 10.7 — atomic persistence, reused unwrapped (AC-04, AC-13)

Step 4 is a **call** to `AccountingDocumentsRepository.finalizeChecked` with
the same input the service used to build (`id`, `organizationId`, the
`document_finalize` ledger row, `finalizedAt`, `finalizedBy`). Therefore,
unchanged and by construction:

- ONE transaction — the seam holds no `PrismaService` and no transactional
  client, so it _cannot_ open one. The spec fixture hands it none, which is the
  structural proof (the suite could not pass otherwise);
- the lock order stays area → year → period → accounts `FOR SHARE` → document
  `FOR UPDATE`; the seam imports no lock helper and takes no lock;
- re-read/revalidate inside the transaction, state update, `toPostingInput` →
  `toLedgerEntries` → `insertLedgerEntries`, then `insertOperationRow` LAST;
- rollback of everything on any failure.

The raced-key handling also moved with the act: on `isUniqueViolation` the seam
re-runs its own replay-or-reject (the winner's row decides) and otherwise
propagates the data layer's error untouched, so the caller's one mapping table
still answers 409/422/404 exactly as before.

### 3.4 What moved, and why it is not a drive-by refactor

Two private helpers of `AccountingDocumentsService` moved **verbatim** to
`accounting-document-support.ts`, because the seam needs the same two shapes
and a second copy would be exactly the drift that file exists to prevent:
`operationRow` → `documentOperationRow` and `publishDocumentEvent` →
`publishDocumentEvent(events, type, document)`. Behaviour is identical (the
same fields, the same payload, the same event names); the four remaining call
sites in the documents service were updated mechanically. `mapDocumentGuardError`
was **not** moved and the HTTP error mapping was **not** pushed into the seam:
§16.5 and OQ-39 leave a future system posting's authority and delivery
undecided, so baking the HTTP error model into the posting act would
pre-commit an open question. The seam speaks the data layer's guard errors and
its own `AppException`s; the calling use case maps them.

`replayOrReject` was **not** unified. The documents service keeps its copy for
`document_create` (its own operation, with its own number allocation) and the
seam owns the `document_finalize` copy. That is the repository's established
posture — Inventory has one private `replayOrReject` per posting service
(`inventory-movements`, `-reservations`, `-transfers`) — and it keeps the
diff to accepted Task 10.4 code at zero for that method.

## 4. Invariants verified

| Invariant                                            | Enforced by                                                                                                                                                                                                                                    | Proven by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One orchestration boundary (AC-01)                   | `finalizeDocument` delegates; `finalizeChecked` has one production caller                                                                                                                                                                      | `git grep finalizeChecked src` (only `posting.service.ts:193`); `delegates the atomic act…` (exactly one call for a post + its replay)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Existing PostingInput/PostingResult contract (AC-02) | `toPostingInput`/`checkPostingInput`/`PostingResult` imported from `domain/posting.ts`; no new input type                                                                                                                                      | `posts a temporary voucher…` (`checkPostingInput(outcome.input) === []`, hash/operationKey round-trip)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Readiness enforcement (AC-03)                        | `PostingReadinessService` consulted on both paths                                                                                                                                                                                              | `refuses to replay a posting whose stored voucher is no longer posting-ready` (422 + the Task 10.5 reasons, zero mutation); `refuses what the lifecycle refuses…` (draft ⇒ `not_temporary` **and** readiness `document_not_final`)                                                                                                                                                                                                                                                                                                                                                                                     |
| Atomicity (AC-04)                                    | Step 4 is a plain call to the Task 10.7 transaction; the seam holds no Prisma client                                                                                                                                                           | The four rollback tests + the delegation test's structural argument                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Replay (AC-05)                                       | Same `(org, key)` + same hash ⇒ re-read current rows                                                                                                                                                                                           | `replays the same key with the same hash…`: same entry ids, same `postedAt`, one evidence row, **one** event, all eight tables deep-equal unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Conflict (AC-06)                                     | Different hash _or_ different kind ⇒ 409 before any transaction                                                                                                                                                                                | `refuses the same key with a different hash…` (other voucher stays `temporary`, 0 entries, one evidence row, stores deep-equal); `refuses a key already used for another operation kind`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Ledger completeness 1:1 (AC-07)                      | `assertPostedLedger` on stored rows (+ the transaction's own count assertion and `uq_ledger_entries_voucher_line_id`)                                                                                                                          | `posts a temporary voucher…` (2 lines ⇒ 2 entries, `voucherLineId` set equals the line id set); `verifies the stored sourcing snapshot…`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Snapshot integrity (AC-08)                           | `assertPostedLedger`: org, area, year, period, voucher, number, branch, `lineNo`, `accountId`, debit, credit, description, `documentDate`, `postingTimestamp`, `finalizedBy`, `correlationId`, `origin`, `source`, `voucherLineId ∈ voucherId` | `verifies the stored sourcing snapshot against the voucher (AC-08)` (column by column) + the negative cases (tampered area ⇒ throws; short set ⇒ throws); `refuses to report a replay whose stored entry drifted…` (end to end through the seam)                                                                                                                                                                                                                                                                                                                                                                       |
| Exact money (AC-09)                                  | No `Number`/`parseFloat` anywhere in the new code; amounts compared as stored decimal strings; `numeric(18,2)` untouched                                                                                                                       | `persists money exactly…`: `0.10` canonicalizes to `0.1`, and `9999999999999999.99` survives verbatim while `String(Number('9999999999999999.99'))` is `'10000000000000000'` — the float trap pinned in the test itself                                                                                                                                                                                                                                                                                                                                                                                                |
| Failure rollback (AC-10)                             | The fake's `withRollback` mirrors `$transaction`; the seam adds no write of its own                                                                                                                                                            | ledger-insert failure, **partial** ledger insert (first row lands, second throws ⇒ zero rows remain), the 1:1 `voucher_line_id` backstop (only the hand-written row remains), evidence-insert failure — each asserts `temporary` + 0 entries + 0 evidence rows + 0 events                                                                                                                                                                                                                                                                                                                                              |
| Concurrency (AC-11)                                  | The document lock + the `(org, key)` unique backstop, both unchanged                                                                                                                                                                           | `posts once under concurrent attempts…`: `Promise.allSettled` ⇒ exactly one `posted`, the loser rejected with `AccountingDocumentPhaseConflictError` (the caller maps it to 409), one evidence row, one entry set, one event                                                                                                                                                                                                                                                                                                                                                                                           |
| Immutability (AC-12)                                 | No mutation verb exists                                                                                                                                                                                                                        | `exposes no ledger update, delete or upsert path`: `Object.getOwnPropertyNames(LedgerEntriesRepository.prototype)` is exactly `['client','constructor','findByVoucher']`; a post + replay leaves the ledger table deep-equal. Structural second proof: `AccountingTxClient.ledgerEntry` is `Pick<LedgerEntryDelegate,'createMany'>` (`data/accounting-rows.ts:795`), so even a future in-transaction writer has only an insert. `git grep -iE 'ledgerEntr(y\|ies)\.(update\|delete\|upsert)' src test` ⇒ no application hit (the only `deleteMany` calls are live-test `afterAll` cleanup through the raw test client) |
| Lock ordering (AC-13)                                | `data/accounting-locks.ts` untouched; the seam takes no lock                                                                                                                                                                                   | File unmodified (`git status`); the delegation test's structural argument                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| No source integration (AC-14)                        | Nothing outside Accounting was touched                                                                                                                                                                                                         | `git status` (§2); the fresh-posting test asserts lines/areas/years/periods/accounts deep-equal unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| OQs open (AC-15)                                     | No OQ-gated behaviour decided                                                                                                                                                                                                                  | `docs/open-questions.md` byte-identical (`git status` shows no change); §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Evidence identity only                               | `accounting_posting_operations.id` is never returned as a posting or ledger identity                                                                                                                                                           | `keeps the ledger identity independent from the operation evidence identity`; `'id' in outcome.result === false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 5. Tests

Exact commands, run from `backend/`, and exact results.

| Gate            | Command                                             | Result                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format          | `npm run format:check`                              | ✅ `All matched files use Prettier code style!`                                                                                                                                                                                                                                                                                                                                |
| Lint            | `npm run lint`                                      | ✅ `Found 0 warnings and 0 errors.` — `428 files`, 96 rules (baseline: 426 files)                                                                                                                                                                                                                                                                                              |
| Typecheck       | `npm run typecheck`                                 | ✅ clean (`tsc --noEmit`)                                                                                                                                                                                                                                                                                                                                                      |
| Build           | `npm run build`                                     | ✅ clean (`nest build`)                                                                                                                                                                                                                                                                                                                                                        |
| Unit            | `npm test`                                          | ✅ **71 files / 884 tests passed** (baseline 70 / 866 ⇒ **+1 file, +18 tests**, 0 failures)                                                                                                                                                                                                                                                                                    |
| E2E             | `npm run test:e2e`                                  | ✅ **189 passed / 37 skipped** over **15 passed / 7 skipped** files (22) — **byte-identical to the baseline**, i.e. zero regression through the delegation                                                                                                                                                                                                                     |
| Prisma validate | `DATABASE_URL=… npm run prisma:validate`            | ⛔ **BLOCKED** (sandbox egress): `request to https://binaries.prisma.sh/…/schema-engine.gz.sha256 failed … Client network socket disconnected before secure TLS connection was established`. Not a gate for this task: **no schema or migration file changed** (§2). Unchanged since Task 10.4. CI runs both Prisma steps green (`Prisma validate`, `Prisma generate` — §9.1). |
| Live-DB suites  | `npm run test:e2e` with `VARDENA_TEST_DATABASE_URL` | ⛔ **SKIPPED locally — no PostgreSQL in this sandbox.** Verified: no `psql`, no `docker`, TCP `127.0.0.1:5432` refused. The 37 skipped tests (7 files) are the live suites. **They are not counted as passing locally** — but CI ran them against real PostgreSQL on PR #23 and they pass (`Migrate test database` + `E2E tests (incl. live-DB suites)` both green, §9.1).     |

Baselines were measured on the clean base commit before any edit
(`lint` 426 files 0/0 · `typecheck` ✅ · `build` ✅ · unit 70/866 · e2e
189/37 skipped), so every number above is a real before/after comparison.

**What the 18 new tests are** (`src/modules/accounting/application/posting.service.spec.ts`,
real `PostingService` + real `PostingReadinessService` + the repository's
existing in-memory fakes — no second fake architecture was built):

1. `posts a temporary voucher: state, one entry per line, one evidence row, one event`
2. `keeps the ledger identity independent from the operation evidence identity`
3. `persists money exactly: canonical decimal strings, never a float`
4. `replays the same key with the same hash: no second entry set, evidence row, finalization or event`
5. `refuses the same key with a different hash: 409 and no financial mutation`
6. `refuses a key already used for another operation kind (409)`
7. `requires an operationKey and answers the uniform 404 across organizations`
8. `refuses what the lifecycle refuses, without touching the books`
9. `refuses to replay a posting whose stored voucher is no longer posting-ready`
10. `rolls the whole posting back when the ledger insert fails`
11. `rolls the whole posting back when only part of the entry set could be written`
12. `rolls the whole posting back on the 1:1 voucher_line_id backstop`
13. `rolls the whole posting back when the idempotency evidence insert fails`
14. `posts once under concurrent attempts with the same operationKey`
15. `verifies the stored sourcing snapshot against the voucher (AC-08)`
16. `refuses to report a replay whose stored entry drifted from its voucher line`
17. `exposes no ledger update, delete or upsert path (AC-I-05/06)`
18. `delegates the atomic act: exactly one finalizeChecked call, no transaction of its own`

**Existing tests were not modified, weakened or deleted.** No new e2e file was
added: `test/accounting-documents.e2e-spec.ts` (the finalize journey, the
ledger journey, the replay/conflict journey and the scope audit that asserts
`POST :id/post` is 404) and `test/ledger-entries-live.e2e-spec.ts` (real
atomicity, real rollback, real concurrency, real `numeric(18,2)`) already run
**through** this seam, since the HTTP route delegates to it — which is why the
e2e numbers are identical rather than larger. Adding a parallel HTTP suite for
the same journeys would have been the "second fake architecture" the brief
forbids.

## 6. Scope audit — non-goals, explicitly untouched

| Forbidden                                                                                                        | Touched? | Evidence                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Posting Rules Engine, account mapping, configurable accounting rules, control roles, account selection           | **No**   | The seam contains no rule; step 4 delegates. `grep -i "rule engine\|posting rule\|control role\|mapping" posting.service.ts` ⇒ only the header sentence stating their absence                                                                                                                 |
| Dimensions (columns, EAV, JSONB, binding, validation framework)                                                  | **No**   | No schema change; `dimensionAssignments` stays `[]` (asserted in the spec); OQ-41 untouched                                                                                                                                                                                                   |
| Balances, projections, trial balance, statements, reports, closing, reopening, reversal, correction, replacement | **No**   | No such code path; `PostingResult` carries entries only (balances excluded by the Task 10.6 contract)                                                                                                                                                                                         |
| Inventory/Sales/Purchasing/Treasury/Payroll → Accounting integration, source adapters                            | **No**   | No file outside `modules/accounting` changed except `docs/modules.md`; no event consumer added; the fresh-posting test asserts nothing outside the voucher aggregate changed                                                                                                                  |
| Transactional outbox, queue, worker, Redis, Kafka, broker, microservices                                         | **No**   | No such import or provider; the only publication is the existing in-memory `AccountingDocument.Finalized` (AC-D-20). OQ-39 not resolved                                                                                                                                                       |
| Public Posting API, public Ledger CRUD, frontend, new permissions, new RBAC                                      | **No**   | No `api/` file changed; the permission registry and `accounting-permissions.ts` are untouched (still 29 codes); `LedgerEntriesRepository` still exposes one scoped read; the existing scope-audit e2e (`POST :id/post` ⇒ 404) still passes unmodified; there is no frontend in the repository |
| Schema redesign of Voucher / VoucherLine / LedgerEntry / `accounting_posting_operations`                         | **No**   | `git status backend/prisma` ⇒ empty. No migration, no composite FK, no trigger, no constraint                                                                                                                                                                                                 |
| Drive-by refactors, unrelated formatting, renames, dependency upgrades                                           | **No**   | 6 files (§2); `package.json`/`package-lock.json` untouched; `prettier --write .` reformatted only the new spec; the two moved helpers are the minimum the seam needs to avoid duplicating the row shape and the event payload                                                                 |

## 7. Open questions — OQ-39 … OQ-43 remain open

`docs/open-questions.md` is **byte-identical** (not in `git status`). No ADR was
added or amended (none is required: no new module, no new cross-module pattern,
no dependency, no schema change, no event-contract change — AR-29).

- **OQ-39 (durable event/outbox semantics) — explicitly NOT resolved.** No
  outbox, queue, worker, retry, dead-letter or delivery decision was
  introduced. The seam publishes the existing in-memory `Finalized` event and
  nothing else, and its header states that a cross-module caller needs §16.3
  plus OQ-39's delivery decision first — which is why `PostingService` is
  _provided, not exported_ (AR-07). The `kind: 'posted' | 'replayed'` field is
  a report of what this call did under the accepted atomic model, not a
  delivery guarantee.
- **OQ-40 (Financial Area semantics/multiplicity)** — untouched: the seam reads
  the stored area id and never resolves, defaults or multiplies areas
  (`§16.7`'s resolution is not implemented here).
- **OQ-41 (dimensions)** — untouched: no dimension read, write, requirement or
  binding; entries carry `dimensionAssignments: []` as before.
- **OQ-42 (Posting Mode A/B, approval authority)** — untouched: no approval
  state, no mode configuration; `Finalize ≠ Approve` still holds, and the
  seam's authority is the caller's (`Accounting.Document.Finalize`), unchanged.
- **OQ-43 (Iranian statutory / e-ledger)** — untouched: no statutory rule,
  book, retention, language or currency behaviour was hardcoded.

## 8. Remaining risks (evidence-based only)

1. **Live-database proof is CI-only.** No PostgreSQL/Docker exists here, so the
   37 live tests (including the real concurrency, real rollback and real
   `numeric(18,2)` proofs) were **skipped, not passed**. The seam's rollback
   and concurrency tests run against the in-memory fakes, whose `withRollback`
   _mirrors_ `$transaction` and whose single-threadedness cannot reproduce real
   lock contention. CI must run `test:e2e` with `VARDENA_TEST_DATABASE_URL`
   before merge. Mitigation: the delegation is a plain call to the unchanged
   `finalizeChecked`, so the live suites exercise the same code path they did
   at Task 10.7 — they now exercise it _through_ the seam. **Resolved on CI:**
   PR #23's `backend` job passes in all 15 steps, including `Migrate test
database` and `E2E tests (incl. live-DB suites)`, plus `Prisma validate` and
   `Prisma generate` which are blocked in this sandbox — so the live proofs ran
   against real PostgreSQL and passed. The only live-suite failure CI ever
   showed on this branch was a **pre-existing** test-side deserialization
   assertion inherited from `main` (identical on PR #22 and on `main`'s merge
   of it), diagnosed and fixed test-only in §9.1.
2. **Prisma CLI gates stay blocked** (`binaries.prisma.sh` TLS failure), so
   `prisma validate`/`generate` could not run. Unlike Task 10.7, **this task
   changes no schema**, so nothing new depends on that gate; the checked-in
   client stub is untouched.
3. **The fresh-path readiness assertion runs after commit.** If a fiscal year's
   dates were edited in the window between the commit and the readiness read,
   the caller gets an internal error although the posting committed (the event
   and the log have already gone out, so the books are not silently changed).
   This is the same reference-guard gap Task 10.5 recorded ("reachable drift
   seam … the reference guard is not enforced yet"), and the assertion is
   deliberately an `Error`, not a 4xx, so the caller is never told "not posted"
   for something that is. Cost: one unlocked read set (document + area + year +
   period + referenced accounts) per posting — acceptable for an operation this
   heavyweight, and it is the price of consuming the Task 10.5 seam as AC-03
   requires.
4. **Replay behaviour narrowed in one reachable edge.** A replay whose stored
   voucher has drifted out of readiness now answers `422 posting_not_ready`
   instead of returning the document DTO. Every non-drifted replay is
   byte-identical to before (the e2e replay journeys pass unmodified). This is
   the intended consequence of §16.4's "re-read current rows" plus AC-03, but
   it _is_ a behaviour change in that edge and is flagged rather than buried.
5. **Pre-existing, found and NOT fixed (AG-03, out of scope).**
   `data/accounting-documents.repository.ts:1077-1081` — the Task 10.4 copy of
   `toAmountString` still contains `if (typeof value === 'number') return
String(value);` and a blanket `String(value)` fallback. That is the exact
   float-loss shape Task 10.7's review removed from the _ledger_ copy (§13.4 of
   that report), and it is why the two copies differ. It is unreachable today
   (Prisma returns a `Decimal`/string for `numeric(18,2)`, never a JS number)
   and it is accepted Task 10.4 code, so touching it here would be a drive-by
   change to production money semantics that the brief forbids. **Recommended
   as its own follow-up task**: unify both copies on the narrowed ledger
   mapping. This is also where the brief's `0.10`/`0.20`/`0.00` live-test note
   lands — the live money test asserts canonical strings (`'0.1'`, `'0.3'`),
   which is what `canonicalizeAmount(toAmountString(…))` produces for a
   `Decimal` rendering of `numeric(18,2)`; no production money semantics were
   changed for it, and it stays CI-only here.
6. **Two `mustFindInOrganization` copies now exist** (documents service,
   posting seam) plus the equivalent three lines in `PostingReadinessService`.
   This is the module's existing posture for the scoped by-id read and was not
   unified, to keep the diff off accepted code; it is a candidate for the same
   follow-up as risk 5.

## 9. Commit

Committed on `arena/01a0ab4d-vardena` (branched from `1784216`) after the full
diff was reviewed twice and all runnable gates were green (§5). The commit is
`feat(accounting): add the posting orchestration seam (Task 10.8)`. Opened as
PR **#23** into `main`.

### 9.1 Second commit — the pre-existing live-suite money assertion (test only)

PR #23's CI reproduced exactly the failure the brief anticipated, and it is
**inherited from `main`, not introduced here**: `gh api …/check-runs/<job>/annotations`
returns the identical assertion for PR #23's job, PR #22's job (Task 10.7,
pre-merge) and the merge-commit run of PR #22 on `main` —

```
AssertionError: expected [ 0.1, 0.2, 0 ] to deeply equal [ '0.10', '0.20', '0.00' ]
 ❯ test/ledger-entries-live.e2e-spec.ts:439:55
```

Everything else in CI passes: `Prisma validate` ✅, `Prisma generate` ✅, `Lint`
✅, `Typecheck` ✅, `Format check` ✅, `Unit tests` ✅, `Build` ✅,
`Migrate test database` ✅ — only `E2E tests (incl. live-DB suites)` fails, on
that one assertion (22 files, 225 tests green).

**Root cause (test-side deserialization, not production money).** The raw
`$queryRaw` read assumed the driver hands back the `numeric` wire literal as a
string ("`pg` returns numerics as strings"). Through Prisma's PostgreSQL
adapter a _selected_ `numeric` is deserialized instead, and arrives
scale-stripped — `0.10` → `0.1`, `0.00` → `0` (note the received values in the
CI message are unquoted: not the strings the assertion expected). So the
assertion was testing the adapter's rendering, not the column, and could never
pass.

**Fix.** Cast the two amount columns to `::text` in that one query —
PostgreSQL renders `numeric(18,2)` → `text` with the scale intact — so the
existing expectations (`'0.10'`, `'0.20'`, `'0.00'`, `'0.30'`) are unchanged
and now assert what the row physically stores. This is the only
`$queryRaw` _read_ of an amount column in the live suites (the other
`debit_amount`/`credit_amount` hits are INSERT column lists and bind
parameters, unaffected), and there is no custom `pg` type parser in the
repository.

**Constraints honoured.** No production money semantics were touched —
`domain/money.ts`, the ledger decimal mapping, the repository read path and
every `src/` file are byte-identical in this commit; it changes one test query
plus its comment. It is kept as a **separate commit** so the Task 10.8
implementation diff stays clean, and it deliberately does _not_ weaken the
invariant: asserting the physical `numeric(18,2)` scale is stronger evidence
of exact persistence than asserting the canonical `'0.1'` form would be.

**Verification.** Local gates green after the change (`format:check` ✅,
`lint` 0/0 on 428 files ✅, `typecheck` ✅, e2e 189 passed / 37 skipped ✅ —
identical to before, since the live suite still cannot run here). CI is the
authority for the live part, and it is now **green**: PR #23's `backend` job on
this commit succeeded in all 15 steps — `Prisma validate`, `Prisma generate`,
`Lint`, `Typecheck`, `Format check`, `Unit tests`, `Build`, `Migrate test
database` and `E2E tests (incl. live-DB suites)` — so the 37 locally-skipped
live tests ran against real PostgreSQL and passed, including this assertion and
the real atomicity / rollback / concurrency / `numeric(18,2)` proofs, which now
run _through_ the seam. That closes §8 risk 1 for this change.

**Final status: READY FOR REVIEW.** This report does not mark the task
Accepted — that decision is the reviewer's.
