import { AppException } from '../../../kernel/errors/app-exception.js';
import { getCorrelationId } from '../../../kernel/correlation/request-context.js';
import type {
  DomainEvent,
  DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import type { OrderBy } from '../data/workflow-rows.js';
import {
  WorkflowApprovalPendingError,
  WorkflowApprovalStaleError,
  WorkflowExecutionError,
  WorkflowVersionLockedError,
} from '../data/workflow-errors.js';
import { transitionExecutionProblemMessage } from '../domain/workflow-transition.js';

/**
 * Small helpers shared by the Workflow Foundation's application services.
 *
 * Sort whitelisting, event publication and transaction-error mapping must
 * not drift between services — none of them is a business rule of its own.
 * The rules live in `domain/`; the services decide when to apply them.
 */

/**
 * Translate a validated `sort` query string into a Prisma `orderBy`,
 * rejecting any field the endpoint does not declare (architecture.md §9).
 */
export function resolveSort(
  sort: string | undefined,
  sortableFields: Record<string, string>,
  fallback: OrderBy,
): OrderBy {
  if (sort === undefined || sort === '') return fallback;
  return sort.split(',').map((entry) => {
    const [field, direction] = entry.split(':');
    const mapped = field === undefined ? undefined : sortableFields[field];
    if (mapped === undefined || (direction !== 'asc' && direction !== 'desc')) {
      throw AppException.validation([
        {
          field: 'sort',
          message: `Cannot sort by "${field ?? ''}". Allowed: ${Object.keys(sortableFields).join(', ')}.`,
          code: 'isSortableField',
        },
      ]);
    }
    return { [mapped]: direction };
  });
}

/** Publish a domain event with the ambient correlation id and a timestamp. */
export function publishEvent(
  events: DomainEventBus,
  event: Omit<DomainEvent, 'correlationId' | 'occurredAt'>,
): Promise<void> {
  return events.publish({
    ...event,
    correlationId: getCorrelationId(),
    occurredAt: Date.now(),
  });
}

/**
 * Map a data-layer transaction failure onto a stable API error. Every
 * workflow transaction throws one of these (or a Prisma error the service
 * maps separately); anything else propagates as an internal error.
 *
 * - `not_in_source_state` → 409: the workflow moved under the caller — the
 *   concurrency loser's signal, retryable after re-reading. (The approval
 *   REQUEST path overrides this to 422: a fresh request for an unavailable
 *   transition is client validation, not a race.)
 * - every other execution problem → 422: the transition is structurally
 *   invalid from here.
 * - stale approvals → 422; duplicate pending approvals and lost
 *   draft-vs-publish races → 409.
 */
export function mapExecutionError(
  error: unknown,
  options: { staleStateStatus?: 'conflict' | 'businessRule' } = {},
): never {
  if (error instanceof WorkflowExecutionError) {
    if (error.problem === 'not_in_source_state') {
      if (options.staleStateStatus === 'businessRule') {
        throw AppException.businessRule(
          transitionExecutionProblemMessage(error.problem),
        );
      }
      throw AppException.conflict(
        'The workflow moved while the request was in flight. Re-read the current state and retry.',
      );
    }
    if (error.problem === 'permission_denied') {
      // Defense in depth: the service enforces the permission BEFORE
      // entering the transaction, so this branch only triggers for direct
      // repository callers. Same outcome as the guard either way.
      throw AppException.forbidden();
    }
    throw AppException.businessRule(
      transitionExecutionProblemMessage(error.problem),
    );
  }
  if (error instanceof WorkflowApprovalStaleError) {
    throw AppException.businessRule(error.message);
  }
  if (error instanceof WorkflowApprovalPendingError) {
    throw AppException.conflict(error.message);
  }
  if (error instanceof WorkflowVersionLockedError) {
    throw AppException.conflict(
      'The workflow version was published while the request was in flight. Re-read the version and retry against a draft.',
    );
  }
  throw error;
}
