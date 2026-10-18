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

## Follow-up round (2026-10-16, after the PR #167 merge `c715a64`)

Starting `main`: `c715a64cdfcbc866fe65613a0375a118e0024a8b` (live-verified; the
merge commit above is an ancestor of it and its changes are unmodified). This
round verified the merged enforcement against the real permission catalog,
closed the coverage gaps the matrix above recorded as reasoned-but-untested, and
fixed one customer-visible defect the earlier round shipped.

### Verified

- **The read rule is true of the whole registered catalog.** Decision 3's
  "final segment is `View`/`Export`" was checked against every registered
  `PermissionDefinition` array (Accounting, Documents, Inventory ×5, Licensing,
  Organization, RBAC, Users, Workflow). Every `...View` code is a read; no other
  registered code is read-like; `Export` is not registered anywhere today.
  A guard test now fails until any new read-verb code is classified
  deliberately, and every registered code must map to a module the signed
  license can entitle.
- **Printing has no independent permission** — `Print` is a document-lifecycle
  action with no RBAC code and no endpoint, so Read-Only neither blocks nor
  grants it; see the ADR-0049 addendum §2.
- **The HTTP path is now covered**: `authorization-readonly.spec.ts` adds cases
  for a principal who holds a mutation code in `READ_ONLY` (refused), an
  entitled read and a platform `Licensing.*` code (kept), an unentitled read
  (still refused), an entitled mutation in `GRACE` (allowed) and a `BLOCKED`
  license (platform-only).
- **Boundary and durability coverage was extended** in `license-grace.spec.ts`
  (336h across a DST transition, one instant expressed in two offsets, stable
  lexical ordering, unlicensed evaluation) and `licensing-grace.spec.ts`
  (fail-closed reads, renewal out of `READ_ONLY` with no cache, no sliding
  deadline across repeated evaluations or a fresh instance).

### Fixed

- **License gate rendered a raw Instant.** The Grace/Read-Only banner printed
  the ISO `graceEndsAt` wire value instead of using the shared date foundation
  (`docs/datetime.md`, AR-32). It now uses `formatDateTime`, is an accessible
  `role="status"` region, and has its first Grace/Read-Only tests (the two
  fixtures were previously unused). `scripts/check-date-contract.py` named five
  raw-Instant fields explicitly, which is why the defect escaped it; the
  pattern is now general (`*At` / `*Timestamp`) and covered by its own test.

### Open (not decided here)

The device lifecycle's interaction with Grace/Read-Only, OQ-76 and OQ-78 are
recorded with options and recommendations in
[the open decisions brief](licensing-open-decisions-brief.md). OQ-45 remains
**OPEN** for Product Owner acceptance and for the contract-termination
strictness question; no status changed in this round.
