# Product & Business Decision Records — Master Index

Status: Living document · Created: 2026-09-22 · Owner: Ali Esmaeili

This directory holds **product/business-level decision records** for Vardena.
Architecture-level records stay in [`docs/adr/`](../../adr/README.md); the single
registry of Open Question texts and statuses stays in
[`docs/open-questions.md`](../../open-questions.md). These records do **not**
duplicate that registry — each product OQ below is the *full decision record*
(context, options, recommendation) while `docs/open-questions.md` carries the
one-row registry entry pointing here.

## Conventions

- **OQ-xx** — product/business open question. Created when the product owner
  must answer a business question with multiple valid directions. IDs continue
  the central registry (`docs/open-questions.md`): product OQs start at OQ-44.
- **PDR-xx** — *Product Decision Record*: a decided product/business matter,
  recorded like an ADR but for product/commercial decisions (ADR-0001 style
  process does not apply to these; they are not architectural).
- **ADR-xxxx** — architecture decision records, in `docs/adr/`. Product records
  here may *require* or *cite* ADRs but never modify them.

Statuses: `Open` · `Decided` · `Deferred` · `Superseded`.
Nothing is marked Decided unless Ali Esmaeili has explicitly approved it.

> **Licensing decision reconciliation (2026-10-16):** current policies are in
> PDR-11 §21 and the concise [traceability matrix](../../tasks/licensing-po-decision-traceability-2026-10-16.md).
> OQ-45's natural-subscription-expiry UTC boundary is decided; distinct termination remains
> open. OQ-74–OQ-85 decisions are recorded with technical/API/implementation
> gaps kept open; OQ-84 remains product-closed. No new OQ was created and no
> implementation is claimed. Earlier dated notes remain historical unless
> superseded by the 2026-10-16 addendum.

## Records

