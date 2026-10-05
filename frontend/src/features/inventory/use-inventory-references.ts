import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listInventoryItems,
  listInventoryUnits,
  listInventoryWarehouses,
} from '@/api/inventory.api';
import { queryKeys } from '@/api/query-keys';
import type {
  InventoryItem,
  InventoryUnit,
  InventoryWarehouse,
} from '@/api/contracts';

/**
 * Reference reads for the inventory pickers and tables.
 *
 * One query per entity per organization (small, slow-moving master data —
 * standards.md §5 keeps these out of URL state). Each hook is enabled only
 * while the organization scope is resolved, and each key carries the
 * organization id so a scope switch can never serve another organization's
 * master data from the cache.
 *
 * The permissions that gate the underlying endpoints
 * (`Inventory.Warehouse.View` / `Inventory.Item.View` / `Inventory.Unit.View`)
 * are enforced by the backend; a 403 here surfaces as a query error the
 * caller renders in its own way.
 */

export interface InventoryReferences {
  warehouses: InventoryWarehouse[];
  items: InventoryItem[];
  units: InventoryUnit[];
  isLoading: boolean;
  /** True when at least one of the three reads failed. */
  isFailed: boolean;
  /** Retry every failed reference read. */
  refetch: () => void;
  warehouseById: (id: string) => InventoryWarehouse | undefined;
  itemById: (id: string) => InventoryItem | undefined;
  unitById: (id: string) => InventoryUnit | undefined;
}

export function useInventoryReferences(
  organizationId: string | null,
): InventoryReferences {
  const warehousesQuery = useQuery({
    queryKey: queryKeys.inventory.warehouses(organizationId ?? 'none'),
    queryFn: ({ signal }) =>
      listInventoryWarehouses(
        { organizationId: organizationId as string },
        signal,
      ),
    enabled: organizationId !== null,
    staleTime: 5 * 60_000,
  });
  const itemsQuery = useQuery({
    queryKey: queryKeys.inventory.items(organizationId ?? 'none'),
    queryFn: ({ signal }) =>
      listInventoryItems({ organizationId: organizationId as string }, signal),
    enabled: organizationId !== null,
    staleTime: 5 * 60_000,
  });
  const unitsQuery = useQuery({
    queryKey: queryKeys.inventory.units(organizationId ?? 'none'),
    queryFn: ({ signal }) =>
      listInventoryUnits({ organizationId: organizationId as string }, signal),
    enabled: organizationId !== null,
    staleTime: 5 * 60_000,
  });

  // Extracted first so the memo below depends on plain values (the query
  // objects themselves are new every render; their fields are stable).
  const warehousePages = warehousesQuery.data;
  const itemPages = itemsQuery.data;
  const unitPages = unitsQuery.data;
  const warehousesLoading = warehousesQuery.isPending;
  const itemsLoading = itemsQuery.isPending;
  const unitsLoading = unitsQuery.isPending;
  const warehousesFailed = warehousesQuery.isError;
  const itemsFailed = itemsQuery.isError;
  const unitsFailed = unitsQuery.isError;
  const refetchWarehouses = warehousesQuery.refetch;
  const refetchItems = itemsQuery.refetch;
  const refetchUnits = unitsQuery.refetch;

  return useMemo(() => {
    const warehouses = warehousePages?.items ?? [];
    const items = itemPages?.items ?? [];
    const units = unitPages?.items ?? [];
    const warehouseMap = new Map(warehouses.map((row) => [row.id, row]));
    const itemMap = new Map(items.map((row) => [row.id, row]));
    const unitMap = new Map(units.map((row) => [row.id, row]));
    return {
      warehouses,
      items,
      units,
      isLoading: warehousesLoading || itemsLoading || unitsLoading,
      isFailed: warehousesFailed || itemsFailed || unitsFailed,
      refetch: () => {
        void refetchWarehouses();
        void refetchItems();
        void refetchUnits();
      },
      warehouseById: (id: string) => warehouseMap.get(id),
      itemById: (id: string) => itemMap.get(id),
      unitById: (id: string) => unitMap.get(id),
    };
  }, [
    warehousePages,
    itemPages,
    unitPages,
    warehousesLoading,
    itemsLoading,
    unitsLoading,
    warehousesFailed,
    itemsFailed,
    unitsFailed,
    refetchWarehouses,
    refetchItems,
    refetchUnits,
  ]);
}
