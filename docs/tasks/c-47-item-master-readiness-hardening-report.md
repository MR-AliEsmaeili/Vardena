# C-47 — Inventory Item Master: Readiness, Regression Hardening & Decision Preparation (Implementation Report)

> Companion to, and a direct execution of,
> [`c-47-item-master-preflight-investigation.md`](./c-47-item-master-preflight-investigation.md)
> (PR #106), whose proposed bounded slice §7 this work realizes: **retain the
> existing, already-implemented item master; close the demonstrated defects and
> the coverage gaps that hide regressions; prepare OQ-29/OQ-33 for an Owner
> decision without selecting any option.**
>
> Rules honored throughout: AG-03 (scope discipline), AG-09/AR-31 (no invented
> business rules), the "NOT authorization to implement a new item model"
> constraint in the work order, and `docs/testing/test-execution-policy.md`.
> **No heavy E2E/live-DB test was executed locally unless explicitly authorized.**

## 1. Executive summary

The item master (items, item kinds/capabilities, units, global + item-specific
unit conversions, freeze guards against the ledger) was already substantially
implemented and deployed — confirming the preflight's finding. This work order
hardened it, closed **two genuine production defects**, fixed **one verified
frontend contract drift**, and added the missing regression coverage:

| # | Finding | Kind | Fix |
|---|---|---|---|
| D-1 | **Conversion supersession race**: `createConversion` planned (read versions + `planNewVersion`) **outside** the write transaction, then closed+inserted inside it. Two concurrent creates for one unit pair could both conclude "no overlap" (or mutually stale supersession sets) and leave the pair with overlapping/multiple open-ended versions — which the planner then rejects forever (the pair wedges). | Demonstrated by code reading (`unit-conversions.service.ts` + `unit-conversions.repository.ts` control/data flow); the single-threaded fake made the race unprovable hermetically. | **Fixed in production.** Repository now takes a pair-scoped `pg_advisory_xact_lock` inside the transaction, re-reads, re-plans (`planNewVersion` — the already-approved invariant, no new rule), closes+inserts; a stale plan throws typed `ConversionPlanRejectedError` mapped by the service onto the same stable 422/409 contract as before. Documented as concurrency-critical raw SQL in `docs/modules.md` (AR-11). |
| D-2 | **`resolveConversion` cross-organization disclosure**: item-specific versions are keyed by the item (the item determines the organization), and the resolve path never proved the item belongs to the queried organization — a caller holding `Inventory.UnitConversion.View` could resolve another organization's factors (ADR-0022 §8 no-disclosure posture also names conversion factor values as data to protect). | Demonstrated by code reading: `resolveConversion` called `repository.findItemVersions(itemId, …)` with no org proof; the in-memory fake reproduces it (`returns factor` against a foreign item before the fix). | **Fixed in production.** The item is now validated via `requireUsableItemInOrganization(itemId, organizationId, { allowInactive: true })` before any item-scope read; `assertOrganizationInScope` backstops the global path exactly like every other org-scoped read. History stays resolvable for disabled items (master-data-strategy §7.4 — behavior deliberately preserved). |
| D-3 | **Frontend contract drift** (item master surface): `CreateItemDto.requiresLot/requiresSerial/requiresExpiry` are optional in the backend and take the item kind's default at the service layer, but `@ApiPropertyOptional({ default: false })` made the committed frontend types emit them as **required**. | Verified by comparing the three DTO blocks against `frontend/src/api/generated/vardena-api.d.ts` (the only drift found anywhere on the item-master surface; everything else is byte-aligned). | **Fixed.** Decorators now state "omit to take the kind default" (metadata only, no business semantics); the generated file was **regenerated through the real pipeline** (test app → `/api/docs-json` → `openapi-typescript@7.13.0`, the repo's own `api:types` flow) and the diff is exactly the three property blocks — proving no other drift exists. |

Nothing else in the item master was changed. No new kind, capability flag,
quantity rounding behavior, unit precision policy, barcode policy, deletion or
code-reuse behavior, EAV/JSONB attributes, valuation/accounting behavior,
cross-module DB access, document abstraction, or migration was added. OQ-29 and
OQ-33 remain open (§6/§7); the fail-closed precision rejection remains
*business-unapproved* interim behavior, exactly as before.

## 2. Reconnaissance evidence (sources of truth)

Read fully before any change; `main` at `52e6a4662317c5b2745b604fc6cae3e37e87f96f`:

