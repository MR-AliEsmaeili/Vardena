import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import * as identity from '@/api/identity.api';
import * as api from '@/api/owner.api';
import type { AuditEvent, AuditPage, Customer } from '@/api/contracts';
import { o } from '@/lib/owner-i18n';
import { t } from '@/lib/i18n';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/owner.api', () => ({
  customer: vi.fn(),
  auditEvents: vi.fn(),
  auditArchiveStatus: vi.fn(),
  auditArchiveBatches: vi.fn(),
  createAuditArchiveBatch: vi.fn(),
  verifyAuditArchive: vi.fn(),
  recoverAuditArchive: vi.fn(),
}));

const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const admin = {
  id: ulid,
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};
const auditPerms = ['customers.view', 'audit.view'];

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: ulid,
    actorId: ulid,
    eventType: 'CUSTOMER_UPDATED',
    targetType: 'Customer',
    targetId: ulid,
    occurredAt: '2026-10-15T10:00:00.000Z',
    outcome: 'SUCCESS',
    reason: null,
    beforeState: { displayName: 'قدیم' },
    afterState: { displayName: 'جدید' },
    ...overrides,
  };
}

function page(items: AuditEvent[], hasNext = false): AuditPage {
  return { items, page: 1, pageSize: 50, hasNext };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function mount(path: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </AppProviders>,
  );
}

const search = () => screen.getByTestId('location').textContent ?? '';
const lastQuery = () => {
  const calls = vi.mocked(api.auditEvents).mock.calls;
  return calls.at(-1)?.[0];
};

function grant(permissions: string[]) {
  vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
    permissions,
  });
}

beforeEach(() => {
  vi.mocked(identity.getCurrentUser).mockResolvedValue(admin);
  grant(auditPerms);
  vi.mocked(api.auditEvents).mockResolvedValue(page([event()]));
});

describe('audit explorer access', () => {
  it('shows forbidden and never calls the audit API without audit.view', async () => {
    grant(['customers.view']);
    mount('/app/audit?eventType=CUSTOMER_UPDATED');
    expect(await screen.findByText(o.forbidden)).toBeInTheDocument();
    expect(api.auditEvents).not.toHaveBeenCalled();
  });
});

describe('Jalali audit display and filter entry', () => {
  it('shows Tehran/Persian Instant display, accepts a Jalali range and sends UTC API bounds', async () => {
    const user = userEvent.setup();
    vi.mocked(api.auditEvents).mockResolvedValue(
      page([event({ occurredAt: '2026-10-08T21:00:00.000Z' })]),
    );
    mount('/app/audit');
    expect(
      await screen.findByText('۱۴۰۵/۰۷/۱۷ ۰۰:۳۰:۰۰ Asia/Tehran (UTC+03:30)'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(o.auditFrom), '۱۴۰۵/۰۷/۱۷');
    await user.type(screen.getByLabelText(o.auditTo), '۱۴۰۵/۰۷/۱۷');
    await user.click(screen.getByRole('button', { name: o.auditApply }));
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        page: 1,
        occurredFrom: '2026-10-08T20:30:00.000Z',
        occurredBefore: '2026-10-09T20:30:00.000Z',
      }),
    );
    expect(search()).toContain('dayZone=Asia%2FTehran');
  });

  it.each(['', '?from=2026-10-09&dayZone=Asia%2FTehran'])(
    'rejects an invalid Jalali draft without querying/widening prior bounds (%s)',
    async (initial) => {
      const user = userEvent.setup();
      mount(`/app/audit${initial}`);
      await screen.findByText('ویرایش مشتری');
      const calls = vi.mocked(api.auditEvents).mock.calls.length;
      await user.clear(screen.getByLabelText(o.auditFrom));
      await user.type(screen.getByLabelText(o.auditFrom), '۱۴۰۵/۱۲/۳۰');
      await user.click(screen.getByRole('button', { name: o.auditApply }));
      expect(await screen.findByText(o.auditDateInvalid)).toBeInTheDocument();
      expect(api.auditEvents).toHaveBeenCalledTimes(calls);
      expect(search()).toBe(initial);
    },
  );

  it('preserves the meaning of an old UTC deep link and labels its compatibility basis', async () => {
    mount('/app/audit?from=2026-10-09&to=2026-10-09');
    await screen.findByText('ویرایش مشتری');
    expect(screen.getByLabelText(o.auditFrom)).toHaveValue('۱۴۰۵/۰۷/۱۷');
    expect(screen.getByText(o.auditLegacyRangeHint)).toBeInTheDocument();
    expect(lastQuery()).toEqual({
      page: 1,
      occurredFrom: '2026-10-09T00:00:00.000Z',
      occurredBefore: '2026-10-10T00:00:00.000Z',
    });
  });
});

