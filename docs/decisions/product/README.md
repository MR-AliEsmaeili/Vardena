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
| [PDR-01](./PDR-01-item-barcode-policy.md) | Item barcode policy (optional; organization-scoped uniqueness among active items; multi-format; single barcode per item) | PDR | **Decided 2026-10-02** (OD-C47-03) | No — but **decided and not yet enforced** (see PDR-01 §5) |
| [OQ-44](./OQ-44-multi-device-offline-sync.md) | Multi-device offline sync: scope and timing | OQ | Open | No (excluded from MVP) |
| [OQ-45](./OQ-45-license-expiry-behavior.md) | License expiry behavior (incl. internet outage, post-termination mode) | OQ | Open | Foundation only |
| [OQ-46](./OQ-46-customer-data-export-format.md) | Customer data export format and completeness | OQ | Open | No (Excel confirmed) |
| [OQ-47](./OQ-47-exchange-rate-and-multicurrency-rules.md) | Exchange-rate and multi-currency accounting rules | OQ | Open | No (single-currency MVP) |
| [OQ-48](./OQ-48-revaluation-and-fx-gain-loss.md) | Revaluation and foreign-exchange gain/loss | OQ | Open | No (single-currency MVP) |
| [OQ-49](./OQ-49-report-builder-mvp-depth.md) | Report Builder MVP depth | OQ | Open | Yes (scope level) |
| [OQ-50](./OQ-50-webhooks-and-api-surface.md) | Webhooks and API surface beyond ADR-0029 | OQ | Open | No |
| [OQ-51](./OQ-51-taxpayer-release-boundary.md) | Taxpayer System integration release boundary | OQ | Open | No (excluded; document model only) |
| [OQ-52](./OQ-52-backup-rpo-rto-targets.md) | Backup RPO/RTO formal targets | OQ | Open | Foundation only |
| [OQ-53](./OQ-53-disaster-recovery-and-restore.md) | Disaster recovery, server replacement, restore self-service | OQ | Open | Foundation only |
| [OQ-54](./OQ-54-finalized-document-deletion-editing.md) | Finalized document deletion/editing policy | OQ | Open | Yes (policy posture) |
| [OQ-55](./OQ-55-branch-as-cost-center.md) | Branch as cost center | OQ | Open | No |
| [OQ-56](./OQ-56-two-book-accounting.md) | Two-book accounting architecture | OQ | Open | No |
| [OQ-57](./OQ-57-marketplace-extension-security.md) | Marketplace & third-party extension security | OQ | Open (deferred) | No |
| [OQ-58](./OQ-58-public-release-vs-internal-only.md) | Public release vs internal-only distribution | OQ | Open | No (commercial) |
| [OQ-59](./OQ-59-product-family-vs-consolidation.md) | One ERP + products vs product family / consolidation strategy | OQ | Open | No (strategic) |
| [OQ-60](./OQ-60-mvp-acceptance-thresholds.md) | MVP acceptance thresholds | OQ | Open | Yes (ratification) |
| [OQ-61](./OQ-61-crm-ticketing-timing-ownership.md) | CRM/ticketing timing and ownership | OQ | Open | No |

### Open questions created by records here but held in the central registry

| ID | Title | Where it lives | Status |
|---|---|---|---|
| OQ-65 | Barcode lifecycle, reuse and comparison semantics (residue of PDR-01) | [`docs/open-questions.md`](../../open-questions.md) — Open table | **Open** |

OQ-65 is a domain/inventory question raised by PDR-01, not a product OQ in the
OQ-44+ series, so its one-row registry entry is the central registry and its
decision context is PDR-01 §6. It has no file in this directory by design.

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
