# Licensing architecture (L-01, L-02)

## Model

`Customer → Installation → License → Entitlement → assignable Permission → Role → Organization Membership → Access`

- **Customer:** minimal commercial identity; not the Organization party/customer master and not CRM.
- **Installation:** deployed Vardena instance. The current deployment is one installation and may contain multiple Organizations. Since L-02 it has a persistent backend-owned identity (below).
- **License:** installation-scoped status, validity, limits, and entitlements. It is never user-scoped.
- **Entitlement:** typed `MODULE` or `FEATURE` capability. Feature codes do not imply the feature is implemented.
- **Permission:** code-defined RBAC operation. Only permissions whose module prefix is entitled are assignable/effective.
- **Membership/Role/Access:** unchanged authorization layers. Licensing does not grant access.

## Implemented enforcement

`LicensingService` evaluates the configured `LicenseProvider`. `PermissionsService` supplies only licensed permission codes and refuses an unlicensed assignment. `AuthorizationService` intersects stored grants with licensed modules on every evaluation. A removed entitlement therefore does not delete `rbac.role_permissions`; it makes the grant ineffective until restored.

`OrganizationsService.createOrganization` and pinned-organization bootstrap check active status, the `organization` entitlement, and the installation organization count. `UsersService.createUser` (when active) and re-enablement check the unique active row count in `users.users`. Membership in several Organizations does not multiply this count because memberships are not counted.

Limits and perpetual validity use SQL/configuration null. Positive integers are finite limits. `validFrom` is inclusive; `validUntil` is exclusive.

Finite limit allocation is concurrency-safe. Organization creation and active-user creation/re-enablement execute their count and mutation in one PostgreSQL transaction while holding a transaction-scoped advisory lock derived from the licensed `installationId` and resource (`organizations` or `active-users`). Contenders for the same installation/resource serialize; after the winner commits, the next contender re-counts and is rejected at the limit. Authorization, validation, and password hashing remain outside this narrow transaction.

## Installation identity (L-02, ADR-0036)

The installation identifies itself with one row in `licensing.installations`
marked `is_self = true` (a partial unique index allows exactly one). The ULID
in that row is the installation id. `InstallationIdentityService.current()`
reads it and, only when it is absent, creates it inside a transaction that
also creates the installation's local customer row; a lost race is resolved by
re-reading, so concurrent boots converge on one identity.

The identity is therefore:

- **backend-owned** — never generated, stored or sent by the browser, and
  never read from `localStorage`;
- **stable** — created once and read from the database afterwards, unchanged
  across restarts, redeploys and image rebuilds;
- **not a fingerprint** — no MAC address, CPU id, disk serial, hostname or IP
  takes part in it. Hardware may change freely;
- **as durable as the database** — the `pgdata` volume (see
  `docker-compose.yml`) is what makes it survive. An empty database is a new
  installation, and a license issued for the old identity will not activate
  against it.

## Activation and persistence (L-02, ADR-0036)

A license reaches an installation as a **license code**:
`VLIC1.<payload-base64url>.<signature-base64url>`, signed with Ed25519 by the
license authority. The installation stores only public keys
(`LICENSE_SIGNING_PUBLIC_KEYS`, comma-separated PEM/base64-DER so the
authority can rotate); it verifies codes and never issues them. Nothing is
fetched over the network: activation and evaluation are entirely local.

`POST /api/v1/license/activate` accepts only `{ "code": "VLIC1...." }`. It
requires an authenticated session and the `Licensing.License.Activate`
permission — an ordinary user gets 403, an anonymous caller 401, and there is
no "is admin" shortcut. The backend derives every licensed fact from the
verified payload; the client can state nothing about status, validity, limits
or entitlements.

Rejection order, with nothing persisted unless all of it passes:

1. authorization (session + permission);
2. authenticity — format, `VLIC1` version, signature against a trusted key;
3. installation binding — the payload's `installationId` must be this
   installation's identity;
4. semantics — `validFrom < validUntil`, positive-or-null limits, known
   entitlement codes, no duplicates;
