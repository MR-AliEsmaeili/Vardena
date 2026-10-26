import { expect, test } from '@playwright/test';
import { t } from '../src/lib/i18n';
import { installApiStub } from './fixtures/api';

/**
 * Multi-window workspace (ADR-0054, FDR-0001) — the browser-level contract:
 * the always-visible dock (D-1), refresh restore of PATHS ONLY (D-6), the
 * 12-window cap that never auto-closes (D-2), keep-alive across switches
 * (W-01), the dirty-close guard (W-05), the limited shortcut set (§4.8),
 * the replace-only URL mirror (W-07) and the device-local module tones (D-3).
 */

const WORKSPACE_KEY = 'vardena:workspace:v1';
const TONES_KEY = 'vardena:module-tones:v1';

/** The ACTIVE window's panel — hidden siblings stay in the DOM (keep-alive),
 *  so page-level getByTestId would match more than one element. */
function activePanel(page: import('@playwright/test').Page) {
  return page.locator(
    'section[data-testid="workspace-window"][data-active="true"]',
  );
}

function tabPaths(page: import('@playwright/test').Page) {
  return page
    .getByTestId('workspace-tab')
    .evaluateAll((elements) =>
      elements.map(
        (element) => (element as HTMLElement).dataset['windowPath'] ?? '',
      ),
    );
}

/** Twelve real, stubbed routes — exactly the hard cap (D-2). */
const CAP_PATHS = [
  '/app/inventory/items',
  '/app/admin/users',
  '/app/admin/roles',
  '/app/accounting/documents',
  '/app/accounting/chart',
  '/app/accounting/general-ledger',
  '/app/accounting/fiscal-years',
  '/app/accounting/financial-areas',
  '/app/accounting/periods',
  '/app/accounting/trial-balance',
  '/app/inventory/movements',
  '/app/profile',
] as const;

test.describe('workspace windows — dock, restore, cap', () => {
  test.beforeEach(async ({ page }) => {
    await installApiStub(page);
  });

  test('the dock is visible with a single window (D-1)', async ({ page }) => {
    await page.goto('/app/inventory/items');
    await expect(page.getByTestId('workspace-dock')).toBeVisible();
    await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
    await expect(page.getByTestId('workspace-tab').first()).toHaveAttribute(
      'data-window-path',
      '/app/inventory/items',
    );
    await expect(activePanel(page).getByTestId('items-page')).toBeVisible();
  });

  test('a deep link appends a window and refresh restores paths only (D-6)', async ({
    page,
  }) => {
    await page.goto('/app/inventory/items');
    await expect(activePanel(page).getByTestId('items-page')).toBeVisible();

    // A second address (full navigation) appends its own window next to the
    // restored one — the deep link never REPLACES the session's list.
    await page.goto('/app/admin/users');
    await expect(page.getByTestId('workspace-tab')).toHaveCount(2);
    expect(await tabPaths(page)).toEqual([
      '/app/inventory/items',
      '/app/admin/users',
    ]);

    // F5: the same two windows come back, active one included; nothing else
    // (never unsaved form content) is restored.
    await page.reload();
    await expect(page.getByTestId('workspace-tab')).toHaveCount(2);
    expect(await tabPaths(page)).toEqual([
      '/app/inventory/items',
      '/app/admin/users',
    ]);
    await expect(activePanel(page).getByTestId('users-page')).toBeVisible();
    // The restored sibling is an inert placeholder until activated (W-16).
    await expect(page.getByTestId('workspace-window-slot')).toHaveCount(1);
  });

  test('switching windows keeps each page alive and mirrors the URL (W-01, W-07)', async ({
    page,
  }) => {
    await page.goto('/app/inventory/items');
    await page.goto('/app/admin/users');

    // Activate the items window and give it page-local state (a filter).
    await page.getByTestId('workspace-tab').first().click();
    await page.waitForURL('**/app/inventory/items');
    await activePanel(page).getByLabel(t.inventoryMaster.code).fill('0002');
    await expect(
      activePanel(page).getByRole('link', { name: 'ITM-0002' }),
    ).toBeVisible();

    // Switch away and back — the filter and the grid state survived because
    // the hidden window stayed mounted.
    await page.getByTestId('workspace-tab').nth(1).click();
    await page.waitForURL('**/app/admin/users');
    await expect(activePanel(page).getByTestId('users-page')).toBeVisible();

    await page.getByTestId('workspace-tab').first().click();
    await page.waitForURL('**/app/inventory/items');
    await expect(
      activePanel(page).getByLabel(t.inventoryMaster.code),
    ).toHaveValue('0002');
    await expect(
      activePanel(page).getByRole('link', { name: 'ITM-0002' }),
    ).toBeVisible();
  });

  test('the cap dialog blocks a 13th window and never auto-closes (D-2)', async ({
    page,
  }) => {
    await page.goto('/app');
    // Seed a full 12-window snapshot (paths the strict restore accepts).
    await page.evaluate(
      ([key, paths]) => {
        const windows = paths.map((path, index) => ({
          id: `e2e-window-${String(index).padStart(4, '0')}`,
          basePath: path,
          path,
        }));
        window.sessionStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            windows,
            activeId: windows[0]!.id,
          }),
        );
      },
      [WORKSPACE_KEY, CAP_PATHS] as const,
    );

    // A 13th address hits the cap: dialog instead of a silent eviction.
    await page.goto('/app/licensing/devices');
    await expect(page.getByTestId('workspace-dock')).toBeVisible();
    await expect(page.getByTestId('workspace-tab')).toHaveCount(12);
    await expect(page.getByText(t.workspace.capDialogTitle)).toBeVisible();
    await expect(page.getByTestId('workspace-cap-dialog-window')).toHaveCount(
      12,
    );

    // Choosing an existing window dismisses the dialog and activates it.
    await page.getByTestId('workspace-cap-dialog-window').nth(1).click();
    await expect(page.getByText(t.workspace.capDialogTitle)).toHaveCount(0);
    await page.waitForURL('**/app/admin/users');
    await expect(page.getByTestId('workspace-tab')).toHaveCount(12);
  });

  test('a dirty window only closes through its confirmation (W-05)', async ({
    page,
  }) => {
    await page.goto('/app/inventory/items/new');
    const form = activePanel(page).getByTestId('item-form');
    await expect(form).toBeVisible();
    await activePanel(page).getByLabel(t.inventoryMaster.code).fill('0001');

    // Closing now must be held: dialog first, window untouched on cancel.
    await page.getByTestId('workspace-tab-close').click();
    await expect(page.getByText(t.workspace.dirtyCloseTitle)).toBeVisible();
    await page.getByRole('button', { name: t.workspace.backToWindow }).click();
    await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
    await expect(form).toBeVisible();

    // Confirming closes; the dock falls back to a fresh workspace window and
    // is never empty.
    await page.getByTestId('workspace-tab-close').click();
    await page
      .getByRole('button', { name: t.workspace.closeWithoutSave })
      .click();
    await page.waitForURL(/\/app\/?$/);
    await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
    await expect(page.getByTestId('workspace-tab').first()).toHaveAttribute(
      'data-window-path',
      '/app',
    );
  });
});

