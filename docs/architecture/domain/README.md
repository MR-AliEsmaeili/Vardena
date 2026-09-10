# Vardena — Domain & Configurability Architecture

Status: Proposed (design for review) · Updated: 2026-09-11

This folder is the **domain foundation** for Vardena: what the ERP is about, which
concepts are stable, what is configurable, how configuration is versioned, and
where the boundaries of expert (accounting/tax/legal) knowledge lie.

It is **design only**. Nothing here authorizes ERP code, Prisma models, migrations,
APIs, or screens. The binding implementation order is set by
[`domain-blueprint.md`](./domain-blueprint.md) §"Gate Before Core ERP Schema".

## Documents

| Document | Answers |
|---|---|
| [`domain-blueprint.md`](./domain-blueprint.md) | What the domain is, the core/configurable/extensible split, module map, anti-patterns, the final review, and the pre-migration gate |
| [`domain-glossary.md`](./domain-glossary.md) | The vocabulary (one definition per term, English/Persian aliases, what a term is *not*) |
| [`master-data-strategy.md`](./master-data-strategy.md) | Organization/branch scope, Item & product model, units, partners, lifecycle, effective dating |
| [`document-architecture.md`](./document-architecture.md) | The document foundation, document types, relationships, partial conversion, cancellation/reversal, numbering |
| [`workflow-architecture.md`](./workflow-architecture.md) | Status vs transition vs permission vs approval vs automation, the minimum viable workflow model, versioning |
| [`inventory-domain-analysis.md`](./inventory-domain-analysis.md) | Source of truth (movement ledger vs balance), stock balance materialization, lot/serial/expiry, valuation hooks, negative stock |
| [`accounting-domain-analysis.md`](./accounting-domain-analysis.md) | Chart of accounts options, fiscal calendar, journals, posting/reversal/closing, inventory & sales & purchasing accounting effects (expert-gated) |
| [`configurability-architecture.md`](./configurability-architecture.md) | The flexibility layers, configuration storage & versioning, custom fields (JSONB) policy, business-rule categories, reporting implications |
| [`domain-decisions.md`](./domain-decisions.md) | The decision register: problem, options, pros, cons, recommendation, consequences, expert-validation flag |

## Relationship to the existing architecture

- `docs/architecture.md`, `docs/modules.md`, `docs/database-strategy.md`,
  `docs/security.md`, `docs/reporting-strategy.md`, `docs/integrations.md` remain
  normative. This folder **adds domain-level decisions** on top of them; where it
  recommends a structural change it does so through a *Proposed* ADR:
  - [ADR-0017](../../adr/0017-inventory-ledger-as-source-of-truth.md) — inventory ledger as
    source of truth + materialized balances (Proposed)
  - [ADR-0018](../../adr/0018-bounded-versioned-workflow.md) — bounded, versioned workflow
    configuration (Proposed)
  - [ADR-0019](../../adr/0019-document-foundation-and-relations.md) — document foundation and
    controlled document relations (Proposed)
  - [ADR-0020](../../adr/0020-organizational-scope-and-master-data.md) — organizational scope and
    master-data ownership (Proposed, includes the new `organization` module)
- New open questions are registered in [`../open-questions.md`](../../open-questions.md)
  (OQ-22 … OQ-35). **Unresolved business rules always win**: nothing in this folder
  overrides an open question, and every accounting/tax/legal statement is marked
  *Requires domain-expert validation* (§19 of the blueprint).

## How to read this without reading everything

1. `domain-blueprint.md` §1–§4 (domain map, concepts, classification matrix).
2. `domain-decisions.md` (the register; it names the doc that explains each decision).
3. The document for the area you are about to work in.
4. The gate list at the end of `domain-blueprint.md` before proposing any ERP
   schema or module work.

## Ground rules used throughout

- **Strong relational core + controlled configuration + explicit extension
  points.** No system-wide EAV, no "everything JSONB", no universal document or
  workflow engine (evaluated and rejected in `domain-blueprint.md` §6, §8, §17).
- **No invented business rules** (AR-31): numbering, tax, ledger behavior,
  approval flows, valuation and retention appear here as *options + a
  recommendation + an expert-validation flag*, never as silent assumptions.
- **Reporting is a first-class constraint** (ADR-0009): a design that makes common
  ERP reports hard is rejected, even if it is flexible.
- **Historical integrity** (AR-13 + `database-strategy.md` §7): posted documents,
  movements and journals are immutable; corrections are counter-records; master
  data referenced by history is never physically deleted.
