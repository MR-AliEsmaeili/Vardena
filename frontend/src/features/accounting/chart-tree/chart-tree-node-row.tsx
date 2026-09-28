import { ChevronDown, ChevronLeft } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';
import type { ChartTreeNode } from '@/api/contracts';
import type { ChartTreeItem } from './build-chart-tree';

/**
 * Badge variant and label for every account nature the API contract
 * declares (OD-29-01: DEBIT | CREDIT | DUAL).
 *
 * The mapping is a `Record` over the contract union, so the compiler fails
 * the build if the backend vocabulary ever changes — no silent fallthrough
 * that could mislabel an account's balance direction.
 */
const NATURE_BADGE: Record<
  ChartTreeNode['accountNature'],
  { variant: 'info' | 'warning' | 'neutral'; label: string }
> = {
  DEBIT: { variant: 'info', label: t.chartTree.natureDebit },
  CREDIT: { variant: 'warning', label: t.chartTree.natureCredit },
  DUAL: { variant: 'neutral', label: t.chartTree.natureDual },
};

export interface ChartTreeNodeRowProps {
  item: ChartTreeItem;
  depth: number;
  expandedIds: ReadonlySet<string>;
  onToggle: (nodeId: string) => void;
}

/**
 * One chart-tree row and its expanded subtree.
 *
 * Read-only by contract: the surface exposes no create/edit/move action, and
 * the row shows only fields the API returns.
 */
export function ChartTreeNodeRow({
  item,
  depth,
  expandedIds,
  onToggle,
}: ChartTreeNodeRowProps) {
  const { node, children } = item;
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const nature = NATURE_BADGE[node.accountNature];

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50',
          !node.isActive && 'opacity-60',
        )}
        style={{ paddingInlineStart: `${depth * 1.25 + 0.5}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
            aria-expanded={isExpanded}
            aria-label={
              isExpanded ? t.chartTree.collapseAll : t.chartTree.expandAll
            }
            onClick={() => onToggle(node.id)}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : (
          <span className="h-6 w-6" aria-hidden />
        )}

        <span className="code w-32 shrink-0 font-medium text-slate-700">
          {node.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-slate-900">
          {node.title}
        </span>

        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <Badge variant="neutral">
            {t.chartTree.level} <span className="num">{node.level}</span>
          </Badge>
          <Badge variant={nature.variant}>{nature.label}</Badge>
          <Badge variant={node.isPostable ? 'success' : 'neutral'}>
            {node.isPostable ? t.chartTree.postable : t.chartTree.aggregation}
          </Badge>
          {!node.isActive && (
            <Badge variant="danger">{t.chartTree.inactive}</Badge>
          )}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <ul>
          {children.map((child) => (
            <ChartTreeNodeRow
              key={child.node.id}
              item={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
