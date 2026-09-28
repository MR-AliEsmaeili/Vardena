# Task 19 — Accounting Chart / Configuration Foundation

**Status:** **ACCEPTED**

**Acceptance type:** **Production implementation + post-merge security correction**

**Acceptance authority:** Repository Owner / Reviewer (`MR-AliEsmaeili`)

**Governance basis:** Accepted under **Owner-authorized Acceptance Sync after final repository review**. This record does not self-authorize acceptance, promote an ADR, close an Open Question, or expand Task 19.

**Record type:** documentation/governance synchronization only. This record records the accepted state; it introduces no production, schema, migration, API, DTO, permission, dependency, frontend, test, or architecture implementation change.

---

## 1. Source-of-truth and corrective history

The final acceptance record is based on the merged `main` branch and repository evidence, not on an unmerged branch or a PR description alone:

| Evidence       | Verified state                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- |
| PR #54         | **MERGED** into `main` in merge commit `f15325184023ff0c7e9d34727834da19f4350eda`         |
| PR #55         | **MERGED** into `main` in merge commit `6a69bc6c17bf0dfb69a15adc3e3203ae6098d871`         |
| Current `main` | Contains the PR #55 merge commit as its current head at this synchronization baseline     |
| PR #55 CI      | GitHub Actions CI run **`36238862315`** — **SUCCESS**; backend job completed successfully |

PR #54 initially implemented the three Task 19 slices, but it left membership administration outside the principal-membership boundary. Consequently, a principal holding the membership-administration permission could administer membership in an organization where that principal was not a member. That was a real ODR-3 authorization defect: permission alone could cross an organization boundary on the administration surface.

PR #55 corrected that defect before final acceptance. The corrected behavior is the accepted Task 19 behavior. PR #55 did **not** change ODR-1 or ODR-2: configuration coherence and the Accounting-owned Chart Tree remain the same accepted implementation slices.

PR #54 alone is therefore not sufficient evidence for final acceptance; the final evidence includes the PR #55 correction and its green CI run.

---

## 2. Accepted implementation

Exactly these three implementation slices are accepted:

1. **ODR-1 — Explicit Configuration Coherence**
2. **ODR-2 — Accounting-owned Chart Tree**
3. **ODR-3 — Principal-bound Organization Authorization**

### 2.1 ODR-1 — Explicit Configuration Coherence

ODR-1 is implemented and accepted with the following bounded behavior:

- Coherence is checked between `coding_structure_version_id` and
  `accounting_configuration_id`.
- Divergent code-shape pins are rejected; there is no silent winner and no fallback
  pin selection.
- The coherence rule compares the defined code shape, including level count and
  per-level digit length.
- Coherence is checked at the relevant account write boundaries, including root
  creation, child creation, and account moves.
- The repository/transaction boundary re-check is present inside the locked
  transaction, using the same structure snapshot used by the service boundary.
- Existing divergent records are **not repaired** by Task 19. Reads remain
  available; repair policy remains outside this task.
- **OQ-62 and OQ-63 remain OPEN.** The accepted implementation does not ratify a
  legacy repair or fallback policy.
- Historical ledger identity remains based on `account_id`.
- Immutable account-code semantics remain unchanged.

### 2.2 ODR-2 — Accounting-owned Chart Tree

ODR-2 is implemented and accepted as a bounded read-only Accounting surface:

- Accounting owns the Account master and the Chart Tree read surface.
- The read-only endpoints are:
  - `GET /api/v1/accounting/chart-tree`
  - `GET /api/v1/accounting/chart-tree/:id`
- The surface is organization-scoped and preserves the approved foreign/non-member
  isolation posture.
- Ordering is deterministic and fixed; pagination is bounded.
- Inactive accounts remain readable.
- Hierarchy is represented through the existing Account relationships.
- `isPostable` remains the authoritative current posting/aggregation semantic.
- No balances or turnover calculations are introduced. Task 18 remains the owner
  of financial read calculations.
