import { describe, expect, it } from 'vitest';
import { navigationSections } from './navigation';
import { PERMISSIONS } from '@/features/permissions/permission-codes';

const accounting = navigationSections.find(
  (section) => section.id === 'accounting',
);

describe('accounting information architecture', () => {
  it('exposes supported master-data routes with actual view permissions', () => {
    expect(accounting?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: '/app/accounting/documents',
          permissions: [PERMISSIONS.accounting.documentView],
        }),
        expect.objectContaining({
          to: '/app/accounting/financial-areas',
          permissions: [PERMISSIONS.accounting.financialAreaView],
        }),
        expect.objectContaining({
          to: '/app/accounting/fiscal-years',
          permissions: [PERMISSIONS.accounting.fiscalYearView],
        }),
        expect.objectContaining({
          to: '/app/accounting/periods',
          permissions: [PERMISSIONS.accounting.accountingPeriodView],
        }),
        expect.objectContaining({
          to: '/app/accounting/chart',
          permissions: [PERMISSIONS.accounting.accountView],
        }),
        expect.objectContaining({
          to: '/app/accounting/accounts',
          permissions: [PERMISSIONS.accounting.accountView],
        }),
      ]),
    );
  });

  it('does not expose unsupported Treasury, Sales or Purchasing workspaces', () => {
    const paths = accounting?.items.map((item) => item.to).join(' ') ?? '';
    expect(paths).not.toMatch(/treasury|sales|purchasing/);
  });
});
