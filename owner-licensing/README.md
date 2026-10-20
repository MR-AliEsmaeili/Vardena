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

Real license issuance (creating, signing and allocating an actual `VLIC2`
artifact to a customer) is **not available and not implemented**. The four
Product Owner decisions that blocked it were answered on 2026-10-19 in
[PDR-19](../docs/decisions/product/PDR-19-owner-side-issuance-decisions.md):
**OD-LIC-07** perpetual grants are `OWNER_ADMIN`-only, time-limited grants may be
issued by an authorized `LICENSE_OPERATOR`, and `OWNER_ADMIN` configures each
operator's permissions per user (this supersedes the static matrix below for
`LICENSE_OPERATOR`); **OD-LIC-08** custody is an **air-gapped offline signer**, so
the Owner web app prepares a signing request, the operator carries it to the
offline environment, the signer validates and signs, and the Owner validates the
returned artifact before recording it and offering download — issuance is
therefore **not synchronous**, and the private key never reaches this
application, its host, its configuration or its database; **OD-LIC-09**
controlled operator registration of `installationId` read from the customer's
Vardena page, with source and confirmation recorded; **OD-LIC-10** a dedicated
durable signed-artifact store outside PostgreSQL. The two product forks were
answered the same day (**F-1** hybrid optional per-customer limit profile,
**F-2** every operator-eligible permission configurable per user with a
fail-closed default), and the technical design that gate asked for was then
delivered and reviewed. **On 2026-10-20 the Product Owner answered the four
questions that review raised** ([PDR-19 §6](../docs/decisions/product/PDR-19-owner-side-issuance-decisions.md)):
**OD-LIC-11** the offline signer must confirm the request's full 64-hex
`request_payload_sha256` over a path independent of the request file **before
reading or loading the private key** (option O-A; no new key, no new signed
format, no canonicalization or vector change); **OD-LIC-12** a newly created
`LICENSE_OPERATOR` has **zero effective access** until `OWNER_ADMIN` grants each
permission explicitly (**R-1**); **OD-LIC-13** a retired limit profile may be
**reactivated** on the same row, never two `ACTIVE` profiles per customer;
**OD-LIC-14** a request already in flight completes against the limit-profile
**snapshot taken at its creation**, while new requests use current state.
The gate is now **design approval plus the pre-existing open items**; see
[the design's dependency table](../docs/tasks/owner-side-issuance-technical-design.md)
§15.1. Evidence and options:
[the issuance assessment](../docs/tasks/licensing-owner-side-issuance-blocked-assessment.md).

**None of OD-LIC-07…OD-LIC-14 is implemented.** In particular OD-LIC-12 will
change what a `License Operator` can do — today the four permissions listed below
are granted by role, and under R-1 they become *eligibility* that an
`OWNER_ADMIN` must grant per user. That change happens with its code, not before;
this README describes what is deployed.
`owner.signing_keys` is administrative metadata only — it holds **no public or
private key material**, and its `id` is an opaque operator label that is not
cryptographically bound to any key in a customer trust list. Do not read it as
signing capability, and do not read PDR-19 as a claim that any of it is built.

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
   `OWNER_PUBLIC_ORIGIN`, `OWNER_AUDIT_ARCHIVE_DIR` (an absolute path on a
   storage volume independent of the PostgreSQL data directory),
   `OWNER_BOOTSTRAP_USERNAME`, `OWNER_BOOTSTRAP_PASSWORD`.
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
   customers, operational records, and audit history. **This describes the
   deployed role baseline.** OD-LIC-12 (**R-1**, decided 2026-10-20 and not yet
   implemented) will make those `License Operator` permissions *eligible but not
   effective* until granted per user, so a newly created operator will start with
   no access at all; `Owner Admin` is unaffected. Update this step in the same
   change that implements it.

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
`OWNER_PUBLIC_ORIGIN=https://<owner-host>`, `OWNER_DATABASE_URL` from a secret store,
and `OWNER_AUDIT_ARCHIVE_DIR=/var/lib/vardena-owner/audit-archive` mounted on a
dedicated durable volume outside the PostgreSQL data directory and backup
lifecycle. A different filesystem path alone does **not** guarantee physical
storage independence, hardware WORM immutability, or protection against a
compromised OS `root`; because this repository does not ship an Owner production
infrastructure manifest or external volume backup/restore runbook, provisioning
and verifying the dedicated volume mount and its independent backup/restore
procedure remains a deployment-owner operational requirement. Never place these
credentials in the UI's `VITE_*` variables or customer `.env`.

Use separate migration and application credentials. The migration role owns schemas
`owner` and `owner_audit_archive` plus `public.owner_migrations`. Grant runtime only
schema USAGE on `owner` and `owner_audit_archive`, SELECT / INSERT / UPDATE on
`owner.users`, `owner.sessions`, `owner.login_limits`, `owner.customers` and
`owner.operational_records`; SELECT / INSERT on `owner.audit_events`,
`owner.operational_transitions`, `owner_audit_archive.archive_batches`, and
`owner_audit_archive.archived_audit_events`; USAGE / SELECT on their identity
sequences. Do **not** grant runtime DDL, audit or archive or transition UPDATE /
DELETE / TRUNCATE, operational-record DELETE, or writes to the migration ledger.
No SQL role name is invented here.
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

> **Superseded in part by OD-LIC-10 (2026-10-19), not yet implemented:**
> [PDR-19 §4](../docs/decisions/product/PDR-19-owner-side-issuance-decisions.md)
> approves a **dedicated durable signed-artifact store outside PostgreSQL** for
> issued license files, so the "no raw signed artifacts" clause above no longer
> holds for signed license artifacts once that store exists. The rest of the
> clause is unchanged: no arbitrary metadata JSON, no customer secrets, no
> contact/CRM/billing data. Today no such store and no signed artifact exist in
> this application, so the clause still describes the implemented state. A
> readable archive of signed licenses is a disclosure surface even though it
> cannot be forged; access must be permission-gated and every retrieval
> attributable and audited, and retention/backup/restore of that store is not yet
> decided.
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
refusing to run (`ERRCODE = '23514'`, listing the distinct legacy roles found)
if any superseded four-role user row exists.
`004-audit-retention-archive.sql` implements OQ-77 audit retention and separate
archive controls:
- Adds `minimum_retained_until` (`GENERATED ALWAYS AS (((occurred_at AT TIME ZONE 'UTC') + INTERVAL '3 years') AT TIME ZONE 'UTC') STORED NOT NULL`), `security_incident`, and `incident_status` (`'NONE'` or `'UNRESOLVED'`) on `owner.audit_events`, enforced by `BEFORE INSERT` trigger `enforce_audit_retention_metadata` and `audit_events_incident_metadata_check`.
- Creates the separate archive ledger schema `owner_audit_archive` (`owner_audit_archive.archive_batches` with `durable_file_name` and `durable_bundle_sha256`, and `owner_audit_archive.archived_audit_events`) with `BEFORE UPDATE OR DELETE` append-only triggers (`retain_archive_batches`, `retain_archived_events`), contiguous `batch_number` and batch hash-chain validation (`validate_archive_batch_insert`), and source-matching verification (`verify_archived_event_matches_source`), paired with the independent durable filesystem archive store (`FilesystemAuditArchiveStore` at `OWNER_AUDIT_ARCHIVE_DIR`).

### Legacy-role compatibility matrix and upgrade runbook (`002` → `003`)

| Legacy role (`001`–`002`) | Actual historical permissions (`1a982323db7f:src/domain.ts`) | Historical effective server-replacement authority (`1a982323db7f:src/app.ts` & `test/api.test.ts`) | Allowed dispositions (`migrate:remediate-roles`) | Privilege impact | Can automate without explicit disposition? | Deployment-owner decision required |
| --- | --- | --- | --- | --- | --- | --- |
| `SYSTEM_ADMIN` | `customers.view`, `customers.write`, `users.manage`, `audit.view`, `operations.view`, `operations.record` | Authorized for `POST /api/v1/operational-records/server-replacements` (both normal and `emergencyOldServerLost=true`) via `recorded()` checking `operations.record` (`src/app.ts` lines 576–647; verified for `SYSTEM_ADMIN` in `test/api.test.ts` lines 742–756, 814–830). Phase 1.3 splits that existing capability out of `operations.record` into `replacements.authorize` so `OWNER_ADMIN` retains the exact same route/action set as `SYSTEM_ADMIN` with zero new capabilities. | `MAP_EQUIVALENT` → `OWNER_ADMIN` (preserves `is_active`); `RETAIN_REDUCED` → `LICENSE_OPERATOR`; `DEACTIVATE` → `isActive: false` | `MAP_EQUIVALENT`: **Preserves** · `RETAIN_REDUCED` / `DEACTIVATE`: **Reduces** | No (explicit entry required; at least one active `OWNER_ADMIN` must remain) | Confirm whether each `SYSTEM_ADMIN` maps to active `OWNER_ADMIN`, is reduced to `LICENSE_OPERATOR`, or is deactivated. |
| `LICENSE_ISSUANCE` | `customers.view`, `audit.view`, `operations.view`, `operations.record` | Historically permitted `POST /api/v1/operational-records/server-replacements` via `operations.record` (`src/app.ts` lines 576–647); removed in Phase 1.3 when `replacements.authorize` was restricted to `OWNER_ADMIN`. | `RETAIN_REDUCED` → `LICENSE_OPERATOR` (preserves `is_active`); `DEACTIVATE` → `isActive: false`, `LICENSE_OPERATOR`; `ELEVATE_PRIVILEGE` → `OWNER_ADMIN` (`allowPrivilegeElevation: true`) | `RETAIN_REDUCED` / `DEACTIVATE`: **Reduces** (removes server-replacement authorization `replacements.authorize`) · `ELEVATE_PRIVILEGE`: **Increases** | No | Confirm whether each `LICENSE_ISSUANCE` account is retained as `LICENSE_OPERATOR` (without `replacements.authorize`) or deactivated. Assigning `OWNER_ADMIN` requires explicit `ELEVATE_PRIVILEGE` + `allowPrivilegeElevation: true`. |
| `READ_ONLY_OBSERVER` | `customers.view`, `audit.view`, `operations.view` (read-only; zero write permissions) | Denied (`403 PermissionDenied`) on all mutation endpoints. | `DEACTIVATE` → `isActive: false`, `LICENSE_OPERATOR`; `ELEVATE_PRIVILEGE` → active `LICENSE_OPERATOR` or `OWNER_ADMIN` (`allowPrivilegeElevation: true`) | `DEACTIVATE`: **Reduces** (zero active permissions; preserves user ID and audit history) · `ELEVATE_PRIVILEGE`: **Increases** (`+operations.record` write access) | No (neither MVP role is read-only) | Deactivate (`DEACTIVATE`, `isActive: false`) to preserve least privilege, or explicitly authorize write elevation (`ELEVATE_PRIVILEGE`, `allowPrivilegeElevation: true`). |
| `SUPPORT_SPECIALIST` | `customers.view` (with `customerResponse()` in `1a982323db7f:src/domain.ts` lines 86–97 omitting `contractReference`, `createdBy`, `updatedBy`; no `audit.view`, `operations.view`, or writes) | Denied (`403 PermissionDenied`) on all operational and mutation endpoints. | `DEACTIVATE` → `isActive: false`, `LICENSE_OPERATOR`; `ELEVATE_PRIVILEGE` → active `LICENSE_OPERATOR` or `OWNER_ADMIN` (`allowPrivilegeElevation: true`) | `DEACTIVATE`: **Reduces** (zero active permissions; preserves user ID and audit history) · `ELEVATE_PRIVILEGE`: **Increases** (`+customers.view` full projection, `+audit.view`, `+operations.view`, `+operations.record`) | No | Deactivate (`DEACTIVATE`, `isActive: false`) to preserve least privilege, or explicitly authorize elevation (`ELEVATE_PRIVILEGE`, `allowPrivilegeElevation: true`). |

- **Fresh installation (automatic schema migration + bootstrap):**
  1. Run `npm --prefix owner-licensing/backend run migrate` (or `node dist/migrate.js` in the production container). On an empty database, `001-foundation.sql`, `002-manual-operations.sql`, `003-two-role-authorization.sql`, and `004-audit-retention-archive.sql` apply in one transaction.
  2. Run `OWNER_BOOTSTRAP_USERNAME=<admin> OWNER_BOOTSTRAP_PASSWORD=<initial-secret> npm --prefix owner-licensing/backend run bootstrap` (or `node dist/bootstrap.js`) to create the initial `OWNER_ADMIN` account with `must_change_password = true`.
- **Upgrading an existing populated database (`001`–`002` → `003`):**
  1. **Backup (required before production upgrade):** create a logical backup of the dedicated Owner PostgreSQL database before running remediation or migration:
     `pg_dump --format=custom --file=owner-pre-003.dump "$OWNER_DATABASE_URL"`
  2. **Preflight inspection (read-only, secret-free):** run:
     `npm --prefix owner-licensing/backend run migrate:preflight > owner-role-preflight.json` (or `node dist/migrate.js --preflight`).
     The JSON report lists `migration003Applied`, `requiresRemediation`, `activeOwnerAdminCount`, `currentRoleAccounts`, `legacyAccounts` (`id`, `username`, `legacyRole`, `isActive`, `mustChangePassword`, `historicalPermissions`, `historicalEffectiveCapabilities`, `permissionDecompositionProof`, `allowedDispositions`), `compatibilityMatrix`, and a pre-populated `dispositionPlanTemplate`. Passwords, password hashes, and session tokens are never included.
  3. **Review and authorize dispositions (human deployment-owner step):** if `requiresRemediation` is `false`, run `npm --prefix owner-licensing/backend run migrate` directly. If `requiresRemediation` is `true`, copy `dispositionPlanTemplate` from the preflight output to `dispositions.json` and review every entry:
     - `authorizedByUserId` is **mandatory** (must be a valid 26-character ULID of an active `OWNER_ADMIN` account, or an active `SYSTEM_ADMIN` account mapped to active `OWNER_ADMIN` via `MAP_EQUIVALENT`, which is transitioned to `OWNER_ADMIN` first before any other user's remediation executes). Every `USER_LEGACY_ROLE_REMEDIATED` audit event is attributed strictly to `authorizedByUserId`, never to the target user being modified.
     - `MAP_EQUIVALENT`, `RETAIN_REDUCED`, and `DEACTIVATE` never increase effective privileges.
     - Any transition that increases effective privileges (such as keeping a `READ_ONLY_OBSERVER` or `SUPPORT_SPECIALIST` active as `LICENSE_OPERATOR`, promoting `LICENSE_ISSUANCE` to `OWNER_ADMIN`, or reactivating a previously inactive account) is rejected with `PrivilegeElevationDenied` unless `disposition` is `"ELEVATE_PRIVILEGE"` and `allowPrivilegeElevation` is explicitly set to `true` with an audited `reason`.
     - Deleting user rows or hand-editing `owner.users` with ad-hoc SQL is prohibited; `owner.users.id` foreign keys on `owner.customers`, `owner.operational_records`, `owner.operational_transitions`, and append-only `owner.audit_events` must remain intact.
  4. **Execute transactional remediation and migration:** run:
     `npm --prefix owner-licensing/backend run migrate:remediate-roles -- /path/to/dispositions.json` (or `node dist/migrate.js --remediate-roles /path/to/dispositions.json`).
     Inside one PostgreSQL transaction under advisory lock `78153214`, the command locks `owner.users`, validates the entire disposition set (rejecting missing `authorizedByUserId`, inactive/non-admin `authorizedByUserId`, missing/duplicate/unknown/current-role/contradictory/unauthorized-elevation entries, and enforcing `LastAdminProtected` so at least one active `OWNER_ADMIN` remains), updates each legacy user's `role` and `is_active` (upgrading `authorizedByUserId` to active `OWNER_ADMIN` first), revokes all active sessions for remediated users, records an append-only `USER_LEGACY_ROLE_REMEDIATED` audit event (`actor_id = authorizedByUserId`, `beforeState`, and `afterState`) per account, applies `003-two-role-authorization.sql`, and records `003-two-role-authorization.sql` in `public.owner_migrations`.
  5. **Validation failure, rollback, and retry recovery:** if any validation check or SQL step fails, the single transaction rolls back completely—leaving `public.owner_migrations`, `users_role_check`, `owner.users`, `owner.sessions`, and `owner.audit_events` in their exact pre-attempt state. Correct `dispositions.json` and re-run `npm --prefix owner-licensing/backend run migrate:remediate-roles -- /path/to/dispositions.json`. Re-running after `003` is applied reconstructs the pre-remediation user state from `USER_LEGACY_ROLE_REMEDIATED` audit rows and runs full `validateRoleUpgradePlan` validation plus current-state and audit-record verification—rejecting incomplete plans, unknown fields, or mismatched dispositions while returning `{"status": "ALREADY_APPLIED", "remediatedCount": 0, "migrationApplied": false}` without duplicating audit rows when the plan is valid and matches.
  6. **Post-upgrade verification and rollback boundary:** run `npm --prefix owner-licensing/backend run migrate:preflight` and verify `migration003Applied: true`, `requiresRemediation: false`, `legacyAccounts: []`, and `activeOwnerAdminCount >= 1`. Even if the Phase 1.3 API server is started against an unmigrated `002` database, `POST /api/v1/auth/login` and session authentication (`authenticate`) fail closed (`401 Unauthorized`) for any user row holding a superseded role. Because Owner migrations are forward-only and `owner.audit_events` is append-only, reverting a committed `003` upgrade requires restoring the pre-upgrade logical backup (`pg_restore --clean --if-exists --dbname="$OWNER_DATABASE_URL" owner-pre-003.dump`).

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
  `audit.archive`, `operations.view`, `operations.record`, and
  `replacements.authorize`. `License Operator` holds `customers.view`,
  `audit.view`, `operations.view`, and `operations.record`. Server-replacement
  authorization (`replacements.authorize`) and audit-archive management
  (`audit.archive`) are restricted to `Owner Admin`. Unknown operations and
  superseded four-role identifiers deny; no wildcard expansion and no dual
  control. Audit and `owner_audit_archive` are durable, append-only to
  application operations, and SHA-256 digest-verified on archive read/verify,
  **not hardware WORM or cryptographically tamper-proof against a compromised
  database superuser** unless exported bundles are stored on external immutable
  media per the backup runbook. No audit or archive deletion API exists.
- OQ-77 retention and archive controls (policy decided 2026-10-16; implemented
  in `004-audit-retention-archive.sql` and `src/archive.ts`):
  - Append-only retention with a deterministic three-year minimum active floor
    from each event's occurrence (`minimum_retained_until = occurred_at + 3 years`
    in UTC).
  - Unresolved security incidents (`outcome IN ('DENIED', 'FAILED')` or security
    denial event types) are classified with `security_incident = true` and
    `incident_status = 'UNRESOLVED'` and protected from automatic retention
    cleanup (`UNRESOLVED_SECURITY_INCIDENT_HOLD`).
  - Permanent separate archive in `owner_audit_archive` (`archive_batches` and
    `archived_audit_events`) with allowlist state minimization, per-record
    SHA-256 digests (`record_sha256`), chained batch digests
    (`previous_batch_digest` → `batch_digest_sha256`), and portable bundle
    verification (`GET /api/v1/audit-archive/batches/:id`,
    `POST /api/v1/audit-archive/verify`). Three years is a minimum active window,
    not an automatic purge date; `cleanupEligibleEventCount` is always `0` and
    no destructive purge job is enabled.

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
`eventType`, `actorId`, `targetType` (`Customer`, `OperationalRecord`, `User`,
`AuditArchiveBatch`), `targetId`, `outcome`, and UTC
`occurredFrom`/`occurredBefore` (half-open); AND semantics; 50-row pages with
`hasNext`; unknown, repeated, malformed or wildcard input is 400. Each item
includes `minimumRetainedUntil`, `securityIncident`, `incidentStatus`,
`archived`, and `archiveBatchId`.
`audit-archive/status` GET, `audit-archive/batches` GET/POST,
`audit-archive/batches/:id` GET, `audit-archive/verify` POST, and
`audit-archive/recover` POST require `audit.archive` (`Owner Admin` only;
denied attempts by `License Operator` write `AUDIT_ARCHIVE_ACCESS_DENIED` with
`security_incident = true` and return 403). Archive writes, bundle retrieval,
verification, and recovery require `OWNER_AUDIT_ARCHIVE_DIR` to be configured
and fail closed (`503 ArchiveStorageUnavailable`) otherwise; a downloadable JSON
response or operator instruction to save a file is never treated as proof of
durable archival. Full contract:
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
`owner_test` PostgreSQL database; migration idempotence (`001`–`004`), HTTP
authentication, password-change concurrency/rollback, disabled users, both MVP
roles (`OWNER_ADMIN` and `LICENSE_OPERATOR`) plus rejection of superseded
four-role values, direct API forbidden access, customer uniqueness/identity,
audit rollback/retention/archive/secrecy, logout and login throttle. Frontend steps:
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
