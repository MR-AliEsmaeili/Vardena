# C-47 — Inventory Item Master Completion: Preflight Investigation

| Field | Value |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED; implementation not authorized** |
| Inspection date | 2026-10-02 (UTC) |
| Inspection baseline | `main` and this branch at `b948e21636fa7fd7010012d66fd6bbadb1621f1b` (`b948e21`) |
| Roadmap identity | **C-47 Product/item master completion** — not Task 33 |
| Scope | Reconnaissance and decision brief only; production code, schema, migrations, permissions, tests and frontend unchanged by this report |

> **Follow-up note (2026-10-02).** The decisions this investigation requested
> in §9 have been recorded: **OD-C47-01** (OQ-29 Option A), **OD-C47-02**
> (OQ-33 Option D — Option A explicitly **not** approved), **OD-C47-03 /
> PDR-01** (barcode Option A — answering the §3.2 "explicit decision gap", with
> the reuse-after-deactivation residue registered as **OQ-65**) and
> **OD-C47-04** (OQ-36 Option C — code reuse still unanswered). **OQ-29, OQ-33
> and OQ-36 remain OPEN.** Records:
> [`c-47-item-master-owner-decision-record.md`](./c-47-item-master-owner-decision-record.md),
> [`PDR-01`](../decisions/product/PDR-01-item-barcode-policy.md).

## 1. Executive finding

The current repository already contains a substantial, wired Inventory master-data
slice. Items, hierarchical item groups, organization-scoped units, global and
item-specific effective-dated conversions, item references in the ledger, and
operation-level permissions are not absent. The main verified gaps are decision
readiness and regression/integration coverage, not an empty Item Master.

C-47 remains blocked by **OQ-29** and **OQ-33**. A bounded implementation can be
prepared without resolving every question in either OQ, but it must not silently
choose the kind taxonomy, conversion rounding/precision semantics, barcode policy,
or code/lifecycle policy. No OQ is closed here.

## 2. Governing sources and inspection method

Read first or checked against the current `main`: `.vardena/architecture-rules.md`,
`.vardena/agent-rules.md`, `.vardena/project-context.md`, `STATE.md`,
`docs/roadmap/backend-mvp-roadmap.md`,
`docs/roadmap/backend-mvp-dependency-matrix.md`,
`docs/roadmap/future-task-candidates.md`, `docs/open-questions.md`,
`docs/architecture/domain/master-data-strategy.md`,
`docs/architecture/domain/domain-glossary.md`, and
`docs/testing/test-execution-policy.md`.

Applicable decisions/design sources checked:

- `docs/adr/0022-inventory-core-ledger.md` — **Accepted**; base-unit storage,
  conversion resolution at business date, freeze-over-delete, organization scope,
  negative-stock policy and ledger references.
- `docs/adr/0017-inventory-ledger-as-source-of-truth.md` — **Proposed**, so it is
  design context rather than an accepted implementation authorization.
- `docs/adr/0020-organizational-scope-and-master-data.md` — **Proposed**; master-data
  ownership/lifecycle design context.
- `docs/adr/0006-rbac-granular-permissions.md`, `docs/adr/0008-single-database-
  module-schemas.md`, `docs/adr/0014-openapi-contract.md`, and the binding
  architecture rules.

The requested `.vardena/standard.md` is **not present on current `main`** (the
`.vardena/` directory contains `agent-rules.md`, `architecture-rules.md`, and
`project-context.md`). This is recorded as a repository evidence limitation; the
available binding rules and current code were used instead. No full suite, E2E suite,
live PostgreSQL test, migration rehearsal, or migration-heavy command was run.

### Exact read-only inspection commands executed

```text
git status --short
git log -1 --oneline main
ls -la .vardena
find backend/prisma backend/src -type f | sort | grep -Ei 'invent|item|unit|warehouse|permission|movement|conversion'
grep -RniE 'OQ-29|OQ-33|item master|item group|unit conversion|global conversion|C-47|Inventory' docs .vardena STATE.md
grep -RniE 'itemId|item_id|unitId|unit_id|conversion|quantity' backend/src/modules/inventory backend/prisma/schema
grep -n -A18 -B3 -E '^\| OQ-(29|33) ' docs/open-questions.md
```

