# PDR-18 §1 — contract dates, Owner-side observation metadata and signed-license validity: implementation record

**Date:** 2026-10-17 (semantically corrected 2026-10-17) · **Author:**
implementation agent · **Starting `main` SHA:**
`7fa9ff3ba460eb023b657db216c6a6488cc2af87` (PR #172 merge; no open PRs at start).

**Scope of this PR — three separate concepts, never conflated:**

1. **Contract dates** — commercial/customer contract start and end, recorded and
   viewed by the Owner.
2. **Owner-side observation/recording metadata** — when an operator recorded an
   observation in the Owner application, and the validity end the operator
   recorded having seen.
3. **Customer-side signed-license validity** — the `validFrom`/`validUntil`
   carried by the signed artifact and enforced by the customer installation.
   **Owned by the customer runtime; not modelled, not read and not altered by
   this PR.**

**Not in scope:** cryptographic issuance, signing protocols or signed receipts,
customer runtime enforcement changes, renewal/reissuance workflows, termination
instruments, WORM infrastructure and any new revocation mechanism. PDR-17 records
all of those as not implemented in the Owner application, and PDR-18 records
itself as a documentation reconciliation decision that does not by itself
authorize runtime implementation.

Canonical policy: [PDR-18](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md),
[PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md),
[PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md),
[OQ-45](../decisions/product/OQ-45-license-expiry-behavior.md),
[date/time foundation](../datetime.md) and AR-32.

---

## 0. Semantic correction applied to this PR (read this first)

An earlier revision of this PR modelled the Owner-side recording date as
`activation_valid_from` / `activationValidFrom` and the operator-supplied end as
`activation_valid_until` / `activationValidUntil`, presenting them as the
license's "activation validity". **That overclaimed what the Owner application
knows**, and was corrected at the source:

- PDR-17 records cryptographic issuance, signed receipts, deactivation proofs,
  revocation and recovery as **not implemented** in the Owner application, and
  states that Owner operations record only `OPERATOR_OBSERVED` facts — "manually
  attributable facts, not cryptographically verified operations". Every response
  states `cryptographicVerification = NOT_IMPLEMENTED`.
- The Owner application therefore **cannot know** the actual issuance or
  activation date of a signed license. A database-recording date is not proof of
  it, and calling it one would be a false claim in the schema, the API, the UI
  label and the audit trail.

What changed:

| Before (rejected)                                                                         | After (current)                                                                             | Why                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operational_records.activation_valid_from` (stored `date`, backfilled from `created_at`) | **no column** — `recordedOn` is **derived on read** from the immutable `created_at` instant | Nothing is stored that could be mistaken for an issuance date, and nothing is backfilled into it. `created_at` is `NOT NULL DEFAULT clock_timestamp()` and is protected against change by `owner.immutable_operation_facts` (migration 002), so the derived day is authoritative, server-controlled and cannot drift. |
| `operational_records.activation_valid_until`                                              | `operational_records.observed_validity_end`                                                 | The value is the validity end the **operator recorded having seen**; the rename makes the epistemic status part of the name.                                                                                                                                                                                          |
| API `activationValidFrom` / `activationValidUntil`                                        | API `recordedOn` / `observedValidityEnd`                                                    | No API property may imply stronger evidence than the system has.                                                                                                                                                                                                                                                      |
| UI "اعتبار فعال‌سازی (فنی)" / "شروع اعتبار فعال‌سازی (تاریخ صدور معتبر)"                  | UI "مشاهدهٔ ثبت‌شده (دستی)" / "روز ثبت این مشاهده (تعیین‌شده توسط سرور)"                    | The Persian labels now say what the field is.                                                                                                                                                                                                                                                                         |
| backfill `activation_valid_from = (created_at AT TIME ZONE 'UTC')::date`                  | **no backfill at all**                                                                      | §5.4: no observation timestamp is backfilled into a field presented as verified issuance evidence.                                                                                                                                                                                                                    |
| `activation_valid_from_required` CHECK (`NOT VALID`)                                      | constraint removed                                                                          | There is no stored start column to constrain; "mandatory" is now structural (`created_at` is `NOT NULL`).                                                                                                                                                                                                             |

Migration 005 was **corrected in place rather than superseded**, because it has
never been part of a released migration history: it exists only on this unmerged
PR branch and is absent from `main` (verified with
`git cat-file -e main:owner-licensing/backend/migrations/005-…` → absent). No
supported installation can have applied it, and the migration ledger's checksum
guard would make any such mismatch loud rather than silent.

The useful work is preserved: contract dates, the server-controlled recording
day, the operator-recorded end, the interval convention, the validation, the UI,
the audit projection, the migration and the tests all remain — with honest names
and without a fabricated date anywhere.

---

## 1. Verified state of `main` before this change (evidence, not prose)

| Requirement                                                                     | Source inspected                                                                                                                                                                                  | Verdict at `7fa9ff3`        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| OQ-45 Grace = signed expiry + exactly 14×24 h UTC                               | `backend/src/modules/licensing/domain/license.ts` (`LICENSE_GRACE_DURATION_MS`, `graceEndsAtFor`, `evaluateLicense`)                                                                              | **Implemented**             |
| OQ-45 `now >= graceEndsAt` ⇒ Read-Only; Grace keeps entitled operation          | `domain/license.ts`; `application/licensing.service.ts` (`filterLicensedPermissions`, `isPermissionLicensed`, `assertBusinessMutationAllowed`)                                                    | **Implemented**             |
| OQ-45 enforcement on HTTP **and** system/worker context                         | `modules/rbac/application/authorization.service.ts` (`requireAllPermissions` system-context branch) and `authorization.guard.ts`                                                                  | **Implemented**             |
| OQ-45 customer UI communicates mode/deadline through the shared date foundation | `frontend/src/app/layouts/license-gate.tsx`, `features/licensing/license-status-card.tsx`                                                                                                         | **Implemented** (PR #168)   |
| PDR-18 §1 contract dates on the Owner side                                      | `owner-licensing/backend/src/app.ts` (`createCustomerService` / `updateCustomerService` accept only `customerCode`, `displayName`, `status`, `contractReference`); migration `001-foundation.sql` | **Not implemented**         |
| PDR-18 §1 activation-validity dates on the Owner side                           | `owner-licensing/backend/src/operations.ts` (`recordLicenseObservation` records no date at all)                                                                                                   | **Not implemented**         |
| PDR-18 §1 issuance-day activation start                                         | nowhere                                                                                                                                                                                           | **Not implemented**         |
| PDR-18 §4 contract termination / cancellation / revocation lifecycle            | `domain/license.ts` knows only `ACTIVE`/`EXPIRED`/`SUSPENDED`; no signed termination or cancellation instrument exists (matrix rows F2–F5, OQ-78)                                                 | **Blocked — no instrument** |

OQ-45's Grace/Read-Only runtime slice is therefore **not re-implemented** by this
change. This record adds no second clock, no duplicate state machine and no
change to the signed artifact or its validity semantics.

## 2. What this change implements

### 2.1 Persisted model (Owner) — `owner-licensing/backend/migrations/005-contract-and-activation-dates.sql`

| Column                  | Table                       | Type   | Meaning                                                                                                                                                  |
| ----------------------- | --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract_start_date`   | `owner.customers`           | `date` | Commercial/administrative contract start. May precede the recording.                                                                                     |
| `contract_end_date`     | `owner.customers`           | `date` | Commercial/administrative contract end. May equal the start.                                                                                             |
| `observed_validity_end` | `owner.operational_records` | `date` | The validity end the **operator recorded having seen**. Exclusive (half-open convention). `null` = no end was recorded — never defaulted, never derived. |

**Deliberately absent:** a stored issuance or activation date. The recording day
(`recordedOn` in the API) is derived on read as
`to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD')`, i.e. the UTC calendar day
of the row's `created_at`. `created_at` is an **Instant** (`timestamptz`, server
generated, immutable); `recordedOn` is the **BusinessDate** projection of it.
This keeps the repository's BusinessDate/Instant separation (AR-32) intact and
creates no second source of truth that could drift.

