# OD-LIC-06 — renewal protocol and persistence design (PDR-18 §9 / OQ-88)

- **Date:** 2026-10-18
- **Author:** engineering (design only; Arena session on `arena/6d1ab4c5-vardena`)
- **Status:** **APPROVED AND IMPLEMENTED** — the Product Owner answered Q-1
  (`boundary`) and Q-2 (`coverage_end`) on 2026-10-19; see §16 for the
  implementation record (code, schema, migration, vectors, tests A1–A17). The
  design text below is the approved contract and is not rewritten by the
  implementation.
- **Decision source (binding, not reopened):**
  [PDR-18 §9 — renewal applies the Owner-authorized new end date](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md)
  (decision id **OD-LIC-06**, Product Owner approval 2026-10-18), registry row
  [OQ-88](../open-questions.md).
- **Baseline:** design work started from `main` @
  `8ee2bba99a63815e05ae4a279f2016f8e3610d2d` — the merge commit of
  PR [#175](https://github.com/MR-AliEsmaeili/Vardena/pull/175) (`state: MERGED`,
  `mergedAt: 2026-10-18T09:03:28Z`; preflight verified against that commit).
  `main` then advanced to `6d8a4f943e533fc6bc684927335bbc0182f509d5` (merge of PR
  [#176](https://github.com/MR-AliEsmaeili/Vardena/pull/176)), whose only changes are
  a comment in `license-version.ts`, new C11 policy verification tests and C11
  wording in `version-model-and-file-exchange.md` — **no behavior change**. Every
  file/line reference below was re-verified against `6d8a4f9`; domain symbols after
  the inserted comment block therefore sit 5 lines lower than in `8ee2bba`.
- **Related records:** [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md)
  §§3.1–3.4, 8.2–8.6, 9.2–9.3, 10.7, 12, 14 · [PDR-12](../decisions/product/PDR-12-license-term-supersession.md)
  (OD-LIC-01) · [PDR-13](../decisions/product/PDR-13-post-gap-recovery.md) (OD-LIC-02 / OD-LIC-05)
  · [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) · [PDR-15](../decisions/product/PDR-15-client-device-licensing-and-replacement.md)
  · [PDR-16](../decisions/product/PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md)
  · [ADR-0046](../adr/0046-signed-license-documents-and-version-lifecycle.md) · [ADR-0049](../adr/0049-license-grace-read-only-enforcement.md)
  · [ADR-0050](../adr/0050-post-gap-recovery-reduction-guard.md) ·
  [version model](../licensing/version-model-and-file-exchange.md) ·
  [canonical byte contract](../licensing/licensing-protocol-vectors.md) ·
  [OQ-81 replay design](oq-81-idempotent-replay-technical-design.md) ·
  [superseded four-option proposal](pdr-18-renewal-reissuance-flow-proposal.md)
  (technical evidence only — its options are **not** the approved policy).

## 0. How this document answers the ten design requirements

| # | Requirement | Section |
|---|---|---|
| 1 | Identity and binding, reconciled with the approved renewal identity rule | §3.5 |
| 2 | Signed payload for the Owner-authorized new end date | §3.1, §3.3 |
| 3 | Stopping `validFrom` from being the effective hand-over without weakening validation | §3.4 |
| 4 | Compatibility with already-signed VLIC2 artifacts and committed vectors | §10 |
| 5 | Retained history, deterministic resolution, single conflict authority | §3.7, §4.3 |
| 6 | PDR-11 §8.6 reduction controls | §3.8, §12 (A8) |
| 7 | Expiry, Grace, termination, cancellation/revocation, genuine post-gap recovery | §7 |
| 8 | Replay, audit, idempotency, atomic boundaries | §8 |
| 9 | Stable refusals with no partial state and no misleading success audit | §3.9, §8.4 |
| 10 | Schema change, existing records, deployment and rollback | §9 |

## 1. Preflight result

1. Remote `main` was fetched: `origin/main = 8ee2bba99a63815e05ae4a279f2016f8e3610d2d`.
2. PR #175 ("docs(licensing): record renewal end-date policy (OD-LIC-06)") is
   **MERGED** into `main`; its merge commit is exactly that SHA and is the
   commit this branch is based on. The prerequisite is satisfied; the work is
   **not** blocked.
3. Every document named by the task was read from that commit (PDR-18, the OQ-88
   registry row, ADR-0046 and its addenda, PDR-11, PDR-12, PDR-13, the
   superseded renewal proposal) together with the current implementation cited
   in §2. No claim below relies on an earlier conversation summary or on a
   stale implementation report.
4. Only lightweight inspection was performed (source reading, `grep`, link
   inventory). **No test suite, integration suite or E2E run was executed.**
5. While this design was being written, `main` advanced to
   `6d8a4f943e533fc6bc684927335bbc0182f509d5` (merge of PR #176, C11 policy
   verification). That merge changes comments, adds C11 verification tests and
   re-words one technical document; it changes **no behavior** this design depends
   on. The branch was moved onto that commit and every reference in §2 was
   re-checked there, so the references below are valid against current `main`.

## 2. Verified current behavior

Every row was read from the baseline commit. Line numbers are the current ones.

| # | Verified fact | Evidence |
|---|---|---|
| B1 | The signed `VLIC2` payload is a flat record; canonical serialization emits a **fixed key order** (`v`, `kind`, `operationId`, `licenseId`, `customerId`, `customerCode`, `customerName`, `installationId`, `status`, `validFrom`, `validUntil`, `organizationLimit`, `userLimit`, [`deviceLimit`], `modules`, `features`, `supersedesOperationId`, `issuedAt`) and verification re-canonicalizes and requires byte equality. An unknown payload key therefore fails as `payload` (422) instead of being ignored. | `backend/src/modules/licensing/domain/license-document.ts:231-285` (`WirePayloadV2`, `canonicalizeLicenseVersion`), `:414-499` (`parseLicenseDocument`, canonical round-trip), `:501-600` (`readLicenseVersionPayload`) |
| B2 | `VLIC2` already has one **optional-by-omission** signed field: `deviceLimit` is emitted only when `deviceLimitSpecified` is true, and legacy artifacts that omit it stay verifiable. This is the established precedent for an additive optional field and for keeping old bytes byte-identical. | `license-document.ts:269-271`, `:520-524`; ADR-0046 addendum (2026-10-15, OQ-83); PDR-16 D-2(b) |
| B3 | Payload validation checks only `validUntil > validFrom`, identity shape, limits, entitlement codes and self-supersession. **Nothing relates `validFrom` to `issuedAt`**, and the signer and verifier share one function, so a future-dated or back-dated start is structurally signable today. | `license-document.ts:671-760` (`assertLicenseVersionPayload`); `docs/tasks/pdr-18-renewal-reissuance-flow-proposal.md` V2 |
| B4 | The retained version has **no `issuedAt`**, and precedence is `validFrom` → `importedAt` → `versionId`. The import instant never promotes a version. | `backend/src/modules/licensing/domain/license-version.ts:138-178` (`RetainedLicenseVersion`), `:2000-2009` (`compareByStartThenImport`) |
| B5 | Effective-version resolution reads only `validFrom`/`validUntil` (through `covers`) plus eligibility from `governsUntil`. There is exactly **one start instant per version**. | `license-version.ts:327-341` (`covers`), `:811-886` (`resolveEffectiveVersion`) |
| B6 | A successor's hand-over instant is **its own `validFrom`**: `supersessionCeaseInstant(candidate) = candidate.validFrom`, persisted as the predecessor's `governs_until`. | `license-version.ts:276-288`; `backend/src/modules/licensing/data/licenses.repository.ts:1118-1145` |
| B7 | A signed document that starts later than exactly one still-governing version it overlaps **takes it over at its own `validFrom`** (OQ-80 Option B). This is the path an early renewal would take today, and it truncates the remaining paid term instead of extending it. It is pinned by existing unit tests that must keep passing (a non-renewal document keeps this shape): the OQ-80 Option B test and the C11 verification block added by PR #176, which explicitly accepts an interior candidate through this same rule-5 hand-over. | `license-version.ts` rule 5 in `evaluateImportConflicts` (`:1280`, `target === null` branch); `license-version.spec.ts:537` “hands over to a later-starting version under the precedence rule (OQ-80 Option B)”, `:1439-1567` C11 policy block |
| B8 | An explicit `supersedesOperationId` hands over at the same instant (`candidate.validFrom`) and refuses only when it would **remove** governance already exercised before the import (`backdated-supersession`). Retiring a version at its own end removes nothing and is therefore allowed. | `license-version.ts:309-325` (`supersessionRewritesPastGovernance`), rule 6 |
| B9 | The gap rule uses `candidate.validFrom` against that **license's** retained coverage end (`renewal-gap`), and the post-gap rule uses `candidate.validFrom` plus `hasRetainedLicense(candidate.licenseId)` (a changed `licenseId` is treated as a new identity). Both are pure window-start rules. | `license-version.ts:1770-1777` (`leavesRenewalGap`), `:505-513` (`isPostGapRecoveryCandidate`), `:401-423` (`retainedCoverageEnd`, `hasRetainedLicense`) |
| B10 | The §8.6 guard covers **every** path that retires a version: capacity/entitlement conflicts are measured against counted usage inside the transaction (fail closed on unknown usage), the open end is closable only by a document that names the version it retires (PDR-12), and a supplied resolution that meets no conflict is refused. A candidate that retires nothing is measured against the deterministic continuation baseline. | `license-version.ts:547-760` (`reducesCapacityOrEntitlements`, `reductionConflicts`), `:1098-1185` (`continuationBaselineFor`), `:1709-1777` (`evaluateReductionContinuation`), `:1791-1832` (`evaluateReductionHandOver`) |
| B11 | Binding is enforced three times: the payload must name **this** installation, the customer/customer-code must match the persisted and installation-bound customer, and a `licenseId` retained under another customer or installation is refused (`license-binding-conflict`). The license row is claimed by a plain `INSERT`, never an upsert. | `backend/src/modules/licensing/application/license-import.service.ts:521-560`; `license-version.ts` rules 2a/2b; `licenses.repository.ts:880-905`, `:950-990` |
| B12 | Versions are immutable except for the supersession triple; `valid_from` and `valid_until` are written once and never updated. | `licenses.repository.ts:1089-1145`; ADR-0046 Decision 2 |
| B13 | Runtime enforcement reads the **governing version's** dates: `toInstallationLicense` copies `validFrom`/`validUntil`, and `evaluateLicense` derives active/expired/not-yet-valid and the 14×24 h UTC Grace from them. Grace is computed, never stored. | `license-version.ts:1923-1943`; `backend/src/modules/licensing/domain/license.ts:17`, `:99-130` |
| B14 | The state response exposes `validUntil` (governing version), `effectiveVersionId`, `scheduledVersion` (“earliest retained version not effective yet”, computed as `validFrom > at`) and a bounded history. The history exposes neither the signed `operationId` nor any second start instant. | `backend/src/modules/licensing/api/license-state.view.ts`; `license-version.ts:1953-1988` (`LicenseVersionSummary`, `toLicenseVersionSummary`), `:777-788` (`findScheduledVersion`); `backend/src/modules/licensing/api/dto/license.dto.ts:329-381` |
| B15 | Replay protection is `(installation_id, operation_id)` and `(installation_id, document_hash)` uniqueness. A duplicate is refused as `duplicate-operation` (409) and **no historical receipt is stored or returned** — the approved PDR-18 §5 receipt contract is still unimplemented. | `backend/prisma/schema/licensing.prisma:172-173`; `backend/prisma/migrations/20261014000000_licensing_version_model_and_import/migration.sql:74-95`; `license-import.service.ts:197-215`; `docs/tasks/oq-81-idempotent-replay-technical-design.md` §1 |
| B16 | Success audit is typed and written **inside** the state-change transaction (`license.import.applied`, `license.version.superseded`); refusals write a separate best-effort `license.import.rejected` row and never an APPLIED row. | `licenses.repository.ts:1010-1185`, `:1199-1229`; `license-import.service.ts:1001-1200` |
| B17 | The legacy `VLIC1` path has no operation id (its identity is hash-derived) and cannot express a supersession or any new signing capability. | `license-import.service.ts:764-1000` |
| B18 | The committed conformance corpus is 22 vector files, and PDR-16 binds: no `VLIC3`, no change to existing signed bytes, no reinterpretation of an existing field, no invalidated artifact. | `docs/licensing/vectors/`; `backend/src/modules/licensing/domain/licensing-protocol-vectors.spec.ts`; PDR-16 “Compatibility and security constraints (binding)” |

### 2.1 What cannot be expressed today

The approved outcome needs four things the current model does not have:

1. **A signed way to say “this document renews that retained version.”** `licenseId` reuse is
   neither required nor sufficient — the Product Owner explicitly removed the
   “preserve the previous `licenseId`” requirement on 2026-10-13 (PDR-11 Q3
   addendum) and forbade adding `--license-id` merely to force reuse.
2. **A second start instant.** Every version has exactly one start (`validFrom`), and
   both the explicit-supersession and the later-start precedence path end the
   predecessor *at that instant*. An early renewal therefore absorbs the term the
   customer already paid for (B7/B8).
3. **A hand-over instant that is not the renewal's `validFrom`.** That value is the
   issuance day under PDR-18 §1.2, so it cannot also be the term boundary.
4. **A term-level expiry that reflects a scheduled renewal.** `validUntil` is the
   governing version's end; after an early import the license's real expiry is later
   than that field.

The design must add these without turning a renewal into “an arbitrary new license
that overrides retained versions”.

## 3. Proposed protocol

### 3.1 The signed renewal reference (one additive optional field)

A renewal is a normal `VLIC2` document that additionally carries:

```json
"renewsOperationId": "01J9Z6Q2R7K3M4N5P6Q7R8S9T0"
```

- **Signed and covered by the signature**, exactly like every other payload field.
  It is emitted in canonical order between `supersedesOperationId` and `issuedAt`.
- **Omitted when absent**, like `deviceLimit` (B2). A payload without it serializes
  to **byte-identical** bytes, so every already-signed artifact, every committed
  vector and every existing signature keeps verifying unchanged (§10).
- **Mutually exclusive with `supersedesOperationId`.** A document is either a
  renewal (extends a named version and never overrides it) or a supersession
  (replaces a named version from its own start). Encoding both is a payload defect
  (`payload`, 422) — there is no precedence rule between them.
- **Must differ from the document's own `operationId`** (same self-reference rule as
  a supersession).
- **Never inferred.** The server never decides “this looks like a renewal” from
  dates, `licenseId`, an endpoint or an operator flag. A document without the field
  keeps exactly today's semantics; a document with it is a renewal on every route.

Wire shape of a renewal (only the new key is added; every other value is a normal
signed fact):

```text
v, kind, operationId, licenseId, customerId, customerCode, customerName,
installationId, status, validFrom, validUntil, organizationLimit, userLimit,
[deviceLimit], modules, features, supersedesOperationId=null,
renewsOperationId="<operationId of the retained version being renewed>", issuedAt
```

Issuance gains one CLI option (`--renews <operationId>`) and one invariant: a
document that carries `renewsOperationId` may not also carry `--supersedes`, and a
renewal may not be issued for a version the issuer does not mean to extend.

### 3.2 The effective-start rule (the core of the design)

> **A renewal starts governing at the instant the version it renews stops
> governing — never at its own `validFrom`.**

For a renewal `R` of retained version `T`:

```text
governsFrom(R) = effectiveWindow(T).end          (the renewed term boundary)
effectiveWindow(R) = [governsFrom(R), min(validUntil(R), governsUntil(R)))
```

`validFrom(R)` — the signed issuance-day fact — is retained and displayed but is
**not** an input to precedence, overlap, gap, Grace or enforcement.

Consequences, stated explicitly:

- `T` keeps governing until its own end. Nothing is truncated, restarted or
  stacked; `T`'s effective window is unchanged (`governsUntil(T) = T`'s own end).
