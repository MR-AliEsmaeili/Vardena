# OQ-81 — Idempotent licensing operations: approved policy and technical design

**Status:** Product Owner policy A–J is recorded below. This is documentation-only; replay implementation is not claimed. OQ-81 remains open only for the replay-response contract identified below and implementation/verification. No OQ-45 or OQ-82 scope is changed.

## 1. Repository evidence and boundaries

Current implementation evidence is from these files:

- VLIC2 canonical payload and hash: `backend/src/modules/licensing/domain/license-document.ts` (`canonicalizeLicenseVersion`, `licenseDocumentHash`).
- Operation paths, authorization, validation, result types: `backend/src/modules/licensing/application/license-import.service.ts` (`importDocument`, `recoverAfterGap`, `transferCustomer`, `resolveReduction`, `runImport`, permission rechecks).
- Public response mapping: `backend/src/modules/licensing/api/license-import.controller.ts`, `license-gap-recovery.controller.ts`, `license-customer-transfer.controller.ts`, `license-reduction-resolution.controller.ts`, `license-state.view.ts`, `api/dto/license.dto.ts`.
- Locking, atomic writes and audit: `backend/src/modules/licensing/data/licenses.repository.ts` (`importVersion`).
- Operation/artifact uniqueness: `backend/prisma/schema/licensing.prisma`, `LicenseVersion` unique keys `(installationId, operationId)` and `(installationId, documentHash)`.
- Governing rules: PDR-11 §§8, 10.8, 12, 20.6; PDR-12 / OD-LIC-01; PDR-13; PDR-14; PDR-15; PDR-16; ADR-0045/0046; `docs/licensing/version-model-and-file-exchange.md` §§2–6; `docs/licensing-architecture.md`.

**Current behavior, not target behavior:** v2 duplicate operation or document hash is rejected as `duplicate-operation`; no original success receipt is stored/returned. The repository already holds the installation row lock, reruns conflict evaluation, then writes license/version/entitlements, supersession stamps, customer binding and typed success audit in one database transaction. This is verified by source inspection; no tests were run in this documentation change. `LicenseImportService` and controllers build/evaluate state after the repository transaction, so the *current HTTP state snapshot* is not part of that transaction.

## 2. Operation identity, semantic fingerprint and valid new operations

### 2.1 Separate concerns and validation order

**A. New operation identity — full validation before mutation.** A request whose installation-scoped identity has not committed must pass, in order, current authentication and required operation authorization; transport and payload parsing; supported VLIC version and canonical-form checks; signature verification and trusted-key validation; installation/customer binding; document validity/lifecycle checks; and the complete current business-conflict evaluation (window, exact supersession target/approved stale-chain rule, retained history, entitlements, capacity/usage and operation-specific requirements). The authoritative conflict evaluation is repeated under the installation lock. Only then may the operation mutate state, and all state changes, success audit and eventual receipt must commit atomically. An equivalent grant under a different operation ID is not by itself a duplicate refusal; the new operation still undergoes this full validation.

**B. Retry of a previously committed identity — authorized, read-only receipt path.** The replay path is separate from new-operation evaluation:

1. Authenticate the caller; enforce current operation permission(s) and installation/customer scope before disclosing anything.
2. Parse/canonical-validate the incoming artifact, verify its signature and trusted-key requirements according to the established security policy, and validate that its signed installation/customer scope is the stored operation's scope. Do not invent key-revocation behavior: the applicable policy for replay if a signing key has since been removed/compromised remains governed only by existing trust/security decisions; do not bypass current trust checks.
3. Compute the versioned semantic fingerprint and compare with the committed identity's stored fingerprint. A mismatch returns a non-disclosing conflict; do not reveal receipt contents or mutate state.
4. If identity and fingerprint match, return the stored receipt using a read-only path. Do not rerun new-operation state-transition checks that can now fail solely because a later successful operation superseded the original predecessor. In particular, do not reapply original supersession, window hand-over, current quota/capacity mutation, or success audit.
5. Do not restore historical effective state. Replay only reads the receipt; current license state remains whatever the latest committed version resolves to.

