import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { normalizeApiError } from '@/api/errors';
import type { AccountingDocument } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import {
  useOrganization,
  useOrganizationId,
} from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { AmountCell } from '@/ui/patterns/amount-cell';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/ui/table';
import { Definition, DefinitionList } from '../master-data/master-data-ui';
import {
  useAccountingPeriods,
  useFinancialAreas,
  useFiscalYears,
} from '../shared/use-accounting-references';
import {
  DocumentActionDialog,
  type DialogKind,
} from './document-action-dialogs';
import {
  computeDocumentActions,
  documentOriginLabel,
  documentStatePresentation,
  isReversedDocument,
  parseDocumentState,
  type DocumentState,
} from './document-lifecycle';
import {
  AccountCodeLabel,
  AccountLabel,
  BranchLabel,
  DetailLabel,
  NoneLabel,
} from './document-reference-labels';
import { useDocumentDetail } from './use-document-detail';

/**
 * Document view (FE-UX-08 §7): an ERP-style read of one accounting document —
 * header, relations, lines and backend-owned totals — plus the lifecycle
 * actions the CURRENT STATE + SESSION PERMISSIONS make applicable.
 *
 * What the page deliberately does NOT do: decide accounting eligibility. The
 * finalize/reverse buttons only reflect state + permission; the backend
 * re-validates the composition, the accounts and the fiscal calendar inside
 * its own locked transaction, and its answer is the truth.
 */
export function DocumentDetailPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { organization: currentOrganization } = useOrganization();
  const permissions = usePermissions();
  const { documentId } = useParams<{ documentId: string }>();
  const query = useDocumentDetail(organizationId, documentId);
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  if (query.isPending) {
    return <LoadingState rows={8} label={t.app.loading} />;
  }

  if (query.error !== null) {
    const apiError = normalizeApiError(query.error);
    if (apiError.isNotFound) {
      return (
        <div className="space-y-4">
          <PageHeader title={t.documents.detailTitle} />
          <Alert variant="warning" role="alert">
            <AlertTitle>{t.documents.notFoundTitle}</AlertTitle>
            <AlertBody>
              <p>{t.documents.notFoundBody}</p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link to="/app/accounting/documents">
                  {t.documents.backToList}
                </Link>
              </Button>
            </AlertBody>
          </Alert>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <PageHeader title={t.documents.detailTitle} />
        <ApiErrorAlert
          error={query.error}
          title={t.documents.loadDocumentFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const document = query.data;
  const state = parseDocumentState(document.state);
  const actions =
    state !== null && permissions.loaded
      ? computeDocumentActions(
          state,
          {
            edit: permissions.has(PERMISSIONS.accounting.documentEdit),
            delete: permissions.has(PERMISSIONS.accounting.documentDelete),
            finalize: permissions.has(PERMISSIONS.accounting.documentFinalize),
            reverse: permissions.has(PERMISSIONS.accounting.documentReverse),
          },
          isReversedDocument(document),
        )
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          document.documentNumber !== null
            ? `${t.documents.detailTitle} ${document.documentNumber}`
            : t.documents.detailTitle
        }
        description={
          state !== null ? (
            <Badge variant={documentStatePresentation[state].variant}>
              {documentStatePresentation[state].label}
            </Badge>
          ) : (
            <span className="code text-xs">{document.state}</span>
          )
        }
        actions={
          actions !== null ? (
            <DocumentActions
              documentId={document.id}
              actions={actions}
              onOpenDialog={setDialog}
            />
          ) : null
        }
      />

      <DocumentFacts
        organizationId={organizationId ?? 'none'}
        organizationName={
          currentOrganization?.id === document.organizationId
            ? (currentOrganization?.name ?? null)
            : null
        }
        document={document}
        state={state}
      />

      <DocumentLines
        organizationId={organizationId ?? 'none'}
        lines={document.lines}
        totalDebit={document.totalDebit}
        totalCredit={document.totalCredit}
      />

      <DocumentActionDialog
        kind={dialog}
        onClose={() => setDialog(null)}
        organizationId={organizationId ?? 'none'}
        documentId={document.id}
        documentNumber={document.documentNumber}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

function DocumentActions({
  documentId,
  actions,
  onOpenDialog,
}: {
  documentId: string;
  actions: ReturnType<typeof computeDocumentActions>;
  onOpenDialog: (kind: DialogKind) => void;
}): ReactElement {
  return (
    <>
      {actions.edit === 'available' && (
        <Button type="button" size="sm" variant="outline" asChild>
          <Link
            to={`/app/accounting/documents/${encodeURIComponent(documentId)}/edit`}
          >
            {t.documents.edit}
          </Link>
        </Button>
      )}
      {actions.issue === 'available' && (
        <Button type="button" size="sm" onClick={() => onOpenDialog('issue')}>
          {t.documents.issue}
        </Button>
      )}
      {actions.finalize === 'available' && (
        <Button
          type="button"
          size="sm"
          onClick={() => onOpenDialog('finalize')}
        >
          {t.documents.finalize}
        </Button>
      )}
      {actions.reverse === 'available' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onOpenDialog('reverse')}
        >
          {t.documents.reverse}
        </Button>
      )}
      {actions.delete === 'available' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onOpenDialog('delete')}
        >
          {t.documents.delete}
        </Button>
      )}
      {actions.edit === 'forbidden' && (
        <DisabledAction
          label={t.documents.edit}
          explanation={t.documents.noPermissionEdit}
        />
      )}
      {actions.issue === 'forbidden' && (
        <DisabledAction
          label={t.documents.issue}
          explanation={t.documents.noPermissionIssue}
        />
      )}
      {actions.finalize === 'forbidden' && (
        <DisabledAction
          label={t.documents.finalize}
          explanation={t.documents.noPermissionFinalize}
        />
      )}
      {actions.reverse === 'forbidden' && (
        <DisabledAction
          label={t.documents.reverse}
          explanation={t.documents.noPermissionReverse}
        />
      )}
      {actions.delete === 'forbidden' && (
        <DisabledAction
          label={t.documents.delete}
          explanation={t.documents.noPermissionDelete}
        />
      )}
    </>
  );
}

