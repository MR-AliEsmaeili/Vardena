import type { BusinessDateInput } from '@/lib/datetime';
import type { components, operations } from './generated/vardena-api';

/**
 * Frontend view of the API contract.
 *
 * ADR-0014 / AR-26: the backend DTOs are the source of truth and the frontend
 * types are DERIVED from the generated OpenAPI document — see
 * `src/api/generated/vardena-api.d.ts`, produced by `npm run api:types` from
 * `/api/docs-json`. This file aliases the generated schemas and query shapes;
 * the narrowly documented `Omit` refinements below address only confirmed
 * Swagger limitations or keep shared domain aliases explicit.
 *
 * A few narrowly-scoped refinements remain because of verified Swagger
 * introspection limitations or to keep the shared BusinessDate alias explicit.
 * Each stays aligned with the backend DTOs and introduces no new wire semantic:
 *
 * 1. **Untyped nullable fields.** `@ApiProperty({ nullable: true })` without
 *    an explicit `type` emits a schema with no type, which the generator
 *    renders as `Record<string, never> | null`. `NullableString<T, K>`
 *    re-types exactly those keys as `string | null`, matching the TypeScript
 *    declaration of the very same DTO field in the backend source.
 * 2. **BusinessDate mutation inputs.** The generated declarations carry the
 *    backend DTOs' date-only / declared-calendar `oneOf` shapes. The narrow
 *    request aliases below retain the shared `BusinessDateInput` type at form
 *    call sites without changing the generated wire contract.
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
 * The previous `PaginatedResponseClass` collision has been fixed in
 * `paginatedResponseOf()`: each schema name now includes its item DTO, so the
 * generated operation response types retain the correct item reference.
 * Refinements 1 and 3 recover existing shapes; refinement 2 keeps request
 * aliases aligned with generated BusinessDate input unions and the shared
 * `BusinessDateInput` type. These are type corrections, not policy changes.
 */

type Schemas = components['schemas'];

/** Replace the given keys of a generated schema with `string | null`. */
type NullableString<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: string | null;
};

/**
 * Same as `NullableString`, but for keys the DTO declares OPTIONAL: the
 * optionality is preserved instead of being turned into a required field.
 */
