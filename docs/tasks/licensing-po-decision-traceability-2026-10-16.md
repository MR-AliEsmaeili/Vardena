# Licensing Product Owner decision traceability — 2026-10-16

**Scope:** documentation-only reconciliation of confirmed decisions OQ-45 and
OQ-74–OQ-85. The central registry remains [`docs/open-questions.md`](../open-questions.md).
Canonical policy is in [PDR-11 §21](../decisions/product/PDR-11-vardena-licensing-product-requirements.md#21-product-owner-decisions-and-traceability-update--2026-10-16),
with detailed records in [OQ-45](../decisions/product/OQ-45-license-expiry-behavior.md),
[PDR-15](../decisions/product/PDR-15-client-device-licensing-and-replacement.md),
and [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md).

## Decision and status matrix

| OQ | Product decision recorded | Remaining product/API question | Specification / evidence gap | MVP implementation status based on repository inspection |
|---|---|---|---|---|
| 45 | Natural subscription expiry only; signed expiry + 14×24h UTC; end at `now >= boundary`; intentional subscription cancellation gets no automatic Grace. | Contract-termination strictness; cancellation's resulting restriction remains distinct under OQ-78. | Exact expiry enforcement/restoration and boundary tests. | Not implemented; docs only. |
| 74 | Signing keys remain under Owner custody/control; do not automatically invalidate already-issued licenses solely due to key compromise. | No new business trade-off decided. | Custody, containment, rotation/future-key trust, unimported artifact provenance, offline recovery, and key-compromise/replay interaction. | No production signer/key custody/rotation claim. |
| 75 | Exactly Owner Admin and License Operator for MVP; prior four-role model superseded. | No additional role-count decision. | Explicit endpoint grants, auth/access review and acceptance. | Existing four-role code/documentation may conflict; no runtime modification. |
| 76 | A small backward change alone does not restrict; reliable evidence of meaningful rollback is required and the resulting rollback-only restriction is audited. After correction, revalidate trusted time and license/time evidence; resolved rollback-only restriction requires a controlled, attributable, audited unlock. Failed/uncertain validation requires secure authorized recovery; never clear unrelated restrictions or alter signed expiry. No threshold invented. | No additional policy supplied. | Trusted-time evidence, persistence, tamper/restart resistance, controlled unlock and recovery criteria. | Detector/watermark not established. |
| 77 | Append-only; at least three years from event occurrence; unresolved security incidents excluded from automatic deletion; prior permanent separate archive remains. | None to the minimum/stronger archive requirement. | Archive/storage, access/minimization, retention execution and incident-resolution evidence. | Existing audit tables do not prove a separate archive. |
| 78 | Distinguish natural subscription expiry, intentional subscription cancellation, signed offline license cancellation/revocation, replacement, reissuance and contract termination; restricted-admin artifact/recovery path does not itself restore ordinary access. Reactivation preserves same-license dates; separate reissue need not. | No additional transition semantics supplied. | Auth/session/API/state/evidence protocol, audit and recovery implementation. | Full lifecycle/recovery not implemented. |
| 79 | Classify legacy `SUSPENDED` only from evidence; ambiguous records stay restricted and reviewable; never blanket-map to any status. | No blanket mapping choice. | Historical data audit; additive compatibility/migration/rollback plan. | Legacy consumers remain; no migration in this PR. |
| 81 | Preserve earlier A–J decisions, current-vs-historical distinction and retry constraints. | Exact replay DTO after supersession remains open. | Durable receipt/retrieval; key-compromise/replay interaction; implementation and tests. | Current duplicate refusal/no receipt and stale-target rejection remain gaps; see [technical design](oq-81-idempotent-replay-technical-design.md). |
| 82 | Manual Owner-approved replacement; activate new server before manual old-server decommission; remain pending until auditable confirmation; Owner Admin configures the pending request/confirmation period 1h–7d, default 24h; no remote shutdown claim. | No new remote or automatic authority. | How new activation works under existing one-active/license-installation binding; pending/finalization consistency; decommission evidence; period start/end and timeout/failure recovery. | Operator observations do not prove decommission; implementation blocked pending specification. |
| 83 | Manual Owner Admin-managed device replacement, not customer self-service; old device active until replacement activation; atomic quota-neutral swap. | No new product question. | Manual workflow, activation/evidence/API and reconcile existing self-service/signed-response behavior. | Existing implementation must be reviewed against superseding policy; no runtime change. |
| 84 | No mandatory separate signed receipt for ordinary activation; manual attributable history remains non-cryptographic. | Closed. | Preserve distinction from OQ-81's separate API replay receipt/DTO and from OQ-83 replacement evidence. | No general signed receipt claimed. |
| 85 | Owner-controlled infrastructure/trust; no continuous customer-to-Owner connectivity; no federated issuer in MVP. Offline exchange still requires the local customer server to apply/verify licensing data. | None for this boundary; OQ-61 remains separate. | Deployment, key/trust operations and acceptance evidence. | No production issuer/deployment claim. |

## MVP readiness classification

- **Implemented / present as code evidence:** no new runtime behavior is authorized
  or changed by this record. Existing code is not evidence that the newly approved
  policies are met. The previously implemented Owner manual-observation slice is
  only an operator-recorded observation, not remote control, decommission proof,
  cryptographic verification, or a signed ordinary activation receipt.
- **Unverified / requires source-backed acceptance:** the role authorization
  mapping, append-only retention/archive execution, UTC Grace enforcement,
  evidence-based rollback, restricted-admin recovery and Owner deployment/trust
  boundary need dedicated implementation review and tests.
- **Known implementation/specification gaps:** OQ-74 key compromise and replay
  interaction; OQ-76 evidence/threshold-free recovery rules; OQ-77 archive and
  retention execution; OQ-78 cancellation/recovery protocol; OQ-79 ambiguous
  `SUSPENDED` history; OQ-81 replay DTO, durable receipts and stale-target handling;
  OQ-82 exact old-server decommission evidence and pending-expiry recovery; OQ-83
  existing customer self-service/signed-response behavior versus new manual Owner
  Admin policy; OQ-85 deployment evidence. OQ-45 enforcement is not implemented.
- **MVP readiness blockers (feature-scoped):** (1) expiry/read-only enforcement
  and tests (OQ-45); (2) two-role Owner authorization plus rollback evidence and
  restricted recovery (OQ-75/76/78); (3) append-only audit retention/archive
  controls (OQ-77); (4) safe legacy-state audit/migration (OQ-79); (5) durable
  replay plus approved DTO before any replay API change (OQ-81); (6) manual server
  replacement evidence, bounded pending workflow and timeout recovery (OQ-82);
  (7) Owner Admin device replacement matching the new policy, not the current
  self-service behavior (OQ-83); and (8) Owner-controlled key custody/trust and
  deployable offline boundary evidence before production issuance (OQ-74/85).
  These block the corresponding licensing/Owner workflows, not unrelated ERP
  features. Decision text alone is not implementation evidence.
- **Deferred / excluded by this record:** remote customer-server shutdown or
  contact; federated issuer; continuous connectivity to Owner; new signed
  activation receipts; automatic/unsupervised device replacement; guessed
  decommission evidence, rollback thresholds, SUSPENDED mappings, or replay DTO.

No application code, DTO, schema, migration, generated client, key, signed
canonicalization, protocol vector, runtime behavior, or feature test was changed
or validated by this record.

## Source evidence inspected (not feature-test results)

- Expiry/restriction status: `backend/src/modules/licensing/domain/license.ts`,
  `backend/src/modules/licensing/application/licensing.service.ts` and
  `licensing.service.spec.ts` show existing status/permission filtering but no
  Grace/Read-Only deadline mechanism. No expiry tests were run in this task.
- Replay: `backend/src/modules/licensing/application/license-import.service.ts`
  and its unit specs retain duplicate refusal; no durable historical replay
  receipt path was verified. The existing OQ-81 design preserves target vs
  current behavior and the unresolved DTO.
- Owner roles: `owner-licensing/backend/src/domain.ts` defines four current roles;
  `owner-licensing/backend/test/unit.test.ts` asserts four; `api.test.ts` includes
  direct API tests for all four. These are code/test-source inspections, not tests
  executed here, and show a mismatch with the new two-role policy.
- Owner replacement observations: `owner-licensing/backend/src/domain.ts`,
  `operations.ts`, `api.test.ts` and
  `docs/tasks/licensing-owner-side-manual-operations.md` record operator-entered
  observations. They do not prove actual server decommission or enforce the new
  1h–7d confirmation expiry.
- Device replacement: `backend/src/modules/licensing/domain/client-device.ts`,
  `application/client-device-lifecycle.service.ts` and
  `api/client-devices.controller.ts` implement signed request/response flows;
  they require reconciliation against the new manual Owner Admin policy. No
  runtime changes or tests were made.
- Legacy status: `backend/src/modules/licensing/domain/license.ts`,
  `domain/license-document.ts`, and `application/licensing.service.spec.ts` retain
  `SUSPENDED` as a status/consumer; no historical production-data census or
  migration was performed.
- Owner audit: `owner-licensing/backend/migrations/001-foundation.sql`,
  `002-manual-operations.sql`, `src/audit.ts` and `src/db.ts` show stored audit
  events and append-only protections for some records; they do not establish a
  separate permanent archive, three-year retention execution, or incident-aware
  deletion policy.

These source references support the gap classifications only. No runtime,
unit, integration, database, E2E or CI tests were run for this documentation PR.
