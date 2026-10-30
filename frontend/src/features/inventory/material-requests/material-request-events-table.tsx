import type { MaterialRequestEvent } from '@/api/contracts';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card } from '@/ui/card';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/ui/table';
import { useMaterialRequestEvents } from './material-request-hooks';

/**
 * The append-only lifecycle narrative (`GET …/:id/events`): unpaged, already
 * ordered `occurredAt asc` by the server, every timestamp an Instant rendered
 * through the shared formatter in the organization's zone.
 */
export function MaterialRequestEvents({
  organizationId,
  requestId,
}: {
  organizationId: string;
  requestId: string;
}) {
  const eventsQuery = useMaterialRequestEvents(organizationId, requestId);

  if (eventsQuery.isPending) {
    return <LoadingState rows={4} label={t.app.loading} />;
  }
  if (eventsQuery.isError) {
    return (
      <ApiErrorAlert
        error={eventsQuery.error}
        title={t.materialRequests.eventsLoadFailed}
        description={t.materialRequests.eventsLoadFailed}
        onRetry={() => void eventsQuery.refetch()}
      />
    );
  }

  const events = eventsQuery.data ?? [];
  if (events.length === 0) {
    return (
      <EmptyState
        title={t.materialRequests.events}
        description={t.materialRequests.eventsEmpty}
      />
    );
  }

  return (
    <Card className="p-4" data-testid="material-request-events">
      <h2 className="mb-3 text-sm font-semibold text-ink">
        {t.materialRequests.events}
      </h2>
      <TableWrapper>
        <Table>
          <caption className="sr-only">{t.materialRequests.events}</caption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t.materialRequests.events}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.fromStatus}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.toStatus}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.actor}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.reason}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.occurredAt}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => (
              <TableRow
                key={event.id}
                data-testid={`material-request-event-${event.id}`}
              >
                <TableCell>
                  {t.materialRequests.eventTypes[event.eventType]}
                </TableCell>
                <TableCell>
                  {statusLabel(event.fromStatus, t.app.none)}
                </TableCell>
                <TableCell>{statusLabel(event.toStatus, t.app.none)}</TableCell>
                <TableCell>
                  {event.actorId === null ? (
                    t.app.none
                  ) : (
                    <span className="code" dir="ltr">
                      {event.actorId}
                    </span>
                  )}
                </TableCell>
                <TableCell>{event.reason ?? t.app.none}</TableCell>
                <TableCell>
                  <span dir="ltr" title={event.occurredAt}>
                    {formatDateTimeWithZone(event.occurredAt)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>
    </Card>
  );
}

function statusLabel(
  status: MaterialRequestEvent['fromStatus'],
  fallback: string,
): string {
  return status === null ? fallback : t.materialRequests.statuses[status];
}