- Reporting does not own or duplicate the Account master.
- No `/api/v1/reports` implementation was introduced.
- No legal or statutory report implementation was introduced.

### 2.3 ODR-3 — Principal-bound Organization Authorization

ODR-3 is implemented and accepted with this invariant:

```text
Principal
  → Authorized Organization Membership / Context
  → Requested Organization
  → Module Permission
  → Resource Access
```

The accepted authorization behavior is:

- Organization-scoped access is membership-bound.
- An arbitrary caller-supplied `organizationId` cannot bypass membership.
- Permission alone cannot cross organization boundaries.
- `OrganizationsService.assertOrganizationInScope` is the principal-bound
  chokepoint.
- Foreign/non-member access preserves the approved 404 isolation posture.
- Membership administration is organization-bound after PR #55 as well as the
  ordinary organization-scoped data paths.
- `Organization.Membership.View`, `Organization.Membership.Grant`, and
  `Organization.Membership.Revoke` remain granular permissions.
- Bootstrap is narrowly limited to the **first grant** when the target
  organization has zero members.
- List and revoke never receive the bootstrap exception.
- After the first member exists, membership administration requires acting-principal
  membership plus the corresponding permission.
- If the last member revokes themselves and the set becomes empty, bootstrap becomes
  available again. This behavior is intentionally retained as an explicit bounded
  exception, not a general permission-only organization bypass.
- There is no wildcard organization access and no super-admin bypass.
- There are no per-organization roles, membership deactivation, or effective dating
  semantics in this task.
- **OQ-01 and OQ-22 remain OPEN.** The presence-based membership binding is the
  accepted bounded implementation, not closure of the broader tenancy/product
  questions.

The bootstrap exception is not a general permission-only organization bypass: it
exists only for the first grant into an empty membership set, and list/revoke remain
membership-bound even when that set is empty.

---

## 3. PR #55 correction acknowledged explicitly

The final accepted history is intentionally not presented as a clean PR #54-only
implementation:

1. **PR #54** implemented ODR-1, ODR-2 and the initial ODR-3 paths.
2. Review after PR #54 identified that membership administration was still outside
   the principal membership boundary.
3. That defect allowed permission-only cross-organization membership administration.
4. **PR #55** corrected the boundary for `listMembers`, `grantMembership`, and
   `revokeMembership`.
5. The corrected PR #55 behavior, including the narrowly bounded first-grant
   bootstrap exception, is the accepted ODR-3 behavior.
6. PR #55 did not change ODR-1 or ODR-2.

The accepted correction preserves the 404 isolation posture for foreign/non-member
access, while missing permission remains a 403 and duplicate grants remain a 409.
There is no new migration, no new membership model, no per-organization role, no
wildcard, and no super-admin bypass in the correction.

---

## 4. Verification evidence

### 4.1 Final PR #55 CI evidence

| Field                | Recorded result                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI run               | **`36238862315`**                                                                                                                                             |
| Result               | **SUCCESS**                                                                                                                                                   |
| Job                  | `backend` completed successfully                                                                                                                              |
| Required gates       | Prisma validate; Prisma generate; lint; typecheck; format check; unit tests; build; migrate deploy; migration rehearsal; E2E including live PostgreSQL suites |
| Required-gate status | No required CI gate was skipped or continued-on-error                                                                                                         |

The configured backend CI job completed all of the repository's authoritative gates,
including Prisma validation and generation, lint, typecheck, format check, unit tests,
build, migration deployment, migration rehearsal, E2E, and live PostgreSQL suites. The
failure-artifact upload step was conditionally skipped because the job succeeded; it is
not a required verification gate and does not change the successful result.

### 4.2 Local fast-test evidence recorded from PR #55

The following fast checks were run locally for the PR #55 state:

- `format:check` — **PASS**
- `lint` — **PASS**, 0 errors; the six reported warnings were pre-existing and
  unrelated