| ID | Title | Type | Status | Blocks MVP |
|---|---|---|---|---|
| [PDR-17](./PDR-17-owner-web-application-phase-1.md) | Owner web app, separate PostgreSQL, two-role RBAC policy, audit and manual observations | PDR | Decided directions; two-role policy and replacement/retention boundary recorded; permissions/archive/replacement implementation evidence outstanding | Owner first slice |
| [OQ-44](./OQ-44-multi-device-offline-sync.md) | Multi-device offline sync: scope and timing | OQ | Open | No (excluded from MVP) |
| [OQ-45](./OQ-45-license-expiry-behavior.md) | License expiry behavior (incl. internet outage, post-termination mode) | OQ | **Partially decided (2026-10-16); OPEN** for contract-termination strictness and implementation; natural-subscription-expiry Grace = signed expiry + 14×24h UTC, `now >= boundary`; intentional subscription cancellation gets no automatic Grace | Enforcement/verification not implemented |
| [OQ-46](./OQ-46-customer-data-export-format.md) | Customer data export format and completeness | OQ | Open — **Excel = Business Export ≠ full technical backup decided (2026-10-05)**; contract-end boundary open | No (Excel confirmed) |
| [OQ-47](./OQ-47-exchange-rate-and-multicurrency-rules.md) | Exchange-rate and multi-currency accounting rules | OQ | Open — **deferred by Owner ("do nothing for now", 2026-10-05)** | No (single-currency MVP) |
| [OQ-48](./OQ-48-revaluation-and-fx-gain-loss.md) | Revaluation and foreign-exchange gain/loss | OQ | Open | No (single-currency MVP) |
| [OQ-49](./OQ-49-report-builder-mvp-depth.md) | Report Builder MVP depth | OQ | **Decided (2026-10-05)** — A + controlled subset of B | Scope level fixed |
| [OQ-50](./OQ-50-webhooks-and-api-surface.md) | Webhooks and API surface beyond ADR-0029 | OQ | Open | No |
| [OQ-51](./OQ-51-taxpayer-release-boundary.md) | Taxpayer System integration release boundary | OQ | Open — **boundary decided (2026-10-05): Stage 1 prep in scope, Stage 2 post-MVP**; slice detail open | No (excluded; document model only) |
| [OQ-52](./OQ-52-backup-rpo-rto-targets.md) | Backup RPO/RTO formal targets | OQ | Open (**reconfirmed 2026-10-05** — no numbers; backup capability is part of V1) | Foundation only |
| [OQ-53](./OQ-53-disaster-recovery-and-restore.md) | Disaster recovery, server replacement, restore self-service | OQ | Open — **restore authority decided (2026-10-05): admin-only, runbook-driven, never in-product for normal users** | Foundation only |
| [OQ-54](./OQ-54-finalized-document-deletion-editing.md) | Finalized document deletion/editing policy | OQ | **Decided (2026-10-05)** — Option B: edit until Accounting Post, then cancel/correct only (OD-54-01…11) | Policy posture fixed |
| [OQ-55](./OQ-55-branch-as-cost-center.md) | Branch as cost center | OQ | Open | No |
| [OQ-56](./OQ-56-two-book-accounting.md) | Two-book accounting architecture | OQ | Open | No |
| [OQ-57](./OQ-57-marketplace-extension-security.md) | Marketplace & third-party extension security | OQ | Open (deferred) | No |
| [OQ-58](./OQ-58-public-release-vs-internal-only.md) | Public release vs internal-only distribution | OQ | Open | No (commercial) |
| [OQ-59](./OQ-59-product-family-vs-consolidation.md) | One ERP + products vs product family / consolidation strategy | OQ | Open — **Product Family deferral confirmed (2026-10-05); ERP core is the priority** | No (strategic) |
| [OQ-60](./OQ-60-mvp-acceptance-thresholds.md) | MVP acceptance thresholds | OQ | Open — **completion definition decided (2026-10-05, PDR-06)**; numbers unratified | Yes (ratification of numbers) |
| [OQ-61](./OQ-61-crm-ticketing-timing-ownership.md) | CRM/ticketing timing and ownership | OQ | Open | No |
| [OQ-65](./OQ-65-barcode-lifecycle-and-reuse.md) | Item barcode lifecycle, reuse and comparison semantics | OQ | Open — **no-reuse-ever decided (OD-65-01, 2026-10-05)**; comparison semantics open | No (blocks only the barcode-uniqueness candidate C-55) |
| [PDR-01](./PDR-01-item-quantity-precision-and-conversions.md) | Quantity precision and unit-conversion semantics (OQ-29 Option A) | PDR | Decided (2026-10-02) | OQ-29 stays Open (partially resolved) |
| [PDR-02](./PDR-02-item-taxonomy-and-capabilities.md) | Item taxonomy and capability governance (OQ-33 Option D) | PDR | Decided — governance rule only (2026-10-02) | OQ-33 stays Open (taxonomy confirmation withheld) |
| [PDR-03](./PDR-03-item-barcode-policy.md) | Item barcode policy (Option A) | PDR | Decided (2026-10-02) | Lifecycle detail split out as OQ-65 |
| [PDR-04](./PDR-04-item-deletion-and-code-reuse.md) | Item deletion eligibility (OQ-36 Option C) | PDR | Decided in part (2026-10-02) | OQ-36 stays Open (code reuse unanswered) |
| [PDR-05](./PDR-05-inventory-valuation-and-cost-optional-operations.md) | Inventory valuation foundation and cost-optional warehouse operations (OQ-24 — partial) | PDR | Decided (2026-10-04) | OQ-24 stays Open (broader COGS/accounting policy, landed cost, precision and other unresolved topics; return-costing conventions are in PDR-08) |
| [PDR-06](./PDR-06-initial-usable-product-v1.md) | Vardena Initial Usable Product / V1 — MVP completion definition + 2026-10-05 re-baseline index | PDR | Decided (2026-10-05) | OQ-60 stays Open (numeric thresholds unratified) |
| [PDR-07](./PDR-07-inventory-pricing-sources-and-periodic-pricing-operation.md) | Inventory pricing sources, the periodic Pricing Operation, and the Accounting eligibility gate (OD-PRC-01…12, OD-VH-01, OD-DOC-01/02) | PDR | Decided (2026-10-06) | OQ-24 stays Open; opens OQ-70 / OQ-71 |
| [PDR-08](./PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md) | Transfer / Purchase Return / Sales Return / Reversal / Reverse Pricing valuation (OD-TRF-01…09, OD-RET-01…07, OD-REV-01…08, OD-RVP-01…08, OD-PDP-01…05) | PDR | Decided (2026-10-06) | **Resolves OQ-67 and OQ-68**; OQ-70 / OQ-71 stay Open for their Accounting-side counterpart |
| [PDR-09](./PDR-09-inventory-accounting-posting-boundary.md) | Inventory → Accounting posting boundary and Owner decisions (PO-01…PO-12; C-61) | PDR | Decided (2026-10-07) | Records approved boundaries; OQ-24/25/39/42/69/70/71/72 remain Open; no implementation authorized |
| [PDR-11](./PDR-11-vardena-licensing-product-requirements.md) | Vardena licensing product requirements — canonical source of truth (server/device licensing, Owner administration, replacement, expiry, recovery, offline exchange) | PDR | Decided — approved product requirements, updated 2026-10-16; documentation is not implementation | Current decisions and traceability in §21; unresolved technical/API gaps remain in registry; §19–20 preserve dated history |
| [PDR-10](./PDR-10-c62-inventory-accounting-posting-modes.md) | C-62 Inventory → Accounting posting modes (Owner-approved C62-OD-01…06; PDR-09 boundaries; no implementation authorized) | PDR | Decided (2026-10-08) — Owner-approved decision package recorded in the file; OQ-39/OQ-42/OQ-72 remain Open | Records approved C-62 decisions; index row added 2026-10-11 (PDR-11 §19, CF-15) |
| [PDR-12](./PDR-12-license-term-supersession.md) | License term change through explicit signed supersession (**OD-LIC-01**) — a perpetual grant may be replaced by a time-limited one by an explicit valid signed supersession, subject to non-reduction of `organizationLimit`, `userLimit` and entitlements | PDR | **Decided — Final Owner Decision (2026-10-12)** | Binds the licensing import path; **OQ-87 stays Open**; L-04 (§8.6 capacity-conflict detection + resolution flow) remains outstanding and is **not** completed by it |
| [PDR-13](./PDR-13-post-gap-recovery.md) | Post-gap recovery through a dedicated audited operation (**OD-LIC-02**, OQ-87 **Option B**) — a NEW license identity may cover a lapse for the same customer + installation ONLY via a dedicated, explicitly authorized, reasoned, audited recovery operation; ordinary import is never a recovery path; L-04 (§8.6 usage-aware reduction check + explicit resolution) implemented in the same change | PDR | **Decided — Final Owner Decision (2026-10-12)** | Answers **OQ-87** via OD-LIC-02; dated §8 addendum proposes OD-LIC-05 for C10 and is implemented for review. OQ-87 remains open under the registry convention; no OQ is closed by the proposal. OQ-79/OQ-82/OQ-83/OQ-84/OQ-77 untouched |
| [PDR-14](./PDR-14-licensing-customer-code.md) | Stable customer code across the license lifecycle (**OD-LIC-03**, **L-06**) — every licensing customer has a stable, independent business `customerCode` (`licensing.customers.customer_code`) while `customerId` remains internal identity and `customerName` remains a non-identity display name never overwritten by ordinary import; signed license artifacts (`VLIC2` and `VLIC1`) carry `customerCode`, issuance/CLI require explicit valid `customerId` + `customerCode`, renewals and imports enforce customer/code consistency (`customer-code-mismatch`), and customer/installation rebinding requires the explicit audited transfer operation | PDR | **Decided — Final Owner Decision (2026-10-14)** | Resolves **L-06** across customer persistence, signed artifacts, issuance, renewal, import conflict evaluation, and transfer audit |
| [PDR-15](./PDR-15-client-device-licensing-and-replacement.md) | Client-device licensing, quota and replacement (**OD-LIC-04**, OQ-83) — key-based identity, client-side private keys, retained history, atomic quota-neutral replacement; later MVP manual Owner Admin workflow | PDR | **Decided; superseding policy addendum 2026-10-16** | OQ-83 remains OPEN for implementation review/reconciliation; OQ-84 and OQ-78/OQ-82/OQ-85 remain separate
| [PDR-16](./PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md) | Licensing protocol canonical byte contract and conformance vectors (D-2(a)=VECTORS_ONLY, D-2(b)=APPROVE) | PDR | **Decided (2026-10-15)** | Ratifies measured Node.js canonicalization as normative contract; publishes deterministic vector corpus; OQ-83 implementation review and OQ-85 operational evidence remain OPEN; ADR-0048 remains Proposed; no production Owner issuer or Phase 2

