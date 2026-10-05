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

## Records

| ID | Title | Type | Status | Blocks MVP |
|---|---|---|---|---|
| [OQ-44](./OQ-44-multi-device-offline-sync.md) | Multi-device offline sync: scope and timing | OQ | Open | No (excluded from MVP) |
| [OQ-45](./OQ-45-license-expiry-behavior.md) | License expiry behavior (incl. internet outage, post-termination mode) | OQ | Open — **Grace → Read-Only decided (2026-10-05)**; durations/override open | Foundation only |
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
| [PDR-05](./PDR-05-inventory-valuation-and-cost-optional-operations.md) | Inventory valuation foundation and cost-optional warehouse operations (OQ-24 — partial) | PDR | Decided (2026-10-04) | OQ-24 stays Open (returns, COGS posting, landed cost, valuation precision unanswered) |
| [PDR-06](./PDR-06-initial-usable-product-v1.md) | Vardena Initial Usable Product / V1 — MVP completion definition + 2026-10-05 re-baseline index | PDR | Decided (2026-10-05) | OQ-60 stays Open (numeric thresholds unratified) |

> **Numbering note (2026-10-02).** `OQ-62`, `OQ-63` and `OQ-64` are accounting /
> migration questions that live only in the central registry
> ([`docs/open-questions.md`](../../open-questions.md)); they have no record in
> this directory. `OQ-65` is the next free id in the central registry and is a
> product question, so its full record lives here.
>
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

## Related architecture records

| ADR | Title | Status | Product relevance |
|---|---|---|---|
| [ADR-0029](../../adr/0029-machine-api-access-model.md) | Machine/API access model (API keys; OAuth2 deferred) | Proposed | Defines the licensed machine-access foundation (PD-35/PD-36) |
| [ADR-0030](../../adr/0030-license-foundation.md) | License foundation (minimal, non-punitive, enforcement-off) | Proposed | Defines the MVP license foundation (PD-08/PD-09/PD-12) |

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
