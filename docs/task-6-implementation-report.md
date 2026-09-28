# Task 6 — Organization & Master Data Foundation: Implementation Report

Date: 2026-09-11 · Branch: `arena/01a08f1a-vardena` · Base: `d22419a`

---

## 1. Implemented

### Entities (11 tables, 2 new PostgreSQL schemas)

| Schema | Table | Notes |
|---|---|---|
| `organization` | `organizations` | deployment-wide unique `code`; the scope root |
| `organization` | `branches` | scope dimension, not a legal entity (OQ-22) |
| `organization` | `departments` | nullable self-FK hierarchy |
| `organization` | `employees` | minimal reference data: code, first/last name, optional department + branch (OQ-32/OQ-37) |
| `organization` | `parties` | one counterparty table with `is_customer` / `is_supplier` capabilities — no separate Customer/Supplier tables |
| `inventory` | `units` | code, name, optional symbol |
| `inventory` | `unit_conversions` | global unit-pair versions |
| `inventory` | `item_unit_conversions` | item-specific versions |
| `inventory` | `item_groups` | nullable self-FK classification hierarchy |
| `inventory` | `items` | one table, `item_kind` + 7 capability booleans |
| `inventory` | `warehouses` | belongs to a branch |

### Modules

- **`organization`** — domain (7 files) / data (6) / application (7) / api (10).
- **`inventory`** — domain (12) / data (6) / application (7) / api (10). Master data
  only: no movements, balances, reservations or valuation.

### API (all under `/api/v1`, OpenAPI-documented)

`/organizations`, `/branches`, `/departments`, `/employees`, `/parties`,
`/inventory/{items,item-groups,units,unit-conversions,warehouses}` — each with
`GET` (list), `GET /:id`, `POST`, `PATCH /:id`, `POST /:id/enable`,
`POST /:id/disable`, plus `GET /inventory/unit-conversions/resolve`.

- Every list requires an explicit `organizationId`; `page`, `pageSize` (≤500),
  `sort` (whitelisted field + direction), and per-entity filters.
- **No DELETE route exists on any resource** (see §2.2).
- Unit conversions have **no PATCH and no enable/disable** (see §2.4).

### Authorization

47 permission codes registered at startup through the existing `PermissionRegistry`
and mirrored to `rbac.permissions` by the existing `PermissionSyncService`:

- `Organization.{Organization,Branch,Department,Employee,Party}.{View,Create,Edit,Enable,Disable}` — 25
- `Inventory.{Item,ItemGroup,Unit,Warehouse}.{View,Create,Edit,Enable,Disable}` — 20
- `Inventory.UnitConversion.{View,Create}` — 2

Every application service calls `authorization.requireAllPermissions([...])` as its
**first** statement. Guards are belt-and-braces, not the enforcement point.

### Domain events

`{Organization,Branch,Department,Employee,Party,Item,ItemGroup,Unit,Warehouse}` ×
`{Created,Updated,Enabled,Disabled}` + `UnitConversion.Created` — 37 event types,
published on the existing `DomainEventBus` with `correlationId` and `occurredAt`.

---

## 2. Architectural Decisions

**2.1 — `organization_id` on every master-data table.** Recorded as **ADR-0021
(Proposed)**. It contradicts the *assumptions* of open questions OQ-01/OQ-22, so it
was documented rather than taken silently. It is a structural decision, not
tenancy: there is no principal→organization binding, so no request is *restricted*
to one organization.

**2.2 — Lifecycle is `is_active` only.** No `deleted_at`, no DELETE endpoints, no
`*.Delete` permission, and therefore plain (non-partial) unique indexes.
`master-data-strategy.md` §7 forbids running two competing lifecycle mechanisms and
deletion semantics are unresolved (new **OQ-36**).

**2.3 — No SQL `CHECK` constraints anywhere.** Prisma cannot represent them, so they
would drift from the schema. Every value rule lives in the framework-free domain
layer and is unit-tested. Stated in both migration headers.

