import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/lib/i18n';
import { installApiStub } from './fixtures/api';

/**
 * The three widths the grid standard and the reported layout defects care
 * about: 360px (phone), 768px (tablet) and 1280px (desktop).
 *
 * The guard is `documentElement.scrollWidth <= innerWidth + 1`: a grid that is
 * too dense must scroll INSIDE its own wrapper, never drag the whole RTL page
 * sideways. That horizontal page scroll was one of the reported defects, so it
 * is asserted rather than eyeballed.
 */

function summary(filtered: number, total: number): string {
  return t.table.filters.resultSummary
    .replace('{filtered}', String(filtered))
    .replace('{total}', String(total));
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.scrollWidth,
    `page scrolls horizontally: ${overflow.scrollWidth}px > ${overflow.innerWidth}px`,
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

test.describe('360px — phone', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('the dashboard does not scroll the page sideways', async ({ page }) => {
    await installApiStub(page);
    await page.goto('/app');

    await expect(
      page.getByRole('heading', { name: t.dashboard.title }),
    ).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test('the users grid keeps its controls inside the viewport', async ({
    page,
  }) => {
    await installApiStub(page);
    await page.goto('/app/admin/users');
    await expect(page.getByRole('link', { name: 'alice' })).toBeVisible();

    // Usable, not merely present: filling it scrolls it into view and the
    // grid answers, so the control is never trapped outside the viewport.
    await page
      .getByRole('searchbox', { name: t.table.filters.searchLabel })
      .fill('alice');
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(1, 6),
    );
    await expectNoPageOverflow(page);
  });
});

test.describe('768px — tablet', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test('the items grid wraps its toolbar without overflowing', async ({
    page,
  }) => {
    await installApiStub(page);
    await page.goto('/app/inventory/items');
    await expect(page.getByRole('link', { name: 'ITM-0001' })).toBeVisible();

    await page
      .getByRole('searchbox', { name: t.table.filters.searchLabel })
      .fill('ITM-0002');
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(1, 4),
    );
    await expectNoPageOverflow(page);
  });
});

test.describe('1280px — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the sidebar collapses to the icon rail and expands again', async ({
    page,
  }) => {
    await installApiStub(page);
    await page.goto('/app/admin/users');
    await expect(page.getByRole('link', { name: 'alice' })).toBeVisible();

    const navigation = page.locator('#app-navigation');
    await expect(navigation).toBeVisible();
    const expandedWidth = (await navigation.boundingBox())?.width ?? 0;

    await page.getByTestId('sidebar-toggle').click();
    await expect
      .poll(async () => (await navigation.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(80);
    expect(expandedWidth).toBeGreaterThan(120);

    // The rail keeps the same handle, now expanding instead of collapsing.
    await expect(
      page.getByRole('button', { name: t.nav.expandSidebar }),
    ).toBeVisible();
    await page.getByRole('button', { name: t.nav.expandSidebar }).click();
    await expect
      .poll(async () => (await navigation.boundingBox())?.width ?? 0)
      .toBeGreaterThan(120);

    await expectNoPageOverflow(page);
  });

  test('the roles grid stays inside the desktop width', async ({ page }) => {
    await installApiStub(page);
    await page.goto('/app/admin/roles');
    await expect(page.getByRole('link', { name: 'Accountant' })).toBeVisible();
    await expectNoPageOverflow(page);
  });
});
