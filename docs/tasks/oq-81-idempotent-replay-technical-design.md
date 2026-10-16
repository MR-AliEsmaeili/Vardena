# OQ-81 — Exact successful-result replay: technical design

**Status:** Updated design for Product Owner/reviewer review; not approved for implementation. OQ-81 remains open. The three Owner decisions incorporated here are: (1) semantically repeated license content under a different operation ID is rejected and never receives another operation's receipt; (2) fingerprints cover contractually meaningful operation inputs, not arbitrary HTTP fields; (3) VLIC1 retains `UNCHANGED` where no original receipt was persisted. This document specifies a technical proposal and identifies the remaining Owner decisions; it does not create new product policy.

## Baseline and source evidence

The repository baseline inspected is `main`/`origin/main` at `712085a97a487eef09744a8fd4ecd1b36133fde0`. Relevant current paths include:

- `backend/src/modules/licensing/domain/license-document.ts`: VLIC2 payload parsing, `canonicalizeLicenseVersion`, `licenseDocumentHash`.
- `backend/src/modules/licensing/application/license-import.service.ts`: ordinary import, recovery, transfer, reduction resolution, authorization rechecks and receipt-domain results.
- `backend/src/modules/licensing/api/license-{import,gap-recovery,customer-transfer,reduction-resolution}.controller.ts`, `license-state.view.ts`, `api/dto/license.dto.ts`: HTTP permissions and actual response mapping.
- `backend/src/modules/licensing/data/licenses.repository.ts`: transaction, installation lock and success writes.
- `backend/prisma/schema/licensing.prisma`: unique keys on installation+operation ID and installation+document hash.
- Policy: PDR-11 §§8, 10.8, 20.6; PDR-12/OD-LIC-01; PDR-13; PDR-14; PDR-15; PDR-16; ADR-0045/0046; `docs/licensing-architecture.md`; this document's companion §5 in `docs/licensing/version-model-and-file-exchange.md`.

The shared application pipeline checks `Licensing.License.Activate` on every import and also checks the dedicated transfer, recovery, or reduction-resolution permission when that intent is supplied. Controllers repeat those guards. The installation identity is a singleton boundary; the service validates installation/customer binding against the signed payload. Audit records attribute an actor, but no source evidence establishes that the original actor alone owns/read-accesses an operation receipt.

## VLIC2 semantic-content equivalence (distinct from identity and replay)

`canonicalizeLicenseVersion` emits the following VLIC2 canonical payload fields in fixed order: `v`, `kind`, `operationId`, `licenseId`, `customerId`, `customerCode`, `customerName`, `installationId`, `status`, `validFrom`, `validUntil`, `organizationLimit`, `userLimit`, optional `deviceLimit`, sorted `modules`, sorted `features`, `supersedesOperationId`, `issuedAt`. `licenseDocumentHash` hashes the trimmed full artifact text, including signature. VLIC2's `operationId` is signed; changing it changes canonical bytes and, for a newly signed artifact, the signature and artifact hash. Thus exact artifact bytes cannot encode a different operation ID. The Owner decision also covers reissued/re-signed artifacts with a changed ID but otherwise semantically repeated content; the exact document-hash unique index alone cannot detect those.

**Proposal for review:** keep operation identity/fingerprint separate from a versioned semantic-content projection. Compare the projection only to refuse reuse under a different operation ID; never use it to find or return a prior receipt. Preserve both existing unique constraints. No signed bytes, canonicalizer, signature, keys or vectors change.

