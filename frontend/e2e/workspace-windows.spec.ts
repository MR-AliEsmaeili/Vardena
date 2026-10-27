import { expect, test, type Page } from '@playwright/test';
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
function activePanel(page: Page) {
  return page.locator(
    'section[data-testid="workspace-window"][data-active="true"]',
  );
}

function tabPaths(page: Page) {
  return page
    .getByTestId('workspace-tab')
    .evaluateAll((elements) =>
      elements.map(
        (element) => (element as HTMLElement).dataset['windowPath'] ?? '',
      ),
    );
}

/**
 * The persistence writer is idle-debounced and flushes on pagehide; before a
 * full navigation wait for the snapshot to actually exist, so the next load's
 * restore (D-6) is deterministic instead of racing the idle callback.
 */
async function expectSnapshotPersisted(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(([key]) => window.sessionStorage.getItem(key), [
        WORKSPACE_KEY,
      ] as const),
    )
    .not.toBeNull();
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
    await expectSnapshotPersisted(page);

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
    await expectSnapshotPersisted(page);
    await page.goto('/app/admin/users');
    await expect(page.getByTestId('workspace-tab')).toHaveCount(2);

    // Activate the items window and give it page-local state (a filter).
    await page.getByTestId('workspace-tab').first().click();
    await expect(page).toHaveURL(/\/app\/inventory\/items$/, {
      timeout: 10000,
    });
    await activePanel(page).getByLabel(t.inventoryMaster.code).fill('0002');
    await expect(
      activePanel(page).getByRole('link', { name: 'ITM-0002' }),
    ).toBeVisible();

    // Switch away and back — the filter and the grid state survived because
    // the hidden window stayed mounted.
    await page.getByTestId('workspace-tab').nth(1).click();
    await expect(page).toHaveURL(/\/app\/admin\/users$/, { timeout: 10000 });
    await expect(activePanel(page).getByTestId('users-page')).toBeVisible();

    await page.getByTestId('workspace-tab').first().click();
    await expect(page).toHaveURL(/\/app\/inventory\/items$/, {
      timeout: 10000,
    });
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
    // Seed a full 12-window snapshot BEFORE the app boots (paths the strict
    // restore accepts). addInitScript avoids racing the boot's own persistence
    // write, which would overwrite a post-load seed.
    await page.addInitScript(
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

    // The first (and only) navigation is already the 13th address: the cap
    // must answer with a dialog instead of a silent eviction.
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
    await expect(page).toHaveURL(/\/app\/admin\/users$/, { timeout: 10000 });
    await expect(page.getByTestId('workspace-tab')).toHaveCount(12);
  });

  test('a dirty window only closes through its confirmation (W-05)', async ({
    page,
  }) => {
    await page.goto('/app/inventory/items/new');
    const form = activePanel(page).getByTestId('item-form');
    await expect(form).toBeVisible();
    await activePanel(page)
      .getByRole('textbox', { name: t.inventoryMaster.code, exact: true })
      .fill('0001');

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
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10000 });
    await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
    await expect(page.getByTestId('workspace-tab').first()).toHaveAttribute(
      'data-window-path',
      '/app',
    );
  });
});

test.describe('workspace windows — shortcuts (§4.8)', () => {
  /**
   * The dock handler is a plain `window` keydown listener (§4.8). Dispatching
   * the bubbling, cancelable KeyboardEvent exercises the exact chain the jsdom
   * unit tests cover (listener → resolver → provider → URL mirror). CI runs
   * proved the chain works end-to-end in the real browser (activation, URL
   * mirror and clean close all land within ~2s of the synthetic event).
   *
   * URL assertions use the polling `toHaveURL` matcher with a REGEX pattern:
   * the mirror navigates with `history.replaceState`, and by the time the
   * assertion runs the URL has usually ALREADY changed — waitForURL's
   * navigation-event subscription then waits for a same-document navigation
   * that already happened and times out, while toHaveURL simply polls. A
   * regex (never a double-star glob string!) is required: toHaveURL resolves
   * glob strings against the baseURL into a literal, unmatchable URL.
   */
  function sendShortcut(page: Page, key: string) {
    return page.evaluate((shortcutKey) => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: shortcutKey,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, key);
  }

  test.beforeEach(async ({ page }) => {
    await installApiStub(page);
    await page.goto('/app/inventory/items');
    await expectSnapshotPersisted(page);
    await page.goto('/app/admin/users');
    await expect(page.getByTestId('workspace-tab')).toHaveCount(2);
  });

  test('Alt+1 jumps to the first window, Alt+W closes the active one', async ({
    page,
  }) => {
    await sendShortcut(page, '1');
    await expect(page.getByTestId('workspace-tab').first()).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 5000 },
    );
    await expect(page).toHaveURL(/\/app\/inventory\/items$/, {
      timeout: 10000,
    });

    // RTL: next window (ArrowLeft) → users, then Alt+W on that CLEAN window
    // closes it immediately (no dialog) and the mirror falls back to items.
    await sendShortcut(page, 'ArrowLeft');
    await expect(
      page.getByTestId('workspace-dock'),
      'the dock must stay mounted (ready must not flip) after Alt+1',
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByTestId('workspace-tab').nth(1),
      'ArrowLeft (RTL next) must select the users tab',
    ).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    await expect(page).toHaveURL(/\/app\/admin\/users$/, { timeout: 10000 });
    await sendShortcut(page, 'w');
    await expect(page).toHaveURL(/\/app\/inventory\/items$/, {
      timeout: 10000,
    });
    await expect(page.getByTestId('workspace-tab')).toHaveCount(1);
  });

  test('Alt+Arrow cycles windows in RTL order', async ({ page }) => {
    // Active is the second (users). ArrowRight = previous in RTL.
    await sendShortcut(page, 'ArrowRight');
    await expect(page.getByTestId('workspace-tab').first()).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 5000 },
    );
    await expect(page).toHaveURL(/\/app\/inventory\/items$/, {
      timeout: 10000,
    });
    await sendShortcut(page, 'ArrowRight'); // wraps to the last
    await expect(page.getByTestId('workspace-tab').nth(1)).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 5000 },
    );
    await expect(page).toHaveURL(/\/app\/admin\/users$/, { timeout: 10000 });
    await sendShortcut(page, 'ArrowLeft'); // wraps to the first
    await expect(page.getByTestId('workspace-tab').first()).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 5000 },
    );
    await expect(page).toHaveURL(/\/app\/inventory\/items$/, {
      timeout: 10000,
    });
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
