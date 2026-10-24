import { expect, test, type Page } from '@playwright/test';
import { t } from '../src/lib/i18n';
import { installApiStub } from './fixtures/api';
import { createSeed } from './fixtures/seed';

/**
 * Users grid — the reference client-filtered page
 * (`docs/frontend/data-table.md` §۵.۲).
 *
 * Every assertion uses a role or a documented `data-testid`, never a CSS
 * class, so a styling refactor cannot silently invalidate the suite.
 */

function summary(filtered: number, total: number): string {
  return t.table.filters.resultSummary
    .replace('{filtered}', String(filtered))
    .replace('{total}', String(total));
}

const totalUsers = createSeed().users.length;

function searchBox(page: Page) {
  return page.getByRole('searchbox', { name: t.table.filters.searchLabel });
}

test.describe('users grid — search, column filters, reset', () => {
  test.beforeEach(async ({ page }) => {
    await installApiStub(page);
    await page.goto('/app/admin/users');
    await expect(page.getByTestId('users-page')).toBeVisible();
    await expect(page.getByTestId('data-table-toolbar')).toBeVisible();
    // The bounded read answered before the assertions start.
    await expect(page.getByRole('link', { name: 'alice' })).toBeVisible();
  });

  test('renders the bounded read with one result summary', async ({ page }) => {
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(totalUsers, totalUsers),
    );
    await expect(page.getByTestId('data-table-reset-filters')).toHaveCount(0);
  });

  test('global search narrows the rows and matches Arabic/Persian yeh', async ({
    page,
  }) => {
    // The fixture stores «علي» with an ARABIC YEH; the operator types the
    // Persian «علی». A raw `includes` would return nothing — which is exactly
    // the bug the normalizer exists to prevent.
    await searchBox(page).fill('علی');

    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(1, totalUsers),
    );
    await expect(page.getByRole('link', { name: 'علي' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'alice' })).toHaveCount(0);
  });

  test('a text column filter composes with the global search', async ({
    page,
  }) => {
    await page.getByLabel(t.usersAdmin.username).fill('a');
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(3, totalUsers), // alice, carol, dave
    );

    await page.getByLabel(t.usersAdmin.status).selectOption('true');
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(2, totalUsers), // alice, carol
    );
    await expect(page.getByRole('link', { name: 'dave' })).toHaveCount(0);
  });

  test('an inactive status filter shows only disabled accounts', async ({
    page,
  }) => {
    await page.getByLabel(t.usersAdmin.status).selectOption('false');

    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(2, totalUsers), // bob, dave
    );
    await expect(page.getByRole('link', { name: 'bob' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'alice' })).toHaveCount(0);
  });

  test('reset clears search and every column filter at once', async ({
    page,
  }) => {
    await searchBox(page).fill('a');
    await page.getByLabel(t.usersAdmin.status).selectOption('true');
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(2, totalUsers),
    );

    await page.getByTestId('data-table-reset-filters').click();

    await expect(searchBox(page)).toHaveValue('');
    await expect(page.getByLabel(t.usersAdmin.status)).toHaveValue('');
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(totalUsers, totalUsers),
    );
    await expect(page.getByTestId('data-table-reset-filters')).toHaveCount(0);
  });

  test('a no-match search offers a clear action instead of an empty table', async ({
    page,
  }) => {
    await searchBox(page).fill('zzz-not-a-user');

    await expect(page.getByText(t.table.filters.noMatchTitle)).toBeVisible();
    await expect(page.getByText(t.table.filters.noMatchBody)).toBeVisible();

    await page.getByTestId('data-table-clear-filters').click();

    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(totalUsers, totalUsers),
    );
    await expect(page.getByRole('link', { name: 'alice' })).toBeVisible();
  });

  test('sorting a column keeps the filtered rows and reports aria-sort', async ({
    page,
  }) => {
    const header = page.getByRole('button', { name: t.usersAdmin.username });
    await header.click();

    const sortedHeader = page.getByRole('columnheader', {
      name: t.usersAdmin.username,
    });
    await expect(sortedHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.getByTestId('data-table-filter-summary')).toContainText(
      summary(totalUsers, totalUsers),
    );
  });
});