**2.4 — Unit conversions are versioned, never edited.** A change is a new
effective-dated version; creating an open-ended version closes the previous
open-ended one **in the same transaction**. Overlaps that cannot be resolved by
supersession are rejected rather than silently split. `resolveConversion(…, asOf)`
returns `null` when no version covers the instant — it never assumes 1:1.

**2.5 — `item_kind` is immutable after creation.** Kind supplies *defaults at
creation*; re-applying them over flags a user set deliberately is a rule nobody
approved. Wrong kind ⇒ disable and recreate. Recorded in the service header and in
§6.

**2.6 — Cross-organization references answer 404, not 422.** A branch in another
organization is reported as not found, so one tenant cannot probe another's rows
into existence. A foreign key cannot express "same organization", so the check is
in the service.

**2.7 — Inactive-parent rule.** An inactive record cannot become the
owner/parent/base/unit of a *new* record (§7.4). On update the reference is
re-validated **only when it changes**, so a record whose parent was disabled
afterwards stays editable.

**2.8 — Master-data helpers are duplicated per module** (`master-data.ts`,
`master-data-support.ts`, `master-data-rows.ts` exist in both `organization/` and
`inventory/`). Deliberate, per AR-06/07/08: `kernel/` stays technical and modules do
not import each other's internals. The cost is real duplication — see §6.

**2.9 — `factor` is `numeric(18,6)` carried as a string end to end.** Conversion
factors are not quantities (which are `numeric(18,4)`), and a JSON number would lose
precision. The API never accepts or returns a numeric factor.

**2.10 — DTO layout deviates from the Users module's convention.** One
`<entity>.dto.ts` per entity instead of `create-/update-/list-` triplets, because ten
entities × 3 files would fragment each contract across three files. Noted, not
hidden.

**2.11 — Path parameter `id` is not ULID-validated.** Matches the existing house
convention in `rbac/api/roles.controller.ts`; a malformed id resolves to 404.
Request *bodies* and *queries* are ULID-validated via the new
`kernel/http/is-ulid.decoratorator` → `is-ulid.decorator.ts`.

---

## 3. Open Questions

**New (added to `docs/open-questions.md`):**

- **OQ-36** — master-data deletion: is `is_active` sufficient forever, are codes
  case-sensitive, may a code be reused?
- **OQ-37** — Employee↔User linkage: must an employee row be bound to a user account?
- **OQ-38** — Party detail: addresses/contacts/bank accounts and Iranian legal
  identifiers.

**Amended (assumption text updated in place, not re-decided):**

- **OQ-01** — now states that the master-data tables *do* carry `organization_id`
  (ADR-0021) while there is still no principal→organization binding.
- **OQ-22** — same note; the tables being organization-scoped keeps the question open
  rather than answering it.

**Still open and deliberately not answered by this task:** OQ-12 (business codes /
numbering), OQ-24 (valuation), OQ-28–OQ-31, OQ-33–OQ-35. `## Resolved` remains empty.

---

## 4. Files Changed

**Backend — new (`backend/src/modules/organization/`, 33 source files + 3 specs)**
`domain/` (9): organization.ts, branch.ts, department.ts, employee.ts, party.ts,
organization-permissions.ts, organization.events.ts, master-data.ts, hierarchy.ts;
`data/` (6): master-data-rows.ts + organizations/branches/departments/employees/parties
`.repository.ts`;
`application/` (7): master-data-support.ts + organizations/branches/departments/
employees/parties `.service.ts` + organization-permission-registration.ts;
`api/` (10): 5 controllers + `dto/` 5 files; `organization.module.ts` (1).
Specs: `domain/hierarchy.spec.ts`, `application/master-data-authorization.spec.ts`,
`application/hierarchy.service.spec.ts`.