| VLIC2 field | Proposed content-equivalence treatment | Rationale / evidence and review point |
|---|---|---|
| `operationId` | Exclude | It is operation identity, not grant content. If included, changing it defeats the cross-ID content guard. Used separately for exact replay key. |
| `licenseId` | Include | Identifies the commercial license in retained versions and binding rules; a changed license identity is not assumed to be the same artifact. Example 4 below. |
| `customerId` | Include | Defines commercial customer binding; changing it is a different binding and subject to transfer policy. |
| `customerCode` | Include | PDR-14 stable customer identity/binding contract; not merely descriptive text. |
| `customerName` | **Owner confirmation required**; proposal exclude | Current importer does not overwrite existing customer display name on import (PDR-14). But this is signed payload content; whether a name-only change counts as semantic repetition is not expressly settled. Proposed exclusion treats it as presentation metadata, while signature validation remains mandatory. |
| `installationId` | Include | Hard installation binding; a change must never be collapsed into equivalent content. |
| `status` | Include | Status is a grant/lifecycle property; current parser accepts specific statuses and import rejects non-active candidates. |
| `validFrom`, `validUntil` | Include | Define the coverage window; changed coverage is genuinely different grant content. Canonical UTC instants, exclusive end/null semantics retained. |
| `organizationLimit`, `userLimit` | Include | Grant capacity; a changed limit is materially different. |
| `deviceLimit` | Include value **and specified/omitted state** | PDR-15 distinguishes unspecified legacy field from explicit unlimited (`null`) and finite quota. Preserve omission semantics; do not normalize omitted and null together. |
| `modules`, `features` | Include as sorted sets | Canonicalizer sorts these arrays and entitlements define grant. Equality compares normalized sorted arrays, not source order. |
| `supersedesOperationId` | **Owner confirmation required**; proposal include | Names the version lifecycle transition and may change predecessor/supersession effects; therefore not safely ignored as descriptive metadata. A candidate with same grant fields but a different predecessor may be a materially different lifecycle operation. |
| `issuedAt` | **Owner confirmation required**; proposal exclude | Provenance/issuance instant is signed but not used by current retained-version evaluation as grant window; changing it alone appears not to change entitlement. Product contract does not explicitly say it is semantically irrelevant for duplicate-content policy. |
| `kind` | Include as protocol discriminator | Must match the supported license-document kind; incompatible kind is invalid, not equivalent. |
| `v` | Include as protocol version | Must match the supported version. No cross-version semantic collapsing is proposed. |

The semantic projection should be a typed value, not a modification to the signed canonicalizer. Fixed field order; UTC instants in the existing three-fraction-digit ISO form; arrays sorted as the protocol specifies; explicit distinction for omitted `deviceLimit` versus `null`; then SHA-256 over domain-separated, version-prefixed UTF-8 JSON (or an equivalently fixed binary encoding). SHA-256 is already used by `licenseDocumentHash` and legacy code hashing; the projection encoding/version is a new technical contract and requires review. Hash collision risk is negligible but equality should be based on the digest plus stored projection version; no raw signed document is retained for this purpose.

### Examples and expected outcomes

1. **Identical artifact bytes submitted again:** same signed operation ID and exact document hash. After authorization and validity checks, matching receipt/fingerprint returns its receipt; absent a receipt (historical row), preserve safe existing duplicate refusal rather than inventing a result.
2. **Same projected content, changed operation ID, re-signed:** operation identity differs and document hash changes, but semantic projection matches. Reject as semantically repeated content; do not return old receipt. This is the added comparison required by Owner policy.
3. **Genuinely changed grant under a new operation ID:** changed limit, entitlement, validity, customer, or installation means projection differs. It is not classified as semantically equivalent; normal binding, signature, precedence, reduction and retained-history rules decide whether it may apply.
4. **Changed `licenseId`, otherwise similar:** projection differs. It is not a replay/content duplicate under this proposal, but it still must satisfy license-ID binding, customer and lifecycle rules; a new identity does not bypass recovery/gap rules.
5. **Changed `issuedAt`, otherwise similar:** proposal treats content as equivalent and rejects different-ID reapplication; Owner must confirm whether provenance-only distinction is intended.
6. **Explicit supersession with changed permitted grant properties:** include the supersession target and grant properties in projection; if the target differs, projection differs. The new operation is evaluated under existing PDR-12 term rules and PDR-11 precedence/reduction checks. It cannot use replay to skip the transition. If same target and same grant are reissued with another operation ID, proposal considers it semantic duplicate; Owner confirmation on this projection is required.

