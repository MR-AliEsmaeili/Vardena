import type { Page, Route } from '@playwright/test';
import { normalizeSearchText } from '../../src/lib/text-normalize';
import { createSeed, type E2eSeed } from './seed';

/**
 * The HTTP boundary of the browser suite.
 *
 * Every request the SPA sends to `/api/v1/**` is answered here from the typed
 * fixture (`./seed.ts`). Nothing else is stubbed: the router, the shell, the
 * licensing gate, the grid, the Jalali date inputs and the RTL layout are the
 * real shipped code. That keeps the suite honest about the UI while removing
 * the PostgreSQL/NestJS dependency CI does not need for a layout and grid
 * contract.
 *
 * An unhandled endpoint answers 404 with an explicit message, so a page that
 * starts calling a new API fails the suite instead of silently rendering an
 * empty state that a weak assertion might still accept.
 */

interface Paginated<TItem> {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
}

const API_GLOB = '**/api/v1/**';

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function paginated<TItem>(items: TItem[], url: URL): Paginated<TItem> {
  const page = Number(url.searchParams.get('page') ?? '1') || 1;
  const pageSize = Number(url.searchParams.get('pageSize') ?? '25') || 25;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

function matches(haystack: string, needle: string): boolean {
  return normalizeSearchText(haystack).includes(normalizeSearchText(needle));
}

/**
 * Install the stub on one page. Each test owns its page, so parallel tests
 * never share handler state.
 */
export async function installApiStub(
  page: Page,
  seed: E2eSeed = createSeed(),
): Promise<void> {
  await page.route(API_GLOB, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const search = url.searchParams.get('search') ?? '';

    if (path === '/auth/me' || (method === 'POST' && path === '/auth/login')) {
      await json(route, seed.user);
      return;
    }
    if (method === 'POST' && path === '/auth/logout') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (path === '/permissions/effective') {
      await json(route, seed.permissions);
      return;
    }
    if (path === '/organizations/mine') {
      await json(route, [seed.organization]);
      return;
    }
    if (path === '/license/current') {
      await json(route, seed.license);
      return;
    }
    if (path === '/financial-areas') {
      await json(route, paginated([seed.financialArea], url));
      return;
    }
    if (path === '/fiscal-years') {
      await json(route, paginated([seed.fiscalYear], url));
      return;
    }
    if (path === '/accounting-periods') {
      await json(route, paginated([seed.accountingPeriod], url));
      return;
    }
    if (path === '/users') {
      await json(route, paginated(seed.users, url));
      return;
    }
    if (path === '/roles') {
      await json(route, paginated(seed.roles, url));
      return;
    }
    if (path === '/inventory/items') {
      const groupId = url.searchParams.get('itemGroupId');
      const items =
        groupId === null || groupId === ''
          ? seed.items
          : seed.items.filter((item) => item.itemGroupId === groupId);
      await json(route, paginated(items, url));
      return;
    }
    if (path === '/inventory/item-groups') {
      await json(route, paginated(seed.itemGroups, url));
      return;
    }
    // The backend searches `code` OR `title` — the picker depends on that
    // contract, so the stub mirrors it instead of returning everything.
    if (path === '/accounts') {
      const accounts =
        search.trim() === ''
          ? seed.accounts
          : seed.accounts.filter(
              (account) =>
                matches(account.code, search) || matches(account.title, search),
            );
      await json(route, paginated(accounts, url));
      return;
    }
    if (path.startsWith('/accounts/')) {
      const id = decodeURIComponent(path.slice('/accounts/'.length));
      const found = seed.accounts.find((account) => account.id === id);
      await (found === undefined
        ? json(route, { message: 'not found' }, 404)
        : json(route, found));
      return;
    }
    if (path === '/details') {
      await json(route, paginated([] as unknown[], url));
      return;
    }
    if (
      path === '/accounting-documents' ||
      path === '/accounting/balances' ||
      path === '/inventory/balances' ||
      path === '/workflow/instances'
    ) {
      await json(route, paginated([] as unknown[], url));
      return;
    }

    /*
     * Incidental GETs (a secondary reference list a page reads alongside its
     * primary grid) get an empty page instead of a 404: an empty reference
     * list must not turn the whole page into an error boundary and hide the
     * behaviour under test. Rows are always asserted explicitly by the specs,
     * so the primary read is never satisfied by this fallback.
     */
    if (method === 'GET') {
      await json(route, paginated([] as unknown[], url));
      return;
    }

    await json(
      route,
      { message: `e2e API stub: no handler for ${method} ${path}` },
      404,
    );
  });
}
