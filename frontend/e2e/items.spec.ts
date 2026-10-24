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
    // Reload with the network recorded: if the reference list never arrives,
    // the failure message must say which scoped reads actually happened.
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/v1')) {
        apiCalls.push(`${url.pathname}${url.search}`);
      }
    });
    await page.reload();
    await expect(page.getByRole('link', { name: 'ITM-0001' })).toBeVisible();

    const groupFilter = page.getByTestId('item-group-filter');
    await expect(groupFilter).toBeVisible();

    const readState = () =>
      page.evaluate(() => {
        const select = document.querySelector<HTMLSelectElement>(
          '[data-testid="item-group-filter"]',
        );
        return {
          disabled: select?.disabled ?? null,
          labels: select
            ? [...select.options].map((option) => option.label)
            : [],
        };
      });

    // The reference list is a separate read: wait for the real option instead
    // of selecting by display text (which retries against a stale list).
    await expect(async () => {
      const state = await readState();
      expect(
        state.labels.join(' | '),
        `calls=${apiCalls.join(' , ')} state=${JSON.stringify(state)}`,
      ).toContain('PAPER');
    }).toPass({ timeout: 15_000 });

    const options = await groupFilter.locator('option').evaluateAll((entries) =>
      entries.map((entry) => ({
        value: (entry as HTMLOptionElement).value,
        label: (entry as HTMLOptionElement).label,
      })),
    );
    const paper = options.find((option) => option.label.includes('PAPER'));
    expect(
      paper,
      `options=${JSON.stringify(options)} calls=${apiCalls.join(' , ')}`,
    ).toBeDefined();
    if (paper === undefined) return;

    await groupFilter.selectOption(paper.value);
    await expect(page).toHaveURL(new RegExp(`itemGroupId=${paper.value}`));

    await expect(page.getByRole('link', { name: 'ITM-0003' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ITM-0001' })).toHaveCount(0);
  });
});
