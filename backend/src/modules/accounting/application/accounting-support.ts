import { AppException } from '../../../kernel/errors/app-exception.js';
import { getCorrelationId } from '../../../kernel/correlation/request-context.js';
import type {
  DomainEvent,
  DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import type { OrderBy } from '../data/accounting-rows.js';
import { ACCOUNT_CODE_PATTERN } from '../domain/account-code.js';
import { MAX_ACCOUNT_CODE_LENGTH } from '../domain/coding-structure.js';
import {
  isNonBlank,
  MAX_CODE_LENGTH,
  MAX_REASON_LENGTH,
  MAX_TITLE_LENGTH,
} from '../domain/master-data.js';

/**
 * Small helpers shared by the Accounting module's application services.
 *
 * They exist so that every accounting service behaves identically for the
 * things that must not drift between entities: sort whitelisting, event
 * publication, and the "inactive record cannot anchor a new record" rule.
 * None of them is a business rule of its own — the rules live in
 * `domain/`, and the services decide when to apply them.
 *
 * (Mirrors `organization/application/master-data-support.ts`: per-module
 * copies, never cross-module imports.)
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
 * owner of a record being *created*.
 *
 * For the calendar this is partly contract-explicit (a disabled area blocks
 * new years — contract §5.6) and partly the repo-wide rule (a disabled year
 * blocks new periods). An existing record whose owner was disabled
 * afterwards is untouched: re-validating activity on every unrelated edit
 * would make history uneditable, which §7.4 explicitly does not want.
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
 * The shared "code + title" write rule for the code/title calendar entities.
 *
 * Only two rules are applied — non-blank and the column width. The
 * repository defines no business-code format anywhere
 * (docs/database-strategy.md §4 refuses to invent numbering — OQ-12), so
 * no format regex is imposed here.
 */
export function assertCodeAndTitle(code: string, title: string): void {
  if (!isNonBlank(code) || code.length > MAX_CODE_LENGTH) {
    throw AppException.badRequest(
      `Code is required and must be at most ${MAX_CODE_LENGTH} characters.`,
    );
  }
  if (!isNonBlank(title) || title.length > MAX_TITLE_LENGTH) {
    throw AppException.badRequest(
      `Title is required and must be at most ${MAX_TITLE_LENGTH} characters.`,
    );
  }
}

/**
 * The account write rule (§9.2): a canonical digits-only code inside the
 * architecture length cap, plus the shared title rule.
 *
 * The digits-only rule is a DECIDED contract rule, not an invented numbering
 * policy: the stored code is the concatenation of the level segments and
 * nothing else. WHAT the segments are is configuration (the coding structure);
 * normalization stays trim-only like every other master-data code — no
 * separator stripping, no re-padding, no case folding.
 */
export function assertAccountCode(code: string): void {
  if (
    !isNonBlank(code) ||
    code.length > MAX_ACCOUNT_CODE_LENGTH ||
    !ACCOUNT_CODE_PATTERN.test(code)
  ) {
    throw AppException.badRequest(
      `An account code must be 1-${MAX_ACCOUNT_CODE_LENGTH} digits (no separators, letters or spaces — the separator is a display concern).`,
    );
  }
}

/** The shared "title" write rule for periods (which carry no code). */
export function assertTitle(title: string): void {
  if (!isNonBlank(title) || title.length > MAX_TITLE_LENGTH) {
    throw AppException.badRequest(
      `Title is required and must be at most ${MAX_TITLE_LENGTH} characters.`,
    );
  }
}

/**
 * Lifecycle transitions are explicit, reasoned operations (contract §6.3,
 * §7.2, §23): the reason is required evidence, carried in the transition
 * event because no history table stores it.
 */
export function assertReason(reason: string): void {
  if (!isNonBlank(reason) || reason.length > MAX_REASON_LENGTH) {
    throw AppException.badRequest(
      `Reason is required and must be at most ${MAX_REASON_LENGTH} characters.`,
    );
  }
}
