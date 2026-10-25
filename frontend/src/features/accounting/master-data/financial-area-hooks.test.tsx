import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import { testFinancialArea, testOrganization } from '@/test/fixtures';
import { createTestQueryClient } from '@/test/test-utils';
import {
  useCreateFinancialAreaMutation,
  useFinancialAreaLifecycleMutation,
  useUpdateFinancialAreaMutation,
} from './financial-area-hooks';

vi.mock('@/api/accounting.api', () => ({
  getFinancialArea: vi.fn(),
  createFinancialArea: vi.fn(),
  updateFinancialArea: vi.fn(),
  enableFinancialArea: vi.fn(),
  disableFinancialArea: vi.fn(),
}));

const accountingApi = await import('@/api/accounting.api');

const organizationId = testOrganization.id;

function setup() {
  const queryClient = createTestQueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, wrapper };
}

/**
 * After every confirmed mutation the hooks must invalidate the
 * financial-area prefix AND the `financialAreas` reference read (the two
 * currently resolve to the same tuple, so that tuple must be invalidated at
 * least twice), plus the financial-context gate read — otherwise the
 * administration list could be fresh while the context switcher still
 * offers a disabled area or a stale default (ACC-01 §5.5).
 */
function expectFinancialAreaInvalidations(
  invalidateSpy: ReturnType<typeof setup>['invalidateSpy'],
) {
  const keys = invalidateSpy.mock.calls.map(
    (call) => (call[0] as { queryKey?: readonly unknown[] }).queryKey,
  );
  const prefix = queryKeys.accounting.financialAreaPrefix(organizationId);
  expect(keys).toContainEqual(prefix);
  expect(keys).toContainEqual(
    queryKeys.accounting.financialAreas(organizationId),
  );
  expect(keys).toContainEqual(
    queryKeys.accounting.financialContextAreas(organizationId),
  );
  const prefixCalls = keys.filter(
    (key) => JSON.stringify(key) === JSON.stringify(prefix),
  );
  expect(prefixCalls.length).toBeGreaterThanOrEqual(2);
}

describe('financial-area mutation hooks (ACC-01)', () => {
  it('create forwards { organizationId, code, title } and invalidates', async () => {
    vi.mocked(accountingApi.createFinancialArea).mockResolvedValue(
      testFinancialArea,
    );
    const { invalidateSpy, wrapper } = setup();
    const { result } = renderHook(
      () => useCreateFinancialAreaMutation(organizationId),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        code: testFinancialArea.code,
        title: testFinancialArea.title,
      });
    });

    expect(accountingApi.createFinancialArea).toHaveBeenCalledWith({
      organizationId,
      code: testFinancialArea.code,
      title: testFinancialArea.title,
    });
    expectFinancialAreaInvalidations(invalidateSpy);
  });

  it('update is bound to the area id and invalidates', async () => {
    vi.mocked(accountingApi.updateFinancialArea).mockResolvedValue(
      testFinancialArea,
    );
    const { invalidateSpy, wrapper } = setup();
    const { result } = renderHook(
      () =>
        useUpdateFinancialAreaMutation(organizationId, testFinancialArea.id),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ isDefault: true });
    });

    expect(accountingApi.updateFinancialArea).toHaveBeenCalledWith(
      organizationId,
      testFinancialArea.id,
      { isDefault: true },
    );
    expectFinancialAreaInvalidations(invalidateSpy);
  });

  it('lifecycle maps { id, next } onto the enable/disable endpoints and invalidates', async () => {
    vi.mocked(accountingApi.disableFinancialArea).mockResolvedValue({
      ...testFinancialArea,
      isActive: false,
    });
    vi.mocked(accountingApi.enableFinancialArea).mockResolvedValue(
      testFinancialArea,
    );
    const { invalidateSpy, wrapper } = setup();
    const { result } = renderHook(
      () => useFinancialAreaLifecycleMutation(organizationId),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        id: testFinancialArea.id,
        next: 'disable',
      });
    });
    expect(accountingApi.disableFinancialArea).toHaveBeenCalledWith(
      organizationId,
      testFinancialArea.id,
    );
    expectFinancialAreaInvalidations(invalidateSpy);

    await act(async () => {
      await result.current.mutateAsync({
        id: testFinancialArea.id,
        next: 'enable',
      });
    });
    expect(accountingApi.enableFinancialArea).toHaveBeenCalledWith(
      organizationId,
      testFinancialArea.id,
    );
  });
});