Invariants enforced by the database:

- `contract_date_order` — a contract end before the start is refused; either
  side may be unrecorded.
- `observed_validity_end_license_only` — a `SERVER_REPLACEMENT` record records no
  license validity end at all.
- `observed_validity_end_after_recorded_day` — the recorded end must be strictly
  later than the day the observation was recorded. `created_at` is `NOT NULL`
  and immutable, and `timezone('UTC', timestamptz)` is immutable, so this is a
  stable per-row invariant rather than a time-dependent predicate.

No backfill runs, so **no historical issuance or activation date is fabricated**
for rows recorded before the migration. The migration is therefore a pure,
forward-safe `ALTER TABLE … ADD COLUMN` with no `UPDATE`, which also removes the
earlier SQLSTATE 55006 hazard (see §6.1): the Owner migrator applies the whole
chain in one transaction, and an `UPDATE` followed by an `ALTER TABLE` on the
same table fails inside that transaction with "cannot ALTER TABLE … because it
has pending trigger events". No applied migration is edited; 001–004 checksums
are unchanged.

### 2.2 The recording day is server-controlled (PDR-18 §1.2, PDR-17)

`recordLicenseObservation` (`owner-licensing/backend/src/operations.ts`) does
**not** accept `recordedOn`. The request allowlist is `customerId`,
`installationReference`, `reason`, `evidenceReference`, `observedValidityEnd`;
any other field — including a client-supplied recording day — is refused with
`400 ValidationFailed` before anything is written. The recording day comes from
PostgreSQL's `clock_timestamp()` via `created_at`, which migration 002 then
makes immutable; it is never a browser clock, never a client value and never a
local calendar day.

