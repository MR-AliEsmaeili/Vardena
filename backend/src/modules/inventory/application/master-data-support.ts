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
 * Small helpers shared by the Inventory module's master-data services.
 *
 * Mirrors `modules/organization/application/master-data-support.ts`; the two
 * copies exist for the module-boundary reason explained in this module's
 * `domain/master-data.ts`. Keeping sort whitelisting, event publication and the
 * lifecycle rules identical across the two modules matters more than avoiding
 * ~60 duplicated lines.
 */

/**
 * Translate a validated `sort` query string into a Prisma `orderBy`, rejecting
 * any field the endpoint does not declare (architecture.md §9).
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
 * master-data-strategy.md §7.4: disabling "blocks new usage". An inactive
 * record cannot anchor a record being created, and cannot be reassigned onto an
 * existing record. An existing record whose reference was disabled afterwards
 * stays editable — services pass `allowInactive: true` when the reference is
 * unchanged.
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
 * The shared "code + name" write rule. Column widths differ per entity
 * (`units.code` is 32 characters, everything else 64), so the caller states
 * them. No business-code format is invented (OQ-12/OQ-36).
 */
export function assertCodeAndName(
  code: string,
  name: string,
  limits: { maxCodeLength?: number; maxNameLength?: number } = {},
): void {
  const maxCodeLength = limits.maxCodeLength ?? MAX_CODE_LENGTH;
  const maxNameLength = limits.maxNameLength ?? MAX_NAME_LENGTH;
  if (!isNonBlank(code) || code.length > maxCodeLength) {
    throw AppException.badRequest(
      `Code is required and must be at most ${maxCodeLength} characters.`,
    );
  }
  if (!isNonBlank(name) || name.length > maxNameLength) {
    throw AppException.badRequest(
      `Name is required and must be at most ${maxNameLength} characters.`,
    );
  }
}

/** Message for a hierarchy rejection (see `domain/hierarchy.ts`). */
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