### Product questions required before implementation

- Should `customerName` differences alone count as semantic content difference or repetition?
- Should `issuedAt` differences alone count as semantic content difference or repetition?
- Must `supersedesOperationId` be included in equivalence exactly as proposed, so a different named predecessor is a distinct lifecycle operation, or should same grant content be rejected despite that difference?

These are narrow product-semantic questions. The source defines signed fields and current use, but does not determine those duplicate-policy outcomes. No option is recorded as Owner decision here.

## Versioned request fingerprint proposal

Identity, validity/authorization, semantic content equivalence, and request fingerprint are separate concepts:

- **Identity:** VLIC2 `(installationId, operationId)`; VLIC1 existing hash-derived legacy identity. Customer is separately bound and validated.
- **Fingerprint:** same-identity request consistency and response-semantic equality. It does not grant access.
- **Semantic content digest:** cross-operation duplicate refusal described above; it never selects a receipt.
- **Validity/access:** authentication, required permissions, signature/canonical validation, installation/customer binding, and applicable current business checks remain required before a receipt is returned. Replay bypasses only repeating the committed mutation, not these checks.

| Entry point / kind | Identity scope | Proposed fingerprint inputs | Excluded inputs | Normalization and expected behavior |
|---|---|---|---|---|
| Ordinary import | Installation + signed VLIC2 `operationId` | Fingerprint version; kind `import`; installation ID; validated signed artifact semantic content including operation ID (document hash may be included as an exact-artifact discriminator) | Envelope formatting/key wrapper, text-vs-file transport, HTTP headers, request time, trace/correlation IDs | Decode envelope to artifact; validate and canonical-parse first. Matching identity+fingerprint => receipt; matching identity+mismatch => conflict. Different identity+equivalent projection => reject, no receipt. |
| Gap recovery | Same signed identity/scope | Same artifact inputs; kind `gap-recovery`; validated reason because it is audit/result-semantic under PDR-13 | Transport/presentation metadata; actor ID is authorization/audit context, not an established receipt discriminator | Reason is checked against trimmed length but code currently records/passes paths inconsistently; propose trim once and fingerprint exactly the persisted/audited/returned form. Confirm implementation behavior before coding. |
| Customer transfer | Same signed identity/scope | Same artifact inputs; kind `customer-transfer`; reason, because transfer receipt and typed audit include it | Transport/presentation metadata, trace IDs | Current service explicitly returns `reason.trim()` and documents it equals audited reason. Fingerprint that exact trimmed string. |
| Reduction resolution | Same signed identity/scope | Same artifact inputs; kind `reduction-resolution`; reason because audited; not recomputed conflict facts | Usage snapshot, conflict result, request timestamp, transport fields | Conflict facts are recomputed under transaction locks, not caller-selected identity inputs. Proposed trim reason as semantic value, but confirm exact value written by audit path. |

Operation kind is included because dedicated intents have distinct authorization, audit, and result shapes even when artifact/reason happen to match. Installation scope is included and also enforced in lookup. Reasons are included only for the dedicated operations whose contracts make them required and audited/result-relevant. Authenticated actor is not asserted as fingerprint input: current contracts identify permission gates and audit actor attribution, but do not state original-actor-only replay. This is a separate access-policy question below.

Encoding: recommended `SHA-256(UTF-8("vardena-license-replay\0v1\0" + deterministic canonical semantic tuple))`, with JSON fixed key order and protocol-normalized values or an explicitly specified length-prefixed encoding. Domain prefix prevents cross-purpose hash reuse. Store fingerprint version alongside digest; a future version is additive and must define how old receipts are compared, never silently reinterpret prior fingerprints. The exact string/byte grammar is a technical proposal, not an existing repository contract.

