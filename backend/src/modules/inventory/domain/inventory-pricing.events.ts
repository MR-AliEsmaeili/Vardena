import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

/**
 * Periodic Pricing Operation events (C-59E, OD-PRC-05/OD-PDP-01…05) and its
 * reverse (C-59E+, OD-RVP-01…08).
 *
 * Published on the in-process bus AFTER the batch transaction commits — an
 * event never claims success for a rolled-back run. Identifiers, scope and
 * counters only: no money, no per-movement detail (the run report is the
 * auditable record, read through the API).
 */

interface PricingEvent<TType extends string, TPayload> extends DomainEvent {
  type: TType;
  aggregateType: 'InventoryPricingRun';
  aggregateId: string;
  payload: TPayload;
}

export interface InventoryPricingRunPayload {
  id: string;
  organizationId: string;
  /** NULL = all warehouses (OD-PRC-06). */
  warehouseId: string | null;
  documentKinds: string[];
  fromDate: string | null;
  toDate: string;
  kind: 'pricing_operation' | 'reverse_pricing';
  /** Set on a compensating run: the run it reverses (OD-RVP-01). */
  reversesRunId: string | null;
  keysExamined: number;
  keysPriced: number;
  keysFailed: number;
  movementsExamined: number;
  movementsRevalued: number;
  operationKey: string;
}

export const INVENTORY_PRICING_RUN_COMPLETED_EVENT =
  'InventoryPricingRun.Completed' as const;
export const INVENTORY_PRICING_RUN_REVERSED_EVENT =
  'InventoryPricingRun.Reversed' as const;

export type InventoryPricingRunCompletedEvent = PricingEvent<
  typeof INVENTORY_PRICING_RUN_COMPLETED_EVENT,
  InventoryPricingRunPayload
>;

export type InventoryPricingRunReversedEvent = PricingEvent<
  typeof INVENTORY_PRICING_RUN_REVERSED_EVENT,
  InventoryPricingRunPayload
>;