**Backend — new (`backend/src/modules/inventory/`, 35 source files + 4 specs)**
`domain/` (11): item.ts, item-kind.ts, item-capabilities.ts, item-group.ts, unit.ts,
unit-conversion.ts, warehouse.ts, inventory-permissions.ts, inventory.events.ts,
master-data.ts, hierarchy.ts;
`data/` (6): master-data-rows.ts + units/item-groups/items/unit-conversions/warehouses
`.repository.ts`;
`application/` (7): master-data-support.ts + units/item-groups/items/unit-conversions/
warehouses `.service.ts` + inventory-permission-registration.ts;
`api/` (10): 5 controllers + `dto/` 5 files; `inventory.module.ts` (1).
Specs: `domain/item-capabilities.spec.ts`, `domain/unit-conversion.spec.ts`,
`application/items.service.spec.ts`, `application/unit-conversions.service.spec.ts`.

**Backend — new (kernel, 3 files)**
`kernel/http/is-ulid.decorator.ts` (kernel copy, so new modules do not import another
module's `api/` folder — AR-07), `kernel/http/parse-query-boolean.ts` (the global pipe
runs with implicit conversion **off**, so query booleans need an explicit transform),
`kernel/prisma/prisma-errors.ts` (shared `P2002`/`P2003`/`P2025` mapping).

**Backend — new (root, 1 file)** `src/modules/master-data-permissions.spec.ts`
(vocabulary-wide assertions over both modules).

**Backend — modified (3 files)**
`app.module.ts` (+2 module registrations), `generated/prisma/client.ts` (+11
delegates), `test/support/master-data-repositories.ts` (new, 10 in-memory fakes).

**Prisma (2 new + 1 modified)** `schema/organization.prisma`,
`schema/inventory.prisma`, `schema/base.prisma` (`schemas` array += `organization`,
`inventory`).

**Migrations (2 new, applied migrations untouched)**
`20260911000000_organization_master_data`, `20260911010000_inventory_master_data`.

**Tests (2 new files + 6 spec files)**
`test/master-data.e2e-spec.ts` (37 tests), `test/support/master-data-repositories.ts`,
plus the six `*.spec.ts` listed above.

**Documentation (4 modified, 1 new)**
`docs/modules.md` (Organization + Inventory sections rewritten from "planned" to
implemented, Event Catalog extended), `docs/open-questions.md` (OQ-36/37/38 added,
OQ-01/22 annotated), `docs/database-strategy.md` §4, `docs/adr/README.md` (index row),
**new** `docs/adr/0021-organization-scoped-master-data.md`.

---

