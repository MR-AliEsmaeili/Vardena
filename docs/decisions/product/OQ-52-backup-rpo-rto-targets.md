# OQ-52: Backup RPO/RTO formal targets

- **Type:** OQ (operational policy decision)
- **Status:** **Open — confirmed OPEN by the Owner re-baseline of 2026-10-05.** Numeric RPO/RTO targets remain undecided; do not assume any number. What IS decided (2026-10-05): the backup capability itself is part of the target V1 product (PDR-06), responsibility and the export/backup distinction are recorded in `docs/operations/backup-and-restore.md`, and this OQ stays open until appropriate targets can be defined.
- **Owner:** Ali Esmaeili (with IT/operations input)
- **Created:** 2026-09-22 · **Reconfirmed open:** 2026-10-05

## Concepts (documented so the open question is unambiguous)

- **RPO (Recovery Point Objective)** = the acceptable **data-loss window**:
  how much recent data may be lost when restoring from the last good backup.
- **RTO (Recovery Time Objective)** = the acceptable **service-restoration
  window**: how long the system may be down until restored.

Numeric targets for both remain OPEN; any published number requires an Owner
decision (and, per the existing posture, drill validation).
- **Priority:** High · **Blocks Stage 6 exit (pilot readiness)**
- **Related docs:** PB-BASELINE §23, PD-28/PD-29; OQ-17 (existing: backup/retention/upgrade posture); OQ-53 (DR/restore, sibling); database-strategy §14; MVP proposal (Backup/Restore foundation); roadmap Stage 6 gate

## Context

The repo's decided posture (database-strategy §14): scheduled logical backups
(pg_dump), configurable retention, **RPO/RTO targets are business/deployment
decisions — OQ-17 — do not assume**, and no point-in-time-recovery commitment.
The owner's clarifications add requirements (automatic + scheduled + encrypted
backups, customer-triggered backup, controlled restore, backup before every
migration) but **no numeric targets** and explicitly no RPO-zero claim
(PB-BASELINE §23: "RPO zero is NOT claimed as technically guaranteed").

Pilot customers will ask a simple question: *"if the server dies at 5pm, how
much do I lose and how long am I down?"* Today the product cannot answer.

## Why this matters

- RPO/RTO numbers drive the backup schedule, WAL archiving decision, restore
  drill design, and the honest sales/contract story.
- Without formal targets, "backup and restore foundation" (a decided MVP
  platform capability, PD-17) has no measurable acceptance.
- Recovery claims leak into contracts — an unmeasured claim is a liability.

## Exact decision required

1. **RPO**: maximum tolerable data loss window per deployment tier
   (e.g. 24h with daily dumps; 15m–1h if WAL archiving is enabled).
2. **RTO**: maximum tolerable recovery time (restore on replacement hardware),
   and what infrastructure assumption it assumes (customer provides spare
   hardware? Vardena keeps installer image?).
3. Which tier applies to which customer/price level (ties into §11 structure).
4. Whether WAL archiving (PITR) becomes a standard offering or a paid
   enterprise option.

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Daily logical backup** (RPO ≤ 24h) | Matches current strategy; simple; adequate for many SMBs | A day of data loss possible; unacceptable to some buyers |
| **B. Daily dump + WAL archiving** (RPO ≤ 15–60m) | Strong story; PITR capability; still single-node | Operational complexity per deployment; monitoring; disk growth management |
| **C. RPO ≈ 0 (synchronous replica)** | Near-zero loss | Second server requirement at customer sites; new architecture; contradicts single-server simplicity; cost |

## Risks

- Numbers promised without drills = untested claims; every target must be
  validated by a timed restore drill (Stage 6 exit).
- WAL archiving without disk/monitoring discipline can fail silently.

## Dependencies

- OQ-17 (retention/archival values), OQ-53 (DR/server-replacement runbook and
  restore self-service — consumes these targets).
- Stage 6 backup/restore drill (validates whatever is decided).
- Commercial structure (§11): target tiers may map to price tiers.

## Recommended option

**B as the standard offer (RPO ≤ 1h, RTO ≤ 4h on customer-provided hardware,
both validated by drill), A as the minimal tier, C explicitly rejected for
v1.** All numbers are *proposals for the owner to ratify or change*. RPO-zero
remains rejected until a customer demands it with an ADR-level change.

## Questions requiring product owner confirmation

1. What RPO/RTO do you want to *promise* (not aspire to) at each commercial
   tier?
2. Is WAL archiving standard or enterprise-tier?
3. What hardware assumption backs the RTO (customer spare machine? installed
   image?)
4. Do you accept the drill-validated rule: no published number without a
   successful timed restore drill?

## Decision deadline or dependency

Before Stage 6 exit (pilot readiness); the backup/restore acceptance criteria
in the MVP proposal reference this OQ.

## Related documents

PB-BASELINE §23; OQ-17, OQ-53; database-strategy §14; roadmap Stage 6; MVP
proposal (Backup/Restore foundation).
