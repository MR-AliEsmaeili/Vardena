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
import { MaterialRequestDecisionActions } from './material-request-decision-actions';
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
 * One request, read-only record: identity, the decision trail (who approved,
 * rejected, returned or reversed, when, and why), lines exactly as the server
 * stored them, and the append-only event narrative.
 *
 * The commands are the AUTHORING ones (INV-06) plus the five approval-cycle
 * decisions (INV-07); each area decides its own visibility from the status,
 * the held permissions and the domain rules.
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
          <div className="flex flex-wrap items-center gap-2">
            <MaterialRequestDecisionActions
              organizationId={organizationId}
              request={request}
            />
            <MaterialRequestActions
              organizationId={organizationId}
              request={request}
            />
          </div>
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
            <DecisionActor
              label={t.materialRequests.decisions.returnedBy}
              actorId={request.returnedBy}
            />
            {request.returnReason === null ? null : (
              <DecisionReason
                label={t.materialRequests.decisions.returnReason}
                value={request.returnReason}
              />
            )}
          </Definition>
        )}
        {request.approvedAt === null ? null : (
          <Definition label={t.materialRequests.eventTypes.approved} span>
            <Timestamp dateTime={request.approvedAt} />
            <DecisionActor
              label={t.materialRequests.decisions.approvedBy}
              actorId={request.approvedBy}
            />
          </Definition>
        )}
        {request.rejectedAt === null ? null : (
          <Definition label={t.materialRequests.statuses.rejected} span>
            <Timestamp dateTime={request.rejectedAt} />
            <DecisionActor
              label={t.materialRequests.decisions.rejectedBy}
              actorId={request.rejectedBy}
            />
            {request.rejectionReason === null ? null : (
              <DecisionReason
                label={t.materialRequests.decisions.rejectionReason}
                value={request.rejectionReason}
              />
            )}
          </Definition>
        )}
        {request.approvalReversedAt === null ? null : (
          <Definition
            label={t.materialRequests.eventTypes.approval_reversed}
            span
          >
            <Timestamp dateTime={request.approvalReversedAt} />
            <DecisionActor
              label={t.materialRequests.decisions.reversedBy}
              actorId={request.approvalReversedBy}
            />
            {request.approvalReversalReason === null ? null : (
              <DecisionReason
                label={t.materialRequests.decisions.reversalReason}
                value={request.approvalReversalReason}
              />
            )}
          </Definition>
        )}
        {request.cancelledAt === null ? null : (
          <Definition label={t.materialRequests.statuses.cancelled} span>
            <Timestamp dateTime={request.cancelledAt} />
            <DecisionActor
              label={t.materialRequests.decisions.cancelledBy}
              actorId={request.cancelledBy}
            />
            {request.cancellationReason === null ? null : (
              <DecisionReason
                label={t.materialRequests.decisions.cancellationReason}
                value={request.cancellationReason}
              />
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

/**
 * Who performed a decision. `Instant` formatting is the row's job; the actor is
 * the server's user id, shown verbatim (LTR) like `requestedBy`.
 */
function DecisionActor({
  label,
  actorId,
}: {
  label: string;
  actorId: string | null;
}) {
  if (actorId === null) return null;
  return (
    <span className="block text-xs text-ink-subtle">
      {label}:{' '}
      <code className="code break-all select-all" dir="ltr">
        {actorId}
      </code>
    </span>
  );
}

/** Why a decision was taken — the server's stored text, never re-derived. */
function DecisionReason({ label, value }: { label: string; value: string }) {
  return (
    <span className="block text-xs text-ink-subtle">
      {label}: {value}
    </span>
  );
}
