import type { ChartTreeNode } from '@/api/contracts';

export interface ChartTreeItem {
  node: ChartTreeNode;
  children: ChartTreeItem[];
}

/**
 * Nest the flat chart-tree page into a hierarchy.
 *
 * The endpoint returns FLAT nodes in a fixed code-ascending order with a
 * `parentId`/`level` pair (Task 19, ODR-2); nesting them for display is
 * presentation, not accounting logic — no code is parsed, no level is
 * inferred and no node is created, removed or reordered beyond the order the
 * API already returned.
 *
 * A node whose parent is absent from the loaded window (possible when the
 * fan-out is truncated) is surfaced as a root so it is never silently
 * dropped.
 */
export function buildChartTree(
  nodes: readonly ChartTreeNode[],
): ChartTreeItem[] {
  const items = new Map<string, ChartTreeItem>();
  for (const node of nodes) {
    items.set(node.id, { node, children: [] });
  }

  const roots: ChartTreeItem[] = [];
  for (const node of nodes) {
    const item = items.get(node.id);
    if (item === undefined) continue;

    const parentId = node.parentId;
    const parent = parentId === null ? undefined : items.get(parentId);
    if (parent === undefined) {
      roots.push(item);
    } else {
      parent.children.push(item);
    }
  }

  return roots;
}

/** Ids of every node that has children (used by "expand all"). */
export function collectExpandableIds(
  items: readonly ChartTreeItem[],
): string[] {
  const ids: string[] = [];
  const walk = (list: readonly ChartTreeItem[]): void => {
    for (const item of list) {
      if (item.children.length > 0) {
        ids.push(item.node.id);
        walk(item.children);
      }
    }
  };
  walk(items);
  return ids;
}