Additional `cat`, `sed`, `grep`, `find` and `git` reads were used only to inspect the
paths listed below. No write, test, build, Prisma, server, or migration command was
executed other than creating this report.

## 3. Exact implementation inventory

### 3.1 Item, group, unit and conversion production code

| Capability | Production evidence | Current behavior |
|---|---|---|
| Item entity/kind/capabilities | `backend/src/modules/inventory/domain/item.ts`, `item-kind.ts`, `item-capabilities.ts` | One `Item`; closed code-defined kinds are `goods`, `service`, `consumable`, `asset`, `raw_material`, `semi_finished`, `finished_good`, `other`. Kind supplies creation defaults; stored booleans are authoritative. Invariants reject valued/lot/serial/expiry flags on a non-stockable item. |
| Item application service | `backend/src/modules/inventory/application/items.service.ts` | `listItems`, `getItem`, `createItem`, `updateItem`, `enableItem`, `disableItem`, `requireUsableItemInOrganization`. Validates organization, group and base-unit scope through owning public services; normalizes code/name/description/barcode; catches DB uniqueness races; publishes item events. `itemKind` is immutable. |
| Item group | `domain/item-group.ts`, `application/item-groups.service.ts`, `data/item-groups.repository.ts` | Organization-scoped self-referencing hierarchy. Create/update validates same-organization parent, self-parent and cycle. Lifecycle is enable/disable; no delete. One item has at most one `itemGroupId`. |
| Units | `domain/unit.ts`, `application/units.service.ts`, `data/units.repository.ts` | Organization-scoped reusable UoM rows (`code`, `name`, optional `symbol`, active state). No hard-coded unit seed/list. Same operation/lifecycle pattern as other master records. |
| Conversions | `domain/unit-conversion.ts`, `application/unit-conversions.service.ts`, `data/unit-conversions.repository.ts` | Global (`itemId = null`) and item-specific rows. Positive decimal factor, pair validation, half-open effective windows, open-ended version supersession, historical `resolveVersionAt`; no in-place edit endpoint. Item-specific conversion wins over global for the same pair/as-of instant. |
| HTTP contracts | `backend/src/modules/inventory/api/{items,item-groups,units,unit-conversions}.controller.ts`; DTOs in `api/dto/` | Versioned REST routes under `/api/v1/inventory/...`; list/get/create/update plus enable/disable for lifecycle entities; conversion list/get/resolve/create only. DTOs validate ULIDs, dates, booleans and factor shape. OpenAPI decorators describe the same contracts. |

### 3.2 Schema, migration and constraints

Evidence: `backend/prisma/schema/inventory.prisma` and migration
`backend/prisma/migrations/20260911010000_inventory_master_data/migration.sql`.

- `inventory.items` has organization FK, code/name/description, `item_kind`, one
  `item_group_id`, one `base_unit_id`, seven capability columns,
  `allow_negative_stock`, optional `barcode`, active/audit timestamps, and
  organization-scoped unique `(organization_id, code)`. Indexes cover active state,
  kind, stockable state, group and base unit.
- `inventory.item_groups` has organization FK, self-parent FK, unique
  `(organization_id, code)`, active and parent indexes.
- `inventory.units` has organization FK, unique `(organization_id, code)`, and active
  index. Unit codes are not globally shared across organizations.
- `inventory.unit_conversions` has organization/from/to FKs, `factor numeric(18,6)`,
  `valid_from`/`valid_to`, unique `(organization_id, from_unit_id, to_unit_id,
  valid_from)` and pair indexes.
- `inventory.item_unit_conversions` has item and unit FKs, the same factor/window
  shape, unique `(item_id, from_unit_id, to_unit_id, valid_from)`, and item-pair
  indexes. The database FK does not itself encode that all referenced records share
  the same organization; application services perform that validation.
- There is **no database unique constraint on `barcode`**. Barcode uniqueness,
  normalization, whether a barcode may be reused, and whether multiple barcode
  formats/aliases are required are not established by OQ-29/OQ-33 or the current
  contract. This is an explicit decision gap, not a proposed policy.
- The migration and current schema contain no EAV/attribute table and no generic
  JSONB item attribute field. This is consistent with the master-data strategy and
  the architecture prohibition on generic business-critical EAV/JSONB.

### 3.3 Movement, warehouse and quantity references

