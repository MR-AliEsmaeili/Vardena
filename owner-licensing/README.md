# Vardena Owner licensing — Phase 1

Independent Owner web application; **not customer Vardena**. Product authority:
[PDR-17](../docs/decisions/product/PDR-17-owner-web-application-phase-1.md).
Persian RTL login, mandatory password change, customer list/search/detail/create/
edit, user administration/role assignment, durable attributable audit viewing with
a filterable audit explorer (Phase 1.1), and operator-observed records.
The lifecycle navigation keeps cryptographic issuance, signed receipts, device
replacement, revocation and recovery unavailable. Under the approved two-role
MVP model (`Owner Admin` / `OWNER_ADMIN` and `License Operator` /
`LICENSE_OPERATOR`, superseding the historical four-role model), both roles can
record operator-observed activation facts and follow-up replacement observations,
while only `Owner Admin` (`replacements.authorize`) can authorize a server
replacement or emergency old-server loss. There is **no signer, signing key,
signed receipt, or claim of cryptographic confirmation**.

## Boundaries and dependencies

- `backend/`: Node 22.12+, TypeScript, Express, PostgreSQL `pg`, Argon2id, ULID.
  A small modular API (`app`, `security`, `domain`, `db`, migration/bootstrap CLI),
  not a copy of the customer Nest module graph/authentication stack.
- `frontend/`: independent React/Vite package + lockfile; adapted existing
  presentation primitives, session/query conventions and Persian auth copy.
  No imports from customer `backend/` or `frontend/`. No shared runtime package.
- Build/install each directory independently with its own `npm ci`. No root
  workspace, customer configuration, customer database, replication or shared
  migration chain. It can move to another repository without code imports changing.
- No Owner work is added to the root customer Compose file or customer manifests.
  CI checks dependency graphs, built backend/frontend output and a **real customer
  production Docker image**, preserving the existing issuer/secret scan and protocol
  vectors. The Owner build is not an artifact of customer releases.

## Development setup (operator instructions, not an Arena test authorization)

Use an empty **dedicated Owner PostgreSQL database** with Owner-only credentials.
Never point this application at a customer database. The migrator refuses known
customer schemas (`licensing`, `identity`, `users`); this is defense in depth,
**not** a substitute for separate database roles, network access and configuration.
No production connection string or usable bootstrap password is supplied.

1. In `backend/`, copy `.env.example` to `.env`; configure `OWNER_DATABASE_URL`,
   `OWNER_PUBLIC_ORIGIN`, `OWNER_BOOTSTRAP_USERNAME`, `OWNER_BOOTSTRAP_PASSWORD`.
   Use a unique initial password (8–128 nonblank characters).
2. Run `npm ci --ignore-scripts --no-audit --no-fund` in both package directories.
3. In `backend/`, run `npm run migrate`, then `npm run bootstrap`.
4. Remove the bootstrap password from runtime configuration once provisioned.
   Re-running bootstrap never resets an existing password, role or disabled state.
   It refuses to create another initial account in a nonempty installation.
5. Run `npm run dev` in `backend/` (port 3001) and `frontend/` (port 5174).
   The browser uses relative `/api/v1`; Vite proxies `/api` to the Owner API.
   No browser code calls localhost. For a remote development preview set
   `OWNER_PUBLIC_ORIGIN` to the exact preview origin and keep the browser base URL
   relative. Vite binds only `127.0.0.1` by default and rejects unapproved hosts.
   For remote development **and** preview, configure server-only variables in
   `frontend/.env.local` (or the Vite process environment):

   ```dotenv
   OWNER_VITE_BIND_HOST=0.0.0.0
   OWNER_VITE_ALLOWED_HOSTS=5174-your-sandbox.e2b.app,owner-dev.example
   ```

   Use exact hostnames/IPs, without schemes, ports, leading dots or wildcards.
   Defaults allow only `localhost`, `127.0.0.1` and `::1`; suffix/prefix matches
   are not accepted. Non-loopback binding requires an explicit additional host.
   These `OWNER_VITE_*` values are server-only, not Vite client-exposed variables.
   The guard applies to dev and preview HTTP requests, even for IP hosts/HTTPS
   where Vite's built-in checks may be permissive. Restart Vite after changes.
   Binding to all interfaces is an explicit network-exposure decision: also
   restrict firewall/ingress access and use only authorized development hosts.
   Do not use Vite dev/preview for production; deploy the independently built
   static assets behind the documented production server/ingress. API proxying
   remains `/api` → the Owner API; never put secrets in any `VITE_*` variable.