- `R` governs exactly the renewed term `[T.end, R.validUntil)`.
- The two effective windows are **adjacent and disjoint**, so the invariant “at most
  one version governs any instant” holds by construction (ADR-0046 Decision 4).
- The term boundary is derived **only from signed facts** (T's signed end). The
  import instant (`now`) is never used as a start, so clock skew cannot shift a
  term — a property the current model already has for `governsUntil` and that this
  design preserves.

Persisted as one new nullable instant on the renewal row: **`governs_from`**. It is
the symmetric counterpart of the existing `governs_until` (which already exists for
exactly this reason: “recorded at” is not “governing until”). `NULL` means “the
signed `validFrom`” and is the value of every existing row, so no existing record
changes meaning.

### 3.3 How the new end date is represented, signed and validated

- **Representation:** the Owner-authorized end date is the renewal's own signed
  `validUntil` — no new date field, no derived arithmetic, no “+1 year” policy. It
  is applied **exactly**, with no clamping: `governsFrom(R) = T.end` and
  `R` expires at `validUntil(R)`.
- **Signature:** it is already inside the canonical payload and therefore already
  covered by Ed25519; the new reference is covered by the same signature. There is
  no second signature scheme and no new canonicalizer.
- **Validation (payload level, shared by signing and verification):** the existing
  `validUntil > validFrom` rule stands; for a renewal, additionally
  `validFrom(R) <= issuedAt(R)` (PDR-18 §1.2: the activation-validity start is the
  issuance day, never later). This check only ever runs when `renewsOperationId` is
  present, so no existing artifact is affected.
- **Validation (state level, inside the conflict authority):** `validUntil(R)` must
  be strictly later than `T`'s effective end, or `null` (perpetual — an extension,
  explicitly allowed on every path by PDR-12 §3). Equal or earlier is refused
  (`renewal-not-an-extension`, 422): a renewal never shortens a term.