> **Numbering note (2026-10-02).** `OQ-62`, `OQ-63` and `OQ-64` are accounting /
> migration questions that live only in the central registry
> ([`docs/open-questions.md`](../../open-questions.md)); they have no record in
> this directory. `OQ-65` is the next free id in the central registry and is a
> product question, so its full record lives here.
>
> **PDR-12 recorded (2026-10-12).** [`PDR-12`](./PDR-12-license-term-supersession.md)
> transcribes the Product Owner's final decision (decision id **OD-LIC-01**) on
> the license-term question left ambiguous by the OQ-80/OQ-86 decision round: an
> explicit, valid, signed supersession may convert a perpetual grant into a
> time-limited one, and only that — `organizationLimit`, `userLimit` and the
> granted entitlements may not be reduced, on any path. It closes no OQ
> (OQ-80/OQ-86 keep their recorded status; **OQ-87 stays Open**) and does not
> implement L-04.
>
> **PDR-13 recorded (2026-10-12).** [`PDR-13`](./PDR-13-post-gap-recovery.md)
> transcribes the Product Owner's final decision (decision id **OD-LIC-02**) on
> **OQ-87**: post-gap recovery for the same customer + installation is
> permitted ONLY through a dedicated, explicitly authorized, audited recovery
> operation capturing a reason with traceable history
> (`license.import.recovered` + `previous_license_id`); the ordinary license
> import is NOT a permitted post-gap recovery path (stable 409
> `post-gap-recovery-requires-dedicated-operation`, nothing written). The same
> change implements the **L-04** slice (PDR-11 §8.6) that was registered as
> blocked on this decision: usage-aware reduction conflicts
> (`reduction-requires-resolution` with a structured explain payload, 409,
> nothing written) and the dedicated, reasoned, audited
> `reduction-resolution` operation. PDR-12's term rule is untouched: an open
> end is never operator-resolvable. **Historical status note (2026-10-12):**
> OQ-82/OQ-83/OQ-84 were then open; OQ-84 is now product-closed, while
> OQ-82/OQ-83 retain implementation/evidence follow-ups under PDR-11 §21.
>
> **Registry-only licensing rows (2026-10-11).** `OQ-74`…`OQ-85` are licensing
> product/security questions registered in the central registry
> ([`docs/open-questions.md`](../../open-questions.md)) only — they have no
> record file in this directory, exactly like `OQ-62`…`OQ-64`. They exist so the
> unresolved items of [PDR-11](./PDR-11-vardena-licensing-product-requirements.md)
> §15 have stable identifiers; registering them decides nothing.