6. Sign in and change the initial password. Until then, ordinary API operations
   and the UI workspace are blocked. `Owner Admin` holds user/role administration,
   customer creation/editing, and server-replacement/emergency authorization;
   `License Operator` holds routine license observations and read access to
   customers, operational records, and audit history.

## Production/deployment

Build API: `cd backend && npm ci --ignore-scripts && npm run build`.
Run migration/bootstrap with the source toolchain **before** starting API, or use
compiled `node dist/migrate.js` / `node dist/bootstrap.js` from the Owner image.
Build UI: `cd frontend && npm ci --ignore-scripts && npm run build`.
The API Dockerfile retains its own-directory context. The UI Dockerfile requires
repository-root context: `docker build -f owner-licensing/frontend/Dockerfile .`.
Its Dockerfile-specific ignore file allowlists Owner UI and the exact seven approved canonical
date source files only (no customer runtime, dependencies, config or secrets).
Before dev/typecheck/test/build, `scripts/stage-date-foundation.mjs` regenerates
ignored byte-identical copies of those helpers; missing source or unapproved
imports fail the command, never use stale copies. Owner installs its own locked
dependencies and emits its own artifact; no second maintained calendar engine.
`dayjs.ts` registers the existing UTC/timezone plugins: that bounded side effect
and `instant-range.ts` are explicitly PO-approved in the final corrective review,
not covered by a generic claim of pure helpers. No custom type declaration is
staged; Owner uses types from its independently installed locked packages.
Source projection and image checks run in CI. Changing the helper/dependency
boundary requires deliberate review; see `docs/datetime.md` §0 and ADR-0048.
New audit date filters use Jalali input and Tehran day bounds; saved date links
without `dayZone=Asia/Tehran` keep their original UTC-day semantics and display a
legacy explanation. Clearing filters starts the ordinary Tehran flow.
Do not publish Owner images through the customer release channel. An Owner UI
nginx sample proxies `/api/` to an internal service named `owner-api` on port 3001;
this is deployment composition, not a customer endpoint. No new microservice.
Terminate HTTPS at the Owner ingress. Set `NODE_ENV=production`,
`OWNER_PUBLIC_ORIGIN=https://<owner-host>`, `OWNER_DATABASE_URL` from a secret store.
Never place these credentials in the UI's `VITE_*` variables or customer `.env`.

Use separate migration and application credentials. The migration role owns schema
`owner` and `public.owner_migrations`. Grant runtime only schema USAGE, SELECT /
INSERT / UPDATE on `owner.users`, `owner.sessions`, `owner.login_limits`,
`owner.customers` and `owner.operational_records`; SELECT / INSERT on
`owner.audit_events` and `owner.operational_transitions`; USAGE / SELECT on
their identity sequences. Do **not** grant runtime DDL, audit or transition
UPDATE / DELETE / TRUNCATE, operational-record DELETE, or writes to the
migration ledger. No SQL role name is invented here.
Verify role grants, ingress policy, backups, restore drills and capacity in your
Owner deployment before production use. `/api/v1/health` probes database access.
No key custody or U-1 compromise response is implemented. No production signer is
permitted in this phase.

## Persistence and migration discipline

Independent numbered SQL chain `backend/migrations/`; no Prisma/generator and no
files in `backend/prisma/migrations` of customer Vardena. `npm run migrate` uses
an advisory lock, transaction and SHA-256 ledger. Missing/modified applied SQL
fails; deployment applies new immutable files only. Tables, constraints, checks,
triggers and ledger commit together on a fresh database. Re-running validates
checksums. Back up the Owner database including audit/ledger independently.
No destructive rollback or audit purge command is supplied.

