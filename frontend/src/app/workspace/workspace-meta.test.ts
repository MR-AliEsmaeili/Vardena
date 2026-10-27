/**
 * workspace-meta — the §6.6 resolution table, one test per rule, plus the
 * Persian-digit window count. Assertions reference the live `t`/navigation
 * tables rather than hard-coded strings, so copy edits never break tests.
 */

import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { navigationSections } from '../navigation';
import {
  formatWindowCount,
  moduleOfPath,
  resolveWindowMeta,
  shortenWindowId,
  toPersianDigits,
} from './workspace-meta';

function itemLabel(to: string): string {
  for (const section of navigationSections) {
    for (const item of section.items) {
      if (item.to === to) return item.label;
    }
  }
  throw new Error(`no navigation item for ${to}`);
}

function sectionLabel(tone: string): string {
  const section = navigationSections.find((s) => s.tone === tone);
  if (section === undefined) throw new Error(`no section ${tone}`);
  return section.label;
}

describe('moduleOfPath — rule 1', () => {
  it('maps the first segment after /app to a known module', () => {
    expect(moduleOfPath('/app/accounting/documents')).toBe('accounting');
    expect(moduleOfPath('/app/inventory/movements/new')).toBe('inventory');
    expect(moduleOfPath('/app/organization/admin/users')).toBe('organization');
    expect(moduleOfPath('/app/admin/roles')).toBe('admin');
  });

  it('maps the bare hub and unknown modules to workspace', () => {
    expect(moduleOfPath('/app')).toBe('workspace');
    expect(moduleOfPath('/app/unknown-thing')).toBe('workspace');
    expect(moduleOfPath('/login')).toBe('workspace');
  });
});

describe('resolveWindowMeta — rules 2–6', () => {
  it('exact item: base label and icon (rule 2)', () => {
    const meta = resolveWindowMeta('/app/accounting/documents');
    expect(meta.module).toBe('accounting');
    expect(meta.title).toBe(itemLabel('/app/accounting/documents'));
    expect(meta.tone).toBe('accounting');
    // lucide icons are forwardRef exotic components (objects, renderable).
    expect(meta.icon).toBeTruthy();
  });

  it('the hub /app resolves exactly — never by prefix (rule 2)', () => {
    const meta = resolveWindowMeta('/app');
    expect(meta.module).toBe('workspace');
    expect(meta.title).toBe(itemLabel('/app'));
  });

  it('longest prefix wins over shorter ones (rule 2)', () => {
    // /app/accounting/documents/:id — the documents item is the longest
    // prefix, not the /app/accounting section entry.
    const meta = resolveWindowMeta('/app/accounting/documents/123');
    expect(meta.title).toBe(
      `${itemLabel('/app/accounting/documents')} ${t.workspace.idSuffix.replace('{id}', '123')}`,
    );
  });

  it('draft suffix for /new (rule 3)', () => {
    const meta = resolveWindowMeta('/app/inventory/movements/new');
    expect(meta.title).toBe(
      `${itemLabel('/app/inventory/movements')} · ${t.workspace.draftSuffix}`,
    );
  });

  it('edit suffix for /edit (rule 3)', () => {
    const meta = resolveWindowMeta('/app/accounting/accounts/99/edit');
    expect(meta.title).toBe(
      `${itemLabel('/app/accounting/accounts')} · ${t.workspace.editSuffix}`,
    );
  });

  it('id suffix shows only the last 6 characters (rule 3)', () => {
    const meta = resolveWindowMeta('/app/accounting/documents/abcd1234ef5678');
    expect(shortenWindowId('abcd1234ef5678')).toBe('ef5678');
    expect(meta.title).toContain('ef5678');
    expect(meta.title).not.toContain('abcd1234');
  });

  it('known query suffixes append; unknown keys never reach the title (rule 4)', () => {
    const base = resolveWindowMeta(
      '/app/inventory/movements',
      '?kind=receipt&foo=bar',
    ).title;
    expect(base).toBe(
      `${itemLabel('/app/inventory/movements')} · ${t.workspace.querySuffix.kind.receipt}`,
    );
    expect(base).not.toContain('foo');
    expect(base).not.toContain('bar');

    const typed = resolveWindowMeta(
      '/app/inventory/documents',
      '?type=issue',
    ).title;
    expect(typed).toContain(t.workspace.querySuffix.type.issue);
  });

  it('an unknown single segment under a matched item reads as an id (rule 3 wins over rule 5)', () => {
    // '/app/accounting' is itself a navigation item, so the unknown segment
    // is treated like a `:id` detail suffix — the documented rule-3 shape.
    const meta = resolveWindowMeta('/app/accounting/not-a-real-page');
    expect(meta.module).toBe('accounting');
    expect(meta.title).toContain('#');
    expect(meta.title.length).toBeGreaterThan(0);
  });

  it('unknown paths with no matching item fall back to section label + last segment (rule 5)', () => {
    // The bare '/app' hub never prefix-matches, so an unknown top-level
    // module path lands in the workspace section fallback.
    const meta = resolveWindowMeta('/app/not-a-real-module');
    expect(meta.module).toBe('workspace');
    expect(meta.title).toBe(`${sectionLabel('workspace')} · not-a-real-module`);
    expect(meta.title.length).toBeGreaterThan(0);
  });

  it('deep unknown paths still get a readable non-empty title (rule 5)', () => {
    const meta = resolveWindowMeta('/app/totally/unknown/deep');
    expect(meta.module).toBe('workspace');
    expect(meta.title).toBe(`${sectionLabel('workspace')} · deep`);
  });

  it('icon is always present (rule 6)', () => {
    for (const path of [
      '/app',
      '/app/accounting/unknown',
      '/app/inventory/movements/new',
      '/app/x/y/z',
    ]) {
      expect(resolveWindowMeta(path).icon).toBeTruthy();
    }
  });
});

describe('Persian-digit window count (§4.2)', () => {
  it('converts digits and formats the count label', () => {
    expect(toPersianDigits(12)).toBe('۱۲');
    expect(toPersianDigits('3 windows 2026')).toBe('۳ windows ۲۰۲۶');
    expect(formatWindowCount(1)).toBe(
      t.workspace.windowCount.replace('{count}', '۱'),
    );
    expect(formatWindowCount(12)).toContain('۱۲');
  });
});