> **PDR-01…PDR-04** are the first Product Decision Records created under the
> `PDR-xx` convention above. Each one transcribes an explicit Owner decision
> recorded on 2026-10-02 for the Inventory item master (candidate C-47); none of
> them authorizes implementation, accepts merged work, or promotes an ADR.
>
> **Governance re-baseline (2026-10-05).** The Owner recorded a batch of
> product decisions: OQ-54 **decided** (Option B — edit until Accounting Post,
> then cancel/correct only; side-effect transparency; negative-inventory hard
> block), OQ-49 **decided** (standard reports + controlled customization),
> OQ-65 reuse **decided** (barcode never reused), OQ-45 shape decided (Grace →
> Read-Only), OQ-46 distinction decided (Business Export Excel ≠ full technical
> backup), OQ-51 boundary decided (taxpayer Stage 2 post-MVP), OQ-53 restore
> authority decided (admin-only, runbook-driven), OQ-47 deferred ("do nothing
> for now"), OQ-59 deferral confirmed, and the MVP completion definition
> re-based on the **Initial Usable Product / V1** ([PDR-06](./PDR-06-initial-usable-product-v1.md)).
> Architecture contract: ADR-0040 (**Proposed** — not self-accepted). None of
> this authorizes implementation or accepts merged work.

> **C-61 Owner decision update (2026-10-07).** C-60's PO-01…PO-12 were
> recommendations only. The Owner explicitly approved the decisions recorded in
> [PDR-09](./PDR-09-inventory-accounting-posting-boundary.md); all other C-60
> recommendations remain unapproved. OQ-24/25/39/42/69/70/71/72 remain Open,
> including OQ-70's narrowed Purchase Return variance scope. C-61 authorizes no
> production implementation; C-62 is the future implementation stage.

## Related architecture records

| ADR | Title | Status | Product relevance |
|---|---|---|---|
| [ADR-0029](../../adr/0029-machine-api-access-model.md) | Machine/API access model (API keys; OAuth2 deferred) | Proposed | Defines the licensed machine-access foundation (PD-35/PD-36) |
| [ADR-0030](../../adr/0030-license-foundation.md) | License foundation (minimal, non-punitive, enforcement-off) | Accepted for L-01; extended by ADR-0045/ADR-0046 (status per the file; index corrected 2026-10-11 — CF-13) | Defines the MVP license foundation (PD-08/PD-09/PD-12) |
| [ADR-0045](../../adr/0045-installation-identity-and-license-activation.md) (filed as ADR-0036 until 2026-10-11) | Persistent installation identity and local license activation (renumbered; see PDR-11 §19 CF-14 and §19.4) | Accepted for L-02 (per the file) | Implemented licensing foundation; the conflicts recorded in PDR-11 §19 are reconciled in §19.4 |
| [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) | Signed license documents, retained license versions and deterministic effective-version resolution | Accepted for the first licensing implementation slice | Implements PDR-11 §3.2, §5.2, §11.3 and §12.4 for the server-license import path; open items stay in PDR-11 §15 |
| [ADR-0041](../../adr/0041-synchronous-inventory-accounting-application-contract.md) | Synchronous Inventory → Accounting application contract | Accepted (PO-02) | Records the primary internal integration style; OQ-39 transaction/failure semantics remain open |

## Decision flow

```
Product/business clarification answers (owner)
        ↓
PB-BASELINE v1 (docs/product/) — classification: DECIDED/DIRECTIONAL/…
        ↓  unresolved items only
OQ-44…OQ-61 (here)  +  ADR-0029/ADR-0030 (docs/adr/, proposed)
        ↓  owner answers / ratifies
MVP scope (docs/product/mvp-scope-proposal-v1.md) + roadmap stages
        ↓  implementation (only after gates pass)
```

## Rules

1. No OQ/ADR here may be marked Accepted/Decided without explicit owner approval.
2. Product OQs must not re-decide architectural matters already settled by ADRs;
   they may only request a change through a new ADR.
3. When an OQ here resolves, update: this index, `docs/open-questions.md`
   (move to Resolved with the decision), and every affected doc.