5. lifecycle — `SUSPENDED`, expired or not-yet-valid licenses are refused at
   activation time.

The submitted code itself is **never persisted**. It lives in memory for the
length of the activation call; what reaches the database is the license it
proves (status, validity, limits, entitlements, customer, installation) plus
the irreversible `code_hash = SHA-256(code)` used for idempotency:

```
license code → verified server-side → SHA-256 → code_hash persisted
```

There is no encrypted, encoded or otherwise reversible copy of the code
anywhere in the schema, so an inspected or leaked database yields no usable
license code. Evaluation after a restart needs only the derived columns.

Outcomes are deterministic: the same code again is an idempotent no-op
(`changed: false`), a different valid code replaces the current license in one
transaction and stamps `replaced_at` on the previous row, and an invalid code
leaves an existing valid license completely untouched. The current license is
the row with `replaced_at IS NULL`, unique per installation by partial index,
so a restart simply reads it back — no re-entry of the code, no activation
step at startup.

`GET /api/v1/license/current` remains a pure evaluation: no persisted license
→ `UNLICENSED`/inactive with the installation id; a persisted license →
`ACTIVE`, or inactive with a reason (`status`, `expired`, `not-yet-valid`).
It never activates anything and never calls out.

### Provider selection

`LICENSE_PROVIDER` chooses the implementation behind `LicensingService` and is
never inferred from `NODE_ENV`:

| value | behaviour |
| --- | --- |
| `persistent` (default) | evaluates the license this installation activated and stored |
| `local-development` | the L-01 configuration-backed synthetic license, for tests and local work |

`NODE_ENV=development` carries no licensing meaning whatsoever; the
`LICENSE_*` payload variables apply only to `local-development`.

### Bootstrap allowance

A never-licensed installation may hold exactly **one** active user: the
administrator who will activate the license (requiring a license to create the
only account able to install one would deadlock the installation). The
allowance is enforced by the same advisory-locked count as a licensed limit,
grants no permission, unlocks no organization, and does not exist for an
installation whose license expired or was suspended. Pinned
deployment-organization provisioning is deferred while unlicensed: run
`npm run bootstrap:system-admin` again after activation — it is idempotent and
provisions the organization then.

### Issuing a development or test license

Issuing is a developer CLI, never a product endpoint. It refuses to run with
`NODE_ENV=production`, and the private key lives only in the issuer's
environment — never in frontend config, never in the database, never in an
application table:

```
npm run license:keygen                                   # prints a key pair
LICENSE_SIGNING_PRIVATE_KEY=<pem> npm run license:issue -- \
  --installation <installation-id> --users 25 --modules organization,users
```

The installation id is printed by `npm run bootstrap:system-admin`, returned
by `GET /api/v1/license/current`, and shown on the frontend license screen.

## Development bootstrap

`LICENSE_PROVIDER=local-development` selects `LocalDevelopmentLicenseProvider` explicitly. Defaults are active, perpetual, unlimited, and entitled only for implemented modules. Configuration can restrict status, dates, limits, modules, and feature codes. Selection never branches on `NODE_ENV` and there is no admin/email bypass.

System-administrator bootstrap still creates ordinary User/Role/Membership records. User creation, pinned Organization provisioning, and permission reconciliation now pass through licensing. Unpinned bootstrap still creates no Organization.

## API

`GET /api/v1/license/current` is authenticated but intentionally needs no RBAC permission: it is a post-login bootstrap/self-state read. It returns evaluated non-secret state and never returns a key/token or the license code.

`POST /api/v1/license/activate` requires `Licensing.License.Activate` and is described under *Activation and persistence* above.

## Persistence and provider status

Typed `licensing.customers`, `installations`, `licenses`, and `license_entitlements` tables are **IMPLEMENTED**. Since L-02 they are also **in use**: the installation identity and the activated license are rows there, and `PersistentLicenseProvider` (the default) reads them. A commercial/CRM provider and any remote validation remain **DEFERRED** — they would replace the provider token without touching consumers.

## Frontend consumption