- `.vardena/{project-context,architecture-rules,agent-rules}.md`, `STATE.md`,
  `docs/open-questions.md` (OQ-29/OQ-33/OQ-36 verbatim), `docs/modules.md`,
  `docs/architecture/domain/{master-data-strategy,inventory-domain-analysis,domain-blueprint}.md`,
  ADR-0017 (Proposed), ADR-0022 (Accepted), `docs/testing/test-execution-policy.md`,
  `docs/roadmap/future-task-candidates.md` (C-47 row), the merged preflight
  report, and `docs/tasks/task-33/*` (C-46 precedent: reconnaissance +
  regression hardening without inventing rules).
- Production: `backend/src/modules/inventory/{domain,application,data,api}/…`
  for item/item-kind/item-capabilities/unit-conversion/quantities/hierarchy,
  items/item-groups/units/unit-conversions/warehouses/inventory-movements
  services + repositories + controllers + DTOs,
  `backend/prisma/schema/inventory.prisma`, migration `20260911010000_inventory_master_data`.
- Tests: all hermetic specs named in §4, the HTTP hermetic e2e
  (`master-data.e2e-spec.ts`), `master-data-authorization.spec.ts`,
  `warehouse-master-live.e2e-spec.ts` (live-PG precedent), `.github/workflows/ci.yml`.

## 3. Confirmed defects and fixes (production)

Only defects demonstrable from current code, fixable without choosing any
unresolved business rule, staying inside the accepted architecture, and
coverable by regression tests were fixed. Everything else is documented as
either *known-decision-pending* (§6/§7) or *already-tested current behavior*.

### Fix 1 — conversion version planning moved inside the locked transaction

- `backend/src/modules/inventory/data/unit-conversions.repository.ts` —
  read-lock-plan-close-insert inside `$transaction`; new exported
  `ConversionPlanRejectedError` (data→application error-mapping doctrine of
  `inventory-posting-errors.ts`) and `PlannedVersionWrite` (returns the
  superseded id actually closed, which the service uses verbatim in the
  `UnitConversion.Created` event payload — no event-shape change).
- `backend/src/modules/inventory/application/unit-conversions.service.ts` —
  keep all input validation and fail-fast window validation (stable messages);
  drop the outside-tx plan; map `ConversionPlanRejectedError` to the same
  422 messages as before; keep the unique-index race → 409 conflict mapping;
  publish the event identically.
- `backend/test/support/master-data-repositories.ts` —
  `InMemoryUnitConversionsRepository` mirrors the new contract (it plans inside
  `writeVersion` against current table contents, which in-memory == post-lock
  snapshot) and throws the same typed error, so contract drift fails at
  compile-time again (its header note documents the planning mirror).
- `docs/modules.md` §Inventory — the advisory-lock path documented (AR-11).

Hermetic behavior/messages are unchanged by construction: single-threaded
overlap still 422 `BusinessRuleViolation`, same-instant race resolved by the
index still 409 `Conflict` — the live suite proves the pair-invariant end
state (§5).

### Fix 2 — resolve-path organization enforcement

`unit-conversions.service.ts` only: `assertOrganizationInScope` (global path
mirror of every other read) + `requireUsableItemInOrganization(itemId, orgId,
{ allowInactive: true })` when `itemId` is present. Effect: a foreign item id
yields opaque 404 (`EntityNotFound`), and an unauthorized-scope organization id
stops at the same opaque boundary under a real principal
(`master-data-authorization.spec.ts` proves this with the real RBAC path).
`resolveEnteredToBase`/postings are unaffected (the item is already
org-validated there upstream) — verified by the live suite.

### Fix 3 — generated frontend contract (verified drift only)

`backend/src/modules/inventory/api/dto/item.dto.ts` (3 decorator metadata
blocks) + regenerated `frontend/src/api/generated/vardena-api.d.ts` (the
three property blocks optional again, comment corrected; regeneration proven
byte-surgical). No inventory frontend UI exists to break (`frontend/src/features/`
has no inventory feature; the dashboard consumes `/inventory/balances`
types only).
**Observation logged for the record (not implemented — tooling policy):**
no CI step verifies that the committed generated types match the running
backend's OpenAPI document; a cheap offline check (boot the hermetic test app,
diff a regenerated artifact) is the recommended follow-up, to be decided by the
Owner/tooling owner rather than bolted on here.