describe('audit explorer filters', () => {
  it('sends the URL filters and page to the backend, not client-side filtering', async () => {
    mount('/app/audit?eventType=CUSTOMER_UPDATED&targetType=Customer&page=3');
    expect(await screen.findByText('ویرایش مشتری')).toBeInTheDocument();
    expect(lastQuery()).toEqual({
      page: 3,
      eventType: 'CUSTOMER_UPDATED',
      targetType: 'Customer',
    });
  });

  it('applies drafted filters to the URL and resets pagination to page one', async () => {
    const user = userEvent.setup();
    mount('/app/audit?outcome=SUCCESS&page=3');
    await screen.findByText('ویرایش مشتری');

    const eventType = screen.getByLabelText(o.auditEventType);
    await user.type(eventType, 'AUTH_LOGIN');
    await user.click(screen.getByRole('button', { name: o.auditApply }));

    await waitFor(() =>
      expect(search()).toBe('?eventType=AUTH_LOGIN&outcome=SUCCESS'),
    );
    expect(lastQuery()).toEqual({
      page: 1,
      eventType: 'AUTH_LOGIN',
      outcome: 'SUCCESS',
    });
  });

  it('trims a typed draft when applied, so the URL and the request are canonical', async () => {
    const user = userEvent.setup();
    mount('/app/audit');
    await screen.findByText('ویرایش مشتری');
    await user.type(screen.getByLabelText(o.auditEventType), '  AUTH_LOGIN  ');
    await user.click(screen.getByRole('button', { name: o.auditApply }));

    await waitFor(() => expect(search()).toBe('?eventType=AUTH_LOGIN'));
    expect(lastQuery()).toEqual({ page: 1, eventType: 'AUTH_LOGIN' });
  });

  it('keeps an unapplied draft when paging, and the URL keeps the applied filters', async () => {
    const user = userEvent.setup();
    vi.mocked(api.auditEvents).mockResolvedValue(page([event()], true));
    mount('/app/audit?outcome=SUCCESS');
    await screen.findByText('ویرایش مشتری');
    await user.type(screen.getByLabelText(o.auditActorId), ulid);

    const nav = screen.getByRole('navigation', { name: o.page });
    await user.click(within(nav).getByRole('button', { name: o.next }));

    await waitFor(() => expect(search()).toBe('?outcome=SUCCESS&page=2'));
    expect(lastQuery()).toEqual({ page: 2, outcome: 'SUCCESS' });
    expect(screen.getByLabelText(o.auditActorId)).toHaveValue(ulid);
  });

  it('rejects an overflowing historical upper day without dropping the accepted bound', async () => {
    const user = userEvent.setup();
    mount('/app/audit?to=9999-12-30');
    await screen.findByText('ویرایش مشتری');
    const calls = vi.mocked(api.auditEvents).mock.calls.length;
    fireEvent.change(screen.getByLabelText(o.auditTo), {
      target: { value: '9999-12-31' },
    });
    await user.click(screen.getByRole('button', { name: o.auditApply }));

    expect(
      await screen.findByText(o.auditDateUpperBoundUnsupported),
    ).toBeInTheDocument();
    expect(search()).toBe('?to=9999-12-30');
    expect(api.auditEvents).toHaveBeenCalledTimes(calls);
    expect(lastQuery()).toMatchObject({
      occurredBefore: '9999-12-31T00:00:00.000Z',
    });
  });

  it('does not query while a draft is typed, only when applied', async () => {
    const user = userEvent.setup();
    mount('/app/audit');
    await screen.findByText('ویرایش مشتری');
    const callsBefore = vi.mocked(api.auditEvents).mock.calls.length;
    await user.type(screen.getByLabelText(o.auditActorId), ulid);
    expect(vi.mocked(api.auditEvents).mock.calls.length).toBe(callsBefore);
  });

  it('reset clears the draft, the URL and every stale filter', async () => {
    const user = userEvent.setup();
    mount(
      '/app/audit?eventType=AUTH_LOGIN&outcome=DENIED&from=2026-10-01&page=2',
    );
    await screen.findByText('ویرایش مشتری');
    expect(screen.getByLabelText(o.auditEventType)).toHaveValue('AUTH_LOGIN');

    await user.click(screen.getByRole('button', { name: o.auditReset }));

    await waitFor(() => expect(search()).toBe(''));
    expect(screen.getByLabelText(o.auditEventType)).toHaveValue('');
    expect(screen.getByLabelText(o.auditOutcome)).toHaveValue('');
    expect(screen.getByLabelText(o.auditFrom)).toHaveValue('');
    expect(lastQuery()).toEqual({ page: 1 });
  });

  it('removes a single applied filter from the URL when it is reset', async () => {
    const user = userEvent.setup();
    mount('/app/audit');
    await screen.findByText('ویرایش مشتری');
    await user.selectOptions(screen.getByLabelText(o.auditOutcome), 'DENIED');
    await user.click(screen.getByRole('button', { name: o.auditApply }));
    await waitFor(() => expect(search()).toBe('?outcome=DENIED'));
    await user.click(screen.getByRole('button', { name: o.auditReset }));
    await waitFor(() => expect(search()).toBe(''));
    expect(screen.getByLabelText(o.auditOutcome)).toHaveValue('');
  });

  it('rejects malformed input before any request and explains it in Persian', async () => {
    const user = userEvent.setup();
    mount('/app/audit');
    await screen.findByText('ویرایش مشتری');
    await user.type(screen.getByLabelText(o.auditEventType), 'customer%');
    await user.click(screen.getByRole('button', { name: o.auditApply }));

    expect(
      await screen.findByText(o.auditEventTypeInvalid),
    ).toBeInTheDocument();
    expect(search()).toBe('');
    expect(
      vi
        .mocked(api.auditEvents)
        .mock.calls.every(([q]) => q.eventType === undefined),
    ).toBe(true);
  });

  it('does not query a malformed URL and says so instead of showing stale rows', async () => {
    mount('/app/audit?actorId=%25%25&page=1');
    expect(await screen.findByText(o.auditInvalidFilters)).toBeInTheDocument();
    expect(api.auditEvents).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a repeated filter',
      '/app/audit?eventType=AUTH_LOGIN&eventType=AUTH_LOGOUT',
    ],
    ['an unknown parameter', '/app/audit?actor=01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ['a malformed page', '/app/audit?outcome=DENIED&page=abc'],
    ['a date before year 1000', '/app/audit?from=0999-01-01'],
    ['a padded event type', '/app/audit?eventType=%20AUTH_LOGIN%20'],
    ['a padded actor id', `/app/audit?actorId=%20${ulid}`],
    ['a plus-encoded padded target id', `/app/audit?targetId=${ulid}+`],
    ['an upper bound of 9999-12-31', '/app/audit?to=9999-12-31'],
    [
      'a skipped Tehran start midnight',
      '/app/audit?from=2022-03-22&dayZone=Asia%2FTehran',
    ],
    [
      'a skipped Tehran exclusive-end midnight',
      '/app/audit?to=2022-03-21&dayZone=Asia%2FTehran',
    ],
  ])(
    'refuses %s in the URL instead of showing silently different results',
    async (_label, path) => {
      mount(path);
      expect(
        await screen.findByText(o.auditInvalidFilters),
      ).toBeInTheDocument();
      expect(api.auditEvents).not.toHaveBeenCalled();
      expect(screen.queryByText('ویرایش مشتری')).toBeNull();
    },
  );

  it('shows the empty state for a filter with no matches', async () => {
    vi.mocked(api.auditEvents).mockResolvedValue(page([]));
    mount('/app/audit?eventType=AUTH_LOGOUT');
    expect(await screen.findByText(o.noResults)).toBeInTheDocument();
  });

  it('offers retry after a failed request', async () => {
    const user = userEvent.setup();
    vi.mocked(api.auditEvents).mockRejectedValueOnce(new Error('network'));
    mount('/app/audit');
    const retry = await screen.findByRole('button', { name: t.app.retry });
    await user.click(retry);
    expect(await screen.findByText('ویرایش مشتری')).toBeInTheDocument();
  });
});