The frontend has exactly one license source: `GET /api/v1/license/current`, read once per authenticated session through `features/licensing/use-license-state.ts` under the single query key `queryKeys.licenseState()`. There is no second context, API client, entitlement registry, storage copy, environment variable or development fallback, and the session's existing logout/401 cache reset evicts it with everything else.

The authenticated bootstrap order is fixed:

`login → session (GET /auth/me) → license (GET /license/current) → organization (GET /organizations) → organization context → workspace`

`app/layouts/license-gate.tsx` is that licensing stage. It renders its children — the organization gate and the workspace behind it — only while the evaluated license is active, and otherwise replaces them with one of three states: the read is in flight, the backend evaluated the license as not active, or the read failed (retryable, and never collapsed into "inactive" or "active"). What it adds beyond blocking is the information an operator needs: a never-licensed installation gets its own screen ("this installation has no license yet") quoting the installation id, distinct from the "license is not active" screen of an expired or suspended one.

### Frontend activation (FE-LICENSE-01)

The inactive state is no longer terminal for an operator who may act on it. When the session holds `Licensing.License.Activate`, the licensing stage renders the activation step (`features/licensing/license-activation-form.tsx`) in place of the explainer: one labelled code field, one submit action, and the installation id taken verbatim from the current-license response. A session without that permission sees the unchanged explainer, because `POST /api/v1/license/activate` would answer 403 anyway — the check is UX routing, not authorization, and no role, username or environment is ever a license bypass.

The authority order is the point of the implementation: `POST /license/activate` returning 200 never marks the frontend state active. The activation mutation (`features/licensing/use-activate-license.ts`) invalidates and awaits a refetch of the one canonical query key, and the gate releases only on a `GET /license/current` that reports `active: true`; if that re-read fails, the stage shows its retryable error state and the workspace stays closed. A rejected code keeps the user on the activation screen with a Persian, operation-scoped message (the backend sentence, its details and any crypto/persistence internals are never rendered) and another attempt costs nothing. Nothing about the license is verified client-side: the form only rejects an empty, whitespace-only or over-long (> 8192 characters, the DTO limit) value.

The raw code is write-once memory: it lives in the form state and in the body of a single request, and is never written to `localStorage`, `sessionStorage`, a cookie, the URL, a query-string, a log, an analytics payload or a persisted cache (the frontend has no logger, and the mutation cache is in-memory with `gcTime: 0`). Activation does not touch the session: no logout, no login, no reload — the organization bootstrap simply runs behind the released gate. The CLI/API activation paths are unchanged and remain available.

The stage is UX routing, never enforcement (AR-21). It compares no count against `organizationLimit`/`userLimit`, derives no entitlement semantics of its own (the contract's `entitlements` collection is consumed as-is), and changes nothing about who may do what — `LicensingService` and the owning application services remain the only enforcement points. Its necessity is a messaging one: because `AuthorizationService.effectivePermissionCodes` filters stored grants through the license, an inactive license yields an empty effective permission set, so without this stage an inactive installation is indistinguishable in the UI from a user who simply lacks permission. License and permission stay two different facts with two different Persian explainers.

### PR #96

PR #96 was open and not merged when L-01 landed. Its follow-up requirement — read the authenticated license state before offering organization provisioning, route inactive states to a license state, and keep permission/membership checks untouched — is implemented by the licensing stage above: the first-organization bootstrap in `organization-gate.tsx` is reachable only behind an active license, and that gate itself no longer evaluates the license, so there is exactly one place where license state is interpreted.

## Licensing versus authentication

They are independent state machines. An inactive or expired license never ends
a session, never logs anyone out and never forces a login; an expired session
never changes license evaluation. Platform permissions (`Licensing.*`) survive
license filtering precisely so an unlicensed installation can still be
licensed by its administrator. Session behaviour itself is `docs/security.md`
§2.

## Deferred / not implemented

CRM, billing, payments, remote validation, remote revocation, hardware fingerprinting, marketplace/subscriptions, and an activation UI are not implemented. Future `CrmLicenseProvider`-like infrastructure can replace the provider token without changing consumers.
