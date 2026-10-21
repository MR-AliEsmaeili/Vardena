# Licensing completion audit — Owner ↔ Customer end-to-end (2026-10-21)

**What this document is.** A repository-state audit executed on a clean checkout
of `main` (`24608f03baa3da941ec18d06995fb5ef95267418`, branch
`arena/3c88d285-vardena`) before any change on this branch. It states what was
verified by running the code, what was read, and which gaps remain. It is not a
restatement of older reports: every claim below was re-checked against the
working tree.

**Method.** Each capability was followed from the UI (or its absence) through
the API client, the Owner/customer HTTP route, the service, the SQL and the
tests. A button or an endpoint alone was never accepted as evidence of a
completed capability.

**Execution environment.** Node.js 22.22.3, npm 10.9.8, no Docker and no system
PostgreSQL. A disposable PostgreSQL 18.4 was started from embedded binaries for
the suites that require a real database. All runs below were executed on this
machine, on the audited commit, before any change.

| Command                                                                        | Result                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `owner-licensing/backend → npm test` (9 files)                                 | **140 passed**                                                     |
| `owner-licensing/frontend → npm test` (18 files)                               | **246 passed**                                                     |
| `owner-licensing/backend → OWNER_TEST_DATABASE_URL=… npm run test:integration` | **80 passed** (`api.test.ts` 26, `licensing-lifecycle.test.ts` 54) |

## 1. Capability matrix (before this branch)

Legend: **Complete** = implemented, wired end to end and covered by an executed
test. **Partial** = part of the cycle exists. **Missing** = no implementation.
**Broken** = implemented but wrong. **Blocked** = a real, documented obstacle.

### 1.1 Owner application

| #   | Capability                                                                                               | Status                  | Evidence / what is actually missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Owner login, session, forced first password change, `Origin`/CORS enforcement                            | Complete                | `app.ts` origin gate + `security.ts`; `login-page`, `change-password-page`, `require-auth`; owner API suite                                                                                                                                                                                                                                                                                                                                                                                                |
| O2  | Owner RBAC (two roles, per-operator grants, default-deny)                                                | Complete                | `domain.ts` eligibility matrix, `security.ts` effective set, `user_permission_grants`, `unit.test.ts`, `api.test.ts`                                                                                                                                                                                                                                                                                                                                                                                       |
| O3  | Customer list / create / edit / detail with stable customer code                                         | Complete                | `customers-page`, `customer-page`, `customers` routes, `customer-schema.test.ts`, owner API suite                                                                                                                                                                                                                                                                                                                                                                                                          |
| O4  | Register / list / retire installation identity (OD-LIC-09)                                               | **Missing (UI)**        | Backend complete: `POST /installation-identities`, `GET /customers/:id/installation-identities`, `POST /installation-identities/:id/retire`, with tests in `licensing-lifecycle.test.ts` (re-entry confirmation, duplicate 409, foreign 404, retire 409). The traceability record already says “No UI”, and the Owner UI has no API client for any of these routes. **An operator therefore cannot obtain an `installationIdentityId` from the product, and issuance cannot be completed through the UI.** |
| O5  | Customer limit profiles (F-1, OD-LIC-13/14)                                                              | **Missing (UI)**        | Backend complete (create/list/retire/reactivate, partial unique index, immutable ceilings, `ActiveProfileExists` 409, tests). UI has only `recordLimitProfiles` returning `unknown[]`, **unused**. The operator cannot see the ceiling or the allowed modules before preparing, and cannot manage the lifecycle.                                                                                                                                                                                           |
| O6  | Prepare issuance from real data (customer, installation, key, kind, dates, limits, modules)              | **Partial**             | `PrepareForm` requires three hand-typed opaque identifiers (`customerId` ULID, `installationIdentityId` ULID, `signingKeyId`), with no search, no server-sourced choices, no profile awareness and no review step. The digest gate (OD-LIC-11) protects against signing a _substituted_ request; it cannot protect against an operator typing the wrong customer or installation at creation time.                                                                                                         |
| O7  | Prepare → download unsigned request → sign offline → import signed artifact → download archived artifact | Complete                | `licensing.ts`, `signer/`, artifact store; UI `PreparedPanel` + `ArtifactImporter`; `licensing.test.ts`, `signer.test.ts`, `licensing-lifecycle.test.ts`, `artifact-store.test.ts`                                                                                                                                                                                                                                                                                                                         |
| O8  | Renewal (`renewsOperationId`) and supersession (`supersedesOperationId`), OWNER_ADMIN-only               | **Partial**             | Backend supports both, refuses operators with a durable `LICENSE_REQUEST_DENIED` audit, and validates the target. **The UI hard-codes `supersedesOperationId: null, renewsOperationId: null`**, so a renewal cannot be prepared from the product. No positive end-to-end test exists either: the suite covers the refusals and an unknown target, never prepare → sign → import → lineage.                                                                                                                 |
| O9  | Owner revocation (`VREV1`): prepare request                                                              | Complete (prepare only) | `IssuanceCard` prepares a revocation request; `licensing-lifecycle.test.ts` asserts the recorded issuance is untouched.                                                                                                                                                                                                                                                                                                                                                                                    |
| O10 | Owner revocation: download unsigned request, import signed artifact, download signed artifact            | **Missing (UI)**        | `revocationRequest` and `importRevocationArtifact` exist in `src/api/licensing.ts` and are **never called**. So the signed revocation can never be registered through the product, and the artifact the customer must import can never be obtained from the product. Backend routes and tests exist (`GET/POST /license-revocations/:id/{request,import}`, `artifact`).                                                                                                                                    |
| O11 | Owner operational (manual) observations: activation, replacement, old-server state                       | Complete                | `operations-page`, `operation-forms`, `operation-page`, `operations-flow.test.tsx`, owner API suite                                                                                                                                                                                                                                                                                                                                                                                                        |
| O12 | Signing keys (OQ-74) tracking, compromise state, safety status                                           | Complete                | `signing-keys-page`, `signing-keys.ts`, tests at both layers                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| O13 | Audit explorer, retention holds, archive batches, verify, recover                                        | Complete                | `audit-page`, `audit.ts`, `archive.ts`, tests                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| O14 | Artifact archive backup/restore verification tooling                                                     | Complete                | `artifact-backup.ts`, `artifacts-backup-restore.md`, tests                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| O15 | Dashboard with real data (counts of customers/licenses/attention)                                        | **Partial**             | `OwnerHome` shows navigation entries and the honest “not implemented” list; it does not summarise the licensing state (customers, prepared requests, signed licenses, revocation candidates).                                                                                                                                                                                                                                                                                                              |
| O16 | Customer detail: related installations, limit profile, licenses, history                                 | **Missing**             | `customer-page.tsx` renders identity + contract dates + audit link only. Requirement “نمایش نصب‌ها و لایسنس‌های مرتبط” is unmet.                                                                                                                                                                                                                                                                                                                                                                           |

