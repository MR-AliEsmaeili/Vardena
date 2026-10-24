import { expect, test } from '@playwright/test';
import { t } from '../src/lib/i18n';
import { installApiStub } from './fixtures/api';

/**
 * Linked «کد حساب / نام حساب» cell of a voucher line (FE-UX-08 §8.4).
 *
 * The unit suite (`account-code-name-field.test.tsx`) pins the component
 * contract in jsdom; this spec proves the same behaviour inside the real
 * `DetailGrid` scroll container, where the suggestion popup must escape the
 * cell and the arrow keys must not steal row navigation.
 */

test.describe('document line — linked account code and name', () => {
  test.beforeEach(async ({ page }) => {
    await installApiStub(page);
    await page.goto('/app/accounting/documents/new');
    await expect(
      page.getByLabel(t.documents.accountCode).first(),
    ).toBeVisible();
  });

  test('typing a code fills the name and typing a name fills the code', async ({
    page,
  }) => {
    const code = page.getByLabel(t.documents.accountCode).first();
    const title = page.getByLabel(t.documents.accountName).first();

    await code.fill('1010');
    await expect(title).toHaveValue('موجودی نقد');

    await title.fill('هزینه اجاره');
    await expect(code).toHaveValue('5010');
    await expect(title).toHaveValue('هزینه اجاره');

    // Clearing one half clears the whole selection: a code without its name
    // (or the reverse) is never submitted.
    await code.fill('');
    await expect(title).toHaveValue('');
  });

  test('an aggregate account is findable but cannot be selected', async ({
    page,
  }) => {
    const code = page.getByLabel(t.documents.accountCode).first();
    const title = page.getByLabel(t.documents.accountName).first();

    await code.fill('1');
    const suggestions = page.getByTestId('account-suggestions');
    await expect(suggestions).toBeVisible();

    const aggregate = suggestions.getByRole('option', { name: /دارایی‌ها/ });
    await expect(aggregate).toHaveAttribute('data-postable', 'false');
    await expect(aggregate).toHaveAttribute('aria-disabled', 'true');

    // `aria-disabled` is what makes the row non-selectable for a real user
    // (and for Playwright's actionability check), so the click is dispatched
    // with `force` — the point is to prove the component itself refuses the
    // selection, not that the browser blocks a pointer event.
    await aggregate.click({ force: true });
    await expect(code).toHaveValue('1');
    await expect(title).toHaveValue('');
    await expect(suggestions).toBeVisible();

    // A posting leaf of the same term stays selectable.
    const postable = suggestions.getByRole('option', { name: /موجودی نقد/ });
    await expect(postable).toHaveAttribute('data-postable', 'true');
    await postable.click();
    await expect(code).toHaveValue('1010');
    await expect(title).toHaveValue('موجودی نقد');
  });

  test('the suggestion list is reachable from the keyboard', async ({
    page,
  }) => {
    const code = page.getByLabel(t.documents.accountCode).first();
    await code.fill('10');

    const suggestions = page.getByTestId('account-suggestions');
    await expect(suggestions).toBeVisible();
    // Wait for the debounced server answer, not only for the popup shell.
    await expect(suggestions.getByRole('option').first()).toBeVisible();

    await code.press('ArrowDown');
    await expect(suggestions.getByRole('option').first()).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await code.press('Enter');
    await expect(suggestions).toHaveCount(0);

    // Enter committed the highlighted row: the cell holds a real resolved
    // pair, not the half-typed term the operator left behind.
    const title = page.getByLabel(t.documents.accountName).first();
    await expect(code).toHaveValue('1010');
    await expect(title).toHaveValue('موجودی نقد');
  });
});
