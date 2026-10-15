# Owner licensing web application — Phase 1 implementation record

Date: 2026-10-15. Status: implementation submitted for exact-head CI and review;
not Product Owner acceptance, operational rollout, or permission to merge.

The statements below that lifecycle write APIs are unavailable describe the
initial Phase 1 slice. The later observation-only slice is recorded in
[manual operations](./licensing-owner-side-manual-operations.md). It does not
rewrite this historical record and does not close its open questions.

## PR #160 Product Owner correction

Starting PR head fetched and verified:
`5835bf9fa2b7ff8877c74c8258661a910ad726eb`, on the same session branch/PR.
The restored workspace matched that exact tree byte-for-byte; the local branch
pointer/index were aligned to it without changing working files or branches.

- Dev/preview no longer use `host: true` or `allowedHosts: true`. Default binding
  is loopback; explicit, validated `OWNER_VITE_BIND_HOST` and exact
  `OWNER_VITE_ALLOWED_HOSTS` enable remote access. Both server hooks enforce the
  same exact-host middleware, including Vite's implicit IP/HTTPS allowances.
  Server-only configuration, working API proxy, no production Vite dependency.
- Issuance Specialist: customer list/detail and audit reads; no customer/user/
  audit mutations. Observer remains read-only. Support: customer list/detail
  restricted server-side to id/code/display name/status; no contract, attribution,
  audit or user data. Administrator unchanged. No wildcard/prefix grants.
- PDR-17's corrected matrix supersedes initial zero-business-permission policy.
  Future lifecycle mutations remain unavailable, not fabricated or inferred.
- Local: changed-file lint/format, two focused role/projection unit tests, six
  deterministic host-policy tests, diff whitespace. The initial host wiring
  test exposed a jsdom `import.meta.url` scheme issue; file inspection now uses
  the frontend package working directory. No suite hung or was expanded.
  No local full suites, API/integration/PostgreSQL/migration/Docker/build checks.
- First corrective CI found an exact-optional-property middleware signature
  mismatch at both Vite hook registrations. The guard now accepts Node
  IncomingMessage/ServerResponse directly; no policy/test/gate is relaxed.
- CI: existing applicable jobs retain all gates and execute the full Owner API,
  UI and host tests plus customer artifact/signing exclusion. Exact corrective
  head/results are recorded in the PR verification comment/final delivery report.

Everything below is the **initial Phase 1 implementation record**; initial role
restrictions are historical and superseded by this correction and current PDR-17.

## Repository-first verification and discrepancies

Fetched `origin/main`: **c63fc2356f6d99ed18059594cda52e3db46d33cd**. Session
branch `arena/3c9787a3-vardena` starts at exactly that SHA; Arena fixes its branch
name, so no second feature branch was created. Initial worktree was clean.
GitHub reported no open PR at inspection. Recently merged: #159 (VDRQ1 device
signature/hash oracle), #158 (PDR-16 vectors), #157 (packaging/secret hygiene),
#156 (Owner design), #155 (OQ-83 migration), #154 (customer device lifecycle),
#152/#149 (first-login password-change corrections/foundation).

Read the current Phase 0 readiness, Owner architecture, OQ-83 operational plan,
ADR-0048, PDR-11/14/15/16, ADR-0046/47, open-question registry, test-execution
policy, CI-minutes policy and frontend standards; inspected customer auth/RBAC,
Prisma chain, audit patterns, package/build/Compose/Docker and CI helpers.
`owner-licensing/` was **absent on this main**.

Historical Phase 0 text still says issuer packaging/secret scanning/vectors are
missing. #157–#159 already fixed them. This change preserves those fixes and
adds Owner-specific artifact checks rather than reimplementing them. Protocol
formats/vectors/customer enforcement and customer migrations are unchanged.

PDR-11 §13/Phase 0 D-6/OQ-75 have no approved operation-level matrix; OQ-77 has
no option-C wording. [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md)
records the explicit new decisions, exact conservative permission subset and
narrow missing-source ambiguities. No specialist/support business permission or
audit purge rule was guessed. These are review limitations, not silent closure.

## Implemented scope

- Separate Owner API/UI manifests and lockfiles; Node/Express/pg modular API,
  React/Vite RTL UI; no customer runtime imports or customer credentials.
