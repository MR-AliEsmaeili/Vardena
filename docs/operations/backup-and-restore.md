# Backup, Restore & Customer Data Export — Operational Policy

Status: ACTIVE policy record (documentation only) · Created: 2026-10-05
(product & architecture governance re-baseline) · Owner decisions recorded
here; **no backup/restore/export feature is implemented or authorized by this
document.**

Canonical decision records:
[OQ-46](../decisions/product/OQ-46-customer-data-export-format.md) (export) ·
[OQ-52](../decisions/product/OQ-52-backup-rpo-rto-targets.md) (RPO/RTO — OPEN) ·
[OQ-53](../decisions/product/OQ-53-disaster-recovery-and-restore.md) (DR/restore) ·
[PDR-06](../decisions/product/PDR-06-initial-usable-product-v1.md) (backup is
part of the V1 target product) · `docs/database-strategy.md` §14 (technical
posture).

## 1. Business Export ≠ Disaster Recovery Backup (Owner decision, 2026-10-05)

```text
Business Export  ≠  Disaster Recovery Backup
```

| | Business Export | Disaster/Technical Backup |
|---|---|---|
| Purpose | Customer/business data portability | Technical restoration / disaster recovery |
| Format | **Excel (XLSX)** | **Full backup** (complete technical backup of the installation's data) |
| Consumer | Business users / accountants | IT / server administrator |
| Channel | In-product report/list export (reporting pipeline, ADR-0009 §6) | Operational backup procedure per the Runbook |

These two must never be conflated: Excel export does not satisfy disaster
recovery, and a technical backup does not satisfy business data portability.

## 2. Backup responsibility model (Owner decision, 2026-10-05)

- **Vardena provides** a backup capability and an operational **Runbook**.
  Backup capability is part of the target V1 product (PDR-06); it is **not
  implemented today**.
- **The customer / server administrator is responsible** for maintaining
  backups on the customer infrastructure, including operational backup
  storage/retention according to the deployment model.
- Vardena documentation must include **safety recommendations** for the
  responsible IT/server administrator (off-machine copies, retention,
  verification cadence, access control on backup artifacts).
- Future backup **destinations** may include local storage, Google Drive,
  S3-compatible/cloud storage and other supported cloud storage. **None of
  these integrations is implemented or authorized by this record.**

## 3. Restore authority (Owner decision, 2026-10-05)

- **Normal ERP users never have an in-product Restore capability.**
- Restore is performed by the **customer's authorized IT/server
  administrator** according to the Vardena Runbook.
- Restore must never be blocked by license state (existing rule, OQ-45/OQ-53).

## 4. Runbook — required coverage

The Vardena Backup & Restore Runbook (to be authored when the deployment
architecture finalizes the exact procedures) **must** cover:

1. Backup verification (proving a backup artifact is restorable);
2. Restore procedure;
3. Application startup;
4. Database startup;
5. Validation;
6. Post-restore checks.

Detailed commands are **deliberately not specified here** — the deployment
architecture has not finalized them; inventing them would violate AG-09.

## 5. RPO / RTO — concepts documented, targets OPEN (OQ-52)

- **RPO (Recovery Point Objective)** = the acceptable data-loss window: how
  much recent data may be lost when restoring from the last good backup.
- **RTO (Recovery Time Objective)** = the acceptable service-restoration
  window: how long the system may be down until restored.
- **Numeric RPO/RTO targets remain OPEN (OQ-52 — do not assume).** Backup
  capability itself is part of the target V1 product; the numbers are a
  separate Owner decision validated by restore drills.

## 6. Backup ≠ Restore ≠ Disaster Recovery (OQ-53 remains OPEN)

```text
Backup ≠ Restore ≠ Disaster Recovery
```

- **Backup** = producing and retaining restorable artifacts.
- **Restore** = bringing a single installation back from an artifact
  (admin-only, per §3).
- **Disaster Recovery** = the full playbook for hardware death, site loss and
  server replacement — sanctioned topologies, license re-activation on new
  hardware, drill cadence. These remain **OPEN** under OQ-53; nothing here
  decides them.

## 7. Acceptance expectation for future implementation

Business Export (Excel) and Technical Backup (full backup) must remain
distinct concepts in product, documentation, contracts and tests; no test or
feature may treat the Excel export as a recovery mechanism or the technical
backup as the data-portability answer.