- `backend/src/modules/inventory/application/inventory-movements.service.ts` and
  `inventory-posting-support.ts` resolve an item and its base unit before posting.
  They preserve entered quantity/unit and calculate signed base quantity.
- `backend/prisma/schema/inventory.prisma` models `InventoryMovement` with
  `itemId`, entered `unitId`, `baseUnitId`, entered `quantity`, `baseQuantity`, and
  `conversionFactor`; `InventoryBalance` is keyed by item/warehouse/base-unit
  dimensions; reservations carry the corresponding item/unit references.
- `backend/src/modules/inventory/application/inventory-balances.service.ts` filters
  balances by `itemId`; warehouse services enforce lifecycle guards. There is no
  downstream Sales/Purchasing/Accounting Item Master consumer in this repository.
- `backend/src/modules/inventory/domain/quantities.ts` uses decimal strings and
  exact BigInt mantissa arithmetic. Quantity storage is `numeric(18,4)` and factors
  are `numeric(18,6)`. Entered quantities are positive, non-exponential strings with
  up to four fractional places. `fitsQuantity` rejects an exact product needing
  more than four fractional places; it does not round.

### 3.4 Permissions

Evidence: `backend/src/modules/inventory/domain/inventory-permissions.ts`,
`inventory-permission-registration.ts`, and the four controllers.

- Items, groups and units each register distinct `View`, `Create`, `Edit`, `Enable`
  and `Disable` permissions.
- Unit conversions register `View` and `Create` only. A conversion change is a new
  effective-dated version, not an edit.
- Every route has authentication/authorization guards and matching
  `@RequirePermission`; services also call authorization checks.
- No `*.Delete` permission or DELETE endpoint exists for these master records.

### 3.5 Existing test evidence (not executed in this investigation)

The following tests are present in the checkout and were inspected by name; they
are evidence of existing coverage, not a claim that they passed in this turn:

- `backend/src/modules/inventory/application/items.service.spec.ts` —
  `fills every capability from the kind defaults when none is given`,
  `rejects an unknown item kind`, `rejects a capability combination that
  contradicts the behaviour table`, `rejects a duplicate code within the
  organization`, `rejects an item group from another organization`, `rejects a
  base unit from another organization`, `does not re-apply the kind defaults on
  edit`, `reads an item of another organization as not found`, and organization
  listing/filter/sort cases.
- `backend/src/modules/inventory/application/unit-conversions.service.spec.ts` —
  `creates a global conversion version and publishes the event`, `rejects a
  non-positive or over-precise factor`, `supersedes the open-ended version and
  closes it at the new validFrom`, `resolves the version in force at an instant,
  historically`, `returns null rather than inventing a 1:1 conversion`,
  `prefers an item-specific version over the global one`, and cross-organization
  conversion cases.
- `backend/src/modules/inventory/domain/item-capabilities.spec.ts`,
  `unit-conversion.spec.ts` and `quantities.spec.ts` cover kind defaults,
  capability invariants, half-open conversion windows, exact arithmetic and the
  `numeric(18,4)` fit gate.
- `backend/test/master-data.e2e-spec.ts` contains the HTTP journey for organization
  → group → item → unit → conversion, including unknown kind, capability conflict,
  foreign unit, conversion history/precedence, missing conversion, item filters,
  and no-DELETE behavior.
- `backend/test/inventory-core.e2e-spec.ts` covers real application movement
  references and organization-scoped posting behavior, including
  `rejects a posting whose references belong to a different organization`.

These tests do not by themselves establish the unresolved business decisions, and
this investigation did not add or alter them.

## 4. Evidence-based gap matrix

Status vocabulary here is deliberate: **VERIFIED** means observed in current code;
**DECISION GAP** means behavior must not be inferred; **COVERAGE GAP** means the
production path exists but proof is incomplete; **UNKNOWN** means this inspection did
not establish the fact.