- **No unsigned metadata is trusted.** The file envelope's `keyId` remains a filter
  against the trust list only; the API never accepts “renewal: true”, a target id, a
  license id or a date from the caller; and there is no server-side “make this row a
  renewal” operation.

### 3.4 `validFrom` without weakening any validation

Three separate questions must not be conflated:

| Question | Answer under this design |
|---|---|
| Is `validFrom` still parsed, signed, round-tripped and required? | **Yes, unchanged.** It remains a mandatory signed field, part of the canonical bytes and part of the document hash. |
| Is any existing validity guarantee relaxed? | **No.** `validUntil > validFrom` is unchanged, status/limit/entitlement validation is unchanged, the signature check is unchanged, canonical-form equality is unchanged, and installation/customer binding is unchanged. |
| Which instant governs? | A **new, derived, persisted** instant (`governs_from`) that is a function of signed facts. It is not a relaxation: it is an additional constraint (`governsFrom < validUntil`, and for a renewal `governsFrom = the renewed version's end`). |

The verifier deliberately does **not** gain a “reject a future or past `validFrom`”
rule. That rule would invalidate already-signed artifacts and the committed vectors
(the exact reason the PDR-18 §1 slice added none — L-18.7), and it is unnecessary:
the renewal relation is what stops `validFrom` from being the hand-over, and it is
expressed in signed data.

### 3.5 Identity and binding (requirement 1)

A renewal is bound by **signed facts plus persisted-state checks**, never by
inference:

| Dimension | Binding | Failure |
|---|---|---|
| Installation | `payload.installationId` must equal this installation's existing identity (never created by an import) | `installation-mismatch` (422) |
| Customer | `payload.customerId` must equal the installation's bound customer; a renewal is not a transfer. A renewal naming a different customer cannot name the target of the old customer (`renewal-target-unknown`); a transfer intent that names the *same* customer is the existing `transfer-requires-different-customer` | `installation-customer-mismatch` (409) / `renewal-target-unknown` (409) / `transfer-requires-different-customer` (409) |
| Customer code | `payload.customerCode` must match the persisted customer record and must not collide | `customer-code-mismatch` (409) |
| Commercial license identity | If `payload.licenseId` is already retained, it must belong to this installation **and** this customer | `license-binding-conflict` (409) |
| **The version being renewed** | `renewsOperationId` must name a retained version of **this installation**, carrying the same customer and customer code | `renewal-target-unknown` (409) |
| The position in the term chain | the named version must be the **last version of the installation's unbroken coverage chain** (§3.6) | `renewal-target-not-current` (409) |
| The term | the named version must be time-limited (`validUntil != null`) so a hand-over instant exists | `renewal-target-perpetual` (409) |

**Reconciliation with the approved renewal identity rule.** On 2026-10-13 the
Product Owner removed “preserve the previous `licenseId` during renewal” as a
product requirement (PDR-11 Q3 addendum): a changed `licenseId` is allowed and must
not bypass customer binding, installation binding, retained history, precedence,
reduction controls, replay protection or audit. This design honors that exactly:

- The chain edge is the **signed operation reference**, not the identifier. A
  renewal may therefore carry the same `licenseId` (no new license row; the common
  case) **or** a new one (a new `licensing.licenses` row on the same
  installation + customer, created by the existing race-safe insert).
- A changed `licenseId` gains **no** shortcut: the target must still be the current
  coverage tail, the §8.6 guard still compares the renewal's grant against that
  target, and the audit records the identity before and after.
- Nothing in this design mints, invents or silently adopts an identity. The server
  never generates a `licenseId`; the signed document always states it.
- A document that changes `licenseId` **without** `renewsOperationId` is not a
  renewal and keeps today's rules (overlap/gap/post-gap), which is what makes
  “arbitrary new license” behavior impossible.

### 3.6 Deterministic target selection

The named target must be the **tail of the installation's unbroken coverage chain**
at the import instant. The helper is deterministic and reuses the existing
resolution:

```text
coverageChain(versions, at):
  r = resolveEffectiveVersion(versions, at)
  if r.version == null -> []
  chain = [r.version]
  loop:
    end = effectiveWindow(chain.last).end
    if end == null: break                                   # perpetual tail
    next = eligible versions whose windowStart == end
    if next == [exactly one] and it is not already in chain: append; continue
    break                                                   # gap, or ambiguity (logged)
  return chain
```

- `tail = coverageChain(...).last`, and `continuousCoverageEnd = effectiveWindow(tail).end`.
- A renewal must name `tail`. This refuses **stale** targets (an old version that
  was already extended), **interior** targets (an earlier term, i.e. backdated
  gap-filling — no C11 path), and **already-renewed** targets.
- It also makes a **double extension impossible even with a fresh operation id**:
  once `R1` extends the chain, the tail is `R1`; a second renewal naming `T` is
  `renewal-target-not-current`. Idempotency therefore does not depend on the
  operation-id check alone.
- Chains of renewals work naturally: `R2` renews `R1`, `governsFrom(R2) = R1.end`.
- If the chain is ambiguous (a corrupted retained set that reports two covering
  versions), the target is refused and the existing integrity warning is logged;
  nothing new is resolved by guessing.
- The target's own `status` is not part of this selection (it is not part of
  supersession-target eligibility today either); the **renewal's** signed status
  must still be `ACTIVE`, exactly as for any import.

### 3.7 Rule-by-rule evaluation (the single authority)

The change lives **inside `evaluateImportConflicts`**; no second evaluator, endpoint
or service-side rule is added. `ImportSupersessionIntent` gains one variant:

```ts
| { kind: 'renewal'; operationId: string }
```

Evaluation order (the order matters and is part of the design):

