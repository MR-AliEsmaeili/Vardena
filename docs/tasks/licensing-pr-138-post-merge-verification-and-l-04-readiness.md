# PR #138 — post-merge verification of `main`, Owner decision package and L-04 readiness

| Field | Value |
| --- | --- |
| Date | 2026-10-12 (UTC) |
| Scope | Verify the actual post-merge state of `main` after PR #138; separate CI evidence from local claims; reconcile the seven named licensing records against the tree; determine whether L-04 can start. **No implementation.** |
| `main` verified | `d283744b4098346b6ef2e0b91922266f10cdabd1` (merge commit of PR #138), via `git ls-remote origin refs/heads/main` **and** `git rev-parse origin/main` **and** `gh pr view 138`. |
| Method | `gh api` / `gh pr view` for PR and Actions evidence; `git fetch --depth=1 origin <sha>` + `git grep <sha>` to test claims against specific commits; direct reading of the merged source for every behavioural claim below. Nothing is taken from a PR description or from prior chat. |
| Changes made | **Documentation only** — five existing records corrected plus this new file. No product code, no migration, no CI workflow, no OQ status, no PDR-11 §1–§18 policy text. |
| Owner acceptance | **Not given and not implied.** PR #137 and PR #138 are both **merged, not Owner-accepted**. |
| Decisions taken here | **None.** Every open item below is stated as a question with its documented options. The Product Owner decides; this pass only verifies, reconciles and frames. |
| Related | `docs/tasks/licensing-post-merge-reconciliation.md` (§14 added by this pass); `docs/tasks/licensing-oq-80-oq-86-decision-brief.md`; `docs/tasks/pdr-11-conflict-reconciliation.md`; `docs/decisions/product/PDR-11-vardena-licensing-product-requirements.md`; `docs/adr/0046-signed-license-documents-and-version-lifecycle.md`; `docs/licensing/version-model-and-file-exchange.md`; `STATE.md` §32–§33; `docs/open-questions.md`. |

Three states are kept apart throughout, as in the prior report: **merged** (on `main`), **technically verified** (executed or read, with the evidence named), and **Owner-accepted** (not yet — no Owner acceptance is recorded anywhere).

---

## 1. Verification of `main` and of the PR #138 merge commit

| Check | Command / source | Result |
| --- | --- | --- |
| Tip of `main` on origin | `git ls-remote origin refs/heads/main`; `git rev-parse origin/main` | `d283744b4098346b6ef2e0b91922266f10cdabd1` |
| PR #138 state | `gh pr view 138 --json state,mergedAt,mergeCommit,headRefOid,baseRefName,headRefName` | `state=MERGED`, `mergedAt=2026-10-12T06:03:27Z`, `mergeCommit.oid=d283744b4098346b6ef2e0b91922266f10cdabd1`, `headRefOid=4bdd97048002dede854d3925c3a182854ed93988`, base `main`, head branch `arena/f0ddc379-vardena` |
| Merge-commit parents | `git log -1 --format='%P' d283744` | `345047abec5a6af6760b05ad36b570ee5ed3a5f9` (PR #137 merge, `main` before) and `4bdd97048002dede854d3925c3a182854ed93988` (PR #138 head) |
| Merge-commit subject/body | `git show --no-patch d283744` | `Merge pull request #138 from MR-AliEsmaeili/arena/f0ddc379-vardena` / `Licensing: refuse license re-binding; post-merge audit of PR #137` |
| **Did the merge add content?** | `git rev-parse d283744^{tree} 4bdd970^{tree}`; `git diff --stat 4bdd970 d283744` | **No.** Both trees are `f9dd36f5b5a273dbc0e24ae79c3d9e1a0b0da487`; the diff is empty. `main`'s content is exactly the reviewed head, so §13 of the prior report describes `main`. |
| Is the PR #137 fix present at `345047a`? | `git grep -c license-binding-conflict 345047a -- backend/src` | **No match.** The refusal exists on `main` only from `d283744`. |
| Is it present at `d283744`? | `git grep -c license-binding-conflict d283744 -- backend/src` | Yes — `license-import.service.ts` (6), `licenses.repository.ts` (3), `license-version.ts` (4), plus the two spec files. |
| Working tree | `git status` at the start of this pass | Clean, on the session branch at `d283744`. Local history is shallow (`git rev-parse --is-shallow-repository` → `true`), so each SHA cited was re-fetched with `git fetch --depth=1 origin <sha>` before being inspected. |

**Conclusion.** PR #138 is genuinely merged, `main` is `d283744`, and the merge is content-identical to its head. The prior report's statements that were written while the branch was unmerged ("fixed on this branch") are now statements about `main` — which is what made four records stale (§4).

---

## 2. CI evidence, separated into three classes

The task's distinction is enforced literally: **(a)** CI for the PR head, **(b)** CI for the merge commit, **(c)** local test claims documented in reports. They are not interchangeable, and only (b) verifies `main`.

### 2.1 (b) CI for the merge commit — the only evidence that verifies `main`

Run `38210710188`, workflow `CI`, `event=push`, `head_branch=main`, `head_sha=d283744b4098346b6ef2e0b91922266f10cdabd1`, created `2026-10-12T06:03:29Z`, updated `2026-10-12T06:09:41Z`, `status=completed`, **`conclusion=success`**.

| Job | ID | Result | Steps |
| --- | --- | --- | --- |
| `backend` | `114683993213` | `success` (started `06:03:32Z`, completed `06:09:40Z`) | 27. All `success`: Prisma validate, Prisma generate, Lint, Typecheck, Format check, Unit tests, Build, Migrate test database, Bootstrap system administrator, Inventory BusinessDate live suite (Asia/Tehran), Inventory BusinessDate live suite (America/Los_Angeles), Migration rehearsal (populated pre-Task-11 data), Migration rehearsal (Inventory BusinessDate validity windows), Migration rehearsal (Licensing version model and import), E2E tests (incl. live-DB suites). Two `skipped` **by design** (`Publish e2e failure inventory`, `Upload backend logs on failure`; both are `if: failure()`). Zero steps with a non-success, non-skipped conclusion. |
| `frontend` | `114683993419` | `success` (completed `06:06:18Z`) | 13. Lint, Typecheck, Format check, Tests, Build — all `success`. |

There is exactly **one** `push`-to-`main` run for `d283744`.

### 2.2 (a) CI for the PR heads — history only, never merge-commit evidence

| Run | Event | SHA | Result | Jobs |
| --- | --- | --- | --- | --- |
| `38208790250` | `pull_request` | `4bdd970` (final head; created `2026-10-12T05:38:04Z`) | `success` | backend `114678096343`, frontend `114678095992` |
| `38174043699` | `pull_request` | `8a8e637` (round-1 head) | `success` | backend `114572514150`, frontend `114572513981` |
| `38171112633` | `push` to `main` | `345047a` (PR #137 merge) | `success` | backend `114563738873`, frontend `114563738695` — verifies `345047a` only, which does **not** contain the PR #138 fixes |

`38174043699` is evidence for `8a8e637` alone; it must not be cited for `4bdd970` or `d283744`, per this repo's own rule that no result from an earlier SHA is reused.

### 2.3 (c) Local test claims in the reports — claims, not CI results

The counts in `docs/tasks/licensing-post-merge-reconciliation.md` §4 and §13.3 are **local** and were produced with documented substitutions (finding F-14): PostgreSQL 16.4 from `@embedded-postgres/linux-x64` instead of the CI service container; `/tmp/pgtools/apply-migrations.mjs` instead of `prisma migrate deploy` (so Prisma checksum fidelity is *not* established locally); `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` and `PRISMA_QUERY_ENGINE_LIBRARY=/bin/true` because `binaries.prisma.sh` is not on the sandbox allow-list. No Docker, so the Compose path and the browser smoke test (§7 of that report) were never run.

**Run `38210710188` is the authority for exactly those CI-only steps** — `prisma migrate deploy` checksums, the Postgres 16 service container, the rehearsal wiring, and the live-DB e2e suites under CI. Where a local claim and CI could disagree, CI on `d283744` wins.

### 2.4 Gaps in the CI evidence, stated rather than hidden

- **Per-test counts are not quotable.** The Actions log blob host is unreachable from the sandbox, so only step- and job-level conclusions are cited. No number in §13.3 is corroborated by CI here, and none is presented as CI.
- **The legacy combined-status endpoint is misleading and is not used.** `GET /commits/d283744/status` returns `state: "pending"` with `total_count: 0` — the same artifact the prior report recorded for `345047a`. This repo's gates are Actions **check runs**; `GET /commits/d283744/check-runs` reports `backend: success` and `frontend: success`. `pending` here is **not** a failing or missing gate.
- **A stale read was observed and resolved.** The first `check-runs` read during this pass returned `backend: in_progress` for `d283744` while the run was finishing; a later read of the same run and the same job returned `completed / success`. Both readings are recorded so the sequence is not mistaken for a re-run or for a second attempt. There is one run, one backend job, one conclusion.
- **CI does not check the generated OpenAPI client at all** (§3.6), so a green run says nothing about client drift.

---

## 3. Reconciliation: documented state versus the actual implementation at `d283744`

Each row was verified by reading the merged source, not by reading prose. "Doc claim" is what the records said; "Verified" is what `d283744` does.

| # | Item | Verified state at `d283744` | Doc claim accurate? |
| --- | --- | --- | --- |
| 3.1 | `license-binding-conflict` + pending ratification | Implemented; **ratification still outstanding** | Yes, but merge state was stale |
| 3.2 | OQ-80 / OQ-86 | **OPEN**; Gap C still reproduces | Yes |
| 3.3 | Renewal identity (Q3 / F-8) | Unchanged; CLI cannot target an existing `licenseId` | Yes |
| 3.4 | Installation customer transfer (Q4 / F-4) | Unchanged — and **reachable through the documented CLI renewal path**; sharpened below | Partially — understated |
| 3.5 | OpenAPI schemas for `/license/current`, `/license/activate` | **Still absent** (F-6 open) | Yes |
| 3.6 | Generated-client drift verification in CI | **Still absent** (F-7 open) | Yes |
| 3.7 | Initial administrator credential | **Still the hardcoded constant `1`** (F-12 open, deployment blocker) | Yes |

### 3.1 `license-binding-conflict` — implemented, unratified, now on `main`

Verified in the merged tree:

- `backend/src/modules/licensing/domain/license-version.ts` — the reason is in the `ImportConflictReason` union (line 408) and is produced by **rule 2a** of `evaluateImportConflicts`, the single conflict authority: a retained version with the same `licenseId` but a different `customerId` → `{ reason: 'license-binding-conflict', overlapping: 0 }`. The rule's own doc comment states it enforces "a license is bound to exactly one customer (PDR-11 §2.1 terms, ADR-0046 Decision 2)".
- `backend/src/modules/licensing/data/licenses.repository.ts` — **rule 2b** under the installation lock: `tx.license.findUnique({ where: { id: command.licenseId } })`; if the row exists and belongs to another installation *or* another customer, `ImportConflictError({ reason: 'license-binding-conflict' })` (line 489). Two further sites: the guarded `updateMany` re-asserting the binding in SQL (line 530) and the plain-`INSERT` claim whose unique violation is converted inside the transaction (line 549) — the F-18 race fix.
- `backend/src/modules/licensing/application/license-import.service.ts` — the reason is in the rejection union (line 93), in the 409 set (line 105) and mapped at lines 933/957/981, with one shared message across the signed, legacy and lost-race paths.
- Tests present: `license-version.spec.ts` (rule 2a), `license-import.service.spec.ts` (409 + audit reason + lost races), `licensing-persistence-live.e2e-spec.ts` (live PostgreSQL, incl. the in-flight claim race).

**Ratification status: still pending.** The name and the 409 class remain an *implementation interpretation* of ADR-0046's conflict class — PDR-11 §1–§18 never names the reason. What changed is its exposure: it is now on `main`, so it is already in customer-visible API responses and in `licensing.license_audit_events.reason` rows. Renaming it later is a contract break for anything that reads either. This is decision **D-3** (§5).

### 3.2 OQ-80 and OQ-86 — OPEN, and Gap C still reproduces

Register rows verified in `docs/open-questions.md`: OQ-80 (line 96) `**OPEN — registered 2026-10-11…**`, OQ-86 (line 102) `**OPEN — registered 2026-10-11.**`, each already carrying its post-merge evidence note. Neither was touched by this pass; no OQ was opened or closed.

Gap C (the OQ-86 evidence, scenario S5 of the decision brief) was **re-verified by code reading at `d283744`** rather than accepted from the report:

```ts
// license-version.ts:281
export function overlappingVersions(candidate, versions, at) {
  return versions.filter((version) => {
    if (!isEligibleAt(version, at)) return false;   // <-- retired versions excluded
    const window = effectiveWindow(version);
    return windowsIntersect(candidate.validFrom, candidate.validUntil, window.start, window.end);
  });
}
```

Only versions still eligible **at the import instant** can be overlaps, so a backdated non-superseding document that lands inside a *retired* version's past window is not refused, and `resolveEffectiveVersion` for that past instant answers `ambiguous`. The implemented rule is pinned by the unit test `never counts a superseded version as an overlap` (`license-version.spec.ts:128`). That still diverges from ADR-0046 Decision 4's wording ("effective windows are pairwise disjoint after every import"). **Unchanged, unfixed, undecided** — correctly, because choosing between the ADR wording and the implemented rule *is* the OQ-86 decision. Decision **D-2** (§5).

### 3.3 Renewal identity (Q3 / F-8) — unchanged

- `backend/src/tools/development-license-authority.ts:75` — `licenseId: options.licenseId ?? generateId()`; `buildLicenseDocument` (line 119) reuses `legacy.licenseId`.
- `backend/src/issue-development-license.ts` — the argument parser accepts `--installation`, `--customer`, `--customer-name`, `--status`, `--valid-from`, `--valid-until`, `--organizations`, `--users`, `--modules`, `--features`, `--format`, `--operation-id`, `--supersedes`, `--key-id`, `--artifact`, `--out`, `--keygen`. **There is no `--license-id`.**

So the tooling can only ever mint a new identifier, and today behaves as "new license per renewal" without that ever having been decided. Consequence that matters for the rule in §3.1: because the CLI cannot reuse a `licenseId`, rule 2a is unreachable through the documented tooling and can only be hit by a deliberately hand-signed document — while the *installation*-level transfer in §3.4 stays reachable. Decision **D-4** (§5).

### 3.4 Installation customer transfer (Q4 / F-4) — unchanged, and the records understated its reachability

Verified: on a successful import the repository still executes

```ts
// licenses.repository.ts:556
await tx.installation.update({
  where: { id: command.installationId },
  data: { customerId: command.customerId, updatedAt: command.now },
});
```

and `license-import.service.ts:553` passes `customerId: context.payload.customerId` straight through — **no comparison against the installation's current customer anywhere in the import path.**

Two facts sharpen F-4 beyond how the prior report stated it. Both are verified observations, **not** a decision and **not** a change to the question:

1. **It is reachable through the documented renewal workflow, not only by a hand-built document.** Rule 2b checks the license row *for the incoming `licenseId`*. A document carrying a **new** `licenseId` (which is all the CLI can produce) that names a **different** customer finds no existing row → no conflict → a new license row is created → `tx.installation.update` overwrites the installation's commercial-customer binding. With an explicit `--supersedes` (or a gap/future-dated window), the import is accepted. So the very path F-8 says cannot trigger rule 2a *can* trigger a customer transfer.
2. **The transfer carries no distinct audit reason.** `LicenseAuditEvent` (`backend/prisma/schema/licensing.prisma:168`) has `eventType`, `outcome`, `operationId`, `licenseId`, `versionId`, `actorId`, `source`, `documentHash`, `reason`, `detail` — and **no `customerId` column**. An applied import that re-attributes the installation records only `license.import.applied` against the *new* `licenseId`. The new customer is inferable by joining the license row; the fact that the binding *changed*, and from what, is not recorded as an event. PDR-11 §12.9 requires every capacity-changing or destructive consequence to have "an explicit, auditable resolution" — whether a customer transfer counts, and what audit it needs, is exactly the Owner's call.

Decision **D-5** (§5). Priority raised relative to the prior report because of (1) and (2).

### 3.5 OpenAPI response schemas for `/license/current` and `/license/activate` — F-6 still open

| Route | Decorator at `d283744` | Generated client |
| --- | --- | --- |
| `GET /api/v1/license/current` | `license-state.controller.ts`: `@ApiOkResponse({ description: 'Non-secret evaluated license state.' })` — **no `type`** | `LicenseStateController_current_v1` → `200: { … content?: never }` |
| `POST /api/v1/license/activate` | `license-activation.controller.ts`: `@ApiOkResponse({ description: 'The evaluated state after activation.' })` — **no `type`**; the method returns `LicenseStateView & { changed: boolean; outcome: string }` | `LicenseActivationController_activate_v1` → `200: { … content?: never }` |
| `POST /api/v1/license/import` (for contrast) | `@ApiOkResponse({ type: LicenseImportResultDto })` | `200: { content: { "application/json": components["schemas"]["LicenseImportResultDto"] } }` |

`LicenseImportResultDto`, `LicenseVersionSummaryDto` and `LicenseEntitlementDto` are all present in the committed client (lines 3451/3457/3483), so F-5 is genuinely fixed and merged. F-6 is genuinely **not**: both routes return real JSON that the contract declares as `never`, and the frontend hand-restores `LicenseState` in `contracts.ts`. The prior report's "Partially fixed" is accurate. This is an engineering follow-up needing **no Owner decision** (**E-1**, §6.3) — but note the asymmetry it creates with §3.1: the 409 reason is observable in responses while neither success schema is.

### 3.6 Generated API client drift verification in CI — F-7 still open

`.github/workflows/ci.yml` was read in full. The `frontend` job is exactly: Checkout → Setup Node → Upgrade npm → Install → **Lint → Typecheck → Format check → Tests → Build**. The `backend` job has no client-generation step either. **No step anywhere regenerates or diffs `frontend/src/api/generated/vardena-api.d.ts`.**

- `frontend/package.json` defines `api:types: npx --yes openapi-typescript@7.13.0 ${VARDENA_OPENAPI_SOURCE:-http://localhost:3000/api/docs-json} --output src/api/generated/vardena-api.d.ts` — **with no CI caller**.
- Consequence: `license-binding-conflict` appears **0 times** in the committed client (`grep -c` → `0`), because no response schema declares it. Drift of that kind is invisible to CI today.
- What exists instead, both partial: the server-side e2e contract case (`test/license-import.e2e-spec.ts` asserts the import 200 is `$ref: LicenseImportResultDto` and matches a real response) and the client-side compile-time assertion `LICENSE_IMPORT_RECEIPT_MATCHES_OPENAPI` in `frontend/src/api/contracts.ts`. Neither detects a *stale committed client*, which is the failure F-5 actually was.
- §13.4's "byte-identical regeneration" is a **manual** check and is not reproducible in this sandbox (no `node_modules`, and `api:types` needs a booted API plus a database). It is not a gate.

Engineering follow-up, **no Owner decision** (**E-2**, §6.3); the prior report is right that a CI change is a separate, reviewable slice.

### 3.7 Initial administrator credential — F-12 still open, still a deployment blocker

- `backend/src/bootstrap/system-administrator-bootstrap.service.ts:14` — `const BOOTSTRAP_SYSTEM_ADMINISTRATOR_INITIAL_PASSWORD = '1';`, used at line 96. **Hardcoded constant; no environment override.**
- `.env.example` has no administrator-password variable (only `POSTGRES_PASSWORD=CHANGE_ME` and the Compose trust-auth note), confirming there is no configurable path.
- `README.md:52–54` — "Initial login is `مدیر` / `1` … change it immediately through the existing password-reset API because **forced password change is not implemented**."
- `docs/tasks/bootstrap-system-administrator/implementation-report.md:84` records the same limitation.

Pre-existing (not introduced by PR #137 or #138), correctly classified in the prior report as a **blocker for any non-development deployment**, and unaffected by the merge. CI's `Bootstrap system administrator` step passing on `d283744` proves the bootstrap *runs*; it says nothing about the credential being acceptable. Owner/security decision **D-6** (§5).

---

## 4. Records found stale, and the corrections made

The merge invalidated one specific fact — that the fixes lived only on an unmerged branch — and four records repeated it. **Correction scope was kept to merge state and verification evidence.** No OQ status, no PDR-11 §1–§18 policy text, no decision-brief option, no architecture, no product code, no CI workflow.

| Record | What was wrong | Correction |
| --- | --- | --- |
| `STATE.md` §32 | Present-tense "`main` and the PR #137 merge commit are `345047a`" — false after the PR #138 merge, and it implied the described fixes were on `main` at `345047a`. | Scoped to its date; added that `345047a` is no longer the tip and that `git grep license-binding-conflict 345047a -- backend/src` returns nothing. The follow-up bullet now names its merge commit. "Next gate" names **both** PRs as merged-not-accepted and extends F-6 to `POST /license/activate`. |
| `STATE.md` | No record of this verification pass. | New **§33** with the verified `main`, the three-class CI evidence, the corrected inconsistencies and the L-04 readiness verdict. |
| `docs/tasks/licensing-post-merge-reconciliation.md` | Header said `main` inspected = `345047a`; §2's CI table covered only PR #137; F-1/F-2 said "fixed on this branch"; nothing recorded the merge. | Header rows for merge state and the current tip; §2 scoped to PR #137 with a pointer; §6 statuses re-read against `d283744`; F-1/F-2/F-5/F-9 marked "merged in PR #138 (`d283744`)"; new **§14** (merge identity, CI evidence, local-vs-CI, records corrected). |
| `docs/tasks/pdr-11-conflict-reconciliation.md` | Status row: "PR #137 is merged at `345047a` … the new reason `license-binding-conflict` is pending ratification" — readable as the reason existing at `345047a`. | Merge-state correction added: the fixes reached `main` via PR #138 at `d283744`; `345047a` does not contain them. |
| `docs/decisions/product/PDR-11-…md` §19.4 | Same ambiguity in the post-merge addendum. | **One** merge-state sentence, listing what is still awaiting the Owner. §1–§18 untouched; §15 unchanged; PQ-5/OQ-80 and OQ-86 still OPEN. |
| `docs/open-questions.md` | Historical log's newest entry still said "`main` is `345047a`". | New dated entry prepended, per the file's own convention, stating explicitly that **no OQ status changed**. Register rows for OQ-80/OQ-86 left byte-identical. |

**Not corrected, because it is not ours to correct:** PR #138's merged description quotes the **round-1** local counts (backend unit 1962/1962, licensing unit 115/115, licensing live+e2e 55/55, full e2e 616/616, client diff "additive only (84 lines)") and describes the client change as "`/license/import` added". The merged tree's final round is §13.3 of the report: **1965/1965**, **118/118**, **58/58**, **619/619**, client diff **67 added / 1 removed**, plus the `LicenseImportResultDto` response schema. An agent must not rewrite a merged PR description, so the discrepancy is recorded here and in report §14.3 instead. Read §13.3 for the merged tree; **neither set is CI evidence.**

---

## 5. Product Owner decision package

Six decisions, prioritized. Priority is set by two things: whether it gates L-04, and whether unratified behaviour is already live on `main`. For each: the exact question, verified current behaviour, the options **already documented in the repository** (no new option is invented here), consequences, dependencies, and the specific decision needed.

### D-1 — OQ-80: overlapping and gapped version windows · **gates L-04**

- **Exact question.** When a document's window overlaps a version that still governs and the document does not name it, which version governs? And what may the customer do during a gap? (PDR-11 §3.4/§15 PQ-5.)
- **Current behaviour (verified).** Overlap without an explicit signed supersession → 409 `overlapping-range`, nothing written. Explicit supersession → accepted, predecessor's `governs_until` = successor's `validFrom`. Gap → accepted; the installation reports `expired` between the windows (restricted-mode *enforcement* is not implemented). Authority: `evaluateImportConflicts` + `overlappingVersions`.
- **Documented options.** `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §3 — overlap **A** keep the interim refusal · **B** later start governs at the overlap · **C** stacking during overlap · **D** hand over at the predecessor's end; gap **G1** allow gaps, report `expired` · **G2** refuse a renewal that leaves a gap · **G3** grace across a gap.
- **Consequences.** **A/G1** (status quo): safe and auditable, but every early renewal must be issued with the predecessor's operation id, so the issuing process must track it; a customer with an unexpected overlap gets a refusal, never a silent change. **B**: predecessor entitlements and capacity stop *silently* on the new start date — conflicts with PDR-11 §8.6's "check and explain **before** a reducing version is applied"; needs a preview/confirmation step and new audit semantics; likely an ADR addendum. **C**: commercial over-grant risk; the Owner must define how user limits add or max; still does not say which version governs when they disagree. **D**: no early loss of entitlements, but the customer may pay for days that do not govern, and `validFrom` changes meaning for overlapping documents. **G2**: a lapsed customer cannot import a renewal starting after the lapse and needs a brand-new license — which collides with license continuity (**D-4**). **G3**: not decidable before OQ-45 (Grace duration, undecided).
- **Dependencies.** None for A/G1. B and D need an ADR-0046 addendum and new eligibility rules + tests. C needs a precedence/arithmetic rule in `resolveEffectiveVersion`. G3 depends on OQ-45.
- **Decision needed.** Pick one overlap option (A/B/C/D) **and** one gap option (G1/G2/G3) in the brief's §7 table. Engineering view already recorded there, not repeated as a decision: A + G1 until a commercial early-renewal workflow exists.
- **Why it gates L-04.** Capacity is per-version. "Which version's capacity applies on a given day" has no answer while overlap and gap resolution are undecided — and L-04's entire subject is comparing a version's capacity against current usage.

### D-2 — OQ-86: may a document retire a version from a past instant? · **gates L-04**

- **Exact question.** May a signed document whose start precedes its import instant rewrite which version governed a period that has already passed? Plus three sub-questions: tolerance at the import instant, the legacy `VLIC1` replacement path, and whether as-of reads are a contract or a recomputation.
- **Current behaviour (verified).** Supersession that would hand over in the past → 422 `backdated-supersession`, nothing written, operation id **not** retained (re-issuable); predicate `supersessionRewritesPastGovernance`. **But** a *non-superseding* backdated document overlapping a **retired** version's past window is **accepted**, and the as-of read for that period answers `ambiguous` — verified in §3.2 against `d283744`, still contradicting ADR-0046 D4's pairwise-disjoint wording. No endpoint exposes an as-of read today, so the ambiguity is not customer-visible through the current API.
- **Documented options.** Brief §4 — **A** no retroactive supersession (status quo) · **B** retroactive supersession with a separately recorded retro instant · **C** conform to ADR-0046 D4, closing Gap C · **D** legacy `VLIC1` path (status quo refusal, or signed-only).
- **Consequences.** **A**: a past mistake (e.g. too short a term) can never be corrected in the history; compensation moves outside the license; history stays a record of what governed. **B**: the only path to retroactive corrections, and the largest change — a second instant or correction record → **schema change → migration + rehearsal**; as-of reads become a contract; retroactive changes must be audited as corrections. **C**: smallest change matching the approved ADR text, **no schema change**; closes the only observed inconsistency and makes `ambiguous` unreachable; but refuses some documents accepted today, including ones that merely *look* like corrections, and the legacy `VLIC1` default window (2020-01-01) would need an explicit start; the pinned test `never counts a superseded version as an overlap` would be changed **deliberately**. **D**: status quo leaves the legacy code unable to replace a governing version at all.
- **Dependencies.** Tolerance needs a value, which overlaps clock-rollback thresholds (**OQ-76**, undecided) — the brief recommends deciding OQ-76 first or keeping strict. As-of-as-contract forces B or C. Option C needs Owner ratification because it is a behaviour change and OQ-86 asks precisely this.
- **Decision needed.** Six checkboxes in the brief's §7: retroactive supersession (A/B/C), legacy `VLIC1` (status quo / signed-only), tolerance (strict / value after OQ-76), as-of reads (recomputation / contract).
- **Why it gates L-04.** Same reason as D-1, from the other side: if a past window can be rewritten or left ambiguous, "the capacity that governed on day X" is not a stable input to a capacity-conflict evaluation.

### D-3 — Ratify `license-binding-conflict` (name and 409 class) · **live on `main` now**

- **Exact question.** Is the retained-state reason `license-binding-conflict`, answered as HTTP 409 with nothing written, the approved contract for "a license identifier is bound to another customer or another installation"?
- **Current behaviour (verified).** §3.1. Three code paths produce it (domain rule 2a; cross-installation guard 2b; the in-transaction claim race). It is in the 409 set, is written to `licensing.license_audit_events.reason`, and is covered by unit and live tests.
- **Documented options.** Report §9 item 1 and brief §7: **ratify as-is**, or **direct a different reason name / HTTP class**. The approved texts settle *that* the conflict is refused with nothing written (PDR-11 §2.1, ADR-0046 Decision 2's binding, ADR-0046's 409 retained-state conflict family) and settle **neither** the name nor the class.
- **Consequences.** Ratifying: no code change; the name becomes contract. Renaming: a breaking change to responses already on `main` and to audit rows already written — any rename should be decided **before** customers' automation reads it, and would need a migration or a compatibility mapping for existing audit `reason` values. Moving it out of 409: would separate it from the retained-state conflict family ADR-0046 defines and from the frontend's existing "every 409 → retained-state conflict message" mapping.
- **Dependencies.** None. Cheapest decision in this list and the only one that is purely a ratification.
- **Decision needed.** One checkbox: ratify, or supply the replacement name/class. **This does not authorize any code change** — a rename would be its own slice.

### D-4 — Q3: renewal identity · **gates L-04**

- **Exact question.** Does a renewal keep the same `licenseId` (license continuity, so the customer-binding rule applies to every renewal), or does each renewal get a new license?
- **Current behaviour (verified).** §3.3. The CLI always mints a new `licenseId` and has no flag to target an existing one, so today's tooling *de facto* implements "new license per renewal" — **without that ever being decided**. Rule 2a therefore cannot be reached through the documented tooling.
- **Documented options.** Brief §5 and §7: **same `licenseId`** · **new license per renewal**.
- **Consequences.** *Same `licenseId`*: the binding rule protects every renewal; history reads as one license over time; but the issuer CLI must gain a way to target an existing license (a new flag plus a lookup of the current license), and renewals for a genuinely different commercial entity become refusals rather than new licenses. *New license per renewal*: no tooling change; but "one customer per license" no longer implies "one customer per installation over time", which is precisely what makes **D-5** reachable, and license continuity for support/history must be reconstructed by joining on the installation.
- **Dependencies.** Interacts with D-1 (G2 would force a new license after a lapse) and with D-5. The brief's §6 records the engineering view: decide Q3 **before** any capacity slice, because capacity attaches to a license identity.
- **Decision needed.** One checkbox. If "same `licenseId`", also decide whether adding an issuer flag to target an existing license is authorized (that is a tooling slice, not part of L-04).

### D-5 — Q4: may an installation change customer through a new license? · **live and reachable on `main`**

- **Exact question.** Can an installation's commercial customer change as a side effect of importing a license (a transfer)? If yes, must it be an explicit, audited action rather than a consequence of an import?
- **Current behaviour (verified, and broader than previously recorded).** §3.4. A successful import overwrites `installation.customerId` unconditionally; nothing in the import path compares it to the current value; the change is reachable through the **documented** CLI renewal path (new `licenseId` + a different `--customer`, with `--supersedes` or a non-overlapping window); and it is audited only as a generic `license.import.applied`, with **no `customerId` column and no distinct reason** on `LicenseAuditEvent`.
- **Documented options.** Brief §5 and §7: **not allowed** · **allowed, audited** · other.
- **Consequences.** *Not allowed*: a new rule in the import path refusing a document whose customer differs from the installation's current customer — a behaviour change that would refuse documents accepted today, so it needs ratification like any conflict rule; genuine transfers then need a separate, explicit action. *Allowed, audited*: transfers stay possible but become attributable — an audit event (or a `reason`/detail) recording the previous and new customer; note this touches the audit schema, so a migration and rehearsal would be required. *Allowed as today*: the silent re-attribution and the unattributable audit trail both remain, which sits awkwardly with PDR-11 §12.9's "explicit, auditable resolution" for capacity-changing or destructive consequences.
- **Dependencies.** D-4 first: if renewals keep one `licenseId`, most transfers become refusals under rule 2a and this question narrows to genuine re-assignments. Interacts with PDR-11 §2.1 (a customer owns one or more installations) and with OQ-77 (audit retention/fields) if the audit shape changes.
- **Decision needed.** One checkbox, plus — if "allowed, audited" — whether the audit change is in scope for the same slice or deferred.
- **Why the priority rose.** This is not a theoretical gap: it is an unattributed commercial-identity change on `main`, reachable with the shipped tooling.

### D-6 — F-12: the initial administrator credential · **blocks any non-development deployment**

- **Exact question.** What is the approved remediation path for a bootstrap administrator whose password is a documented constant with no forced change?
- **Current behaviour (verified).** §3.7. `'1'`, hardcoded, no env override, no forced change; `README.md` instructs the operator to change it immediately via the existing password-reset API.
- **Documented options.** The repository documents the *limitation*, not a chosen remedy — report §9 item 4 and F-12 leave the path to the Owner. Candidate paths visible in the existing records, for the Owner to choose among (this pass adds no recommendation as policy): a forced password change on first login; a generated one-time credential emitted only to the operator at bootstrap; a required env-provided initial password with a fail-closed refusal when absent. Each has different consequences for the Compose first-run experience, for CI's `Bootstrap system administrator` step, and for unattended deployments.
- **Consequences.** Unresolved: any deployment beyond local development starts with a publicly documented credential — the report classifies this as a **Blocker** for non-development deployment, and it is pre-existing, not a licensing regression. Resolving it likely touches the bootstrap service, `.env.example`, `README.md`, the Compose `migrate` job and CI's bootstrap step, so it is its own slice.
- **Dependencies.** Independent of D-1…D-5 and of L-04. Related open items: OQ-19 (self-disable / last-admin lockout safety, per the bootstrap report) and the security-policy class AG-15 refers to the Owner.
- **Decision needed.** Choose the remediation path and authorize a slice for it. **Does not gate L-04** — but it gates shipping.

### Not Owner decisions (recorded so they are not mistaken for blockers)

- **E-1 (F-6):** add response schemas for `GET /license/current` and `POST /license/activate`, following the `LicenseImportResultDto` pattern already merged. Pure contract documentation; no policy.
- **E-2 (F-7):** add a CI drift check for `frontend/src/api/generated/vardena-api.d.ts` (boot the API or use a committed OpenAPI snapshot, regenerate with the pinned `openapi-typescript@7.13.0`, fail on diff). CI change → its own reviewable slice.
- **E-3 (F-10):** no test exercises the 10 s lock-wait timeout. **E-4 (F-13):** the two licensing migrations ship no down script. **E-5 (F-11):** bootstrap refuses to *create* the administrator when an active license is at its user limit — designed refusal, no change.
- **Owner acceptance** of PR #137 and PR #138 is an acceptance act, not a decision above; both are merged and neither is accepted.

---

## 6. L-04 readiness assessment

**Candidate slice:** L-04 — capacity-change conflicts (PDR-11 §8.3, §8.4, §8.6), per report §11. **Not started; nothing implemented by this pass.**

### 6.1 What is already true (verified)

- **§8.3 is implemented.** `LicensingService.assertCanActivateUser(currentActiveCount)` (line 194) and `assertCanCreateOrganization(currentCount)` (line 187) enforce user and organization capacity at limit; F-11 confirms the refusal fires loudly.
- **§8.4 and §8.6 are not.** The import path persists `organizationLimit` / `userLimit` (`license-import.service.ts:565–566`, `licenses.repository.ts:575–576`) and **never compares them to current usage** — `grep` for `assertCan`/capacity in the import service returns nothing. There is no conflict state in the license state read, no resolution command, and no migration for a conflict record.
- **PDR-11 agrees this is undecided design.** Row 59: "Downgrade application | Conflict check, explanation, preservation, explicit resolution, no destruction | §8.6 | None | **Approved · algorithm is design item (§16)**"; §16 item 3 defers "the atomic application algorithm (§8.6)".

### 6.2 Dependencies that prevent L-04 from starting safely

| # | Dependency | Type | Why it blocks |
| --- | --- | --- | --- |
| 1 | **D-1 / OQ-80** — overlap and gap policy | **Owner decision** | Capacity is per-version; "which version's capacity applies on day X" is undefined while overlap/gap resolution is open. |
| 2 | **D-2 / OQ-86** — retroactivity and Gap C | **Owner decision** | If a past window can be rewritten or read `ambiguous`, the capacity that "governed" on a past day is not a stable input to a conflict evaluation or to an audit of it. |
| 3 | **D-4 / Q3** — renewal identity | **Owner decision** | Capacity attaches to a license identity. Whether a renewal is the same license or a new one decides whether capacity is continuous across renewals or restarts — and therefore what "reducing" even means. The brief's §6 already says decide Q3 before any capacity slice. |
| 4 | **§8.6 application semantics** — does a reducing version take effect at its `validFrom` with a conflict state, or is it **held** until the administrator resolves the excess? | **Owner decision** | Report §11(a): §8.6's wording admits both readings. This is the slice's central control flow; picking one implicitly is exactly what AG-09 forbids. |
| 5 | **§8.4 deactivation semantics for excess users** | **Owner decision** (user lifecycle) | Which users are excess, who chooses, what state they enter, and how re-activation works. Interacts with OQ-19 (last-admin lockout safety). |
| 6 | Likely new table for a conflict record/state → migration + rehearsal | Engineering | Consequence of 1–5, not an independent blocker; cannot be designed before them (AR-10, AG-08). |

**Explicitly *not* blockers:**

- **Heavy live/E2E suites.** They run in CI and are green on `d283744` (run `38210710188`, including `E2E tests (incl. live-DB suites)` and all three migration rehearsals). The sandbox's inability to run Docker, Postgres-as-service or `prisma migrate deploy` is an environment limit, already recorded as F-14, and per AG-20/AGENTS.md the CI result on the exact final SHA is the authority. A task is not blocked because heavy E2E is unsuitable locally.
- **F-6, F-7, F-10, F-13.** Contract documentation, a CI gate, a test gap and an operational note. None changes what L-04 must decide. F-7 is worth doing early anyway, since L-04 will add response schemas.
- **F-12 / D-6.** Blocks *deployment*, not L-04's start.
- **`license-binding-conflict` ratification (D-3).** L-04 does not depend on the name; it may add its own reasons, which would then need the same ratification discipline.
- **Undecided items that are out of L-04's scope** and must stay out of it: Grace/Read-Only enforcement (OQ-45), revocation (OQ-78), replacement (OQ-82), device quota (OQ-83), signed receipts (OQ-84), the Owner-side system (OQ-85), clock thresholds (OQ-76), audit retention (OQ-77). The alternatives to L-04 are each blocked by one of these, which is why L-04 is the candidate at all.

### 6.3 Verdict

**L-04 is NOT READY to start.** The blockers are **decisions, not engineering**: dependencies 1–5 above are all Owner questions, and 4 and 5 have no documented option set yet — they need a decision brief of their own before implementation could be scoped honestly. Starting L-04 now would require the implementing agent to choose the §8.6 application semantics and the §8.4 deactivation rule itself, which AG-09 ("no invented business rules") and AR-29 forbid.

**What *can* proceed without any Owner decision,** if the Owner wants work in flight while D-1…D-6 are considered: E-1 (F-6 response schemas) and E-2 (F-7 CI drift check) — both small, both reviewable, neither touches policy. They are **not** L-04 and must not be described as starting it.

**Unblocking path.** Record D-1, D-2 and D-4 in the brief's §7 table and in `docs/open-questions.md`; answer dependency 4 (§8.6 application semantics) and dependency 5 (§8.4 deactivation), ideally in a short L-04 decision brief modelled on the OQ-80/OQ-86 one. D-3 and D-5 are independent of L-04 and should be decided on their own merits — D-5 promptly, because the behaviour is live.

---

## 7. Local checks run for the documentation changes

Only checks relevant to a documentation-only diff were run; no heavy suite was executed.

| Check | Command | Result |
| --- | --- | --- |
| Scope of the diff | `git status --porcelain`; `git diff --stat` | 5 existing files modified + 1 new file; **all Markdown**. No `.ts`, `.prisma`, `.sql`, `.json`, `.yml` touched. |
| No product code changed | `git diff --name-only` | Confirms documentation only. |
| Referenced paths exist | script over every `docs/…`, `backend/…`, `frontend/…`, `.github/…` path cited in the new text | All resolve in the working tree. |
| Cited SHAs are real | `git cat-file -t <sha>` for `d283744`, `4bdd970`, `8a8e637`, `345047a`, `f9dd36f5` | All present after the depth-limited fetches. |
| OQ register integrity | row count and status cells for OQ-80 / OQ-86 | Both rows still present, both still `**OPEN — registered 2026-10-11…**`; statuses byte-identical. |
| Markdown table shape | column counts of every edited/added table | Consistent header/separator/body widths. |

**Deliberately not run, and not claimed:** `npm test`, `npm run test:e2e`, the migration rehearsals, `typecheck`, `lint`, `format:check`, `npm run build`, `npm run api:types`. Neither `backend/node_modules` nor `frontend/node_modules` exists in this sandbox; no Postgres or Docker is available; and a documentation-only diff cannot affect them. Root-level Markdown is **not** covered by either Prettier gate (both run `prettier --check .` from `backend/` and `frontend/` respectively, and there is no root `package.json` or Prettier config), so no format check applies to these files.

**CI result for these edits.** Run `38210710188` verifies `d283744`, the state *before* these documentation edits, and is **not** evidence for them. The commit that carries them is `ca33a8266d83c47b53c77d51392a8a3ac83455f7` on branch `arena/050ebc8c-vardena`, opened as PR #139 (base `main`, not merged). Its own CI is **green**: run `38213183679` (`pull_request` at `ca33a82`), `status=completed`, `conclusion=success` — backend job `114691779064` (27 steps, zero steps with a non-success, non-skipped conclusion) and frontend job `114691779170` (13 steps, likewise). That is the exact-commit result AG-20 requires before any pass claim; it is cited for `ca33a82` only and is not reused for any other SHA. The follow-up commit that recorded this CI result is documentation-only in turn, so its own run is cited in PR #139 rather than here.

---

## 8. Limitations of this verification

- **Shallow clone.** Local history is depth-limited; each cited SHA was fetched individually. Ancestry beyond the fetched commits was not revalidated locally — `gh` is the authority for PR/merge metadata.
- **CI log contents unreadable.** The Actions log blob host is unreachable, so per-test counts inside run `38210710188` could not be quoted; only step- and job-level conclusions are cited. §13.3's numbers remain local claims.
- **No Docker, no database, no `node_modules`.** The Compose path, the browser smoke test (prior report §7), a live reproduction of Gap C, and an independent regeneration of the OpenAPI client were all impossible here. Gap C was re-verified by **code reading** of `overlappingVersions` and its pinning test, which is stated as such and is weaker than the prior session's executed scratch spec (that spec was deliberately deleted, since its expected outcome depends on D-2).
- **§3.4's reachability claim is code reading, not an executed import.** The path (new `licenseId` + different customer + `--supersedes` → `installation.customerId` overwritten) is derived from `license-import.service.ts:553` and `licenses.repository.ts:479–559`, and no guard was found; it was **not** executed against a live database in this pass. It should be confirmed by a live test if the Owner wants it as evidence for D-5.
- **No Owner or customer data inspected.** Nothing here accepts a slice, answers an OQ, ratifies a reason, or authorizes L-04.

---

## 9. Final status

`READY FOR REVIEW`

The post-merge state of `main` is verified and green at `d283744` (run `38210710188`), the reconciliation records are now consistent with it, and the commit carrying these documentation edits has its own green CI on the exact SHA (`ca33a82`, run `38213183679` — §7). Nothing further is needed from engineering before review; what remains is the Product Owner's.

This pass was `READY FOR CI VERIFICATION` when first written, because the edits had no CI result yet. That condition is now satisfied, so the status moved. It is recorded here rather than silently changed, because the difference between "no CI result yet" and "CI green on the exact commit" is precisely the distinction this pass exists to keep honest.

Why the third status is **not** the answer:

- **Not `BLOCKED`.** Nothing in *this* task is blocked. The verification was completed, the records were reconciled, and every finding is reported with file paths and commit/run evidence. L-04 being not-ready is a **finding of this task, not a blocker of it** — and its blockers are Owner decisions (D-1, D-2, D-4, plus the §8.6 application semantics and the §8.4 deactivation rule), which is the correct and expected state under AG-09 and AR-29, not a technical failure. Heavy E2E being unsuitable locally is explicitly not a blocker: CI runs it, and it is green both on `d283744` and on `ca33a82`.

**Awaiting the Product Owner:** D-1…D-6 (§5), and Owner acceptance of PR #137 and PR #138. **L-04 must not be started** until §6.2's dependencies 1–5 are recorded by the Owner. PR #139 is open for review and was **not** merged by this pass.