test.describe('workspace windows — shortcuts (§4.8)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiStub(page);
    await page.goto('/app/inventory/items');
    await page.goto('/app/admin/users');
    await expect(page.getByTestId('workspace-tab')).toHaveCount(2);
  });

  test('Alt+1 jumps to the first window, Alt+W closes the active one', async ({
    page,
  }) => {
    await page.keyboard.press('Alt+1');
    await page.waitForURL('**/app/inventory/items');

    // Alt+W on a CLEAN window closes it immediately (no dialog).
    await page.keyboard.press('Alt+ArrowLeft'); // RTL: next → users
    await page.waitForURL('**/app/admin/users');
    await page.keyboard.press('Alt+w');
    await page.waitForURL('**/app/inventory/items');
    await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
  });

  test('Alt+Arrow cycles windows in RTL order', async ({ page }) => {
    // Active is the second (users). ArrowRight = previous in RTL.
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForURL('**/app/inventory/items');
    await page.keyboard.press('Alt+ArrowRight'); // wraps to the last
    await page.waitForURL('**/app/admin/users');
    await page.keyboard.press('Alt+ArrowLeft'); // wraps to the first
    await page.waitForURL('**/app/inventory/items');
  });
});

test.describe('workspace windows — module tones (D-3)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiStub(page);
  });

  test('re-assigning a tone applies app-wide and survives refresh', async ({
    page,
  }) => {
    await page.goto('/app/profile');
    const section = page.getByTestId('module-tones-section');
    await expect(section).toBeVisible();

    await page
      .getByTestId('module-tone-select-accounting')
      .selectOption('inventory');

    // Applied instantly on <html> through the src indirection — no reload,
    // no raw colour, the bijection swaps with the previous owner.
    await expect
      .poll(async () =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            '--color-tone-accounting-soft',
          ),
        ),
      )
      .toBe('var(--color-tone-src-inventory-soft)');
    await expect(page.getByTestId('module-tone-select-inventory')).toHaveValue(
      'accounting',
    );

    // The pre-paint script re-applies the stored mapping on the next load.
    await page.reload();
    await expect(page.getByTestId('module-tone-select-accounting')).toHaveValue(
      'inventory',
    );
    await expect
      .poll(async () =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            '--color-tone-accounting-soft',
          ),
        ),
      )
      .toBe('var(--color-tone-src-inventory-soft)');

    // Reset restores the shipped identity mapping and clears the overrides.
    await page.getByTestId('module-tones-reset').click();
    await expect(page.getByTestId('module-tone-select-accounting')).toHaveValue(
      'accounting',
    );
    await expect
      .poll(async () =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            '--color-tone-accounting-soft',
          ),
        ),
      )
      .toBe('');
    await expect
      .poll(async () =>
        page.evaluate(([key]) => window.localStorage.getItem(key), [
          TONES_KEY,
        ] as const),
      )
      .toContain('"accounting":"accounting"');
  });
});
