# Product Owner Acceptance Audit — Merged Licensing PRs #137–#143, F-8 and F-12 (2026-10-13)

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
  replay.
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
| Capacity/entitlement reduction controls | **No — see G-8.1 (§4.4)** | Probe A/B; rule 6b gate at `license-version.ts:1198` |

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

### 4.4 Finding G-8.1 — the reduction control does not cover a non-retiring successor

- **Statement.** A renewal that starts exactly at (or after its own predecessor's
  end and) the retained coverage end and lowers the grant is imported with no
  `reduction-requires-resolution`, no explanation payload and no resolution step,
  because rule 6b (`license-version.ts:1198–1214`) only runs when a predecessor
  is retired, and a contiguous successor retires nothing.
- **Consequence for F-8 #3.** Decision #3 forbids a changed `licenseId` from
  bypassing capacity/entitlement reduction controls. Under the new policy a
  renewal may carry a new identifier; the reduction control that decision names
  does not execute for that renewal at all (probe A), nor for the same-identifier
  variant (probe B). The requirement therefore cannot be verified as satisfied
  for the ordinary renewal path as the code stands.
- **Is it undocumented?** No. It is a deliberate, documented scope boundary of
  the L-04 slice: `license-version.ts:1011–1012` ("a document that retires
  nothing … with no predecessor retired there is no grant to take away"),
  `docs/licensing/version-model-and-file-exchange.md:219`, and the decision
  brief §8.7 (`docs/tasks/licensing-oq-80-oq-86-decision-brief.md`; the
  paragraph beginning "Review fix on PR #141"). No test
  pins the accepted behaviour — it was demonstrated by the probe only.
- **Prior records anticipated the question.** `docs/tasks/licensing-pr-138-post-merge-verification-and-l-04-readiness.md:229–235`
  records that Q3 "decides whether capacity is continuous across renewals or
  restarts — and therefore what 'reducing' even means". Removing Q3 makes
  capacity *discontinuous* across identities unless the implementation compares
  the new grant to the previously governing one.
- **Corrective implementation (identified, deliberately not implemented here).**
  Either the Owner narrows §8.6's scope by decision, or the reduction evaluation
  must gain a **baseline for a successor that retires nothing**: the latest
  retained version of this installation whose effective window ends at or before
  the candidate's `validFrom` and whose license belongs to the same customer as
  the installation's binding (identity-independent, keyed on
  installation+customer+adjacency), evaluated with the existing
  `reductionConflicts` and resolvable only through the existing
  `reduction-resolution` operation. Because that choice changes policy scope, it
  is reported — not implemented — pending the Owner ruling.
- **Not a defect of F-8 itself.** The identity relaxation needs no code change;
  the gap exists because §8.6 is implemented on retirement paths only. It is
  recorded here because decision #3 lists that control explicitly.

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
| #141 | OQ-80 Option B, G2, OQ-86 Option C, Q4, PDR-12, ratification (Q3 superseded) | merge `f4c2e84f7`, run `38244025219` success; guards, routes, audits, DTOs and tests reviewed | Q3 record superseded by the 2026-10-13 decision → recorded (§4.5); no code change required | **ACCEPT** |
| #142 | OQ-87 Option B (PDR-13) and L-04 / PDR-11 §8.6 | merge `f0b047ae4`, run `38290247234` success; flows, locks, audit events, migrations verified | **G-8.1 (material):** the §8.6 reduction control does not execute for a successor that retires nothing, so a renewal that lowers capacity or removes an entitlement — including with a changed `licenseId` — is applied with no check/explain/resolution (probe A/B, §4.4) | **HOLD** |
| #143 | Audit-detail preservation; additive migration; CI isolation | merge `2494e5de3`, run `38354611367` success; pre-fix CI failure `38305329909` verified; post-fix `38351688052` success; rehearse.mjs + live 500-char cases | None | **ACCEPT** (recommended for formal acceptance) |

No PR is `BLOCKED`: every decision this audit needed exists. The one open policy
question (G-8.1's scope) is a *ruling on an existing requirement*, recorded for
the Owner rather than left implicit.

## 8. Acceptance records changed by this audit (documentation only)

- `STATE.md` — new §37: audit scope, exact `main` SHA, per-PR outcomes, exact-SHA
  CI evidence, F-8 supersession, F-12 outstanding item.
- `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` — §8.3.1 dated note:
  Q3 superseded; `--license-id` follow-up withdrawn.
- `docs/tasks/licensing-post-merge-reconciliation.md` — §17 dated addendum:
  Q3 row and F-8 follow-up superseded; F-12 row re-stated as a decided but
  unimplemented requirement with its acceptance tests.
- `docs/decisions/product/PDR-11-vardena-licensing-product-requirements.md` —
  dated paragraph appended to the existing addendum: Q3 superseded; F-12
  decision recorded as outstanding implementation. §1–§18 untouched.
- This report (`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md`).

Nothing else was modified. No product code, test, migration, permission, API
contract, generated client or existing historical record was rewritten.

## 9. Remaining blockers and the next authorized task

- **Blocker to close the F-8 acceptance:** Owner ruling on G-8.1 — either §8.6 is
  extended to successors that retire nothing (then a dedicated corrective change
  with its own tests and CI, per §4.4, and PR #142's acceptance re-evaluated),
  or §8.6's scope is narrowed by decision and recorded in PDR-11.
- **F-12 remains outstanding** and blocks any deployment beyond local
  development; the corrective change needs the eight acceptance tests in §5.2.
- **Unrelated open questions stay open and unchanged:** OQ-77, OQ-78, OQ-79,
  OQ-81, OQ-82, OQ-83, OQ-84, OQ-45, OQ-53, and the rest of the register.
- **Next authorized task:** Product Owner review of this report and PR #143's
  formal acceptance, then the G-8.1 ruling, then (in either order) the F-12
  corrective change and — if the ruling requires it — the §8.6 corrective change.

**Final status: READY FOR REVIEW.**