### 1.2 Customer (Vardena) application

| #   | Capability                                                                                | Status         | Evidence / what is actually missing                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Installation identity generation, storage and read                                        | Complete       | `installation-identity.service.ts`, `docs/licensing-architecture.md`                                                                                                                         |
| C2  | Signed license import (file / text / legacy) with full rejection order                    | Complete       | `license-import.service.ts`, `POST /license/import`, `license-import-form.tsx`, E2E + unit suites                                                                                            |
| C3  | License state read, status/limits/modules/scheduled version display                       | Complete       | `GET /license/current`, `license-status-card.tsx`, `license-gate.tsx`                                                                                                                        |
| C4  | Grace (14 × 24 h) and Read-Only enforcement (OQ-45/ADR-0049)                              | Complete       | `domain/license.ts`, `authorization.service.ts`, `license-grace.spec.ts`, live E2E                                                                                                           |
| C5  | Backend enforcement of entitlements and finite limits under concurrency                   | Complete       | `PermissionsService`, `OrganizationsService`, `UsersService`, advisory locks, live suite                                                                                                     |
| C6  | Signed revocation (`VREV1`) verification, persistence, replay, refusal ordering           | Complete (API) | `license-revocation.controller.ts`, `license-revocation.service.ts`, domain spec + live persistence suite                                                                                    |
| C7  | Customer UI surface for revocation import                                                 | **Missing**    | `POST /api/v1/license/revocations/import` has no client function, no form and no i18n text. The offline revocation can only be applied by calling the API by hand.                           |
| C8  | Customer visibility of license history / last valid operation / replacement request state | **Partial**    | The state read exposes the effective version and the scheduled one; there is no history surface, and OQ-82 replacement requests are designed but not part of the runtime. Not invented here. |

### 1.3 Documented, deliberate boundaries (not gaps)

These are established by recorded Product Owner decisions and are **not**
implemented by this branch, and no UI may claim them: continuous Owner↔customer
connectivity, remote shutdown, signed activation receipts (OQ-84 closed), the
installation identity _key_ (designed only), OQ-82 server-replacement protocol,
OQ-76 clock-integrity evidence, federated issuers.

## 2. Root-cause statements for the gaps taken up on this branch

1. **O4/O5/O16 — the Owner UI stops at the customer record.** The service and
   SQL layers for installation identities and limit profiles were delivered with
   the issuance slice, but the frontend was never given a client or a screen for
   them, so the product’s own prerequisite data can only be created with `curl`.
2. **O6 — identifier entry instead of selection.** The issuance form was written
   as a low-level harness for the protocol tests, not as an operator workflow:
   it accepts opaque ids. That is the wrong affordance for the person who
   actually issues licenses, and it is the direct cause of the “cannot complete
   the flow without a developer” limitation recorded in O4.
3. **O8/O10 — protocol halves without their operator half.** Renewal and
   revocation are complete on the backend and absent in the browser, so a
   recorded lineage or a signed revocation cannot be produced by the product.
4. **C7 — a delivered customer endpoint with no consumer.** Same pattern on the
   customer side: the revocation importer exists and is tested, and nothing in
   the application can reach it.

## 3. What this branch changes

See the final report section of
[`licensing-completion-2026-10-21-report.md`](licensing-completion-2026-10-21-report.md)
for the implemented items, the tests and the residual limitations. In short:
selection-driven issuance with a review step, installation-identity and
limit-profile management in the Owner UI, customer-detail licensing sections,
renewal/supersession from the UI (OWNER_ADMIN only), the full Owner revocation
round trip, positive end-to-end Owner API tests for renewal and revocation, and
a customer-side revocation import surface.

## 4. Non-negotiables preserved

No signed format, canonicalization rule, protocol vector, key-material path,
trust rule, public error contract, migration of an applied migration, or
customer runtime enforcement rule was changed. No private key, token or
credential is read, displayed, logged or committed. Owner and customer
databases remain separate, and the Owner application never connects to a
customer database.
