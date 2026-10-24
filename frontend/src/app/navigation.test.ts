import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import type { PermissionChecks } from '@/features/permissions/use-permissions';
import {
  isNavigationItemVisible,
  navigationSections,
  visibleNavigationSections,
  type NavigationItem,
} from './navigation';
import { NAV_TONE_TILE, type NavTone } from '@/ui/nav-glyph';

/**
 * The menu is data, and three surfaces render it (sidebar, global search,
 * workspace cards). These tests pin the contract those surfaces rely on:
 * every domain is renderable on its own (icon + tone), every route is unique,
 * and the permission filter is exact-match — it never widens access and it
 * removes a domain completely when nothing inside it is permitted.
 */

function checks(codes: readonly string[], loaded = true): PermissionChecks {
  const set = new Set(codes);
  const has = (code: string) => set.has(code);
  return {
    codes,
    loaded,
    has,
    hasAll: (list) => list.every(has),
    hasAny: (list) => list.some(has),
  };
}

describe('navigation structure', () => {
  it('gives every section an id, a label, a glyph and a defined tone', () => {
    const ids = new Set<string>();

    for (const section of navigationSections) {
      expect(section.id).not.toBe('');
      expect(section.label.trim()).not.toBe('');
      expect(typeof section.icon).toBe('object');
      expect(NAV_TONE_TILE[section.tone as NavTone]).toBeDefined();
      expect(ids.has(section.id)).toBe(false);
      ids.add(section.id);
    }

    expect(ids.size).toBe(navigationSections.length);
  });

  it('uses a distinct visual tone per domain so colour is not the only cue but stays informative', () => {
    const tones = navigationSections.map((section) => section.tone);
    expect(new Set(tones).size).toBeGreaterThan(3);
  });

  it('marks exactly one standalone workspace entry and nothing else', () => {
    const standalone = navigationSections.filter(
      (section) => section.standalone === true,
    );

    expect(standalone.map((section) => section.id)).toEqual(['workspace']);
    expect(standalone[0]?.items).toEqual([
      expect.objectContaining({ to: '/app', end: true }),
    ]);
  });

  it('never registers the same destination twice', () => {
    const paths = navigationSections.flatMap((section) =>
      section.items.map((item) => item.to),
    );

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps every hub-only entry out of the visible menu', () => {
    const hubOnly = navigationSections
      .flatMap((section) => section.items)
      .filter((item) => item.hubOnly === true);

    expect(hubOnly.length).toBeGreaterThan(0);
    for (const item of hubOnly) {
      expect(isNavigationItemVisible(item, checks([]))).toBe(false);
    }
  });
});

describe('isNavigationItemVisible', () => {
  const guarded: NavigationItem = {
    to: '/guarded',
    label: 'guarded',
    icon: navigationSections[1]!.icon,
    permissions: ['A.View', 'B.View'],
  };
  const anyOf: NavigationItem = {
    to: '/any-of',
    label: 'any-of',
    icon: navigationSections[1]!.icon,
    anyPermissions: ['A.View', 'B.View'],
  };

  it('requires ALL declared permission codes', () => {
    expect(isNavigationItemVisible(guarded, checks(['A.View']))).toBe(false);
    expect(isNavigationItemVisible(guarded, checks(['A.View', 'B.View']))).toBe(
      true,
    );
  });

  it('requires at least ONE of the any-permission codes', () => {
    expect(isNavigationItemVisible(anyOf, checks([]))).toBe(false);
    expect(isNavigationItemVisible(anyOf, checks(['B.View']))).toBe(true);
  });

  it('hides guarded entries until the permission set is loaded', () => {
    expect(
      isNavigationItemVisible(guarded, checks(['A.View', 'B.View'], false)),
    ).toBe(false);
    expect(isNavigationItemVisible(anyOf, checks(['A.View'], false))).toBe(
      false,
    );
  });

  it('matches codes exactly — no prefix or wildcard expansion', () => {
    expect(isNavigationItemVisible(guarded, checks(['A.*']))).toBe(false);
    expect(
      isNavigationItemVisible(guarded, checks(['A.View', 'B.View.Extra'])),
    ).toBe(false);
  });
});

describe('visibleNavigationSections', () => {
  it('drops a domain entirely when the session holds none of its permissions', () => {
    const visible = visibleNavigationSections(checks([]));

    expect(visible.map((section) => section.id)).toEqual(['workspace']);
    expect(visible[0]?.items.map((item) => item.to)).toEqual(['/app']);
  });

  it('keeps a permitted domain and removes only its forbidden entries', () => {
    const visible = visibleNavigationSections(
      checks([PERMISSIONS.accounting.documentView]),
    );
    const accounting = visible.find((section) => section.id === 'accounting');

    expect(accounting).toBeDefined();
    expect(accounting?.items.map((item) => item.to)).toEqual([
      '/app/accounting/documents',
      '/app/accounting/document-lines',
    ]);
    // The domain header survives even though most of its entries are hidden.
    expect(accounting?.label).toBe(navigationSections[1]?.label);
    expect(accounting?.tone).toBe('accounting');
  });

  it('never returns an empty domain (no orphan category header)', () => {
    const visible = visibleNavigationSections(
      checks([PERMISSIONS.users.view, PERMISSIONS.inventory.itemView]),
    );

    for (const section of visible) {
      expect(section.items.length).toBeGreaterThan(0);
    }
    expect(visible.map((section) => section.id)).toEqual([
      'workspace',
      'inventory',
      'admin',
    ]);
  });

  it('exposes exactly the entries a full accounting session may reach, in order', () => {
    const visible = visibleNavigationSections(
      checks([PERMISSIONS.accounting.documentView]),
    );

    expect(
      visible
        .find((section) => section.id === 'accounting')
        ?.items.map((item) => item.label),
    ).toEqual([t.nav.documents, t.nav.accountingDocumentLines]);
  });
});
