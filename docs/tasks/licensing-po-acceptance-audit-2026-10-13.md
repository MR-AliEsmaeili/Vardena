# Product Owner Acceptance Audit — Merged Licensing PRs #137–#143, F-8 and F-12 (2026-10-13)

> **Current-tree reconciliation (2026-10-14):** at `main`
> `05933588fad3f1cb76475d48c3f9586ec32494df`, L-05 (#146), F-12's core
> bootstrap/forced-change flow (#149), and L-06 (#150; #151 shares its merged
> commit) exist. Earlier outstanding-feature/credential-policy statements below
> are historical. The remaining F-12 credential-transition defects and their
> corrective slice are recorded in
> [the repository-first task record](f-12-credential-transition-correction.md).
> OQ-83 remains open; no device policy or Owner acceptance is inferred.

Status: **READY FOR REVIEW — NOT ACCEPTANCE.** This record exists to let the
Product Owner accept, hold or rule on the merged licensing work. Merge state and
green CI are treated as facts to verify, never as acceptance.

- **Exact `main` SHA audited:** `2494e5de38c46ed59f20f5858186503039a95747`
  (= `origin/main`; merge commit of PR #143; `2026-10-13T06:03:17Z`). Every
  statement below is scoped to that SHA.
- **Audit branch:** `arena/71770b1b-vardena` (documentation only). No product
  code, schema, migration, permission, API contract or generated client is
  changed by this audit.
- **Owner decisions this audit applies:** the F-8 license-identity decisions and
  the F-12 initial-System-Administrator decisions of 2026-10-13 (verbatim
  restatement in §4 and §5).

**Revision 2 — corrections after the Product Owner's review of PR #144
(2026-10-13).** Two corrections were applied to revision 1, and both are
requirement-level, not editorial:

1. **Finding 1 (L-04 reduction-control gap) — corrected.** Revision 1 presented
   "the Owner narrows §8.6's scope" as an alternative of equal standing to
   implementing the control. That was wrong: PDR-11 §8.6 is unconditional and the
   F-8 decision requires the control to hold for a changed `licenseId`. §4.4 now
   records the requirement as **NOT SATISFIED**, removes the narrowing framing, and
   specifies the concrete corrective task **L-05** with its mandated regression
   coverage. **PR #142 stays `HOLD`** until L-05 is merged and verified.
2. **Finding 2 (customer code) — expanded and raised.** §4.6 now traces customer
   identity and code through the Prisma model, the only customer-creation path, the
   issuer CLI, the signed payload, validation, import/upsert and installation
   binding; the "same customer code" criterion is reported as **NOT SATISFIED**
   (no representation, signature or validation exists) with the minimal corrective
   task **L-06** and its acceptance tests. §4.7 states the requirement-level status
   of every F-8 decision.

**F-8 is NOT fully satisfied** and this audit does not present it as such. The
acceptance recommendations for the merged PRs (#137-#141 and #143) are unaffected
and are **separate from the acceptance status of this audit record itself**, which
is not accepted. No product code, schema, migration, permission, API contract or
generated client is changed by either revision.

## 1. Method and what was actually run

| Step | Result |
| --- | --- |
| Current `main` resolved from `origin` (`git fetch --unshallow`) | `2494e5de38c46ed59f20f5858186503039a95747` |
| Candidate PRs re-checked live (`gh pr view`) — state, head SHA, merge SHA, files | All seven MERGED; every merge SHA is an ancestor of `main` (`compare` → `behind_by=0`, `ahead_by=0`) |
| Merge-commit CI re-read per SHA (`/commits/{sha}/check-runs` and `gh run view`) | All seven: `completed / success`, and each run's `head_sha` equals the merge SHA (never a PR-head substitute) |
| Backend dependencies installed (`npm ci`, exit 0) | Fast local checks possible |
| `npx vitest run` (backend, full unit suite) | **148 files / 2020 tests passed** |
| `npx tsc --noEmit` | clean |
| `npx oxlint .` | 0 errors, 1 pre-existing warning (unrelated accounting spec) |
| `npx prettier --check .` | clean |
| Live PostgreSQL / migration rehearsals / full e2e | **GitHub CI on the exact merge SHAs only** (no PostgreSQL, no Docker in this environment); pre-fix failure reproduced in CI is quoted in §6 |
| Temporary conflict-authority probe (`zz-audit-probe.spec.ts`, deleted after use) | §4.3 evidence A–F |
| Revision 2: re-trace of every customer-identity/code layer (model, writer, CLI, payload, validation, import, binding, tests) | §4.6 — no customer-code representation exists |
| Revision 2: re-read of PDR-11 §8.6, `reductionConflicts`/rule 6b, the resolution plumbing and the renewal tests (`license-import.service.spec.ts:487`, `:1878`, `:2798`) | §4.4 — the control must be implemented, not narrowed |
| Revision 2: repository-consistency checks on the changed docs (internal links resolve; every referenced run/SHA exists; no unrun test claimed) | passed (see §8) |

## 2. PR inventory and exact-SHA CI evidence

| PR | Head SHA | Merge SHA | Merged (UTC) | Files | Merge/main CI run | Result |
| --- | --- | --- | --- | --- | --- | --- |
| #137 | `2ecd8396f0edcc1c34b3724c79cd767b3401c96d` | `345047abec5a6af6760b05ad36b570ee5ed3a5f9` | 2026-10-11 20:10:51 | 63 | `38171112633` (`push`) | success — backend, frontend |
| #138 | `4bdd97048002dede854d3925c3a182854ed93988` | `d283744b4098346b6ef2e0b91922266f10cdabd1` | 2026-10-12 06:03:27 | 21 | `38210710188` (`push`) | success — backend, frontend |
| #139 | `ff44da49db3340be42fa1b44606f757e8b44b2f7` | `9ac2cc58d3fef2659feaa867a2565a99e8e77102` | 2026-10-12 07:23:19 | 6 | `38217456331` (`push`) | success — backend, frontend |
| #140 | `b3444c8c9cab7355ec456f6b225168eaf95a4b6a` | `cdf21e4d6bd5da7e5d95f98f88302122425ec6b1` | 2026-10-12 07:55:51 | 18 | `38220526809` (`push`) | success — backend, frontend, generated-api-client |
| #141 | `6c931b8b288d145833f3934bda19a7850459fb4f` | `f4c2e84f7af734c356e035dabc69bb8acfa81a05` | 2026-10-12 11:39:07 | 26 | `38244025219` (`push`) | success — backend, frontend, generated-api-client |
| #142 | `fdf2fdbc665359157d74210b65e4fb1defaead63` | `f0b047ae4950edced9e301411da710dd82c68ed1` | 2026-10-12 18:20:27 | 32 | `38290247234` (`push`) | success — backend, frontend, generated-api-client |
| #143 | `e6477df3e27b83410620db58c3c2d7e88da76268` | `2494e5de38c46ed59f20f5858186503039a95747` | 2026-10-13 06:03:17 | 13 | `38354611367` (`push`) | success — backend, frontend, generated-api-client |

All seven merge commits are on `main` (ancestry verified against the remote, not
against a local branch). The PR-head runs recorded in the documents were also
re-checked and are consistent with their stated SHAs (for example #141's head
run `38239438399` = `68d50517…`, success; #142's head run `38289188865` =
`fdf2fdbc…`, success). PR-head evidence is **not** used as merge-commit evidence.

## 3. Per-PR review findings

Reviewed substantively (not from descriptions): the conflict authority
(`domain/license-version.ts`), the import service and repository
(`application/license-import.service.ts`, `data/licenses.repository.ts`), the
four licensing controllers and DTOs, migrations `20261014000000` →
`20261018000000`, the OpenAPI contract spec, the generated client and its CI
gate, the unit/e2e suites, the migration rehearsal, and the decision records.

### PR #137 — L-03 retained versions and signed-file import (core slice)
- Implementation is the foundation later amended by #138/#141/#142/#143; the
  current `main` state of that slice was reviewed, not the historical diff alone.
- Transaction boundary is real: one transaction per import, `SELECT … FOR UPDATE`
  on the installation row, READ COMMITTED, authoritative re-evaluation under the
  lock, plain-`INSERT` claim for a license identifier
  (`data/licenses.repository.ts:537–700`).
- Migration ordering is additive and ordered: `20261014000000` creates the
  version model and backfills; `20261015000000` adds `governs_until` and repairs
  prematurely retired rows; `20261016000000`/`20261017000000`/`20261018000000`
  are nullable/`TEXT`-only additions. The licensing rehearsal applies all of
  them to populated data and asserts preservation.
- Documented non-goals at the time (revocation, device licensing, Grace mode,
  §8.6 flow) are registered as OQ-77/78/79/82/83/84 and are **not** defects of
  this PR.
- OpenAPI/response-schema gaps F-6/F-7 that this PR left are closed by #140.

### PR #138 — refuse license re-binding; post-merge audit
- Rule 2a (`license-version.ts:1062–1067`) refuses a retained identifier bound
  to a different customer; the cross-installation claim is refused inside the
  transaction under the lock (`licenses.repository.ts:627–642`) and mapped to
  409, never a 500. Covered by unit, e2e and live-PostgreSQL cases
  (`licensing-persistence-live.e2e-spec.ts:1026`, `:1217`, `:1378`, `:1562`).
- The ratification the PR asked for ("is `license-binding-conflict` the right
  name/class?") was given in the 2026-10-12 Owner decisions and is recorded in
  #141's records — no outstanding question remains for this PR.

### PR #139 — documentation-only post-merge verification and L-04 readiness
- Six Markdown files; no runtime change. Its statements are explicitly scoped to
  `d283744` and are superseded where later PRs changed the facts (L-04 is now
  implemented; Q3 is now superseded; F-6/F-7 are closed). Its §3.3/§D-4 record
  of *why* identity matters for capacity continuity is the record this audit
  builds on in §4.4.

### PR #140 — F-6 OpenAPI schemas and F-7 generated-client CI drift check
- `GET /license/current` documents `LicenseStateDto`, `POST /license/activate`
  documents `LicenseImportResultDto` (`license-state.controller.ts:27`,
  `license-activation.controller.ts:65`), asserted against the live Swagger
  document by `license-openapi.contract.spec.ts`.
- Drift gate is real and mechanical: `scripts/check-generated-api-client.sh`
  dumps OpenAPI with `npm run openapi:dump`, regenerates
  `frontend/src/api/generated/vardena-api.d.ts`, then `git diff --exit-code`.
  It runs as the `generated-api-client` CI job, green on every merge SHA from
  #140 onward.

### PR #141 — Owner decisions (OQ-80/OQ-86/Q3/Q4) recorded and implemented
- Overlap = Option B, gap = G2, OQ-86 = Option C, legacy `VLIC1` restriction
  preserved, strict tolerance, as-of recomputation: all present in
  `evaluateImportConflicts` (`license-version.ts:1040–1246`) and pinned by tests.
- Q4 is enforced and audited: rule 2b refuses a document naming another customer
  unless the dedicated operation carries the intent
  (`licenses.repository.ts:643–655` upsert, `:725` transfer audit event);
  `POST /api/v1/license/customer-transfer` requires **both**
  `Licensing.License.Activate` and `Licensing.Installation.TransferCustomer`
  (route guard + application re-check). `transfer-not-applicable` prevents
  replay. *(The reason was renamed `transfer-requires-different-customer` by
  [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) §3.5.4;
  the replay protection is unchanged.)*
- PDR-12 (OD-LIC-01) is implemented: only a document that *names* the version it
  retires may close an open end (`license-version.ts:1269–1316`, `namedByDocument`);
  that arm is never operator-resolvable.
- **Q3 (renewal identity = the same `licenseId`) is superseded by the Owner
  decision of 2026-10-13** and its `--license-id` follow-up is withdrawn, not
  owed (see §4.5). The implementation never enforced identity continuity, so the
  supersession requires no code change in this PR's scope.

### PR #142 — OQ-87 Option B (post-gap recovery) and L-04 reduction flow
- Recovery path: `POST /api/v1/license/gap-recovery`, both permissions, required
  3–500 reason, one transaction, typed `license.import.recovered` event with the
  machine-readable `previous_license_id` (additive migration `20261017000000`),
  legacy code refused 422, ordinary import refused 409
  `post-gap-recovery-requires-dedicated-operation`, `recovery-not-applicable`
  when there is no lapse. Verified in code and in
  `licensing-persistence-live.e2e-spec.ts:1716`.
- L-04: the §8.6 check runs on **every path that retires a version** (explicit
  supersession, Option-B hand-over, legacy replacement), reads usage inside the
  transaction under the advisory locks the allocation guards hold, fails closed
  on an uncountable usage, and is authorized only by
  `POST /api/v1/license/reduction-resolution` (both permissions, required
  reason, typed `license.import.reduction-resolved` event). PDR-12's non-
  resolvable `open-end-closed` arm is preserved.
- **Finding G-8.1 (HOLD ground, see §4.4):** a successor that *retires nothing*
  — the ordinary contiguous renewal — is not evaluated for reduction at all, so
  a renewal that lowers `organizationLimit`/`userLimit` or removes an
  entitlement is applied with no check, no explanation and no resolution. This
  holds identically for a retained and for a changed `licenseId` (probe A/B).

### PR #143 — preserve full audit reasons and context
Reviewed in §6; recommended for formal Product Owner acceptance.

## 4. F-8 — license identity

### 4.1 The decision applied

1. Preserving the previous `licenseId` during renewal is **not** a requirement.
2. A newly issued license must remain bound to the same intended customer and the
   same customer code.
3. A changed `licenseId` must not bypass customer binding, installation binding,
   retained history, version precedence, capacity/entitlement reduction controls,
   replay protection, or audit requirements.
4. `--license-id` must **not** be implemented merely to force reuse of the old
   identifier.
5. Audit the existing model and tests for what a new identity may do, what the
   signed document must bind, and how customer identity/code are represented; if
   the code cannot enforce the decision unambiguously, report the exact gap.

### 4.2 What the model enforces for a changed `licenseId`

| Control | Enforced for a new identity? | Evidence |
| --- | --- | --- |
| Customer binding (license → customer) | Yes, by construction: a new identifier creates a *new* `licensing.licenses` row with its own `(installation, customer)`; an identifier already bound elsewhere is refused | `licenses.repository.ts:627–642` (409 `license-binding-conflict`), rule 2a for retained identifiers (`license-version.ts:1062–1067`) |
| Installation binding | Yes: the document's `installationId` must be this installation's identity (pipeline stage 6), and the same identifier cannot be claimed by two installations (plain `INSERT` + PK arbitration) | `licenses.repository.ts:663–690`; live cases at `licensing-persistence-live.e2e-spec.ts:1217`, `:1378`, `:1562` |
| Retained history | Yes: versions are append-only; nothing is rewritten or deleted; identity change adds rows | `licenses.repository.ts:779–830`, migrations `20261014000000`/`20261015000000` |
| Version precedence | Yes: effective windows of all retained versions must stay disjoint; an overlapping new identity is either refused or becomes a dated hand-over | `license-version.ts:1122–1200`; probe F |
| Replay protection | Yes: per-installation unique `operationId` and `document_hash`; duplicate → 409, nothing written | `licenses.repository.ts` unique indexes; service spec duplicate cases |
| Audit | Yes: `license.import.applied` written in the state-change transaction with actor, source, hash, license and version ids; rejections audited separately | `licenses.repository.ts:833–855`, `:875–897` |
| Capacity/entitlement reduction controls | **No — requirement not satisfied; corrective change L-05 required (§4.4)** | Probe A/B; rule 6b gate at `license-version.ts:1198` runs only when a version is retired |

**Answer to the F-8 §5 question — may a new identity be used for an ordinary
contiguous renewal?** Yes. A candidate carrying a new `licenseId` whose window
starts exactly at the installation's retained coverage end (`validFrom ==
coverageEnd`) is not a post-gap candidate (`isPostGapRecoveryCandidate` requires
*strictly after*), overlaps nothing, and is accepted as an ordinary import. It
must name the **same customer** the installation is bound to; naming another
customer without the transfer operation is refused `installation-customer-mismatch`
(probe C). The CLI supports exactly this renewal today (`--customer <existing
customerId>`, `--installation`, `--valid-from`, `--valid-until`), and correctly
has **no** `--license-id` flag (`backend/src/issue-development-license.ts`;
`--format v1|v2`, `--artifact`, `--out`; refuses `NODE_ENV=production`). Decision
#4 is therefore already satisfied and no corrective tooling was added.

**What the signed document binds:** `v`, `kind`, `operationId` (replay identity),
`licenseId`, `customerId`, `customerName`, `installationId`, `status`,
`validFrom`/`validUntil`, `organizationLimit`/`userLimit`, `modules`/`features`,
optional `supersedesOperationId`, `issuedAt` — signed Ed25519, verified against
`LICENSE_SIGNING_PUBLIC_KEYS`, canonical form checked
(`domain/license-document.ts:460–505`). A renewal therefore binds the new
identity to this installation, this customer, this window and this grant.

**How customer identity and "customer code" are represented:** the only machine
customer identity is `licensing.customers.id`, carried as `customerId`; the
document also carries `customerName`, validated as a non-empty bounded string
but **not** an identity and **not** compared with the stored display name. There
is **no separate business "customer code" field** anywhere in the schema, the
document or the API — "the same customer code" can only be enforced as the same
`customerId`. Two consequences are recorded rather than resolved:
- the import upserts `customers.displayName` from the signed document
  (`licenses.repository.ts:643–655`), so a document that keeps `customerId` but
  changes `customerName` silently renames the customer with no audit event;
- with identity continuity no longer required, consecutive licenses of one
  customer/installation are separate rows with **no machine-readable successor
  link** (nothing is retired on a contiguous renewal, so neither
  `supersedes_version_id` nor `previous_license_id` is set). Continuity is
  reconstructible only from installation + customer + adjacent windows.

### 4.3 Empirical evidence (real conflict authority, temporary probe)

Retained: ACTIVE 2026-01-01 → 2027-01-01, org limit 10, user limit 25,
entitlement `MODULE accounting`; current usage 9 organizations / 24 active users;
candidate: org limit 2, user limit 3, no entitlements (a sharp downgrade).

| Case | Candidate | Result |
| --- | --- | --- |
| A | **new `licenseId`**, contiguous (2027-01-01 → 2028-01-01) | **`{ conflict: null }`** — applied with no §8.6 check |
| B | **same `licenseId`**, contiguous, identical downgrade | **`{ conflict: null }`** — identical outcome |
| C | new `licenseId`, different customer, no transfer intent | `installation-customer-mismatch` (409) |
| D | same `licenseId`, different customer | `license-binding-conflict` (409) |
| E | new `licenseId` starting after coverage end, no recovery intent | `post-gap-recovery-requires-dedicated-operation` (409) |
| F | new `licenseId` starting **inside** the governing window (Option-B hand-over) | `reduction-requires-resolution` with `[organization-capacity 2/9, user-capacity 3/24, entitlement-removed MODULE accounting]` |

Interpretation: changing the identifier **does not** weaken binding, gap
recovery, replay or audit controls (C/D/E), and precedence still catches an
overlapping hand-over (F). The only unguarded path is the one that retires
nothing (A/B) — and it is unguarded for **both** identities, so the change of
identifier is not what creates it.

### 4.4 Finding G-8.1 — the §8.6 reduction control does not cover a successor that retires nothing (required corrective change L-05)

- **Statement (evidence, unchanged from revision 1).** A renewal that starts exactly
  at the retained coverage end and lowers the grant is imported with no
  `reduction-requires-resolution`, no explanation payload and no resolution step,
  because rule 6b (`license-version.ts:1198-1214`) only runs when a predecessor is
  retired, and a contiguous successor retires nothing. Probes A and B (§4.3) show
  the identical outcome for a retained and for a changed `licenseId`; probe F shows
  the overlapping case is guarded.
- **Requirement status: NOT SATISFIED — the approved control must be implemented.**
  PDR-11 §8.6 is unconditional in its trigger: "Before applying a LicenseVersion
  that reduces entitlements or capacity, the system must: 1. check the resulting
  state for conflicts; 2. explain the conflicts …; 3. preserve data; 4. require
  explicit resolution …". Nothing in §8.6 conditions it on the candidate retiring a
  version, and the 2026-10-13 F-8 decision adds that a changed `licenseId` must not
  bypass capacity/entitlement reduction controls. **Narrowing §8.6 is therefore not
  presented by this audit as an equivalent alternative: the corrective change is
  required, and the audit recommends implementation.** The only genuinely open
  input is documentation of the *comparison baseline* used for a renewal (see
  L-05 below); the obligation to check, explain and require an explicit resolution
  is already decided.
- **How the gap arose (historical context, not a justification).** The boundary is
  recorded as an intentional scope limit of the merged L-04 slice:
  `license-version.ts:1011-1012` ("a document that retires nothing … with no
  predecessor retired there is no grant to take away"),
  `docs/licensing/version-model-and-file-exchange.md:219`, and the decision brief
  §8.7. Those statements describe what the merged implementation does; they are
  narrower than §8.6's approved text and they do not settle the requirement. No test
  pins the accepted behaviour — it was demonstrated by the probe only.
- **Prior records anticipated the question.** `docs/tasks/licensing-pr-138-post-merge-verification-and-l-04-readiness.md:229-235`
  records that Q3 "decides whether capacity is continuous across renewals or
  restarts — and therefore what 'reducing' even means". Removing Q3 makes capacity
  discontinuous across identities unless the implementation compares the new grant
  to the previously governing one.

#### 4.4.1 Required corrective implementation task — L-05 (not implemented in PR #144)

Product code is out of scope for this documentation-only PR; the task below is the
exact follow-up and acceptance gate.

- **Trigger (the renewal path that retires no predecessor).** In the single
  conflict authority `evaluateImportConflicts`, after the existing rules have
  accepted a candidate with `supersedes === null`, evaluate a **continuation
  baseline** when at least one retained version's *effective* window ends exactly
  at `candidate.validFrom` (adjacency). Baseline selection must be deterministic
  and identity-independent: prefer a version whose `licenseId === candidate.licenseId`,
  otherwise the version of the customer the installation is bound to; break ties by
  latest `importedAt`, then `versionId` (the existing `compareByStartThenImport`
  ordering). Multi-baseline cases must be decided by that rule, never by guesswork.
- **Evaluation.** Reuse the shipped `reductionConflicts(baseline, candidate, usage)`
  and `isResolvableReductionConflict`; refuse with `reduction-requires-resolution`
  (409, nothing written) and the structured explain payload
  (`reduction.predecessorVersionId = baseline.versionId` plus per-conflict
  kind/limit/usage/entitlement) unless the caller carries the existing
  `ReductionResolutionIntent`. `usage-unavailable` stays a fail-closed,
  non-operator-resolvable conflict. The `open-end-closed` arm cannot arise from the
  adjacency rule itself (a perpetual version has no effective end, so it is never
  the baseline; a candidate that overlaps a perpetual version is the already-guarded
  Option-B hand-over, where closing the open end is refused as `open-end-closed` —
  probe F). The change must prove that with a test instead of assuming it.
- **Plumbing the change.** Today the resolution receipt requires a retired
  predecessor: `licenses.repository.ts:750-754` throws "A reduction resolution was
  applied without a retired predecessor". The evaluation must expose the
  **resolution subject** (the baseline) distinctly from `supersedes`, the
  repository must recompute `reductionConflicts(baseline, …)` under the
  installation/allocation locks, the typed `license.import.reduction-resolved`
  event must name the baseline, and the baseline must **not** be stamped
  (`superseded_at`, `governs_until`, `superseded_by_version_id` stay null) because
  it is not retired. The receipt must carry the same recomputed conflicts.
- **Same change, legacy transport.** The legacy `VLIC1` adjacency renewal is
  equally unguarded today (accepted with no reduction check —
  `license-import.service.spec.ts:1878` "accepts a legacy renewal that starts where
  the version it follows ends"). The check must run there too, added **after** its
  documented L-02 rules so no existing refusal reason changes (the same ordering
  discipline as rules 4/6b/7/7b).
- **Documented out of scope (must be stated, not silently changed):** a first
  license (no retained coverage); non-adjacent/historical documents such as a
  backwards gap fill, where no retained window ends at the candidate's start; and
  the dedicated post-gap recovery, which keeps its own flow.
- **Design record.** The baseline rule and its rationale must be written into
  `docs/licensing/version-model-and-file-exchange.md` §3.3 (and the rule-6b comment)
  as part of the change. One residual Owner input may remain if the baseline choice
  changes policy materially (for example, whether a renewal that follows an
  explicit customer transfer is compared with the pre-transfer grant of the same
  installation). That question is flagged for the Owner; it is not a reason to defer
  the control.
- **Migration/contracts.** No schema change is expected. If a machine-readable
  baseline identifier is added to the audit event, it must be an additive, nullable
  migration (populated-database safe), never an edit to an applied migration.
- **Frontend.** No new UI (the resolution operation has no UI; documented non-goal
  in PDR-13 §7). The existing `reduction-requires-resolution` Persian copy must keep
  applying to the new path — including the "no version retired" case — and must not
  be removed or weakened.
- **Mandated regression coverage (all required before the change is accepted):**
  1. reducing contiguous renewal, **same** `licenseId` → 409
     `reduction-requires-resolution` with the concrete conflicts; nothing written
     (no version, no APPLIED event, no stamp, operation id not retained);
  2. the identical renewal with a **new** `licenseId` → the same refusal (this is
     the F-8 non-bypass evidence);
  3. **below-current-usage** cases: organization limit below the organization count,
     user limit below the active-user count, and entitlement removal, each refused
     with its `limit`/`currentUsage` or entitlement kind/code in the payload;
  4. **within-current-usage** reductions apply through the ordinary import with no
     resolution and no resolution event (the renewal-path counterpart of the
     existing hand-over case, `license-import.service.spec.ts:2798`);
  5. **non-reducing** renewals (identical or larger limits, same entitlements,
     perpetual → perpetual) still apply — no new refusals, and the adjacent-renewal
     case at `license-import.service.spec.ts:487` keeps passing;
  6. **authorization**: ordinary import 409; `POST /api/v1/license/reduction-resolution`
     without `Licensing.License.ResolveReduction` → 403 with nothing written; with
     both permissions and a valid reason → applied in one transaction; missing or
     invalid reason → 400; a resolution that meets no conflict → 409
     `resolution-not-applicable`;
  7. **transaction/audit integrity (live PostgreSQL)**: refusal writes nothing;
     success writes version + `license.import.reduction-resolved` atomically with the
     conflicts recomputed under the locks; a late failure rolls everything back; the
     baseline is not stamped; replaying the operation → stable 409;
  8. **version precedence unchanged**: overlapping candidates keep Option B / their
     existing refusal reasons; explicit supersession, implicit hand-over, legacy
     replacement, `renewal-gap`, `backdated-supersession` and post-gap recovery
     behave exactly as before;
  9. **usage unavailable** on the renewal path fails closed (`usage-unavailable`,
     refused, not resolvable);
  10. **migration rehearsal** unchanged (or extended only if an additive field is
      chosen).
- **Acceptance gate for L-05.** The change is a separate corrective PR with its own
  tests and exact-SHA CI; **PR #142 stays `HOLD` until L-05 is merged and verified**,
  and the F-8 reduction-control criterion stays "not satisfied" until then. PR #144
  (this audit) neither implements nor verifies it.

### 4.5 Record supersession for F-8 / Q3

The 2026-10-12 record "Q3 renewal identity = same `licenseId`" and its
`--license-id` tooling follow-up are **superseded**, not amended, by the
2026-10-13 decision. Dated, append-only notes were added (this audit's only
record changes) to: the Q3 decision record
(`docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §8.3.1), the licensing
post-merge reconciliation (§17), the canonical product source of truth
(PDR-11 addendum), and `STATE.md` §37. No historical text was rewritten and no
claim is made that the old implementation already satisfied the new policy.
**Not implemented, per decision #4:** no `--license-id` flag, no identifier
reuse requirement, no change to `buildLicensePayload` (`options.licenseId ??
generateId()` stays).

### 4.6 Customer code (F-8) — not representable in the current tree; corrective change L-06

The 2026-10-13 F-8 decision requires a newly issued license to remain bound to the
**same intended customer and the same customer code**. The two halves are not
equivalent in this repository, and this audit does not assume they are:

| Layer | What exists today (verified at `2494e5de`) | Customer code? |
| --- | --- | --- |
| Prisma model | `licensing.customers` = `id` (PK) + `display_name` (VarChar 200) + audit columns; no code, no external reference | absent |
| Customer creation / bootstrap | the only writer is the import upsert `tx.licenseCustomer.upsert` (`licenses.repository.ts:642-655`), which sets `displayName` from the signed document; no customer admin API or endpoint, no bootstrap seed, and no `INSERT` into `licensing.customers` in any migration; the local development provider hardcodes one id (`local-development-license.provider.ts:38`, `customerId: '01JLOCALCUSTOMER0000000000'`); the Owner-side register that would own codes is deferred (PDR-11 §4: CF-19, OQ-61) | absent |
| Issuer CLI | `backend/src/issue-development-license.ts` accepts `--customer <id>` and `--customer-name <label>` only; `tools/development-license-authority.ts:75-77` defaults `customerId` to a fresh ULID and `customerName` to `'Development customer'` | absent |
| Signed payload | `customerId` (ID_PATTERN, opaque id ≤ 64 chars) and `customerName` (non-empty, ≤ 200) — `license-document.ts:133-137`, `:484-485`; `license-code.ts` for the legacy transport | absent |
| Validation | `readId` (opaque id shape) and `readName` (display string) only; `customerName` is never compared with the stored `display_name` | absent |
| Import / installation binding | rules 2a/2b compare `customerId` only (`license-version.ts:1062-1067`, `:1072-1085`); a new `licenseId` creates a new `licensing.licenses` row bound to the claimed `customerId`, accepted when it equals the installation's binding | id only |
| Transfer (Q4) | `POST /api/v1/license/customer-transfer` moves `installation.customerId` only, audited with `previous_customer_id`/`new_customer_id` | id only |
| Tests | customer-binding cases exist for the id (`license-version.spec.ts:1082`, `license-import.service.spec.ts:2195`, `licensing-persistence-live.e2e-spec.ts:1026-1090`) | no code case |

- **Conclusion.** The "same intended customer" half **is** demonstrably enforced,
  through the opaque `customerId`: the installation binding refuses a document naming
  another customer without the authorized transfer operation (probe C), and a
  retained identifier cannot be re-bound to another customer (probe D). The "same
  customer code" half is **not representable, not signed, not validated and not
  tested** anywhere in the merged tree. No repository contract establishes that
  `customerId` *is* the business customer code: PDR-11 §2.1/§14 speak of a customer
  as the commercial party without a code attribute, the schema has no such column,
  and the Owner-side register that would own codes is deferred (CF-19, OQ-61).
  **F-8 criterion 2 is therefore NOT SATISFIED**, and this audit does not claim
  equivalence to close it.
- **Observed behaviour worth recording (evidence, not a policy claim).** Because the
  import upserts `display_name` from the signed document, a document that keeps
  `customerId` but changes `customerName` silently renames the customer, and no
  audit event records the rename. That is a second reason a stable, signed business
  code — rather than the display name — is the only enforceable representation of
  "the same customer".
- **Required corrective implementation task — L-06 (not implemented in PR #144).**
  The code's source and shape are an **Owner decision item**; this audit deliberately
  invents no format and alters no identifier:
  1. record the Owner decision on what the customer code *is* (where it is
     allocated, and its stability guarantees) as a dated product record before
     implementation;
  2. make it a first-class, **unique** attribute of `licensing.customers` through an
     additive migration, populated-database safe, with the backfill decision for
     existing rows recorded (never inferred);
  3. carry it in the **signed** document payload (a `customerCode`-class field), so
     the authority binds it; this is a canonical-form/`documentVersion` contract
     change with its own version-handling and payload tests;
  4. validate it at import against the customer the installation is bound to, with a
     stable refusal classifier — either a new reason or an explicitly documented
     extension of `installation-customer-mismatch`; the choice must be recorded, not
     invented in code, and mapped to a 409 with nothing written;
  5. make the transfer operation move id **and** code together and audit both
     (additive columns on the typed transfer event);
  6. extend the issuer CLI (`--customer-code`) and refuse inconsistent id/code pairs;
     **never** default the code to the id or re-derive it from the name.
- **Acceptance tests for L-06:** mismatched customer **id** (existing rule, must keep
  passing); mismatched **code** with the same id → refused, nothing written;
  mismatched code carried by a **new** `licenseId` → refused; absent/invalid code →
  refused (or explicitly tolerated only if the Owner decides so and records it);
  valid renewal with a **new** `licenseId` and matching id + code → applied;
  installation binding unchanged by that renewal; transfer moves both fields and
  audits both; code uniqueness enforced in the database; populated-database backfill
  rehearsed; the generated client/OpenAPI updated only if a response schema changes.
- **Not in this PR.** No schema, payload, permission, API contract or identifier is
  changed by PR #144.

### 4.7 F-8 requirement-level status

| F-8 decision | Status | Evidence / follow-up |
| --- | --- | --- |
| 1. Preserving the previous `licenseId` is not required | **No action** (superseded requirement) | §4.5; no `--license-id` implemented or planned |
| 2a. New license bound to the same intended customer | **Satisfied** (by `customerId`) | rules 2a/2b + Q4 transfer; probes C/D; §4.2, §4.6 |
| 2b. … and the same **customer code** | **NOT SATISFIED** | §4.6 — no representation, signature or validation exists; follow-up **L-06** |
| 3. A changed `licenseId` must not bypass binding, history, precedence, replay, audit | **Satisfied** | probes C/D/E, §4.2/§4.3 |
| 3b. … nor capacity/entitlement reduction controls | **NOT SATISFIED** on the renewal path | §4.4; follow-up **L-05** (PR #142 `HOLD` until then) |
| 4. Do not implement `--license-id` to force reuse | **Satisfied** | CLI has no such flag; none added |
| 5. Audit and report the exact gap where the code cannot enforce a decision | **Done** | this section; probe evidence in §4.3 |

**F-8 overall: NOT SATISFIED — two outstanding implementation items (L-05, L-06).**
The identity relaxation itself needs no code change and is correctly implemented;
the two gaps above are against the same decision and are not waived by this audit.
*(Update 2026-10-14: **L-05** was implemented and merged in PR #146 (`0879db3f0a3740cfbe8e68bce98013fac7322791`), and **F-12** was implemented and merged in PR #149 (`d017636f5e339b26c0b5511009fb3aa450ddd288`). **L-06** was decided by the Product Owner in **[PDR-14](../decisions/product/PDR-14-licensing-customer-code.md)** (`OD-LIC-03`) and implemented on branch `arena/3e77bbc7-vardena`, see [`docs/tasks/licensing-post-merge-reconciliation.md` §19](./licensing-post-merge-reconciliation.md).)*

## 5. F-12 — initial System Administrator

### 5.1 Where the tree stands

| Requirement (2026-10-13) | State on `main` @ `2494e5de` | Evidence |
| --- | --- | --- |
| Initial password is exactly `1` | **Satisfied** | `BOOTSTRAP_SYSTEM_ADMINISTRATOR_INITIAL_PASSWORD = '1'`, username `مدیر` (`backend/src/bootstrap/system-administrator-bootstrap.service.ts:14` (constant), `:96` (use)); no env override exists (`.env.example` has none) |
| Real System Administrator role, highest access allowed by the license/entitlements, no bypass | **Satisfied** | `SystemAdministratorRbacService.ensureForUser` builds the ordinary role from every registered permission **filtered by `filterLicensedPermissions`** (`system-administrator-rbac.service.ts:44–76`); the same filter applies at authorization time (`authorization.service.ts:57`) and to grantable permissions (`permissions.service.ts:50`); no wildcard, role-name or username bypass |
| Forced password change after the first successful login, before normal functionality | **NOT IMPLEMENTED** | No `mustChangePassword`/`forcePassword`/`passwordChangeRequired`/`firstLogin` token anywhere in `backend/src`, `backend/prisma`, `frontend/src`; no column on `users.users`; `POST /api/v1/auth/login` returns the ordinary session with no change-required signal (`identity/api/auth.controller.ts`); `AuthGuard` has no gate |
| Backend **and** frontend enforcement (API, session/token, refresh, failure paths, bootstrap idempotency) | **NOT IMPLEMENTED** | No self-service change-password route exists at all; the only password mutation is the administrator action `POST /api/v1/users/{id}/password-reset` (`users.controller.ts:143`, permission `Users.ResetPassword`); `README.md:51–53` documents the gap ("forced password change is not implemented") |
| Do not use an env variable, do not weaken authorization, do not add wildcards | **Satisfied** | No such variable exists; role/permission model unchanged |

### 5.2 F-12 is an outstanding implementation item (deployment blocker)

It is **not** completed by F-8, by any of PRs #137–#143, or by the mere presence
of a System Administrator role. Required acceptance tests for the corrective
change (each must be able to fail before the change and pass after):

1. **Bootstrap then first login** — `POST /auth/login` with `مدیر` / `1`
   succeeds and the response (and `GET /auth/me`) carries an explicit
   change-required signal; the session is a **restricted** session.
2. **Gate** — with the requirement outstanding, every normal application
   endpoint (e.g. `GET /users`, `GET /license/current`, an organization-scoped
   read) answers 403/409 with a stable code; the only reachable mutation is the
   self password change.
3. **Change flow** — `POST /auth/password` (new endpoint) accepts
   current (`1`) + new password, validates strength/policy, writes the hash with
   the existing `PasswordService`, clears the flag **in the same transaction**,
   and revokes or upgrades the session so the restriction cannot survive.
4. **Session/token handling** — a restricted session cannot be used against the
   API by cookie replay, cannot be refreshed/extended into an unrestricted
   session, and logout/login after the change yields a normal session.
5. **Failure paths** — wrong current password, too-short/weak new password,
   reusing `1`, and a concurrent second change all fail without clearing the
   flag, without a partial write, and with the session still restricted.
6. **Bootstrap idempotency** — re-running `npm run bootstrap:system-admin` on a
   changed account neither resets the password nor clears or re-sets the flag
   (and still reconciles the licensed permission set); on a fresh database the
   flag is set exactly once.
7. **Authorization unchanged** — the restricted session still cannot exceed the
   license/entitlement filter, and no wildcard/permission bypass is introduced.
8. **Migration/additivity** — the new state is a nullable, additive column (or
   equivalent), safe on a populated database, with the bootstrap backfill
   defined for the existing administrator row.

## 6. PR #143 — audit-detail correction and additive migration (recommended for acceptance)

- **Head SHA** `e6477df3e27b83410620db58c3c2d7e88da76268`; **merge SHA**
  `2494e5de38c46ed59f20f5858186503039a95747`; **merge/main CI** run `38354611367`
  (`push`, `completed / success`, backend + frontend + generated-api-client).
- **Migration is additive and populated-database safe:**
  `backend/prisma/migrations/20261018000000_licensing_audit_detail_text/migration.sql`
  performs `ALTER COLUMN "detail" TYPE TEXT` (varchar→text is binary-coercible in
  PostgreSQL: no rewrite, existing values intact) plus a column comment; Prisma
  schema matches (`detail String? @db.Text`,
  `backend/prisma/schema/licensing.prisma:184–185`). No applied migration is
  edited; `20261017000000` remains a nullable `previous_license_id` addition with
  no backfill/FK.
- **Full reasons persist; truncation is gone on the success path:**
  `assertOperationReason` enforces the 3–500 boundary at the application layer
  with the same Unicode counting as `class-validator`
  (`license-import.service.ts:1321–1340`), and is now also called by the
  transfer path (`:682`). The typed builders no longer slice
  (`licenses.repository.ts:1024–1030`, `1059–1080`, `1092–1115`); they are
  inserted unclamped inside the state-change transaction (`:833–855`).
  `clampText` survives only on the separate best-effort rejection path
  (`:897–898`) and is documented as such.
- **Transaction safety / failure path:** the pre-fix defect was real and is
  independently verified here — on PR #143's pre-fix head `dceeaea954aef4f4b48bfdeaa186e5f66d0f44f3`
  (run `38305329909`) the `backend` job **failed** with
  `licensing-persistence-live.e2e-spec.ts:1830` and `:2062` → "to be 200"; i.e.
  exactly-500-character recovery/resolution requests returned HTTP 500 and
  rolled back. The post-fix commit `4ca6239cd1fca2b8ddea5a7291072c2523d83451`
  passed run `38351688052` (all three jobs), and the merged tree carries the
  regressions: `persists a signed post-gap recovery with a 500-character reason
  in PostgreSQL` and `persists an authorized L-04 resolution with a
  500-character reason in PostgreSQL` (`backend/test/licensing-persistence-live.e2e-spec.ts:1716`,
  `:1910`), plus service-spec cases for the 3-character minimum, overlong
  rejection and the Unicode boundary (`license-import.service.spec.ts`, transfer
  cases).
- **Migration rehearsal covers the widening on populated data:**
  `backend/prisma/rehearsal/licensing-version-model/rehearse.mjs` now applies
  `20261016000000`, `20261017000000` and `20261018000000` to the populated
  schema, asserts `detail` is `text` with no length cap, asserts a seeded
  500-character detail is preserved **byte-for-byte**, and round-trips a
  750-character detail.
- **CI isolation change is sound:** the generic e2e step now excludes
  `test/licensing-persistence-live.e2e-spec.ts`, which runs immediately
  afterwards alone with `--no-file-parallelism`
  (`.github/workflows/ci.yml`); the suite deletes/recreates the installation rows
  it owns, so serializing it removes a real inter-suite race without dropping
  coverage.
- **Recommendation:** **ACCEPT** PR #143 formally. It does not complete F-8 or
  F-12, and it changes no licensing policy, permission or contract.

## 7. Acceptance matrix

| PR | Decision scope | Evidence | Findings | Outcome |
| --- | --- | --- | --- | --- |
| #137 | PDR-11 §3 retained versions, §10.7 replay, §12.7 atomic audit; ADR-0046 | merge `345047abe`, run `38171112633` success; code + unit/e2e + rehearsal reviewed; local suite 2020 tests green | None material; later PRs amend it (F-6/F-7 by #140, OQ-86 by #141, §8.6 by #142/#143) | **ACCEPT** |
| #138 | ADR-0046 Decision 2 binding; §12.7 audit | merge `d283744b4`, run `38210710188` success; rule 2a + cross-installation guard + live cases | None; the requested ratification was given on 2026-10-12 | **ACCEPT** |
| #139 | Documentation-only post-merge verification | merge `9ac2cc58d`, run `38217456331` success; content re-read against the tree | Statements are dated snapshots; superseded facts are superseded by later records, not silently rewritten | **ACCEPT** |
| #140 | F-6/F-7 OpenAPI + generated-client drift | merge `cdf21e4d6`, run `38220526809` success incl. `generated-api-client`; script + contract spec reviewed | None | **ACCEPT** |
| #141 | OQ-80 Option B, G2, OQ-86 Option C, Q4, PDR-12, ratification (Q3 superseded) | merge `f4c2e84f7`, run `38244025219` success; guards, routes, audits, DTOs and tests reviewed | Q3 record superseded by the 2026-10-13 decision → recorded (§4.5); the identity relaxation needs no code change. The F-8 controls that remain unsatisfied (L-05, L-06) are not introduced by this PR and are not waived by accepting it | **ACCEPT** |
| #142 | OQ-87 Option B (PDR-13) and L-04 / PDR-11 §8.6 | merge `f0b047ae4`, run `38290247234` success; flows, locks, audit events, migrations verified | **G-8.1 (material, requirement not satisfied):** the §8.6 reduction control does not execute for a successor that retires nothing, so a renewal that lowers capacity or removes an entitlement — including with a changed `licenseId` — is applied with no check/explain/resolution (probe A/B, §4.4). Corrective change **L-05** required with its own tests and CI | **HOLD** |
| #143 | Audit-detail preservation; additive migration; CI isolation | merge `2494e5de3`, run `38354611367` success; pre-fix CI failure `38305329909` verified; post-fix `38351688052` success; rehearse.mjs + live 500-char cases | None | **ACCEPT** (recommended for formal acceptance — a recommendation on #143 only, independent of this audit record's own status and of F-8/F-12) |

No PR is `BLOCKED`: every decision this audit needed exists. G-8.1 is a **defect
against an approved requirement**, not an open policy question: §8.6 must be
implemented on the renewal path (L-05), and the customer-code criterion (L-06)
must be made representable and validated before F-8 can be called satisfied.

### 7.1 Requirement-level status (independent of the per-PR outcomes)

| Requirement | Status | Evidence / follow-up |
| --- | --- | --- |
| F-8 — license identity (the relaxation itself) | **Satisfied** | §4.2/§4.3; no `--license-id`, no reuse requirement |
| F-8 — same customer (id), no bypass of binding/history/precedence/replay/audit | **Satisfied** | probes C/D/E; rules 2a/2b; Q4 transfer |
| F-8 — same **customer code** | **NOT SATISFIED** | §4.6; follow-up **L-06** |
| F-8 — no bypass of capacity/entitlement reduction controls | **NOT SATISFIED** on the renewal path | §4.4; follow-up **L-05**; #142 `HOLD` |
| PR #143 acceptance recommendation | **ACCEPT recommended** (separate) | §6; does not complete F-8 or F-12 |
| F-12 — forced first-login password change | **NOT IMPLEMENTED — outstanding deployment blocker** | §5; acceptance tests in §5.2 |
| This audit record (PR #144) | **NOT ACCEPTED** — submitted for review | its conclusions and follow-ups are what the review must confirm |

## 8. Acceptance records changed by this audit (documentation only)

- `STATE.md` — new §37: audit scope, exact `main` SHA, per-PR outcomes, exact-SHA
  CI evidence, F-8 supersession, F-12 outstanding item.
- `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` — §8.3.1 dated note:
  Q3 superseded; `--license-id` follow-up withdrawn.
- `docs/tasks/licensing-post-merge-reconciliation.md` — §17 dated addendum:
  Q3 row and F-8 follow-up superseded; F-12 row re-stated as a decided but
  unimplemented requirement with its acceptance tests.
- `docs/decisions/product/PDR-11-vardena-licensing-product-requirements.md` —
  dated paragraph appended to the existing addendum: Q3 superseded; the two F-8
  gaps (L-05, L-06) recorded as unsatisfied requirements; F-12 recorded as
  outstanding implementation. §1–§18 untouched.
- This report (`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md`) — initial
  record plus **revision 2**, which corrects the G-8.1 recommendation, adds the
  customer-code trace (§4.6), the F-8 requirement-level status (§4.7) and the
  corrective tasks L-05/L-06.

**Revision 2 additionally updates** the same four records so that every duplicated
summary statement matches the corrected conclusions: `STATE.md` §37, the decision
brief §8.3.1, the reconciliation §17 and the PDR-11 addendum now all state that F-8
is **not** fully satisfied, that L-05 and L-06 are required corrective work, that
PR #142 stays `HOLD`, and that F-12 remains an outstanding deployment blocker. The
historical decisions of 2026-10-12 and 2026-10-13 remain as dated history; nothing
was rewritten as though it had never existed.

Nothing else was modified. No product code, test, migration, permission, API
contract, generated client or existing historical record was rewritten, and no
test, rehearsal or live-PostgreSQL run is claimed that was not actually executed.

## 9. Remaining blockers and the next authorized tasks

- **L-05 — §8.6 reduction control on the renewal path (required corrective
  change; blocks PR #142's acceptance and the F-8 reduction-control criterion).**
  Specification and mandated regression coverage in §4.4.1. It is a separate
  product-code PR with its own tests and exact-SHA CI; PR #142 stays `HOLD` until
  it is merged and verified. **PR #144 does not implement it.**
- **L-06 — customer-code binding (required corrective change; blocks F-8 criterion
  2).** The code's source/shape is an Owner decision item; the implementation
  follow-up and its acceptance tests are in §4.6. **PR #144 does not implement it**
  and invents no format.
- **F-12 remains outstanding and is a deployment blocker.** The eight acceptance
  tests are in §5.2; it is not completed by any PR in this audit.
- **PR #143's formal acceptance recommendation stands on its own** (§6) and does
  not depend on, or imply, acceptance of this audit record or completion of F-8.
- **PR #144 itself is not accepted.** It is documentation only; its corrected
  conclusions and follow-ups are what the Product Owner should now confirm.
- **Unrelated open questions stay open and unchanged:** OQ-77, OQ-78, OQ-79,
  OQ-81, OQ-82, OQ-83, OQ-84, OQ-45, OQ-53, and the rest of the register.
- **Next authorized task:** Product Owner review of this revision, then the three
  corrective implementation PRs in the order L-05 → F-12 → L-06 (L-05 unblocks
  #142; F-12 unblocks deployment; L-06 completes F-8), each with its own tests and
  CI. Documentation-only PR #144 must not be merged as acceptance of F-8 or F-12,
  and no corrective work may be smuggled into it.

**Final status: READY FOR REVIEW.**
