import { apiDelete, apiGet, apiPatch, apiPost, cleanParams } from './client';
import { ApiError } from './errors';
import type {
  Account,
  AccountingConfiguration,
  AccountingConfigurationListQuery,
  AccountStatement,
  AccountStatementQuery,
  AccountListQuery,
  AccountingDetail,
  AccountingDocument,
  AccountingDocumentLineInput,
  AccountingDocumentListQuery,
  AccountingPeriod,
  AccountingPeriodListQuery,
  ChartTreeNode,
  ChartTreeQuery,
  CodingStructureListQuery,
  CodingStructureVersion,
  CreateAccountRequest,
  CreateAccountingConfigurationRequest,
  CreateAccountingDocumentInput,
  CreateAccountingPeriodRequest,
  TransitionAccountingPeriodRequest,
  CreateCodingStructureRequest,
  CreateFinancialAreaRequest,
  CreateFiscalYearRequest,
  DocumentTransitionInput,
  FinancialArea,
  FinancialAreaListQuery,
  FiscalYear,
  FiscalYearListQuery,
  GeneralLedgerQuery,
  GeneralLedgerRow,
  Paginated,
  ReverseAccountingDocumentInput,
  TrialBalanceQuery,
  TrialBalanceRow,
  UpdateAccountingDocumentInput,
  UpdateFinancialAreaRequest,
  UpdateFiscalYearRequest,
  TransitionFiscalYearRequest,
} from './contracts';

/**
 * Accounting read surfaces (`backend/src/modules/accounting/api`).
 *
 * Every function maps 1:1 onto an EXISTING endpoint and sends exactly the
 * query parameters that endpoint declares — the global validation pipe
 * rejects any undeclared parameter with 400, and this layer never invents a
 * filter, a sort field or a computed value. All amounts stay exact decimal
 * strings as returned; nothing is recomputed client-side.
 */

/** Hard page cap of the backend list contract (`MAX_PAGE_SIZE`). */
export const MAX_PAGE_SIZE = 500;

/** Bounded page fan-out for the chart tree (see `fetchChartTreePages`). */
export const CHART_TREE_MAX_PAGES = 10;

// ---------------------------------------------------------------------------
// Reference data for report filters
// ---------------------------------------------------------------------------

