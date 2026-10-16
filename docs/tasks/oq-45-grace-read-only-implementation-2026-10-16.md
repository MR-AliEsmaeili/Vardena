# OQ-45 Grace/Read-Only implementation record (2026-10-16)

Starting `main`: `74079fe83c6f0023e0ade10ca0d39c02246bf1fa` (live-verified).
Branch: session branch for this task. ADR: ADR-0049 (Proposed, first commit).

## Enforcement-path matrix

| Path | Current guard before | Behavior now | Evidence |
|---|---|---|---|
| HTTP controllers (all modules) | AuthGuard + AuthorizationGuard -> effective permissions | Grace: entitled codes; Read-Only: entitled View/Export + Licensing.*; Blocked: platform only | licensing-grace.spec, existing guard specs in CI |
| Application services | AuthorizationService.requireAllPermissions (principal) | Same filter as HTTP | authorization-readonly.spec (system path) |
| System/worker context | Trusted (no principal) | Mutation codes refused in READ_ONLY via assertBusinessMutationAllowed; no production dispatch loop exists in worker.service.ts | authorization-readonly.spec |
| Org/user allocation | LicensingService.requireActive | ACTIVE/GRACE allowed; READ_ONLY 403 license_read_only; UNLICENSED bootstrap preserved | licensing-grace.spec + existing specs |
| License import/renewal/status | Platform Licensing.* (unchanged) | Available in every mode; per-call re-evaluation, no new cache, restores prior assignments | licensing-grace.spec renewal case |
| Reads/reports/print/Excel | *.View/*.Export permissions | Retained in Read-Only only if already entitled+granted; no new permission granted | filter tests |
| Backup/recovery | No in-product backup endpoint (ops runbook, OQ-53) | Untouched; license state does not block external runbook | source inspection |
| Auth/login | Identity AuthGuard (no license filter) | Unchanged; Read-Only does not force logout | source inspection |

## Tests added
- `license-grace.spec.ts`: before/exact expiry, Grace start, deadline-1ms, exact/after deadline, DST-independent 336h, perpetual/future/suspended/signed-EXPIRED, read classification.
- `licensing-grace.spec.ts`: Grace filtering, Read-Only filtering, mutation gate, renewal restoration, provider failure fail-closed, suspended unchanged.
- `authorization-readonly.spec.ts`: queued/system-context mutation refused in Read-Only; reads/active allowed.
- OpenAPI contract spec: new `accessMode`/`graceEndsAt` fields.

Local heavy suites were deliberately not run (task §8); GitHub Actions on the exact PR head is authoritative. OQ-45 is not closed by this record.
