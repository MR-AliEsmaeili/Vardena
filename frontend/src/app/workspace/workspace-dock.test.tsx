/**
 * WorkspaceDock (§4.1–§4.5, §5, §7): the exact density matrix, D-1 (dock
 * always visible), tabs a11y + roving tabindex, RTL keyboard order, dirty
 * close through ConfirmDialog, focus hand-off after close, the cap dialog
 * (D-2: never auto-closes), the dock menu, and the single-density
 * chip + window list (sheet/popover variants).
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import {
  useWorkspace,
  WorkspaceProvider,
  type WorkspaceApi,
} from './workspace-context';
import { computeDockDensity, WorkspaceDock } from './workspace-dock';
import { formatWindowCount, resolveWindowMeta } from './workspace-meta';
import { MAX_WINDOWS } from './workspace-reducer';

const knownRoute = (path: string) => path.startsWith('/app');

/* matchMedia control ---------------------------------------------------- */

const originalMatchMedia = window.matchMedia;

function mockMedia(options: { md?: boolean; lg?: boolean; xl?: boolean }) {
  window.matchMedia = ((query: string) => {
    const matches = query.includes('768')
      ? options.md === true
      : query.includes('1024')
        ? options.lg === true
        : query.includes('1280')
          ? options.xl === true
          : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

/* harness --------------------------------------------------------------- */

let captured: WorkspaceApi | null = null;

function Capture() {
  const api = useWorkspace();
  // Effect-phase capture keeps the render pure (react/globals).
  useEffect(() => {
    captured = api;
  });
  return null;
}

function renderDock() {
  captured = null;
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <WorkspaceProvider ready isKnownRoute={knownRoute}>
        <Capture />
        <WorkspaceDock />
      </WorkspaceProvider>
    </MemoryRouter>,
  );
}

function openWindows(count: number) {
  act(() => {
    for (let index = 0; index < count; index += 1) {
      captured!.open(`/app/w${index}`);
    }
  });
}

function tabs() {
  return screen.getAllByTestId('workspace-tab');
}

/* §4.4 density matrix ---------------------------------------------------- */

describe('computeDockDensity — the exact §4.4 matrix', () => {
  it('is always single below 1024px', () => {
    for (const n of [1, 2, 5, 9, 12]) {
      expect(computeDockDensity(n, false, false)).toBe('single');
      expect(computeDockDensity(n, false, true)).toBe('single');
    }
  });

  it('at ≥1280px: full ≤5, compact 6–9, icon ≥10', () => {
    expect(computeDockDensity(1, true, true)).toBe('full');
    expect(computeDockDensity(5, true, true)).toBe('full');
    expect(computeDockDensity(6, true, true)).toBe('compact');
    expect(computeDockDensity(9, true, true)).toBe('compact');
    expect(computeDockDensity(10, true, true)).toBe('icon');
    expect(computeDockDensity(12, true, true)).toBe('icon');
  });

  it('at 1024–1279px: full ≤4, compact 5–8, icon ≥9', () => {
    expect(computeDockDensity(1, true, false)).toBe('full');
    expect(computeDockDensity(4, true, false)).toBe('full');
    expect(computeDockDensity(5, true, false)).toBe('compact');
    expect(computeDockDensity(8, true, false)).toBe('compact');
    expect(computeDockDensity(9, true, false)).toBe('icon');
    expect(computeDockDensity(12, true, false)).toBe('icon');
  });
});

/* desktop density -------------------------------------------------------- */

describe('desktop dock (≥1280px)', () => {
  it('is visible with a single window (D-1) and renders no chip', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    const dock = screen.getByTestId('workspace-dock');
    expect(dock).toHaveAttribute('data-density', 'full');
    expect(tabs()).toHaveLength(1);
    expect(screen.queryByTestId('workspace-active-chip')).toBeNull();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders ARIA tabs with roving tabindex and aria-controls', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    openWindows(2); // 3 windows total, last is active
    const list = tabs();
    expect(list).toHaveLength(3);
    list.forEach((tab, index) => {
      const isActive = index === 2;
      expect(tab).toHaveAttribute('role', 'tab');
      expect(tab).toHaveAttribute('aria-selected', String(isActive));
      expect(tab).toHaveAttribute(
        'aria-controls',
        `workspace-panel-${captured!.state.windows[index]!.id}`,
      );
      expect(tab).toHaveAttribute('tabindex', isActive ? '0' : '-1');
    });
    expect(screen.getByTestId('workspace-dock')).toHaveTextContent(
      formatWindowCount(3),
    );
  });

  it('click activates; ctrl+click opens a duplicate window (D-9)', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    openWindows(1);
    const homeTab = tabs()[0]!;
    expect(captured!.state.activeId).not.toBe(captured!.state.windows[0]!.id);
    fireEvent.click(homeTab);
    expect(captured!.state.activeId).toBe(captured!.state.windows[0]!.id);
    fireEvent.click(homeTab, { ctrlKey: true });
    expect(captured!.state.windows).toHaveLength(3);
    expect(
      captured!.state.windows.filter((w) => w.basePath === '/app'),
    ).toHaveLength(2);
  });

  it('tablist keyboard: RTL arrows, Home and End move focus', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    openWindows(2); // active = index 2
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' }); // previous in RTL
    expect(document.activeElement).toBe(tabs()[1]);
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' }); // next
    expect(document.activeElement).toBe(tabs()[2]);
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(document.activeElement).toBe(tabs()[0]);
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(document.activeElement).toBe(tabs()[2]);
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' }); // wraps
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('closing a clean tab removes it and hands focus to a neighbour (§5)', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    openWindows(2); // 3 clean windows
    const closeButtons = screen.getAllByTestId('workspace-tab-close');
    closeButtons[1]!.focus();
    fireEvent.click(closeButtons[1]!);
    expect(captured!.state.windows).toHaveLength(2);
    // Focus never lands on <body>: the neighbour tab took it.
    expect(document.activeElement).toHaveAttribute(
      'data-testid',
      'workspace-tab',
    );
  });

  it('closing the only window leaves a fresh workspace window (never empty)', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    fireEvent.click(screen.getByTestId('workspace-tab-close'));
    expect(captured!.state.windows).toHaveLength(1);
    expect(captured!.state.windows[0]!.path).toBe('/app');
    expect(tabs()).toHaveLength(1);
  });

  it('dirty tabs carry a non-colour indicator and close via ConfirmDialog (§4.7)', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    openWindows(1);
    const dirtyId = captured!.state.windows[1]!.id;
    act(() => captured!.setDirty(dirtyId, true));
    // Colour is never the only carrier (WCAG 1.4.1).
    expect(screen.getByTestId('workspace-tab-dirty')).toBeInTheDocument();
    expect(screen.getByText(t.workspace.dirtyTooltipTitle)).toBeInTheDocument();

    const closeButtons = screen.getAllByTestId('workspace-tab-close');
    fireEvent.click(closeButtons[1]!);
    // Held, not closed.
    expect(captured!.state.windows).toHaveLength(2);
    expect(captured!.state.pendingCloseId).toBe(dirtyId);
    expect(screen.getByText(t.workspace.dirtyCloseTitle)).toBeInTheDocument();

    // Cancel returns to the window.
    fireEvent.click(screen.getByText(t.workspace.backToWindow));
    expect(captured!.state.pendingCloseId).toBeNull();
    expect(captured!.state.windows).toHaveLength(2);
    expect(screen.queryByText(t.workspace.dirtyCloseTitle)).toBeNull();

    // Confirm closes without saving.
    fireEvent.click(screen.getAllByTestId('workspace-tab-close')[1]!);
    fireEvent.click(screen.getByText(t.workspace.closeWithoutSave));
    expect(captured!.state.windows).toHaveLength(1);
    expect(captured!.hasDirtyWindows).toBe(false);
  });

  it('announces the active window through a polite live region (§7)', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    const output = screen.getByRole('status');
    const expected = t.workspace.activeWindowAnnouncement.replace(
      '{title}',
      resolveWindowMeta('/app').title,
    );
    expect(output).toHaveTextContent(expected);
    openWindows(1);
    const newExpected = t.workspace.activeWindowAnnouncement.replace(
      '{title}',
      resolveWindowMeta('/app/w0').title,
    );
    expect(screen.getByRole('status')).toHaveTextContent(newExpected);
    expect(output).toHaveAttribute('aria-live', 'polite');
  });

  it('cap dialog: never auto-closes, offers activation and clean sweep (D-2)', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    openWindows(MAX_WINDOWS - 1); // 12 windows
    act(() => {
      captured!.open('/app/overflow');
    });
    expect(captured!.state.windows).toHaveLength(MAX_WINDOWS);
    expect(screen.getByText(t.workspace.capDialogTitle)).toBeInTheDocument();
    const items = screen.getAllByTestId('workspace-cap-dialog-window');
    expect(items).toHaveLength(MAX_WINDOWS);

    // Activating an existing window dismisses the dialog.
    fireEvent.click(items[0]!);
    expect(captured!.capDialogOpen).toBe(false);
    expect(captured!.state.activeId).toBe(captured!.state.windows[0]!.id);
    expect(screen.queryByText(t.workspace.capDialogTitle)).toBeNull();

    // The confirm path sweeps the clean windows.
    act(() => {
      captured!.open('/app/overflow-again');
    });
    expect(screen.getByText(t.workspace.capDialogTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByText(t.workspace.closeAllClean));
    expect(captured!.capDialogOpen).toBe(false);
    expect(captured!.state.windows).toHaveLength(1);
  });

  it('dock menu opens the window list and sweeps clean windows', () => {
    mockMedia({ lg: true, xl: true });
    renderDock();
    openWindows(2);
    const dirtyId = captured!.state.windows[1]!.id;
    act(() => captured!.setDirty(dirtyId, true));

    const menuButton = screen.getByTestId('workspace-dock-menu');
    expect(menuButton).toHaveAttribute('aria-haspopup', 'menu');
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(menuButton);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByTestId('workspace-dock-close-clean'));
    // Only the dirty window survives (W-05/D-2).
    expect(captured!.state.windows.map((w) => w.id)).toEqual([dirtyId]);
    expect(screen.queryByRole('menu')).toBeNull();

    // Manage item opens the popover window list.
    fireEvent.click(screen.getByTestId('workspace-dock-menu'));
    fireEvent.click(screen.getByTestId('workspace-dock-manage'));
    const list = screen.getByTestId('workspace-window-list');
    expect(list).toHaveAttribute('data-variant', 'popover');
    expect(screen.getAllByTestId('workspace-window-list-item')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('workspace-window-list')).toBeNull();
  });
});

