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

## Addendum (2026-10-16) — follow-up round on the merged enforcement

This addendum records verification and coverage added after the enforcement
slice merged in PR #167 (merge commit `c715a64cdfcbc866fe65613a0375a118e0024a8b`).
**No decision above changes**, and OQ-45 stays **OPEN** for Product Owner
acceptance and for the contract-termination strictness question.

1. **The read classification is true of the real catalog.** Decision 3's rule
   ("the final code segment is `View`/`Export`") was checked against every
   registered `PermissionDefinition` array in `backend/src/modules/**`
   (Accounting, Documents, Inventory ×5, Licensing, Organization, RBAC, Users,
   Workflow). Every registered `...View` code is a read and every other code is
   a mutation; **`Export` is not currently registered anywhere**, and no
   registered code has any other read verb (`Print`, `Download`, `Preview`,
   `List`, …) as its final segment. Two catalog facts are now pinned by a test
   (`permission-read-classification.spec.ts`) so the rule cannot silently
   become wrong: a future read-verb code fails the test until it is classified
   deliberately, and every registered code must map to a module the signed
   license can entitle.
2. **Printing has no independent permission.** `Print` exists only as a
   document-lifecycle action (`DOCUMENT_ACTIONS` in the Documents domain) and
   has no RBAC code, no registered permission and no endpoint. Read-Only
   therefore neither blocks nor grants printing today; when a print surface is
   implemented it is authorized by the owning document's `View`/`Export` code
   — which Read-Only keeps for entitled modules. If a dedicated `Print` code is
   ever registered, §1's guard test fails and the Read-Only classification must
   be decided explicitly rather than inherited.
3. **Enforcement coverage completed where the previous round only reasoned.**
   The HTTP path (`AuthorizationGuard` → `hasAllPermissions` →
   `filterLicensedPermissions`) previously had no test at all in the Read-Only
   round; it now has focused cases for a principal who *holds* a mutation code
   in `READ_ONLY` (refused), an entitled read and a platform `Licensing.*` code
   (kept), an unentitled read (still refused — Read-Only grants nothing new),
   an entitled mutation during `GRACE` (allowed) and a `BLOCKED` license
   (platform-only). Boundary and durability coverage was extended for the exact
   expiry instant, the 336-hour span across a DST transition, one instant
   expressed in two offsets, a fresh service instance after a restart (the
   signed deadline never slides) and restoration of mutations on valid renewal
   with no cache.
4. **Defect fixed in the customer UI.** The grace notice in the license gate
   rendered the raw ISO `graceEndsAt` wire value instead of formatting the
   instant through the shared date foundation (`docs/datetime.md`, AR-32),
   which the source guard did not catch because its raw-Instant pattern named
   five fields explicitly. The gate now uses the shared formatter, the notice
   is an accessible `role="status"` region, the guard's pattern is general
   (`*At` / `*Timestamp`) and the gate has its first Grace/Read-Only tests.
5. **Open item raised, not decided here.** The client-device lifecycle treats
   a license that has crossed its natural expiry instant as "not active" for
   registration, replacement proof and replacement completion, and destroys a
   still-pending replacement request as `license-version-changed`. Whether the
   approved `GRACE` window should permit those operations, and whether a
   natural lapse may destroy an Owner-approved pending replacement that a valid
   renewal is supposed to restore "without manual reconstruction", is a product
   question recorded in the decision brief
   [`docs/tasks/licensing-open-decisions-brief.md`](../tasks/licensing-open-decisions-brief.md).
