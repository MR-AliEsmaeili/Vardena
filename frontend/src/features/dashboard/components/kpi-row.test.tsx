import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { testAccountBalances } from '@/test/fixtures';
import { KpiRow } from './kpi-row';

describe('KpiRow', () => {
  it('labels and measures the fourth KPI as periods with turnover', () => {
    render(
      <KpiRow
        balances={[
          ...testAccountBalances,
          {
            ...testAccountBalances[0]!,
            id: 'bal-3',
            accountId: 'acc-4',
          },
        ]}
        isLoading={false}
      />,
    );

    const label = screen.getByText(t.dashboard.kpiPeriodsWithTurnover);
    const card = label.closest('div');
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent('1');
  });
});
