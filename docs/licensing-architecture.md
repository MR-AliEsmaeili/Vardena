# Licensing architecture (L-01)

## Model

`Customer → Installation → License → Entitlement → assignable Permission → Role → Organization Membership → Access`

- **Customer:** minimal commercial identity; not the Organization party/customer master and not CRM.
- **Installation:** deployed Vardena instance. The current deployment is one installation and may contain multiple Organizations.
- **License:** installation-scoped status, validity, limits, and entitlements. It is never user-scoped.
- **Entitlement:** typed `MODULE` or `FEATURE` capability. Feature codes do not imply the feature is implemented.
- **Permission:** code-defined RBAC operation. Only permissions whose module prefix is entitled are assignable/effective.
- **Membership/Role/Access:** unchanged authorization layers. Licensing does not grant access.

## Implemented enforcement

`LicensingService` evaluates the configured `LicenseProvider`. `PermissionsService` supplies only licensed permission codes and refuses an unlicensed assignment. `AuthorizationService` intersects stored grants with licensed modules on every evaluation. A removed entitlement therefore does not delete `rbac.role_permissions`; it makes the grant ineffective until restored.

`OrganizationsService.createOrganization` and pinned-organization bootstrap check active status, the `organization` entitlement, and the installation organization count. `UsersService.createUser` (when active) and re-enablement check the unique active row count in `users.users`. Membership in several Organizations does not multiply this count because memberships are not counted.

Limits and perpetual validity use SQL/configuration null. Positive integers are finite limits. `validFrom` is inclusive; `validUntil` is exclusive.

Finite limit allocation is concurrency-safe. Organization creation and active-user creation/re-enablement execute their count and mutation in one PostgreSQL transaction while holding a transaction-scoped advisory lock derived from the licensed `installationId` and resource (`organizations` or `active-users`). Contenders for the same installation/resource serialize; after the winner commits, the next contender re-counts and is rejected at the limit. Authorization, validation, and password hashing remain outside this narrow transaction.

## Development bootstrap

`LICENSE_PROVIDER=local-development` selects `LocalDevelopmentLicenseProvider` explicitly. Defaults are active, perpetual, unlimited, and entitled only for implemented modules. Configuration can restrict status, dates, limits, modules, and feature codes. Selection never branches on `NODE_ENV` and there is no admin/email bypass.

System-administrator bootstrap still creates ordinary User/Role/Membership records. User creation, pinned Organization provisioning, and permission reconciliation now pass through licensing. Unpinned bootstrap still creates no Organization.

## API

`GET /api/v1/license/current` is authenticated but intentionally needs no RBAC permission: it is a post-login bootstrap/self-state read. It returns evaluated non-secret state and never returns a key/token.

## Persistence and provider status

Typed `licensing.customers`, `installations`, `licenses`, and `license_entitlements` tables are **IMPLEMENTED** as the persistence foundation. Commercial activation/write APIs and a database/commercial provider are **DEFERRED**. The active provider in L-01 is configuration-backed local development.

## Frontend consumption

The frontend has exactly one license source: `GET /api/v1/license/current`, read once per authenticated session through `features/licensing/use-license-state.ts` under the single query key `queryKeys.licenseState()`. There is no second context, API client, entitlement registry, storage copy, environment variable or development fallback, and the session's existing logout/401 cache reset evicts it with everything else.

The authenticated bootstrap order is fixed:

`login → session (GET /auth/me) → license (GET /license/current) → organization (GET /organizations) → organization context → workspace`

`app/layouts/license-gate.tsx` is that licensing stage. It renders its children — the organization gate and the workspace behind it — only while the evaluated license is active, and otherwise replaces them with one of three states: the read is in flight, the backend evaluated the license as not active, or the read failed (retryable, and never collapsed into "inactive" or "active"). Activation itself is not a frontend capability: no activation, renewal or license-administration UI exists, because no write contract exists.

The stage is UX routing, never enforcement (AR-21). It compares no count against `organizationLimit`/`userLimit`, derives no entitlement semantics of its own (the contract's `entitlements` collection is consumed as-is), and changes nothing about who may do what — `LicensingService` and the owning application services remain the only enforcement points. Its necessity is a messaging one: because `AuthorizationService.effectivePermissionCodes` filters stored grants through the license, an inactive license yields an empty effective permission set, so without this stage an inactive installation is indistinguishable in the UI from a user who simply lacks permission. License and permission stay two different facts with two different Persian explainers.

### PR #96

PR #96 was open and not merged when L-01 landed. Its follow-up requirement — read the authenticated license state before offering organization provisioning, route inactive states to a license state, and keep permission/membership checks untouched — is implemented by the licensing stage above: the first-organization bootstrap in `organization-gate.tsx` is reachable only behind an active license, and that gate itself no longer evaluates the license, so there is exactly one place where license state is interpreted.

## Deferred / not implemented

CRM, billing, payments, remote validation, cryptographic offline files, hardware fingerprinting, marketplace/subscriptions, and a polished activation UI are not implemented. Future `CrmLicenseProvider`-like infrastructure can replace the provider token without changing consumers.
