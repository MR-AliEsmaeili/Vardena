# PDR-15: Client-device licensing, quota and replacement (OD-LIC-04 / OQ-83)

- **Type:** PDR (Product Decision Record) · decision id **OD-LIC-04**
- **Status:** **Decided — Final Owner Decision** (2026-10-15)
- **Decided by:** Product Owner (Ali Esmaeili)
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-83 remains OPEN for implementation tracking**; this decision records the approved policy and does not close the row before implementation is reviewed. OQ-84 remains OPEN for ordinary activation/import receipts.
- **Recording baseline:** `main` @ `dd1203ca6c1651785811928f2a69d5d32a15739d` (verified against `origin/main` on 2026-10-15)
- **Related records:** [PDR-11](./PDR-11-vardena-licensing-product-requirements.md) §§7–8, 12, 14–16 · [PDR-14](./PDR-14-licensing-customer-code.md) · [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) · [`docs/licensing-architecture.md`](../../licensing-architecture.md) · [`docs/licensing/version-model-and-file-exchange.md`](../../licensing/version-model-and-file-exchange.md) · OQ-78, OQ-82, OQ-84 and OQ-85 remain separate and out of scope.

> This record transcribes the Product Owner decisions for client-device
> registration, quota accounting and replacement. The implementation is being
> delivered in the same focused change; decision recording is not implementation
> completion, Product Owner acceptance, or permission to merge.

## 1. Context

PDR-11 §7 approves client-device licensing and the server-hosted device lifecycle,
but PQ-6/OQ-83 had left the quota effect of replacement and the offline completion
protocol open. The existing Licensing module already owns the signed server-license
versions, installation/customer binding and typed audit trail. It did not yet own a
client-device model, device quota, device-key enrollment, replacement requests, or a
customer-side administration surface.

The Product Owner has now explicitly approved the following policy. It is scoped to
the customer-side client-device lifecycle only; it does not establish a server
installation replacement or Owner-side issuance system.

## 2. Decision (OD-LIC-04) — binding

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

## 4. Implementation consequences (recorded, not additional product policy)

- OQ-83's quota effect and replacement/offline behavior are decided, while the
  registry row remains OPEN until implementation and exact-head CI are verified.
- The implementation adds a device-capacity field to signed server-license
  versions and uses the same retained-version authority as organization/user
  capacity. A pre-existing artifact without that signed field remains
  **UNSPECIFIED** (distinct from both finite zero and signed unlimited); device
  registration is blocked until an explicit signed entitlement exists. The
  parser preserves the original canonical bytes and signature verification.
  A signed explicit `null` continues the established license-limit convention
  of unlimited. No commercial grant is inferred from a missing field.
- The client device signs a canonical enrollment/replacement request with its own
  key. The customer server verifies the proof and retains only public key material.
  An offline replacement response is verified using the installation's existing
  trusted licensing public keys and is correlated to the retained request, current
  customer/installation binding, and effective LicenseVersion.
- Device records, pending replacement requests, quota counts and typed licensing
  audit events remain inside the existing Licensing module and database schema.
  No Owner-side issuer, device-sync service, or server-replacement path is added.

The protocol/state-machine detail and stable API contracts are maintained in
[`docs/licensing/client-device-lifecycle.md`](../../licensing/client-device-lifecycle.md).

## 5. Status discipline

The decision is recorded. Implementation, tests, CI, Owner acceptance and merge are
separate statuses. OQ-83 stays OPEN until implementation review and exact-head CI
are complete. No other OQ is closed, reopened, or reinterpreted by this record.