- `typecheck` — **PASS**
- unit tests — **PASS**, **101 files / 1148 tests**
- `build` — **PASS**

Local `prisma:validate` and `prisma:generate` were **blocked** by the sandbox's
Prisma engine download restriction. They were delegated to CI and passed there. This
record does **not** claim that local Prisma validation or generation passed.

Heavy E2E, live PostgreSQL, migration rehearsal, and concurrency tests were delegated
to GitHub CI under `docs/testing/test-execution-policy.md`. No local heavy E2E/live-DB
execution is claimed, and no local heavy test was required for final acceptance.

---

## 5. Explicit non-scope

Task 19 does not implement or resolve:

- Reporting module
- Report Builder
- Journal Book
- statutory/legal books
- Legal Profile
- XLSX/CSV/PDF/Print
- Account Overview UI
- Treasury
- AR/AP
- Sales/Purchase
- Settlement
- code-length migration
- level-count migration
- ADR-0035 migration service
- control roles
- base/template chart
- account code history implementation
- non-leaf POSTING
- dimensions
- floating details implementation
- **OQ-25**
- **OQ-43**
- **OQ-62/OQ-63**
- full membership roles/deactivation/effective dating
- **OQ-01/OQ-22**

Task 19 does not retrospectively expand into any of these capabilities. In particular,
it does not repair existing divergent account records, implement code history, create a
migration service, introduce a base chart or control-role model, add dimensions or
floating details, implement non-leaf POSTING, or create a reporting/legal surface.

---

## 6. Open Questions and ADR status

The following questions remain **OPEN** and are not closed or rewritten by this
acceptance:

- **OQ-25**
- **OQ-43**
- **OQ-62**
- **OQ-63**
- **OQ-01**
- **OQ-22**

**OQ-19** is also kept **OPEN** where it is referenced as the out-of-band
first-administrator/bootstrap provisioning question. The bounded first-grant exception
in ODR-3 does not resolve OQ-19.

ADR-0033, ADR-0034, ADR-0035, ADR-0036, and ADR-0037 each remain **Proposed**.
Task acceptance is separate from ADR acceptance; no ADR is promoted by this record and
no new architectural decision is introduced.

Task 17 remains **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS** and is not
complete. Task 17A remains **ACCEPTED**. Task 17B remains **ACCEPTED** for its bounded
slice. Task 17C remains **ACCEPTED (2026-09-25)**, exactly as the repository currently
records it. Task 18 remains **ACCEPTED**.

---

## 7. Acceptance statement and submission status

**Task 19 — Accounting Chart / Configuration Foundation: ACCEPTED.** The three
implementation slices listed in §2 are accepted under Owner-authorized Acceptance Sync
after final repository review, with the PR #55 ODR-3 correction and CI run
`36238862315` included in the evidence.

This acceptance record makes no production change, changes no implementation behavior,
closes no Open Question, promotes no ADR, and introduces no new architectural decision.

The Acceptance Sync deliverable itself is submitted **READY FOR REVIEW**. The Agent
does not self-accept this synchronization; the Owner/Reviewer performs the final review
of the Acceptance Sync PR.

---

## 8. Related records

- Implementation report: [`task-19-implementation-report.md`](./task-19-implementation-report.md)
- Implementation gate: [`task-19-implementation-gate.md`](./task-19-implementation-gate.md)
- Accounting task index: [`../../accounting/task-index.md`](../../accounting/task-index.md)
- Project state: [`../../../STATE.md`](../../../STATE.md)
- Test execution policy: [`../../testing/test-execution-policy.md`](../../testing/test-execution-policy.md)
- PR #54: `f15325184023ff0c7e9d34727834da19f4350eda`
- PR #55: `6a69bc6c17bf0dfb69a15adc3e3203ae6098d871`
- PR #55 CI run: `36238862315`

---

**Task 19 — Accounting Chart / Configuration Foundation — ACCEPTED under Owner-authorized Acceptance Sync after final repository review.**