Replay still requires current authorization, scope and cryptographic artifact verification. It does **not** rerun time/state-dependent admission checks for a new import (for example, whether the old candidate may newly supersede its predecessor now, or whether it would overlap today's retained version). An independent failure of a required artifact/security check remains a refusal. The verifier uses the currently configured trusted-key set; if the signing key is no longer trusted, replay verification can fail even though the operation was accepted earlier. The consequence for receipt access after key removal/compromise is not separately settled: OQ-74’s key-compromise policy remains authoritative and open. This design adds no exception and does not change effective license state or invent revocation behavior.

- **Identity:** VLIC2 operation identity is `(installationId, operationId)`; VLIC1 keeps its existing hash-derived identity. Identity decides whether to look up the same operation's result.
- **Same-operation fingerprint:** a versioned digest checks the incoming request's semantic content and operation intent. Equality is necessary for replay, not authorization.
- **Different operation ID:** a new ID is a new operation even if effective grant content matches. Do not reject solely on semantic equality and never return the other operation's receipt. Apply the full new-operation validation above; existing chain/window rules may independently reject it.
- **Exact artifact hash:** retain the existing unique hash guard. Byte-identical VLIC2 necessarily has the same signed operation ID; a reissued artifact with a new ID has a different hash and is a new operation under Decision A.

### 2.2 VLIC2 fields

`canonicalizeLicenseVersion` emits, in declared order, `v`, `kind`, `operationId`, `licenseId`, `customerId`, `customerCode`, `customerName`, `installationId`, `status`, `validFrom`, `validUntil`, `organizationLimit`, `userLimit`, optional `deviceLimit`, sorted `modules`, sorted `features`, `supersedesOperationId`, `issuedAt`. The semantic fingerprint is **not** a change to that signed encoding.

| Field | Same-operation effective semantic fingerprint | Reason / independent checks |
|---|---|---|
| `operationId` | Excluded from digest; primary identity key | Changing it creates a different operation; it is signed and checked as identity. |
| `licenseId` | Included | License identity and binding are lifecycle-relevant; changing it is not hidden by fingerprint equality. |
| `customerId`, `customerCode` | Included | Customer binding and stable customer-code checks remain mandatory. |
| `customerName` | Excluded | PO Decision B: display-name-only variation is not effective license content. Existing customer display name is not overwritten on import (PDR-14). Payload/signature validation still applies. |
| `installationId` | Included and identity scope | Scope cannot be normalized away; current installation binding remains required. |
| `status` | Included | License lifecycle field; ordinary application still requires the permitted active status. |
| `validFrom`, `validUntil` | Included | Determine effective coverage; canonical UTC instants and exclusive-end/null semantics remain unchanged. |
| `organizationLimit`, `userLimit` | Included | Effective quotas; e.g. 50→70 changes semantic result and must not replay the 50 result. |
| `deviceLimit` | Include value and presence/`deviceLimitSpecified` | Omitted/unspecified, explicit unlimited (`null`) and finite value are distinct per PDR-15. |
| `modules`, `features` | Included as sorted sets | Entitlements define grant; compare normalized sorted arrays. |
| `supersedesOperationId` | Included | Determines the replacement-chain edge and can change which predecessor is retired. |
| `issuedAt` | Excluded | PO Decision B: issuance metadata is not effective grant content. Signature/payload validity checks still apply. |
| `kind`, `v` | Included as protocol discriminators | Must be supported and valid; no cross-kind/version semantic equivalence. |
| Signature bytes / key ID hint / file envelope | Excluded from semantic digest | Cryptographic verification and trust remain mandatory; file and bare-artifact transports decode to the same signed artifact. Hash/signature bytes are not effective grant semantics. |

Entitlement arrays are sorted as the existing canonicalizer does. Dates use the existing `toISOString()` canonical instant representation. The fingerprint proposal is SHA-256 over a domain-separated, version-prefixed deterministic encoding of this typed semantic tuple plus operation kind and applicable dedicated-operation reason. SHA-256 is already used for document/code hashes. A new fingerprint encoder/version is technical work; it must not alter canonical signed bytes, keys, signatures or PDR-16 vectors.

### 2.3 Operation-specific fingerprint inputs

| Request | Identity scope | Additional fingerprint inputs | Normalization / exclusions |
|---|---|---|---|
| Ordinary import | installation + VLIC2 operationId | kind=`import`; VLIC2 semantic tuple above | Decode envelope first; exclude envelope whitespace, file/text transport, headers, request time, trace IDs. |
| Gap recovery | same | kind=`gap-recovery`; trimmed reason | Recovery intent is distinct and audited under PDR-13; reason’s trimmed form is what the repository audit event records. |
| Customer transfer | same | kind=`customer-transfer`; trimmed reason | Dedicated route/permission and audited transfer reason (PDR-14); ordinary import cannot transfer. |
| Reduction resolution | same | kind=`reduction-resolution`; trimmed reason | Required audited authorization; conflict facts/usage are recomputed under locks, not caller-provided fingerprint fields. |

`assertOperationReason` validates trimmed minimum length and raw maximum length; transfer returns a trimmed reason, and repository audit helpers trim recovery/transfer/resolution reasons. The fingerprint must use the trimmed form, matching audit/result semantics. Caller identity, authorization headers, transport metadata, timestamps supplied by the client, and display/presentation fields are excluded. Actor attribution remains in audit; Decision D governs who may replay.

**Behavior:** new identity takes path A above and receives full admission/business-conflict evaluation. Existing identity takes path B: after current authentication/authorization, artifact signature/trust and scope checks, equal fingerprint returns the persisted receipt read-only; a mismatch is rejected without receipt disclosure or mutation. Replay does not rerun current-state admission checks, such as whether an already superseded predecessor may be retired now. Different identity—even with identical effective licensing content—is a new operation; validate normally and do not return another operation’s receipt.

## 3. Replacement chain, atomicity and concurrency

### 3.1 Existing enforced chain behavior

`evaluateImportConflicts` in `backend/src/modules/licensing/domain/license-version.ts` currently resolves an explicit `supersedesOperationId` by exact retained operation ID. The target must exist in this installation, have no recorded supersession, and be eligible at import time. A named target permits only that one overlap; other overlapping or historically conflicting windows are rejected. Repository `importVersion` locks the installation row and reruns this same evaluation against committed versions under the lock. It also verifies the resolved predecessor matches the precheck expectation. The predecessor is guarded by `supersededAt: null`; if the guard fails, the transaction aborts. Version + nested entitlement inserts, supersession stamp (`supersededAt`, `governsUntil`, successor links), binding changes and success audit writes are in one transaction.

Therefore:

- Failed validation or transaction rollback writes no OP-101 version, entitlement, supersession stamp, binding change, or applied/superseded success audit; OP-100 remains effective and its limit remains 50. The existing rejection-audit path may separately record a rejected attempt; it is not a partial success.
- A successful OP-101 commits its version, entitlements, predecessor stamp and applied/superseded audits atomically. The effective version is computed from retained windows, so the new 70-user limit applies at the successor’s `validFrom`; historical OP-100 is not reactivated by receipt lookup.
- Current allocation usage locks are also acquired where required by reduction checks. Concurrency is database-wide for an installation, not process-local.

These are verified source boundaries; replay receipt atomicity is **not implemented**. The proposed receipt/fingerprint must be stored in the same transaction as these effects and success audit. Replay must return stored data only; it must not rerun allocations, transition, supersession, customer-binding changes, or success audit.

### 3.2 Competing replacements and stale predecessor handling

**Competing branch:** first successful transaction wins. Once OP-101 retires OP-100, a concurrent or later OP-102 that explicitly names OP-100 is not allowed to replace OP-101 merely because its signature is valid or its limit is higher. Current code rejects a target already superseded. Under the lock the second importer sees OP-100’s committed supersession and is refused; it does not silently choose a higher limit.

**Narrow stale-pointer continuation proposal:** automatic resolution is permitted only for a *strict, date-proven contiguous continuation*, not for a competing overlapping branch. Given signed candidate naming an ancestor OP-X:

1. Follow persisted `supersededByVersionId` links from OP-X; require exactly one complete, acyclic chain with matching reciprocal predecessor links, one installation, one customer, and one `licenseId` (unless a separate approved recovery/transfer operation governs the case).
2. Require a unique current terminal version (the leaf has no successor and is eligible); any missing link, multiple successor, inconsistent link, cross-customer/install/license link, or non-current leaf fails closed.
3. Require the candidate to be a contiguous successor to the leaf: candidate `validFrom` equals the leaf’s finite `validUntil`. It must not overlap the leaf or any other retained effective/history interval, leave a prohibited renewal gap, backdate governance, or violate reductions/capacity/entitlements. A perpetual leaf, gap, overlap, or other ambiguous temporal relationship is not auto-resolved.
4. Apply the validated operation as a new version whose actual predecessor is the leaf, without altering the signed payload. Keep original signed `supersedesOperationId` for audit/provenance; record resolved predecessor separately as transaction result/audit context if implementation requires it, through an additive design reviewed separately.
5. Recompute all of the above under the installation lock and usage locks before writing. No precheck-only resolution.

This narrow rule gives a deterministic distinction: OP-102 trying to replace OP-100 over OP-101’s already-covered window is a competing overlap and is rejected; a candidate that exactly follows the end of the unique current leaf is a contiguous continuation and can be considered. A higher limit alone has no effect. This uses existing retained links and signed validity dates; it asserts no new cryptographic guarantee. This is a proposed technical realization of PO Decision H and must not be broadened to overlapping “best” candidates.

**Important source gap:** current implementation does not perform stale-predecessor resolution; exact stale targets are rejected. Also current schema has scalar `supersededByVersionId` and a guarded one-time retirement, which prevents multiple recorded successors in the normal path. If corrupted/inconsistent history presents multiple/invalid edges, reject; do not repair or guess.

### 3.3 Scope, trust and authority

Every operation must pass trusted signature verification and payload/canonical checks. License ID is bound to one installation and customer; service/repository rejects foreign binding. Installation customer mismatch is rejected on ordinary import; existing transfer is a separate explicit, permission-gated, reasoned and audited operation under PDR-14—not an OQ-81 shortcut. Recovery and reduction resolution retain their own permissions and checks. A valid signature alone does not authorize another customer/install or a broken chain.

The current server trusts configured Ed25519 public keys (`LICENSE_SIGNING_PUBLIC_KEYS`) and has no online Owner License lookup; the development issuer refuses production. Keep this narrow trust boundary. The current business authority is Owner License under PO control, potentially a specialist using an approved tool/process. No issuer registry, federated trust, KMS, multi-tenant issuer platform or arbitrary-file trust is proposed. Future approved issuer tooling can continue to issue the same signed format and be validated through existing key trust; no platform expansion here.

## 4. Receipt DTO, historical result and current state

### 4.1 Current public success responses

Each controller maps a fresh state through `toLicenseStateView(snapshot.license, snapshot.versions)` and adds operation fields:

| Endpoint | Current DTO | Added fields/source |
|---|---|---|
| import | `LicenseImportResultDto`: `LicenseStateDto` + `changed`, `outcome` | Fresh controller read; result flags from `LicenseImportService`. |
| gap recovery | `GapRecoveryResultDto`: state + flags + `lapsedLicenseId`, `coverageEnd` | Lapse facts originate in locked transaction; state is fresh controller read. |
| transfer | `LicenseCustomerTransferResultDto`: state + flags + `previousCustomerId`, `previousCustomerCode`, `previousLicenseId`, `bindingChanged`, `reason` | Binding facts from transaction; reason trimmed; state is fresh controller read. |
| reduction resolution | `ReductionResolutionResultDto`: state + flags + `resolvedPredecessorVersionId`, `resolvedConflicts` | Conflicts recomputed in transaction; state is fresh controller read. |

`LicenseStateDto` fields are `licensed`, `status`, `active`, `inactiveReason`, `installationId`, `customerId`, `customerCode`, `licenseId`, `validFrom`, `validUntil`, `organizationLimit`, `userLimit`, `deviceLimit`, `deviceLimitSpecified`, `entitlements`, `provider`, `effectiveVersionId`, `scheduledVersion`, and bounded `versions` history (up to 20).

### 4.2 Replay after replacement and unresolved response decision

**Required scenario:** OP-100 commits a 50-user grant and its receipt; OP-101 later commits a 70-user grant and supersedes OP-100. A currently authorized caller in the same installation scope retries OP-100. If signature/trust, scope and fingerprint checks pass, the retry must not fail merely because OP-100’s predecessor is now superseded; it returns through the read-only receipt path. It must not execute transition checks or mutate any licensing row, restore 50 users, or change the current effective OP-101 limit of 70. OP-101's success remains atomic; a failed OP-101 would leave OP-100 and the 50-user limit unchanged. Historical OP-100 result must not be confused with current state.

OP-100 receipt is a historical operation result. After OP-101 supersedes it, returning OP-100’s old state snapshot as if current could mislead clients; returning only current state would not replay the original response. Product policy requires historical result and current effective licensing state not be confused, but no exact replay DTO has been approved.

**Smallest safe proposal:** leave first-application response DTOs unchanged. For a replay, return a clearly marked replay representation containing (a) the persisted historical operation receipt, explicitly labelled/versioned as historical and keyed by operation/version IDs, and (b) a fresh current-state view in a separately named field. Do not return the historical state snapshot in the ordinary top-level fields as if current. Do not recalculate/overwrite the stored receipt. The exact envelope/fields/status code is a public API decision and must be approved before code/API changes. **OQ-81 remains open for this narrow DTO contract.**

Persist receipt with a schema version and deterministic serialization of the chosen public receipt. Never store raw license document, signature, private key, auth token, arbitrary HTTP headers or trace IDs. Receipt/fingerprint write must commit atomically with version, entitlements, customer/supersession changes and typed success audit. Replays add no success audit. Historical v2 rows without receipts cannot be backfilled from current state; retain existing duplicate refusal for those rows until explicit compatibility behavior is approved. After a lost response following commit, an authorized same-identity retry reads the durable receipt after restart. If transaction did not commit, no receipt/effect exists and retry may execute. An ambiguous commit is resolved by retrying same identity through the locked lookup, never speculative reapplication.

## 5. Authorization and VLIC1

Before receipt lookup/disclosure: authenticate; require `Licensing.License.Activate`; additionally require `RecoverAfterGap`, `TransferCustomer`, or `ResolveReduction` for the corresponding operation; parse/canonical-validate and verify the signed artifact using the established trusted-key policy; bind the request and authorized caller to the same installation/customer scope; then compare fingerprint. Caller knowing an operation ID is never sufficient. **Decision D:** any caller currently holding required permission(s) in the same customer-installation scope may receive the receipt; original actor matching is not required. On a matching replay, do not repeat new-operation, time-dependent admission or state-transition checks. Do not let replay bypass the security checks above or mutate state.

VLIC1 has no operation ID and current legacy behavior uses its hash-derived identity. Where the existing already-governing legacy case applies and no receipt exists, preserve `changed:false`, `outcome:UNCHANGED`. This is a no-op, not replay. Do not reconstruct/backfill a historical receipt or add VLIC1 receipt storage. Other VLIC1 lifecycle rules remain unchanged.

## 6. Implementation plan and acceptance (separate authorization required)

A later implementation should be bounded to Licensing domain/application/data/API response mapping plus an additive Licensing migration if approved. Retain the modular-monolith boundary, installation/usage locks and unique indexes. No universal idempotency engine or broad payload table.

Acceptance cases: exact same operation/fingerprint replays without duplicate effects/audit; mismatch under same operation rejected; semantically identical new operation ID not rejected solely by fingerprint but must satisfy normal rules; 50→70 successful replacement atomically changes current result; validation/transaction failure leaves 50 unchanged; competing overlapping replacement loses under sequential and concurrent requests; stale target auto-resolves only under narrow clear contiguous criteria and otherwise fails closed; replay of OP-100 after OP-101 never restores 50; customer/install/issuer/signature/authorization checks persist; any authorized in-scope caller may replay; VLIC1 no-receipt retry remains `UNCHANGED`; historical v2 without receipt is not fabricated; canonical bytes/vectors remain unchanged. OQ-45 and OQ-82 policy decisions are maintained in their canonical records; this design does not alter them.

## 7. Status and open scope

Product decisions A–J are incorporated. OQ-81 remains **OPEN for approval of the replay response representation** described in §4.2 and its later implementation/verification. OQ-45's UTC Grace boundary and OQ-82's manual replacement order/confirmation window are decided in their canonical records; their separate implementation and evidence gaps remain. Current v2 duplicate rejection and lack of durable receipts remain implementation gaps; stale-predecessor auto-resolution is a proposed future behavior, not currently implemented.
