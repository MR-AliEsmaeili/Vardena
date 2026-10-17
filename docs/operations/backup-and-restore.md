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

## Licensing interaction (annotation, 2026-10-11 — no policy change)

**Restore is never blocked by license state** (OQ-53; guardrail G-9 of PDR-11).
Nothing in the licensing implementation participates in backup, export or
restore: there is no in-product restore surface, no licensing check on any
backup/restore path, and the signed-file import pipeline adds none. Licensing
never blocks, delays, logs out or requires network for a restore.

**Product clarification (2026-10-15):**
[PDR-11 §10.3/§20](../decisions/product/PDR-11-vardena-licensing-product-requirements.md)
now requires a restricted administrator license/recovery interface independent of
ordinary commercial login during full restriction. Approved identity/authentication,
license/reason viewing, applicable Owner-signed import and essential backup/recovery
remain available without commercial access or Owner/customer boundary bypass.
This resolves the product-level restore/login conflict; authentication/session/
signed recovery protocol and implementation remain **OQ-78** follow-ups. It is
not an in-product Restore grant to normal users or an implemented emergency path.
PQ-3 is decided at product level; G-9 no longer defers this policy pending PQ-3.
Ordinary Restore stays on the already-approved authorized IT/server-administrator
Runbook path. OQ-53 topology/authority/runbook/drill questions and U-2/OQ-78/OQ-82
identity-key, encryption, authentication and recovery-design gates are preserved.
The installation identity key that PDR-11 §6.1–§6.5 requires in the
encrypted full backup is **designed but not implemented** (blocked by the
backup-encryption design, PDR-11 U-2, and by the replacement workflow, OQ-82).

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

## 8. Standalone Owner Licensing audit archive continuity (`OQ-77`)

The standalone Owner Licensing application (`owner-licensing/`) maintains its
own isolated PostgreSQL database (`owner`, `owner_audit_archive`, and
`public.owner_migrations`), separate from customer Vardena installations, paired
with an independent durable filesystem archive store (`OWNER_AUDIT_ARCHIVE_DIR`):
- Active audit events in `owner.audit_events` are append-only with a mandatory
  three-year minimum retention window (`minimum_retained_until = occurred_at +
  3 years` in UTC) and an unresolved security-incident hold
  (`security_incident = true`, `incident_status = 'UNRESOLVED'`).
- Permanent separate archive persistence is enforced across two decoupled
  boundaries so the archive does not depend exclusively on the same PostgreSQL
  database and its backup lifecycle as the source audit records:
  1. **Independent durable filesystem archive store (`OWNER_AUDIT_ARCHIVE_DIR`):**
     `FilesystemAuditArchiveStore` writes write-once (`link` + `unlink`,
     `chmod 0o444`, file and directory `fsync`), read-back-verified JSON batch
     bundles (`batches/batch-XXXXXX-<id>.json`) and an atomic `fsync`ed
     hash-chained `manifest.json` on an independent filesystem path/volume
     outside the PostgreSQL data directory.
  2. **PostgreSQL archive ledger (`owner_audit_archive.archive_batches` and
     `owner_audit_archive.archived_audit_events`):** append-only tables recording
     each batch's `durable_file_name`, `durable_bundle_sha256`, per-record
     SHA-256 digests (`record_sha256`), and chained batch digests
     (`previous_batch_digest` → `batch_digest_sha256`).
- A downloadable JSON response or an operator instruction to save a file is never
  treated as proof of durable archival. If `OWNER_AUDIT_ARCHIVE_DIR` is not
  configured or the durable store write/read-back fails, `POST /api/v1/audit-archive/batches`
  fails closed (`503 ArchiveStorageUnavailable`), rolls back both stores, and
  never marks source events as `archived: true`.
- Operators holding `OWNER_ADMIN` (`audit.archive`):
  - Create durable archive batches via `POST /api/v1/audit-archive/batches`
    (which also reconciles any pending durable batch on retry after an
    interrupted database commit without duplicating files on disk).
  - Retrieve and verify stored batch bundles from `OWNER_AUDIT_ARCHIVE_DIR` via
    `GET /api/v1/audit-archive/batches/:id`.
  - Verify 1-to-1 integrity across `OWNER_AUDIT_ARCHIVE_DIR`,
    `owner_audit_archive`, and `owner.audit_events` via
    `POST /api/v1/audit-archive/verify` (`409 ArchiveIntegrityViolation` on any
    missing or tampered file or digest mismatch).
  - Recover after a PostgreSQL rollback or point-in-time restore via
    `POST /api/v1/audit-archive/recover`, which verifies the independent durable
    store (`OWNER_AUDIT_ARCHIVE_DIR`), restores any missing source events into
    `owner.audit_events` (preserving exact original `id`, `sequence`, timestamps,
    and digests) and missing batches/events into `owner_audit_archive`, and logs
    `AUDIT_ARCHIVE_RECOVERED`.
- **Deployment prerequisite vs. implemented guarantee:** mounting
  `OWNER_AUDIT_ARCHIVE_DIR` on a dedicated persistent volume/disk separate from
  the PostgreSQL data volume with its own backup/snapshot lifecycle is a
  deployment prerequisite; cryptographic hardware WORM / HSM is not implemented
  in Phase 1.