## 4. Evidence-based test-gap matrix (what existed vs what existed-not)

`CI-executed?` = is the gap-proof wired into the existing GitHub Actions
pipeline (backend job: unit tests hermetically; e2e incl. live-DB suites via
`VARDENA_TEST_DATABASE_URL`). "Added" rows are this work.

| # | Production path (file) | Existing proof before | Hermetic vs live-PG needed | CI-executed? | Uncovered failure mode | Decision needed? |
|---|---|---|---|---|---|---|
| G-1 | `items.service.ts` freeze guards (`existsForItem`, `hasBlockingBalanceForItem`) wired from modules | **None**: every seam stub was hardcoded `false` ("guards never fire") | hermetic seam-flip + live real-postings (added `items.service.spec.ts` freeze block; live case 8) | now yes | Guards silently dropped (a refactor could delete the seam calls and nothing would fail) | No — ADR-0022 Approved |
| G-2 | `units.service.ts` (all of it) | **None** (no spec file) | hermetic (added `units.service.spec.ts` 12 cases) | now yes | Any units regression (shape, uniqueness, normalization, lifecycle) invisible | No |
| G-3 | `item-groups.service.ts` hierarchy (self-parent, cycle, cross-org parent, disabled-parent new-usage) | **None** at service level (departments analog existed in `organization` module; group HTTP cases existed but not the tree rules) | hermetic (added `item-groups.service.spec.ts` 14 cases) | now yes | Introducing a cross-org parent silently allowing ancestor cycles or disabled anchors | No |
| G-4 | `resolveEnteredToBase` (`inventory-posting-support.ts`) | **None directly** (only hash/clock helpers) | hermetic (added 8 cases) | now yes | Number-math regressions in the conversion boundary every posting crosses | No (interim rule documented; OQ-29 in §6) |
| G-5 | Conversion window boundary (`validFrom` inclusive, `validTo` exclusive) | domain `resolveVersionAt` covered; service+HTTP not | hermetic service (added 1 case) + HTTP keeps it | now yes | Off-by-one instant flipping a factor at the boundary (a posting dated exactly at a change) | No |
| G-6 | `resolveConversion` org isolation (item path) | **None** — and the code leaked | hermetic service + authorization + HTTP + live (4 layers added, Fix 2) | now yes | Foreign factor disclosure (Fix 2) | No |
| G-7 | Conversion create + supersession over HTTP with state intact | single-stylized supersession journey only | hermetic HTTP (added overlap 422 case + historical resolve intact) | now yes | Regression of the pair-invariant at transport level | No |
| G-8 | Item/unit code uniqueness over HTTP (409 + same-code-other-org) | warehouses only | hermetic HTTP (added: item, unit) | now yes | Accidental removal of pre-check or scope in the conflict path | No |
| G-9 | Cross-org item get/update/enable/disable over HTTP (404 + untouched row) | warehouses only | hermetic HTTP (added) | now yes | Item IDOR at transport level | No |
| G-10 | Item code uniqueness under concurrent writes | warehouses only (live) | **live-PG** (added live case 1) | now yes (CI backend job) | DB-index authority drifting from service pre-check | No |
| G-11 | Conversion same-instant race | **none** | **live-PG** (added live case 3) | now yes (CI) | Double-open-ended wedge under concurrency | No (Fix 1) |
| G-12 | Conversion supersession race (distinct instants) | **none** | **live-PG** (added live case 4: chain consistency + exactly-one-open-ended) | now yes (CI) | Fix-1 regression fundamentally unprovable hermetically (fake is single-threaded) | No |
| G-13 | Backdated posting factor snapshot (D-21) on real rows | hermetic characterization only | **live-PG** (added live case 5) | now yes (CI) | History reinterpretation | No (subject to OQ-29 confirmation §6) |
| G-14 | No-conversion posting rejected (no 1:1, no reverse-pair division, nothing recorded) | hermetic (added G-4) | hermetic (G-4) + **live-PG** (live case 6) | now yes | Silent invented conversions | No |
| G-15 | >4dp product rejection (fail-closed, OQ-29 interim) | domain `fitsQuantity` unit | hermetic G-4 + **live-PG** (live case 7) | now yes | Accidental silent rounding before Owner decision | **Yes — OQ-29** (behavior kept unchanged) |
| G-16 | Item→foreign unit/group anchor rejection (org isolation of refs) | hermetic service + base-unit HTTP | live-PG (live case 2) | now yes (CI) | Cross-tenant data anchoring | No |
| G-17 | OpenAPI ↔ frontend types drift (item master) | none (no drift check) | offline regeneration probe (this work) | **no — logged observation** (§3 Fix 3) | Future silent contract drift | **Tooling decision (recommend, not implemented)** |

