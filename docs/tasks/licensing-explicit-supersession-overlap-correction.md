# Overlap-authority correction — an explicit supersession sanctions exactly the version it names

## Repository-first selection (2026-10-14)

Baseline: `origin/main` **`56072fefc565c305d0eb3701922d30f5bb44c26e`** (merge of
PR #152, the F-12 credential-transition correction), fetched before any change.
The session branch `arena/f1d13904-vardena` starts at that exact commit; no
other branch is used. GitHub returned **zero open PRs**. The baseline push run
[`38652768791`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38652768791)
succeeded for `classify`, `backend`, `docs`, `generated-api-client` and
`ci-gate`; `frontend` was skipped by the classifier as explicitly
non-applicable.

| Candidate / evidence inspected in the current tree | Assessment |
| --- | --- |
| F-12 (bootstrap administrator, forced first-login change) | **Complete in the current tree.** No hardcoded initial password remains, the bootstrap credential is explicit validated configuration, `must_change_password` is persisted, `AuthGuard`/`AuthorizationGuard` gate every controller (`health` probe excepted) with `@AllowWhenPasswordChangeRequired()` on exactly the two self-service auth routes, and the frontend `/change-password` flow exists (IRs #149, #152). Only the un-owned policies OQ-14/OQ-19 remain. Not re-opened. |
| L-05 (renewal-path §8.6 control), L-06 (customer code, PDR-14) | **Implemented and merged** (#146; #150/#151). Re-verified present: continuation baseline, usage-aware reduction conflicts, dedicated resolution/recovery/transfer routes, `customer_code` fail-closed migration and domain parity. Not reimplemented. |
| L-04 reduction flow, F-3 (`OQ-86` gap), F-6/F-7 contracts | F-3's recorded divergence is **closed by OQ-86 Option C** — the shared evaluation counts the effective window of every retained version — and the two `GET /license/current` / `POST /license/activate` routes now carry typed 200 schemas with a contract spec. The stale paragraphs that described the pre-decision behaviour are corrected by this slice's documentation change. |
| Device registration/quota/replacement, installation key, revocation, receipts, audit retention, owner-side issuance | No approved and actionable work: OQ-74, OQ-76, OQ-77, OQ-78, OQ-79, OQ-81, OQ-82, OQ-83, OQ-84, OQ-85 remain **OPEN** policy questions. No device schema/API/UI or key protocol exists and none was invented. |
| `evaluateImportConflicts` overlap authority (this slice) | **Defect found and reproduced**: an explicit signed supersession that names one retained version while the candidate also overlaps a *different* retained version that still governs is applied, leaving two versions governing one instant. |

This slice is **not** a new milestone and is **not** L-07. It enforces a rule
that is already recorded and decided — ADR-0046 **Decision 4** (effective
windows pairwise disjoint after every import), design §3.3 (overlap allowed
"only in so far as it is replaced"; a supersession is declared for exactly one
version), OQ-80 §8.1 ("a candidate that would overlap more than one
still-governing version is refused rather than guessed"), OQ-86 **Option C**
(every retained version's *effective* window counts), and the domain's own type
documentation ("`explicit` — a signed document naming its predecessor by
operation id (`supersedesOperationId`); **exactly that version may be
overlapped**"). No policy question is answered anywhere in this slice.

## Selected defect and acceptance checklist (before implementation)

**Selected: the explicit-supersession arm of the overlap authority does not
enforce the disjoint-window invariant.**

Root cause on the baseline (`backend/src/modules/licensing/domain/license-version.ts`):
the evaluation computes `others` = everything the candidate overlaps in the full
retained history minus the named target, then refuses retired overlaps and
`others.length > 1`, and only then branches:

- `target === null && overlap !== null` → the OQ-80 Option B hand-over (correct);
- `target !== null && overlap !== null` → **no branch**: the named target is kept
  as `supersedes`, the *other* overlapped version is silently ignored, and the
  document is applied although nothing retires that version.

Reachable through the public import pipeline with an authentic signed document
(the dev/authority CLI can express `supersedesOperationId`) whenever the
installation already retains a future-dated version — a supported, documented
workflow ("the scheduled renewal"). The applied result is a state in which two
eligible retained versions cover the same instants, i.e. exactly the `ambiguous`
defensive read (design §3.2 rule 7) that the decisions exist to make
unreachable, plus a retirement audit row naming a version whose retirement is
not what created the overlap.

Acceptance targets:

- [x] Deterministic fast regressions reproduce the defect on the baseline
  (`conflict: null`, and `resolveEffectiveVersion` → `ambiguous` with 2 covering
  versions).
- [x] The authority refuses the document — `overlapping-range`, 409, `nothing
  written`, operation id unused — without changing any other arm: the named
  version is still retired when it is the overlapped one, a supersession of a
  non-overlapping version with no other overlap stays allowed, the OQ-80 Option
  B hand-over and the legacy `VLIC1` rules are untouched.
- [x] A bounded reachability check asserts the invariant itself: over a grid of
  retained layouts, candidate windows and supersession intents, every state the
  import transaction would commit has at most one eligible covering version at
  every probe instant.
- [x] Hermetic HTTP regression over the real pipeline: 409 with the stable
  reason, no version/profile/stamp/`APPLIED` audit written, the state endpoint
  unchanged and still deterministic; plus the accepted control (naming the
  version it overlaps).
- [x] No schema, migration, API/DTO, generated-client or frontend change: the
  refusal reuses the existing `overlapping-range` 409 contract and its existing
  Persian copy (the frontend maps the machine reason, not the message).
- [x] Records reconciled without rewriting policy: design §3.3, the stale
  `OQ-86` "known behaviour" paragraph, ADR-0046 addendum, `STATE.md`.
  No OQ row changed.
- [x] Focused PR against `main`, independent diff review, exact-final-head CI
  evidence in the PR description, manual merge protocol. **PR remains
  unmerged.**

## Implementation and fast evidence

- **Production change (one branch, ~13 lines):**
  `backend/src/modules/licensing/domain/license-version.ts` — in
  `evaluateImportConflicts`, between the multi-overlap refusal and the Option B
  hand-over, `if (target !== null && overlap !== null) return
  conflictOnly({ reason: 'overlapping-range', overlapping: 1 })`, with the
  rationale on the rule-4 documentation of the same function. The refusal is
  evaluated identically by the read-side pass
  (`LicenseImportService`) and by the authoritative in-transaction re-evaluation
  (`LicensesRepository.importVersion`), which call the same pure function.
- **Baseline reproduction and post-fix evidence:** reverting only
  `license-version.ts` to `HEAD` makes the new tests fail — domain
  `3 failed | 67 passed` and the hermetic e2e suite `1 failed | 19 passed` —
  and the un-reverted tree passes `70/70` domain and `20/20` hermetic e2e.
- **Domain regressions** (`license-version.spec.ts`, new describe *an explicit
  supersession sanctions exactly the version it names*): the defect scenario and
  its variant (the candidate also overlaps the version it names), the accepted
  control (naming the overlapped version), the documented non-overlapping
  supersession correction, the unchanged legacy `VLIC1` hand-over, the
  invariant counterexample (the pre-correction state is `ambiguous` with two
  covering versions) and the bounded reachability enumeration of the
  disjoint-window invariant.
- **Hermetic e2e regressions** (`test/license-import.e2e-spec.ts`, in-memory
  repositories, the production HTTP pipeline): the refusal with nothing written
  (retained versions, stamps, audits, effective/scheduled state) and the
  accepted control.
- **Fast checks actually executed:** `npm ci --ignore-scripts --no-audit
  --no-fund` (dependency installation only), `npm run typecheck`,
  `vitest run --config ./vitest.config.ts src/modules/licensing/domain/license-version.spec.ts`
  (70/70) and
  `vitest run --config ./vitest.config.e2e.ts test/license-import.e2e-spec.ts`
  (20/20, 8 s, no database). Targeted `prettier`/`oxlint` on the changed files.

## TEST EXECUTION MATRIX

| Class | Verification | Execution boundary |
| --- | --- | --- |
| FAST-LOCAL | Domain regressions, typecheck, targeted lint/format, documentation links | Local; no database, no live PostgreSQL, no full suite |
| CI-HEAVY | Existing backend job: full unit suite, migrations and rehearsals, full e2e incl. live-PostgreSQL suites (`licensing-persistence-live`, `licensing-limits-live`) | GitHub Actions only |
| CI-LIVE-DB | The same in-transaction refusal is exercised by the existing live suites that import over real tables under the installation lock; this slice adds no new live case and claims none | GitHub Actions only |
| CI contract | `generated-api-client` drift check (no contract change expected) | GitHub Actions only |
| CI scope | `classify`, `docs`, `backend`, `generated-api-client`, `ci-gate`; `frontend` only if the classifier requires it | Read from the exact final run, never inferred |

No heavy E2E or live-database suite was executed locally and no such
authorization is claimed. Final-head run URLs and SHAs belong to the PR
description so recording them does not create a new, unverified commit.

## Review boundary and limitations

- **No new policy and no OQ status change.** The slice enforces a decided rule;
  it does not ask or answer a question. It refuses documents that the baseline
  accepted, which is the fail-closed side of the recorded rule and is limited to
  authentic documents that name one version while overlapping another.
- **Scope of the change.** No schema, migration, permission, API contract, DTO,
  generated client, frontend copy or workflow change; the `overlapping-range`
  reason, its 409 class and its existing operator messages are reused unchanged.
- **Legacy backfill exception preserved.** Design §11's migrated L-02 rows can
  still present two covering versions at a *historical* instant (their
  replaced-by pointer was never persisted). That is recorded behaviour, is not
  writable by the current pipeline, and is untouched by this slice.
- **Evidence boundary.** Local evidence is hermetic and deterministic; the
  authoritative in-transaction path is proved by the existing live-PostgreSQL
  suites using the same evaluation function, and the exact final head's CI run
  is the heavy verification authority.
- **Not accepted, not merged.** The PR is submitted for review under the
  existing manual merge protocol; CI on this repository is advisory because the
  plan is GitHub Free. No server-enforced protection, auto-merge or settings
  change is introduced by this slice.
