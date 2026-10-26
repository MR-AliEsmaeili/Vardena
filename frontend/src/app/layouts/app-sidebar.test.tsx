import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionChecks } from '@/features/permissions/use-permissions';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { AppSidebar, type AppSidebarProps } from './app-sidebar';

/**
 * The sidebar's own interaction contract (standards.md §2/§8, ADR shell).
 *
 * The shell integration suite proves the rail folds after a selection; this
 * suite pins the parts that make the rail usable on its own: the collapse
 * handle lives here (not in the header), a collapsed rail keeps its category
 * markers, an icon-only row keeps an accessible name, and a group header
 * announces both its state and the list it controls.
 */

const permissionCodes: string[] = [];

vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: (): PermissionChecks => {
    const set = new Set(permissionCodes);
    const has = (code: string) => set.has(code);
    return {
      codes: permissionCodes,
      loaded: true,
      has,
      hasAll: (codes) => codes.every(has),
      hasAny: (codes) => codes.some(has),
    };
  },
}));

function makeProps(overrides: Partial<AppSidebarProps> = {}): AppSidebarProps {
  return {
    navigationId: 'app-navigation',
    navigationRef: { current: null },
    collapsed: false,
    collapsedGroups: [],
    onToggleGroup: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onExpandGroup: vi.fn(),
    mobileOpen: false,
    onCloseMobile: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  };
}

function renderSidebar(
  props: Partial<AppSidebarProps> = {},
  initialEntries: string[] = ['/app'],
) {
  const merged = makeProps(props);
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppSidebar {...merged} />
    </MemoryRouter>,
  );
  return {
    props: merged,
    sidebar: screen.getByTestId('app-sidebar'),
    navigation: screen.getByRole('navigation', { name: t.nav.mainMenu }),
  };
}

beforeEach(() => {
  permissionCodes.length = 0;
  permissionCodes.push(
    PERMISSIONS.accounting.documentView,
    PERMISSIONS.inventory.itemView,
    PERMISSIONS.users.view,
  );
});