Explicitly **not** duplicated (risk assessed, not meaningful new coverage):
department-style cross-org parent 404-vs-422 (mirrors inventory `hierarchy.ts`
by documented design; hermetic proof added in G-3), warehouse freeze guards
(covered by C-46 `warehouse-master-live.e2e-spec.ts`), and the runtime
float-drift properties of `quantities.ts` (44 existing domain cases).

## 5. What was added/modified (test inventory)

### New test files

- `backend/src/modules/inventory/application/units.service.spec.ts` — **12 cases**.
- `backend/src/modules/inventory/application/item-groups.service.spec.ts` — **14 cases**.
- `backend/test/item-master-live.e2e-spec.ts` — **9 cases**, opt-in
  `VARDENA_TEST_DATABASE_URL` with `describe.skipIf`, wired into the existing CI
  backend job through the e2e config's `test/**/*.e2e-spec.ts` include + the
  postgres service (zero workflow changes — the established live-suite gate).

### Extended test files

- `backend/src/modules/inventory/application/items.service.spec.ts` — +**9 cases**
  (new `ItemsService freeze guards (guards firing)` describe).
- `backend/src/modules/inventory/application/unit-conversions.service.spec.ts` — +**3 cases**
  (boundary instant; Fix-2 foreign-item resolve 404; disabled-item resolvable history).
- `backend/src/modules/inventory/application/inventory-posting-support.spec.ts` — +**8 cases**
  (new `resolveEnteredToBase` describe).
- `backend/src/modules/organization/application/master-data-authorization.spec.ts` — +**5 cases**
  (new `Inventory item-master authorization & cross-organization IDOR` describe).
- `backend/test/master-data.e2e-spec.ts` — +**7 cases** (§4 G-7/G-8/G-9/G-6).
- `backend/test/support/master-data-repositories.ts` — fake mirrors the new
  conversion-repository contract (behavior mirror, not a weakening).

### Production files changed

- `backend/src/modules/inventory/data/unit-conversions.repository.ts` — Fix 1.
- `backend/src/modules/inventory/application/unit-conversions.service.ts` — Fixes 1+2.
- `backend/src/modules/inventory/api/dto/item.dto.ts` — Fix 3 (metadata).
- `frontend/src/api/generated/vardena-api.d.ts` — Fix 3 (regenerated, true pipeline).
- `docs/modules.md` — AR-11 documentation for the conversion advisory lock.

## 6. OQ-29 decision brief (owner sign-off needed — unchanged answers)

**Question (verbatim):** "Units and conversions: precision per unit, rounding
rules for fractional conversions, whether conversion factors may change over
time (and with what effect on history), and which conversions are global vs
item-specific."

**What is implementation-fixed without approval (and must be explicitly confirmed
or changed):**

1. Quantities integer-stored as `numeric(18,4)`; factors `numeric(18,6)`.
2. **No per-unit precision anywhere** (no `precision` column/seed; item/base-unit
   model has no such concept). A single global storage scale.
3. **Fractional conversions that do not fit exactly are REJECTED** at posting
   time (fail-closed interim behavior, never rounded) — e.g. `1 × 0.166667`
   (6dp) is refused, not truncated to `0.1667`.
4. Factors **change only by new effective-dated versions**; old version closed
   at the new `validFrom`; backdated business dates resolve the OLD factor
   (proven on live rows, case G-13).
5. Item-specific pairs silently WIN over global pairs for the same unit
   pair (precedence by implementation).
6. Reverse pairs are never derived/divided (division needs a rounding rule the
   OQ has not approved); same-unit postings need no conversion (factor 1).

**Options and consequences** (per-option scope that the Owner expert can sign):

