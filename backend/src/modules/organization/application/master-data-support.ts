import { AppException } from '../../../kernel/errors/app-exception.js';
import { getCorrelationId } from '../../../kernel/correlation/request-context.js';
import type {
  DomainEvent,
  DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import type { OrderBy } from '../data/master-data-rows.js';
import type { HierarchyProblem } from '../domain/hierarchy.js';
import {
  isNonBlank,
  MAX_CODE_LENGTH,
  MAX_NAME_LENGTH,
} from '../domain/master-data.js';

/**
 * Small helpers shared by the Organization module's application services.
 *
 * They exist so that every master-data service behaves identically for the
 * three things that must not drift between entities: sort whitelisting,
 * event publication, and the "inactive record cannot anchor a new record"
 * rule. None of them is a business rule of its own — the rules live in
 * `domain/`, and the services decide when to apply them.
 */

/**
 * Translate a validated `sort` query string into a Prisma `orderBy`, rejecting
 * any field the endpoint does not declare (architecture.md §9: unknown sort
 * fields are rejected by the module, never passed to the query builder).
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
 * The lifecycle rule from master-data-strategy.md §7.4: disabling "blocks new
 * usage". Applied consistently, that means an inactive record cannot be the
 * owner/parent/base of a record being *created*, and cannot be *reassigned*
 * onto an existing record.
 *
 * An existing record whose owner/parent was disabled afterwards is untouched:
 * re-validating activity on every unrelated edit would make historical
 * structures uneditable, which §7.4 explicitly does not want. Services
 * therefore pass `allowInactive: true` when the reference is unchanged.
 */
export function assertUsable(
  entityLabel: string,
  isActive: boolean,
  options: { allowInactive: boolean },
): void {
  if (!isActive && !options.allowInactive) {
    throw AppException.businessRule(
      `${entityLabel} is disabled and cannot be used for new records.`,
    );
  }
}

/**
 * The shared "code + name" write rule for the code/name master-data entities.
 *
 * Only two rules are applied — non-blank and the column width. The repository
 * defines no business-code format anywhere (docs/database-strategy.md §4
 * refuses to invent numbering — OQ-12), so no format regex is imposed here.
 */
export function assertCodeAndName(code: string, name: string): void {
  if (!isNonBlank(code) || code.length > MAX_CODE_LENGTH) {
    throw AppException.badRequest(
      `Code is required and must be at most ${MAX_CODE_LENGTH} characters.`,
    );
  }
  if (!isNonBlank(name) || name.length > MAX_NAME_LENGTH) {
    throw AppException.badRequest(
      `Name is required and must be at most ${MAX_NAME_LENGTH} characters.`,
    );
  }
}

/**
 * Human-readable message for a hierarchy rejection. The three rules are the
 * only hierarchy validation that exists (see `domain/hierarchy.ts`) — no depth
 * limit, no level policy, no restructuring workflow.
 */
export function hierarchyProblemMessage(
  label: string,
  problem: HierarchyProblem,
): string {
  switch (problem) {
    case 'self_parent':
      return `A ${label} cannot be its own parent.`;
    case 'cross_organization':
      return `The parent ${label} belongs to a different organization.`;
    case 'cycle':
      return `The parent ${label} is a descendant of this ${label}; that would create a cycle.`;
  }
}
