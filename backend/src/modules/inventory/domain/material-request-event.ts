/**
 * Material Request event — the append-only lifecycle narrative for one
 * request (C-50: "preserve audit trail of approval and reversal", and the
 * Owner's later decision: "preserve an auditable history of the return and
 * subsequent resubmission").
 *
 * A narrow, typed-column audit trail — NOT a generic audit framework and NOT
 * bound to the Workflow module (no production module in this codebase
 * consumes Workflow today; implementing the Material Request lifecycle
 * directly here, with its own narrow event log, satisfies "reuse Workflow
 * where appropriate" by not duplicating a generic engine nobody else uses
 * either).
 *
 * Resubmission after a return for correction does NOT get its own event
 * type: it reuses `submitted`, distinguished from a first submission by
 * `fromStatus` (`'returned'` instead of `'draft'`) — the row already carries
 * everything needed to tell the two apart, and every row is append-only, so
 * a request returned and resubmitted multiple times has the full cycle
 * history, not just the latest cycle.
 *
 * Framework-free (AR-05).
 */

export const MATERIAL_REQUEST_EVENT_TYPES = [
  'created',
  'submitted',
  'returned_for_correction',
  'approved',
  'rejected',
  'approval_reversed',
  'cancelled',
  'line_invoked',
] as const;


export type MaterialRequestEventType =
  (typeof MATERIAL_REQUEST_EVENT_TYPES)[number];

export function isMaterialRequestEventType(
  value: string,
): value is MaterialRequestEventType {
  return (MATERIAL_REQUEST_EVENT_TYPES as readonly string[]).includes(value);
}

export interface MaterialRequestEvent {
  id: string;
  materialRequestId: string;
  organizationId: string;
  eventType: MaterialRequestEventType;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  reason: string | null;
  referenceId: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface MaterialRequestEventDto {
  id: string;
  materialRequestId: string;
  organizationId: string;
  eventType: MaterialRequestEventType;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  reason: string | null;
  referenceId: string | null;
  occurredAt: string;
  createdAt: string;
}

export function toMaterialRequestEventDto(
  event: MaterialRequestEvent,
): MaterialRequestEventDto {
  return {
    id: event.id,
    materialRequestId: event.materialRequestId,
    organizationId: event.organizationId,
    eventType: event.eventType,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorId: event.actorId,
    reason: event.reason,
    referenceId: event.referenceId,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
}