| Capability | Current status and evidence | Existing constraints/behavior | Gap classification | Dependencies / MVP need |
|---|---|---|---|---|
| Item coding and identity | **VERIFIED implemented** — `ItemsService`, `ItemsRepository`, `Item` model | Trimmed code; organization-scoped DB uniqueness; case-sensitive equality in the unique index; race fallback maps unique violation to conflict; no delete/reuse path | **Decision gap:** OQ-36 owns deletion/reuse and case policy; **coverage gap:** current item service tests/e2e prove core journeys but a dedicated live uniqueness race should be added | Needed for C-47 MVP; OQ-36 is related, not a reason to invent deletion |
| Item kinds | **VERIFIED implemented, policy unresolved** — `item-kind.ts` exact eight-value list and defaults | Kind immutable; defaults resolved only at create; several defaults are explicitly recorded assumptions in source, especially raw/semi-finished/finished/other and asset serial tension | **Decision gap:** OQ-33 asks whether list is complete and flags may vary per kind/item | Required before claiming the taxonomy is approved; existing CRUD can be retained pending explicit confirmation |
| Capability flags and lifecycle | **VERIFIED implemented** — `item-capabilities.ts`, `items.service.ts` | Flags stored per item; kind does not reapply on edit; non-stockable/valued/traceability contradictions rejected; item base unit and stockable-off are frozen after movements; item disable is blocked while balance remains | **Coverage gap:** these freeze and concurrent organization-isolation paths need focused regression/live-DB proof; semantics depend on OQ-33 for any new flags/kinds | Core C-47 behavior; no valuation or document semantics should be added here |
| Item group hierarchy | **VERIFIED implemented** — group service/domain/repository | One group per item; organization-scoped code; parent same-org; self/cycle rejection; active lifecycle; group is classification/default source, not stock/accounting | **Coverage gap:** retain existing HTTP tests and add/confirm dedicated unit, cross-org and concurrent unique tests if not already present | MVP-required as item classification; no new group-default behavior without approval |
| Units | **VERIFIED implemented** — unit service/domain/repository/schema | Organization-scoped code uniqueness; active lifecycle; reusable rows; no seeded universal unit list; no precision column | **Decision gap:** OQ-29 per-unit precision; **coverage gap:** live unique race and cross-org isolation should be proven | MVP-required; precision decision blocks final quantity contract but not read/list/basic CRUD |
| Global conversions | **VERIFIED implemented** — conversion service/repository/schema and tests | Effective-dated pair versions; factor positive and `numeric(18,6)`; no in-place edit; no implicit 1:1 when absent; history resolves by as-of date | **Decision gap:** OQ-29 rounding, precision and factor-change semantics; **coverage gap:** multi-transaction supersession/overlap race is not established by hermetic tests | MVP-required for unit-bearing movement; exact current behavior can be retained without calling rounding resolved |
| Item-specific conversions | **VERIFIED implemented** — same service/repository with `itemId`; HTTP journey proves item-specific precedence | Same versioning/constraints; item-specific preferred over global; item and units must be organization-valid through service checks | **Decision gap / coverage gap** as above; real PostgreSQL concurrency and cross-org races not verified in this investigation | MVP-required where packaging differs by item |
| Quantity conversion | **VERIFIED implemented with fail-closed current rule** — `quantities.ts`, `inventory-posting-support.ts`, movement service | Exact arithmetic; base-unit snapshot and factor retained; product exceeding 4 fractional places is rejected, not rounded | **Decision gap:** this rejection is an interim implementation behavior, not an approved business rounding rule; OQ-29 must decide whether it remains | Must be explicitly approved or changed before C-47 is considered complete |
| Barcode | **PARTIAL** — nullable string field and DTO/service max-length validation; searchable in item repository | No uniqueness constraint, assignment lifecycle rule, symbology/check-digit validation, aliases, or scan contract found | **Decision gap / implementation gap after decision** | C-47 candidate explicitly mentions barcode; owner/domain expert must choose policy before schema/API changes |
| Warehouse/movement references | **VERIFIED implemented** — ADR-0022, movement/balance services and schema | Item is organization-scoped; posting resolves item/base unit; warehouse owns negative-stock policy; movements/balances preserve base-unit identity | No Item Master gap found in this boundary; downstream receipt/issue, opening, costing and valuation are excluded | Dependency evidence only; do not expand C-47 |
| HTTP and permissions | **VERIFIED implemented** — controllers/DTOs/permission registry | Operation-level backend authorization, organization query scope, 404 no-disclosure posture, no DELETE | **Coverage gap:** endpoint matrix and cross-org IDOR/concurrency should be maintained/regressed | MVP-required and safe to retain |

## 5. OQ-29 — Units and conversions

### Current question and scope