## Current response shapes and proposed receipt semantics

All four HTTP controllers return a fresh `LicenseStateView` mapped through `toLicenseStateView(snapshot.license, snapshot.versions)`, plus operation-specific fields. State fields are `licensed`, `status`, `active`, `inactiveReason`, `installationId`, `customerId`, `customerCode`, `licenseId`, `validFrom`, `validUntil`, `organizationLimit`, `userLimit`, `deviceLimit`, `deviceLimitSpecified`, `entitlements`, `provider`, `effectiveVersionId`, `scheduledVersion`, and bounded `versions` history (max 20), per `backend/src/modules/licensing/api/license-state.view.ts` and `LicenseStateDto`.

| Endpoint | Current public successful shape | Current source of added receipt fields |
|---|---|---|
| `POST /api/v1/license/import` | LicenseStateView + `changed`, `outcome` (`LicenseImportResultDto`) | Controller fresh read; application result supplies flags. |
| `POST /api/v1/license/gap-recovery` | Same + `lapsedLicenseId`, `coverageEnd` (`GapRecoveryResultDto`) | App receipt takes lapsed facts from import transaction; controller adds fresh state read. |
| `POST /api/v1/license/customer-transfer` | Same + `previousCustomerId`, `previousCustomerCode`, `previousLicenseId`, `bindingChanged`, `reason` (`LicenseCustomerTransferResultDto`) | Transaction supplies previous binding/license and changed fact; reason returned trimmed; controller adds fresh state read. |
| `POST /api/v1/license/reduction-resolution` | Same + `resolvedPredecessorVersionId`, `resolvedConflicts` (`ReductionResolutionResultDto`) | App result uses transaction-recomputed conflicts; controller adds fresh state read. |

**Recommended contract:** persist and replay the exact original public HTTP success representation, including its original state snapshot and operation-specific additions, as an opaque versioned receipt. That is the only interpretation consistent with “previously persisted result” and avoids making a retry appear to be a new read at a later time. Do not recompute `currentState()` for replay. The receipt version identifies the DTO serialization schema; existing response schema is evidence, not a newly invented shape. Receipt bytes should use deterministic JSON serialization over DTO field order/values, preserving nulls and array ordering as returned. API changes that alter the receipt shape require an explicit compatibility/versioning plan.

Current architecture constructs the state snapshot in the HTTP controller after the application transaction, so it is not presently atomic with the operation. To meet OQ-81, implementation must move receipt construction to a boundary where it can capture the response facts consistently and persist them atomically with the transaction. For transfer, receipt should contain the same public state/extra fields returned on initial success, not only the domain transfer receipt. Whether building the bounded state view within the Licensing transaction/repository is architecturally acceptable is a technical design question for implementation review; do not claim current atomicity of the HTTP response.

Receipt MUST NOT contain raw signed document, signature, key material, access token, HTTP headers, trace IDs, or secrets. Keep fingerprint/content digests and receipt under Licensing access controls; audit remains typed audit, not a duplicate receipt store.

## Authorization, scope, transaction and recovery

Before lookup/return: authenticate; recheck `Licensing.License.Activate`; for recovery, transfer, or resolution also recheck the corresponding dedicated permission; validate document signature/canonical form; validate installation and customer scope; run applicable validity/business rules while ensuring an already-applied duplicate is recognized before rules that would incorrectly reject solely because state has since changed. Caller knowing `operationId` is insufficient; receipt query is installation-scoped and inaccessible without those checks.

