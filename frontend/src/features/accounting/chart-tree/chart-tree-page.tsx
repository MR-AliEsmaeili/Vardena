import { useMemo, useState } from 'react';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertBody } from '@/ui/alert';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { buildChartTree, collectExpandableIds } from './build-chart-tree';
import { ChartTreeNodeRow } from './chart-tree-node-row';
import { useChartTree } from './use-chart-tree';

/** Read-only chart of accounts (Task 19 chart-tree endpoint). */
export function ChartTreePage() {
  const organizationId = useOrganizationId();
  const chartTreeQuery = useChartTree(organizationId);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const nodes = useMemo(
    () => chartTreeQuery.data?.nodes ?? [],
    [chartTreeQuery.data],
  );
  const roots = useMemo(() => buildChartTree(nodes), [nodes]);
  const expandableIds = useMemo(() => collectExpandableIds(roots), [roots]);

  const toggle = (nodeId: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.chartTree.title}
        description={t.chartTree.subtitle}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={expandableIds.length === 0}
              onClick={() => setExpandedIds(new Set(expandableIds))}
            >
              {t.chartTree.expandAll}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={expandedIds.size === 0}
              onClick={() => setExpandedIds(new Set<string>())}
            >
              {t.chartTree.collapseAll}
            </Button>
          </>
        }
      />

      {chartTreeQuery.isError ? (
        <ApiErrorAlert
          error={chartTreeQuery.error}
          title={t.table.errorTitle}
          onRetry={() => void chartTreeQuery.refetch()}
        />
      ) : chartTreeQuery.isPending ? (
        <LoadingState rows={8} />
      ) : roots.length === 0 ? (
        <EmptyState
          title={t.chartTree.emptyTitle}
          description={t.chartTree.emptyBody}
        />
      ) : (
        <>
          {chartTreeQuery.data.truncated && (
            <Alert variant="warning">
              <AlertBody>{t.chartTree.truncatedNotice}</AlertBody>
            </Alert>
          )}
          <div className="rounded-lg border border-slate-200 bg-white p-2">
            <p className="px-2 pb-2 text-xs text-slate-500">
              <span className="num">{formatCount(nodes.length)}</span>{' '}
              {t.chartTree.nodesLoaded}
              {chartTreeQuery.data.total > nodes.length && (
                <>
                  {' '}
                  /{' '}
                  <span className="num">
                    {formatCount(chartTreeQuery.data.total)}
                  </span>
                </>
              )}
            </p>
            <ul>
              {roots.map((item) => (
                <ChartTreeNodeRow
                  key={item.node.id}
                  item={item}
                  depth={0}
                  expandedIds={expandedIds}
                  onToggle={toggle}
                />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
