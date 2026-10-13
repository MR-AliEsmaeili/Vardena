import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChartTreeNode } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { renderWithProviders } from '@/test/test-utils';
import { ChartTreeNodeRow } from './chart-tree-node-row';

function makeItem(accountNature: ChartTreeNode['accountNature']) {
  const node: ChartTreeNode = {
    id: `acc-${accountNature}`,
    organizationId: 'org-1',
    code: '1010',
    title: 'موجودی نقد',
    parentId: null,
    level: 2,
    codingStructureVersionId: null,
    accountingConfigurationId: null,
    accountNature,
    isPostable: true,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  } as ChartTreeNode;
  return { node, children: [] };
}

describe('ChartTreeNodeRow nature badge (OD-29-01 tri-state)', () => {
  it.each([
    ['DEBIT', t.chartTree.natureDebit],
    ['CREDIT', t.chartTree.natureCredit],
    ['DUAL', t.chartTree.natureDual],
  ] as const)('renders the %s nature label', (nature, label) => {
    renderWithProviders(
      <ul>
        <ChartTreeNodeRow
          item={makeItem(nature)}
          depth={0}
          expandedIds={new Set()}
          onToggle={() => undefined}
        />
      </ul>,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders the inactive badge only for inactive nodes', () => {
    const item = makeItem('DEBIT');
    renderWithProviders(
      <ul>
        <ChartTreeNodeRow
          item={item}
          depth={0}
          expandedIds={new Set()}
          onToggle={() => undefined}
        />
      </ul>,
    );

    expect(screen.queryByText(t.chartTree.inactive)).not.toBeInTheDocument();
  });
});