The retained interval convention is checked in the same transaction, against the
day the row was actually recorded.

### 2.3 What the response claims about itself

Every operational-record response already carried, and continues to carry, the
explicit epistemic statement required by PDR-17: `evidenceBasis:
"OPERATOR_OBSERVED"`, `cryptographicVerification: "NOT_IMPLEMENTED"`,
`signedArtifactProduced: false`, `customerServerContacted: false`. A test asserts
these on the corrected response, and another asserts that no response property
claims to hold an issuance or activation date.

### 2.4 Separation in the API, audit and UI

- `customerResponse` exposes `contractStartDate` / `contractEndDate` as their own
  pair; `operationResponse` exposes `recordedOn` / `observedValidityEnd` as
  theirs. The two pairs never share a name, never appear in the same object, and
  neither is ever mixed with the customer-side signed validity.
- The audit-state allowlist (`owner-licensing/backend/src/audit.ts`) carries all
  four keys, so the contract and observation facts are attributable and visible
  in the audit explorer instead of being silently dropped. It remains a strict
  allowlist, so no unrelated column can leak.
- The Owner UI labels the groups separately in Persian (`contractDatesTitle` vs
  `observationDatesTitle`) with help text that states the recording day is **not**
  the signed issuance date, renders both through the shared staged date
  foundation (Jalali-first with the canonical Gregorian day alongside), and
  offers **no input** for the recording day.
- A PostgreSQL `date` is read back through `persistedBusinessDay`
  (`owner-licensing/backend/src/domain.ts`), the single place that undoes
  node-postgres' local-midnight materialization. A process running east or west
  of UTC cannot shift a recorded day.

## 3. Requirement → code → test traceability

| Requirement                                                                    | Implementation                                                                                                              | Test                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract dates are commercial and never define or rewrite technical validity   | migration 005; `contractStartDate`/`contractEndDate` only on `owner.customers`; `assertContractDateOrder` checks order only | `api.test.ts` "keeps commercial contract dates separate from Owner-side observation metadata"; `unit.test.ts` `assertContractDateOrder`                                                                                                                  |
| Contract end before contract start is refused                                  | `assertContractDateOrder` + `contract_date_order` CHECK                                                                     | `api.test.ts` (inverted create and inverted partial update ⇒ 400), `api.test.ts` migration case (direct SQL ⇒ `contract_date_order`), `customer-schema.test.ts`                                                                                          |
| Missing/optional contract dates stay supported; no end is invented             | `optionalBusinessDay` (`undefined`/`null`/`""` ⇒ `null`)                                                                    | `unit.test.ts` "treats an omitted value as not recorded"; `api.test.ts` (open-ended contract ⇒ `contractEndDate` null)                                                                                                                                   |
| The recording day is server-controlled and cannot be overridden by a client    | `recordedOn` absent from the `object()` allowlist; derived from the immutable `created_at`                                  | `api.test.ts` (client-supplied `recordedOn` ⇒ 400); `unit.test.ts` (schema strips it); `operations-flow.test.tsx` (no editable control)                                                                                                                  |
| Recording an observation does not establish the signed license's issuance date | no stored issuance/activation column at all; `recordedOn` derived from `created_at`; response states `NOT_IMPLEMENTED`      | `unit.test.ts` "records an observation without establishing a signed-license issuance date"; `unit.test.ts` "moves the recording day when the recording instant moves"; `api.test.ts` migration case (column set contains no issuance/activation column) |
| The interval convention holds for the operator-recorded end                    | `optionalBusinessDay` + `assertObservedValidityEnd` (`>`) + `observed_validity_end_after_recorded_day` CHECK                | `unit.test.ts` half-open cases; `api.test.ts` (end before the recording day ⇒ 400; malformed end refused, not normalized; direct SQL ⇒ CHECK violation)                                                                                                  |
| A server-replacement record records no license validity                        | `observed_validity_end_license_only` CHECK; UI shows the pair only for `LICENSE`                                            | `api.test.ts` "a server-replacement record records no license validity end"; `unit.test.ts`; direct SQL ⇒ CHECK violation                                                                                                                                |
| API, audit and UI distinguish and label the three concepts                     | `customerResponse`, `operationResponse`, `audit.ts` allowlist, `customer-page.tsx`, `operation-page.tsx`, `owner-i18n.ts`   | `owner-flow.test.tsx` (contract dates rendered), `operations-flow.test.tsx` (observation metadata rendered, and **no** label claims a verified issuance date)                                                                                            |
| Contract dates may precede the recording                                       | `assertContractDateOrder` allows any past start                                                                             | `api.test.ts` (`2020-03-20` accepted); `customer-schema.test.ts`                                                                                                                                                                                         |
| "Never trust the browser clock"; BusinessDate vs Instant                       | server `clock_timestamp()`; `utcCalendarDay`, `persistedBusinessDay`, `recordedOnFor`                                       | `unit.test.ts` (UTC day from UTC/Tehran/US offsets; local-midnight round-trip; Tehran boundary)                                                                                                                                                          |
| Existing supported data migrates without invented history                      | migration 005 has no backfill and no `UPDATE`                                                                               | `api.test.ts` migration case (a row with an older `created_at` reports that day as `recordedOn` and has a `NULL` observed end)                                                                                                                           |
| Migration ledger and ordering                                                  | 005 appended; 001–004 checksums unchanged                                                                                   | `api.test.ts` ledger assertions (001–005) in both the fresh and the role-remediation paths                                                                                                                                                               |

