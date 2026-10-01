# Task L-01 — Licensing Foundation implementation report

## Summary

Implemented an installation-scoped licensing module, typed persistence foundation, explicit local-development provider, lifecycle/validity/entitlement evaluation, license-derived RBAC catalogs/effective access, organization and unique-active-user limits, authenticated state API, focused tests, and CI E2E coverage.

## Architecture

`Customer → Installation → License → Entitlement → assignable Permission → Role → Organization Membership → Access`

Customer and Installation are commercial/deployment identities, not Organizations. License is never user-scoped. Entitlement is not Permission; Permission is not Access. Licensing defines the capability universe while existing RBAC and Organization membership remain authoritative within it.

## Database

- `backend/prisma/schema/licensing.prisma`: `LicenseCustomer`, `Installation`, `License`, `LicenseEntitlement`; `LicenseStatus` and `EntitlementKind` enums.
- `backend/prisma/schema/base.prisma`: registers the `licensing` PostgreSQL schema.
- `backend/prisma/migrations/20261001000000_licensing_foundation/migration.sql`: additive deterministic schema, FKs, checks, unique constraint and indexes.
- Null means perpetual/unlimited; migration checks reject non-positive finite limits and invalid validity windows.

## Backend

- `backend/src/modules/licensing/domain/license.ts`: lifecycle and inclusive-start/exclusive-end evaluation.
- `backend/src/modules/licensing/application/license-provider.ts`: provider token/port.
- `backend/src/modules/licensing/application/local-development-license.provider.ts`: explicit configuration-backed provider.
- `backend/src/modules/licensing/application/licensing.service.ts`: entitlement, permission and limit evaluation.
- `backend/src/modules/licensing/licensing.module.ts`: DI composition.
- `backend/src/kernel/config/app-config.ts`: validated provider/status/date/limit/entitlement configuration.
- `OrganizationsService`: active license + `organization` module + count gate for API and pinned bootstrap creation.
- `UsersService`: active license + `users` module + unique active-user row count for active creation/re-enablement. Membership rows are not counted, so one user in several Organizations remains one licensed user.

## API

`GET /api/v1/license/current` requires a valid session but intentionally no RBAC permission because it is post-login bootstrap/self-state. Response contains evaluated status, active/reason, validity, nullable limits, entitlements and provider name. It exposes no key/token/secret.

## RBAC integration

- `PermissionsService.list` passes only currently licensed registered codes to repository pagination.
- `PermissionsService.resolveAssignablePermission` rejects unlicensed assignments with HTTP 422.
- `AuthorizationService.effectivePermissionCodes` intersects stored grants with active module entitlements on every evaluation.
- Existing role-permission rows are never deleted when an entitlement disappears; they are ineffective and can become effective when restored.
- System Administrator reconciliation assigns only licensed registry permissions. There is no role/admin/email/`NODE_ENV` bypass.

## Organization integration and PR #96

Organization creation remains permission-gated and is additionally license-gated in the application service. Pinned bootstrap uses the same limit gate; unpinned development bootstrap still creates no Organization. PR #96 was open/unmerged during implementation. Its follow-up is to query `/license/current` before its existing Organization gate; no frontend duplication was added.

## Provider

All consumers depend on `LicensingService`/`LicenseProvider`. `LICENSE_PROVIDER=local-development` is explicit and auditable. Defaults cover only implemented module prefixes. A future commercial provider can replace the token without consumer redesign. Persisted commercial activation is foundation-only in L-01.

## Tests

| Test/file | Purpose | Result |
|---|---|---|
| `licensing.service.spec.ts` — lifecycle tests | active/expired/suspended, validity boundaries, perpetual semantics | PASS |
| `licensing.service.spec.ts` — entitlement/limit tests | module vs feature, unavailable module, finite/null-unlimited org/user limits, identity independence | PASS |
| `licensing-rbac.integration.spec.ts` | assignable licensed permission, rejected unlicensed permission, stale grant ineffective, suspended denial | PASS |
| `users.service.spec.ts` — unique active-user limit | installation user count is active Users, not membership count | PASS |
| `system-administrator-permission-reconciliation.spec.ts` | licensed-only ordinary administrator grants | PASS |
| `test/licensing.e2e-spec.ts` | login → state → Organization create; org limit; unlicensed assignment rejection; suspended access denial | PASS locally (focused in-process), included in CI full E2E |

## Local verification

- `npm run typecheck`: PASS.
- `npm run lint`: PASS (one pre-existing warning in `coding-structure-accounts.spec.ts`, zero errors).
- `npm run format:check`: PASS.
- `npm test`: PASS — 115 files, 1330 tests.
- `npm run build`: PASS.
- Focused licensing unit/integration: PASS — 25 tests in the focused run before the final full unit run.
- Focused `test/licensing.e2e-spec.ts`: PASS — 4 tests, ~0.5 seconds test time.
- Prisma validation/generate local attempt: environment could not download Prisma's schema-engine checksum from `binaries.prisma.sh` (TLS/network failure before validation); schema/migration validation is therefore delegated to the existing CI Prisma validate/generate/deploy steps.

## E2E verification

Local full E2E: **intentionally not awaited** because the repository live suite is long-running. Only the deterministic focused licensing E2E was run locally.

GitHub Actions workflow: `.github/workflows/ci.yml` (`CI`, backend job including migrate/bootstrap/full E2E).

- Run ID: `36825170059`
- Backend check/job: `110249120134` — PASS (3m47s)
- E2E result: PASS — existing full E2E step, including live PostgreSQL suites and `test/licensing.e2e-spec.ts`
- Frontend check/job: `110249120297` — PASS (1m46s)

An initial run (`36824731136`, backend job `110247762172`) exposed the real `Document.*` permission-prefix versus `documents` entitlement-code mapping. The mapping was made explicit and the complete replacement run above passed; no tests were mocked or removed.

## Documentation

- `docs/adr/0030-license-foundation.md`
- `docs/licensing-architecture.md`
- `docs/modules.md`
- `backend/README.md`
- `backend/.env.example`
- this report

## Scope protection

Deferred/not implemented: CRM, billing/payments, marketplace/subscriptions, remote license server, commercial activation API, signed/offline cryptography, hardware binding, EAV, generic policy/rules engine, Redis/microservices, polished licensing UI, and unrelated frontend refactors.

## Known limitations

- The current authoritative provider is configuration-backed local development; persisted license records are a typed foundation and do not yet have a commercial/database activation provider or write API.
- The repository currently models one installation per deployment; Organizations have no redundant installation FK.
- PR #96 requires the documented frontend follow-up after merge.
- Commercial post-expiry read-only/export/restore policy remains deferred; L-01 gates licensed capabilities when inactive.

## Final status

READY FOR REVIEW
