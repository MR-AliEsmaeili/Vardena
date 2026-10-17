# PDR-18 §1 — contract dates versus activation-validity dates: implementation record

**Date:** 2026-10-17 · **Author:** implementation agent · **Starting `main` SHA:**
`7fa9ff3ba460eb023b657db216c6a6488cc2af87` (PR #172 merge; no open PRs at start).
**Scope:** PDR-18 §1 (contract dates vs activation validity, issuance-day start,
issuer-set end, separate Owner API/UI/persisted labels) and the OQ-45
verification evidence required to say what is already implemented.
**Not in scope:** the Owner issuance/cryptographic signer, WORM/archive work,
server replacement (OQ-82), device lifecycle, and the customer-side renewal
protocol (blocked — see §4).

Canonical policy: [PDR-18](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md),
[PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md) §"Product
Owner decision update — activation dates and server replacement (2026-10-17)",
[PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md),
[OQ-45](../decisions/product/OQ-45-license-expiry-behavior.md),
[date/time foundation](../datetime.md) and AR-32.

---

## 1. Verified state of `main` before this change (evidence, not prose)

| Requirement | Source inspected | Verdict at `7fa9ff3` |
|---|---|---|
| OQ-45 Grace = signed expiry + exactly 14×24 h UTC | `backend/src/modules/licensing/domain/license.ts` (`LICENSE_GRACE_DURATION_MS`, `graceEndsAtFor`, `evaluateLicense`) | **Implemented** |
| OQ-45 `now >= graceEndsAt` ⇒ Read-Only; Grace keeps entitled operation | `domain/license.ts`; `application/licensing.service.ts` (`filterLicensedPermissions`, `isPermissionLicensed`, `assertBusinessMutationAllowed`) | **Implemented** |
| OQ-45 enforcement on HTTP **and** system/worker context | `modules/rbac/application/authorization.service.ts` (`requireAllPermissions` system-context branch) and `authorization.guard.ts` | **Implemented** |
| OQ-45 customer UI communicates mode/deadline through the shared date foundation | `frontend/src/app/layouts/license-gate.tsx`, `features/licensing/license-status-card.tsx` | **Implemented** (PR #168) |
| PDR-18 §1 contract dates on the Owner side | `owner-licensing/backend/src/app.ts` (`createCustomerService` / `updateCustomerService` accept only `customerCode`, `displayName`, `status`, `contractReference`); migration `001-foundation.sql` | **Not implemented** |
| PDR-18 §1 activation-validity dates on the Owner side | `owner-licensing/backend/src/operations.ts` (`recordLicenseObservation` records no date at all) | **Not implemented** |
| PDR-18 §1 issuance-day activation start | nowhere | **Not implemented** |
| PDR-18 §4 contract termination / cancellation / revocation lifecycle | `domain/license.ts` knows only `ACTIVE`/`EXPIRED`/`SUSPENDED`; no signed termination or cancellation instrument exists (matrix rows F2–F5, OQ-78) | **Blocked — no instrument** |

OQ-45's Grace/Read-Only runtime slice is therefore **not re-implemented** by this
change. This record adds no second clock, no duplicate state machine and no
change to the signed artifact or its validity semantics.

## 2. What this change implements

### 2.1 Persisted model (Owner) — `owner-licensing/backend/migrations/005-contract-and-activation-dates.sql`

| Column | Table | Type | Meaning |
|---|---|---|---|
| `contract_start_date` | `owner.customers` | `date` | Commercial/administrative contract start. May precede issuance. |
| `contract_end_date` | `owner.customers` | `date` | Commercial/administrative contract end. May equal the start. |
| `activation_valid_from` | `owner.operational_records` | `date` | Activation-validity start: the authoritative issuance day, asserted by the server. |
| `activation_valid_until` | `owner.operational_records` | `date` | Issuer-supplied activation-validity end. **Exclusive** (half-open signed-license interval convention). |

Invariants enforced by the database:

- `contract_date_order` — an end that precedes the start is refused; either side
  may be unrecorded.
- `activation_validity_order` — the exclusive end must be **later** than the
  start (`>`), never equal to it.
- `activation_validity_license_only` — a `SERVER_REPLACEMENT` record carries no
  activation window at all.
- `activation_valid_from_required` — a `LICENSE` record always has a start.

Backward compatibility: the four columns are additive and nullable for
customers; the migration backfills `activation_valid_from` for pre-existing
`LICENSE` rows from the UTC calendar day of their own issuance-observation
instant (`created_at`), which is the only authoritative evidence such rows
carry, and deliberately invents **no** end date. No applied migration is
edited; 001–004 checksums are unchanged.

### 2.2 Server-asserted issuance day (PDR-18 §1.2)

`recordLicenseObservation` (`owner-licensing/backend/src/operations.ts`) does
**not** accept `activationValidFrom`. The request allowlist is
`customerId`, `installationReference`, `reason`, `evidenceReference`,
`activationValidUntil`; any other field — including a client-supplied start — is
refused with `400 ValidationFailed` before anything is written.

The start is inserted by PostgreSQL as
`(clock_timestamp() AT TIME ZONE 'UTC')::date`: the UTC calendar day of the
authoritative database clock. It is never a browser clock, never a client
value, and never a local calendar day. The same statement returns the day so the
service can check the half-open interval against the issuer-supplied end in the
same transaction.

### 2.3 Separation in the API, audit and UI

- `customerResponse` exposes `contractStartDate` / `contractEndDate` as their own
  pair; `operationResponse` exposes `activationValidFrom` /
  `activationValidUntil` as theirs. The two pairs never share a name and never
  appear in the same object.
- The audit-state allowlist (`owner-licensing/backend/src/audit.ts`) now carries
  all four keys, so the contract/activation facts are attributable and visible
  in the audit explorer instead of being silently dropped.
- The Owner UI labels the pairs separately in Persian
  (`contractDatesTitle` / `activationValidityTitle`), renders both through the
  shared staged date foundation (Jalali-first with the canonical Gregorian day
  alongside), and offers **no input** for the activation-validity start.
- A PostgreSQL `date` is read back through `persistedBusinessDay`
  (`owner-licensing/backend/src/domain.ts`), the single place that undoes
  node-postgres' local-midnight materialization. A process running east or west
  of UTC cannot shift a recorded day.

## 3. Requirement → code → test traceability

| PDR-18 §1 requirement | Implementation | Test |
|---|---|---|
| §1.1 Contract dates are commercial and do not define the technical window | migration 005; `contractStartDate`/`contractEndDate` only on `owner.customers` | `test/api.test.ts` "keeps commercial contract dates separate from the server-asserted activation validity"; `test/unit.test.ts` `assertContractDateOrder` |
| §1.2 Start is the issuance day, mandatory, not editable, no past/future start | `object()` allowlist rejects `activationValidFrom`; `(clock_timestamp() AT TIME ZONE 'UTC')::date` | `test/api.test.ts` (client-supplied start ⇒ 400; start equals today's UTC day in the response **and** in the stored row) |
| §1.2 Issuer sets the end; the interval convention holds | `optionalBusinessDay` + `assertActivationValidityInterval` (`>`) | `test/api.test.ts` (end before the issuance day ⇒ 400; malformed end refused, not normalized); `test/unit.test.ts` half-open interval cases |
| §1.3 API/UI distinguish and label the two pairs | `customerResponse`, `operationResponse`, `customer-page.tsx`, `operation-page.tsx`, `owner-i18n.ts` | `owner-flow.test.tsx` (contract dates rendered on the customer detail), `operations-flow.test.tsx` (activation window rendered on a license record) |
| §1.4 The Owner sees both pairs independently | customer detail page and operation detail page | same as above |
| §1.5 Contract dates may precede issuance and are not validated as activation dates | `assertContractDateOrder` allows any past start; only the pair's order is checked | `test/api.test.ts` (`2020-03-20` accepted); `customer-schema.test.ts` |
| "Never trust the browser clock" | server-side `clock_timestamp()`; `utcCalendarDay`/`persistedBusinessDay` | `test/unit.test.ts` (UTC day from two offsets; local-midnight round-trip) |

## 4. Deliberately NOT implemented — blockers with evidence

### 4.1 Customer-side activation-validity start on the signed artifact (blocked)

PDR-18 §1.2/§1.6 forbids a past or future activation-validity start. Applying
that rule to `VLIC2` verification or issuance in this repository cannot be done
without a Product Owner decision, because it collides with approved behaviour:

- The committed conformance vectors (`docs/licensing/vectors`, regenerated and
  diffed by CI) contain `issuedAt = 2026-10-11T00:00:00.000Z` with
  `validFrom = 2027-01-01T00:00:00.000Z`, i.e. a future start.
- The approved version model keeps a **future-dated renewal** without
  disturbing what governs now (matrix C2; OQ-80 Option B hand-over;
  `docs/licensing-architecture.md` documents `--valid-from` for renewals).
- Rejecting such artifacts at import would invalidate already-signed licenses,
  which the task's backward-compatibility requirement forbids.
- PDR-18 §1.6 itself defers this: "engineering must propose a compatible
  renewal/reissuance flow that does not silently weaken overlap/gap and
  supersession checks."

Registered as **OQ-88** (see `docs/open-questions.md`). No verification-path or
signed-format behaviour was changed by this PR.

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

See the pull request description; this section is completed after the final-head
run. (Filled in by the follow-up commit on the same PR.)

## 7. Status

- Implemented and tested: PDR-18 §1.1, §1.2 (Owner-side issuance-day start and
  issuer-set exclusive end), §1.3, §1.4, §1.5.
- Blocked: §4.1 (registered OQ-88), §4.2 (OQ-78 instrument).
- No OQ is closed by this record. No Product Owner acceptance is claimed. CI
  success is not acceptance, and this record does not authorize a merge.
