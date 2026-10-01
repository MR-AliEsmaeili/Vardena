# Financial Area and Fiscal Year workspace context

**Status:** implemented UI foundation — 2026-10-01

**Scope:** browser navigation context for the existing Accounting hierarchy; no new
Accounting aggregate, posting flow, period-close workflow, or client-side
authorization system is introduced.

## Meaning and hierarchy

The server-owned hierarchy remains:

```text
Organization → FinancialArea → FiscalYear → AccountingPeriod
```

The workspace's user-facing “Fiscal Period” choice is the existing
`FiscalYear`: it is the active, independently selectable fiscal range directly
under a `FinancialArea`. An `AccountingPeriod` remains a dated operational
window under that year, so this foundation deliberately does **not** invent a
second `FiscalPeriod` model or make a period the global navigation context.

`OrganizationProvider` is the only browser context. It owns the selected
organization plus the in-memory Financial Area and Fiscal Year selections. No
selection is written to localStorage, a cookie, a URL parameter, or another
state store. The browser values are request parameters and navigation choices,
not authority.

## Entry flow and state behavior

For a signed-in session with an active installation license, the shell resolves
these stages in order:

```text
Session → LicenseGate → OrganizationGate → Financial Context → workspace
```

The Accounting context stage is applied when the effective permission set can
read both `Accounting.FinancialArea.View` and `Accounting.FiscalYear.View`.
This qualification is intentional: existing routes are independently gated by
the exact API permission they call. A principal holding, for example, only a
chart or organization permission must not be trapped behind unrelated parent
list permissions when the API has no universal active-context requirement.

For applicable sessions:

1. `GET /financial-areas` is requested for the confirmed organization with
   `isActive=true`.
2. Zero areas shows an explicit empty state. A first-area form appears only
   when the effective principal also has `Accounting.FinancialArea.Create`.
   The form never fabricates an area.
3. One active area is selected automatically; multiple areas require an
   explicit, accessible radio selection.
4. `GET /fiscal-years` is requested only after an area is known, with that
   organization and area plus `isActive=true&status=open`.
5. Zero open active years shows an explicit empty state. The first-year form
   appears only with `Accounting.FiscalYear.Create`.
6. One open active year is selected automatically; multiple years require an
   explicit selection. Only then is the workspace rendered.

Loading, error/retry, forbidden, stale/invalid selection, empty, singleton and
multi-choice states are distinct. Changing organization clears both descendants
and removes other organization-scoped query data. Changing Financial Area
immediately clears the Fiscal Year selection and replaces its area-scoped query;
a stale fiscal year is never reused under a different area.

The header switcher exposes the active context only after it is coherent. It
uses native controls for keyboard and assistive-technology support.

## API, ownership and authorization boundary

The UI calls existing Accounting endpoints only:

| Operation   | Existing route                 | Browser filters                                      | Server authority                                                                                     |
| ----------- | ------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| List areas  | `GET /api/v1/financial-areas`  | `organizationId`, `isActive=true`                    | authenticated principal, effective licensed `Accounting.FinancialArea.View`, organization scope      |
| Create area | `POST /api/v1/financial-areas` | organization id, code, title                         | effective licensed `Accounting.FinancialArea.Create`, usable organization, uniqueness and validation |
| List years  | `GET /api/v1/fiscal-years`     | organization id, selected area id, active/open state | effective licensed `Accounting.FiscalYear.View`, organization scope, Financial Area ownership        |
| Create year | `POST /api/v1/fiscal-years`    | selected organization/area, labels and dates         | effective licensed `Accounting.FiscalYear.Create`, usable organization/area, range and overlap rules |

The licensing boundary is the existing `AuthorizationService`: it evaluates the
request principal's stored role permissions and filters them through the active
license's module entitlements on every authorization decision. The UI's License
Gate is only a UX stage; it never replaces the server check.

A supplied parent id is a hierarchy assertion rather than a harmless list
filter. The backend now resolves the following before querying rows:

- `GET /fiscal-years?organizationId=&financialAreaId=` verifies the area is
  owned by the requested organization, returning the existing 404
  no-disclosure response for a forged or foreign pair.
- `GET /accounting-periods` accepts optional `financialAreaId`, resolves every
  supplied area and fiscal-year under the organization, and returns 404 when a
  valid same-organization area/year pair does not belong together.

These checks preserve historical reads: disabled areas and inactive years can
still be read through established historical/admin paths; they are simply not
usable candidates for ordinary workspace entry or writable references.

## Contract generation and verification ownership

`backend` DTOs generate Swagger at `/api/docs-json`; the committed frontend
file `frontend/src/api/generated/vardena-api.d.ts` is regenerated with
`VARDENA_OPENAPI_SOURCE=<document> npm run api:types`. Do not hand-edit it.
This implementation regenerated the artifact after documenting
`financialAreaId` on the Accounting Period list query.

Fast local checks cover TypeScript, lint, formatting, the Accounting service
ownership cases, and the React context/gate flow. The PostgreSQL-backed HTTP
security/persistence suite remains owned by the repository's GitHub Actions
workflow; CI must execute and report it before this change is accepted.
