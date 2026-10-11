# ADR-0030: Installation licensing precedes the RBAC capability catalog

- **Status:** Accepted for L-01; extended by ADR-0036 (L-02: persistent installation identity, signed license codes, activation endpoint, `persistent` provider by default)
- **Reconciliation note (2026-10-11):** The Owner-approved licensing product requirements are recorded in [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md). Some of them conflict with this ADR (see PDR-11 §19). This ADR's text is unchanged until the conflicts are decided through the ADR process.
- **Date:** 2026-10-01

## Context

Licensing is a platform capability, not authentication or authorization. A commercial **Customer** owns an **Installation**; the installation has licenses and contains Organizations. Neither Customer nor Installation is an Organization. A License is installation/customer scoped, never scoped to an administrator or inferred from user identity.

## Decision

The backend evaluates this chain:

`License → Entitlement → assignable Permission catalog → Role → Membership → effective Access`

A module/feature Entitlement and an RBAC Permission are different facts. Licensing defines the capability universe; RBAC distributes capabilities; membership and authorization determine user access.

1. The backend is authoritative. Frontend state is display/cache only.
2. `ACTIVE`, `EXPIRED`, and `SUSPENDED` are explicit lifecycle values. `validFrom` is inclusive and `validUntil` is exclusive. A null `validUntil` is perpetual.
3. Organization/user limits use null for unlimited. No magic dates or integer sentinels exist.
4. Unlicensed permissions are absent from the assignable catalog and assignment attempts are rejected server-side.
5. Authorization filters stored RBAC grants through the current license. When entitlement disappears, grants remain stored but ineffective; restoration can make them effective again.
6. Organization creation and active-user creation/re-enablement are license-gated in their owning application services. Existing Organization permissions and membership rules still apply.
7. Consumers depend on `LicenseProvider` through `LicensingService`. Providers are selected explicitly by name (`persistent` by default since L-02; `LocalDevelopmentLicenseProvider` reads validated configuration and is for tests/local work). It has no `NODE_ENV`, administrator, role, username, or email bypass.
8. Persistence uses typed Customer, Installation, License, and Entitlement tables in the `licensing` schema; no EAV or universal JSON payload.
9. Finite organization and active-user allocations serialize on PostgreSQL transaction-scoped advisory locks keyed by installation and resource. Count plus mutation occur under that lock in one transaction, preventing concurrent over-allocation without a process-global or distributed lock.

## Consequences

- The System Administrator receives only currently licensed registered permissions. Existing unlicensed grants are not deleted.
- Login remains possible so an authenticated client can read `GET /api/v1/license/current`; licensed capabilities remain unavailable when inactive.
- PR #96's first-organization UX must call the license-state endpoint before offering organization provisioning. Its existing Organization/RBAC path remains unchanged.
- Backup/export exceptions and a commercial post-expiry read-only policy remain outside L-01. L-01 blocks licensed capability use when inactive; it does not implement billing or contract termination policy.

## Capability classification

- **IMPLEMENTED:** provider boundary; local provider; lifecycle/validity evaluation; module and feature entitlements; assignable/effective RBAC filtering; organization/user limits; authenticated state API; typed persistence schema.
- **FOUNDATION ONLY (L-01) / IMPLEMENTED (L-02, ADR-0036):** persisted installation identity and persisted activated license with a local signed-code activation API.
- **DEFERRED/FUTURE:** CRM/commercial provider, billing, remote server, signed/offline licenses, hardware binding, marketplace, polished activation UI.
- **NOT IMPLEMENTED:** hidden admin/development bypasses, EAV, frontend-authoritative licensing.