## 5. Validation — actual results

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` (oxlint) | **0 warnings, 0 errors** on 206 files (baseline was 0/0 on 125) |
| Typecheck | `npx tsc --noEmit` | **clean**, no output |
| Unit | `npm run test` | **34 files, 323 tests passed** (baseline 26 files / 134 tests) |
| E2E | `npm run test:e2e` | **8 files passed, 81 tests passed, 4 skipped** (baseline 44 passed / 4 skipped; the 4 skips are the pre-existing `db.e2e-spec.ts` cases that need a live Postgres) |
| Build | `npm run build` (`nest build`) | **exit 0** |
| OpenAPI | app booted, `GET /api/docs-json` | **200**; all 40 expected paths present; `unit-conversions` exposes only `get`/`post` (no `patch`) |

### Migration validation — and its honest limits

`npm run prisma:validate`, `prisma:format` and `prisma migrate dev` **could not be run
in this sandbox.** They fail on network access to `binaries.prisma.sh`
(`Client network socket disconnected before secure TLS connection was established`);
`@prisma/engines/` ships no engine binaries here. There is no local `psql`,
`postgres`, `pg_ctl`, `initdb` or `docker` either.

What was run instead: all five migration files, in order, against an in-memory
**PGlite** database (PostgreSQL 17.5 compiled to WASM, already present as a
transitive dependency):

```
ALL MIGRATIONS APPLIED CLEANLY
```

with post-migration assertions: **11 new tables**, **45 indexes**, **22 foreign
keys — all `ON DELETE RESTRICT`**, and column types spot-checked
(`items.item_kind varchar`, `unit_conversions.factor numeric(18,6)`,
timestamps `timestamptz`, ids `TEXT`).

**This is not `prisma migrate deploy` and must not be reported as Prisma-verified.**
Two things it does not prove: (a) that `prisma migrate diff` finds zero drift between
the Prisma schema and the hand-written DDL, and (b) that the real Prisma engine
accepts the schema. Both need a networked environment. This is listed as a follow-up
in §6.

---

## 6. Risks & Follow-ups

1. **Prisma schema↔DDL drift is unverified.** Highest-priority follow-up: run
   `npx prisma migrate diff --from-migrations … --to-schema-datamodel …` and
   `prisma validate` in a networked CI job. Mitigation applied: every constraint name
   (`pk_`/`fk_`/`uq_`/`idx_`) was written to match the existing migrations' pattern,
   and the PGlite run proves the DDL itself is valid.
2. **`organization_id` is not enforced against the caller.** Any principal holding the
   right permission may pass any `organizationId`. Acceptable for a
   single-organization deployment; **must** be closed by binding principals to
   organizations before any multi-tenant use (OQ-01/OQ-22, ADR-0021).
3. **`items.item_kind` immutability is a decision, not a documented rule.** If the
   product wants kind changes, the re-defaulting semantics need approval first.
4. **`items.base_unit_id` is editable in Task 6** because nothing references it yet.
   The future Inventory module **must** forbid changing it once movements exist, or
   historical quantities become meaningless.
5. **Duplicated master-data helpers** across the two modules. Deliberate (AR-06/07/08)
   but a real maintenance cost: a change to code-normalization rules must be made
   twice. Revisit if a third module needs the same helpers.
6. **Conversion overlap detection is application-level.** A `btree_gist` `EXCLUDE`
   constraint would enforce it in the database but adds an extension dependency;
   rejected. Concurrent creates could in principle race — the unique
   `(owner, from, to, valid_from)` index catches exact collisions only.
7. **Case-sensitive business codes.** `ABC` and `abc` are different codes. Flagged in
   OQ-36; a case-insensitive unique index is a migration away if the product decides
   otherwise.
8. **`docs/database-strategy.md` §4 previously claimed `text(26)`.** Every applied
   migration (including the three that predate this task) uses plain `TEXT`. The doc
   was corrected; no schema change was needed.

---

## 7. §68 Final Review Checklist

| # | Question | Answer |
|---|---|---|
| 1 | Did you inspect the repository before changing code? | Yes — all of `.vardena/`, `docs/**`, every existing module, kernel, tests, migrations and configs before the first edit. |
| 2 | Did you follow AR-02 module anatomy? | Yes — `domain/`, `data/`, `application/`, `api/` in both new modules. |
| 3 | Are controllers transport-only (AR-03)? | Yes — no business logic, no Prisma, only DTO↔service mapping. |
| 4 | Are use cases in application services (AR-04)? | Yes — all 10 services. |
| 5 | Is the domain framework-free (AR-05)? | Yes — no Nest imports in any `domain/` file; verified by the domain specs running without a Nest context. |
| 6 | Is `kernel/` still technical-only (AR-06)? | Yes — the three new kernel files are a ULID validator, a boolean parser and a Prisma error mapper. |
| 7 | Do modules cross only via public services (AR-07)? | Yes — Inventory resolves branches through `BranchesService`, never by reading `organization.branches`. |
| 8 | One schema per module (AR-09)? | Yes — `organization` and `inventory`. |
| 9 | Migration-only schema changes (AR-10)? | Yes — 2 new migrations; no applied migration edited. |
| 10 | Standard entity columns (AR-12)? | Yes — `created_at`, `updated_at`, `created_by`, `updated_by` on all 11 tables. |
| 11 | Soft delete (AR-13)? | **Deliberately not used** — `is_active` lifecycle instead, per §7.4; documented as OQ-36. AR-13 concerns documents. |
| 12 | Outbox (AR-14)? | Not applicable — no external delivery in Task 6; events use the in-process bus. |
| 13 | Authorization in the service, not just guards (AR-21/22)? | Yes — first statement of every use case; proven by `master-data-authorization.spec.ts` (403 with no write) and e2e. |
| 14 | Audit (AR-23)? | Actor ids persisted; 37 event types published with correlation ids. |
| 15 | Validation (AR-24)? | DTOs never expose Prisma models; no hash/actor leakage; whitelist + `forbidNonWhitelisted`. |
| 16 | OpenAPI (AR-26)? | Yes — `/api/docs-json` returns 200 with every new path and schema. |
| 17 | ADR only for genuinely new decisions (AR-29)? | Yes — exactly one, ADR-0021, for the `organization_id` decision that conflicts with open questions. |
| 18 | Are ULIDs used for PKs? | Yes, generated in the application layer (`generateId()`), never DB defaults. |
| 19 | UTC timestamps? | Yes — `timestamptz`, `DEFAULT CURRENT_TIMESTAMP`. |
| 20 | Quantities `numeric(18,4)`? | No quantity column exists yet. `unit_conversions.factor` is `numeric(18,6)` (a factor is not a quantity) — see §2.9. |
| 21 | JSONB only for governed custom fields? | No JSONB column was created. |
| 22 | No `*` / SuperAdmin / wildcard permissions? | None — asserted by a test over all 47 codes. |
| 23 | No separate Customer/Supplier/Product/Service/StockItem tables? | None — one `parties` table with capability booleans, one `items` table with `item_kind`. |
| 24 | Did you invent business rules? | No. Every judgement call is either traced to a doc (`master-data-strategy.md` §3.3/§7.4, D-25/D-26) or registered as an Open Question. The recorded *assumptions* (item-kind defaults for the four kinds §3.3 does not cover) are flagged in code as OQ-33 material. |

**Task 5 conflicts:** the task brief's ownership list put all ten entities in one
`organization` module. **Task 5's ownership table wins**: Unit/UnitConversion/
ItemGroup/Item/Warehouse live in `inventory`. The brief's `UnitConversion.Update`
permission does not exist — Task 5 forbids editing used configuration in place. The
brief's 2-segment permission examples (`Organization.View`) would fail
`isValidPermissionCode`, which requires exactly 3 PascalCase segments; all codes use
3 segments.

**Not done (out of scope, correctly):** accounting/CoA/journals, inventory ledger,
movements, balances, reservations, valuation, all documents, workflow/approval, tax,
pricing, BOM, variants, lot/serial *implementation*, costing, integrations, frontend,
custom fields, seed data.

---

## 8. Addendum — P1012 back-relation fix (2026-09-11)

The schema in §1 was never run through the real Prisma validator in the Task 6
sandbox, and it did not pass: `prisma generate`/`prisma validate` failed with
`P1012 — Error validating field 'organization' in model 'Unit'|'UnitConversion'|
'ItemUnitConversion'|'ItemGroup'|'Item'|'Warehouse': missing an opposite relation
field on the model 'Organization'` (6 errors).

Cause: the six inventory models declare the foreign-key side of their relation to
`organization.organizations`, but Prisma requires **both** sides of a relation to be
declared. `model Organization` in `prisma/schema/organization.prisma` only listed
`branches`, `departments`, `employees` and `parties`.

Fix: six back-relation arrays added to `model Organization` (`units`,
`unitConversions`, `itemUnitConversions`, `itemGroups`, `items`, `warehouses`).
They are the virtual side of the relation — the physical FK columns stay
`inventory.*.organization_id` with `ON DELETE RESTRICT`, so **no migration is
needed and no migration was edited** (AR-10).

Re-verified with Prisma 7.10.0 on the merged schema (all six `.prisma` files):

- `prisma validate` → `The schemas at prisma/schema are valid 🚀`
- `prisma generate` → `✔ Generated Prisma Client (7.10.0)` (17 models), and
  `tsc --noEmit` against the **real** generated client is clean.
- `prisma format` produces cosmetic alignment only (no model/field change).

Still open from §6.1: `prisma migrate diff --from-migrations … --to-schema-datamodel …`
(the schema↔hand-written-DDL **drift** check) still needs a live PostgreSQL, which
this sandbox does not have.
