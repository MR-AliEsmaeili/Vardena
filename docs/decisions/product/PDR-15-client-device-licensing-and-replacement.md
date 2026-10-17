# PDR-15: Client-device licensing, quota and replacement (OD-LIC-04 / OQ-83)

> **Later cross-reconciliation (2026-10-16):** OQ-84 is product-closed: no
> separate signed receipt is required for ordinary activation. The current MVP
> replacement operating model is the dated §6 addendum below, which supersedes
> conflicting workflow/self-service wording in this earlier decision. Device
> identity, private-key custody and quota-safety decisions remain unless expressly
> superseded.


- **Type:** PDR (Product Decision Record) · decision id **OD-LIC-04**
- **Status:** **Decided — final policy, with superseding MVP replacement addendum (2026-10-16)**
- **Decided by:** Product Owner (Ali Esmaeili)
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-83 remains OPEN for implementation tracking/reconciliation**. OQ-84 is product-closed; no separate signed receipt is required for ordinary activation.
- **Recording baseline:** `main` @ `dd1203ca6c1651785811928f2a69d5d32a15739d` (verified against `origin/main` on 2026-10-15)
- **Related records:** [PDR-11](./PDR-11-vardena-licensing-product-requirements.md) §§7–8, 12, 14–16 · [PDR-14](./PDR-14-licensing-customer-code.md) · [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) · [`docs/licensing-architecture.md`](../../licensing-architecture.md) · [`docs/licensing/version-model-and-file-exchange.md`](../../licensing/version-model-and-file-exchange.md) · OQ-78, OQ-82, OQ-84 and OQ-85 remain separate and out of scope.

> This record transcribes the original device identity/quota decisions. The
> 2026-10-16 addendum below supersedes the former customer self-service replacement
> operating model for MVP. Decision recording is not implementation completion,
> Product Owner acceptance, or permission to merge.

## 1. Context

PDR-11 §7 approves client-device licensing and the server-hosted device lifecycle,
but PQ-6/OQ-83 had left the quota effect of replacement and the offline completion
protocol open. The existing Licensing module already owns the signed server-license
versions, installation/customer binding and typed audit trail. It did not yet own a
client-device model, device quota, device-key enrollment, replacement requests, or a
customer-side administration surface.

The original policy approved the device identity, quota and lifecycle constraints
below. Its automated customer-side replacement workflow is superseded for MVP by
§6's manually managed Owner Admin process; it does not establish the server
installation replacement workflow.

## 2. Original device decision — retained constraints and historical workflow

> **Current policy scope (2026-10-16):** the device-key identity, private-key
> custody, quota accounting, retained history and quota-neutral atomic-swap
> constraints below remain where compatible. Earlier customer-admin/self-service
> replacement steps and signed request/response choreography are historical
> requirements/implementation evidence, not the current MVP replacement workflow.
> The manual Owner Admin policy in §6 controls; do not present customer
> self-service replacement as approved or conformant. Regular enrollment is not
> re-decided by this replacement addendum.

1. **Cryptographic identity.** A device is identified by its own cryptographic key.
   An IP address or host name alone is never a device identity.
2. **Private-key custody.** A device's private key remains on that client device.
   The Vardena server may retain the public key and derived fingerprint only; it
   must never receive, persist, log, export or expose the private key.
3. **Quota unit.** The device entitlement counts registered devices, not user
   accounts, user memberships, IP addresses, host names or concurrent sessions.
4. **Quota consumption.** An active registered device consumes one quota unit until
   it is explicitly deactivated or a replacement completes under this decision.
   Pending replacement requests do not add a second quota unit; the old active
   device continues to consume its one unit while a replacement is pending.
5. **Authoritative entitlement.** The effective, valid signed LicenseVersion is the
   authority for the device limit. Device counts are server-owned. A request or UI
   value cannot grant or raise quota.
6. **Inventory and administration.** A System Administrator can inspect the device
   inventory, current states, consumed and available quota, activation and
   deactivation history, and replacement history through the actual application UI.
7. **Direct activation.** A valid device enrollment may activate directly when the
   authoritative license is active and quota is available. No extra approval stage
   is introduced for ordinary device activation.
8. **Distinct lifecycle actions.** Deactivation and replacement are different
   operations with different history. A device record is retained; deactivation
   never physically deletes it.
9. **Replacement accounting.** Successful replacement is auditable and atomic from
   the server's perspective. It exchanges one active device for one new active
   device and does not increase consumed quota.
10. **Old-device/key loss.** Replacement remains possible when the old device or its
    private key is unavailable. The new device proves possession of its own key;
    proof from the old device is not required.
11. **Pending-request scope.** At most one valid pending replacement request may
    exist for a given old device at a time. Device replacement remains separate
    from server-installation replacement.
12. **Successful completion boundary.** The old device becomes `REPLACED` only in
    the same successful transaction that activates the new device. Invalid,
    expired, cancelled, stale, failed or replayed attempts leave the old device
    active and do not partially create the new device or its quota/audit outcome.
13. **Offline completion.** An offline replacement may remain pending until a valid
    signed response/evidence is imported. Signed files are the primary exchange;
    any text/code fallback must carry the same signature and correlation data and
    pass the same verification path.
14. **Cancellation and replay.** Cancellation is durable. A cancelled request cannot
    be replayed, revived, or completed by importing its earlier response.
