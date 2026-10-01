# Financial Workspace Context

Status: **Implementation companion** · Date: 2026-10-01 · Owner: **Accounting**

This document records the Financial Area / Fiscal Year / Accounting Period
bootstrap slice. It does not introduce a new domain concept, schema, permission,
API resource, or architecture. The authoritative model remains the
[Accounting Domain Contract](./domain-contract.md) and ADR-0026.

## 1. Purpose and boundary

The SPA resolves a usable Accounting workspace only after the existing bootstrap
facts have been established:

```text
Login → authenticated session → evaluated installation license
      → organization membership scope → financial area → fiscal year
      → open accounting period → workspace
```

The hierarchy is intentionally precise:

```text
Organization → Financial Area → Fiscal Year → Accounting Period
```

A Financial Area is Accounting-owned bookkeeping scope. It is **not** an
Organization, Branch, Department, or a parallel tenant model. Fiscal Years belong
to Financial Areas, and Accounting Periods belong to Fiscal Years. “Fiscal
period” in product copy therefore means the existing `AccountingPeriod` entity;
it never collapses the Fiscal Year and Period entities into one client-side
concept.

The frontend's chosen context is an in-memory navigation choice only. It is not a
session claim, cookie, authorization grant, or persisted default. Every request
continues to send its organization/scope as required by its existing contract and
the backend remains authoritative for membership, ownership, RBAC, licensing, and
lifecycle checks.

## 2. Existing API and OpenAPI contract

No endpoint was added. The slice uses the generated existing Accounting contracts:

| Purpose                        | Existing API                                                   | Required permission                |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------- |
| List active Financial Areas    | `GET /api/v1/financial-areas?organizationId=&isActive=true`    | `Accounting.FinancialArea.View`    |
| List a selected area's years   | `GET /api/v1/fiscal-years?organizationId=&financialAreaId=`    | `Accounting.FiscalYear.View`       |
| List a selected year's periods | `GET /api/v1/accounting-periods?organizationId=&fiscalYearId=` | `Accounting.AccountingPeriod.View` |
| Create a Financial Area        | `POST /api/v1/financial-areas`                                 | `Accounting.FinancialArea.Create`  |
| Create a Fiscal Year           | `POST /api/v1/fiscal-years`                                    | `Accounting.FiscalYear.Create`     |
| Open an Accounting Period      | `POST /api/v1/accounting-periods`                              | `Accounting.AccountingPeriod.Open` |

`CreateAccountingPeriod` is the existing open operation: a new period is born
`open`; the UI does not invent an arbitrary status update endpoint.

The OpenAPI controller metadata explicitly declares the list 404 posture:

- a foreign or unknown `organizationId` is not listable;
- a supplied `financialAreaId` for the Fiscal Year list is resolved as a
  parent reference and answers 404 when it is unknown or belongs to another
  organization;
- a supplied `fiscalYearId` for the Accounting Period list has the same 404
  posture.

The backing application services perform those parent checks before reading the
children. A foreign parent never degrades into an ambiguous empty page. This is
an ownership and information-disclosure rule, not an extra frontend trust
boundary.

`frontend/src/api/contracts.ts` aliases the generated OpenAPI declarations in
`frontend/src/api/generated/vardena-api.d.ts`; frontend API calls remain in
`frontend/src/api/accounting.api.ts`.

## 3. Frontend state machine

`FinancialContextProvider` sits beside, rather than inside,
`OrganizationContext`. OrganizationContext remains the sole owner of membership
and organization selection. The Financial Context provider owns only the
Accounting-specific choice below that established scope.

The provider intentionally exposes these outcomes:

- **loading** while the permitted, dependent list is resolving;
- **error** with the shared API error presentation and an explicit retry;
- **empty** at each level with an honest explanation, and the existing create/open
  affordance only when its distinct permission is present;
- **selecting** when multiple usable candidates require an explicit click;
- **invalid** if a previously selected row disappears or ceases to be usable;
- **ready** only after an active Financial Area, active/open Fiscal Year, and
  open Accounting Period are all resolved;
- **unavailable** when the session cannot read the complete context chain. The
  UI makes no Accounting context API call in that state; RBAC remains enforced
  by the API on every capability.

Exactly one usable candidate at a level may be selected automatically. Two or
more candidates always require an explicit user action. There is no automatic
creation of a sample Area, Year, or Period, no inferred calendar, and no
client-side “default context”. A user-created row is an explicit action under
its existing permission; the server response is cached only for immediate UI
continuity and immediately revalidated.

Years are usable only when `isActive` and `status === "open"`. Periods are usable
only when `status === "open"`. Closed and sealed rows remain visible on the
context page but are disabled, so historical state is not hidden and cannot be
mistaken for a writable context. Date bounds remain date-only and inclusive as
specified by the Accounting contract; overlap and parent/lifecycle rules are
validated by the backend.

## 4. Dependent data and cache behavior

TanStack Query keys include the full ancestor chain:

```text
accounting / organization / financial-context / areas
accounting / organization / financial-context / areas / area / fiscal-years
accounting / organization / financial-context / areas / area / fiscal-years / year / periods
```

Selecting an Area clears dependent Year/Period selection and evicts the former
Area's dependent list. Selecting a Year clears the selected Period and evicts the
former Year's Period list. Switching organization uses the existing
organization-scoped cache eviction predicate, clears the in-memory selection, and
cannot render a prior organization's context while the next scope is loading.

A POST response is accepted into the live context only when every response scope
identifier still matches the current organization and selected parent. A late
response from a previous organization or parent is discarded rather than being
written into the new scope's cache.

## 5. Non-goals

This slice does **not** add posting, journal, chart, balance, closing, opening
carry-forward, area-access grants, automatic calendar generation, or a new
Accounting model. It does not weaken server authorization, store a selection in
browser storage, or manufacture test/demo data. Fiscal Year and Period lifecycle
operations remain the existing Accounting lifecycle behavior.

## 6. Verification focus

The focused UI suite covers the sole-chain resolution, explicit multi-Area
selection with descendant query scoping, closed-period unavailability, retryable
reference-data failures, and explicitly creating/selecting a server-returned
Area without fabricating a Year or Period. Backend authorization coverage includes
foreign-parent list filters for both Year and Period lists.
