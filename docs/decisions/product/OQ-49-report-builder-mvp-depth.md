# OQ-49: Report Builder MVP depth — DECIDED (A + controlled subset of B)

- **Type:** OQ (product scope decision)
- **Status:** **Decided — Owner decision recorded 2026-10-05: MVP = A + a controlled subset of B** (see §Owner decision). The concrete MVP report catalogue content remains to be finalized separately; the §17.2 security constraints are binding.
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22 · **Decided:** 2026-10-05 (governance re-baseline)
- **Priority:** High · The MVP scope *level* is now fixed
- **Related docs:** PB-BASELINE §17, PD-19; reporting-strategy (ADR-0009); security constraints §17.2; MVP proposal (Report Builder entries, category D); roadmap Stage 0 gate, Stage 5; frontend contract `docs/frontend/ux/document-editing-and-system-alerts.md` §3

## Owner decision (2026-10-05) — MVP = A + controlled subset of B

**A — Standard ERP reports.** The product provides the required standard
reports for **Accounting, Inventory, Sales, Purchasing and Management**,
according to the final MVP report catalogue (the catalogue content itself is
derived from the existing MVP scope documents, not invented here).

**Controlled B.** Users get controlled customization only:

- filters;
- date ranges;
- selectable **permitted** columns;
- sorting;
- limited grouping (single-column, per reporting-strategy §4);
- saved report configurations;
- Excel export.

**Explicitly NOT in MVP:** arbitrary SQL builder; unrestricted query designer;
unrestricted formula engine; unrestricted calculated fields; full BI designer;
unrestricted drag-and-drop report designer; arbitrary data-source joining;
unrestricted user-defined reporting logic. The §17.2 security constraints
(no user SQL, permission-aware, approved semantic entities only, resource
limits, audit, versioning) remain binding.

This is a **governance/product decision only** — it is not a claim that any
report or builder capability has been implemented.

No individual report implementation is marked complete by this decision — no
Reporting module exists on `main` as of 2026-10-05; implementation remains
separately gated.

## Context (historical — as registered 2026-09-22)

Report Builder is a decided differentiator (PB-BASELINE §7) with a confirmed
vision (§17.1) and binding security constraints (§17.2: no user SQL,
permission-aware, approved semantic entities, resource limits, audit,
versioning). At registration time the MVP depth — how much builder the first
release actually contains — was not decided. The accepted reporting
architecture (ADR-0009) gives code-defined reports + module views + a single
pipeline; the builder would sit on top of registered semantic entities. The
depth question is **now resolved** by the Owner decision above.

## Why this matters

- MVP effort swings by weeks depending on the level chosen; the reference
  scenario's "create a custom report" step is un-ratable without it.
- Too deep too early violates the §17.2 constraints (a permissive builder is a
  security/performance hole — risk R-06); too shallow breaks a decided
  differentiator.

## Exact decision required (historical — resolved 2026-10-05)

The decision required was the MVP builder level (with the security constraints
non-negotiable). It is resolved: **A + controlled subset of B** (see §Owner
decision).

## Options (historical — superseded by the Owner decision)

| Option | Contents | Advantages | Disadvantages |
|---|---|---|---|
| **A. Registry reports only, no builder** ("custom report" = saved filters/columns on registry reports) | Fastest; zero new surface | "Custom report" in the scenario is arguably not satisfied |
| **B. Configurable report composition** (MVP): user combines approved semantic entities into report definitions — pick entity, columns, filters, sort, grouping (single-column), export; definitions saved, versioned, permission-bound | Satisfies scenario; bounded surface; reuses pipeline as-is | Needs semantic-entity registry + definition storage + versioning (build item, not huge) |
| **C. Calculated fields & expressions** (adds expressions over approved fields — no user SQL ever) | Strong differentiator; still safe (expression evaluator over whitelisted fields) | Expression language = real work + security review |
| **D. Visual Query Builder with joins/charts/scheduling/multi-entity** | Full vision (§17.1) | Too large for MVP; joins across entities need careful permission/limit design |

## Risks

- B/C must not leak unapproved entities (entity allowlist enforced backend,
  AR-21).
- Saved definitions are user data → export/print/audit rules apply.

## Dependencies

- Depends on: module views for Accounting/Inventory/Sales existing (Stage 3/4),
  semantic-entity registry design (small ADR or doc extension at Stage 5
  planning).
- Feeds: MVP proposal Report Builder rows; roadmap Stage 5 scope; OQ-60
  (acceptance thresholds measure the chosen level).

## Recommended option (historical)

**B for MVP, C as fast-follow, D post-MVP.** B satisfies the reference
scenario's "create a custom report" honestly; C adds the wow-factor once B is
proven; D stays directional. *(Recorded 2026-09-22 as a recommendation. The
2026-10-05 Owner decision is narrower: standard reports plus a controlled
subset of B's customization — see §Owner decision above; C and D remain
post-MVP at most.)*

## Historical questions superseded by Owner decision

The following questions were part of the earlier decision process and are
retained only for historical traceability. **They are no longer active
product-owner questions**: the Owner decision recorded on 2026-10-05 resolved
the MVP direction as **A + controlled subset of B** (full option B is not the
decision, expressions/calculated fields (C) are not in MVP, and the §17.2
security constraints remain binding).

1. *(historical)* Is level B acceptable as the MVP Report Builder?
2. *(historical)* Must expressions/calculated fields (C) be in MVP, or is B
   enough?
3. *(historical)* Do you accept the §17.2 security constraints as absolute (no
   exceptions for power users)?

## Decision deadline or dependency

Resolved 2026-10-05 — the Stage 0 scope-level gate this OQ blocked is
satisfied. Remaining downstream work (final MVP report catalogue content,
OQ-60 numeric thresholds, implementation) is tracked in its own records.

## Related documents

PB-BASELINE §16, §17; ADR-0009; reporting-strategy; OQ-10 (existing grouping
scope), OQ-60; MVP proposal; roadmap Stage 5.