Current `docs/open-questions.md` wording is: “Units and conversions: precision per
unit, rounding rules for fractional conversions, whether conversion factors may
change over time (and with what effect on history), and which conversions are global
vs item-specific.” It affects unit/conversion tables, document-line math, stock
reports and valuation rounding. The temporary assumption is base-unit storage with
explicit conversions, effective-dated configuration, and expert sign-off for
rounding.

### Verified current decisions/behavior (not closure)

- One base unit per item; quantities are stored in the base unit.
- Global and item-specific conversion tables both exist.
- Current code versions rows and resolves at the business date; movement rows retain
  entered/base values and factor.
- Factors are decimal strings, stored as `numeric(18,6)`; quantities are
  `numeric(18,4)`.
- Current code rejects a product that cannot fit exactly into four fractional places;
  this is fail-closed implementation behavior, not an Owner-approved rounding rule.
- The strategy document calls effective dating a recommendation/contract shape while
  OQ-29 expressly keeps change-over-time semantics unresolved. Do not describe the
  current versioning as the final business decision.

### Decisions that depend on OQ-29

1. Per-unit precision: one fixed repository-wide quantity scale, precision on each
   unit, or another bounded model; permitted integer/fractional quantities.
2. Fractional conversion handling: reject, round, truncate, or another expert-approved
   rule; rounding mode and where it occurs (line, movement, balance/report).
3. Whether factors may change, effective-date semantics, and whether existing
   documents/movements snapshot factor and entered/base quantities (the current code
   snapshots them, but the business decision must confirm it).
4. Precedence and permitted scope of global versus item-specific pairs, including
   whether a global pair may be overridden for one item (current code does so).
5. Whether reverse conversion is explicit or derived; the current implementation does
   not silently invent absent pairs.

### What can safely proceed without resolving OQ-29

- Retain organization-scoped units and the existing read/list/basic lifecycle API.
- Retain separate global and item-specific tables and module ownership.
- Retain decimal-string transport and exact arithmetic; do not add float math.
- Retain historical fields and no in-place conversion edit, subject to decision
  confirmation.
- Add tests that characterize current behavior without declaring the policy final.

### Concrete options and consequences

| Option | Consequence |
|---|---|
| A — Keep fixed `numeric(18,4)` and reject non-fitting exact results | Simplest, deterministic and fail-closed; some legitimate fractional results cannot be posted; current code is closest to this option. Requires explicit expert approval. |
| B — Unit-specific precision plus approved rounding mode | Models units such as count versus weight more naturally; requires a precision field/contract, rounding implementation, migration and broad document/report tests. |
| C — Keep storage scale but round at a defined boundary | Smaller schema impact than B but can create discrepancies unless line, movement, balance and report boundaries are specified and tested. |
| D — No implicit conversion unless an exact representable result exists; explicit alternate unit/quantity entry | Strong auditability and no rounding surprises; more user friction and potentially more conversion maintenance. |

**Recommendation for Owner/domain expert approval:** do not select an option by this
report. The repository evidence supports retaining exact decimal arithmetic and
snapshotting as the safe interim posture. An Inventory expert and accountant should
explicitly choose the precision and rounding policy before any C-47 production change
that relies on it. The Owner must approve the product scope; the domain expert must
approve the quantity/conversion semantics.

## 6. OQ-33 — Item model

### Current question and scope

Current `docs/open-questions.md` asks whether the kind list
`goods`, `service`, `consumable`, `asset`, `raw_material`, `semi_finished`,
`finished_good`, `other` is complete, and which capabilities
`is_stockable`, `is_purchasable`, `is_sellable`, `is_valued`, `requires_lot`,
`requires_serial`, `requires_expiry` may be enabled/disabled per item versus per
kind. It affects item shape, document validation, stock/valuation behavior and
import mapping. Temporary posture: one table, closed kind list, kind defaults and
explicit flags.

### Decisions that depend on OQ-33

1. Confirm, rename, remove or add kinds; adding a kind is a code/migration change.
2. Confirm each kind's defaults, including the recorded assumptions for
   raw/semi-finished/finished/other and the asset/serial tension.
3. Decide whether every listed capability is per-item overrideable, kind-mandatory,
   kind-forbidden, or organization-configurable. In particular, traceability flags
   have downstream lot/serial/expiry implications not implemented in this slice.
4. Confirm whether item group is one-to-zero/one classification (current behavior) or
   whether another classification model is required; no many-to-many model is
   authorized by current evidence.
