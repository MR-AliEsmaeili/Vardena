import { expect, test } from '@playwright/test';
import { t } from '../src/lib/i18n';
import { installApiStub } from './fixtures/api';
import { createSeed } from './fixtures/seed';

/**
 * Roles grid — search-only light filtering.
 *
 * The roles endpoint has no `search` parameter, so the page relies on the
 * shared client-side search over the bounded read. The fixture's Persian
 * description proves the description column is searchable too.
 */

const totalRoles = createSeed().roles.length;

test.describe('roles grid — global search', () => {
  test.beforeEach(async ({ page }) => {
    await installApiStub(page);
    await page.goto('/app/admin/roles');
    await expect(page.getByTestId('roles-page')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Accountant' })).toBeVisible();
  });

  test('searches across name and description', async ({ page }) => {
    const search = page.getByRole('searchbox', {
      name: t.table.filters.searchLabel,
    });

    await search.fill('warehouse');
    await expect(
      page.getByRole('link', { name: 'Warehouse Clerk' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Accountant' })).toHaveCount(0);

    await search.fill('ثبت و مشاهده');
    await expect(page.getByRole('link', { name: 'Accountant' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Warehouse Clerk' }),
    ).toHaveCount(0);
  });

  test('the column filter and the reset action work together', async ({
    page,
  }) => {
    await page.getByLabel(t.rolesAdmin.roleName).fill('admin');
    await expect(
      page.getByRole('link', { name: 'System Administrator' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Accountant' })).toHaveCount(0);
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      t.table.filters.resultSummary
        .replace('{filtered}', '1')
        .replace('{total}', String(totalRoles)),
    );

    await page.getByTestId('data-table-reset-filters').click();
    await expect(page.getByLabel(t.rolesAdmin.roleName)).toHaveValue('');
    await expect(page.getByRole('link', { name: 'Accountant' })).toBeVisible();
  });
});
