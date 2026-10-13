# ADR-0011: Validated Excel Import Workflow

Status: Accepted
Date: 2026-09-10

## Context

Excel import is a first-class capability (item masters, customers, stock
adjustments, opening balances…). Naive "upload → INSERT" is dangerous in an ERP:
silent bad data, partial garbage, no user trust. The requirements mandate:
Upload → Parse → Validate → Preview → user confirmation → transaction →
persist → result summary, with row-level validation feedback.

## Decision

The Excel module owns the **mechanism**; each target module provides the
**content** via `imports/` **ImportSpecs**:

- **Session lifecycle** (`excel.import_sessions`):
  `uploaded → parsed → validated → (preview) → confirmed → applying →
  completed | failed | canceled`. Rows (`excel.import_rows`) carry per-row
  status (`pending|valid|invalid|imported|skipped`), error code, message, and
  the parsed payload.
- **ImportSpec** (per target entity, owned by the target module): target
  module's import application service reference, allowed column mapping,
  per-row validators (format + business rules), upsert key, batch size,
  post-commit events.
- **Apply boundary:** the Excel module **never writes to another module's
  tables**. Apply = calling the target module's **public import application
  service** with validated row batches, inside the module's own transaction
  semantics (batch-level: a failed batch rolls back its batch, other batches
  report their rows as failed — row-level feedback is preserved, AR-07/08).
- **Idempotency/safety:** re-applying a completed session is rejected; the
  upsert key makes confirmed batches deterministic; apply is permission-gated
  (`Excel.Import` + target module's create/edit permissions).
- **Scale:** files above a size threshold (config) are processed asynchronously
  via Jobs with progress; parse is streaming (no whole-file-in-memory
  guarantees); result summary = counts + downloadable error file (Excel export
  of failed rows).
- **Upload limits:** size cap (default 10 MB v1), `.xlsx` only (OQ if ODS/csv
  needed).

## Consequences

- User-trusted imports: nothing persists before explicit confirmation; every
  row has an explainable fate.
- Business validation rules live with their business module (the ImportSpec
  references module validators) — no rule duplication in Excel (AR-06).
- Partial-failure semantics are explicit (batch granularity), documented per
  target in its module section.
- Bootstrap imports from the legacy ERP (ADR-0003) reuse this pipeline for
  validate/preview/confirm discipline.
