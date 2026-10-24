import { expect, test } from '@playwright/test';
import { t } from '../src/lib/i18n';
import { installApiStub } from './fixtures/api';
import { createSeed } from './fixtures/seed';

/**
 * Items grid — two text filters, one select filter and a server-owned
 * `itemGroupId` query kept in the URL (`items-page.tsx`).
 */

const seed = createSeed();

test.describe('items grid — filters and the server-owned group query', () => {
  test.beforeEach(async ({ page }) => {
    await installApiStub(page);
    await page.goto('/app/inventory/items');
    await expect(page.getByTestId('items-page')).toBeVisible();
    await expect(page.getByRole('link', { name: 'ITM-0001' })).toBeVisible();
  });

  test('filters by code and by item kind', async ({ page }) => {
    await page.getByLabel(t.inventoryMaster.code).fill('0002');
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      t.table.filters.resultSummary
        .replace('{filtered}', '1')
        .replace('{total}', String(seed.items.length)),
    );
    await expect(page.getByRole('link', { name: 'ITM-0002' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ITM-0001' })).toHaveCount(0);

    await page.getByLabel(t.inventoryMaster.code).fill('');
    await page
      .getByLabel(t.inventoryMaster.itemKind)
      .selectOption({ label: t.inventoryMaster.itemKinds.goods });

    await expect(page.getByRole('link', { name: 'ITM-0001' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ITM-0003' })).toHaveCount(0);
  });

  test('the group selector stays a server query in the URL', async ({
    page,
  }) => {
    await page
      .getByLabel(t.inventoryMaster.itemGroupFilter)
      .selectOption({ label: 'PAPER — کاغذ' });

    await expect(page).toHaveURL(/itemGroupId=grp-2/);
    await expect(page.getByRole('link', { name: 'ITM-0003' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ITM-0001' })).toHaveCount(0);
  });
});
