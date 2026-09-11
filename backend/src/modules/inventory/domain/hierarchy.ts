/**
 * Hierarchy rules for `inventory.item_groups`.
 *
 * Mirrors `modules/organization/domain/hierarchy.ts` (departments) — see the
 * note in this module's `master-data.ts` about why the two copies exist.
 *
 * An item group tree is a reporting/defaults classification
 * (master-data-strategy.md §3.2), not a universal category or tag system: one
 * nullable parent id, three validation rules, nothing else.
 *
 * Framework-free (AR-05).
 */

export type HierarchyProblem =
  | 'self_parent'
  | 'cross_organization'
  | 'cycle';

export interface HierarchyCheckInput {
  id: string;
  parentId: string | null;
  organizationId: string;
  parent: { organizationId: string } | null;
  descendantIds: readonly string[];
}

export function findHierarchyProblem(
  input: HierarchyCheckInput,
): HierarchyProblem | null {
  if (input.parentId === null) return null;
  if (input.parentId === input.id) return 'self_parent';
  if (
    input.parent !== null &&
    input.parent.organizationId !== input.organizationId
  ) {
    return 'cross_organization';
  }
  if (input.descendantIds.includes(input.parentId)) return 'cycle';
  return null;
}

export interface HierarchyEdge {
  id: string;
  parentId: string | null;
}

/** All descendant ids of `rootId` (root excluded). */
export function collectDescendantIds(
  edges: readonly HierarchyEdge[],
  rootId: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.parentId === null) continue;
    const siblings = childrenOf.get(edge.parentId);
    if (siblings === undefined) childrenOf.set(edge.parentId, [edge.id]);
    else siblings.push(edge.id);
  }

  const result: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [...(childrenOf.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}
