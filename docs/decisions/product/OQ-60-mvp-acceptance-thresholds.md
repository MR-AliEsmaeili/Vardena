# OQ-60: MVP acceptance thresholds

- **Type:** OQ (product decision — ratification of numbers)
- **Status:** Open
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** High · **Blocks MVP exit definition** (Stage 0 gate)
- **Related docs:** PB-BASELINE §30 (success criteria), PD-38; OQ-49 (Report Builder depth), OQ-52/OQ-53 (backup/DR numbers); MVP proposal (acceptance criteria columns); roadmap Stage 6 gate

## Context

PB-BASELINE §30 defines the ten MVP success criteria (end-to-end scenario,
accounting correctness, inventory correctness, report reliability, LAN
operation, installation simplicity, backup/restore, security boundaries,
non-specialist usability, no unresolved P0/P1). The **framework is decided**;
the **numbers are proposals** (30-minute install, 5k/50k row caps inherited
from reporting strategy, usability timings, defect-count definitions) and have
never been ratified by the owner.

Also undecided: the precise definition of **P0/P1** (what counts as release-
blocking) and which criteria are *gates* (must pass) vs *measures* (tracked,
informed judgment).

## Why this matters

- Without ratified numbers, "MVP done" is an opinion — scope creep and
  premature-release arguments both hide behind ambiguity.
- The numbers feed OQ-58 (public release trigger) and OQ-45 (enforcement
  seriousness) — both need a defensible "MVP acceptance" definition.

## Exact decision required

1. Ratify or amend each proposed number in PB-BASELINE §30:
   - install-to-login ≤ 30 min by a trained operator;
   - usability pass (non-specialist, task ≤ 10 min, no critical confusion);
   - report correctness on fixture datasets; export determinism;
   - security: 100% denial-path coverage on MVP endpoints;
   - backup/restore: drill-validated (numbers from OQ-52/OQ-53).
2. Ratify the P0/P1 definitions (proposal below).
3. Decide gates vs measures per criterion.

## Proposal (for ratification)

- **P0**: data loss/corruption; security boundary crossed; ledger imbalance;
  scenario-blocking failure with no workaround.
- **P1**: core-flow blocking with workaround; wrong totals in confirmed
  reports; permission enforcement gap.
- Everything else: P2+ (non-blocking, tracked).
- **Gates**: criteria 1, 2, 3, 5, 7, 8, 10. **Measures**: 4, 6, 9 (targets,
  but a miss requires explicit owner waiver).

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Ratify proposed numbers as-is** | Immediate definition; drill-backed restore targets | Numbers are untested estimates |
| **B. Owner amends numbers once, at Stage 0** | Owner authority exercised where it matters; stable thereafter | Requires a decision session now |
| **C. Defer numbers to Stage 6** | Informed by reality | "Done" stays undefined through Stages 1–5 — the exact ambiguity this OQ exists to kill |

## Risks

- Waivers becoming the norm if gates are too easy to waive — waiver authority
  is owner-only and must be recorded.

## Dependencies

- OQ-49 (Report Builder depth changes criterion 4's content), OQ-52/OQ-53
  (criteria 7's numbers), OQ-58 (consumes the ratified gate as its trigger).

## Recommended option

**B**: a single Stage-0 decision session ratifies all numbers and P0/P1
definitions; changes afterwards require an owner waiver, recorded. 
**Recommendation only.**

## Questions requiring product owner confirmation

1. Do you accept the proposed numbers (30-min install, 10-min usability tasks,
   100% denial-path coverage) or want to change any?
2. Do you accept the P0/P1 definitions proposed above?
3. Do you accept the gates-vs-measures split, with waiver authority reserved
   to you?

## Decision deadline or dependency

**Stage 0 gate** — with OQ-49, this completes the MVP definition.

## Related documents

PB-BASELINE §30; OQ-49, OQ-52, OQ-53, OQ-58; MVP proposal; roadmap Stage 6.
