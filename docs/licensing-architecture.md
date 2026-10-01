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

## Development bootstrap

`LICENSE_PROVIDER=local-development` selects `LocalDevelopmentLicenseProvider` explicitly. Defaults are active, perpetual, unlimited, and entitled only for implemented modules. Configuration can restrict status, dates, limits, modules, and feature codes. Selection never branches on `NODE_ENV` and there is no admin/email bypass.

System-administrator bootstrap still creates ordinary User/Role/Membership records. User creation, pinned Organization provisioning, and permission reconciliation now pass through licensing. Unpinned bootstrap still creates no Organization.

## API

`GET /api/v1/license/current` is authenticated but intentionally needs no RBAC permission: it is a post-login bootstrap/self-state read. It returns evaluated non-secret state and never returns a key/token.

## Persistence and provider status

Typed `licensing.customers`, `installations`, `licenses`, and `license_entitlements` tables are **IMPLEMENTED** as the persistence foundation. Commercial activation/write APIs and a database/commercial provider are **DEFERRED**. The active provider in L-01 is configuration-backed local development.

## PR #96

PR #96 is open and not merged at implementation time. Follow-up: its `organization-gate` must fetch the authenticated license state first, route inactive states to a small activation/license state, and only then run existing Organization availability/first-create logic. It must not replace permission or membership checks.

## Deferred / not implemented

CRM, billing, payments, remote validation, cryptographic offline files, hardware fingerprinting, marketplace/subscriptions, and a polished activation UI are not implemented. Future `CrmLicenseProvider`-like infrastructure can replace the provider token without changing consumers.