type OptionalNullableString<T, K extends keyof T> = Omit<T, K> & {
  [P in K]?: string | null;
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
// Licensing (ADR-0030 / ADR-0046)
//
// `LicenseStateController.current()` (`backend/src/modules/licensing/api/
// license-state.controller.ts`) answers `GET /api/v1/license/current` with an
// inline return type, not a decorated response DTO class (`@ApiOkResponse`
// carries no `type`), so the generated OpenAPI document has no schema for it
// — the same annotation-gap category already described above for
// `NullableString`/`AccountStatement*`. `LicenseState` is restored VERBATIM
// from that controller's return type rather than derived from the generated
// document; `LicenseImportResult` is restored the same way from
// `LicenseImportController.import()` (`POST /api/v1/license/import`).
//
// The frontend imports licenses through that route only. It accepts BOTH the
// signed file envelope / VLIC2 artifact and a legacy VLIC1 code, so the UI has
// exactly one license submission path; the backend's `POST /license/activate`
// stays as the L-02 compatibility alias for existing clients (ADR-0046), it is
// not called from here.
// ---------------------------------------------------------------------------

export type LicenseEntitlementKind = 'MODULE' | 'FEATURE';

export interface LicenseEntitlement {
  kind: LicenseEntitlementKind;
  code: string;
}

/** How a retained version entered the installation (`LicenseVersionSource`). */
export type LicenseVersionSource = 'file' | 'text' | 'legacy-code';

/**
 * One retained license version (`LicenseVersionSummary`,
 * `backend/src/modules/licensing/domain/license-version.ts`).
 *
 * Versions are never replaced destructively: importing a renewal adds a row
 * and (when it supersedes another version) marks the old one superseded. The
 * window is half-open — `validFrom` inclusive, `validUntil` exclusive — and
 * `validUntil: null` means perpetual.
 */
export interface LicenseVersionSummary {
  versionId: string;
  licenseId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  validFrom: string;
  validUntil: string | null;
  /** True for the one version the backend resolved as governing now. */
  effective: boolean;
  supersededAt: string | null;
  supersededByVersionId: string | null;
  importedAt: string;
  source: LicenseVersionSource;
}

/**
 * `UNLICENSED` is not a license lifecycle value: it is an installation that
 * has never activated one (L-02). Every license-derived field is therefore
 * nullable, while `installationId` is reported even when unlicensed — it is
 * the value an operator quotes to obtain a license for this installation.
 *
 * `effectiveVersionId` / `scheduledVersion` / `versions` are the retained
 * version history (L-03): the resolved governing version, the earliest
 * not-yet-effective version (a scheduled renewal), and the retained history
 * bounded by the backend (nothing is deleted — the bound is display only).
 */
export interface LicenseState {
  licensed: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'UNLICENSED';
  active: boolean;
  inactiveReason: 'unlicensed' | 'status' | 'not-yet-valid' | 'expired' | null;
  installationId: string | null;
  customerId: string | null;
  licenseId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  organizationLimit: number | null;
  userLimit: number | null;
  entitlements: LicenseEntitlement[];
  provider: string;
  effectiveVersionId: string | null;
  scheduledVersion: LicenseVersionSummary | null;
  versions: LicenseVersionSummary[];
}

/**
 * `POST /api/v1/license/import` request body (`ImportLicenseDocumentDto`,
 * `backend/src/modules/licensing/api/dto/license.dto.ts`).
 *
 * The body carries exactly ONE field — the document a client received (the
 * `vardena-license` file envelope, a bare VLIC2 artifact, or a legacy VLIC1
 * code). Status, limits, validity window, versions and entitlements are read
 * from the verified payload, so the client can never describe the license it
 * wants.
 */
export interface ImportLicenseDocumentRequest {
  document: string;
}

/** Backend `MaxLength(65536)` of `ImportLicenseDocumentDto.document`. */
export const LICENSE_DOCUMENT_MAX_LENGTH = 65536;

/**
 * `LicenseImportController.import()` answers with the SAME evaluated state as
 * `GET /license/current` plus `changed` (false when a repeated legacy code was
 * already the governing version) and the applied outcome.
 *
 * It is a result receipt, not a license source: callers re-read
 * `GET /license/current` after a successful import instead of promoting this
 * payload into the license query cache (AR-21).
 */
export interface LicenseImportResult extends LicenseState {
  changed: boolean;
  outcome: 'APPLIED' | 'UNCHANGED';
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

/** Organization-owned date/time setting: the IANA time zone only. */
export type OrganizationDateTimeSettings = Pick<
  Schemas['OrganizationResponseDto'],
  'timeZone'
>;

/** Organization settings are required by the backend response contract. */
export type Organization = Schemas['OrganizationResponseDto'];
export type OrganizationListQuery =
  operations['OrganizationsController_list_v1']['parameters']['query'];
export type CreateOrganizationRequest = Schemas['CreateOrganizationDto'];
export type UpdateOrganizationRequest = Schemas['UpdateOrganizationDto'];
export type GrantMembershipRequest = Schemas['GrantMembershipDto'];

// ---------------------------------------------------------------------------
// Organization — master data administration (FE-ORG-01)
//
// Branch / Department / Employee / Party, exactly as
// `backend/src/modules/organization/api/*.controller.ts` declares them. Every
// list query type is read from the generated operation, so a filter the
// backend does not declare cannot be constructed here (`forbidNonWhitelisted`
// would answer 400 for it anyway).
//
// There is deliberately NO delete request type: none of these controllers
// exposes DELETE — the lifecycle is `is_active` (enable/disable), per
// `docs/architecture/domain/master-data-strategy.md` §7.4 (OQ-36).
// ---------------------------------------------------------------------------

/** `BranchResponseDto` is aliased further down (document header display). */
export type BranchListQuery =
  operations['BranchesController_list_v1']['parameters']['query'];
export type CreateBranchRequest = Schemas['CreateBranchDto'];
export type UpdateBranchRequest = Schemas['UpdateBranchDto'];

export type Department = NullableString<
  Schemas['DepartmentResponseDto'],
  'parentDepartmentId'
>;
export type DepartmentListQuery =
  operations['DepartmentsController_list_v1']['parameters']['query'];
export type CreateDepartmentRequest = Schemas['CreateDepartmentDto'];
/** `parentDepartmentId: null` detaches the department from its parent. */
export type UpdateDepartmentRequest = OptionalNullableString<
  Schemas['UpdateDepartmentDto'],
  'parentDepartmentId'
>;

export type Employee = NullableString<
  Schemas['EmployeeResponseDto'],
  'departmentId' | 'branchId'
>;
export type EmployeeListQuery =
  operations['EmployeesController_list_v1']['parameters']['query'];
export type CreateEmployeeRequest = Schemas['CreateEmployeeDto'];
/** `departmentId`/`branchId` set to `null` clears the assignment. */
export type UpdateEmployeeRequest = OptionalNullableString<
  Schemas['UpdateEmployeeDto'],
  'departmentId' | 'branchId'
>;

export type Party = NullableString<
  Schemas['PartyResponseDto'],
  'legalName' | 'email' | 'phone'
>;
/** Closed identity type of a party (`PARTY_TYPES`: person | organization). */
export type PartyType = Schemas['PartyResponseDto']['partyType'];
export type PartyListQuery =
  operations['PartiesController_list_v1']['parameters']['query'];
export type CreatePartyRequest = Schemas['CreatePartyDto'];
export type UpdatePartyRequest = Schemas['UpdatePartyDto'];

// ---------------------------------------------------------------------------
// Accounting — reference data used by report filters
// ---------------------------------------------------------------------------

export type FinancialArea = Schemas['FinancialAreaResponseDto'];
export type CreateFinancialAreaRequest = Schemas['CreateFinancialAreaDto'];
export type FiscalYear = NullableString<
  Schemas['FiscalYearResponseDto'],
  'priorYearId'
>;
export type CreateFiscalYearRequest = OptionalNullableString<
  Omit<Schemas['CreateFiscalYearDto'], 'startDate' | 'endDate'>,
  'priorYearId'
> & {
  startDate: BusinessDateInput;
  endDate: BusinessDateInput;
};
export type UpdateFiscalYearRequest = Omit<
  Schemas['UpdateFiscalYearDto'],
  'startDate' | 'endDate'
> & {
  startDate?: BusinessDateInput;
  endDate?: BusinessDateInput;
};
export type AccountingPeriod = Schemas['AccountingPeriodResponseDto'];
export type CreateAccountingPeriodRequest = Omit<
  Schemas['CreateAccountingPeriodDto'],
  'startDate' | 'endDate'
> & {
  startDate: BusinessDateInput;
  endDate: BusinessDateInput;
};
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
// Accounting — Dashboard read surfaces (read-only, Task 32)
// ---------------------------------------------------------------------------

/** One accounting voucher of the organization (`AccountingDocumentResponseDto`). */
export type AccountingDocument = Omit<
  NullableString<
    Schemas['AccountingDocumentResponseDto'],
    | 'documentNumber'
    | 'branchId'
    | 'sourceModule'
    | 'sourceEntityType'
    | 'sourceEntityId'
    | 'sourceOperation'
    | 'finalizedAt'
    | 'finalizedBy'
    | 'correlationId'
    | 'correctionReason'
    | 'reversesDocumentId'
    | 'reversedByDocumentId'
  >,
  'lines'
> & {
  /** The generated nested line type carries the same nullable-string gaps. */
  lines: AccountingDocumentLine[];
};

/** One line of a document response (`AccountingDocumentLineResponseDto`). */
export type AccountingDocumentLine = Omit<
  Schemas['AccountingDocumentLineResponseDto'],
  'detailId' | 'description' | 'sourceLineReference'
> & {
  detailId?: string | null;
  description: string | null;
  sourceLineReference?: string | null;
};

export type AccountingDocumentListQuery =
  operations['AccountingDocumentsController_list_v1']['parameters']['query'];

/** One period-balance row of the projection (`BalanceDto`). */
export type AccountBalance = Schemas['BalanceDto'];
export type AccountBalanceListQuery =
  operations['AccountingBalancesController_list_v1']['parameters']['query'];

/** Inventory stock balance (`InventoryBalanceResponseDto`). */
export type InventoryBalance = NullableString<
  Schemas['InventoryBalanceResponseDto'],
  'lastMovementDate'
>;
export type InventoryBalanceListQuery =
  operations['InventoryBalancesController_list_v1']['parameters']['query'];

/** Workflow binding/instance row (`WorkflowInstanceResponseDto`). */
export type WorkflowInstance = Schemas['WorkflowInstanceResponseDto'];
export type WorkflowInstanceListQuery =
  operations['WorkflowInstancesController_list_v1']['parameters']['query'];

// ---------------------------------------------------------------------------
// Accounting — Document lifecycle writes (FE-UX-08)
//
// The voucher aggregate's mutation contract (backend
// `AccountingDocumentsController`): compose, edit, issue, finalize, reverse
// and discard. Every field below is the generated OpenAPI schema, narrowed
// only where the Swagger annotations emit `Record<string, never> | null` for
// fields the backend DTO declares as `string | null` (refinement 2 above).
// ---------------------------------------------------------------------------

export type AccountingDocumentLineInput = OptionalNullableString<
  Schemas['AccountingDocumentLineInputDto'],
  'detailId'
>;

export type CreateAccountingDocumentInput = Omit<
  OptionalNullableString<Schemas['CreateAccountingDocumentDto'], 'branchId'>,
  'lines' | 'documentDate'
> & {
  documentDate: BusinessDateInput;
  lines: AccountingDocumentLineInput[];
};

export type UpdateAccountingDocumentInput = Omit<
  OptionalNullableString<Schemas['UpdateAccountingDocumentDto'], 'branchId'>,
  'lines' | 'documentDate'
> & {
  documentDate?: BusinessDateInput;
  lines?: AccountingDocumentLineInput[];
};

export type DocumentTransitionInput = Schemas['DocumentTransitionDto'];

export type ReverseAccountingDocumentInput = Omit<
  Schemas['ReverseAccountingDocumentDto'],
  'documentDate'
> & { documentDate?: BusinessDateInput };

/** Detail record of a detail group (`DetailResponseDto`). */
export type AccountingDetail = NullableString<
  Schemas['DetailResponseDto'],
  'parentId'
>;

// ---------------------------------------------------------------------------
// Organization — branch reference (document header display)
// ---------------------------------------------------------------------------

export type Branch = Schemas['BranchResponseDto'];

// ---------------------------------------------------------------------------
// Accounting — Account Statement (Task 17B)
// ---------------------------------------------------------------------------

export type AccountStatementQuery =
  operations['AccountStatementsController_getAccountStatement_v1']['parameters']['query'];

export type AccountStatementTotals = Schemas['AccountStatementTotalsDto'];

/** One movement row — backend `AccountStatementEntryDto` (refinement 4). */
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

/** Scope echo — backend `AccountStatementScopeDto` (refinement 4). */
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

// ---------------------------------------------------------------------------
// Inventory — warehouse operations & valuation (this slice's backend
// contracts: `backend/src/modules/inventory/api/*`, ADR-0022 / ADR-0039)
//
// Same derivation rules as everywhere above: the generated OpenAPI schema is
// the only source, narrowed with `NullableString` solely where the backend's
// `@ApiProperty({ nullable: true })` without an explicit `type` emits
// `Record<string, never> | null` (refinement 2). Money and quantities stay
// exact decimal STRINGS — the UI never parses them into a float.
// ---------------------------------------------------------------------------

/** One movement row (`InventoryMovementResponseDto`). */
export type InventoryMovement = NullableString<
  Schemas['InventoryMovementResponseDto'],
  | 'transferId'
  | 'reversalOfMovementId'
  | 'referenceType'
  | 'referenceId'
  | 'reason'
  | 'totalCost'
  | 'valuationSource'
  | 'valuedAt'
  | 'valuationRunId'
>;

export type InventoryMovementListQuery =
  operations['InventoryMovementsController_list_v1']['parameters']['query'];

/**
 * `POST /inventory/movements` body (`PostInventoryMovementDto`).
 *
 * OQ-73 refinement: `movementDate` is a business DAY — the backend accepts a
 * canonical Gregorian day, a DECLARED Jalali day (`{ calendar, value }`) or a
 * legacy ISO instant. The generated DTO types it as a plain string, so the
 * field is restated with the contract's own input type.
 */
export type PostInventoryMovementInput = Omit<
  Schemas['PostInventoryMovementDto'],
  'movementDate'
> & { movementDate?: BusinessDateInput };

/** `POST /inventory/movements/:id/reverse` body. */
export type ReverseInventoryMovementInput = Omit<
  Schemas['ReverseInventoryMovementDto'],
  'movementDate'
> & { movementDate?: BusinessDateInput };

/** `POST /inventory/transfers` body (`PostInventoryTransferDto`). */
export type PostInventoryTransferInput = Omit<
  Schemas['PostInventoryTransferDto'],
  'movementDate'
> & { movementDate?: BusinessDateInput };

/** `POST /inventory/transfers` result: the two legs share one transferId. */
export type InventoryTransferResult = Schemas['InventoryTransferResponseDto'];

/** Quantity-only Kardex (`InventoryKardexResponseDto` and members). */
export type InventoryKardexRow = NullableString<
  Schemas['InventoryKardexRowDto'],
  'transferId' | 'reversalOfMovementId' | 'referenceType' | 'referenceId'
>;

export type InventoryKardexResponse = Omit<
  Schemas['InventoryKardexResponseDto'],
  'scope' | 'items'
> & {
  items: InventoryKardexRow[];
  scope: Omit<Schemas['InventoryKardexScopeDto'], 'dateFrom' | 'dateTo'> & {
    dateFrom: string | null;
    dateTo: string | null;
  };
};

export type InventoryKardexQuery =
  operations['InventoryKardexController_read_v1']['parameters']['query'];

/** Per-key value projection (`InventoryValuationStateResponseDto`). */
export type InventoryValuationState = NullableString<
  Schemas['InventoryValuationStateResponseDto'],
  'averageUnitCost' | 'staleSince' | 'lastValuedAt' | 'lastRecalculationId'
>;

/** Movement type union (all eight ledger kinds). */
export type MovementType =
  Schemas['InventoryMovementResponseDto']['movementType'];

/** Single-post channel kinds (receipt/issue/adjustments only). */
export type SinglePostMovementType =
  Schemas['PostInventoryMovementDto']['movementType'];

/** Movement-level valuation finality (visible even without money permission). */
export type MovementValuationStatus =
  Schemas['InventoryMovementResponseDto']['valuationStatus'];

/** Key-level valuation state status (`valued` / `pending_cost` / `stale`). */
export type ValuationStateStatus =
  Schemas['InventoryValuationStateResponseDto']['status'];

export type InventoryValuationStateListQuery =
  operations['InventoryValuationController_listStates_v1']['parameters']['query'];

// ---------------------------------------------------------------------------
// Inventory business documents (C-58) — Receipt / Issue / Transfer
//
// Every type below is DERIVED from the generated contract
// (`InventoryBusinessDocumentsController`): the lifecycle status union, the
// kind union and the `canX` capability flags come from the backend DTO, so a
// UI that renders an action the backend does not expose cannot compile.
// ---------------------------------------------------------------------------

/** One Inventory business document with its lines. */
export type InventoryDocument = Schemas['InventoryDocumentResponseDto'];

/** One document line (entered + base quantities, and the facts it owns). */
export type InventoryDocumentLine = Schemas['InventoryDocumentLineResponseDto'];

/** `receipt` | `issue` | `transfer`. */
export type InventoryDocumentKind = InventoryDocument['kind'];

/** `draft` | `operational` | `accounting_posted` | `immutable` | `cancelled`. */
export type InventoryDocumentStatus = InventoryDocument['status'];

export type InventoryDocumentListQuery =
  operations['InventoryBusinessDocumentsController_list_v1']['parameters']['query'];

/**
 * `POST /inventory/business-documents` body.
 *
 * C-63 refinement (see `OrganizationDateTimeSettings` above): the generated
 * backend contract now carries the canonical Gregorian string or DECLARED
 * Jalali day (`{ calendar, value }`) forms for `businessDate`; the shared
 * `BusinessDateInput` alias keeps UI mapping consistent with other forms.
 */
export type CreateInventoryDocumentInput = Omit<
  Schemas['CreateInventoryDocumentDto'],
  'businessDate'
> & { businessDate?: BusinessDateInput };

/** `PATCH /inventory/business-documents/:id` body (OQ-54 edit pipeline). */
export type UpdateInventoryDocumentInput = Omit<
  Schemas['UpdateInventoryDocumentDto'],
  'businessDate'
> & { businessDate?: BusinessDateInput };

/** `POST …/:id/finalize` body (backdating answers). */
export type FinalizeInventoryDocumentInput =
  Schemas['FinalizeInventoryDocumentDto'];

/** `POST …/:id/cancel` body. */
export type CancelInventoryDocumentInput =
  Schemas['CancelInventoryDocumentDto'];

/** Explicit repricing choice — never defaulted (OD-VAL-11). */
export type InventoryRepricingChoice = NonNullable<
  UpdateInventoryDocumentInput['repricing']
>;

/** `GET /inventory/valuation/backdate-check` — counts and dates, no amounts. */
export type InventoryBackdateCheck = NullableString<
  Schemas['BackdateCheckResponseDto'],
  'latestMovementDate' | 'code'
>;

export type InventoryBackdateCheckQuery =
  operations['InventoryValuationController_checkBackdate_v1']['parameters']['query'];

/** `POST /inventory/valuation/recalculations` (one item in one warehouse). */
export type RecalculateValuationInput = Schemas['RecalculateValuationDto'];

export type RecalculationRun = NullableString<
  Schemas['InventoryValuationRunResponseDto'],
  'fromDate' | 'reason'
>;

export type RecalculationResult = {
  run: RecalculationRun;
  state: InventoryValuationState;
};

// Reference reads the warehouse pickers need (master data).

export type InventoryWarehouse = Schemas['WarehouseResponseDto'];

export type InventoryWarehouseListQuery =
  operations['WarehousesController_list_v1']['parameters']['query'];

export type InventoryItem = NullableString<
  Schemas['ItemResponseDto'],
  'description' | 'itemGroupId' | 'allowNegativeStock' | 'barcode'
>;

export type InventoryItemListQuery =
  operations['ItemsController_list_v1']['parameters']['query'];

export type InventoryUnit = NullableString<
  Schemas['UnitResponseDto'],
  'symbol'
>;

export type InventoryUnitListQuery =
  operations['UnitsController_list_v1']['parameters']['query'];
