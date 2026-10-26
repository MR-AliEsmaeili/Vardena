import { describe, expect, it } from 'vitest';
import { navigationSections } from './navigation';
import { PERMISSIONS } from '@/features/permissions/permission-codes';

const section = (id: string) =>
  navigationSections.find((item) => item.id === id);
const route = (path: string) =>
  navigationSections
    .flatMap((item) => item.items)
    .find((item) => item.to === path);

describe('accounting information architecture', () => {
  it('groups charting masters, documents, reports and settings separately', () => {
    expect(section('accounting')?.items.map((item) => item.to)).toEqual([
      '/app/accounting',
      '/app/accounting/chart',
      '/app/accounting/accounts',
      '/app/accounting/configurations',
      '/app/accounting/coding-structures',
      '/app/accounting/detail-structures',
      '/app/accounting/details',
    ]);
    expect(
      section('accounting-documents')?.items.map((item) => item.to),
    ).toEqual(['/app/accounting/documents', '/app/accounting/document-lines']);
    expect(section('accounting-reports')?.items.map((item) => item.to)).toEqual(
      [
        '/app/accounting/account-statements',
        '/app/accounting/general-ledger',
        '/app/accounting/trial-balance',
      ],
    );
    expect(
      section('accounting-settings')?.items.map((item) => item.to),
    ).toEqual([
      '/app/accounting/financial-areas',
      '/app/accounting/fiscal-years',
      '/app/accounting/periods',
    ]);
    expect(route('/app/accounting')?.hubOnly).toBe(true);
  });

  it('uses backend view permissions for supported accounting routes', () => {
    expect(route('/app/accounting/documents')?.permissions).toEqual([
      PERMISSIONS.accounting.documentView,
    ]);
    expect(route('/app/accounting/financial-areas')?.permissions).toEqual([
      PERMISSIONS.accounting.financialAreaView,
    ]);
    expect(route('/app/accounting/fiscal-years')?.permissions).toEqual([
      PERMISSIONS.accounting.fiscalYearView,
    ]);
    expect(route('/app/accounting/periods')?.permissions).toEqual([
      PERMISSIONS.accounting.accountingPeriodView,
    ]);
    expect(route('/app/accounting/chart')?.permissions).toEqual([
      PERMISSIONS.accounting.accountView,
    ]);
    expect(route('/app/accounting/accounts')?.permissions).toEqual([
      PERMISSIONS.accounting.accountView,
    ]);
    expect(route('/app/accounting/coding-structures')?.permissions).toEqual([
      PERMISSIONS.accounting.codingStructureView,
    ]);
    expect(route('/app/accounting/detail-structures')?.permissions).toEqual([
      PERMISSIONS.accounting.detailStructureView,
    ]);
    expect(route('/app/accounting/details')?.permissions).toEqual([
      PERMISSIONS.accounting.detailView,
    ]);
  });

  it('does not expose unsupported Treasury, Sales or Purchasing workspaces', () => {
    const paths = navigationSections
      .flatMap((item) => item.items)
      .map((item) => item.to)
      .join(' ');
    expect(paths).not.toMatch(/treasury|sales|purchasing/);
  });
});