| Option | Concrete example | Code/schema/API impact | Migration | Reporting consequences | Tests required | Downstream blocked by staying undecided |
|---|---|---|---|---|---|---|
| **A — Keep fixed `numeric(18,4)`; exact-fit or reject** (approve current interim rule) | `3 BOX × 12 = 36.0000` posts; `1 CRATE × 0.166667` refused with 422; users adjust the factor or the quantity | None — code/docs remain as-shipped today. API error messages stay stable | None | Stock reports arithmetic stays exact; some pack sizes need item-specific factors to stay representable | Already in place (G-4/G-15 live + hermetic) | C-48/C-49 opening flows, C-51/C-52 receipt/issue must inherit the rule |
| **B — Per-unit precision (`units.precision`) + approved rounding boundary** | `kg` at 3dp, `pcs` at 0dp; `2.4 kg` rejected as not integer on the stock line | New unit column + model/service/DTO/OpenAPI + posting-validation change + report formatters | Migrate all existing units/org seeds to a default precision (which one is itself a decision) | Reports must render per-unit precision; opening documents inherit per-line validation | Full quantity-line matrix re-cover | C-24 documents cannot derive line math without this |
| **C — Defined round at posting boundary (mode TBD: truncate vs half-up vs banker's)** | `1 × 0.166667 → 0.1667` recorded | Posting resolution + tests; docs describe rounding as a decided contract | Decide treatment of pre-existing (already exact) rows (no-op) | Moving-averages and valuation sum divergences must be specified | Round-trip balance conservation tests (Σ lines == Σ balance) | Valuation (OQ-11/OQ-24) inherits the rounding rule |
| **D — Reject non-fit and require an explicit alternate unit on the document line** | user re-enters `1 CRATE` as `0.1667 PCS` (?— not even possible without per-unit precision; realistic variant: the operator is told to adjust conversion/quantity) | UX/reporting phrasebook; code as today + error contract text | None | Better auditability (no silent rounding ever) | Same as A | Sales/Purchasing UX must design the alternate-unit flow first |

(These expand the preflight's A–D without changing its prose; the report does
**not** select an option. The current implementation equals Option A as
interim behavior; continuing without sign-off leaves the quantity contract
formally undocumented but functionally pinned by tests.)

## 7. OQ-33 decision brief (owner sign-off needed — unchanged answers)

**Question (verbatim):** whether the kind list (`goods`, `service`,
`consumable`, `asset`, `raw_material`, `semi_finished`, `finished_good`,
`other`) is complete, and which capabilities (`is_stockable`, `is_purchasable`,
`is_sellable`, `is_valued`, `requires_lot`, `requires_serial`,
`requires_expiry`) may be on/off per item vs per kind.

**Implementation-fixed today (must be confirmed or changed):**

1. Eight-value closed `ITEM_KINDS`; adding a kind is a code change (plus
   migration only if the DB ever stores an enum — it stores text today).
2. Kind supplies defaults once at creation; kind is immutable afterward.
3. All seven flags are per-item overridable at creation AND editable later
   (with store-time invariants: valued ⇒ stockable; lot/serial/expiry ⇒
   stockable).
4. Item group is one-to-zero/one classification per item (no many-to-many).
5. Barcode is one free nullable string (≤64), searchable, **no uniqueness,
   no symbology validation** (explicitly unsettled, presumably separate policy).
6. Lifecycle is `is_active` only (no delete/reuse — OQ-36 owns this).

**Options:**

| Option | Concrete example | Code/schema/API impact | Migration | Reporting consequences | Tests required | Downstream blocked candidates |
|---|---|---|---|---|---|---|
| **A — Confirm current model** (an inventory expert reviews the eight kinds + defaults as the approved taxonomy) | `consumable` not valued, `asset` serial-capable | None | None | Today's reports/filters keep their meaning | Already in place (expanded this work) | None structural; remaining C-47 candidate steps own barcode + opening flows |
| **B — Confirm kinds, constrain overrides per kind** | `service` cannot become stockable at all (currently allowed as flags) | New kind→allowed-flags matrix + create/update validation + DTO docs | None (existing rows may violate the new matrix — needs a backfill/lease decision!) | Exception reports possible | Matrix-boundary tests per kind | Item import (C-XX) would need the matrix too |
| **C — Shrink taxonomy to operational distinctions** | merge raw/semi-finished/finished into `goods` + flag | Enum values shrink; mapping rule to migrate existing rows REQUIRED | **Real migration** (rows carrying semi/finished kinds) | Drill-down/reporting loss by design | Data-migration rehearsal + regression | Production flows (raw→semi) cannot distinguish stages |
| **D — Extend kinds/flags** (only on a named demand) | add `packaging` kind or `is_batch_managed` flag | Code + DTO/OpenAPI + defaults + capability invariants + permissions stays unchanged (kinds are not permission-scoped) | Optional backfill | New kind appears in filters | Full matrix re-cover | Blocks any Sales/Purchasing/production taxonomy alignment until decided |

(No option selected. The preflight noted recorded assumptions in `item-kind.ts` —
e.g. the asset/serial tension — those are source comments, **not** approval.)

## 8. Verification matrix

| Check | Classification | Executed where? | Result |
|---|---|---|---|
| `backend` unit tests (`npm test`, 122 files) incl. all new/changed specs | FAST-LOCAL | local | **1443 passed** |
| `backend` master-data e2e (`test/master-data.e2e-spec.ts`) | FAST-LOCAL (hermetic HTTP) | local | **47 passed** |
| `backend` typecheck (`tsc --noEmit`) | gate | local | clean |
| `backend` lint (`oxlint`) | gate | local | 0 errors (1 pre-existing warning in `coding-structure-accounts.spec.ts`, unrelated) |
| `backend` prettier check | gate | local | clean |
| `backend` full e2e (43 files incl. 18 live-suite skips without `VARDENA_TEST_DATABASE_URL`) | FAST-LOCAL subset | local | **328 passed, 132 deterministically skipped, 0 failed** (heavier live-DB assertions intentionally **not** executed locally; see below) |
| `frontend` tests / typecheck / lint / prettier / build | FAST-LOCAL | local | **305 passed**; all gates clean; build succeeded |
| OpenAPI regeneration probe | offline hermetic | local | diff proven surgically exact (3 blocks only) |
| `item-master-live.e2e-spec.ts` (9 live-PG cases) | CI-HEAVY/LIVE-DB | **GitHub Actions backend job** (postgres:16 service, `VARDENA_TEST_DATABASE_URL`); local execution intentionally not used — CI is the authoritative execution environment | **CI PASSED** — PR #107: run `36991377976` executed the suite and caught a real `$queryRaw`-on-`void` defect in the lock call (fixed by `$executeRaw`, commit `e5fe53b`), run `36992098706` backend+frontend **green** (9/9 live cases executed — the suite's own failure annotations on the previous run prove execution) |

**No heavy E2E/live-DB test was executed locally unless explicitly authorized.**

## 9. What remains open (owner/RACI) and risks

**Owner decisions required (unchanged blockers, NOT resolved here):**

- **OQ-29** — quantity/precision/rounding/factor-change-semantics (§6): the
  decision-freeze candidates A–D each change nothing-or-everything about
  downsteam line math. A/B/C/D recorded with concrete examples, impact,
  migration, reporting and test expectations.
- **OQ-33** — item taxonomy + per-item vs per-kind capabilities (§7): A–D.
- **OQ-36/marked barcode policy** — separate chain; the C-47 row inherits
  "blocked by OQ" until these land bar none.
- **Tooling observation** (§3): no CI drift-check for generated frontend types;
  recommended, not implemented.

**Risks accepted consciously:**

1. The `numeric(18,4)` rejection remains interim. Live case 7 now pins the
   failure mode so any future silent rounding is caught by CI before merge.
2. Advisory-lock key strings are deterministic; if the code ever runs several
   PostgreSQL backends (it is single-tenant monolith by design), the locks do
   not coordinate across databases. Out of scope for v1 architecture.
3. CI live-DB suite exercised Fix 1 under genuine races and PASSED (run
   `36992098706`); it immediately caught one real defect class hermetic tests
   could not see (`$queryRaw` cannot deserialize PostgreSQL `void` from
   `pg_advisory_xact_lock`), now fixed via `$executeRaw`. If a future run
   surfaces a less-than-8-count of fulfilled creates in live case 4's race,
   that is the designed behavior (fail-closed rejections) — the test asserts
   the invariant, not a winner count.

## 10. Next dependency-ready candidate

With this slice landed and CI green, the next unblocked candidate is a
**barcode policy decision + bounded barcode hardening** (decision under OQ-33
per the work order), or — pending OQ-24/OQ-39 clarity — the warehouse-receipt
quantity slice (C-51) whose quantity-side foundation (movement posting +
conversion resolution) is now CI-proven end-to-end. C-47's own "Product/item
master completion" stays **BLOCKED BY OQ** (OQ-29/OQ-33) even though the code
surface is now hardened and regression-covered.