5. Confirm whether barcode is one optional value or a unique/multi-alias scan identity;
   validation, normalization and reuse rules follow from that choice.
6. Confirm item lifecycle/code policy in conjunction with OQ-36: deletion eligibility,
   soft-delete/hard-delete, and whether a disabled/deleted code can be reused. This
   report does not resolve OQ-36.

### What can safely proceed without resolving OQ-33

- Retain one Inventory-owned Item table, typed columns and stored capability flags;
  do not create Product/Service/Asset tables.
- Retain organization scope, operation-level permissions, group FK, base-unit FK,
  active lifecycle and existing movement references.
- Retain current read/list endpoints and tests as characterization coverage.
- Add regression tests around current invariants and organization isolation without
  adding kinds, flags or new barcode semantics.

### Concrete options and consequences

| Option | Consequence |
|---|---|
| A — Confirm current eight kinds and current per-item flags/defaults | Smallest change; preserves code and schema; explicitly accepts the assumptions and
  downstream semantics. |
| B — Confirm kinds but constrain overrides by kind | Stronger domain integrity; requires validation matrix and likely future schema/config
  decisions; reduces per-item exceptions. |
| C — Reduce to a smaller operational taxonomy and treat distinctions as flags | Less taxonomy maintenance; loses reporting semantics and may affect future Sales/
  Purchasing/production flows. |
| D — Add kinds/capabilities now | Better fit only if Owner/domain expert provides a concrete requirement; requires
  migration, API/OpenAPI, permission/test and downstream contract work. |

**Recommendation:** retain the one-table/typed-flags architecture and ask the
Owner plus Inventory domain expert to confirm Option A or provide the exact delta.
Do not accept the source comments' recorded assumptions as business approval.
Barcode policy should be approved as a separate explicit decision under this OQ or a
linked OQ before adding a uniqueness constraint or alias table.

## 7. Proposed bounded C-47 slice (authorization required later)

This is a proposal, not an implementation authorization.

### Retain

- Existing Item, ItemGroup, Unit, UnitConversion and ItemUnitConversion models,
  services, repositories, controllers, DTOs, permissions and organization checks.
- One Inventory owner and modular-monolith boundaries; cross-module references use
  Organization public services and Inventory public services, never direct Prisma.
- Base-unit storage, entered/base quantity snapshot shape, effective-dated conversion
  history and fail-closed behavior until OQ-29 is approved or changed explicitly.

### Complete only after decisions

- Confirm/fix item-kind/default matrix and capability invariants from OQ-33.
- Implement the approved barcode policy (possibly no schema change if optional and
  non-unique; a migration only if the approved policy requires one).
- Complete any approved per-unit precision/rounding and conversion-version changes
  from OQ-29.
- Close genuine HTTP contract/test gaps: item/group/unit CRUD lifecycle, IDOR/no-
  disclosure, organization-scoped uniqueness under concurrent PostgreSQL writes,
  conversion overlap/supersession concurrency, disabled-reference behavior, and
  item freeze guards.
- Keep OpenAPI DTO/controller contracts synchronized with approved behavior.

### Proposed acceptance criteria

1. All approved item kinds and capability rules are explicit in code, DTO behavior,
   schema (where needed), and tests; no source-file assumption remains unreviewed.
2. Item/group/unit codes have an owner-approved scope, comparison and lifecycle/reuse
   policy, with database-authoritative uniqueness tested under concurrent PostgreSQL
   writes.
3. Barcode behavior is explicit and tested, including duplicate/reuse/format behavior
   if the approved policy requires it.
4. OQ-29-approved precision, conversion factor, effective-date, precedence and
   fractional-result behavior is documented, exact, and tested; no silent rounding.
5. Item base-unit/stockable lifecycle freezes preserve existing movement history.
6. All routes retain backend authentication, operation-level permission checks,
   organization scope and 404 no-disclosure behavior.
7. No direct cross-module Prisma access, generic EAV/JSONB, frontend change, or
   downstream document/costing/accounting behavior is introduced.
8. CI runs the hermetic regression suite plus the required live PostgreSQL,
   migration and concurrency gates; local verification must not claim those gates.

## 8. Dependencies, non-goals and risks

### Dependencies