/**
 * A state-appropriate action the session lacks the permission for: rendered
 * disabled with its explanation (FE-UX-02 §8.2 — discoverable, honest, never
 * a security boundary; the backend authorizes the request itself).
 */
function DisabledAction({
  label,
  explanation,
}: {
  label: string;
  explanation: string;
}): ReactElement {
  const explanationId = `disabled-action-${label.replace(/[\s\u200c]+/gu, '-')}`;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        title={explanation}
        aria-describedby={explanationId}
      >
        {label}
      </Button>
      <span id={explanationId} className="sr-only">
        {explanation}
      </span>
    </>
  );
}

// -----------------------------------------------------------------------------
// Facts
// -----------------------------------------------------------------------------

function DocumentFacts({
  organizationId,
  organizationName,
  document,
  state,
}: {
  organizationId: string;
  organizationName: string | null;
  document: AccountingDocument;
  state: DocumentState | null;
}): ReactElement {
  const areasQuery = useFinancialAreas(organizationId);
  const yearsQuery = useFiscalYears(organizationId, document.financialAreaId);
  const periodsQuery = useAccountingPeriods(
    organizationId,
    document.fiscalYearId,
  );

  const area = areasQuery.data?.items.find(
    (candidate) => candidate.id === document.financialAreaId,
  );
  const year = yearsQuery.data?.items.find(
    (candidate) => candidate.id === document.fiscalYearId,
  );
  const period = periodsQuery.data?.items.find(
    (candidate) => candidate.id === document.accountingPeriodId,
  );

  return (
    <section aria-label={t.documents.headerSection} className="space-y-3">
      <DefinitionList>
        <Definition label={t.documents.number}>
          {document.documentNumber !== null ? (
            <span className="code">{document.documentNumber}</span>
          ) : (
            <NoneLabel />
          )}
        </Definition>
        <Definition label={t.documents.state}>
          {state !== null ? (
            <Badge variant={documentStatePresentation[state].variant}>
              {documentStatePresentation[state].label}
            </Badge>
          ) : (
            <span className="code text-xs">{document.state}</span>
          )}
        </Definition>
        <Definition label={t.documents.date}>
          <span className="code">{document.documentDate}</span>
        </Definition>
        <Definition label={t.documents.documentType}>
          {t.documents.documentTypeVoucher}
        </Definition>
        <Definition label={t.documents.origin}>
          {documentOriginLabel(document.origin)}
        </Definition>
        <Definition label={t.documents.organization}>
          {organizationName ?? (
            <span className="code text-xs">{document.organizationId}</span>
          )}
        </Definition>
        <Definition label={t.documents.area}>
          {area !== undefined ? (
            `${area.code} — ${area.title}`
          ) : (
            <span className="code text-xs">{document.financialAreaId}</span>
          )}
        </Definition>
        <Definition label={t.documents.year}>
          {year !== undefined ? (
            `${year.code} — ${year.title}`
          ) : (
            <span className="code text-xs">{document.fiscalYearId}</span>
          )}
        </Definition>
        <Definition label={t.documents.period}>
          {period !== undefined ? (
            `${period.sequence} — ${period.title}`
          ) : (
            <span className="code text-xs">{document.accountingPeriodId}</span>
          )}
        </Definition>
        {document.branchId !== null && (
          <Definition label={t.documents.branch}>
            <BranchLabel
              organizationId={organizationId}
              branchId={document.branchId}
            />
          </Definition>
        )}
        <Definition label={t.documents.lineDescription}>
          {document.description}
        </Definition>
        <Definition label={t.statement.postingTimestamp}>
          <span className="code">{formatDateTime(document.createdAt)}</span>
        </Definition>
      </DefinitionList>

      {(document.reversesDocumentId !== null ||
        document.reversedByDocumentId !== null) && (
        <section
          aria-label={t.documents.referencesSection}
          className="space-y-1 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900"
        >
          {document.reversedByDocumentId !== null && (
            <p>
              {t.documents.reversedBy}:{' '}
              <DocumentLink documentId={document.reversedByDocumentId} />
            </p>
          )}
          {document.reversesDocumentId !== null && (
            <p>
              {t.documents.reverses}:{' '}
              <DocumentLink documentId={document.reversesDocumentId} />
            </p>
          )}
        </section>
      )}
    </section>
  );
}

