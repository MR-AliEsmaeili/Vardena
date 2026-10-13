# PDR-06: Vardena Initial Usable Product / V1 — MVP completion definition and 2026-10-05 re-baseline index

- **Type:** PDR (Product Decision Record) · decision ids **OD-V1-01 … OD-V1-04**
- **Status:** **Decided** — Owner decision recorded 2026-10-05 (product & architecture governance re-baseline)
- **Decided by:** Repository Owner (Ali Esmaeili)
- **Scope of this record:** documentation/governance only. **No production code,
  schema, migration or feature is changed or authorized.** It closes no other
  OQ, promotes no ADR, and accepts no merged work (MERGED ≠ ACCEPTED, STATE.md §6).
- **Registry rows affected:** [`docs/open-questions.md`](../../open-questions.md) —
  **OQ-60 remains OPEN** for the numeric acceptance thresholds; this record
  redefines what "MVP complete" *means*, not the numbers that measure it.
- **Related:** OQ-60 · `docs/product/mvp-scope-proposal-v1.md` ·
  `docs/roadmap/backend-mvp-roadmap.md` · PB-BASELINE §15/§16/§30

## 1. Decision — MVP completion is an end-to-end usable product, not "backend code complete"

**OD-V1-01.** The Owner does **not** define MVP completion as "backend code is
complete." The target is the **Vardena Initial Usable Product / V1**: the first
usable release is complete when a real customer can run this flow end-to-end:

```text
Login
→ License validation
→ Create organization
→ Create users / memberships / permissions
→ Create fiscal year
→ Configure accounting foundation
→ Create items
→ Create warehouses
→ Create customers / suppliers
→ Create opening/initial inventory
→ Create receipt
→ Create issue
→ Transfer inventory
→ Create sales documents/invoices
→ Create purchasing documents/invoices
→ Generate accounting effects
→ Accounting Post
→ Run reports
→ Close/transfer fiscal year
→ Continue in next fiscal year
```

**OD-V1-02.** In addition, the following must be **usable** (not merely
technically present): Frontend · Licensing · Installation · Deployment ·
Backup · Data export · Operational administration.

**OD-V1-03.** The product must be usable end-to-end rather than merely
technically implemented. **No artificial calendar deadline is assigned.**

**OD-V1-04.** The existing MVP catalogue (`docs/product/mvp-scope-proposal-v1.md`
and the roadmap's capability list) remains the source of the concrete checklist;
this decision **reconciles** that catalogue with the usable-product bar — it
does not invent a new feature list.

### Relationship to existing scope records

- The Backend MVP Roadmap remains the authoritative *backend* planning track;
  "Backend MVP complete" (its §7 final gate) is a **milestone inside V1, not
  the definition of V1**.
- The Owner-directed scope correction of 2026-09-27 stands. Note its scope
  split (Purchasing post-*Backend-MVP*) is a sequencing decision for the
  backend track; the V1 flow above includes purchasing documents, so the
  purchasing slice must be usable by V1 even though it sits after the Backend
  MVP milestone. Reconciling the exact ordering is roadmap work, not a new
  decision.
- OQ-60's numeric thresholds (install time, usability timings, P0/P1
  definitions, gates vs measures) remain **OPEN** and must still be ratified.

## 2. Index of the 2026-10-05 Owner re-baseline decisions (canonical pointers — no duplication)

| Decision | Canonical record |
|---|---|
| Document editing until Accounting Post; side-effect transparency; negative-inventory hard block; no silent repricing; cancel/correct after Post | [OQ-54](./OQ-54-finalized-document-deletion-editing.md) (OD-54-01…11) · ADR-0040 (Proposed) |
| Barcode never reusable within the organization | [OQ-65](./OQ-65-barcode-lifecycle-and-reuse.md) (OD-65-01) |
| Report Builder MVP = standard reports + controlled customization (A + controlled subset of B) | [OQ-49](./OQ-49-report-builder-mvp-depth.md) |
| License expiry: Grace → Read-Only (durations OPEN) | [OQ-45](./OQ-45-license-expiry-behavior.md) |
| Business Export (Excel) ≠ Disaster/Technical Backup (full backup) | [OQ-46](./OQ-46-customer-data-export-format.md) · `docs/operations/backup-and-restore.md` |
| Backup capability + Runbook provided by Vardena; customer admin responsible for backups; restore is admin-only (never in-product for normal users) | [OQ-53](./OQ-53-disaster-recovery-and-restore.md) · `docs/operations/backup-and-restore.md` |
| RPO/RTO: concepts documented, numeric targets remain OPEN | [OQ-52](./OQ-52-backup-rpo-rto-targets.md) |
| Taxpayer System: Stage 1 foundational preparation in scope; Stage 2 full integration deferred until after the complete MVP | [OQ-51](./OQ-51-taxpayer-release-boundary.md) |
| Multi-currency: do nothing now (no FX engine/rates/revaluation/UI/speculative columns) | [OQ-47](./OQ-47-exchange-rate-and-multicurrency-rules.md) |
| Dimensions: current operational scope dimensions remain; Detail Dimensions (تفصیلی) deferred — no EAV/JSONB/speculative dimension columns | OQ-41 registry row (`docs/open-questions.md`) |
| Product Family: deferred; ERP core is the current priority | [OQ-59](./OQ-59-product-family-vs-consolidation.md) |
| MVP completion = Initial Usable Product / V1 | this record (OD-V1-01…04) |

## 3. What this record does NOT decide

- The numeric MVP acceptance thresholds (OQ-60 — OPEN).
- Any implementation sequencing, task creation or acceptance.
- Grace/Read-Only durations (OQ-45 timing — OPEN).
- RPO/RTO numbers (OQ-52 — OPEN) and the DR playbook (OQ-53 — OPEN).
- Any of the per-domain open questions listed in the registry.