/* single density ---------------------------------------------------------- */

describe('single-window density (<1024px)', () => {
  it('shows the active chip and a count toggle instead of tabs (D-1)', () => {
    renderDock(); // setup.ts stub: every breakpoint false → single
    const dock = screen.getByTestId('workspace-dock');
    expect(dock).toHaveAttribute('data-density', 'single');
    expect(screen.queryByRole('tablist')).toBeNull();
    const chip = screen.getByTestId('workspace-active-chip');
    expect(chip).toHaveTextContent(resolveWindowMeta('/app').title);
    const toggle = screen.getByTestId('workspace-window-list-toggle');
    expect(toggle).toHaveTextContent(formatWindowCount(1));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('window list opens as a bottom sheet below 768px', () => {
    renderDock();
    openWindows(2);
    const toggle = screen.getByTestId('workspace-window-list-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByTestId('workspace-window-list');
    expect(list).toHaveAttribute('data-variant', 'sheet');
    expect(list).toHaveAttribute('aria-label', t.workspace.windowListLabel);
    const items = screen.getAllByTestId('workspace-window-list-item');
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveAttribute('data-active', 'true');

    // Clicking an item activates its window and closes the list.
    fireEvent.click(items[0]!);
    expect(captured!.state.activeId).toBe(captured!.state.windows[0]!.id);
    expect(screen.queryByTestId('workspace-window-list')).toBeNull();
  });

  it('uses the popover variant at ≥768px', () => {
    mockMedia({ md: true });
    renderDock();
    fireEvent.click(screen.getByTestId('workspace-window-list-toggle'));
    expect(screen.getByTestId('workspace-window-list')).toHaveAttribute(
      'data-variant',
      'popover',
    );
  });

  it('closes on Escape and on outside pointer-down', () => {
    renderDock();
    const toggle = screen.getByTestId('workspace-window-list-toggle');
    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('workspace-window-list')).toBeNull();

    fireEvent.click(toggle);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('workspace-window-list')).toBeNull();
  });

  it('list close button routes clean windows straight out and dirty ones to the dialog', () => {
    renderDock();
    openWindows(1);
    const dirtyId = captured!.state.windows[1]!.id;
    act(() => captured!.setDirty(dirtyId, true));
    fireEvent.click(screen.getByTestId('workspace-window-list-toggle'));
    const closeButtons = screen.getAllByTestId('workspace-window-list-close');
    // Clean window: closed immediately.
    fireEvent.click(closeButtons[0]!);
    expect(captured!.state.windows).toHaveLength(1);
    // Dirty window: dialog first.
    fireEvent.click(screen.getAllByTestId('workspace-window-list-close')[0]!);
    expect(screen.getByText(t.workspace.dirtyCloseTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByText(t.workspace.closeWithoutSave));
    expect(captured!.state.windows).toHaveLength(1);
    expect(captured!.state.windows[0]!.id).not.toBe(dirtyId);
  });
});

describe('without a provider', () => {
  it('the dock renders nothing (null-safe outside the workspace)', () => {
    render(<WorkspaceDock />);
    expect(screen.queryByTestId('workspace-dock')).toBeNull();
  });
});