- Separate PostgreSQL `owner` schema/database, numbered SQL migration chain,
  transactional checksummed ledger/advisory deployment lock. No Prisma codegen
  dependency. Migrations refuse known customer database schemas.
- Real Argon2id credentials, explicit bootstrap, mandatory initial password
  change, opaque hashed sessions, CSRF/origin protection, durable login throttling,
  current-user/session/permission checks and atomic revocation/audit. First-login
  users cannot execute business endpoints. Last active admin is protected.
- User create/list, role assignment, enable/disable and password reset; server-side
  deny-by-default RBAC for all four categories (restricted unresolved scope).
- Customer create/list/search/paging/detail/edit, exact PDR-14 code grammar,
  case-sensitive unique code and immutable id/code enforced in PostgreSQL.
  Minimal optional contract reference, status and attributable timestamps.
- Transactional audit for bootstrap, authentication, credentials, user/role
  changes and customer mutations. Minimal before/after fields; no secrets/raw
  signed artifacts. Append-only trigger and no delete API; no tamper-proof claim.
- Explicitly unavailable lifecycle navigation. Reserved relational operational
  records/transitions represent same-customer manual server replacement,
  emergency loss, manual activation evidence, actor/time/reason/prior/new status.
  No lifecycle write API, signer, key or production artifact is fabricated.
- Independent Dockerfiles, static-server reverse-proxy sample and deployment
  instructions in [Owner README](../../owner-licensing/README.md).

## Acceptance and testing matrix

| Requirement | Evidence / execution environment |
| --- | --- |
| Valid/invalid login, mandatory change, ordinary-operation block, logout, disabled account | Owner PostgreSQL HTTP suite — CI |
| Password/session hashing, no secret API/audit output | Owner PostgreSQL HTTP suite — CI |
| Concurrent initial-password change and rollback after session-write fault | Owner PostgreSQL HTTP suite — CI |
| Four roles, observer/support forbidden direct API, admin role changes | Unit policy + PostgreSQL HTTP suite — CI |
| Customer create/update, code validation/uniqueness race/immutable identity | Domain/schema units + PostgreSQL HTTP/SQL suite — CI |
| Audit server actor/time, history, safe before/after, mutation rollback on audit failure | Owner PostgreSQL HTTP suite — CI |
| Fresh migrations, repeat deploy, checksum verification, independent schemas | Migration runner exercised against fresh `owner_test` — CI |
| Persian routes, create→detail, first-login redirect, errors/empty states, restricted support | Owner React API-boundary tests — CI |
| Customer artifact isolation/signing exclusion and existing protocol vectors | Existing gates plus actual customer image/output scan — CI |
| Owner lint, format and typecheck | Fast local and CI |
| Owner domain unit file: 4 tests | Local: passed, under one second |
| Owner customer schema/return-path file: 3 tests | Local: passed, bounded under two seconds |
| Isolation helper: 3 tests | Local: passed, under one second |
| Documentation links / diff whitespace | Fast local; CI repeats docs |

Only targeted unit/static checks are used for final local verification. Earlier
scaffolding commands also ran isolated Owner API/UI builds (approximately 4–10
seconds), not customer/monorepo builds or test suites. Initial Prisma validation
attempts failed at the sandbox's blocked engine-download host; the final Owner
implementation uses PostgreSQL SQL/pg, not Prisma, and requires no engine download.
Dependency installs were inspected; no build or test lifecycle script was invoked.

**No heavy E2E/live-DB test was executed locally unless explicitly authorized.**
No authorization was given: none was run. No local PostgreSQL, migration rehearsal,
Docker/Compose image build, full customer test suite or monorepo check was run.
Full Owner API/integration and UI-flow suites and customer artifact/protocol checks
are delegated to GitHub Actions. CI evidence is reported for the exact PR head,
not a previous green revision. No automatic merge is enabled.

## Deferred / not claimed

Missing proposed role matrix (OQ-75); missing exact OQ-77 option C wording;
production signing/U-1; operational licensing slices; device client/custody;
revocation/recovery; signed receipts; CRM/billing/ticketing. OQ-77/78/82/83/84/85
stay OPEN for their outstanding policy/evidence/acceptance work. UI screenshots
and a production/staging deployment drill are not claimed by static checks.
The shared proxy-peer login bucket is deliberately conservative; ingress capacity
and separate DB privilege grants must be verified for an Owner deployment.