1. duplicate operation id / duplicate document hash — unchanged;
2. `licenseId`-customer binding and customer-code checks — unchanged;
3. customer-transfer applicability — unchanged;
4. **renewal resolution (new, before the recovery/gap blocks):** resolve the named
   target with the same machinery as an explicit supersession
   (`findVersionByOperationId`, eligibility, no recorded supersession, the
   installation's own retained rows), then apply the three renewal-only checks (tail
   position, time-limited term, extends the end) and derive
   `effectiveStart = effectiveWindow(target).end`. Refuse on failure. A renewal is
   never a recovery: `gapRecovery != null` with a renewal document is
   `recovery-not-applicable`; and it is never a transfer (§3.5);
5. post-gap recovery applicability — now evaluated against the **effective start**,
   so a renewal can never be classified as post-gap (`effectiveStart == coverage
   end`, not after it);
6. explicit-supersession target resolution — unchanged for `kind: 'explicit'`;
7. overlap (rule 4): the candidate's **effective** window
   `[effectiveStart, validUntil)` must not intersect any retained effective window
   and must be sanctioned by exactly the one named target. A renewal's effective
   window starts where the target ends, so the target itself is never an overlap and
   any *other* overlap is still `overlapping-range`;
8. backdated check (rule 6): `supersessionRewritesPastGovernance(target, effectiveStart, at)` —
   for a renewal this is provably false (the hand-over is the target's own end, so
   nothing is removed); the call stays as defence in depth;
9. §8.6 guard (rule 6b): the renewal **retires the target**, so the capacity/
   entitlement check runs against that target with counted usage under the locks.
   Rule 6c is not reached (a renewal always has a predecessor), so there is no
   double measurement and no second resolution subject;
10. gap rule (rule 7): measured on `effectiveStart`, which equals the retained
    coverage end → structurally no gap (`renewal-gap` cannot fire for a renewal);
11. post-gap guard (rule 7b): measured on `effectiveStart` → not a post-gap
    candidate;
12. `resolution-not-applicable` logic — unchanged;
13. success returns `supersedes = target` (so the transaction stamps exactly the
    version the pre-check resolved) **plus** the resolved instant:
    `renewal: { renewedVersionId, governsFrom }`.

Both passes (read-side pre-check and in-transaction authoritative pass) call this
same function with the same inputs, so they cannot drift.

### 3.8 Reduction controls (requirement 6, unchanged policy)

- The renewal's grant is compared with the **target's** grant, per dimension, against
  current organization/user/device usage (fail closed when a count is unavailable):
  lower finite limits below usage, or a removed entitlement → `reduction-requires-resolution`
  (409) with the concrete conflicts and the target named, **nothing written**.