## 4. Deliberately NOT implemented — blockers with evidence

### 4.1 Customer-side signed-license validity versus the PDR-18 issuance-day rule (blocked — OQ-88)

PDR-18 §1.2 forbids a past or future activation-validity start. **Which
component owns that rule is the unresolved question**, and this PR deliberately
does not answer it:

- **Owner side — corrected and closed for this PR.** The Owner application never
  claims to know a signed license's issuance or activation date. Its own
  recording day is now named and modelled as observation metadata (§0). Nothing
  here validates, normalizes, overwrites or rejects a signed artifact.
- **Customer side — untouched and blocked.** `backend/src/modules/licensing/**`
  is unchanged by this PR (`git diff --stat main…HEAD -- backend/src` is empty)
  and the committed vectors under `docs/licensing/vectors` are unchanged. The
  conflict is real: the vectors pin `issuedAt = 2026-10-11T00:00:00.000Z` with
  `validFrom = 2027-01-01T00:00:00.000Z`, i.e. a future start, and the approved
  version model keeps a future-dated renewal without disturbing what governs now
  (OQ-80 Option B hand-over; `docs/licensing-architecture.md` documents
  `--valid-from` for renewals). Rejecting such artifacts at import would
  invalidate already-signed licenses.

Registered as **OQ-88** with the concrete component requiring the decision (the
customer-side `VLIC2` import/verification path and the renewal flow). The
engineering proposal PDR-18 §1.6 asks for is delivered separately in
[`pdr-18-renewal-reissuance-flow-proposal.md`](pdr-18-renewal-reissuance-flow-proposal.md).
No verification-path, signed-format or vector behaviour was changed by this PR.

### 4.2 Contract termination, cancellation and revocation (blocked — OQ-78)

PDR-18 §4 gives contract termination the natural-expiry Grace and gives
cancellation/revocation/emergency revocation the `inactive` outcome without
Grace. Neither can be enforced on a customer installation today: the signed
version payload carries only `ACTIVE`/`EXPIRED`/`SUSPENDED`, there is no signed
termination or cancellation instrument (matrix F2–F5), and OQ-45/ADR-0049
deliberately grant no Grace to a signed non-`ACTIVE` status so an emergency or
integrity restriction cannot be weakened. Choosing a mapping (or inventing a
signed instrument) is a product/protocol decision, not an engineering one. No
status semantics were changed by this PR, and no Grace was widened.

### 4.3 WORM (not required)

PDR-18 §3 removes WORM from MVP. Nothing was added; the append-only audit
history, the three-year retention floor, the unresolved-security-incident hold
and the separate durable archive remain exactly as implemented by PR #169.

## 5. Local lightweight checks and what was deliberately not run locally

Run locally (all fast, no infrastructure):

- `owner-licensing/backend`: `tsc --noEmit`, `oxlint src test`,
  `prettier --check src test *.json`, and the three unit suites
  (`unit.test.ts`, `domain-operations.test.ts`, `audit-query.test.ts`).