Current ordinary import requires Activate; recovery requires Activate + RecoverAfterGap; transfer requires Activate + TransferCustomer; reduction resolution requires Activate + ResolveReduction. `LicenseImportService.runImport` rechecks permissions. Installation/customer binding is checked from the existing identity and signed payload. No existing contract establishes original-actor-only receipt access or affirmatively grants every authorized installation user the right to read prior operation results. Actor is stored on audit events. **Owner question:** may any caller currently holding the exact operation permission(s), within the same installation/customer boundary, retrieve the original receipt, or must the caller match original actor? Recommend any currently authorized caller under same scope because authorization is already permission-based and installation is the ownership boundary; Product Owner must confirm.

Repository transaction is `READ COMMITTED`, locks installation row, reruns conflicts, and writes versions, entitlements, customer binding/supersession changes, and success audit atomically. Proposal adds fingerprint and response receipt in that same transaction. On the lock, same identity/matching fingerprint returns stored receipt without repeating quota/allocation, transition, supersession, binding, or success audit. Same identity/mismatch conflicts. Different identity/semantic-equivalent content is refused, never mapped to prior receipt. For recognized unique-constraint races, re-read only under the same authorized installation scope and compare identity, fingerprint, and content digest; unrelated unique violations stay errors.

After committed transaction but lost response, retry resolves receipt after process restart. If transaction rolled back, no receipt or success effects exist and retry may execute normally. If client/database cannot tell whether commit completed, same authorized retry locks and looks up durable state; it must not blindly repeat effects. Historical V2 versions without receipts cannot be reconstructed from current state; preserve current duplicate refusal until a receipt exists, unless Product Owner directs otherwise.

## VLIC1, migration, compatibility

VLIC1 has no operation ID and the existing legacy identity is hash-derived. For the documented already-governing repeated-code case, code returns `changed:false`, `outcome:UNCHANGED`; no persisted original response is evidenced. This is compatibility no-op, not exact receipt replay. Do not fabricate/backfill a receipt or add VLIC1 receipt storage in this task. If a future genuine receipt exists, only its actual persisted content can be replayed after applicable authorization; no current such record is established.

VLIC2 persistence likely needs an additive Licensing migration for content digest, request fingerprint, receipt version and receipt data. Do not edit applied migrations, rewrite audit/history, or claim historical rows have responses. Rollback must preserve old state and clearly acknowledge that removing receipts disables replay; define downgrade/retention plan before implementation (OQ-77). No changes to canonical bytes, signatures, vectors, keys, `supersedesOperationId` semantics, PDR-12 term rules, PDR-13 recovery, or PDR-15 cancellation/replacement constraints. OQ-45 and OQ-82 remain outside scope.

## Bounded future implementation and acceptance

After design approval and a separate implementation instruction: settle the Product Owner questions above; review DTO snapshot construction and reason normalization; lock field projection and byte encoding; implement only Licensing persistence/service/controller mapping as needed with additive migration; retain lock order and constraints; add focused rollback, restart, concurrency, authorization, exact-response, semantic-content and compatibility tests; run CI on the exact implementation SHA. No universal idempotency framework.

Acceptance: identical authorized request replays exact original response after restart; same identity/different fingerprint conflicts; changed-ID same projected license content is refused and never gets prior receipt; genuinely changed grant follows current rules; atomic receipt/audit/effects; no duplicate allocation/state/audit; rollback/no-commit safe retry; lost-response retry safe; each operation permission and scope verified; historical v2 missing receipt safely handled; VLIC1 remains `UNCHANGED`; vectors and signed bytes unchanged.

## Remaining decisions and design questions

**Product Owner decisions required:** semantic equivalence treatment of `customerName`, `issuedAt`, and `supersedesOperationId`; whether receipt retrieval is any currently authorized caller within installation/customer scope or original actor only.

**Technical design questions:** exact deterministic JSON/byte serializer and fingerprint version grammar; whether transaction can construct the exact HTTP snapshot receipt without cross-layer coupling; additive storage shape and rollback/retention; behavior for historical v2 rows without receipts. These are not reasons to alter signed protocol or authorization defaults. OQ-81 is not ready for implementation until central content projection and response/access contract are approved.
