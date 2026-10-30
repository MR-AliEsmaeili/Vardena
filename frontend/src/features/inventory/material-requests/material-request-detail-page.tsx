import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import type { MaterialRequestStatus } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { Definition, DefinitionList } from '@/ui/patterns/definition-list';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { useInventoryReferences } from '../use-inventory-references';
import { MaterialRequestActions } from './material-request-actions';
import { MaterialRequestEvents } from './material-request-events-table';
import { useMaterialRequest } from './material-request-hooks';
import { MaterialRequestLinesTable } from './material-request-lines-table';
import { isMaterialRequestEditable } from './material-request-status';

const STATUS_VARIANT: Record<
  MaterialRequestStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'danger'
> = {
  draft: 'neutral',
  submitted: 'info',
  returned: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/**
 * One request, read-only record: identity, lifecycle timestamps, lines exactly
 * as the server stored them, and the append-only event narrative. The only
 * commands are the AUTHORING ones (INV-06) — approval lives in INV-07.
 */
export function MaterialRequestDetailPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { requestId } = useParams<{ requestId: string }>();
  const references = useInventoryReferences(organizationId);
  const requestQuery = useMaterialRequest(organizationId, requestId);

  if (organizationId === null || requestQuery.isPending) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  if (requestQuery.isError) {
    return (
      <div className="space-y-4">
        <MaterialRequestDetailHeader />
        <ApiErrorAlert
          error={requestQuery.error}
          title={t.materialRequests.detailLoadFailed}
          description={t.materialRequests.detailLoadFailed}
          onRetry={() => void requestQuery.refetch()}
        />
      </div>
    );
  }

  const request = requestQuery.data;
  if (request === undefined) {
    return (
      <EmptyState
        title={t.errors.notFound}
        description={t.materialRequests.detailNotFound}
      />
    );
  }

  const editable = isMaterialRequestEditable(request.status);

  return (
    <div className="space-y-4" data-testid="material-request-detail-page">
      <FormPageHeader
        title={t.materialRequests.detailTitle}
        description={
          request.number ?? `${t.materialRequests.draftNumber} — ${request.id}`
        }
        meta={
          <Badge variant={STATUS_VARIANT[request.status]}>
            {t.materialRequests.statuses[request.status]}
          </Badge>
        }
        actions={
          <MaterialRequestActions
            organizationId={organizationId}
            request={request}
          />
        }
      />

      {references.isFailed ? (
        <Alert
          variant="warning"
          data-testid="material-request-references-unavailable"
        >
          <AlertTitle>{t.materialRequests.referencesUnavailable}</AlertTitle>
          <AlertBody>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>{t.materialRequests.referencesUnavailable}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={references.refetch}
              >
                {t.app.retry}
              </Button>
            </div>
          </AlertBody>
        </Alert>
      ) : null}

      {!editable ? (
        <Alert variant="info" data-testid="material-request-readonly-banner">
          <AlertTitle>{t.materialRequests.readonlyTitle}</AlertTitle>
          <AlertBody>
            <p>{t.materialRequests.notEditable}</p>
          </AlertBody>
        </Alert>
      ) : null}

      <DefinitionList columns={3}>
        <Definition label={t.materialRequests.number}>
          {request.number === null ? (
            <span className="text-ink-subtle">
              {t.materialRequests.draftNumber}
            </span>
          ) : (
            <code className="code" dir="ltr">
              {request.number}
            </code>
          )}
        </Definition>
        <Definition label={t.materialRequests.status}>
          <Badge variant={STATUS_VARIANT[request.status]}>
            {t.materialRequests.statuses[request.status]}
          </Badge>
        </Definition>
        <Definition label={t.materialRequests.requestedBy}>
          <code className="code break-all select-all" dir="ltr">
            {request.requestedBy}
          </code>
        </Definition>
        <Definition label={t.materialRequests.description} span>
          {request.description ?? t.app.none}
        </Definition>
        <Definition label={t.materialRequests.createdAt}>
          <Timestamp dateTime={request.createdAt} />
        </Definition>
        <Definition label={t.materialRequests.updatedAt}>
          <Timestamp dateTime={request.updatedAt} />
        </Definition>
        {request.submittedAt === null ? null : (
          <Definition label={t.materialRequests.eventTypes.submitted}>
            <Timestamp dateTime={request.submittedAt} />
          </Definition>
        )}
        {request.returnedAt === null ? null : (
          <Definition label={t.materialRequests.statuses.returned} span>
            <Timestamp dateTime={request.returnedAt} />
            {request.returnReason === null ? null : (
              <span className="block text-xs text-ink-subtle">
                {t.materialRequests.reason}: {request.returnReason}
              </span>
            )}
          </Definition>
        )}
        {request.approvedAt === null ? null : (
          <Definition label={t.materialRequests.eventTypes.approved}>
            <Timestamp dateTime={request.approvedAt} />
          </Definition>
        )}
        {request.rejectedAt === null ? null : (
          <Definition label={t.materialRequests.statuses.rejected} span>
            <Timestamp dateTime={request.rejectedAt} />
            {request.rejectionReason === null ? null : (
              <span className="block text-xs text-ink-subtle">
                {t.materialRequests.reason}: {request.rejectionReason}
              </span>
            )}
          </Definition>
        )}
        {request.approvalReversedAt === null ? null : (
          <Definition
            label={t.materialRequests.eventTypes.approval_reversed}
            span
          >
            <Timestamp dateTime={request.approvalReversedAt} />
            {request.approvalReversalReason === null ? null : (
              <span className="block text-xs text-ink-subtle">
                {t.materialRequests.reason}: {request.approvalReversalReason}
              </span>
            )}
          </Definition>
        )}
        {request.cancelledAt === null ? null : (
          <Definition label={t.materialRequests.statuses.cancelled} span>
            <Timestamp dateTime={request.cancelledAt} />
            {request.cancellationReason === null ? null : (
              <span className="block text-xs text-ink-subtle">
                {t.materialRequests.reason}: {request.cancellationReason}
              </span>
            )}
          </Definition>
        )}
      </DefinitionList>

      <MaterialRequestLinesTable
        lines={request.lines}
        references={references}
      />

      <MaterialRequestEvents
        organizationId={organizationId}
        requestId={request.id}
      />
    </div>
  );
}

function MaterialRequestDetailHeader() {
  return (
    <FormPageHeader
      title={t.materialRequests.detailTitle}
      description={t.materialRequests.subtitle}
    />
  );
}

function Timestamp({ dateTime }: { dateTime: string }) {
  return (
    <span dir="ltr" title={dateTime}>
      {formatDateTimeWithZone(dateTime)}
    </span>
  );
}