describe('audit explorer pagination', () => {
  it('disables next when the backend reports no further rows, even on a full page', async () => {
    vi.mocked(api.auditEvents).mockResolvedValue(
      page(Array(50).fill(event()), false),
    );
    mount('/app/audit');
    await screen.findAllByText('ویرایش مشتری');
    const nav = screen.getByRole('navigation', { name: o.page });
    expect(within(nav).getByRole('button', { name: o.next })).toBeDisabled();
  });

  it('moves to page two through the URL when more rows exist', async () => {
    const user = userEvent.setup();
    vi.mocked(api.auditEvents).mockResolvedValue(page([event()], true));
    mount('/app/audit?outcome=SUCCESS');
    await screen.findByText('ویرایش مشتری');
    const nav = screen.getByRole('navigation', { name: o.page });
    await user.click(within(nav).getByRole('button', { name: o.next }));
    await waitFor(() => expect(search()).toBe('?outcome=SUCCESS&page=2'));
    expect(lastQuery()).toEqual({ page: 2, outcome: 'SUCCESS' });
  });
});

describe('audit explorer observations', () => {
  it('labels operator observations as observations and never as cryptographic proof', async () => {
    vi.mocked(api.auditEvents).mockResolvedValue(
      page([
        event({
          eventType: 'LICENSE_ISSUANCE_OBSERVED',
          targetType: 'OperationalRecord',
          afterState: {
            observedStatus: 'ISSUED',
            evidenceBasis: 'OPERATOR_OBSERVED',
          },
        }),
      ]),
    );
    const { container } = mount(
      '/app/audit?eventType=LICENSE_ISSUANCE_OBSERVED',
    );
    expect(await screen.findByText(o.auditObservedNote)).toBeInTheDocument();
    expect(
      screen.getByText(o.auditEventLabels.LICENSE_ISSUANCE_OBSERVED),
    ).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(
      /cryptographic(ally)? verified|signed artifact (was )?(issued|produced)|customer server (was )?contacted/i,
    );
    expect(o.auditEventLabels.LICENSE_ISSUANCE_OBSERVED).toContain('مشاهده');
  });
});