function DocumentLink({ documentId }: { documentId: string }): ReactElement {
  return (
    <Link
      className="font-medium underline underline-offset-2"
      to={`/app/accounting/documents/${encodeURIComponent(documentId)}`}
    >
      <span className="code">{documentId}</span>
    </Link>
  );
}

// -----------------------------------------------------------------------------
// Lines
// -----------------------------------------------------------------------------

function DocumentLines({
  organizationId,
  lines,
  totalDebit,
  totalCredit,
}: {
  organizationId: string;
  lines: AccountingDocument['lines'];
  totalDebit: string;
  totalCredit: string;
}): ReactElement {
  return (
    <section aria-label={t.documents.linesSection} className="space-y-2">
      <h2 className="text-sm font-bold text-slate-800">
        {t.documents.linesSection}
      </h2>
      <TableWrapper>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className="w-12">
                {t.documents.lineNo}
              </TableHeaderCell>
              <TableHeaderCell>{t.documents.accountCode}</TableHeaderCell>
              <TableHeaderCell>{t.documents.accountTitle}</TableHeaderCell>
              <TableHeaderCell>{t.documents.detail}</TableHeaderCell>
              <TableHeaderCell>{t.documents.lineDescription}</TableHeaderCell>
              <TableHeaderCell className="text-end">
                {t.documents.debit}
              </TableHeaderCell>
              <TableHeaderCell className="text-end">
                {t.documents.credit}
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => {
              const detailId = line.detailId ?? null;
              return (
                <TableRow key={line.id}>
                  <TableCell>
                    <span className="num">{line.lineNo}</span>
                  </TableCell>
                  <TableCell>
                    <AccountCodeLabel
                      organizationId={organizationId}
                      accountId={line.accountId}
                    />
                  </TableCell>
                  <TableCell>
                    <AccountLabel
                      organizationId={organizationId}
                      accountId={line.accountId}
                    />
                  </TableCell>
                  <TableCell>
                    {detailId !== null ? (
                      <DetailLabel
                        organizationId={organizationId}
                        detailId={detailId}
                      />
                    ) : (
                      <NoneLabel />
                    )}
                  </TableCell>
                  <TableCell>{line.description ?? t.app.none}</TableCell>
                  <TableCell className="text-end">
                    <AmountCell value={line.debitAmount} />
                  </TableCell>
                  <TableCell className="text-end">
                    <AmountCell value={line.creditAmount} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5}>
                {t.documents.totalDebit} / {t.documents.totalCredit}
              </TableCell>
              <TableCell className="text-end">
                <AmountCell value={totalDebit} />
              </TableCell>
              <TableCell className="text-end">
                <AmountCell value={totalCredit} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableWrapper>
    </section>
  );
}
