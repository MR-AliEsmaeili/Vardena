# ADR-0012: Printing Template System

Status: Accepted
Date: 2026-09-10

## Context

ERP printing (invoices, goods receipt notes, reports, checks later) must be a
reusable system: document templates, HTML/CSS-based rendering, organization-
specific templates, user print preferences. Hardcoding every printed document
independently would fragment styling, make organization-specific layouts
impossible, and duplicate PDF generation.

## Decision

The Print module provides the **mechanism**; source modules provide **data**:

- **Document-type registry** (`print.document_types`): code, name, owning
  module, data provider reference, default template.
- **Module document providers** (`documents/` folder): each printable document
  registers a provider (fetch function + typed data shape). Business data stays
  owned by the source module (AR-08) — Print renders, it doesn't compute.
- **Templates** (`print.templates`): versioned **HTML/CSS** (template body +
  styles), scoped: system default → organization override → user preference
  (user preferences stored in Customization, category `print`: paper size,
  scale, template choice). Variable interpolation uses a constrained,
  allowlisted template syntax (no arbitrary code execution) — the exact engine
  syntax is an implementation detail chosen at first Print implementation
  (prefer a minimal mustache-like syntax).
- **Rendering pipeline:** print job = (document type, entity ref, context) →
  data provider → template → HTML → **PDF in the worker** (headless Chromium
  — RTL-safe, print-CSS accurate) → stored artifact (volume; storage port for
  later, OQ-08) → authenticated, permission-gated download.
  Small documents may render synchronously; heavy/large jobs run via Jobs with
  `PrintJob.Completed/Failed` notifications.
- **Browser printing** (HTML print stylesheet) is supported for light
  "print in browser" use, but PDF generation is the canonical path (consistent
  artifacts, stored history).
- Every print action is audited; template changes are admin permission-gated
  (`Print.Template.Manage`).

## Consequences

- One rendering path for all documents; new printable document = provider +
  type + default template (no engine change).
- Headless Chromium in the worker image: larger image, must be maintained —
  accepted for print-fidelity (RTL/complex CSS); the container is the standard
  on-premise unit.
- Template authoring UI (WYSIWYG) is out of v1 scope: templates are managed as
  versioned HTML/CSS via the admin (file-level editor) — a WYSIWYG editor is a
  later product decision.
- Artifact retention default 30 days (config, OQ-08).
