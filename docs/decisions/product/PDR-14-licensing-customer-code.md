# PDR-14: Stable customer code across the license lifecycle (OD-LIC-03 / L-06)

- **Type:** PDR (Product Decision Record) · decision id **OD-LIC-03**
- **Status:** **Decided — Final Owner Decision** (2026-10-14)
- **Decided by:** Product Owner (Ali Esmaeili)
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-83 remains OPEN** (device replacement quota/offline completion); **OQ-87 is decided** by PDR-13; this record resolves the **L-06** follow-up from the 2026-10-12 Q3 supersession (`docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §3 Q3 / §8.3.1) and the 2026-10-13 PO acceptance audit (`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md` §4.6)
- **Recording baseline:** branch `arena/3e77bbc7-vardena` (base `main` @ `d017636f5e339b26c0b5511009fb3aa450ddd288`)
- **Related records:** [PDR-11](./PDR-11-vardena-licensing-product-requirements.md) §3.1/§3.2, §4.4, §8.3, §12.1 · [PDR-12](./PDR-12-license-term-supersession.md) · [PDR-13](./PDR-13-post-gap-recovery.md) · [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) · [OQ-80/OQ-86 decision brief](../../tasks/licensing-oq-80-oq-86-decision-brief.md) §3 Q3–Q4, §8.3.1 · [`docs/licensing/version-model-and-file-exchange.md`](../../licensing/version-model-and-file-exchange.md) · [`docs/licensing-architecture.md`](../../licensing-architecture.md) · [`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md`](../../tasks/licensing-po-acceptance-audit-2026-10-13.md) §4.6 · [`docs/tasks/licensing-post-merge-reconciliation.md`](../../tasks/licensing-post-merge-reconciliation.md) §19

> This record transcribes a binding Product Owner decision for **L-06**
> (Stable Customer Code Across License Lifecycle). The data model, migration,
> signed artifact contract, issuance/CLI validation, import/transfer/audit
> conflict rules, and regression tests are implemented in the same change set.

## 1. Context and problem statement

Before L-06:

1. `licensing.customers` persisted only `id` (`customerId`) and `display_name`
   (`customerName`), with no independent business `customer_code` column.
2. Signed license artifacts (`VLIC2` and legacy `VLIC1`) carried `customerId`
   and `customerName`, but no `customerCode`.
3. `LicensesRepository.importVersion` executed `tx.licenseCustomer.upsert(...)`
   with `update: { displayName: command.customerName }`, allowing an ordinary
   license import to silently overwrite a persisted customer's `display_name`.
4. Development issuance helpers in `development-license-authority.ts` allowed
   `customerId` to default to a freshly generated ULID when omitted, rather
   than requiring an explicitly identified customer with both `customerId` and
   `customerCode`.

During the 2026-10-12 Q3 supersession review and the 2026-10-13 Product Owner
acceptance audit (`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md`
§4.6), the Product Owner approved **L-06** to establish a stable business
`customerCode` across customer persistence, signed license artifacts, issuance,
renewal, import conflict validation, and explicit customer transfers.

## 2. Decision (OD-LIC-03) — binding

The Product Owner establishes the following six binding rules across the
licensing lifecycle:

1. **Independent business `customerCode`:** Every licensing customer has a
   stable, independent business `customerCode`.
2. **Internal identity preserved:** `customerId` remains the internal database
   identity (`licensing.customers.id`) and is not replaced by `customerCode`.
3. **Display name is not an identity key:** `customerName`
   (`licensing.customers.display_name`) remains a mutable display name, not an
   identity key. Renaming a customer's display name must never change
   `customerId` or `customerCode`, and an ordinary license import must never
   silently overwrite an existing customer's stored `display_name`.
4. **Signed artifact contract and verification:** Every signed license artifact
   (`VLIC2` and `VLIC1`) must carry `customerCode` inside the signed payload
   (covered by the Ed25519 signature), and both issuance and import must
   validate `customerCode` against the intended customer.
5. **Explicit, authorized, auditable transfer only:** A customer or
   installation transfer must use the explicit, authorized, auditable transfer
   operation (`POST /api/v1/license/customer-transfer`,
   `Licensing.License.TransferCustomer`). Editing a name or changing a
   `customerCode` or `customerId` in an ordinary license artifact must never
   silently transfer ownership or rebind an installation.
6. **Renewals with same or new `licenseId`:** Renewals — whether keeping the
   existing `licenseId` or using a new `licenseId` (L-05) — must remain bound
   to the same intended customer (`customerId` and `customerCode`).

## 3. Exact specifications and invariants

### 3.1 Customer data model and database invariants (`licensing.customers`)

- `licensing.customers` stores:
  - `id VARCHAR(64) PRIMARY KEY` — internal immutable `customerId`.
  - `customer_code VARCHAR(64) NOT NULL` — stable business `customerCode`.
  - `display_name VARCHAR(200) NOT NULL` — display name (`customerName`).
  - Audit columns (`created_at`, `updated_at`, `created_by`, `updated_by`).
- Database-level constraints on `licensing.customers`:
  - `uq_customers_customer_code`: unique index on `(customer_code)` across the
    installation's `licensing` schema.
  - `customers_customer_code_check`: `CHECK (customer_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$' AND customer_code <> id)` — rejects empty, whitespace-only, leading/trailing-space, control-character, overlong, or `customer_code = id` values at the database boundary.
- Domain and repository operations:
  - `customerCode` and `customerId` must both match `^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$` and must be distinct (`customerCode !== customerId`).
  - Creating a customer requires an explicit `customerId`, `customerCode`, and
    non-blank `displayName`. Neither `customerId` nor `customerCode` may ever
    be fabricated from `displayName` or defaulted to one another.
  - Renaming a customer (`updateCustomerDisplayName`) updates only
    `display_name` (and audit metadata) and never mutates `id` or
    `customer_code`.

### 3.2 Migration and existing-row safety (`20261020000000_licensing_customer_code`)

- The migration adds `customer_code VARCHAR(64)` to `licensing.customers` if
  not already present, then runs a fail-closed preflight check before enforcing
  `NOT NULL`, `CHECK`, and `UNIQUE`:
  - If `licensing.customers` is empty (fresh installation or newly deployed test
    database), the constraints are applied immediately.
  - If `licensing.customers` contains existing rows, the migration verifies
    that every row already carries a non-null, valid `customer_code` distinct
    from `id` and unique across `licensing.customers` (supporting a staged,
    owner-supplied backfill prior to constraint enforcement).
  - If any existing row in `licensing.customers` has a `NULL`, blank, invalid,
    `customer_code = id`, or duplicate `customer_code`, the migration aborts the
    transaction with a descriptive error (`RAISE EXCEPTION`) rather than
    fabricating or guessing business codes from `id` or `display_name`.

### 3.3 Signed license artifact contract (`VLIC2` and `VLIC1`)

- Both `VLIC2` (`backend/src/modules/licensing/domain/license-document.ts`) and
  `VLIC1` (`backend/src/modules/licensing/domain/license-code.ts`) include
  `customerCode` in the signed wire payload immediately after `customerId` and
  before `customerName`:
  - Canonical key order around customer identity:
    `"customerId"`, `"customerCode"`, `"customerName"`.
- `customerCode` is part of the canonical UTF-8 JSON bytes signed by the
  authority's Ed25519 private key and verified against the installation's
  configured Ed25519 public keys.
- Any modification to `customerCode` after signing invalidates the Ed25519
  signature (`reason: 'signature'`, HTTP 422).
- Any signed payload missing `customerCode`, carrying an empty/whitespace or
  malformed `customerCode`, or setting `customerCode === customerId` is
  rejected by the payload parser (`reason: 'payload'`, HTTP 422) before any
  state evaluation or persistence.
- Unsigned or out-of-band request fields cannot supply or override
  `customerCode`: the import endpoints accept only `{ document }` (and, on
  dedicated endpoints, `{ document, reason }`).

### 3.4 Issuance and renewal rules

- Development issuance helpers (`buildLicenseVersionPayload`,
  `issueLicenseDocument`, `issueLicenseFile`, `buildLicensePayload`,
  `issueLicenseCode` in `backend/src/tools/development-license-authority.ts`)
  and the CLI (`backend/src/issue-development-license.ts`) require an explicit,
  valid `customerId` and `customerCode` (or an explicit persisted customer
  record whose `customerId` and `customerCode` are both present, valid, and
  consistent).
- Issuance fails closed when `customerId` or `customerCode` is missing, blank,
  malformed, equal to one another (`customerCode === customerId`), or
  mismatched against the target customer record. It never auto-generates a
  random `customerId` or `customerCode` and never derives `customerCode` from
  `customerName`.
- CLI usage requires `--customer <customerId>` and
  `--customer-code <customerCode>` (the CLI intentionally has no `--license-id`
  flag per F-8 Decision #4).

### 3.5 Import conflict authority, display-name preservation, and explicit transfer

In `evaluateImportConflicts` (`backend/src/modules/licensing/domain/license-version.ts`)
and `LicensesRepository.importVersion` (`backend/src/modules/licensing/data/licenses.repository.ts`):

1. **Customer identity & code consistency (`customer-code-mismatch`, HTTP 409):**
   - If the installation or customer table already records `customerId` with a
     different `customerCode`, or already records `customerCode` for a
     different `customerId`, the import is rejected with conflict reason
     `customer-code-mismatch` (HTTP 409, nothing written).
   - This check applies on **every** import path: ordinary import, renewal with
     the same `licenseId`, renewal with a new `licenseId` (L-05), post-gap
     recovery (`POST /api/v1/license/gap-recovery`), reduction resolution
     (`POST /api/v1/license/reduction-resolution`), and customer transfer
     (`POST /api/v1/license/customer-transfer`).
2. **Ordinary import customer binding (`installation-customer-mismatch`, HTTP 409):**
   - When an installation is already bound to customer `(id = A, code = CODE_A)`
     and an ordinary import (`customerTransfer === null`) presents a different
     `customerId` or a different `customerCode` (even if paired with a new
     `customerId`), it is rejected before any write:
     - Same `customerId` with different `customerCode`, or same `customerCode`
       with different `customerId` → `customer-code-mismatch` (HTTP 409).
     - Different `customerId` and different `customerCode` on an ordinary
       import → `installation-customer-mismatch` (HTTP 409, naming the explicit
       customer-transfer operation).
3. **Display-name non-overwrite on import:**
   - When `licensing.customers` does not yet contain `command.customerId` (first
     bind of that customer), the customer row is created with
     `(id = command.customerId, customer_code = command.customerCode, display_name = command.customerName)`.
   - When `licensing.customers` already contains `command.customerId` (whose
     `customer_code` matches `command.customerCode`), `importVersion` **never**
     overwrites `display_name` with `command.customerName`. A customer's stored
     display name is preserved across renewals and imports regardless of
     whether the customer was renamed in the database or the artifact carries a
     different display string.
4. **Explicit customer transfer (`POST /api/v1/license/customer-transfer`):**
   - Remains the sole path that may rebind an installation from
     `(previousCustomerId, previousCustomerCode)` to
     `(newCustomerId, newCustomerCode)`.
   - Requires `Licensing.License.TransferCustomer` and a non-blank `reason`.
   - Rejects a non-transferring document (`newCustomerId === previousCustomerId`)
     with `transfer-requires-different-customer` (HTTP 409).
   - Rejects reusing `previousCustomerCode` (or any other existing customer's
     `customerCode`) for `newCustomerId` with `customer-code-mismatch` (HTTP 409).
   - Records `previousCustomerId`, `previousCustomerCode`, `newCustomerId`,
     `newCustomerCode`, `previousLicenseId`, `newLicenseId`, `actorId`, and
     `reason` in the transfer result and in the `LICENSE_CUSTOMER_TRANSFERRED`
     audit event.

## 4. Implementation references

| Element | Reference |
|---|---|
| Prisma schema & migration | `backend/prisma/schema/licensing.prisma`, `backend/prisma/migrations/20261020000000_licensing_customer_code/migration.sql`, `backend/prisma/rehearsal/licensing-version-model/rehearse.mjs` |
| Customer domain rules | `backend/src/modules/licensing/domain/customer.ts` |
| Signed document (`VLIC2`) & legacy code (`VLIC1`) | `backend/src/modules/licensing/domain/license-document.ts`, `backend/src/modules/licensing/domain/license-code.ts` |
| Version conflict authority | `backend/src/modules/licensing/domain/license-version.ts` (`evaluateImportConflicts`, ` customer-code-mismatch`) |
| Persistence & non-overwrite | `backend/src/modules/licensing/data/licenses.repository.ts`, `backend/src/modules/licensing/data/installations.repository.ts` |
| Import / transfer / audit orchestration | `backend/src/modules/licensing/application/license-import.service.ts` |
| API state view & OpenAPI DTOs | `backend/src/modules/licensing/api/license-state.view.ts`, `backend/src/modules/licensing/api/dto/license.dto.ts`, `frontend/src/api/contracts.ts`, `frontend/src/api/generated/vardena-api.d.ts` |
| Development issuance & CLI | `backend/src/tools/development-license-authority.ts`, `backend/src/issue-development-license.ts` |
