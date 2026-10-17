# PDR-18 §4.1 / OQ-45 — backend Grace/Read-Only enforcement audit (2026-10-17)

- **Scope:** audit of the **already merged** OQ-45 implementation
  (PR #167 `c715a64cdfcbc866fe65613a0375a118e0024a8b`, PR #168), made under the
  rule "if OQ-45 is already implemented, do not rebuild it from zero; **fix
  proven defects** or move to the next authorized gap".
- **Result: no proven defect found. Nothing was changed, fixed or weakened.**
  Seven findings confirm the enforcement surface; one genuine gap is documented
  as **decision-dependent** and was deliberately not changed.
- **Method:** read-only review of the enforcement surface at `main`
  `7fa9ff3ba460eb023b657db216c6a6488cc2af87`. No runtime code, migration, test
  or configuration was modified by this audit.
- **Related:** [PDR-18](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md)
  §4, [ADR-0049](../adr/README.md), [OQ-45](../open-questions.md),
  [OQ-78](../open-questions.md), [OQ-79](../open-questions.md), and the
  PDR-18 §1 [implementation record](pdr-18-contract-and-activation-dates-implementation.md).

---

## 1. Verified sound — no change made

| #   | Finding                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | **Grace is exactly 14 × 24 h of UTC-millisecond arithmetic from the signed expiry instant**, not a calendar-day or local-time computation, and it never mutates `validUntil`.                                                                                                                                                                     | `domain/license.ts:15` (`LICENSE_GRACE_DURATION_MS`), `:32-36` (`graceEndsAtFor`), `:19-23`                                                                                    |
| A2  | **Read-Only begins _at or after_ the boundary, never after a further delay.** `at < graceEndsAt` → `GRACE`; `at >= graceEndsAt` → `READ_ONLY`. This matches PDR-18 §4.1 ("then Read-Only at or after the boundary").                                                                                                                              | `domain/license.ts:112-121`                                                                                                                                                    |
| A3  | **Only natural expiry earns Grace.** `GRACE`/`READ_ONLY` require `inactiveReason === 'expired'`; `unlicensed`, `status` and `not-yet-valid` are `BLOCKED`. So cancellation/revocation does **not** silently inherit the 14-day Grace, which is the outcome PDR-18 §4.2 requires — even though §4's _instrument_ remains blocked (OQ-78).          | `domain/license.ts:103-121`, `:20-23`                                                                                                                                          |
| A4  | **HTTP is enforced in the backend, not only in the UI.** The controller guard resolves through the same licensing filter as the application-service check, so hiding a button is never the enforcement.                                                                                                                                           | `rbac/application/authorization.guard.ts` → `hasAllPermissions` → `effectivePermissionCodes` → `LicensingService.filterLicensedPermissions` (`authorization.service.ts:56-62`) |
| A5  | **Read-Only keeps reads and refuses mutations, per entitled module.** In `READ_ONLY` only codes whose final segment is `View` or `Export` survive, and only for an entitled module; in `BLOCKED` only platform permissions survive. Platform permissions (`Licensing.*`) are never filtered, so an unlicensed installation can still be licensed. | `licensing/application/licensing.service.ts:159-176`, `domain/license.ts:26-30`                                                                                                |
| A6  | **The service-authority escalation is not a licensing bypass.** `requireServiceAuthority` re-reads the initiating permission from the assignment tables through the _same_ `hasAllPermissions`, so license filtering applies to that path too; it also refuses to run without a request context and a human principal.                            | `authorization.service.ts:203-210`, `:158-178`                                                                                                                                 |
| A7  | **No cache anywhere on the decision path, so the boundary and a restoration take effect immediately.** `LicensingService.current()` re-reads the provider on every call, and RBAC re-reads assignments on every request. A renewal therefore restores access on the next check, and a Grace deadline is not deferred by a cached evaluation.      | `licensing.service.ts:70-79`; `authorization.service.ts:29-36` (no-cache note), `:56-62`                                                                                       |

## 2. One genuine gap — documented, deliberately **not** changed

**The system/worker-context guard keys only on `READ_ONLY`.** With no request in
flight (bootstrap, worker, direct service use) `requireAllPermissions` refuses
non-platform, non-read permissions **only** while the access mode is
`READ_ONLY`; in `BLOCKED` the historical trusted-system semantics are kept
unchanged
(`backend/src/modules/rbac/application/authorization.service.ts:93-110`).

Consequences:

- For `UNLICENSED` this is **necessary and correct**: bootstrap must be able to
  create the first account that installs a license, and requiring a license to
  create the only account that can install one is a deadlock — the same reason
  `UNLICENSED_BOOTSTRAP_ACTIVE_USERS` exists.
- For a **SUSPENDED** license (`inactiveReason === 'status'`) it is
  **inconsistent with PDR-18 §4.2**, whose outcome is that a cancelled or
  revoked license is simply inactive. A background path may today perform
  business mutations while the license is suspended.

**Why it was not fixed.** Distinguishing "unlicensed bootstrap" from
"suspended" requires attributing `status` to a cause, and PDR-18 §4's
termination/cancellation instrument does not exist — that is exactly **OQ-78**,
and [OQ-79](../open-questions.md) additionally records the standing policy
against blanket-mapping legacy `SUSPENDED` to any status. Refusing all
system-context mutations in `BLOCKED` would break installation bootstrap, and
refusing them only for `SUSPENDED` would invent the attribution rule OQ-78 has
not decided. The gap is therefore recorded, not patched.

**Current exposure is nil.** The worker process performs no jobs today: it
verifies database connectivity and idles, with outbox dispatch, integration
calls and report jobs explicitly deferred to later modules
(`backend/src/worker.ts:9-25`). No scheduled or queued path performs a business
mutation, so nothing reaches the gap. The gate is in place for whichever job
first mutates business state, and `assertBusinessMutationAllowed` is documented
as the fail-closed gate for exactly those non-permission-checked paths — its
only caller today is the system-context branch above.

## 3. Verdict

The merged OQ-45 implementation is **sound on every path that exists today**:
HTTP (guard and application service), the service-authority escalation, and the
system/worker branch in Read-Only. The single gap found is real but
decision-dependent and currently unexercised. **No defect was fixed because no
defect was proven; nothing was rebuilt; no control was weakened.** The gap is
registered against OQ-78 and must be revisited by whichever slice implements
PDR-18 §4.
