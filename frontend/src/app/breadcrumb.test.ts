import { describe, expect, it } from 'vitest';
import { breadcrumbItemsFor } from './breadcrumb';

/** The breadcrumb only ever mirrors the real navigation hierarchy. */
describe('breadcrumbItemsFor', () => {
  it('returns the full hierarchy for a nested accounting route', () => {
    expect(breadcrumbItemsFor('/app/accounting/chart')).toEqual([
      { to: '/app', label: 'میزکار' },
      { to: '/app/accounting', label: 'حسابداری' },
      { to: '/app/accounting/chart', label: 'درخت حساب‌ها' },
    ]);
  });

  it('returns the parent chain for the accounting landing route', () => {
    expect(breadcrumbItemsFor('/app/accounting')).toEqual([
      { to: '/app', label: 'میزکار' },
      { to: '/app/accounting', label: 'حسابداری' },
    ]);
  });

  it('returns a single item for the dashboard index (no fake hierarchy)', () => {
    expect(breadcrumbItemsFor('/app')).toEqual([
      { to: '/app', label: 'میزکار' },
    ]);
  });

  it('does not invent items for an unknown path', () => {
    expect(breadcrumbItemsFor('/app/does-not-exist')).toEqual([
      { to: '/app', label: 'میزکار' },
    ]);
    expect(breadcrumbItemsFor('/app/accounting/does-not-exist')).toEqual([
      { to: '/app', label: 'میزکار' },
      { to: '/app/accounting', label: 'حسابداری' },
    ]);
  });

  it('matches an exact route without treating it as a prefix of another', () => {
    // '/app/accounting' must not be confused with routes that merely share
    // the string prefix, and '/app' must not match '/application'.
    expect(breadcrumbItemsFor('/application')).toEqual([]);
  });
});