describe('customer trail link', () => {
  const customer: Customer = {
    id: ulid,
    customerCode: 'Acme.01',
    displayName: 'مشتری',
    status: 'ACTIVE',
    contractReference: 'HIDDEN',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    createdBy: ulid,
    updatedBy: ulid,
  } as Customer;

  it('links the customer detail to its exact audit trail for audit.view holders', async () => {
    vi.mocked(api.customer).mockResolvedValue(customer);
    mount(`/app/customers/${ulid}`);
    const link = await screen.findByRole('link', { name: o.auditCustomerLink });
    expect(
      screen.getAllByText('۱۴۰۵/۰۷/۲۳ ۰۳:۳۰:۰۰ Asia/Tehran (UTC+03:30)'),
    ).toHaveLength(2);
    expect(link).toHaveAttribute(
      'href',
      `/app/audit?targetType=Customer&targetId=${ulid}`,
    );
  });

  it('hides the trail link when audit.view is missing', async () => {
    grant(['customers.view']);
    vi.mocked(api.customer).mockResolvedValue(customer);
    mount(`/app/customers/${ulid}`);
    await screen.findByRole('heading', { name: 'مشتری' });
    expect(
      screen.queryByRole('link', { name: o.auditCustomerLink }),
    ).toBeNull();
  });
});

