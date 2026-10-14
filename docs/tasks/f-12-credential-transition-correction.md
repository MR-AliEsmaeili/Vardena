# F-12 corrective slice — credential transition atomicity

## Repository-first selection (2026-10-14)

Baseline: `origin/main` **`05933588fad3f1cb76475d48c3f9586ec32494df`**, fetched
before changes. The session branch `arena/9538b522-vardena` starts at that exact
commit; no other branch is used. GitHub returned **zero open PRs**. PR #150 is
merged; #151 is also reported **MERGED**, with the same head
`347d57e3988944b8591100e6e9299bf94dc38ba7` and merge commit as #150, not an
active competing implementation. Neither has a code-review finding in the
GitHub review-comment API; the bot's usage-limit message is not a review.
Baseline push CI [38646737525](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38646737525)
completed successfully for the baseline SHA (all six jobs).

| Candidate / evidence inspected in the current tree | Assessment |
| --- | --- |
| F-12: `bootstrap/system-administrator-bootstrap.service.ts`, config, Users/Identity/RBAC, frontend auth routes and tests; migration `20261019000000` | Core feature merged in #149 (`d017636f5e339b26c0b5511009fb3aa450ddd288`). No hardcoded initial-password constant remains. Fresh provisioning requires explicit validated configuration; existing accounts are preserved; ordinary licensed RBAC and first-login quarantine exist. **Credential concurrency/failure paths remain defective**, below. |
| L-04/#142 + L-05/#146: `license-version.ts`, `license-import.service.ts`, `licenses.repository.ts` | Usage-aware resolution, continuation-baseline checks, installation locking, explicit recovery and transfer exist. PDR-12/OD-LIC-01 term exception and PDR-13/OD-LIC-02 recovery do not authorize implicit reductions/transfers. Not reimplemented. |
| L-06/#150: customer domain, VLIC1/VLIC2 parsers/issuer, persistence, DTO/client, migrations `20261020000000` and `20261021000000` | Separate signed business code/internal id/display name, fail-closed conflicts, name preservation and typed transfer audit exist. Populated upgrades require owner-supplied codes; no inferred backfill. Not reimplemented. |
| Device registration/quota/offline replacement; installation key/replacement | No device schema/API/UI, device limit, key enrollment or replacement protocol exists. OQ-83 remains **OPEN** in the registry and PDR-11; PDR-14's introductory claim that it is decided is a cross-reference error, not a decision. Server replacement/key recovery remains gated by OQ-78/OQ-82 and backup-key design. |
| Activation, issuance, audit | `/license/activate` delegates to verified import; signed files and retained versions/audit exist (ADR-0046). Dedicated recovery/resolution/transfer are APIs, not completed GUI workflows. Signed receipts OQ-84, owner-side location/RBAC OQ-85/OQ-75, and audit exposure/retention OQ-77 remain undecided. No guessed policy or new L-07 scope. |

The older `STATE.md` bootstrap row and licensing audit/reconciliation statements
that F-12/L-06 are unimplemented are historical, not current-tree evidence.
F-12's current configuration policy is documented in `docs/security.md`,
`README.md`, and the merged #149 source. This correction preserves it; it does
not reinstate the superseded hardcoded credential or change password policy.

## Selected defect and acceptance checklist (before implementation)

