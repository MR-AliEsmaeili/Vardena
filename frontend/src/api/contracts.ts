import type { components, operations } from './generated/vardena-api';

/**
 * Frontend view of the API contract.
 *
 * ADR-0014 / AR-26: the backend DTOs are the source of truth and the frontend
 * types are DERIVED from the generated OpenAPI document — see
 * `src/api/generated/vardena-api.d.ts`, produced by `npm run api:types` from
 * `/api/docs-json`. This file only ALIASES the generated schemas and query
 * shapes; it never re-declares a field the contract already types.
 *
 * Three narrowly-scoped refinements are applied below because the generated
 * document is imprecise where the backend's Swagger annotations are
 * incomplete. Each is a documented, mechanical narrowing of `unknown`-ish
 * generated shapes — never a new field, never a different semantic:
 *
 * 1. **`PaginatedResponseClass` name collision.** `paginatedResponseOf()`
 *    (`backend/src/kernel/pagination/paginated-result.ts`) builds an anonymous
 *    class named `PaginatedResponseClass` per endpoint, so every paginated
 *    operation registers the SAME schema name and the last registration wins.
 *    The runtime envelope is identical for all of them
 *    (`{ items, total, page, pageSize }`, `docs/architecture.md` §9), so the
 *    generic `Paginated<T>` below restores the item type per endpoint.
 * 2. **Untyped nullable fields.** `@ApiProperty({ nullable: true })` without
 *    an explicit `type` emits a schema with no type, which the generator
 *    renders as `Record<string, never> | null`. `NullableString<T, K>`
 *    re-types exactly those keys as `string | null`, matching the TypeScript
 *    declaration of the very same DTO field in the backend source.
 * 3. **Account statement envelope.** `AccountStatementResponseDto.movements`
 *    and the members of `AccountStatementScopeDto` (`financialArea`,
 *    `fiscalYear`, `account`, `accountingPeriod`) are declared with plain
 *    `@ApiProperty()` over inline TypeScript object types, which Swagger
 *    cannot introspect: they emit as `Record<string, never>` and
 *    `AccountStatementEntryDto` is not referenced at all, so it is missing
 *    from the document. Both are restored VERBATIM from the backend DTO
 *    declaration in
 *    `backend/src/modules/accounting/api/dto/account-statement.dto.ts`.
 *
 * All three are backend OpenAPI ANNOTATION gaps, not behavior defects: the
 * responses on the wire already have these shapes. They are reported as
 * follow-ups rather than patched here, because this task must not change
 * backend contracts.
 */

type Schemas = components['schemas'];

/** Replace the given keys of a generated schema with `string | null`. */
type NullableString<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: string | null;
};

/** Standard list envelope (`docs/architecture.md` §9). */
export interface Paginated<TItem> {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Identity / RBAC
// ---------------------------------------------------------------------------

export type AuthenticatedUser = Schemas['AuthenticatedUserDto'];
export type LoginRequest = Schemas['LoginRequestDto'];
export type EffectivePermissions = Schemas['EffectivePermissionsDto'];

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export type Organization = Schemas['OrganizationResponseDto'];
export type OrganizationListQuery =
  operations['OrganizationsController_list_v1']['parameters']['query'];

// ---------------------------------------------------------------------------
// Accounting — reference data used by report filters
// ---------------------------------------------------------------------------

export type FinancialArea = Schemas['FinancialAreaResponseDto'];
export type FiscalYear = NullableString<
  Schemas['FiscalYearResponseDto'],
  'priorYearId'
>;
export type AccountingPeriod = Schemas['AccountingPeriodResponseDto'];
export type Account = NullableString<
  Schemas['AccountResponseDto'],
  'parentId' | 'codingStructureVersionId' | 'accountingConfigurationId'
>;

export type FinancialAreaListQuery =
  operations['FinancialAreasController_list_v1']['parameters']['query'];
export type FiscalYearListQuery =
  operations['FiscalYearsController_list_v1']['parameters']['query'];
export type AccountingPeriodListQuery =
  operations['AccountingPeriodsController_list_v1']['parameters']['query'];
export type AccountListQuery =
  operations['AccountsController_list_v1']['parameters']['query'];

// ---------------------------------------------------------------------------
// Accounting — Chart Tree (Task 19, ODR-2)
// ---------------------------------------------------------------------------

export type ChartTreeNode = NullableString<
  Schemas['ChartTreeNodeDto'],
  'parentId' | 'codingStructureVersionId' | 'accountingConfigurationId'
>;
export type ChartTreeQuery =
  operations['ChartTreeController_list_v1']['parameters']['query'];

// ---------------------------------------------------------------------------
// Accounting — General Ledger / Trial Balance (Task 18)
// ---------------------------------------------------------------------------

export type GeneralLedgerRow = NullableString<
  Schemas['GeneralLedgerResponseDto'],
  | 'reference'
  | 'description'
  | 'sourceModule'
  | 'sourceEntityType'
  | 'sourceEntityId'
  | 'sourceOperation'
>;
export type GeneralLedgerQuery =
  operations['GeneralLedgerController_list_v1']['parameters']['query'];

export type TrialBalanceRow = Schemas['TrialBalanceResponseDto'];
export type TrialBalanceQuery =
  operations['TrialBalanceController_list_v1']['parameters']['query'];

// ---------------------------------------------------------------------------
// Accounting — Account Statement (Task 17B)
// ---------------------------------------------------------------------------

export type AccountStatementQuery =
  operations['AccountStatementsController_getAccountStatement_v1']['parameters']['query'];

export type AccountStatementTotals = Schemas['AccountStatementTotalsDto'];

/** One movement row — backend `AccountStatementEntryDto` (refinement 3). */
export interface AccountStatementEntry {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  voucherId: string;
  voucherNumber: string;
  voucherLineId: string;
  lineNo: number;
  accountId: string;
  debitAmount: string;
  creditAmount: string;
  netAmount: string;
  runningBalanceAmount: string;
  description: string | null;
  documentDate: string;
  postingTimestamp: string;
  origin: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
}

/** Scope echo — backend `AccountStatementScopeDto` (refinement 3). */
export interface AccountStatementScope {
  organizationId: string;
  financialArea: { id: string; code: string; title: string };
  fiscalYear: {
    id: string;
    code: string;
    title: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  account: { id: string; code: string; title: string };
  accountingPeriod: {
    id: string;
    sequence: number;
    title: string;
    startDate: string;
    endDate: string;
    status: string;
  } | null;
}

/** The complete statement envelope — backend `AccountStatementResponseDto`. */
export interface AccountStatement extends Omit<
  Schemas['AccountStatementResponseDto'],
  'scope' | 'movements'
> {
  scope: AccountStatementScope;
  movements: Paginated<AccountStatementEntry>;
}
