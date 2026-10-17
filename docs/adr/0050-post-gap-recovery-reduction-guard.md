# ADR-0050: Measure reducing post-gap recoveries against lapsed coverage

Status: Proposed — implemented for Product Owner review
Date: 2026-10-17

## Context

PDR-13 §4.2 requires the §8.6 reduction guard on every recovery. The existing
continuation baseline requires an effective window to end exactly at the
candidate's `validFrom`; a post-gap recovery starts strictly after all retained
coverage, so that baseline is necessarily absent. A reducing recovery could
therefore bypass the check. The ordinary reduction-resolution route cannot
carry the recovery intent and rejects post-gap candidates, while the recovery
route previously had no resolution intent. See OQ-87, C10, and PDR-13 §8.

## Decision

1. Add `lapsedCoverageVersion`: return the retained version with the latest
   effective end, breaking ties by latest `importedAt` and then `versionId`.
   Return `null` if there is no retained version or if any effective window is
   perpetual. Refactor `lapsedLicenseContext` to use this helper without
   changing its existing receipt semantics.
2. Before overlap/precedence rules 4/5, measure an actual post-gap candidate on
   the dedicated recovery path against that lapsed version using
   `reductionConflicts`. A conflicting reduction is refused with the lapsed
   `predecessorVersionId` and structured conflicts unless the recovery operation
   also carries an explicit resolution reason. A supplied resolution requires
   `Licensing.License.Activate`,
   `Licensing.Installation.RecoverAfterGap`, and
   `Licensing.License.ResolveReduction`.
3. Commit the new version and both typed events — `license.import.recovered` and
   `license.import.reduction-resolved` — in the existing import transaction.
   The lapsed version is the resolution subject, but recovery retires no prior
   version: it is not superseded or stamped. A post-gap recovery document that
   declares a supersession target is refused as `recovery-not-applicable`.
4. Keep ordinary import and the separate reduction-resolution route unable to
   apply a post-gap candidate. Preserve renewal-gap precedence and all
   non-post-gap behavior. No schema or migration change is required. C11
   (interior/backdated gap-fill measurement) remains outside this decision.

This proposed decision selects the combined-operation option in the
2026-10-16 licensing brief §4. It does not select terminal refusal of reducing
recoveries, does not close OQ-87 or any other OQ, and remains subject to explicit
Product Owner review/acceptance.

## Consequences

- A recovery can reduce capacity or entitlements only after a reasoned,
  permission-checked resolution of the exact conflicts measured against the
  latest lapsed grant; usage-unavailable and other non-resolvable conflicts
  remain fail-closed.
- Audit and response receipts expose both the lapsed coverage facts and the
  resolved predecessor/conflicts without a second write pipeline.
- The recovery route's optional resolution field, operation-aware refusal
  messages, generated OpenAPI client, and domain/service/HTTP/live-PostgreSQL
  contract tests must evolve together.
- OQ-87 remains open pending acceptance; no other OQ is closed or changed.
