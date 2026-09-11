/**
 * Hierarchy rules for self-referencing master data (`departments`,
 * `inventory.item_groups`).
 *
 * A hierarchy is an explicit self-reference, NOT a generic organization-tree
 * engine: one nullable parent id, validated with the three rules below and
 * nothing else. Restructuring workflows, level limits and depth policies are
 * deliberately absent (they are not approved anywhere in the repository).
 *
 * Framework-free (AR-05): a pure predicate the application services call
 * before writing, so the rules are unit-testable without a database.
 */

export type HierarchyProblem =
  /** A node cannot be its own parent. */
  | 'self_parent'
  /** A node and its parent must belong to the same organization. */
  | 'cross_organization'
  /** Moving a node under one of its own descendants would create a cycle. */
  | 'cycle';

export interface HierarchyCheckInput {
  /** Id of the node being created/moved. Empty for a create. */
  id: string;
  /** Requested parent id, or null for a root node. */
  parentId: string | null;
  /** Organization the node belongs to. */
  organizationId: string;
  /** The resolved parent row, or null when `parentId` is null. */
  parent: { organizationId: string } | null;
  /**
   * Ids in the subtree rooted at `id` (descendants only, `id` excluded).
   * Only consulted on an update — a new node has no descendants.
   */
  descendantIds: readonly string[];
}

/**
 * Returns the first problem found, or `null` when the parent assignment is
 * valid. Order matters only for the message the caller produces.
 */
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

/** One parent edge of a hierarchy (`{ id, parentId }`). */
export interface HierarchyEdge {
  id: string;
  parentId: string | null;
}

/**
 * All descendant ids of `rootId` (the root itself excluded), computed from the
 * organization's full edge list.
 *
 * Walking the edge list in memory instead of issuing one query per level keeps
 * this pure and testable, and organizational trees are small by nature. The
 * `seen` set also makes the walk terminate on already-corrupt data instead of
 * looping forever.
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
