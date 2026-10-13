import { AppException } from '../../../kernel/errors/app-exception.js';
import { getCorrelationId } from '../../../kernel/correlation/request-context.js';
import type {
  DomainEvent,
  DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { MAX_ALLOCATION_KEY_LENGTH } from '../domain/numbering.js';
import { MAX_SCOPE_KEY_LENGTH } from '../domain/numbering.js';
import {
  MAX_MODULE_NAME_LENGTH,
  MAX_DOCUMENT_TYPE_CODE_LENGTH,
} from '../domain/document-type.js';

/**
 * Small helpers shared by the Document Foundation's application services.
 * None is a business rule of its own — they keep event publication, allocation
 * keys and logical references uniform across the module's services.
 */

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
 * Validate a client-supplied allocation key (Task 8 §17). Keys are REQUIRED:
 * without one, a retry could never be told apart from a new intent, and the
 * numbering ledger must never hand out two serials for one logical document.
 */
export function requireAllocationKey(value: string): string {
  const key = value.trim();
  if (key === '') {
    throw AppException.badRequest('An allocationKey is required.');
  }
  if (key.length > MAX_ALLOCATION_KEY_LENGTH) {
    throw AppException.badRequest(
      `allocationKey must be at most ${MAX_ALLOCATION_KEY_LENGTH} characters.`,
    );
  }
  return key;
}

export interface NormalizedReference {
  referenceModule: string | null;
  referenceDocumentType: string | null;
  referenceDocumentId: string | null;
}

/**
 * Normalize the optional logical reference of a number allocation
 * (all-or-nothing). The reference points at a business document the Foundation
 * does not dereference — it is stored for audit and inspection only.
 */
export function normalizeReference(input: {
  referenceModule?: string | null | undefined;
  referenceDocumentType?: string | null | undefined;
  referenceDocumentId?: string | null | undefined;
}): NormalizedReference {
  const module = input.referenceModule?.trim() ?? '';
  const type = input.referenceDocumentType?.trim() ?? '';
  const id = input.referenceDocumentId?.trim() ?? '';
  if (module === '' && type === '' && id === '') {
    return {
      referenceModule: null,
      referenceDocumentType: null,
      referenceDocumentId: null,
    };
  }
  if (module === '' || type === '' || id === '') {
    throw AppException.badRequest(
      'referenceModule, referenceDocumentType and referenceDocumentId must be set together.',
    );
  }
  if (module.length > MAX_MODULE_NAME_LENGTH) {
    throw AppException.badRequest(
      `referenceModule must be at most ${MAX_MODULE_NAME_LENGTH} characters.`,
    );
  }
  if (type.length > MAX_DOCUMENT_TYPE_CODE_LENGTH) {
    throw AppException.badRequest(
      `referenceDocumentType must be at most ${MAX_DOCUMENT_TYPE_CODE_LENGTH} characters.`,
    );
  }
  return {
    referenceModule: module,
    referenceDocumentType: type,
    referenceDocumentId: id,
  };
}

/** Validate a scope key (empty = the type's default series). */
export function requireScopeKey(value: string | null | undefined): string {
  const key = value === undefined || value === null ? '' : value.trim();
  if (key.length > MAX_SCOPE_KEY_LENGTH) {
    throw AppException.badRequest(
      `scopeKey must be at most ${MAX_SCOPE_KEY_LENGTH} characters.`,
    );
  }
  return key;
}
