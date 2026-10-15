# Vardena Owner licensing — Phase 1

Independent Owner web application; **not customer Vardena**. Product authority:
[PDR-17](../docs/decisions/product/PDR-17-owner-web-application-phase-1.md).
Persian RTL login, mandatory password change, customer list/search/detail/create/
edit, user administration/role assignment, and durable attributable audit viewing.
The lifecycle navigation clearly labels issuance/activation/deactivation/device
replacement/server replacement/revocation/recovery as unavailable. There is **no
signer, signing key, signed receipt, or fake successful license operation**.

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
   relative. Vite binds all interfaces and accepts preview hosts.
6. Sign in and change the initial password. Until then, ordinary API operations
   and the UI workspace are blocked. A support/specialist account with unresolved
   business scope sees an explicit restriction notice, not fabricated records.

## Production/deployment

Build API: `cd backend && npm ci --ignore-scripts && npm run build`.
Run migration/bootstrap with the source toolchain **before** starting API, or use
compiled `node dist/migrate.js` / `node dist/bootstrap.js` from the Owner image.
Build UI: `cd frontend && npm ci --ignore-scripts && npm run build`.
Separate Dockerfiles are provided; their build contexts are their own directories.
Do not publish Owner images through the customer release channel. An Owner UI
nginx sample proxies `/api/` to an internal service named `owner-api` on port 3001;
this is deployment composition, not a customer endpoint. No new microservice.
Terminate HTTPS at the Owner ingress. Set `NODE_ENV=production`,
`OWNER_PUBLIC_ORIGIN=https://<owner-host>`, `OWNER_DATABASE_URL` from a secret store.
Never place these credentials in the UI's `VITE_*` variables or customer `.env`.

Use separate migration and application credentials. The migration role owns schema
`owner` and `public.owner_migrations`. Grant runtime only schema USAGE, SELECT /
INSERT / UPDATE on `owner.users`, `owner.sessions`, `owner.login_limits`,
`owner.customers`; SELECT / INSERT on `owner.audit_events`; USAGE / SELECT on
its identity sequence. Do **not** grant runtime DDL, audit UPDATE / DELETE /
TRUNCATE, or writes to reserved operational tables or the migration ledger.
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
Reserved operational tables can represent same-customer manual server replacement,
old-server loss, actor/time/reason/status/evidence reference and operator-observed
confirmation. They have **no application write endpoints yet**.

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
- Permission subset/ambiguities: PDR-17. Unspecified specialist/support operations
  deny. No dual control. Audit is durable/append-only to application operations,
  **not tamper-proof against database owners**. No general audit deletion API.
- OQ-77 option C's wording is absent from current sources: no retention duration,
  purge schedule or inferred deletion behavior. OQ-77 remains OPEN.

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
password. `audit-events` GET, optional `targetId`, 50-row pages.
All unimplemented lifecycle routes return 404, never synthetic evidence.
Errors have `code`, bounded safe `message`, `correlationId`; no raw DB errors.

## Verification environments

Only fast targeted static/unit checks run in Arena. Heavy API/PostgreSQL,
migration deployment, full UI integration and all customer builds/image/protocol
checks run in GitHub Actions. No heavy E2E/live-DB test was executed locally
unless explicitly authorized (none was authorized for this task).

CI backend steps: Owner lint/format/typecheck/unit/build; fresh dedicated
`owner_test` PostgreSQL database; migration idempotence, HTTP authentication,
password-change concurrency/rollback, disabled users, all four roles, direct API
forbidden access, customer uniqueness/identity, audit rollback/retention/secrecy,
logout and login throttle. Frontend steps: Owner lint/format/typecheck, schema
and observable React flow tests, production build. Existing customer checks and
published protocol vectors remain untouched. See the
[Phase 1 task record](../docs/tasks/licensing-owner-side-phase-1.md).
