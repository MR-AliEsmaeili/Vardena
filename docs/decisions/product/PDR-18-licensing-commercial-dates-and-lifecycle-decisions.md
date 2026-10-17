# PDR-18: Licensing commercial dates, activation validity, lifecycle and replacement decisions

- **Date:** 2026-10-17
- **Authority:** Product Owner approval in the conversation dated 2026-10-17.
- **Status:** **Decided — documentation reconciliation only; no runtime implementation authorized by this record.**
- **Scope:** Consolidates the Owner's decisions on contract versus activation dates, future/backdated activation, C11, audit archive/WORM, contract termination, cancellation/revocation, replay semantics, server replacement and client-device deactivation.
- **Canonical licensing source:** [PDR-11](PDR-11-vardena-licensing-product-requirements.md) and [Open Questions](../../open-questions.md).

## 1. Contract dates and activation validity are separate concepts

1. Contract start/end dates are commercial/administrative data recorded and viewed by the Owner. They do not implicitly define or rewrite a signed license's technical activation-validity window.
2. At license issuance, activation validity **starts on the current issuance day by default and is mandatory**. The issuer cannot edit or backdate/future-date this start.
3. The issuer may set the activation-validity end date. The UI and API must distinguish contract dates from activation-validity dates and label them separately.
4. The Owner's dashboard must display both date pairs independently so the Owner can make commercial decisions from contract dates without treating them as the license's technical validity.
5. Example: a customer contract may run from 10 Mehr through 10 Mehr of the following year, while the license is first issued on 20 Mehr. Its activation validity begins on 20 Mehr, not 10 Mehr; the Owner still sees the original contract dates.

### Temporal and issuance constraints

- “Issuance day” must use the canonical trusted server-side business-date/time policy, not a client-supplied date or browser clock. The precise instant/date conversion must follow the existing date/time foundation and signed-license contract.
- Activation validity must not begin in the past or future relative to the authoritative issuance date. A signed artifact that claims either is rejected.
- Contract dates may legitimately precede issuance and must not be validated as if they were activation-validity dates.
- The end date must satisfy the existing interval convention and be later than the activation start; the API/UI must state the accepted end-date semantics explicitly.
- This decision removes the product need for an interior/backdated gap-fill mechanism (C11). It does **not** remove signature, identity, installation/customer binding, precedence, retained-history, replay, audit, or §8.6 reduction-conflict controls.
- Because future-dated successor activation is no longer allowed, engineering must propose a compatible renewal/reissuance flow that does not silently weaken overlap/gap and supersession checks. Do not implement a workaround or infer that a newly issued license can override a currently governing version without passing the existing conflict authority.

## 2. Interior/backdated gap-fill candidates (C11)

**Decision:** No special C11 recovery or gap-fill path is required or authorized. Activation-validity start cannot be backdated or future-dated; it is set to the issuance day. C11 is product-decided as **not applicable under the approved issuance rule**, while any code-path cleanup and verification remain engineering work.

This decision is distinct from C10 and OD-LIC-05. The approved C10 post-gap recovery reduction guard remains in force for a genuine lapsed-coverage recovery; this PDR does not close OQ-87 or change PDR-13's dedicated recovery authorization. Ordinary version-conflict controls remain mandatory.

## 3. Audit retention and WORM (OQ-77)

**Decision:** Hardware or software WORM storage is **not an MVP requirement**. No production gate, mandatory hardware, or architecture complexity may be introduced solely to satisfy WORM.

This does not cancel the previously decided audit policy: append-only audit history, at least three years of retention from event occurrence, the unresolved-security-incident hold, authorized access/minimization, and the previously approved separate durable archive remain in force unless a later explicit Product Owner decision changes them. Hash chains, checksums or filesystem permissions must not be described as equivalent to true WORM or as proof against a compromised OS administrator. OQ-77 remains open only for the archive/retention/access/recovery implementation and evidence still required; WORM is removed from its open requirements.

## 4. Contract termination, natural expiry, cancellation and revocation

1. Contract termination has the same operational policy as natural subscription expiry: 14 days of Grace measured as 14 × 24 hours from the authoritative expiry/termination instant in UTC, then Read-Only at or after the boundary.
2. Intentional subscription cancellation, ordinary license revocation/cancellation, and emergency revocation share one operational outcome: the license becomes inactive. They do not receive the natural-expiry 14-day Grace automatically.
3. Distinct reasons, actors, timestamps, authorization and audit events remain recorded. Simplifying the operational outcome does not erase the causal/audit distinction.
4. Existing signed offline cancellation/import and restricted-administrator recovery constraints remain unless separately changed by a future explicit decision.

## 5. Idempotent replay (OQ-81)

For a successfully processed duplicate/replayed API operation:
- Do not apply the operation a second time.
- Preserve and return the historical result of the original operation.
- Return the current license state separately from that historical result.
- Include an explicit replay indicator.
- Do not substitute current state for the historical operation result, or present historical result as the current state.

The response DTO, durable operation receipt, storage and generated API client are implementation/design work; no API change is claimed implemented by this decision record.

## 6. Server replacement (OQ-82)

- Owner Admin records approval by the customer or an authorized customer representative, including approver name, approval time, reason and evidence reference.
- A limited, one-time Owner-issued replacement authorization may allow the new server to activate before the old server is manually shut down/decommissioned.
- Do not claim or implement remote shutdown or remote control of the customer server.
- The technical design must reconcile the temporary overlap with license-to-Installation binding, the existing single-active-installation policy, failed activation, retry/idempotency, pending/finalized records and recovery. A failed replacement must not strand the customer or silently authorize unlimited active installations.
- At most one replacement request may be in progress for the relevant replacement process. Engineering must propose the protocol before implementation; this record does not prescribe unverified implementation details.

## 7. Client-device deactivation and quota transfer (OQ-83)

- The customer company's Vardena System Administrator may manually deactivate a client device from the customer dashboard when it is failed, unavailable or no longer wanted.
- Deactivation frees its active-device slot and permits another client to use that slot.
- Deactivation/slot transfer must be atomic and concurrency-safe; the signed effective device limit remains enforced at all times.
- Preserve attributable audit/history of the action. Do not require a complex evidence protocol, Owner intervention, command-line operations or direct database changes for ordinary customer-managed device replacement.
- This policy is distinct from server replacement and supersedes conflicting Owner-Admin-managed client-device replacement workflow wording in earlier MVP records. Existing implementation must be reconciled; this is not an implementation claim.

## 8. Status and implementation discipline

This PDR records Product Owner policy only. It does not claim implementation, tests, CI, operational readiness, or Product Owner acceptance of any code. Keep product decisions separate from engineering design, verification and delivery. Do not run heavy local test suites; use targeted lightweight checks locally and reserve heavy/integration/E2E verification for CI. No merge is authorized by this PDR.

## Related records

- [PDR-11 — Licensing requirements](PDR-11-vardena-licensing-product-requirements.md)
- [PDR-13 — Post-gap recovery](PDR-13-post-gap-recovery.md)
- [PDR-15 — Client-device licensing](PDR-15-client-device-licensing-and-replacement.md)
- [PDR-17 — Owner licensing web application](PDR-17-owner-web-application-phase-1.md)
- [ADR-0050 — Post-gap recovery reduction guard](../../adr/0050-post-gap-recovery-reduction-guard.md)
- [OQ-45 — Expiry behavior](OQ-45-license-expiry-behavior.md)
- [Open Questions registry](../../open-questions.md)
