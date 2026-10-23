# ADR-0052: Frontend Modernization — Semantic Themes, Font Scales, Full-Width RTL Shell and Operational Form Patterns

Status: Proposed — implemented for Product Owner review (2026-10-23)
Date: 2026-10-23

## Context

The customer ERP frontend required a cohesive, dense, Persian/RTL operational UX
across Accounting, Inventory, Organization, and Administration without adding
competing UI frameworks, global state libraries, or second calendar engines
(ADR-0002, ADR-0042, ADR-0044, AR-30, AR-32). Specifically, operators needed:
light/dark themes, three non-breaking font scales, a full-width shell with a
collapsible categorized sidebar and structured RTL header, an interactive Jalali
date picker, a standardized five-zone operational form pattern with a
high-density keyboard/context-menu Detail Grid, and read-only cross-document
line explorers.

## Decision

1. **Zero new runtime dependencies (ADR-0002 / AG-11).** Implement `Dialog`,
   `DropdownMenu`, `Tooltip`, row virtualization (`useVirtualWindow`), exact
   decimal string summation (`src/lib/decimal.ts` via `BigInt`), UTF-8 BOM CSV
   export (`src/lib/export-table.ts`), and the interactive Jalali calendar
   popover directly on the existing React 19 + Tailwind v4 + `src/lib/datetime`
   foundation.
2. **Root-attribute appearance tokens.** Drive Light/Dark themes via semantic
   CSS token overrides on `html[data-theme='dark']` and three `rem`-proportional
   font scales (`compact` `14.5px`, `default` `16px`, `comfortable` `17.5px`) on
   `html[data-font-scale]`, persisted under `vardena:appearance:v1` with a
   pre-hydration script in `index.html` to prevent FOUC.
3. **Full-width RTL shell and single-landmark collapsible sidebar.** Remove
   artificial `max-w-[1600px]`/`max-w-[1440px]` clamps; keep one semantic `<nav>`
   landmark (`#app-navigation`) serving both desktop icon-rail/expanded modes
   (persisted under `vardena:sidebar:v1`) and the focus-trapped mobile drawer;
   order the header strictly RTL (Logo → Search → Jalali Date → Organization →
   Settings → Profile).
4. **Five-zone Operational Form & virtualized Detail Grid.** Standardize
   Accounting and Inventory document forms on `OperationalFormShell`
   (`OperationalToolbar`, required-gated `CollapsibleHeader` with collapsed
   summary chips, keyboard-navigable `DetailGrid` with row Context Menu and 80+
   row windowing, `BigInt` `OperationalSummary`, and three-zone
   `OperationalFooter` with dirty-guarded document pagination).
5. **Read-only Document Lines Explorers over existing APIs.** Expose
   `/app/accounting/document-lines` and `/app/inventory/document-lines` over the
   existing authorized document list endpoints (`GET /accounting-documents` and
   `GET /inventory/business-documents`), pairing every line with its parent
   document header metadata without altering backend contracts or RBAC.

## Consequences

- Every semantic-token surface adapts to Light/Dark themes and three font scales
  without component-level theme branching or layout overflow.
- `scripts/check-date-contract.py`, `scripts/check-frontend-design-tokens.mjs`,
  and the Owner UI staged date-source contract (`ADR-0048`) remain intact.
- Client-side print (`@media print`) and UTF-8 BOM CSV export operate honestly
  on loaded API pages until backend Reporting/Excel/Print modules (ADR-0011,
  ADR-0012) are implemented; user avatar upload and cross-entity full-text
  search remain documented backend contract boundaries rather than mocked UI.
