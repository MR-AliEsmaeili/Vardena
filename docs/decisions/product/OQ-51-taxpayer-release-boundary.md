# OQ-51: Taxpayer System integration release boundary

- **Type:** OQ (product/compliance decision)
- **Status:** **Open — release boundary decided 2026-10-05** (see §Owner decision); slice composition, trigger, credentials/sandbox and fallback detail remain OPEN.
- **Owner:** Ali Esmaeili (with tax expert + accountant as validators)
- **Created:** 2026-09-22 · **Boundary decided:** 2026-10-05 (governance re-baseline)

## Owner decision (2026-10-05) — two-stage boundary

- **Stage 1 — in scope now:** the current foundational preparation (internal
  tax-invoice/document-model readiness, adapter/outbox separation per PB §19.2)
  remains in scope.
- **Stage 2 — deferred:** actual full integration/submission capability is
  **deferred until after the complete MVP** (the Initial Usable Product / V1,
  PDR-06). Stage 2 is **not** implemented now.
- Taxpayer integration is **not removed** from the long-term product roadmap.

**Still OPEN (do not invent):** the exact Stage 2 slice composition
(submission/status/retry vs corrective/returns/reconciliation sequencing), the
trigger (phase-in deadline vs demand vs sandbox availability), the compliance
fallback, and credentials/sandbox ownership — the questions below stand.
- **Priority:** High for Stage 4 planning · Not MVP-blocking (submission excluded from MVP)
- **Related docs:** PB-BASELINE §18, §19, PD-20/PD-21; OQ-05 (existing taxpayer scope OQ), OQ-30 (tax model), OQ-43 (statutory), OQ-27 (corrections); integrations.md §4; MVP proposal category C/D; roadmap Stage 4 gate

## Context

The intended Taxpayer System (سامانه مودیان) scope is decided *as a vision*
(PB-BASELINE §19.1): e-invoice submission, status retrieval, retry, error
explanation, user guidance, reconciliation, corrective invoices, cancellation,
returns, corrective returns, full tracking/reporting. The architecture is also
decided: internal tax-invoice domain logic lives in the Sales/Document domain;
all external protocol handling lives in the integration module behind the
adapter port + outbox (ADR-0003/0004; OQ-05 already reserves the destination).

What is **not decided is the release boundary**: which slice ships in which
stage. The Taxpayer System is an external dependency with a real contract,
credentials, sandbox requirements, and its own error culture — and Iranian
military/tax deadlines historically shift. Building against assumptions is
exactly what AG-09/AR-31 prohibit.

## Why this matters

- Stage 4 (Sales + taxpayer) cannot be sized without the boundary.
- The e-invoice law phase-in affects *sales* customers directly — missing the
  window has commercial cost; building too early against an unverified contract
  wastes work.
- Corrective invoices/returns/cancellations interact with the accounting
  correction policy (OQ-27) and tax model (OQ-30) — those must be resolved
  first or simultaneously.

## Exact decision required

1. Which taxpayer capabilities ship in which stage — minimum useful slice at
   Stage 4 (e.g. submission + status + retry only?), and when do corrective
   documents/cancellation/returns/reconciliation follow?
2. What is the trigger: calendar deadline (e-invoice phase-in for the customer
   segment), first customer demand, or sandbox availability?
3. What is the compliance fallback if the external timeline slips (manual
   submission workflow in-product vs out-of-system process)?
4. Credentials/sandbox ownership (whose economic-code credentials, who tests).

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Manual workflow only** (system produces the data, users submit via the taxpayer portal) | Zero external dependency; safe | Poor UX; competitive gap once e-invoicing is mandatory |
| **B. Minimal submission slice** (submit e-invoice + poll status + retry + error explanation; no corrective docs) | Covers the mandatory-day-1 need; bounded build; uses outbox as-is | Corrective/return flows manual initially |
| **C. Full scope in one release** (submission + correction + returns + reconciliation) | Complete story | Large; corrective flows depend on OQ-27/OQ-30; risky against unknown contract |

## Risks

- External contract/format changes (R-08) — adapter isolation contains it, but
  release timing may slip.
- Corrective-invoice semantics must match OQ-27 accounting corrections —
  deciding one in isolation creates rework.
- Sandbox access uncertainty (OQ-05) delays testing.

## Dependencies

- OQ-05 (existing: which flows, credentials, sandbox — still open), OQ-30
  (tax model on documents), OQ-27 (correction policy), OQ-43 (statutory
  posture), OQ-38 (party legal identifiers needed on e-invoices).
- Tax expert validation of e-invoice data requirements before payload design.

## Recommended option

**B as the first delivery slice, triggered by the phase-in deadline for the
target segment, with A as the documented fallback.** Corrective documents/
returns/reconciliation follow in a later slice after OQ-27/OQ-30 resolve.
**Recommendation only — owner + tax expert decide.**

## Questions requiring product owner confirmation

1. What is the actual e-invoice phase-in deadline for your target segment, and
   is it fixed?
2. Do you accept the three-slice sequencing (B → corrective docs →
   reconciliation)?
3. Who owns taxpayer credentials/sandbox testing during development?
4. Is the manual-workflow fallback acceptable to first customers if timing
   slips?

## Decision deadline or dependency

Must be decided before Stage 4 scope freeze; the phase-in deadline is the
external clock. Not an MVP blocker (MVP ships only the document-model
readiness work).

## Related documents

PB-BASELINE §18, §19; OQ-05, OQ-27, OQ-30, OQ-38, OQ-43; integrations.md §4;
roadmap Stage 4; MVP proposal category C.
