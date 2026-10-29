import { describe, expect, it } from 'vitest';
import {
  deepestDestinationBelow,
  isRegisteredDestination,
  resolveParentPath,
} from './parent-path';

/**
 * The Back target of the shared form header (design-system.md §5.2).
 *
 * These tests name the WORKFLOW rule, not the implementation: every answer is
 * a screen the app really renders, the record's list wins over a made-up
 * segment, and an unknown path never invents a destination.
 */
describe('resolveParentPath', () => {
  it('returns the list a record belongs to', () => {
    expect(resolveParentPath({ pathname: '/app/inventory/items/itm-1' })).toBe(
      '/app/inventory/items',
    );
    expect(
      resolveParentPath({ pathname: '/app/organization/parties/par-1' }),
    ).toBe('/app/organization/parties');
  });

  it('returns the record when leaving its edit form (the previous step)', () => {
    expect(
      resolveParentPath({ pathname: '/app/inventory/items/itm-1/edit' }),
    ).toBe('/app/inventory/items/itm-1');
  });

  it('returns the list when leaving a create form', () => {
    expect(
      resolveParentPath({ pathname: '/app/accounting/accounts/new' }),
    ).toBe('/app/accounting/accounts');
    expect(
      resolveParentPath({ pathname: '/app/documents/numbering-series/new' }),
    ).toBe('/app/documents/numbering-series');
  });

  it('prefers a page-declared workflow parent that is a real destination', () => {
    expect(
      resolveParentPath({
        pathname: '/app/inventory/transfers/new',
        explicitTarget: '/app/inventory/movements',
      }),
    ).toBe('/app/inventory/movements');
  });

  it('ignores a declared parent that is not a real screen', () => {
    expect(
      resolveParentPath({
        pathname: '/app/inventory/transfers/new',
        explicitTarget: '/app/inventory/transfer-list',
      }),
    ).toBe('/app/inventory');
  });

  it('falls back to the module hub for a create form without its own list', () => {
    expect(
      resolveParentPath({ pathname: '/app/inventory/transfers/new' }),
    ).toBe('/app/inventory');
  });

  it('never invents a destination for an unknown path', () => {
    expect(resolveParentPath({ pathname: '/app/does-not-exist/42' })).toBe(
      '/app',
    );
    expect(resolveParentPath({ pathname: '/app' })).toBe('/app');
  });

  it('ignores query strings when choosing the parent screen', () => {
    expect(
      resolveParentPath({
        pathname: '/app/inventory/movements/new',
      }),
    ).toBe('/app/inventory/movements');
    expect(
      resolveParentPath({ pathname: '/app/accounting/documents/1/edit' }),
    ).toBe('/app/accounting/documents/1');
  });

  it('exposes the registry predicates the resolver relies on', () => {
    expect(isRegisteredDestination('/app/accounting/accounts')).toBe(true);
    expect(isRegisteredDestination('/app/accounting/accounts/1')).toBe(false);
    expect(deepestDestinationBelow('/app/accounting/documents/1/lines')).toBe(
      '/app/accounting/documents',
    );
  });
});