describe('OQ-77 audit retention display and archive controls', () => {
  const batchId = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
  const digestHex = 'a'.repeat(64);
  const bundleDigestHex = 'c'.repeat(64);
  const durableFileName = `batch-000001-${batchId}.json`;

  beforeEach(() => {
    vi.mocked(api.auditArchiveStatus).mockResolvedValue({
      asOf: '2026-10-17T12:00:00.000Z',
      policy: {
        appendOnly: true,
        minimumRetentionYears: 3,
        threeYearMinimumIsPurgeDate: false,
        unresolvedSecurityIncidentsExcludedFromCleanup: true,
        permanentSeparateArchiveInForce: true,
        automaticDestructivePurgeEnabled: false,
        archiveStorageBoundary:
          'INDEPENDENT_DURABLE_FILESYSTEM_STORE_AND_POSTGRES_LEDGER',
        cryptographicHardwareWormImplemented: false,
      },
      counts: {
        totalSourceEvents: 4,
        withinMinimumRetentionWindowCount: 3,
        pastMinimumRetentionFloorCount: 1,
        unresolvedSecurityIncidentCount: 1,
        pastFloorUnresolvedIncidentHoldCount: 1,
        archivedEventCount: 2,
        unarchivedEligibleEventCount: 2,
        archiveBatchCount: 1,
        durableStoreBatchCount: 1,
        durableStoreEventCount: 2,
        cleanupEligibleEventCount: 0,
      },
      integrity: {
        verified: true,
        durableStoreConfigured: true,
        durableStoreVerified: true,
        dbLedgerVerified: true,
        crossStoreConsistent: true,
        recoveryRequired: false,
        issueCode: null,
        issueMessage: null,
        latestBatchId: batchId,
        latestBatchDigestSha256: digestHex,
        latestBundleDigestSha256: bundleDigestHex,
        lastArchivedSequence: 2,
      },
    });
    vi.mocked(api.auditArchiveBatches).mockResolvedValue({
      items: [
        {
          id: batchId,
          batchNumber: 1,
          createdBy: ulid,
          createdAt: '2026-10-17T11:00:00.000Z',
          reason: 'بایگانی دوره‌ای ممیزی',
          firstSequence: 1,
          lastSequence: 2,
          eventCount: 2,
          retentionCutoffAt: '2026-10-16T00:00:00.000Z',
          previousBatchDigest: null,
          batchDigestSha256: digestHex,
          durableFileName,
          bundleDigestSha256: bundleDigestHex,
        },
      ],
      page: 1,
      pageSize: 50,
      hasNext: false,
    });
  });

  it('displays 3-year retention floor, unresolved security-incident hold badge, and archive badge without exposing archive controls to License Operator', async () => {
    grant(['customers.view', 'audit.view']);
    vi.mocked(api.auditEvents).mockResolvedValue(
      page([
        event({
          eventType: 'AUTH_LOGIN_FAILED',
          targetType: 'User',
          outcome: 'DENIED',
          occurredAt: '2023-10-08T21:00:00.000Z',
          minimumRetainedUntil: '2026-10-08T21:00:00.000Z',
          securityIncident: true,
          incidentStatus: 'UNRESOLVED',
          archived: true,
          archiveBatchId: batchId,
        }),
      ]),
    );
    mount('/app/audit');
    expect(
      await screen.findByText(o.auditSecurityIncidentHoldBadge),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${o.auditArchivedBadge} (${batchId})`),
    ).toBeInTheDocument();
    expect(screen.getByText(o.auditRetentionFloorLabel)).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: o.auditArchiveSectionTitle }),
    ).toBeNull();
    expect(api.auditArchiveStatus).not.toHaveBeenCalled();
    expect(api.auditArchiveBatches).not.toHaveBeenCalled();
  });

  it('renders archive status and batches for Owner Admin (audit.archive) and validates reason before creating a batch, verifying integrity, or recovering from durable store', async () => {
    const user = userEvent.setup();
    grant(['customers.view', 'audit.view', 'audit.archive']);
    vi.mocked(api.createAuditArchiveBatch).mockResolvedValue({
      status: 'ARCHIVED',
      archivedCount: 2,
      batch: {
        id: batchId,
        batchNumber: 2,
        createdBy: ulid,
        createdAt: '2026-10-17T12:00:00.000Z',
        reason: 'بایگانی رویدادهای جدید',
        firstSequence: 3,
        lastSequence: 4,
        eventCount: 2,
        retentionCutoffAt: '2026-10-17T10:00:00.000Z',
        previousBatchDigest: digestHex,
        batchDigestSha256: 'b'.repeat(64),
        durableFileName: `batch-000002-${batchId}.json`,
        bundleDigestSha256: 'd'.repeat(64),
      },
    });
    vi.mocked(api.verifyAuditArchive).mockResolvedValue({
      verified: true,
      batchCount: 2,
      verifiedEventCount: 4,
      latestBatchId: batchId,
      latestBatchDigestSha256: 'b'.repeat(64),
      latestBundleDigestSha256: 'd'.repeat(64),
      lastArchivedSequence: 4,
    });
    vi.mocked(api.recoverAuditArchive).mockResolvedValue({
      verified: true,
      recoveredBatchCount: 1,
      recoveredSourceEventCount: 2,
      recoveredLedgerEventCount: 2,
      rehydratedDurableBatchCount: 0,
      batchCount: 2,
      verifiedEventCount: 4,
      latestBatchId: batchId,
      latestBatchDigestSha256: 'b'.repeat(64),
      latestBundleDigestSha256: 'd'.repeat(64),
      lastArchivedSequence: 4,
    });

    mount('/app/audit');
    expect(
      await screen.findByText(o.auditArchiveSectionTitle),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(o.auditArchiveIntegrityVerified),
    ).toBeInTheDocument();
    expect(screen.getByText('بایگانی دوره‌ای ممیزی')).toBeInTheDocument();
    expect(
      screen.getByText(`#1 — ${batchId} (${durableFileName})`),
    ).toBeInTheDocument();

    // Missing reason is rejected in Persian before calling the API
    await user.click(
      screen.getByRole('button', { name: o.auditArchiveCreateBatch }),
    );
    expect(
      await screen.findByText(o.auditArchiveReasonRequired),
    ).toBeInTheDocument();
    expect(api.createAuditArchiveBatch).not.toHaveBeenCalled();

    // Creating a batch with a valid reason
    await user.type(
      screen.getByLabelText(o.auditArchiveReasonLabel),
      '  بایگانی رویدادهای جدید  ',
    );
    await user.click(
      screen.getByRole('button', { name: o.auditArchiveCreateBatch }),
    );
    expect(
      await screen.findByText(o.auditArchiveBatchCreatedSuccess),
    ).toBeInTheDocument();
    expect(api.createAuditArchiveBatch).toHaveBeenCalledWith({
      reason: 'بایگانی رویدادهای جدید',
    });

    // Verifying archive integrity with a valid reason
    await user.type(
      screen.getByLabelText(o.auditArchiveReasonLabel),
      'بررسی دوره‌ای یکپارچگی',
    );
    await user.click(
      screen.getByRole('button', { name: o.auditArchiveVerifyButton }),
    );
    expect(
      await screen.findByText(o.auditArchiveVerifiedSuccess),
    ).toBeInTheDocument();
    expect(api.verifyAuditArchive).toHaveBeenCalledWith({
      reason: 'بررسی دوره‌ای یکپارچگی',
    });

    // Recovering archive from independent durable store with a valid reason
    await user.type(
      screen.getByLabelText(o.auditArchiveReasonLabel),
      'بازیابی از مخزن پایدار پس از بازگردانی پایگاه‌داده',
    );
    await user.click(
      screen.getByRole('button', { name: o.auditArchiveRecoverButton }),
    );
    expect(
      await screen.findByText(o.auditArchiveRecoveredSuccess),
    ).toBeInTheDocument();
    expect(api.recoverAuditArchive).toHaveBeenCalledWith({
      reason: 'بازیابی از مخزن پایدار پس از بازگردانی پایگاه‌داده',
    });
  });
});
