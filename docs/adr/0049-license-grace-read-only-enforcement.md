# ADR-0049: License Grace and Read-Only enforcement boundary (OQ-45)

Status: Proposed; implemented for Product Owner review (2026-10-16)
Date: 2026-10-16

## Context

PDR-11 §20.5 records that expiry evaluation filtered every non-platform
permission when a license became inactive, with no Grace/Read-Only operation
classification. OQ-45 (decided 2026-10-16) requires, for natural subscription
expiry only: Active → Grace (signed expiry + 14×24h UTC) → Read-Only, with
backend enforcement, preserved authorized reads, and restoration on valid
renewal. This changes the authorization model, so ADR-0029/AR-29 requires an
ADR before dependent implementation.

## Decision

1. Grace/Read-Only is an **evaluated runtime policy** in the licensing domain
   (`accessMode`, `graceEndsAt`), derived from the signed `validUntil` instant
   by exact UTC millisecond arithmetic. Signed payloads, `validUntil`, and the
   end-exclusive validity interval are never mutated.
2. Enforcement stays at the existing central boundary:
   `LicensingService.filterLicensedPermissions`, consumed by
   `AuthorizationService.effectivePermissionCodes`, which both the HTTP
   `AuthorizationGuard` and application-service `requireAllPermissions` use.
   No per-controller duplication and no new role.
3. Permission operation classification is by the existing final code segment:
   `View`/`Export` are reads; all other codes are mutations. Platform
   (`Licensing.*`) permissions remain as before (renewal/recovery bootstrap).
4. Modes: `ACTIVE`/`GRACE` keep entitled permissions; `READ_ONLY` (natural
   expiry at/after `graceEndsAt`) keeps only entitled read permissions plus
   platform; `BLOCKED` (unlicensed, suspended/status, not-yet-valid) keeps the
   previous platform-only behavior, so emergency/status restrictions are not
   weakened. Natural expiry is `status=ACTIVE` evaluated past `validUntil`;
   signed `EXPIRED`/`SUSPENDED` status receives no Grace.
5. The application-service layer also refuses mutation permissions in
   `READ_ONLY` in system (non-HTTP) context, so a job queued in Grace cannot
   execute a prohibited mutation after the deadline merely because no HTTP
   principal is present. There is no production worker dispatch loop today
   (`worker.service.ts`); this is defence at the shared service boundary.
6. License state is re-evaluated from the provider on every `current()` call;
   there is no new license cache. Frontend display is supplementary only.

## Consequences

- Easier: one auditable chokepoint covers HTTP controllers across modules;
  reads/exports surviving Read-Only is a licensing filter change, not RBAC
  reassignment — stored assignments are untouched and renewal restores them.
- Harder: a future permission whose final segment is a read verb other than
  `View`/`Export` would be treated as a mutation (fail-safe direction).
- Follow-up: OQ-45 remains open for contract-termination strictness and PO
  acceptance; OQ-78 cancellation/recovery semantics are not decided here.