- `owner-licensing/frontend`: `tsc --noEmit` (after `npm run dates:stage`),
  `oxlint .`, `prettier --check .`, and the full Vitest suite (jsdom, no server).

Not run locally, per `docs/testing/test-execution-policy.md` and the task's test
budget: the Owner PostgreSQL integration suite (`test/api.test.ts`, which
requires a disposable PostgreSQL database), the customer backend/frontend heavy
suites, E2E, migration rehearsals and Docker builds. Those run in GitHub
Actions on the exact PR head; their results are recorded in §6.

## 6. CI evidence

**Verified implementation head: `b7adb8124f0ad6f634b750e35668a866c8c50b95`.**
GitHub Actions run
[`39060731535`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39060731535)
— `pull_request`, `completed / success`, `head_sha` equal to the SHA above, so
this run tested exactly this change set.

| Job                    | Conclusion               | Job link                                                                                                |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `classify`             | success                  | [job 117477968002](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39060731535/job/117477968002) |
| `backend`              | success (5m35s)          | [job 117478018547](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39060731535/job/117478018547) |
| `frontend`             | success (2m35s)          | [job 117478018601](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39060731535/job/117478018601) |
| `docs`                 | success                  | [job 117478018619](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39060731535/job/117478018619) |
| `generated-api-client` | skipped (not applicable) | [job 117478019397](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39060731535/job/117478019397) |
| `ci-gate`              | success                  | [job 117479225769](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39060731535/job/117479225769) |

Steps inside the green `backend` job that matter for this record:

- **Owner API static and unit checks** — the corrected domain and unit suites.
- **Owner fresh migrations and PostgreSQL API/security regressions** — the
  migration-005 case and the corrected API semantics against a real disposable
  PostgreSQL database.
- **Regenerate licensing vectors (determinism check)** — success, which is the
  direct evidence that the **customer-side signed-license vectors, including the
  future-dated `validFrom` cases, are unchanged and still pass**.
- **Three migration rehearsals** (populated pre-Task-11 data, Inventory
  BusinessDate validity windows, Licensing populated chain through OQ-83) — all
  success, so the corrected forward migration is safe for populated data.
- **E2E tests (incl. live-DB suites)**, the **Licensing persistence live
  PostgreSQL suite** and the **OQ-83 client-device live PostgreSQL suite** — all
  success, so no customer runtime behaviour changed.
- Customer production-image/Owner-isolation, production-artifact and secret
  hygiene, `prisma:deploy`, system-admin bootstrap, and both non-UTC-timezone
  live BusinessDate suites — all success.

`generated-api-client` was marked not applicable by the classifier and skipped.
That is legitimate and not a narrowed gate: no backend DTO, OpenAPI document or
generated client was touched, and `ci-gate` — which fails closed when a job the
classifier marked applicable did not succeed — reports success.

> The commit that carries this paragraph is **documentation-only**; its own
> PR-head run is reported in the pull-request description and comments rather
> than here, so no run is ever claimed for a SHA it did not test.

## 7. Status

**What this PR changes**

- Adds commercial contract dates to `owner.customers`, validated for order only,
  never derived from or overwriting technical validity.
- Adds one Owner-side observation column (`observed_validity_end`) and derives
  the recording day (`recordedOn`) from the immutable, server-generated
  `created_at` instant. Neither is presented as the signed license's issuance or
  activation date.
- Renames, relabels and re-tests the API, audit, UI and documentation so no
  layer claims stronger evidence than the system has.

**What this PR intentionally does NOT change**

- No cryptographic issuance, signing protocol, signed receipt, verification or
  revocation mechanism (PDR-17: not implemented).
- No customer runtime enforcement, no `VLIC2` schema or validator change, no
  change to the committed vectors, no renewal/reissuance workflow, no
  termination instrument, no WORM infrastructure.
- No change to PDR-18's authorization status, and no new product decision
  recorded on the Product Owner's behalf.

**Known limitations**

- The interval rule requires the observed end to be later than the recording
  day, so an operator cannot record an end that is already in the past (for
  example an expired license observed after the fact). This is the interval
  convention retained from the approved implementation; changing it would be a
  new product rule, so it is left as-is and flagged here.
- The Owner application still cannot state when a signed license was really
  issued or activated. It now says so explicitly instead of implying otherwise.

**Blocked:** §4.1 (OQ-88 — customer-side, needs a Product Owner decision) and
§4.2 (OQ-78 — no signed termination/cancellation instrument).

No OQ is closed by this record. No Product Owner acceptance is claimed. CI
success is not acceptance, and this record does not authorize a merge.