`owner.users`, opaque hashed `sessions`, shared login throttling, customers with
case-sensitive unique business code (PDR-14 grammar), and append-only audit.
Customer ID and code cannot be updated, including direct SQL updates (trigger).
Display-name/status/reference changes retain before/after fields and actor in the
same transaction; a failed audit write rolls back the mutation. No arbitrary
metadata JSON, customer secrets, contact/CRM/billing data or raw signed artifacts.
`002-manual-operations.sql` extends the empty reserved tables. It refuses to run
if rows already exist. License observations are unique per customer and
installation. Replacement observations are unique per customer and old
installation, and per customer and new installation. Identity, installation
references, emergency flag and recorded observations are immutable. Status may
move only issued → activated, or authorized → old-server observation →
replacement recorded. A direct insert cannot skip that start, an unfinished
replacement cannot reuse either installation on the other side, and
`updated_by` cannot change without a status change. A completed replacement
may later be the old installation of another observation. Transitions are
append-only. Direct SQL must keep a continuous history that starts at
`UNRECORDED` and matches the legal path to the current state, including both
emergency steps in one transaction. A forged prior, skipped step, reordered
row, or extra transition is rejected. No cancellation state exists.
`003-two-role-authorization.sql` enforces the two-role MVP policy on
`owner.users.role` (`CHECK (role IN ('OWNER_ADMIN', 'LICENSE_OPERATOR'))`) after
refusing to run if any superseded four-role user row exists.

## Security

- Argon2id (19 MiB, 2 passes, 1 lane); no passwords/hashes in API output/logs/audit.
- Opaque random 256-bit cookie, SHA-256 only in PostgreSQL, HttpOnly / SameSite=Lax /
  Secure with `__Host-` prefix in production; 30 minute sliding idle / 12 hour
  absolute lifetime. Database clocks assign Instants (UTC on the wire).
- Every protected request locks/rechecks the current user then its session, checks
  disabled state, first-login flag and server permission in the same transaction
  as work. No stale role/session decision from frontend or client actor fields.
- Login revalidates the verified credential under the user lock. Password change
  holds that lock, verifies current password, writes hash/first-login flag and
  revokes all other sessions atomically, including durable audit. It cannot
  upgrade another holder of an initial credential (ADR-0047 concept).
- A 401 from `auth/change-password` is ambiguous by contract: the route answers it
  both for an ended session and for a rejected current password. The UI never
  reports it as an expired session without first reading `auth/me`; a confirmed end
  still clears the session and every cached value. Mistyping the current password
  during the mandatory first-login change therefore keeps the operator on the form
  with a credential error instead of a false session-expiry notice.
- Admin role/lifecycle/reset operations serialize, retain the last active admin,
  and revoke target sessions atomically. Logout invalidates the token server-side.
- Mutations require JSON and `x-owner-request: 1`; browser Origin, if supplied,
  must equal configured public origin. No CORS. This blocks cross-origin forms
  and cross-origin scripted cookie requests, including login CSRF.
- PostgreSQL login throttling: 10 attempts per peer IP per 15 minutes, including
  successful attempts. API does not trust forwarded headers; behind a proxy this
  intentionally shares the bucket. Plan ingress rate limits/worker capacity for
  your operators; expired bucket housekeeping is infrastructure data, **not an
  audit retention rule**. No raw IP/username retained in failed-login audit.
- Role policy: PDR-17 / OQ-75 two-role MVP model (`Owner Admin` and `License
  Operator`, superseding the historical four-role model). `Owner Admin` holds
  `customers.view`, `customers.write`, `users.manage`, `audit.view`,
  `operations.view`, `operations.record`, and `replacements.authorize`. `License
  Operator` holds `customers.view`, `audit.view`, `operations.view`, and
  `operations.record`. Server-replacement authorization and emergency
  old-server-lost handling require `replacements.authorize` (`Owner Admin` only).
  Unknown operations and superseded four-role identifiers deny; no wildcard
  expansion and no dual control. Audit is durable and append-only to application
  operations, **not tamper-proof against database owners**. No general audit
  deletion API.
