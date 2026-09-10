/**
 * Minimal in-process domain event bus (docs/architecture.md §5 & §8).
 *
 * In v1, domain events are dispatched synchronously within the publisher's
 * unit of work; they are also appended to `core.domain_events` for audit and
 * future replay. This file provides the thin in-memory emitter used by
 * modules today (Identity publishes lifecycle events here); consumers
 * (Audit, Notifications, Accounting, …) subscribe when their modules land.
 *
 * Design rules (AR-07, AR-15):
 * - Events are plain typed objects with a stable `type` name (`Entity.PastTenseVerb`).
 * - Subscribers must be idempotent (duplicate delivery can happen on retry).
 * - Never call external systems directly from a subscriber — enqueue an outbox
 *   row in the same transaction (AR-14).
 *
 * This bus is intentionally small. A richer outbox-aware dispatcher arrives
 * when the first transactional consumer (Audit) lands; until then it gives
 * modules a single seam to publish events without inventing parallel systems.
 */

export interface DomainEvent {
  /** PascalCase event name, e.g. `UserSession.Created`. */
  type: string;
  /** Aggregate/entity type if applicable, e.g. `UserSession`. */
  aggregateType?: string | undefined;
  /** Source entity id (ULID) if applicable. */
  aggregateId?: string | undefined;
  /** Opaque event payload. */
  payload?: unknown;
  /** Correlation id for tracing. */
  correlationId?: string | undefined;
  /** Event timestamp (epoch ms). */
  occurredAt: number;
}

export type DomainEventHandler<T extends DomainEvent = DomainEvent> = (
  event: T,
) => void | Promise<void>;

/**
 * Token used to inject the singleton event bus via Nest DI.
 */
export const DOMAIN_EVENT_BUS = Symbol('DOMAIN_EVENT_BUS');

/**
 * Minimal in-memory bus. Modules publish typed events here; subscribers
 * register at bootstrap. Keep this API tiny — it is the seam we extend
 * with persistence/outbox when the first consumer module arrives.
 */
export class DomainEventBus {
  private readonly handlers = new Map<string, Set<DomainEventHandler>>();

  /** Register a handler for a given event type. Returns an unsubscribe fn. */
  on<T extends DomainEvent>(
    type: T['type'],
    handler: DomainEventHandler<T>,
  ): () => void {
    let set = this.handlers.get(type);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as DomainEventHandler);
    return () => {
      set?.delete(handler as DomainEventHandler);
    };
  }

  /**
   * Publish an event. Listeners are invoked synchronously in registration
   * order; async rejections are caught and logged (a future version will
   * persist events in a transaction before dispatch).
   */
  async publish<T extends DomainEvent>(event: T): Promise<void> {
    const set = this.handlers.get(event.type);
    if (set === undefined) return;
    for (const handler of set) {
      try {
        await handler(event);
      } catch {
        // Swallow: a single subscriber must not break the publish path.
        // When Audit lands, this failure is itself an audit event.
      }
    }
  }
}