describe('AppSidebar — ownership of the collapse handle', () => {
  it('renders the collapse handle inside the sidebar when expanded', () => {
    const { sidebar } = renderSidebar();

    const handle = within(sidebar).getByTestId('sidebar-toggle');
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    expect(handle).toHaveAttribute('aria-controls', 'app-navigation');
    expect(handle).toHaveAccessibleName(t.nav.collapseSidebar);
  });

  it('moves the handle to the collapsed rail and expands from there', async () => {
    const user = userEvent.setup();
    const { sidebar, props } = renderSidebar({ collapsed: true });

    const handle = within(sidebar).getByTestId('sidebar-toggle');
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(handle).toHaveAccessibleName(t.nav.expandSidebar);

    await user.click(handle);
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('omits the desktop handle inside the mobile drawer (the drawer is dismissed, not folded)', () => {
    const { sidebar } = renderSidebar({ mobileOpen: true, collapsed: true });

    // A drawer always shows the expanded rail: it is closed with its backdrop
    // or Escape, so a collapse handle would be a dead control there.
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    expect(within(sidebar).queryByTestId('sidebar-toggle')).toBeNull();
    // Row labels are real text again, not icon-only.
    expect(
      within(sidebar).getByRole('link', { name: t.nav.documents }),
    ).toHaveTextContent(t.nav.documents);
  });
});

describe('AppSidebar — categories in both shapes', () => {
  it('renders a group header with its expanded state and the list it controls', () => {
    const { sidebar } = renderSidebar();
    const header = within(sidebar).getByTestId(
      'sidebar-group-accounting-documents',
    );

    expect(header).toHaveAttribute('aria-expanded', 'true');
    const controlled = header.getAttribute('aria-controls');
    expect(controlled).toBe('app-navigation-accounting-documents');
    expect(document.getElementById(controlled ?? '')).not.toBeNull();
  });

  it('hides the entries of a collapsed group and asks the shell to reopen it', async () => {
    const user = userEvent.setup();
    const { sidebar, props } = renderSidebar({
      collapsedGroups: ['accounting-documents'],
    });
    const header = within(sidebar).getByTestId(
      'sidebar-group-accounting-documents',
    );

    expect(header).toHaveAttribute('aria-expanded', 'false');
    // The group is controlled: nothing inside it is rendered, but the other
    // domains keep their entries.
    expect(
      within(sidebar).queryByRole('link', { name: t.nav.documents }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole('link', { name: t.inventoryMaster.items }),
    ).toBeInTheDocument();

    await user.click(header);
    expect(props.onToggleGroup).toHaveBeenCalledWith('accounting-documents');
  });

  it('keeps every permitted domain as a labelled marker on the collapsed rail', async () => {
    const user = userEvent.setup();
    const { sidebar, props } = renderSidebar({ collapsed: true });

    for (const [sectionId, label] of [
      ['accounting-documents', t.nav.accountingDocumentsGroup],
      ['inventory', t.nav.inventory],
      ['admin', t.nav.admin],
    ] as const) {
      const marker = within(sidebar).getByTestId(`sidebar-group-${sectionId}`);
      expect(marker).toHaveAccessibleName(
        t.nav.openGroup.replace('{group}', label),
      );
    }

    // A domain the session may not read has no marker at all.
    expect(
      within(sidebar).queryByTestId('sidebar-group-organization'),
    ).not.toBeInTheDocument();

    await user.click(within(sidebar).getByTestId('sidebar-group-inventory'));
    expect(props.onExpandGroup).toHaveBeenCalledWith('inventory');
  });

  it('keeps icon-only rows keyboard reachable and named by their label', async () => {
    const user = userEvent.setup();
    const { sidebar, props } = renderSidebar({ collapsed: true });

    const link = within(sidebar).getByRole('link', { name: t.nav.documents });
    expect(link).toHaveAccessibleName(t.nav.documents);

    await user.hover(link);
    expect(screen.getByRole('tooltip')).toHaveTextContent(t.nav.documents);

    // The icon-only row is still an operable destination.
    await user.click(link);
    expect(props.onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('AppSidebar — navigation side effects', () => {
  it('closes the drawer and asks the shell to fold the rail on selection', async () => {
    const user = userEvent.setup();
    const { sidebar, props } = renderSidebar({ mobileOpen: true });

    await user.click(
      within(sidebar).getByRole('link', { name: t.nav.documents }),
    );

    expect(props.onCloseMobile).toHaveBeenCalledWith(false);
    expect(props.onNavigate).toHaveBeenCalledTimes(1);
  });

  it('marks the current destination and only that destination as active', () => {
    const { sidebar } = renderSidebar({}, ['/app/accounting/documents']);

    const active = within(sidebar).getByRole('link', {
      name: t.nav.documents,
    });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active.querySelector('.animate-marker-in')).not.toBeNull();

    const other = within(sidebar).getByRole('link', {
      name: t.inventoryMaster.items,
    });
    expect(other).not.toHaveAttribute('aria-current');
    expect(other.querySelector('.animate-marker-in')).toBeNull();
  });

  it('dims the page behind the mobile drawer with a labelled dismiss surface', async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar({ mobileOpen: true });

    const backdrop = screen.getByRole('button', { name: t.nav.closeMenu });
    await user.click(backdrop);
    expect(props.onCloseMobile).toHaveBeenCalledWith(false);
  });
});

describe('AppSidebar — collapsed rail geometry', () => {
  it('keeps the expand handle the same visual size as a menu glyph', () => {
    const { sidebar } = renderSidebar({ collapsed: true });

    const handle = within(sidebar).getByTestId('sidebar-toggle');
    // Same 24px visual box as `NavGlyph` (`size="md"`); the hit area is the
    // `after:` pseudo-element, so the icon is not a visually larger banner.
    expect(handle.className).toContain('h-6');
    expect(handle.className).toContain('w-6');
    expect(handle.className).toContain('rounded-glyph');
    expect(handle.querySelector('svg')).not.toBeNull();
  });

  it('keeps a real inline-start inset on the collapsed icon column', () => {
    const { sidebar } = renderSidebar({ collapsed: true });

    const scroll = within(sidebar).getByTestId('sidebar-scroll');
    // RTL: the inline-start edge is the visual RIGHT edge, so `ps-3` is the
    // padding that keeps the rail from gluing itself to the viewport side.
    expect(scroll.className).toContain('ps-3');
    expect(scroll.className).toContain('pe-1.5');
  });

  it('labels the expand handle with a tooltip that opens on hover', async () => {
    const user = userEvent.setup();
    const { sidebar } = renderSidebar({ collapsed: true });

    await user.hover(within(sidebar).getByTestId('sidebar-toggle'));
    expect(screen.getByRole('tooltip')).toHaveTextContent(t.nav.expandSidebar);
  });
});
