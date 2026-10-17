# Licensing Product Owner Decision Addendum — 2026-10-17

- **Authority:** Ali Esmaeili, Product Owner.
- **Scope:** Product-policy decisions consolidated after review of licensing questions and the current documentation.
- **Change type:** Documentation only. This record authorizes no runtime implementation and no merge.
- **Precedence:** This addendum supersedes earlier product-policy text only where explicitly stated below. Unrelated security, signing, identity, authorization, audit, installation-binding, and concurrency controls remain in force.

## 1. Contract dates are separate from activation validity

The Owner licensing application must model and display commercial contract dates independently from the technical validity dates of an issued activation license.

- Contract start/end dates are commercial-management information. The Owner can inspect them and use them for commercial decisions.
- When an activation license is issued, its `validFrom` is populated by default from the current issuance date/time under the established date/time contract. The issuer cannot edit the start date.
- Issuance with a start date in the past or future is not permitted. There is no backdated activation and no future-dated activation.
- The issuer chooses the activation validity end (`validUntil`) separately. The chosen end must pass the existing validity and signature rules; this decision does not authorize an invalid interval.
- The Owner UI/API must show contract start/end and activation validity start/end as distinct fields with unambiguous labels. Contract dates must not silently rewrite or infer activation dates.
- Example: a customer contract runs from 10 Mehr to 10 Mehr the following year, but the license is issued on 20 Mehr. The contract dates remain 10 Mehr–10 Mehr; activation validity starts on 20 Mehr and its end is chosen independently by the issuer.

The current model's version precedence, supersession, and gap rules must not be bypassed to accommodate this policy. Engineering must specify how an issue-today successor interacts with an already-active version, including overlap/conflict behavior, renewal, failed activation, and recovery. Do not implement a hidden future-start workaround or silently relax conflict guards. This specification is an implementation prerequisite, not a new product exception.

## 2. Historical gaps, interior gaps, and backdated documents

- A newly issued activation license cannot start in the past or future; its start is the issuance date.
- A special C11/internal-gap or backdated-gap-fill issuance path is not required for the MVP and must not be introduced.
- Contract dates are not an alternative means of backdating activation validity.
- Normal signature, customer/license identity, installation binding, version-precedence, retained-history, replay, audit, and reduction-conflict controls remain in force.
- The accepted OD-LIC-05 / ADR-0050 decision for C10 (the reduction guard on post-gap recovery) remains in force. This addendum does not reverse that decision or authorize a bypass.
- Before changing version-import mechanics, engineering must reconcile the issue-today rule with the existing renewal-gap and supersession rules and document any necessary technical consequence. Product policy must not be inferred from a technical workaround.

## 3. Audit retention and WORM

- **Hardware or software WORM is not an MVP requirement.** Do not block MVP on WORM storage, purchase WORM hardware, or add mandatory WORM-specific infrastructure.
- This does not remove the approved audit-retention policy: append-only history, the minimum three-year retention floor, the previously approved separate durable archive, retention holds for unresolved security incidents, appropriate access/minimization, verification, and recovery requirements remain as already decided.
- Ordinary file permissions and hash chains must not be described as equivalent to true WORM. The product simply does not require WORM for MVP.

## 4. Contract termination, expiry, cancellation, and revocation

- Contract termination follows the natural subscription-expiry operational policy: 14 days of Grace measured as 14 × 24 hours in UTC from the applicable expiry instant, then Read-Only.
- Intentional subscription cancellation, ordinary license cancellation/revocation, and emergency revocation have the same operational outcome: the affected license becomes inactive; they do not receive the natural-expiry Grace period automatically.
- The event reason, actor, timestamp, and supporting audit details remain distinguishable. Same operational outcome does not mean merging all event types or audit records.
- Existing signed-offline cancellation and restricted-admin recovery boundaries remain unchanged; this policy does not claim new runtime support.

## 5. Idempotent replay response

For a successful operation replayed with the same idempotency identity:
- Do not apply the operation a second time.
- Return the historical result of the original operation separately from the current license state.
- Include an explicit replay indicator.
- Do not replace the historical result with current state or present historical state as current state.
- Preserve existing authorization, identity, audit, and replay protections. The exact response DTO and durable receipt behavior remain engineering/API work.

## 6. Server replacement

- Server replacement is Owner-authorized and uses a limited, one-time replacement authorization.
- The new server may be activated before the old server is manually decommissioned.
- Do not claim that Owner can remotely shut down or control the customer's old server.
- Owner Admin records customer/authorized-representative approval, including approver name, timestamp, reason, and evidence reference.
- Only one replacement request may be in progress for the same replacement process.
- Engineering must first propose a design compatible with license-to-Installation binding, activation failure, retry/recovery, pending/finalization consistency, and the existing security and audit controls. This record does not itself specify the implementation protocol or waive a conflict guard.

## 7. Client-device deactivation and quota transfer

This policy applies to client devices, not server installations.

- A customer's Vardena System Administrator can manually deactivate an active client device from the dashboard when it is failed, unavailable, or no longer wanted.
- The device slot can then be transferred to another client through an atomic operation.
- The concurrent active-device quota must remain enforced; no intermediate or concurrent state may exceed the signed limit.
- Preserve attributable history of deactivation and quota transfer.
- Keep the workflow straightforward and dashboard-based. No new elaborate evidence protocol is required by this decision.
- Existing implementation must be reconciled with this superseding policy before it is represented as conformant.

## 8. Decision vs implementation status

This is a product decision record only. It does not claim that API contracts, database models, UI forms, lifecycle state transitions, device controls, replacement protocol, tests, or production operations are implemented. Update the open-question registry and traceability/evidence documents to show each decision separately from remaining engineering work. Do not close an OQ solely because its policy is decided when its established registry convention requires implementation evidence or Owner acceptance.
