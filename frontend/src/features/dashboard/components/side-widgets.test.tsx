import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatQuantity } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  testAccountingPeriod,
  testInventoryBalance,
  testWorkflowInstance,
} from '@/test/fixtures';
import {
  InventoryAlertWidget,
  PeriodStatusWidget,
  WorkflowWidget,
} from './side-widgets';

const retry = vi.fn();

beforeEach(() => retry.mockClear());

describe('WorkflowWidget states', () => {
  it('renders loading', () => {
    const { container } = render(
      <WorkflowWidget
        instances={undefined}
        isLoading
        isPermitted
        onRetry={retry}
      />,
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders permission unavailable', () => {
    render(
      <WorkflowWidget
        instances={undefined}
        isLoading={false}
        isPermitted={false}
        onRetry={retry}
      />,
    );
    expect(screen.getByText(t.dashboard.noPermission)).toBeInTheDocument();
  });

  it('renders an API error with retry instead of empty', () => {
    render(
      <WorkflowWidget
        instances={undefined}
        isLoading={false}
        isPermitted
        error={new Error('failed')}
        onRetry={retry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t.app.retry }));
    expect(retry).toHaveBeenCalled();
    expect(
      screen.queryByText(t.dashboard.approvalsEmptyTitle),
    ).not.toBeInTheDocument();
  });

  it('renders empty', () => {
    render(
      <WorkflowWidget
        instances={[]}
        isLoading={false}
        isPermitted
        onRetry={retry}
      />,
    );
    expect(
      screen.getByText(t.dashboard.approvalsEmptyTitle),
    ).toBeInTheDocument();
  });

  it('renders success', () => {
    render(
      <WorkflowWidget
        instances={[testWorkflowInstance]}
        isLoading={false}
        isPermitted
        onRetry={retry}
      />,
    );
    expect(screen.getByText(testWorkflowInstance.entityId)).toBeInTheDocument();
  });
});

describe('InventoryAlertWidget states and semantics', () => {
  it('renders loading', () => {
    const { container } = render(
      <InventoryAlertWidget
        balances={undefined}
        isLoading
        isPermitted
        onRetry={retry}
      />,
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders permission unavailable', () => {
    render(
      <InventoryAlertWidget
        balances={undefined}
        isLoading={false}
        isPermitted={false}
        onRetry={retry}
      />,
    );
    expect(screen.getByText(t.dashboard.noPermission)).toBeInTheDocument();
  });

  it('renders an API error with retry instead of empty', () => {
    render(
      <InventoryAlertWidget
        balances={undefined}
        isLoading={false}
        isPermitted
        error={new Error('failed')}
        onRetry={retry}
      />,
    );
    expect(
      screen.getByRole('button', { name: t.app.retry }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.dashboard.inventoryEmptyTitle),
    ).not.toBeInTheDocument();
  });

  it('renders empty', () => {
    render(
      <InventoryAlertWidget
        balances={[]}
        isLoading={false}
        isPermitted
        onRetry={retry}
      />,
    );
    expect(
      screen.getByText(t.dashboard.inventoryEmptyTitle),
    ).toBeInTheDocument();
  });

  it('renders the backend on-hand field matching the ordering semantics', () => {
    render(
      <InventoryAlertWidget
        balances={[testInventoryBalance]}
        isLoading={false}
        isPermitted
        onRetry={retry}
      />,
    );
    expect(screen.getByText(t.dashboard.inventorySubtitle)).toBeInTheDocument();
    expect(screen.getByText(formatQuantity('100'))).toBeInTheDocument();
  });
});

describe('PeriodStatusWidget states', () => {
  const successPeriods = [
    {
      id: testAccountingPeriod.id,
      sequence: testAccountingPeriod.sequence,
      title: testAccountingPeriod.title,
      status: testAccountingPeriod.status,
      isCurrent: true,
    },
  ];

  it('renders permission unavailable', () => {
    render(
      <PeriodStatusWidget
        periods={undefined}
        isLoading={false}
        isPermitted={false}
        onRetry={retry}
      />,
    );
    expect(screen.getByText(t.dashboard.noPermission)).toBeInTheDocument();
  });

  it('renders an API error with retry', () => {
    render(
      <PeriodStatusWidget
        periods={undefined}
        isLoading={false}
        error={new Error('failed')}
        onRetry={retry}
      />,
    );
    expect(
      screen.getByRole('button', { name: t.app.retry }),
    ).toBeInTheDocument();
  });

  it('renders empty', () => {
    render(
      <PeriodStatusWidget periods={[]} isLoading={false} onRetry={retry} />,
    );
    expect(screen.getByText(t.dashboard.periodEmptyTitle)).toBeInTheDocument();
  });

  it('renders success', () => {
    render(
      <PeriodStatusWidget
        periods={successPeriods}
        isLoading={false}
        onRetry={retry}
      />,
    );
    expect(screen.getByText(t.dashboard.periodOpen)).toBeInTheDocument();
  });
});