**Selected: complete the already-required F-12 concurrency and failure-path
contract**, not a new milestone. Authority: F-12 acceptance cases 4–6 in the
[PO audit](licensing-po-acceptance-audit-2026-10-13.md#52-f-12-is-an-outstanding-implementation-item-deployment-blocker),
ADR-0007 revocation, and `docs/security.md`'s existing self-change contract.

Root causes on the baseline:

- `UsersService.changeOwnPassword` verifies an unlocked snapshot, then calls
  `UsersRepository.update` with only an id predicate. Two requests can verify
  the same old password and both succeed; a concurrent disable/reset can also
  invalidate the original verification before the write.
- `AuthenticationService.changePassword` commits the password/flag before
  `SessionsRepository.revokeAllForUser`. Failure there leaves the password
  changed and other old sessions usable with the now-cleared restriction.
- Login can finish creating a session from a stale credential snapshot after
  revocation. Request authentication can read an old session before the change
  and the newly unrestricted user after it.

Acceptance targets:

- [ ] Deterministic fast regressions reproduce stale-credential overwrite and
  mixed session/user reads on the baseline.
- [ ] Users-owned credential row serialization and post-lock revalidation;
  password/flag and Identity-owned session effects share one bounded database
  transaction through an explicit opaque transaction capability (no foreign
  table access, no ambient transaction rewrite).
- [ ] The initiating session is still live and belongs to the principal;
  other sessions are revoked atomically. Rejection/failure rolls everything
  back; success preserves the current session and the existing API shape.
- [ ] Login cannot create a usable session from the old credential after a
  concurrent change; session validation cannot promote a revoked restricted
  session through a mixed read.
- [ ] Negative, authorization, rollback, concurrent change/reset/disable,
  login-race and current-session preservation coverage; real database proof
  only in GitHub Actions (`test/auth-password-transition-live.e2e-spec.ts`).
- [ ] No password/hash/token in DTOs, events or logs; lifecycle events emitted
  only after commit. RBAC, licensing, bootstrap policy and idempotency unchanged.
- [ ] No schema, migration, endpoint or frontend contract change; CI verifies
  generated-client drift. Current records reconciled without changing policy.
- [ ] Focused PR against `main`, independent diff review, exact-final-head CI
  and manual merge protocol evidence. PR remains unmerged.

## Implementation and fast evidence

- One Users-owned row lock plus an explicit, callback-scoped transaction
  capability; Identity's session operations use that same transaction. The
  capability is unusable after callback completion or on another PrismaService.
  Design and lock ordering: [ADR-0047](../adr/0047-atomic-self-service-credential-transition.md).
- The original eight regression scenarios were run against baseline production
  code and all **failed** in 0.84 seconds (two concurrent changes succeeded;
  rollback/stale-login/mixed-read/lifecycle-race assertions failed). They now
  pass. Four further initiating-session denial cases cover missing, foreign,
  idle-expired and absolute-expired sessions.
- Fast checks actually executed: `npm ci --ignore-scripts --no-audit --no-fund`
  (dependency installation only), `npm run typecheck`, targeted `oxlint` and
  `prettier`, and `vitest run --config ./vitest.config.ts` restricted to
  `password-transition.spec.ts`, `authentication.service.spec.ts`,
  `users.service.spec.ts`, `prisma.service.spec.ts`, and
  `prisma.service.client-present.spec.ts`: **5 files / 53 tests passed**.
- Four CI-only PostgreSQL HTTP tests use real login/Argon2/session rows: two
  verified changes race, an actual revocation write is rolled back on injected
  failure, stale login is refused, and concurrent logout aborts a change.
  They assert quarantine, current-cookie continuity, other-cookie replay denial,
  unchanged RBAC and post-commit secret-free events. No PostgreSQL claim is made
  from the hermetic fakes.
- Scope is one security transition: login and session-read race closures cannot
  safely be omitted from an atomic password-change correction. Production edits
  are confined to Users, Identity and the opt-in Prisma capability; most added
  lines are regression coverage and the mandatory audit/design record.

**CI audit detail:** #149's merge run
[38545876095](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38545876095)
is successful at `d017636f5e339b26c0b5511009fb3aa450ddd288`. The older #146
merge run [38459735384](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38459735384)
is **not green**: `ci-gate` was not started because of the account
payments/spending-limit condition (GitHub check annotation); backend/docs/client
succeeded, frontend was skipped. Later baseline success is separate evidence,
not a retroactive claim about that run. Historical log download was unavailable
from the sandbox's allowlisted network; the failure annotation was read through
the GitHub API. No billing or repository setting was changed.

## TEST EXECUTION MATRIX

| Class | Verification | Execution boundary |
| --- | --- | --- |
| FAST-LOCAL | Small credential/session regression specs, targeted lint/format, TypeScript typecheck, documentation links | Local; no database/application bootstrap |
| CI-HEAVY / CI-LIVE-DB | Existing backend job, full E2E and new live PostgreSQL transition cases | GitHub Actions only |
| CI-MIGRATION | Existing fresh deployment and three rehearsals (no new migration) | GitHub Actions only |
| CI contract | `generated-api-client` drift check | GitHub Actions only |
| CI scope | `classify`, `docs`, `backend`, `generated-api-client`, `ci-gate`; frontend only if classifier requires it | Read exact final run, not inferred from local results |

No heavy E2E/live-DB test was executed locally unless explicitly authorized.
No such authorization was requested; heavy local execution is prohibited.

Final-SHA/run evidence belongs in the PR description and delivery report, so
recording it does not create a new unverified documentation commit.

## Review boundary and limitations

- No data transformation: existing migrations (including the owner-supplied
  L-06 code backfill gate) are untouched. No production/customer database was
  read or migrated. Existing bootstrap accounts are not automatically forced
  through a new password rotation.
- No new API shape/status class: stale credentials or an invalid initiating
  session use the existing documented 401; password-policy failures retain
  their existing 400 contract. Generated-client drift verification remains CI-only.
- The atomic guarantee covers self-service changes. Administrator resets still
  use the existing event-driven revocation consumer; durable general audit,
  lockout policy (OQ-19) and cancellation of already-authorized requests are not
  added or claimed.
- CI is advisory on the private/Free repository (`main.protected=false`,
  re-read during the audit). Required-by-protocol jobs must succeed on the exact
  final PR head. The PR must not be merged by Arena.