- An authorized resolution through the existing dedicated operation still applies
  the document and the resolution in one transaction, audits the recomputed
  conflicts against the target, and never stamps the target for the resolution's
  sake (it is stamped because it is the renewal's predecessor).
- The open-end arm cannot arise: a perpetual target is refused earlier
  (`renewal-target-perpetual`) because there is no hand-over instant. A
  perpetual → time-limited change therefore stays on the explicit-supersession path
  that PDR-12/OD-LIC-01 authorizes, and a renewal cannot be used to shorten a
  perpetual grant.
- A renewal that increases or keeps limits needs no resolution. Increases take
  effect with the renewed term (§13, question Q-1) — they are never silently applied
  to the current term.

### 3.9 Stable refusals

| Reason | HTTP | Meaning | Writes |
|---|---|---|---|
| `renewal-target-unknown` | 409 | The named operation id is not retained for this installation, names another customer, or already carries a recorded supersession (already renewed/replaced) | nothing |
| `renewal-target-not-current` | 409 | The named version is not the tail of the unbroken coverage chain (stale, interior or already extended) | nothing |
| `renewal-target-perpetual` | 409 | The named version never ends; there is no term boundary to hand over at | nothing |
| `renewal-not-an-extension` | 422 | The signed end is equal to or earlier than the target's effective end | nothing |
| `payload` (existing) | 422 | `renewsOperationId` malformed, self-referencing, or combined with `supersedesOperationId`; `validFrom > issuedAt` | nothing |
| `duplicate-operation` (existing) | 409 | Same operation id or same artifact bytes | nothing |
| `installation-mismatch`, `customer-code-mismatch`, `installation-customer-mismatch`, `license-binding-conflict` (existing) | 422 / 409 | Binding refusals, unchanged | nothing |
| `overlapping-range`, `reduction-requires-resolution`, `resolution-not-applicable`, `recovery-not-applicable` (existing) | 409 | Unchanged | nothing |

`renewal-not-an-extension` is a **document** defect (a re-issued document with a
later end is the fix), so it is 422 like `expired-document`; the target/state
refusals are 409 like the other retained-state conflicts. No new reason is added for
the dedicated operations: a renewal submitted to recovery is
`recovery-not-applicable`; a resolution with no conflict is
`resolution-not-applicable`.

## 4. Persistence and transaction

### 4.1 The only schema change

One nullable column and one check constraint on `licensing.license_versions`:

```sql
ALTER TABLE "licensing"."license_versions"
  ADD COLUMN "governs_from" TIMESTAMPTZ(6);

ALTER TABLE "licensing"."license_versions"
  ADD CONSTRAINT "license_versions_governs_from_check"
  CHECK (
    "governs_from" IS NULL
    OR (
      "supersedes_version_id" IS NOT NULL
      AND ("valid_until" IS NULL OR "governs_from" < "valid_until")
    )
  );

COMMENT ON COLUMN "licensing"."license_versions"."governs_from" IS
  'Instant from which this version starts governing when it differs from the signed valid_from (a renewal: the renewed term boundary). NULL = signed valid_from.';
```

- **No row is backfilled.** `NULL` is defined as “the signed `validFrom`”, so every
  existing row keeps its exact window and every as-of read is unchanged.
- The constraint is local and cheap: a deferred start exists only on a row that also
  names the version it renews (written in the same transaction), and it must precede
  the signed end.
- No index is added: versions are read per installation, and nothing queries
  `governs_from` as a key.
- Prisma: `governsFrom DateTime? @map("governs_from") @db.Timestamptz(6)` with the
  same doc comment.
- The renewal's **signed** `renewsOperationId` is not persisted as a separate column.
  The chain edge already exists as `supersedes_version_id` (the target), and
  `governs_from IS NOT NULL` is the renewal discriminator. Nothing else is needed
  for history, replay or reconstruction.

Rejected persistence alternatives:

- **Update `valid_until` on the existing row.** Destroys the record of what was
  signed, breaks the artifact-hash/operation integrity the model depends on,
  rewrites as-of history and makes the retained row unable to answer “what did the
  Owner actually sign?”. Explicitly refused by PDR-18 §9.
- **A second table (`license_version_renewals`).** More moving parts (a second
  uniqueness domain, a second audit source, joins in every read path) for a single
  instant that the version row can carry.
- **Derive `governsFrom` at read time from `supersedes_version_id`.** Possible in
  principle, but it makes every read depend on a chain walk and repeats the reason
  `governs_until` was persisted rather than derived (migration-ambiguity). It would
  also make the instant invisible to the audit trail.

### 4.2 Domain changes (no behavior change for existing documents)

- `RetainedLicenseVersion` gains `governsFrom: Date | null`; `windowStart(v)` is the
  single accessor (`v.governsFrom ?? v.validFrom`).
- `effectiveWindow`, `covers`, `compareByStartThenImport`, `findScheduledVersion`,
  `supersessionCeaseInstant` and the coverage-chain helper all read `windowStart`.
- `ImportCandidate` gains `effectiveStart?: Date` — a **derived** value the authority
  sets on a local copy for a renewal (the resolved target's end); every window rule
  (overlap, gap, post-gap, backdated, baseline) uses
  `candidate.effectiveStart ?? candidate.validFrom`. The signed field keeps its
  meaning; the derived start is explicit and local, and no caller supplies it.
- `ImportConflictEvaluation` success arm gains
  `renewal: { renewedVersionId: string; governsFrom: Date } | null`.
- `ImportLicenseVersionCommand` gains `governsFrom: Date | null`; `importVersion`
  writes it on the new row and uses it as the predecessor's `governs_until`
  (`command.governsFrom ?? command.validFrom`), so the stamp and the new row can
  never disagree.
- `LicenseVersionSummary` gains `operationId` (the signed identity the Owner must
  name) and `effectiveFrom` (always populated). `LicenseStateView` gains
  `coverageEnd` (the continuous coverage end, §6).

### 4.3 Transaction steps (one transaction, unchanged boundaries)

1. `SELECT … FOR UPDATE` on the installation row (serializes imports per
   installation; holds across processes).
2. Take the licensed-allocation advisory locks and read the §8.6 usage snapshot.
3. Read the retained versions (now including `governs_from`) and the customer rows.
4. Run `evaluateImportConflicts` **under the lock** (authoritative).
5. Verify the resolved target equals the one the pre-check named
   (`expectedSupersessionVersionId`), and that the in-transaction evaluation
   derived the same `governsFrom` the command carries; otherwise refuse. The stamp
   and the new row therefore cannot disagree with the authoritative evaluation.
6. Verify/claim the `licensing.licenses` row for the (possibly new) `licenseId`; the
   primary key arbitrates a concurrent claim.
7. Insert the new version with `governs_from`, its entitlements and its import facts.
8. Stamp the target: `superseded_at = now`, `governs_until = governsFrom`
   (= the target's own end, so nothing is shortened), `superseded_by_version_id`.
9. Insert the typed audit rows (renewal + superseded; plus the resolution event when
   one was consumed).
10. Commit. The HTTP layer then performs a **fresh canonical read** for the response
    (existing behavior: a successful import is not itself a license state).

Any failure before step 10 leaves no version, no stamp, no entitlement and no
APPLIED audit row.

### 4.4 Concurrency

- Two concurrent renewals of the same target: both may pass the read-side pre-check;
  the second re-evaluates under the lock and is refused
  (`renewal-target-unknown` — the target now has a recorded supersession, or
  `renewal-target-not-current` — the tail moved). Nothing is written.
- A renewal racing a different import that changes the chain tail: the loser is
  refused by the tail check, not silently applied to a moved term.
- A renewal racing a usage change: the §8.6 snapshot is taken under the same locks
  the allocation paths hold, so the verdict matches the committed state.
- Lock wait timeout remains an operational server error, not a license conflict
  (unchanged).

## 5. Before / after state transition

Illustrative instants stand for the Product Owner's example (today = day 20, current
expiry = day 30):

```text
D20 = 2026-11-10T00:00:00.000Z   (import day)
D30 = 2026-11-20T00:00:00.000Z   (current signed expiry)
D40 = 2026-11-30T00:00:00.000Z   (new Owner-signed expiry)
```

### 5.1 Before (current code) — two shapes, both wrong

| Shape | What happens | Why it fails OD-LIC-06 |
|---|---|---|
| Renewal signed with `validFrom = D20`, `validUntil = D40`, same `licenseId`, no renewal field | Rule 5 (OQ-80 Option B): the candidate starts *inside* the governing window, so the current version is retired at `D20` and the renewal governs `[D20, D40)`. | The paid term `[D20, D30)` is **absorbed into** the new window instead of being carried into the renewed term: coverage still reaches `D40`, but a renewal priced from the purchase day (e.g. “one year from D20”) silently gives 10 days less than “one year from the current expiry”. The current validity window is replaced early, which is exactly what OD-LIC-06 forbids. |
| Renewal signed with `validFrom = D30` (adjacency) | Imports cleanly; the renewal governs `[D30, D40)`. | The document's activation-validity start is not the issuance day, contradicting PDR-18 §1.2, and the Owner must reproduce the exact current expiry instant — the ambiguity OQ-88 recorded. |

There is no third shape: a document cannot say “renew *that* version”, and the model
has no second start instant (B4–B8).

### 5.2 After (this design)

Import at `D20` of a `VLIC2` document with `renewsOperationId = T.operationId`,
`validFrom = D20`, `validUntil = D40`:

```text
T:  validFrom D10 ................ validUntil D30   governsUntil D30   (unchanged window)
R:                 governsFrom D30 ............... validUntil D40
                   signed validFrom D20
```

| Instant | Effective version | Governing window | `active` / `accessMode` | Reported `validUntil` (version) | Reported `coverageEnd` |
|---|---|---|---|---|---|
| `D20 − 1h` before import | `T` | `[D10, D30)` | `true` / `ACTIVE` | `D30` | `D30` |
| `D20` immediately after import | `T` | `[D10, D30)` | `true` / `ACTIVE` | `D30` | **`D40`** |
| `D29T23:59:59.999Z` | `T` | `[D10, D30)` | `true` / `ACTIVE` | `D30` | `D40` |
| `D30` (the boundary) | `R` | `[D30, D40)` | `true` / `ACTIVE` — **no Grace** | `D40` | `D40` |
| `D39T23:59:59.999Z` | `R` | `[D30, D40)` | `true` / `ACTIVE` | `D40` | `D40` |
| `D40` | `R` | ended | `false` / `GRACE` until `D40 + 14d`, then `READ_ONLY` | `D40` | `D40` |

So: continuity holds (no gap, no restart), the expiry the customer sees is the
Owner-signed `D40` from the moment the renewal is applied, and no instant is
governed twice.

### 5.3 A rejected transition

`R.validUntil = D30` (or earlier) over a target ending `D30`: refused with
`renewal-not-an-extension` (422) — no version row, no stamp, no audit success. The
target's window and the license state are exactly as before the attempt.

## 6. Read model and reporting

- `validUntil` keeps its current meaning and its current consumers: the **governing
  version's** signed end. `evaluateLicense`, `accessMode` and `graceEndsAt` are
  therefore untouched — Grace can never be computed from a window that does not
  govern.
- **`coverageEnd`** is added to the license state: the end of the unbroken coverage
  chain that starts at the effective version (§3.6). It is `null` for a perpetual
  chain or an unlicensed installation. Immediately after an early renewal it is the
  new signed end date — the observable the decision requires — without changing
  enforcement.
- **`operationId` and `effectiveFrom`** are added to each version summary. The
  `operationId` is required so the Owner can name the target when issuing the next
  renewal (`renewsOperationId`); it is not a secret (it is inside the signed
  artifact), and exposure is authenticated.
- `scheduledVersion` becomes correct for renewals: it is selected by
  `windowStart > at`, so an early renewal appears as scheduled even though its
  signed `validFrom` is already in the past.
- The history stays bounded at 20 entries; nothing is deleted.

## 7. Expiry, Grace, recovery and the other lifecycle paths

### 7.1 Natural expiry and Grace

Unchanged for every license without a renewal. With an early renewal, coverage never
ends at the old boundary, so no Grace period is entered at all: at `T.end` the
effective version simply becomes `R`. If `R` later ends, Grace is computed from
`R.validUntil + 14 × 24 h` (UTC) exactly as today. Grace remains a derived value
(`graceEndsAtFor`), never stored and never mutated by an import.

### 7.2 Late renewal (import after the old end)

- The effective start is still `T.end` (signed fact), so coverage is continuous from
  the old end and the license becomes ACTIVE at the import instant. This is the
  **existing** behavior of a contiguous renewal and the PDR-11 §9.3 restoration
  rule (“accept a valid renewal and restore normal operation”), not a new recovery
  path.
- It is not post-gap recovery: the chain edge is signed and
  `effectiveStart == coverage end` (never after it), so the post-gap test — which
  asks whether a **new** identity starts after the lapse — is false even when the
  Owner chose a new `licenseId`. It cannot carry a recovery intent, and the recovery
  operation refuses a renewal document.
- As-of reads before the import obviously could not see the renewal; after the
  import they recompute deterministically from the retained rows (PDR-11: as-of
  reads are a recomputation). No *existing* coverage is removed.

### 7.3 Genuine lapse and post-gap recovery

Unchanged. A **new license identity** starting after the installation's coverage
ended still requires the dedicated, permission-gated, reasoned, audited recovery
operation (PDR-13). A renewal can never be that operation: it retires a version, it
carries the same customer and installation binding, and its effective start is the
target's end. Conversely, a recovery document may not carry `renewsOperationId`
(`recovery-not-applicable`). PDR-13's 409/422 contract and its L-07 reduction
measurement are untouched.

### 7.4 Contract termination, cancellation and revocation

These are **not implemented** (PDR-18 §4 records the policy; the instruments are
open under OQ-78). The design fixes the boundary now so a future implementation
cannot accidentally make renewal a bypass:

- A renewal extends **validity only**. It must never clear an independent
  restriction — contract termination, intentional cancellation, ordinary or
  emergency revocation, or an emergency recovery restriction — consistent with
  PDR-11 §9.2/§12.8 (“ordinary renewal, clock repair and restart cannot clear
  independent reasons”).
- The future termination/revocation state is license-level and is evaluated
  independently of the validity window, before/alongside `evaluateLicense`. A renewal
  on a terminated/revoked license must be refused once that state exists; the reason
  name will be allocated then, not invented here.
- No claim is made that any of this is implemented.

## 8. Replay, audit and failure behavior

### 8.1 Idempotency

- Identity remains `(installationId, operationId)` and `(installationId,
  documentHash)`; a renewal is an ordinary import operation, so it inherits both.
- A replay never applies the renewal twice: the operation/hash uniqueness refuses it,
  **and** the tail rule independently refuses a second application under a fresh
  operation id (§3.6).
- Until the OQ-81 receipt contract is implemented, a duplicate stays the documented
  `duplicate-operation` 409 with nothing written (current behavior, B15). This design
  does not invent a second replay mechanism.

### 8.2 Historical result vs current state (PDR-18 §5)

When the OQ-81 receipt lands, a renewal replay must return, from the committed rows
and the typed event:

```text
operationId, outcome = APPLIED, changed = true,
renewedVersionId, renewedOperationId, previousValidUntil (target's signed end),
renewalValidUntil (signed new end), governsFrom, licenseId, previousLicenseId (when the
identity changed), importedAt, source, replay = true
```

…and the **current** license state separately (the existing controller already
performs a fresh canonical read). A replay must never re-run admission checks,
re-stamp the predecessor, or re-apply the term; nor may it present the historical
receipt as the current state.

### 8.3 Audit events (all inside the state-change transaction)

| Event | When | Key fields |
|---|---|---|
| `license.import.renewed` (APPLIED, new) | every applied renewal | `installationId`, `operationId`, `licenseId`, `versionId` (the renewal), `documentHash`, the verifying `keyId`, `source`, `actorId`, `occurredAt`, detail naming the terms |
| `license.version.superseded` (existing) | the target's retirement | the target's `versionId`/`operationId`, the successor, detail “renewed; governance ends at the renewed term boundary” |
| `license.import.reduction-resolved` (existing) | only when a resolution was consumed | the recomputed conflicts against the target |
| `license.import.rejected` (existing, separate best-effort path) | every refusal | bounded `reason`, no state, no APPLIED row |

New nullable audit columns (following the `previous_license_id` precedent, so the
renewal story is queryable without parsing text): `renewed_version_id`,
`renewed_from` (the hand-over instant), `renewed_until` (the signed new end).
`previous_license_id` is reused for a changed identity, with its column comment
extended.

### 8.4 Failure behavior

- Every refusal in §3.9 writes **nothing** to `licenses`, `license_versions`,
  `license_version_entitlements`, the installation binding or the supersession
  columns.
- The rejection audit row is written on the separate best-effort path, records
  identifiers only after the signature verified, and always carries
  `outcome = REJECTED`. It can never be mistaken for an application.
- The transaction's own conflicts (a race) are surfaced with the same stable reasons
  and audited the same way (`rejectAppliedConflict`), never as an unmapped database
  error.

## 9. Migration and rollout

### 9.1 Schema and existing data

- One additive nullable column plus a check constraint (§4.1). **No backfill, no
  rewrite, no data migration.** Every existing row is valid and means exactly what
  it meant before (`governs_from IS NULL`).
- Existing records remain readable by the previous release (it ignores the column),
  and by the new release (it interprets `NULL` as the signed start).
- The migration is safe to apply before the application release.

### 9.2 Protocol and conformance vectors

- No existing artifact is invalidated: absent field → identical bytes → identical
  signature → identical vectors (B2/B18).
- **No committed vector is modified.** PDR-16 explicitly forbids rewriting vectors
  to fit a design. The implementation slice adds a *new* family (canonical bytes for
  a renewal payload; a verification vector; a “legacy payload canonicalizes
  byte-identically” assertion) and leaves `CAN-01…08`, `OK-01…04`, `BAD-01…05`,
  `ROT-01…02`, the key files and their spec untouched.
- PDR-16's binding constraints are satisfied: no `VLIC3`, no existing signed byte
  format changed, no existing field reinterpreted. The additive optional field
  follows the ratified `deviceLimit` precedent, and the canonical byte contract
  (`docs/licensing/version-model-and-file-exchange.md` §2.1) and the vector contract
  document must gain the corresponding addendum **in the implementation slice** —
  that is a prerequisite for code, not part of this task.

### 9.3 Deployment order and rollback floor

1. **Migration first** (additive; the running release ignores it).
2. **Release that understands `governs_from` and `renewsOperationId`** — read path,
   authority, state fields, tests. Renewal *issuance* is not enabled yet, so no
   document can carry the field.
3. **Enable issuance** (CLI `--renews`, Owner procedure) once step 2 is the only
   version serving traffic. A mixed fleet is unsafe in one direction only: an old
   build *reading* a retained renewal row would treat it as starting at
   `validFrom`, which is exactly the forbidden truncation. Hence the gate and the
   order.
4. Rollout evidence: migration rehearsal on a populated database, the full licensing
   suites, and the live-PostgreSQL concurrency case.

**Rollback floor.** The migration itself is reversible (drop the column), but the
**application** may not be rolled back below step 2 while any renewal row exists:

```sql
SELECT count(*) FROM "licensing"."license_versions" WHERE "governs_from" IS NOT NULL;
```

If the count is non-zero, rolling back means mis-evaluating a term. Disable issuance
first; that is always safe. A retained renewal is a fact, not a toggle, and this
document does not pretend it can be un-applied.

## 10. Compatibility analysis (requirement 4)

| Artifact / behavior | Effect |
|---|---|
| Already-imported versions | no change: `governs_from` is `NULL`, windows, stamps, hashes and audit rows are untouched |
| Already-signed, not-yet-imported `VLIC2` documents | no change: without `renewsOperationId` they take exactly today's paths (explicit supersession, OQ-80 Option B, adjacency, gap/post-gap rules) |
| Committed conformance vectors | unchanged and still normative; nothing is rewritten |
| Canonical byte contract | unchanged for every existing payload; the new key is documented as an optional addition in order, omitted when absent |
| `VLIC1` legacy codes | unchanged; a text code cannot express a renewal (no operation id), and nothing in this design makes it one |
| Existing API clients | additive response fields only (`operationId`, `effectiveFrom`, `coverageEnd`); the generated client and OpenAPI document are regenerated in the implementation slice |
| Existing unit tests | unchanged, including the OQ-80 Option B test — that document has no renewal field, so its semantics are untouched |
| Backup/restore, clock rollback | no new state, no new startup gate, no network call (ADR-0046 D8 unchanged) |

## 11. Security analysis

| Threat | Control |
|---|---|
| Forged or replayed “renewal” marker | the marker is inside the signed bytes; the envelope is untrusted; the DB accepts no out-of-band renewal flag; a replayed artifact hits operation/hash uniqueness |
| Applying a renewal to a version it does not name | target is a signed operation id, resolved against this installation's retained rows; unknown/foreign customer → `renewal-target-unknown` |
| Re-using an old renewal artifact to push an old term onto a newer chain | the target must be the current coverage tail; a stale target is `renewal-target-not-current`, and the tail changes as soon as the first renewal commits |
| Double extension (two documents, two operation ids) | the tail rule refuses the second; uniqueness is the second line of defence |
| Cross-installation / cross-customer re-binding | existing installation, customer, customer-code and license-binding refusals run before the renewal rules |
| Silent term shortening | `renewal-not-an-extension` (422); a perpetual target is refused rather than “closed” |
| Silent grant reduction | §8.6 guard against the target with locked usage counts; explicit resolution required; audited with recomputed conflicts |
| Clock manipulation | the effective start is `T.end` (signed); `now` only stamps `superseded_at`/`imported_at` and never moves a term |
| Signature/canonicalization drift | existing bytes unchanged; the new key has one documented position and is omitted when absent; verifier and signer share one module |
| Downgrade to a build that does not understand the field | a new document fails canonical round-trip → `payload` 422, never a truncating import; a downgraded *reader* of a retained renewal row is prevented by the rollout gate (§9.3) |
| Audit falsification | APPLIED events are built inside the transaction from locked facts; refusals only ever write `REJECTED` |
| Key rotation/compromise | unchanged trust-list semantics; retained renewals stay effective without re-verification (ADR-0046 D7) |

## 12. Acceptance test plan (to be implemented later, not in this task)

Layers: **U** = domain unit (`license-version.spec.ts`, `license-document.spec.ts`),
**S** = service (`license-import.service.spec.ts`), **I** = API/OpenAPI contract,
**L** = live PostgreSQL (`licensing-persistence-live.e2e-spec.ts`), **V** = vectors.

| ID | Scenario | Layer | Key assertions |
|---|---|---|---|
| A1 | Early renewal of the governing version (the PO example) | U, S, L | applies; target `governs_until == target.valid_until`; renewal `governs_from == target.valid_until`; target's `valid_until` unchanged; state `coverageEnd == signed new end` |
| A2 | Continuity across the boundary | U, S | at `end−1 ms` → target effective ACTIVE; at `end` → renewal effective ACTIVE; never GRACE/READ_ONLY; `overlappingVersions` of each resolution is exactly itself (disjoint invariant) |
| A3 | Exact signed end date | U, S, I | the reported expiry equals the signed instant exactly (no rounding/clamping); at `end` the state is expired and `graceEndsAt == end + 14×24 h` |
| A4 | Invalid signature / tampered bytes / non-canonical payload | U, S | 422 `signature` / `payload`, nothing written, one `license.import.rejected` row, no APPLIED row |
| A5 | Wrong identity or binding | U, S | other installation → `installation-mismatch`; other customer → `installation-customer-mismatch`; changed `customerCode` → `customer-code-mismatch`; retained-elsewhere `licenseId` → `license-binding-conflict`; target of another customer → `renewal-target-unknown`; all write nothing |
| A6 | Duplicate import | S, L | 409 `duplicate-operation`; exactly one version row; exactly one `license.import.renewed`; target stamped once; after OQ-81: stored receipt + `replay: true`, current state reported separately |
| A7 | Target and overlap conflicts | U, S | interior/stale/already-renewed target → `renewal-target-not-current` or `renewal-target-unknown`; a third overlapping version → `overlapping-range`; perpetual target → `renewal-target-perpetual`; end ≤ target end → `renewal-not-an-extension`; nothing written in every case |
| A8 | Reduction | U, S, L | lowering `userLimit` below active users → 409 `reduction-requires-resolution` with the target and concrete conflicts; nothing written; via the resolution operation → applied, resolution audited against the target, target stamped only as the renewal's predecessor; entitlement removal behaves the same; an increase needs no resolution |
| A9 | Expired / lapsed license | U, S | (a) late renewal inside Grace → applies, ACTIVE, `graceEndsAt` recomputed from the new end; (b) late renewal after Read-Only → applies and restores normal operation (PDR-11 §9.3); (c) a **new identity** after a lapse is still post-gap (ordinary import 409, recovery operation applies); (d) a renewal cannot carry a recovery intent (`recovery-not-applicable`) |
| A10 | Existing artifact compatibility | V, U, S | every committed vector still verifies; a legacy payload canonicalizes byte-identically; a pre-change artifact imports with unchanged semantics; a pre-change retained row evaluates identically (`governs_from` NULL); the OQ-80 Option B test passes unchanged |
| A11 | Migration | L | column/constraint applied; every pre-existing row has `governs_from IS NULL` and the same effective window; the constraint rejects a deferred start without a supersession link and a start at/after `valid_until` |
| A12 | Audit | S, L | exactly one `license.import.renewed`; `license.version.superseded` names the target actually retired; `previous_license_id` set only when the identity changed; a rejected renewal writes no APPLIED row |
| A13 | Concurrency | L | two concurrent renewals of one target: one commits, one 409, exactly one version row, no partial state; a renewal racing a chain change is refused by the tail rule |
| A14 | Perpetual target | U, S | `renewal-target-perpetual`; the explicit-supersession path still performs the PDR-12-governed term change |
| A15 | Changed `licenseId` renewal | U, S, L | applies, creates the second license row on the same installation+customer, keeps the §8.6 guard against the target, audits the identity change, and cannot bypass any rule (Q3) |
| A16 | Legacy `VLIC1` | U, S | a text code is never a renewal; nothing changes for it |
| A17 | Read model | I | `operationId`/`effectiveFrom`/`coverageEnd` present and correct; `scheduledVersion` selected by the effective start; the generated client matches the OpenAPI document |

## 13. Questions that genuinely need Product Owner input

**Q-1 (commercial timing, non-blocking for the approved term behavior).** The
approved decision settles the **end date**; it does not say when a renewal's own
signed limits/entitlements take effect. This design applies them for the **renewed
term** (from the target's end), because applying them earlier would “prematurely
replace the current validity window” — the thing OD-LIC-06 forbids. Consequence: an
early renewal that *raises* capacity does not raise it until the current term ends;
an immediate grant change remains a supersession/version operation (which hands over
at its own start). **Please confirm this is the intended commercial behavior.** If
the Owner instead wants a renewal to change capacity immediately while only the end
date is extended, that is a different model and a separate decision.

**Q-2 (presentation, non-blocking).** `validUntil` keeps its current meaning (the
governing version's signed end) and a new `coverageEnd` reports the license-level
expiry including a scheduled renewal. So after an early import the admin sees
“renewal applied, license valid until *new end*” in `coverageEnd`, while `validUntil`
still shows the current term's end. **Please confirm the UI's “expires” field should
be `coverageEnd`** (rather than redefining `validUntil`, which would make Grace and
enforcement read a window that is not governing).

Everything else this design needed is settled by the existing decisions: `licenseId`
reuse is not required (Q3), a perpetual target's term change stays on the
explicit-supersession path (PDR-12), reductions follow PDR-11 §8.6, and a genuine
lapse follows PDR-13.

## 14. Out of scope / explicit non-changes

- No runtime code, Prisma schema, migration, vector, test or CI change in this task.
- No change to signature algorithm, key ids, trust list, file envelope or canonical
  bytes of existing payloads.
- No change to `supersedesOperationId`, OQ-80 Option B, OQ-86 Option C, G2,
  `backdated-supersession`, PDR-12, PDR-13, or the §8.6 flow.
- No change to Grace, Read-Only, expiry evaluation, permissions or the import
  endpoint's authorization (a renewal uses `Licensing.License.Activate` like any
  import).
- No implementation or policy claim for contract termination, cancellation,
  revocation or emergency restriction.
- No Owner-side signing implementation (signing stays outside the application,
  ADR-0046 D9); the Owner application still records observations only.

## 15. Recommended next step

1. Review this design (architecture + Product Owner for Q-1/Q-2).
2. If accepted, open the implementation slice with, in this order: canonical-byte
   contract addendum and new vectors → schema migration → domain/authority changes →
   import pipeline and read model → tests A1–A17 → rollout gate.
3. Keep OQ-88 **OPEN** until that slice is implemented, verified in CI and reviewed;
   this document answers the *design* gap only.

## 16. Implementation record (2026-10-19)

This section records what was built from the approved design. It changes no
requirement; the sections above remain the contract. Baseline:
`main` @ `8cd9b532a83682b730438b16949439833717bda9` (PRs #180 and #181 merged).

### 16.1 Product Owner answers (closing §13)

| Question | Answer | Where it is enforced |
|---|---|---|
| Q-1 | **`boundary`** — a renewal starts governing at the renewed version's exclusive effective end; the signed term is applied exactly | `windowStart()` / `effectiveWindow()` and the renewal resolution in `evaluateImportConflicts`; the target's `governs_until` and the renewal's `governs_from` are produced by the same accessor |
| Q-2 | **`coverage_end`** — a new `coverageEnd` reports the end of the unbroken coverage chain; `validUntil` keeps its per-version meaning | `coverageEndOf()` → `LicenseVersionSnapshot.coverageEnd` → `LicenseStateView` / `LicenseStateDto`; the admin card shows both |

### 16.2 Implemented surface

| Design element | Implementation |
|---|---|
| §3.1 signed reference | `LicenseVersionPayload.renewsOperationId`; `WirePayloadV2.renewsOperationId` optional; emitted **between** `supersedesOperationId` and `issuedAt` and **omitted** when null (`canonicalizeLicenseVersion`); parsed to `null` when absent |
| §3.1 payload validation | `assertLicenseVersionPayload`: malformed reference, self-renewal, renewal+supersession, and `validFrom > issuedAt` (renewal only) → `LicenseDocumentError('payload')` |
| §3.1 issuance | `IssueLicenseVersionOptions.renewsOperationId`; CLI `--renews <operationId>` (mutually exclusive with `--supersedes`, refused with `--format v1`) |
| §3.6 chain / §3.7 rule 4 | `coverageChain()` / `coverageChainTail()` / `coverageEndOf()`; target resolution inside `evaluateImportConflicts` only; refusals `renewal-target-unknown`, `renewal-target-not-current`, `renewal-target-perpetual`, `renewal-not-an-extension`, `recovery-not-applicable` |
| §4.1 schema | migration `20261023000000_licensing_renewal_governs_from`: nullable `governs_from`, `license_versions_governs_from_check`, column comment, nullable audit columns `renewed_version_id`, `renewed_from`, `renewed_until`; **no backfill, no rewrite**; Prisma `governsFrom` |
| §4.2/§4.3 transaction | command carries the derived `governsFrom`; the locked evaluation derives it again and the transaction refuses any disagreement before writing; target stamp = the same instant; renewal audit event built inside the transaction |
| §6 read model | `LicenseVersionSummary.operationId` + `effectiveFrom`; `LicenseStateView.coverageEnd` (null when perpetual or unlicensed); scheduled selection by `windowStart`. `GapRecoveryResultDto.coverageEnd` keeps its pre-existing meaning (the lapse the recovery followed) on that one receipt, because renaming or re-meaning an existing response field would be a breaking change; the chain end there is read from `GET /license/current` |
| §8.3 audit | `license.import.renewed` (APPLIED, built in-transaction) + `license.version.superseded` naming the retired target; `previous_license_id` only when the identity changed; no generic `license.import.applied` row for a renewal |
| §9 frontend | status card shows the chain end, the scheduled renewal's **effective** start, and the retained versions with their signed `operationId` |
| §12 tests | A1–A17 in `license-version.spec.ts`, `license-document.spec.ts`, `canonical-byte-contract.spec.ts`, `license-import.service.spec.ts`, `licensing-persistence-live.e2e-spec.ts`, `license-openapi.contract.spec.ts` and the migration rehearsal |
| §10 vectors | new `CAN-09` (renewal reference) only; CAN-01..CAN-08 and every OK/BAD/ROT artifact are byte-identical |

### 16.3 Acceptance evidence (A1–A17)

Every acceptance case named in §12 has a named test in the change. Where a case
spans layers, the table lists each one; `L` cases run only in the live-PostgreSQL
job, because the suite needs a real database.

| Case | Evidence |
|---|---|
| A1 early renewal | `license-version.spec.ts` → "reads one window start…", "accepts a renewal of the tail and hands over at the target end, never earlier", "keeps the target term intact when the renewal is imported mid-term"; `license-document.spec.ts` → canonical-order/omission; `license-import.service.spec.ts` → "persists an early renewal with the target's hand-over…" (target `governs_until`, renewal `governs_from`, `coverageEnd`); `licensing-persistence-live.e2e-spec.ts` → early-renewal case |
| A2 continuity across the boundary | domain spec → early-renewal and chain cases (at `end−1 ms`/`end` via `effectiveWindow`/`covers`); service spec → `effectiveVersionId` at both instants |
| A3 exact signed end | service spec → `renewal-not-an-extension` case proves no rounding/clamping of the signed term; `resolveEffectiveVersion` boundary assertions |
| A4 signature/tamper | `license-document.spec.ts` (parse/round-trip/refusals) plus the pre-existing import-rejection suites; no new writer path |
| A5 wrong identity/binding | domain spec → "refuses an unknown, retired, or foreign renewal target"; pre-existing binding suites unchanged |
| A6 duplicate import | service spec → replay = 409 `duplicate-operation`, single version row; live e2e → concurrent-renewal case |
| A7 target/overlap conflicts | domain spec → "resolves the target as the tail…", "refuses an unknown, retired, or foreign renewal target", "accepts a renewal of the tail…" (non-extension), perpetual case; service spec → stale target/perpetual cases |
| A8 reduction | domain spec → continuation-baseline block (unchanged) and renewal block; service spec → §8.6 reduction-then-resolution case |
| A9 expired/lapsed | domain spec → gap/recovery blocks plus "never lets a renewal pass as a post-gap recovery"; service spec → stale-target case; pre-existing Grace/Read-Only suites |
| A10 compatibility | `licensing-protocol-vectors.spec.ts` (whole corpus, unchanged digests); `canonical-byte-contract.spec.ts` (omission); `license-version.spec.ts` (`governsFrom: null` rows evaluate identically); OQ-80 Option B suite untouched |
| A11 migration | migration rehearsal (`assertRenewalMigration`, `snapshotRetainedWindows`) in the `backend` job; `licensing-persistence-live` for the real schema |
| A12 audit | service spec → typed-event assertions (`license.version.superseded` + `license.import.renewed`), rejection writes no APPLIED row; live e2e → persisted rows |
| A13 concurrency | live e2e → two concurrent renewals of one target |
| A14 perpetual target | domain spec → perpetual case; service spec → `renewal-target-perpetual` with explicit supersession still applying |
| A15 changed `licenseId` | domain spec → F-8 non-bypass renewal case (unchanged, still enforced); service spec keeps the §8.6 guard |
| A16 legacy `VLIC1` | service spec → "never treats a legacy code as a renewal"; pre-existing VLIC1 suites unchanged |
| A17 read model | `license-version.spec.ts` → summary `operationId`/`effectiveFrom`; API contract spec → `coverageEnd` + summary fields; frontend status-card test; `generated-api-client` CI job |

**Honest limitation.** These are static, named tests. Nothing in this change has
been executed locally (no dependency installation in the working environment by
design); the first execution is the CI run on the pushed head, and the PR
records its result.

### 16.4 Rollout floor

The application release that reads `governs_from` must not be rolled back below
while any row carries a non-null value: the previous release ignores the column,
so it would show the renewal's signed `validFrom` as its start (and therefore
"truncate" the current term in the read model) even though the rows are intact.
The migration itself is additive and safe to apply before the release.