export function listFinancialAreas(
  params: { organizationId: string; isActive?: boolean },
  signal?: AbortSignal,
): Promise<Paginated<FinancialArea>> {
  return apiGet<Paginated<FinancialArea>>('/financial-areas', {
    params: cleanParams({
      organizationId: params.organizationId,
      isActive: params.isActive,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

export function createFinancialArea(
  body: CreateFinancialAreaRequest,
): Promise<FinancialArea> {
  return apiPost<FinancialArea, CreateFinancialAreaRequest>(
    '/financial-areas',
    body,
  );
}

export function getFinancialArea(
  organizationId: string,
  financialAreaId: string,
  signal?: AbortSignal,
): Promise<FinancialArea> {
  return apiGet<FinancialArea>(
    `/financial-areas/${encodeURIComponent(financialAreaId)}`,
    {
      params: { organizationId },
      ...(signal ? { signal } : {}),
    },
  );
}

export function updateFinancialArea(
  organizationId: string,
  financialAreaId: string,
  body: UpdateFinancialAreaRequest,
): Promise<FinancialArea> {
  return apiPatch<FinancialArea, UpdateFinancialAreaRequest>(
    `/financial-areas/${encodeURIComponent(financialAreaId)}`,
    body,
    { params: { organizationId } },
  );
}

export function enableFinancialArea(
  organizationId: string,
  financialAreaId: string,
): Promise<FinancialArea> {
  return apiPost<FinancialArea>(
    `/financial-areas/${encodeURIComponent(financialAreaId)}/enable`,
    undefined,
    { params: { organizationId } },
  );
}

export function disableFinancialArea(
  organizationId: string,
  financialAreaId: string,
): Promise<FinancialArea> {
  return apiPost<FinancialArea>(
    `/financial-areas/${encodeURIComponent(financialAreaId)}/disable`,
    undefined,
    { params: { organizationId } },
  );
}

export function listFiscalYears(
  params: {
    organizationId: string;
    financialAreaId?: string | undefined;
    isActive?: boolean | undefined;
    status?: FiscalYear['status'] | undefined;
  },
  signal?: AbortSignal,
): Promise<Paginated<FiscalYear>> {
  return apiGet<Paginated<FiscalYear>>('/fiscal-years', {
    params: cleanParams({
      organizationId: params.organizationId,
      financialAreaId: params.financialAreaId,
      isActive: params.isActive,
      status: params.status,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

export function createFiscalYear(
  body: CreateFiscalYearRequest,
): Promise<FiscalYear> {
  return apiPost<FiscalYear, CreateFiscalYearRequest>('/fiscal-years', body);
}

export function getFiscalYear(
  organizationId: string,
  fiscalYearId: string,
  signal?: AbortSignal,
): Promise<FiscalYear> {
  return apiGet<FiscalYear>(
    `/fiscal-years/${encodeURIComponent(fiscalYearId)}`,
    {
      params: { organizationId },
      ...(signal ? { signal } : {}),
    },
  );
}

export function updateFiscalYear(
  organizationId: string,
  fiscalYearId: string,
  body: UpdateFiscalYearRequest,
): Promise<FiscalYear> {
  return apiPatch<FiscalYear, UpdateFiscalYearRequest>(
    `/fiscal-years/${encodeURIComponent(fiscalYearId)}`,
    body,
    { params: { organizationId } },
  );
}

export type FiscalYearTransitionAction = 'close' | 'reopen' | 'seal' | 'unseal';

export function transitionFiscalYear(
  organizationId: string,
  fiscalYearId: string,
  action: FiscalYearTransitionAction,
  body: TransitionFiscalYearRequest,
): Promise<FiscalYear> {
  return apiPost<FiscalYear, TransitionFiscalYearRequest>(
    `/fiscal-years/${encodeURIComponent(fiscalYearId)}/${action}`,
    body,
    { params: { organizationId } },
  );
}

export function listAccountingPeriods(
  params: {
    organizationId: string;
    financialAreaId?: string | undefined;
    fiscalYearId: string;
  },
  signal?: AbortSignal,
): Promise<Paginated<AccountingPeriod>> {
  return apiGet<Paginated<AccountingPeriod>>('/accounting-periods', {
    params: cleanParams({
      organizationId: params.organizationId,
      financialAreaId: params.financialAreaId,
      fiscalYearId: params.fiscalYearId,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
    }),
    ...(signal ? { signal } : {}),
  });
}

/**
 * Postable accounts for the statement picker. `isPostable=true` mirrors the
 * statement contract (decision D1: a non-postable account answers 422), and
 * `search` is the endpoint's own substring filter — the list stays
 * server-filtered and bounded instead of pulling the whole chart.
 */
export function listPostableAccounts(
  params: { organizationId: string; search?: string | undefined },
  signal?: AbortSignal,
): Promise<Paginated<Account>> {
  return apiGet<Paginated<Account>>('/accounts', {
    params: cleanParams({
      organizationId: params.organizationId,
      isPostable: true,
      isActive: true,
      search: params.search,
      page: 1,
      pageSize: 50,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

/**
 * Active accounts for the document-line code/name picker.
 *
 * Unlike `listPostableAccounts`, this read does NOT narrow to postable
 * leaves: the chart-of-accounts administration lets an operator define an
 * account that is not a posting leaf, and an account that exists but can
 * never be found in a picker reads as "my accounts are missing". The picker
 * therefore searches the whole active chart and marks aggregate accounts as
 * non-selectable instead of hiding them.
 */
export function listActiveAccounts(
  params: { organizationId: string; search?: string | undefined },
  signal?: AbortSignal,
): Promise<Paginated<Account>> {
  return apiGet<Paginated<Account>>('/accounts', {
    params: cleanParams({
      organizationId: params.organizationId,
      isActive: true,
      search: params.search,
      page: 1,
      pageSize: 50,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Master-data administration reads — server filtered, sorted and paged
// ---------------------------------------------------------------------------

export function listFinancialAreasPage(
  query: FinancialAreaListQuery,
  signal?: AbortSignal,
): Promise<Paginated<FinancialArea>> {
  return apiGet<Paginated<FinancialArea>>('/financial-areas', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function listFiscalYearsPage(
  query: FiscalYearListQuery,
  signal?: AbortSignal,
): Promise<Paginated<FiscalYear>> {
  return apiGet<Paginated<FiscalYear>>('/fiscal-years', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function listAccountingPeriodsPage(
  query: AccountingPeriodListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AccountingPeriod>> {
  return apiGet<Paginated<AccountingPeriod>>('/accounting-periods', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function listAccounts(
  query: AccountListQuery,
  signal?: AbortSignal,
): Promise<Paginated<Account>> {
  return apiGet<Paginated<Account>>('/accounts', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function getAccountingPeriod(
  organizationId: string,
  periodId: string,
  signal?: AbortSignal,
): Promise<AccountingPeriod> {
  return apiGet<AccountingPeriod>(
    `/accounting-periods/${encodeURIComponent(periodId)}`,
    {
      params: cleanParams({ organizationId }),
      ...(signal ? { signal } : {}),
    },
  );
}

export type AccountingPeriodAction = 'close' | 'reopen' | 'seal';

export function transitionAccountingPeriod(
  organizationId: string,
  periodId: string,
  action: AccountingPeriodAction,
  body: TransitionAccountingPeriodRequest,
): Promise<AccountingPeriod> {
  return apiPost<AccountingPeriod, TransitionAccountingPeriodRequest>(
    `/accounting-periods/${encodeURIComponent(periodId)}/${action}`,
    body,
    { params: cleanParams({ organizationId }) },
  );
}

export function createAccountingPeriod(
  body: CreateAccountingPeriodRequest,
): Promise<AccountingPeriod> {
  return apiPost<AccountingPeriod, CreateAccountingPeriodRequest>(
    '/accounting-periods',
    body,
  );
}

export function createAccount(body: CreateAccountRequest): Promise<Account> {
  return apiPost<Account, CreateAccountRequest>('/accounts', body);
}

export function createCodingStructureVersion(
  body: CreateCodingStructureRequest,
): Promise<CodingStructureVersion> {
  return apiPost<CodingStructureVersion, CreateCodingStructureRequest>(
    '/coding-structures',
    body,
  );
}

export function publishCodingStructureVersion(
  organizationId: string,
  id: string,
): Promise<CodingStructureVersion> {
  return apiPost<CodingStructureVersion, Record<string, never>>(
    `/coding-structures/${encodeURIComponent(id)}/publish`,
    {},
    { params: { organizationId } },
  );
}

export function createAccountingConfiguration(
  body: CreateAccountingConfigurationRequest,
): Promise<AccountingConfiguration> {
  return apiPost<AccountingConfiguration, CreateAccountingConfigurationRequest>(
    '/accounting-configurations',
    body,
  );
}

export function publishAccountingConfiguration(
  organizationId: string,
  id: string,
): Promise<AccountingConfiguration> {
  return apiPost<AccountingConfiguration, Record<string, never>>(
    `/accounting-configurations/${encodeURIComponent(id)}/publish`,
    {},
    { params: { organizationId } },
  );
}

export function listCodingStructureVersions(
  query: CodingStructureListQuery,
  signal?: AbortSignal,
): Promise<Paginated<CodingStructureVersion>> {
  return apiGet<Paginated<CodingStructureVersion>>('/coding-structures', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function listAccountingConfigurations(
  query: AccountingConfigurationListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AccountingConfiguration>> {
  return apiGet<Paginated<AccountingConfiguration>>(
    '/accounting-configurations',
    {
      params: cleanParams({ ...query }),
      ...(signal ? { signal } : {}),
    },
  );
}

/** Active coding structure, or null when the organization has none (404). */
export async function getActiveCodingStructure(
  organizationId: string,
  signal?: AbortSignal,
): Promise<CodingStructureVersion | null> {
  try {
    return await apiGet<CodingStructureVersion>('/coding-structures/active', {
      params: { organizationId },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Active accounting configuration, or null when none exists (404). */
export async function getActiveAccountingConfiguration(
  organizationId: string,
  signal?: AbortSignal,
): Promise<AccountingConfiguration | null> {
  try {
    return await apiGet<AccountingConfiguration>(
      '/accounting-configurations/active',
      {
        params: { organizationId },
        ...(signal ? { signal } : {}),
      },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function getAccount(
  organizationId: string,
  accountId: string,
  signal?: AbortSignal,
): Promise<Account> {
  return apiGet<Account>(`/accounts/${encodeURIComponent(accountId)}`, {
    params: { organizationId },
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Chart Tree (Task 19, ODR-2) — read-only, fixed code-ascending order
// ---------------------------------------------------------------------------

export function listChartTree(
  params: Pick<ChartTreeQuery, 'organizationId'> & {
    page?: number;
    pageSize?: number;
  },
  signal?: AbortSignal,
): Promise<Paginated<ChartTreeNode>> {
  return apiGet<Paginated<ChartTreeNode>>('/accounting/chart-tree', {
    params: cleanParams({
      organizationId: params.organizationId,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? MAX_PAGE_SIZE,
      // No `sort`: the chart-tree order is FIXED (code ascending) and an
      // explicit sort is rejected with 400.
    }),
    ...(signal ? { signal } : {}),
  });
}

export interface ChartTreePagesResult {
  nodes: ChartTreeNode[];
  total: number;
  /** True when the chart is larger than the bounded page fan-out. */
  truncated: boolean;
}

/**
 * Read the chart tree for nesting.
 *
 * Nesting a parent/child structure needs the nodes of the subtree, and the
 * contract only offers a flat, code-ascending page (`pageSize` ≤ 500). This
 * helper therefore walks pages in order up to a HARD bound
 * (`CHART_TREE_MAX_PAGES`) and reports `truncated` instead of looping
 * unbounded over an arbitrarily large chart.
 */
export async function fetchChartTreePages(
  organizationId: string,
  signal?: AbortSignal,
): Promise<ChartTreePagesResult> {
  const nodes: ChartTreeNode[] = [];
  let page = 1;
  let total = 0;

  for (; page <= CHART_TREE_MAX_PAGES; page += 1) {
    // Sequential on purpose: the next page is only requested when the
    // previous one proved there are more rows, so a small chart costs exactly
    // one request and a large one is never fanned out in parallel.
    // oxlint-disable-next-line no-await-in-loop
    const result = await listChartTree(
      { organizationId, page, pageSize: MAX_PAGE_SIZE },
      signal,
    );
    total = result.total;
    nodes.push(...result.items);
    if (result.items.length === 0 || nodes.length >= result.total) break;
  }

  return { nodes, total, truncated: nodes.length < total };
}

// ---------------------------------------------------------------------------
// Account Statement (Task 17B) — one account, one fiscal year
// ---------------------------------------------------------------------------

export function getAccountStatement(
  query: AccountStatementQuery,
  signal?: AbortSignal,
): Promise<AccountStatement> {
  return apiGet<AccountStatement>('/accounting/account-statements', {
    // No `sort`: the statement order is fixed and an explicit sort is a 400.
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// General Ledger / Trial Balance (Task 18) — server-paged, allow-listed sort
// ---------------------------------------------------------------------------

export function listGeneralLedger(
  query: GeneralLedgerQuery,
  signal?: AbortSignal,
): Promise<Paginated<GeneralLedgerRow>> {
  return apiGet<Paginated<GeneralLedgerRow>>('/accounting/general-ledger', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function listTrialBalance(
  query: TrialBalanceQuery,
  signal?: AbortSignal,
): Promise<Paginated<TrialBalanceRow>> {
  return apiGet<Paginated<TrialBalanceRow>>('/accounting/trial-balance', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Accounting documents — the voucher lifecycle (FE-UX-08)
//
// One function per EXISTING endpoint of `AccountingDocumentsController`. The
// lifecycle is exactly the backend's: compose (`manual` origin only — the HTTP
// surface composes manual documents), read, edit (draft/temporary), issue
// (draft → temporary), finalize (temporary → final), reverse (final → new
// final counter-document) and discard (draft/temporary). No reopen, no void:
// those endpoints do not exist and are never simulated here.
// ---------------------------------------------------------------------------

/** Sort fields the documents list endpoint allow-lists server-side. */
export const ACCOUNTING_DOCUMENT_SORT_FIELDS = [
  'documentDate',
  'documentNumber',
  'createdAt',
  'updatedAt',
] as const;

export function listAccountingDocuments(
  query: AccountingDocumentListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AccountingDocument>> {
  return apiGet<Paginated<AccountingDocument>>('/accounting-documents', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function getAccountingDocument(
  organizationId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<AccountingDocument> {
  return apiGet<AccountingDocument>(
    `/accounting-documents/${encodeURIComponent(documentId)}`,
    {
      params: { organizationId },
      ...(signal ? { signal } : {}),
    },
  );
}

export function createAccountingDocument(
  body: CreateAccountingDocumentInput,
): Promise<AccountingDocument> {
  return apiPost<AccountingDocument, CreateAccountingDocumentInput>(
    '/accounting-documents',
    body,
  );
}

export function updateAccountingDocument(
  organizationId: string,
  documentId: string,
  body: UpdateAccountingDocumentInput,
): Promise<AccountingDocument> {
  return apiPatch<AccountingDocument, UpdateAccountingDocumentInput>(
    `/accounting-documents/${encodeURIComponent(documentId)}`,
    body,
    { params: { organizationId } },
  );
}

export function issueAccountingDocument(
  organizationId: string,
  documentId: string,
  body: DocumentTransitionInput,
): Promise<AccountingDocument> {
  return apiPost<AccountingDocument, DocumentTransitionInput>(
    `/accounting-documents/${encodeURIComponent(documentId)}/issue`,
    body,
    {
      params: { organizationId },
      vardenaRequestActivity: { message: 'processing' },
    },
  );
}

export function finalizeAccountingDocument(
  organizationId: string,
  documentId: string,
  body: DocumentTransitionInput,
): Promise<AccountingDocument> {
  return apiPost<AccountingDocument, DocumentTransitionInput>(
    `/accounting-documents/${encodeURIComponent(documentId)}/finalize`,
    body,
    {
      params: { organizationId },
      vardenaRequestActivity: { message: 'processing' },
    },
  );
}

export function reverseAccountingDocument(
  organizationId: string,
  documentId: string,
  body: ReverseAccountingDocumentInput,
): Promise<AccountingDocument> {
  return apiPost<AccountingDocument, ReverseAccountingDocumentInput>(
    `/accounting-documents/${encodeURIComponent(documentId)}/reverse`,
    body,
    {
      params: { organizationId },
      vardenaRequestActivity: { message: 'processing' },
    },
  );
}

export function deleteAccountingDocument(
  organizationId: string,
  documentId: string,
): Promise<AccountingDocument> {
  return apiDelete<AccountingDocument>(
    `/accounting-documents/${encodeURIComponent(documentId)}`,
    { params: { organizationId } },
  );
}

export type AccountingDetailRecord = AccountingDetail;

/**
 * Postable detail options for a line's detail picker (server-filtered by the
 * endpoint's own `search` parameter; group membership is validated by the
 * backend on submit).
 */
export function listPostableDetails(
  params: { organizationId: string; search?: string | undefined },
  signal?: AbortSignal,
): Promise<Paginated<AccountingDetail>> {
  return apiGet<Paginated<AccountingDetail>>('/details', {
    params: cleanParams({
      organizationId: params.organizationId,
      isPostable: true,
      isActive: true,
      search: params.search,
      page: 1,
      pageSize: 50,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

/** One detail record — the reference read behind a document line's detail. */
export function getDetailRecord(
  organizationId: string,
  detailId: string,
  signal?: AbortSignal,
): Promise<AccountingDetail> {
  return apiGet<AccountingDetail>(`/details/${encodeURIComponent(detailId)}`, {
    params: { organizationId },
    ...(signal ? { signal } : {}),
  });
}

/** The exact line payload the compose/edit endpoints accept. */
export function toDocumentLineInputs(
  lines: readonly {
    accountId: string;
    detailId: string;
    debitAmount: string;
    creditAmount: string;
    description: string;
  }[],
): AccountingDocumentLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    ...(line.detailId === '' ? {} : { detailId: line.detailId }),
    // The contract wants BOTH sides as non-negative decimal strings; an empty
    // input is the `0` side, and a negative amount is written as the opposite
    // side, never as a sign (§13.2).
    debitAmount: line.debitAmount.trim() === '' ? '0' : line.debitAmount.trim(),
    creditAmount:
      line.creditAmount.trim() === '' ? '0' : line.creditAmount.trim(),
    ...(line.description.trim() === ''
      ? {}
      : { description: line.description.trim() }),
  }));
}
