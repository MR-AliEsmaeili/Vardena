# OQ-49: Report Builder MVP depth

- **Type:** OQ (product scope decision)
- **Status:** Open
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** High · **Blocks final MVP scope level** (Stage 0 gate)
- **Related docs:** PB-BASELINE §17, PD-19; reporting-strategy (ADR-0009); security constraints §17.2; MVP proposal (Report Builder entries, category D); roadmap Stage 0 gate, Stage 5

## Context

Report Builder is a decided differentiator (PB-BASELINE §7) with a confirmed
vision (§17.1) and binding security constraints (§17.2: no user SQL,
permission-aware, approved semantic entities, resource limits, audit,
versioning). What is **not decided is the MVP depth** — how much builder the
first release actually contains. The accepted reporting architecture
(ADR-0009) gives code-defined reports + module views + a single pipeline; the
builder would sit on top of registered semantic entities.

The owner's answers describe Report Builder as important but do not state the
minimum level required at MVP — and "custom report" is _in the MVP reference
scenario_ (§16), so some builder capability is in scope; only the level is open.

## Why this matters

- MVP effort swings by weeks depending on the level chosen; the reference
  scenario's "create a custom report" step is un-ratable without it.
- Too deep too early violates the §17.2 constraints (a permissive builder is a
  security/performance hole — risk R-06); too shallow breaks a decided
  differentiator.

## Exact decision required

Choose the MVP builder level (and confirm the security constraints as
non-negotiable):

## Options

| Option                                                                                                                                                                                                                                 | Contents                                                                         | Advantages                                                                              | Disadvantages |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------- |
| **A. Registry reports only, no builder** ("custom report" = saved filters/columns on registry reports)                                                                                                                                 | Fastest; zero new surface                                                        | "Custom report" in the scenario is arguably not satisfied                               |
| **B. Configurable report composition** (MVP): user combines approved semantic entities into report definitions — pick entity, columns, filters, sort, grouping (single-column), export; definitions saved, versioned, permission-bound | Satisfies scenario; bounded surface; reuses pipeline as-is                       | Needs semantic-entity registry + definition storage + versioning (build item, not huge) |
| **C. Calculated fields & expressions** (adds expressions over approved fields — no user SQL ever)                                                                                                                                      | Strong differentiator; still safe (expression evaluator over whitelisted fields) | Expression language = real work + security review                                       |
| **D. Visual Query Builder with joins/charts/scheduling/multi-entity**                                                                                                                                                                  | Full vision (§17.1)                                                              | Too large for MVP; joins across entities need careful permission/limit design           |

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

## Recommended option

**B for MVP, C as fast-follow, D post-MVP.** B satisfies the reference
scenario's "create a custom report" honestly; C adds the wow-factor once B is
proven; D stays directional. **Recommendation only — owner decides.**

## Questions requiring product owner confirmation

1. Is level B acceptable as the MVP Report Builder?
2. Must expressions/calculated fields (C) be in MVP, or is B enough?
3. Do you accept the §17.2 security constraints as absolute (no exceptions for
   power users)?

## Decision deadline or dependency

**Stage 0 gate** — must be decided before MVP scope is ratified (it shifts
Stage 5 scope and OQ-60 thresholds).

## Related documents

PB-BASELINE §16, §17; ADR-0009; reporting-strategy; OQ-10 (existing grouping
scope), OQ-60; MVP proposal; roadmap Stage 5.
