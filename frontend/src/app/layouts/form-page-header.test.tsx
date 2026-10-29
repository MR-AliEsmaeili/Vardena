/**
 * The shared compact form header (design-system.md §5.2).
 *
 * Behaviour under test — not markup: the page's single `h1` carries the record
 * context, the Back control is the first control in the row (top-right in
 * RTL) with an accessible name, and Back resolves a REAL destination in each
 * navigation situation: an in-window previous step, a direct entry with no
 * history, and a record opened from a list window (ADR-0054).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { FormPageHeader } from './form-page-header';
import {
  useWorkspace,
  useWorkspaceActions,
  WorkspaceProvider,
  WorkspaceWindowContext,
  type WorkspaceApi,
  type WindowRuntime,
} from '../workspace/workspace-context';

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

const knownRoute = (path: string) => path.startsWith('/app');

/**
 * The runtime facts of a record window opened from the documents list — a
 * module constant so the provider value is stable (no per-render context).
 */
const recordRuntime = {
  id: 'window-record',
  basePath: '/app/accounting/documents/doc-1',
  path: '/app/accounting/documents/doc-1',
  dirty: false,
  openedFrom: '/app/accounting/documents',
} satisfies WindowRuntime;

function RecordWindow({ children }: { children: ReactNode }) {
  return (
    <WorkspaceWindowContext.Provider value={recordRuntime}>
      {children}
    </WorkspaceWindowContext.Provider>
  );
}

describe('FormPageHeader', () => {
  it('renders one compact heading row with Back first and the actions last', () => {
    render(
      <MemoryRouter initialEntries={['/app/inventory/items/itm-1']}>
        <FormPageHeader
          title={t.inventoryMaster.items}
          description="ITM-1"
          actions={
            <Button type="button" size="sm">
              {t.inventoryMaster.edit}
            </Button>
          }
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: t.inventoryMaster.items }),
    ).toBeInTheDocument();
    expect(screen.getByText('ITM-1')).toBeInTheDocument();

    const header = screen.getByTestId('form-page-header');
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName(t.formHeader.back);
    expect(header.lastElementChild).toContainElement(
      screen.getByRole('button', { name: t.inventoryMaster.edit }),
    );
  });

  it('steps back to the real previous screen when the window has history', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          '/app/inventory/items/itm-1',
          '/app/inventory/items/itm-1/edit',
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route
            path="/app/inventory/items/:itemId/edit"
            element={
              <>
                <FormPageHeader title={t.inventoryMaster.editItem} />
                <CurrentPath />
              </>
            }
          />
          <Route
            path="/app/inventory/items/:itemId"
            element={<CurrentPath />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: t.formHeader.back }));
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      '/app/inventory/items/itm-1',
    );
  });

  it('falls back to the record list on a direct entry with no history', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/app/inventory/items/itm-1/edit']}>
        <Routes>
          <Route
            path="/app/inventory/items/:itemId/edit"
            element={
              <>
                <FormPageHeader title={t.inventoryMaster.editItem} />
                <CurrentPath />
              </>
            }
          />
          <Route
            path="/app/inventory/items/:itemId"
            element={<CurrentPath />}
          />
          <Route path="/app/inventory/items" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: t.formHeader.back }));
    // `/edit` → the record it edits. A direct link never leaves the app and
    // never lands on a path the router cannot render.
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      '/app/inventory/items/itm-1',
    );
  });

  it('returns to the list window a record was opened from', async () => {
    const user = userEvent.setup();
    // Mutable holder: the effect assigns it, the assertions read it.
    const captured: { api: WorkspaceApi | null } = { api: null };

    /** Stable action channel: opens the list, then the record, once. */
    function Opener() {
      const actions = useWorkspaceActions();
      useEffect(() => {
        actions?.open('/app/accounting/documents');
        actions?.open('/app/accounting/documents/doc-1');
      }, [actions]);
      return null;
    }

    function Capture() {
      const workspace = useWorkspace();
      useEffect(() => {
        captured.api = workspace;
      });
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/app/accounting/documents/doc-1']}>
        <WorkspaceProvider ready isKnownRoute={knownRoute}>
          <Opener />
          <Capture />
          <RecordWindow>
            <FormPageHeader title={t.documents.detailTitle} />
          </RecordWindow>
        </WorkspaceProvider>
      </MemoryRouter>,
    );

    const origin = captured.api?.state.windows.find(
      (window) => window.basePath === '/app/accounting/documents',
    );
    expect(origin).toBeDefined();

    await user.click(screen.getByRole('button', { name: t.formHeader.back }));

    // Back activated the open list window (its filters kept) instead of
    // creating a third window at the record's route parent.
    expect(captured.api?.state.activeId).toBe(origin?.id);
    expect(captured.api?.state.windows).toHaveLength(2);
  });
});
