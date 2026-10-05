# OQ-53: Disaster recovery, server replacement, and restore self-service

- **Type:** OQ (operational policy decision)
- **Status:** **Open — restore authority decided 2026-10-05** (see §Owner decision); disaster-recovery topologies, server-replacement runbook detail, license re-activation mechanics and drill cadence remain OPEN.
- **Owner:** Ali Esmaeili (with IT/operations input)
- **Created:** 2026-09-22 · **Restore authority decided:** 2026-10-05 (governance re-baseline)

## Owner decision (2026-10-05) — restore authority & runbook requirement

- **Normal ERP users must never have an in-product Restore capability.**
- Restore is performed by the **customer's authorized IT/server administrator**
  according to the Vardena Runbook.
- Vardena must provide a backup capability and an operational **Runbook**
  covering: backup verification, restore procedure, application startup,
  database startup, validation, post-restore checks. Detailed commands are not
  invented until the deployment architecture finalizes them.
- The customer/server administrator is responsible for maintaining backups on
  the customer infrastructure; Vardena documentation includes safety
  recommendations for that administrator.
- The documentation distinguishes **Backup ≠ Restore ≠ Disaster Recovery**.
- Canonical policy text: `docs/operations/backup-and-restore.md`.

**Still OPEN (do not invent):** sanctioned recovery topologies beyond
single-server restore, the server-replacement runbook's license re-activation
mechanics, verification gates, and drill cadence — the questions below stand.
This decision selects the Option C *shape* for day-to-day restores (documented
runbook for the customer's authorized IT) and rejects Option B's in-product
restore for normal users; Vardena-assisted recovery for disasters remains
undecided.
- **Priority:** High · **Blocks Stage 6 exit (pilot readiness)**
- **Related docs:** PB-BASELINE §23, PD-28; OQ-52 (RPO/RTO numbers — sibling), OQ-17; database-strategy §14; security.md §6; roadmap Stage 6 gate

## Context

Sibling of OQ-52 (which sets *numbers*). This OQ is about the *operational
playbook*:

1. **Disaster recovery beyond single-server recovery**: what happens when the
   customer's server hardware dies, the site is unusable, or the OS is
   unrecoverable? Where does the recovery *happen* (customer's spare machine?
   any machine with the installer?) and who does it?
2. **Server replacement process**: is there a documented, rehearsed procedure
   to move an installation to new hardware (restore + license re-activation +
   verification)? Does license state (ADR-0030) survive the move without
   Vardena intervention?
3. **Restore self-service degree**: the decided principle is "controlled
   restore" (PB-BASELINE §23) — but *how controlled*? Options: Vardena performs
   all restores; customer-admin triggers guided restore in-product; customer IT
   runs a documented script.

## Why this matters

- An on-premise product lives or dies by "your server died on Friday night —
  now what?" A missing playbook turns a hardware failure into a product failure
  in the customer's eyes.
- License re-activation on replaced hardware is a commercial attack surface —
  an unbounded offline re-activation path undermines licensing; a Vardena-only
  path makes DR slow.
- The restore path interacts with the license-state decision (OQ-45): restore
  must never be blocked by license state.

## Exact decision required

1. The sanctioned recovery topologies (same-server restore, replacement
   hardware, worst-case site loss) and who performs each.
2. The server-replacement runbook: steps, license re-activation mechanics,
   verification gates (what proves the restored system is correct).
3. Restore self-service degree for customer-admins, and its guardrails
   (confirmation flow, audit, mandatory pre-restore backup).
4. Whether a "restore drill" is a recurring operational requirement per
   deployment (recommended) or a one-time validation.

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Vardena-performed restores only** | Tight control; no risky self-service | Slow (depends on Vardena availability); scales badly |
| **B. Guided in-product restore for customer-admin** (confirm flow, pre-restore automatic backup, audited) | Fast; good UX; auditable | Restore bugs are catastrophic events — needs hardened UX + tests |
| **C. Documented script/runbook for customer IT** | Independent of Vardena availability | Requires skilled customer IT; risk of out-of-procedure restores |

## Risks

- Restore is the one flow where a bug destroys the thing it protects —
  whatever option is chosen needs its own hardening stage and drill (Stage 6).
- License re-activation must not become a license-bypass hole (ties to OQ-45,
  ADR-0030).

## Dependencies

- OQ-52 (targets these runbooks must meet), OQ-45 (license state during
  restore), ADR-0030 (license foundation).
- Stage 6 exit: at least one full timed restore drill on replacement hardware.

## Recommended option (historical — superseded in part by the Owner decision above)

**B + C combined, A as the fallback for complex cases**: guided in-product
restore for standard cases (customer-admin, audited, with mandatory pre-restore
backup), documented runbook for IT-capable customers, Vardena-assisted for
disasters — with the license-state rule "restore is always permitted;
enforcement re-applies after". *(Recorded 2026-09-22 as a recommendation. The
2026-10-05 Owner decision rejects an in-product Restore for normal ERP users:
restore is runbook-driven and performed by the customer's authorized IT/server
administrator. The license-state rule stands.)*

## Questions requiring product owner confirmation

1. Are you willing to harden a customer-facing in-product restore (option B),
   or do you prefer Vardena-performed restores in year one?
2. Does license re-activation on new hardware require contacting Vardena, or
   is there an offline mechanism?
3. Are periodic restore drills a contract commitment you want to make?

## Decision deadline or dependency

Before Stage 6 exit; consumed by the pilot readiness gate alongside OQ-52.

## Related documents

PB-BASELINE §23; OQ-52, OQ-45, OQ-17; ADR-0030; database-strategy §14;
roadmap Stage 6.