- OQ-77 retention policy (decided 2026-10-16): append-only retention for at least
  three years from each event's occurrence, unresolved security incidents
  excluded from automatic deletion, and permanent retention in a separate archive.
  No automatic purge or archival job is executed in Phase 1 runtime.

## API summary

All relative to `/api/v1`. `auth/login`, `auth/logout`, `auth/change-password`
(POST), `auth/me` and `permissions/effective` (GET). Own identity/change/logout
remain available during initial-password restriction; permissions/business data do not.
`customers` GET/POST, `customers/:id` GET/PATCH. Create accepts customerCode,
displayName, ACTIVE/INACTIVE status, optional bounded contractReference. Edit
accepts name/status/reference plus required reason; identity/code/actor/time and
unknown fields reject. Lists: page size 50, `page`, literal `search` up to 100 chars.
`users` GET/POST; `users/:id` PATCH role/isActive/reason;
`users/:id/reset-password` POST password/reason. New/reset accounts must change
password. `audit-events` GET (`audit.view`; granted to `Owner Admin` and
`License Operator`): exact-match
`eventType`, `actorId`, `targetType`, `targetId`, `outcome`, and UTC
`occurredFrom`/`occurredBefore` (half-open); AND semantics; 50-row pages with
`hasNext`; unknown, repeated, malformed or wildcard input is 400. Full contract:
[backend README](backend/README.md#audit-explorer-contract). Calendar and
instant rules: [task record](../docs/tasks/licensing-owner-side-phase-1-1-audit-explorer.md).
`operational-records` GET with `page`, literal `search`, optional `kind`,
`status` and `customerId`. Detail includes append-only history.
POST `operational-records/license-observations` records an externally observed
issuance. POST `operational-records/:id/activation-observations` records
issued → activated. POST `operational-records/server-replacements` records
authorization, or emergency old-server loss when `emergencyOldServerLost` is
true, and requires `replacements.authorize` (`Owner Admin`). POST
`operational-records/:id/old-server-observations` and
`replacement-observations` continue that sequence and require `operations.record`.
Missing `operations.record` or `replacements.authorize` on a mutation route
audits `OPERATION_MUTATION_DENIED` and returns 403. Stable codes include
`InvalidTransition`, `DuplicateOperation`, `PermissionDenied` and
`EntityNotFound`. Responses say `OPERATOR_OBSERVED` and
`cryptographicVerification=NOT_IMPLEMENTED`. Signed protocol routes stay 404.
No DELETE endpoint exists.
Errors have `code`, bounded safe `message`, `correlationId`; no raw DB errors.

## Verification environments

Only fast targeted static/unit checks run in Arena. Heavy API/PostgreSQL,
migration deployment, full UI integration and all customer builds/image/protocol
checks run in GitHub Actions. No heavy E2E/live-DB test was executed locally
unless explicitly authorized (none was authorized for this task).

CI backend steps: Owner lint/format/typecheck/unit/build; fresh dedicated
`owner_test` PostgreSQL database; migration idempotence (`001`–`003`), HTTP
authentication, password-change concurrency/rollback, disabled users, both MVP
roles (`OWNER_ADMIN` and `LICENSE_OPERATOR`) plus rejection of superseded
four-role values, direct API forbidden access, customer uniqueness/identity,
audit rollback/retention/secrecy, logout and login throttle. Frontend steps:
Owner lint/format/typecheck, schema and observable React flow tests, production
build. Existing customer checks and published protocol vectors remain untouched.
See the [Phase 1 task record](../docs/tasks/licensing-owner-side-phase-1.md).

### PR #160 correction verification

Targeted deterministic Vite configuration/middleware tests cover local defaults,
explicit approved remote hosts, rejection of arbitrary hosts/IPs/lookalikes,
invalid broad configuration and both server hook registrations. No Vite server
or production build is needed for these focused tests. CI also exercises API
reads/projections/forbidden mutations for each role, backend effective permissions
and observable UI read-only/support rendering. The later manual-observation
slice is documented in
[its task record](../docs/tasks/licensing-owner-side-manual-operations.md).
Signed lifecycle routes remain absent.