- Owner/product decision on C-47 admission and OQ-33 taxonomy/capability policy.
- Inventory expert and accountant decision on OQ-29 precision/rounding/history.
- OQ-36 for deletion/code reuse; it is not silently folded into C-47.
- Later consumers (Sales, receipt/issue, opening, valuation) must consume Item via
  Inventory contracts; they are not prerequisites for this bounded master slice but
  their requirements must not be guessed here.

### Explicit non-goals

Opening quantity/rial, costing, valuation method, receipt/issue documents, Kardex,
locations/bins, lots/serial implementation, Inventory-to-Accounting integration,
Sales, Purchasing, Treasury, frontend, generic master-data abstraction, EAV/JSONB,
new packages, and any migration not proven necessary after approval.

### Risks

- Treating source comments or the current fail-closed rounding behavior as approved
  policy would silently close OQ-29/OQ-33.
- Adding barcode uniqueness without deciding aliases/reuse can reject legitimate
  data or make historical scanning ambiguous.
- Application pre-checks alone do not prove uniqueness; PostgreSQL unique constraints
  and concurrency tests are required where policy calls for uniqueness.
- Changing base units, factors or capability flags after movements can reinterpret
  history; freeze/snapshot behavior must remain transactionally tested.
- Existing ADR-0017/0020 are Proposed while ADR-0022 is Accepted; the implementation
  task must not cite Proposed text as if it were an accepted override.

## 9. Questions requiring explicit Owner/domain-expert decisions

1. **Owner + Inventory expert:** Is the eight-value OQ-33 kind list complete? Confirm
   the names and defaults for all kinds, especially raw material, semi-finished,
   finished good, other and asset serial behavior.
2. **Owner + Inventory expert:** Which capabilities are per-item overrides versus
   kind constraints/defaults? Are lot/serial/expiry semantics admitted in C-47 or
   only their master flags?
3. **Owner + Inventory expert/accountant:** Which OQ-29 precision and fractional
   conversion policy applies? Is current exact-fit rejection accepted, or what exact
   rounding mode/boundary replaces it?
4. **Owner + Inventory expert:** May conversion factors change over time, with what
   effective-date and historical snapshot semantics, and may item-specific factors
   override global factors?
5. **Owner + Inventory expert:** What is the barcode contract: optional single value,
   unique within organization, reusable after disable, validated symbology, or
   multi-alias? Do not add a constraint until answered.
6. **Owner + architecture/product:** Confirm code comparison and reuse/deletion
   posture for item/group/unit records, or explicitly defer to OQ-36 without making
   C-47 claim completion.
7. **Owner:** Which of the proposed acceptance criteria and PostgreSQL CI tests are
   mandatory for MVP acceptance, and is C-47 authorized only after these decisions?

## 10. Suggested next implementation task

After the decisions above are recorded (without changing OQ status through this
report), create an Owner-approved implementation task using roadmap candidate **C-47**:
“Implement approved Inventory Item Master completion.” Its brief should link this
investigation, quote the accepted decision record(s), state the exact schema/API delta
or zero-migration result, and split production changes from regression and CI live-DB
coverage. The first implementation PR should remain bounded to Inventory master data;
any downstream document or valuation work must be separately admitted.

## 11. Verification matrix

| Category | This investigation |
|---|---|
| Repository/source inspection | **Executed**; evidence is the current checkout at `b948e21` / `main` |
| Production code/schema/migration modification | **Not done** |
| Tests/build/typecheck/lint | **Not run** |
| Full E2E/live PostgreSQL/migration-heavy verification | **Not run**, intentionally, per user instruction and `docs/testing/test-execution-policy.md` |
| Claims of pass/fail | None made |

**No heavy E2E/live-DB test was executed locally unless explicitly authorized.**

## 12. Evidence labels

- **Verified facts:** current files, routes, permissions, schema constraints,
  service behavior, and tests named above as observed in this checkout.
- **Proposals:** the bounded C-47 scope, options, recommendations and acceptance
  criteria in §§5–10.
- **Unknowns/decision gaps:** OQ-29/OQ-33 answers, barcode semantics, final rounding/
  precision policy, code reuse/deletion policy, and any behavior not established by
  current code or approved decision records.

This report does not resolve OQ-29, OQ-33 or OQ-36, does not authorize C-47, and does
not claim C-47 implementation is ready to merge.
