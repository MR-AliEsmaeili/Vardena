/**
 * Hierarchy walk for the Accounting chart of accounts (Task 10.3, §8.2).
 *
 * A per-module copy — the same deliberate duplication Inventory and
 * Organization keep, because importing another module's `domain/` would be
 * cross-module coupling (AR-07/08). It is NOT a generic tree engine: one
 * nullable `parent_id`, the edges below, and nothing else. Tree *rules*
 * (level derivation, code prefix, postable-parent, cycles) are in
 * `domain/account.ts`, which consumes these edges.
 *
 * Framework-free (AR-05).
 */

/** One parent edge of the account tree (`{ id, parentId }`). */
export interface HierarchyEdge {
  id: string;
  parentId: string | null;
}

/**
 * All descendant ids of `rootId` (the root itself excluded), computed from the
 * organization's full edge list.
 *
 * Walking the edge list in memory instead of issuing one query per level keeps
 * this pure and testable, and charts are small by nature (bounded by
 * `MAX_CODING_STRUCTURE_DEPTH`). The `seen` set also makes the walk terminate
 * on already-corrupt data instead of looping forever.
 */
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