15. **Quota reduction.** When a signed license reduces the device limit below
    current active-device usage, an administrator explicitly chooses devices to
    deactivate or resolves the conflict through the existing authorized licensing
    reduction flow. No device is automatically deactivated or deleted. New ordinary
    registration remains blocked while active-device usage is at or above the
    applicable finite limit; the server reports the conflict and preserves all
    device history.
16. **Existing customer binding.** Device enrollment and replacement evidence must
    bind to the existing installation and its validated `customerId` and
    owner-assigned `customerCode`. The implementation reuses the current Licensing
    authority; it never infers, fabricates or changes a customer code.
17. **Offline boundary.** Offline support in this decision is only the licensing
    request/response exchange. Normal application operation continues to depend on
    the local Vardena server.

## 3. Scope limits

This decision does **not** decide or authorize:

- OQ-78 full license revocation, revocation recovery, or general reactivation;
- OQ-82 server-installation replacement or installation identity-key recovery;
- OQ-84 signed receipts for ordinary server-license import/activation or ordinary
  device activation. OQ-83 replacement evidence is operation-specific and does not
  settle OQ-84 globally;
- OQ-85 the Owner-side licensing system, issuance workflow, or Owner application;
- device synchronization or offline use of the ERP itself (OQ-44);
- any new licensing customer, installation, or entitlement source outside the
  signed server-license version already authoritative on this installation.

## 4. Historical implementation consequences for the former replacement workflow (not current MVP policy)

- OQ-83's quota effect and replacement/offline behavior were decided in the
  original record; the registry row remains OPEN for current-policy reconciliation,
  implementation evidence and exact-head CI. This status line does not claim that
  the superseding Owner Admin workflow is implemented or verified.
- The former implementation design called for a device-capacity field in signed
  server-license versions, using retained-version authority like organization/user
  capacity. Under that former design, artifacts lacking the field were
  **UNSPECIFIED** (distinct from finite zero and signed unlimited), and registration
  was to be blocked until an explicit signed entitlement existed. The parser was
  required to preserve canonical bytes and signature verification; signed `null`
  represented unlimited. These are historical design notes, not evidence that the
  field or behavior was implemented or that a missing field grants entitlement.
- The former customer self-service design called for a device-signed canonical
  enrollment/replacement request, server verification, public-key-only retention,
  and an offline signed response correlated to request, binding and LicenseVersion.
  This choreography is not the approved MVP replacement flow and its implementation
  does not prove conformity to PDR-15 §6.
- The prior design kept device records, pending replacement requests, quota counts
  and typed audit events inside the existing Licensing module/database; it added no
  Owner issuer, device-sync service or server-replacement path. Preserve this as
  historical design scope, not a new runtime assertion.

The protocol/state-machine detail and stable API contracts are maintained in
[`docs/licensing/client-device-lifecycle.md`](../../licensing/client-device-lifecycle.md).

## 5. Status discipline

The decision is recorded. Implementation, tests, CI, Owner acceptance and merge are
separate statuses. OQ-83 stays OPEN until implementation review and exact-head CI
are complete. No other OQ is closed, reopened, or reinterpreted by this record.


## 6. Product Owner update — MVP replacement operating model (2026-10-16)

This dated decision supersedes any conflicting prior customer self-service or
signed-response **MVP replacement workflow** wording in §§2–5. It changes only
replacement operations: device identity remains key-based, private keys remain
on the client, device history is retained, and quota accounting remains
one-for-one. Regular enrollment is not re-decided.

1. Client-device replacement in the MVP is **manually managed by Owner Admin**.
   It is not an automated customer self-service replacement workflow.
2. The existing device remains active and consumes its quota until the new
   device is activated. Successful completion then replaces the old device in
   an atomic, quota-neutral one-for-one swap; failed activation must not leave a
   partial swap or strand the existing active device.
3. The Owner Admin workflow, evidence capture, customer-side activation/import
   mechanics, and exact API/state contract require separate technical
   specification. No new signed artifact, VDRP1 behavior, receipt, protocol or
   implementation is authorized by this documentation record. Ordinary
   activation still requires no separate signed receipt (OQ-84).

OQ-83's policy is decided, but the row remains open for implementation review
and exact evidence. Existing customer self-service/signed-response code, if
present, is not evidence that the new manual Owner Admin policy is implemented;
reconcile it in an authorized implementation change.


## 7. Product Owner decision — customer-side client deactivation (2026-10-17)

This later decision in [PDR-18](PDR-18-licensing-contract-and-activation-policy.md) supersedes the conflicting Owner-Admin-managed client replacement policy in §6 only for **ordinary client-device deactivation and quota transfer**:

1. The customer's Vardena System Administrator can manually deactivate an active client device from the customer dashboard when the device has failed, is unavailable, or is no longer needed.
2. Its quota slot can be transferred to another client by one atomic operation. The active-device limit remains enforced under concurrency, and no partial transfer may strand quota or exceed the signed limit.
3. Keep attributable history of the deactivation and transfer. No elaborate evidence protocol is required by this decision.
4. This applies to client devices only; Owner-authorized server installation replacement remains separate under PDR-17/PDR-18.

The product policy is decided. API/UI implementation, concurrency verification, and reconciliation of existing signed request/response flows remain engineering work. OQ-83 must retain its implementation/evidence status until those checks are complete.
