import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDateTimeSettings, setDateTimeSettings } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { testFiscalYear } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountCreateForm } from './account-create-form';
import { ChartSetupForm } from './chart-setup-form';
import { PeriodCreateForm } from './period-create-form';

vi.mock('@/api/accounting.api', () => ({
  MAX_PAGE_SIZE: 500,
  createAccountingPeriod: vi.fn(),
  createAccount: vi.fn(),
  listAccounts: vi.fn(),
  createCodingStructureVersion: vi.fn(),
  publishCodingStructureVersion: vi.fn(),
  createAccountingConfiguration: vi.fn(),
  publishAccountingConfiguration: vi.fn(),
  getActiveCodingStructure: vi.fn(),
  getActiveAccountingConfiguration: vi.fn(),
  listCodingStructureVersions: vi.fn(),
  listAccountingConfigurations: vi.fn(),
}));

const mockPermissions = vi.hoisted(() => ({ codes: [] as string[] }));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: () => ({
    codes: mockPermissions.codes,
    loaded: true,
    has: (code: string) => mockPermissions.codes.includes(code),
    hasAll: (codes: readonly string[]) =>
      codes.every((c) => mockPermissions.codes.includes(c)),
    hasAny: (codes: readonly string[]) =>
      codes.some((c) => mockPermissions.codes.includes(c)),
  }),
}));
import { PERMISSIONS } from '@/features/permissions/permission-codes';
const BOTH_CONFIGURE = [
  PERMISSIONS.accounting.codingStructureConfigure,
  PERMISSIONS.accounting.accountingConfigurationConfigure,
];

const api = await import('@/api/accounting.api');

beforeEach(() => {
  vi.clearAllMocks();
  mockPermissions.codes = [...BOTH_CONFIGURE];
  vi.mocked(api.listCodingStructureVersions).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  } as never);
  vi.mocked(api.listAccountingConfigurations).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  } as never);
  vi.mocked(api.listAccounts).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  } as never);
  resetDateTimeSettings();
  setDateTimeSettings({ timeZone: 'Asia/Tehran' });
});

describe('PeriodCreateForm', () => {
  it('opens a period with Jalali dates sent as declared BusinessDate inputs', async () => {
    vi.mocked(api.createAccountingPeriod).mockResolvedValue({} as never);
    const user = userEvent.setup();
    renderWithProviders(
      <PeriodCreateForm
        organizationId="org-1"
        fiscalYears={[testFiscalYear]}
      />,
      { withProviders: false },
    );
    await user.selectOptions(
      screen.getByLabelText(t.masterData.fiscalYear),
      testFiscalYear.id,
    );
    await user.type(screen.getByLabelText(t.masterData.periodTitle), 'فروردین');
    await user.type(
      screen.getByLabelText(t.masterData.startDate),
      '1405/01/01',
    );
    await user.type(screen.getByLabelText(t.masterData.endDate), '1405/01/31');
    await user.click(
      screen.getByRole('button', { name: t.masterData.openPeriod }),
    );
    await waitFor(() =>
      expect(api.createAccountingPeriod).toHaveBeenCalledWith({
        organizationId: 'org-1',
        fiscalYearId: testFiscalYear.id,
        sequence: 1,
        title: 'فروردین',
        startDate: { calendar: 'JALALI', value: '1405-01-01' },
        endDate: { calendar: 'JALALI', value: '1405-01-31' },
      }),
    );
  });
});

describe('ChartSetupForm', () => {
  it('creates and publishes coding structure and configuration from the same user levels', async () => {
    vi.mocked(api.getActiveCodingStructure).mockResolvedValue(null);
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue(null);
    vi.mocked(api.createCodingStructureVersion).mockResolvedValue({
      id: 'cs-1',
    } as never);
    vi.mocked(api.publishCodingStructureVersion).mockResolvedValue({
      id: 'cs-1',
    } as never);
    vi.mocked(api.createAccountingConfiguration).mockResolvedValue({
      id: 'cfg-1',
    } as never);
    vi.mocked(api.publishAccountingConfiguration).mockResolvedValue({
      id: 'cfg-1',
    } as never);
    const user = userEvent.setup();
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });

    await user.type(
      await screen.findByLabelText(t.masterData.structureName),
      'پیکربندی اصلی',
    );
    const titles = screen.getAllByLabelText(
      new RegExp(t.masterData.levelTitle),
    );
    await user.type(titles[0]!, 'گروه');
    await user.type(titles[1]!, 'معین');
    await user.click(
      screen.getByRole('button', { name: t.masterData.activateChart }),
    );

    const expectedLevels = [
      {
        levelIndex: 1,
        title: 'گروه',
        digitLength: 2,
        defaultIsPostable: false,
      },
      { levelIndex: 2, title: 'معین', digitLength: 3, defaultIsPostable: true },
    ];
    await waitFor(() => {
      expect(api.createCodingStructureVersion).toHaveBeenCalledWith({
        organizationId: 'org-1',
        code: 'DEFAULT',
        maxDepth: 2,
        separator: '',
        levels: expectedLevels,
      });
      expect(api.publishCodingStructureVersion).toHaveBeenCalledWith(
        'org-1',
        'cs-1',
      );
      expect(api.createAccountingConfiguration).toHaveBeenCalledWith({
        organizationId: 'org-1',
        code: 'DEFAULT',
        name: 'پیکربندی اصلی',
        levels: expectedLevels,
      });
      expect(api.publishAccountingConfiguration).toHaveBeenCalledWith(
        'org-1',
        'cfg-1',
      );
    });
  });

  it('shows the ready state and creates nothing when both are already active', async () => {
    vi.mocked(api.getActiveCodingStructure).mockResolvedValue({
      id: 'cs-1',
    } as never);
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue({
      id: 'cfg-1',
    } as never);
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    expect(
      await screen.findByText(t.masterData.chartReady),
    ).toBeInTheDocument();
    expect(api.createCodingStructureVersion).not.toHaveBeenCalled();
    expect(api.createAccountingConfiguration).not.toHaveBeenCalled();
  });
});

describe('AccountCreateForm (local segment → backend-composed full code)', () => {
  // The acceptance structure, as the ACTIVE configuration defines it:
  // گروه 1 digit, کل 2 digits, معین 3 digits (معین postable by default).
  const ACTIVE_LEVELS = [
    { levelIndex: 1, title: 'گروه', digitLength: 1, defaultIsPostable: false },
    { levelIndex: 2, title: 'کل', digitLength: 2, defaultIsPostable: false },
    { levelIndex: 3, title: 'معین', digitLength: 3, defaultIsPostable: true },
  ];
  const GENERAL_101 = {
    id: 'gen-101',
    code: '101',
    localCode: '01',
    title: 'دارایی ثابت',
    level: 2,
    parentId: 'grp-1',
    isPostable: false,
    isActive: true,
  };

  function mockFormReads(parents: unknown[] = []) {
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue({
      levels: ACTIVE_LEVELS,
    } as never);
    vi.mocked(api.listAccounts).mockResolvedValue({
      items: parents,
      total: parents.length,
      page: 1,
      pageSize: 500,
    } as never);
  }

  async function renderForm() {
    const user = userEvent.setup();
    renderWithProviders(<AccountCreateForm organizationId="org-1" />, {
      withProviders: false,
    });
    const localCode = screen.getByLabelText(t.masterData.localCode);
    await waitFor(() => expect(localCode).toBeEnabled());
    return { user, localCode };
  }

  it('previews 101003 live from parent 101 + local 003 and sends only localCode', async () => {
    mockFormReads([GENERAL_101]);
    vi.mocked(api.createAccount).mockResolvedValue({} as never);
    const { user, localCode } = await renderForm();

    await screen.findByRole('option', { name: /101/ });
    await user.selectOptions(
      screen.getByLabelText(t.masterData.parentAccount),
      'gen-101',
    );
    await user.type(localCode, '003');
    expect(screen.getByText('101003')).toBeInTheDocument();
    await user.type(
      screen.getByLabelText(t.masterData.accountTitle),
      'تاسیسات',
    );
    await user.click(
      screen.getByRole('button', { name: t.masterData.createAccount }),
    );
    await waitFor(() =>
      expect(api.createAccount).toHaveBeenCalledWith({
        organizationId: 'org-1',
        localCode: '003',
        title: 'تاسیسات',
        parentId: 'gen-101',
        accountNature: 'DUAL',
        accountType: 'BALANCE_SHEET',
      }),
    );
  });

  it('a root segment is its whole code (preview 1, parentId null)', async () => {
    mockFormReads();
    vi.mocked(api.createAccount).mockResolvedValue({} as never);
    const { user, localCode } = await renderForm();

    await user.type(localCode, '1');
    await user.type(
      screen.getByLabelText(t.masterData.accountTitle),
      'دارایی‌ها',
    );
    await user.selectOptions(
      screen.getByLabelText(t.masterData.postableMode),
      'NO',
    );
    await user.click(
      screen.getByRole('button', { name: t.masterData.createAccount }),
    );
    await waitFor(() =>
      expect(api.createAccount).toHaveBeenCalledWith({
        organizationId: 'org-1',
        localCode: '1',
        title: 'دارایی‌ها',
        parentId: null,
        accountNature: 'DUAL',
        accountType: 'BALANCE_SHEET',
        isPostable: false,
      }),
    );
  });

  it('refuses a wrong-width segment in the form and never calls the API', async () => {
    mockFormReads([GENERAL_101]);
    const { user, localCode } = await renderForm();

    await screen.findByRole('option', { name: /101/ });
    await user.selectOptions(
      screen.getByLabelText(t.masterData.parentAccount),
      'gen-101',
    );
    await user.type(localCode, '03');
    await user.type(screen.getByLabelText(t.masterData.accountTitle), 'بدعرض');
    await user.click(
      screen.getByRole('button', { name: t.masterData.createAccount }),
    );
    // The configured width is named (hint + field error share the sentence).
    expect(
      await screen.findAllByText(
        t.masterData.localCodeLength.replace('{digits}', '3'),
      ),
    ).not.toHaveLength(0);
    expect(localCode).toHaveAttribute('aria-invalid', 'true');
    expect(api.createAccount).not.toHaveBeenCalled();
  });

  it('without an active configuration the form explains and cannot submit', async () => {
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue(null);
    vi.mocked(api.listAccounts).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 500,
    } as never);
    renderWithProviders(<AccountCreateForm organizationId="org-1" />, {
      withProviders: false,
    });
    expect(
      await screen.findByText(t.masterData.chartNotReadyForAccount),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.masterData.createAccount }),
    ).toBeDisabled();
    expect(api.createAccount).not.toHaveBeenCalled();
  });
});

import { ApiError } from '@/api/errors';

const LEVELS_RES = { items: [], total: 0, page: 1, pageSize: 100 };
function mockEmptySetup() {
  vi.mocked(api.getActiveCodingStructure).mockResolvedValue(null);
  vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue(null);
  vi.mocked(api.listCodingStructureVersions).mockResolvedValue(
    LEVELS_RES as never,
  );
  vi.mocked(api.listAccountingConfigurations).mockResolvedValue(
    LEVELS_RES as never,
  );
}
async function fillChartForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByLabelText(t.masterData.structureName),
    'پیکربندی اصلی',
  );
  const titles = screen.getAllByLabelText(new RegExp(t.masterData.levelTitle));
  await user.type(titles[0]!, 'گروه');
  await user.type(titles[1]!, 'معین');
}

describe('ChartSetupForm permissions', () => {
  it.each([
    ['coding only', [PERMISSIONS.accounting.codingStructureConfigure]],
    ['config only', [PERMISSIONS.accounting.accountingConfigurationConfigure]],
    ['neither', [] as string[]],
  ])(
    'with %s permission: explains missing permission and never runs the unauthorized side',
    async (_name, codes) => {
      mockPermissions.codes = [...codes];
      mockEmptySetup();
      vi.mocked(api.createCodingStructureVersion).mockResolvedValue({
        id: 'cs-1',
      } as never);
      vi.mocked(api.publishCodingStructureVersion).mockResolvedValue({
        id: 'cs-1',
      } as never);
      vi.mocked(api.createAccountingConfiguration).mockResolvedValue({
        id: 'cfg-1',
      } as never);
      vi.mocked(api.publishAccountingConfiguration).mockResolvedValue({
        id: 'cfg-1',
      } as never);
      const user = userEvent.setup();
      renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
        withProviders: false,
      });
      expect(
        await screen.findByText(t.masterData.setupMissingPermission),
      ).toBeInTheDocument();
      await fillChartForm(user);
      await user.click(
        screen.getByRole('button', { name: t.masterData.activateChart }),
      );
      const codingExpected = codes.includes(
        PERMISSIONS.accounting.codingStructureConfigure,
      )
        ? 1
        : 0;
      const configExpected = codes.includes(
        PERMISSIONS.accounting.accountingConfigurationConfigure,
      )
        ? 1
        : 0;
      await waitFor(() => {
        expect(api.createCodingStructureVersion).toHaveBeenCalledTimes(
          codingExpected,
        );
        expect(api.createAccountingConfiguration).toHaveBeenCalledTimes(
          configExpected,
        );
      });
    },
  );
});

describe('ChartSetupForm failure and recovery', () => {
  it('coding publish fails → no success, state refetched, retry reuses the committed draft without recreating it', async () => {
    mockEmptySetup();
    vi.mocked(api.createCodingStructureVersion).mockResolvedValue({
      id: 'cs-1',
    } as never);
    vi.mocked(api.publishCodingStructureVersion).mockRejectedValueOnce(
      new ApiError({ code: 'InternalError', status: 500, message: 'boom' }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    await fillChartForm(user);
    await user.click(
      screen.getByRole('button', { name: t.masterData.activateChart }),
    );
    expect(
      await screen.findByText(t.masterData.setupPartialFailure),
    ).toBeInTheDocument();
    expect(screen.queryByText(t.masterData.chartReady)).not.toBeInTheDocument();
    // Server truth on refetch: draft cs-1 committed, nothing active.
    vi.mocked(api.listCodingStructureVersions).mockResolvedValue({
      items: [
        {
          id: 'cs-1',
          levels: [
            {
              levelIndex: 1,
              title: 'گروه',
              digitLength: 2,
              defaultIsPostable: false,
            },
            {
              levelIndex: 2,
              title: 'معین',
              digitLength: 3,
              defaultIsPostable: true,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    } as never);
    // Retry (the click after refetch publishes the reused draft, then config flows)
    vi.mocked(api.publishCodingStructureVersion).mockResolvedValue({
      id: 'cs-1',
    } as never);
    vi.mocked(api.createAccountingConfiguration).mockResolvedValue({
      id: 'cfg-1',
    } as never);
    vi.mocked(api.publishAccountingConfiguration).mockResolvedValue({
      id: 'cfg-1',
    } as never);
    await user.click(screen.getByRole('button', { name: t.app.retry }));
    await waitFor(() =>
      expect(
        screen.getByText(t.masterData.setupPartial, { exact: false }),
      ).toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole('button', { name: t.masterData.activateChart }),
    );
    await waitFor(() =>
      expect(api.publishAccountingConfiguration).toHaveBeenCalled(),
    );
    expect(api.createCodingStructureVersion).toHaveBeenCalledTimes(1);
  });

  it('fetch 500 → explicit error, creation disabled; 403 → permission message', async () => {
    vi.mocked(api.getActiveCodingStructure).mockRejectedValue(
      new ApiError({ code: 'InternalError', status: 500, message: 'boom' }),
    );
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue(null);
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    expect(
      await screen.findByText(t.masterData.setupStateFailed),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.masterData.activateChart }),
    ).not.toBeInTheDocument();
  });

  it('fetch 403 → permission-specific message, no creation offered', async () => {
    vi.mocked(api.getActiveCodingStructure).mockRejectedValue(
      new ApiError({ code: 'PermissionDenied', status: 403, message: 'no' }),
    );
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue(null);
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    expect(
      await screen.findByText(t.masterData.setupForbidden),
    ).toBeInTheDocument();
  });

  it('incompatible active aggregates block without any mutation', async () => {
    vi.mocked(api.getActiveCodingStructure).mockResolvedValue({
      id: 'c',
      levels: [
        { levelIndex: 1, title: 'a', digitLength: 2, defaultIsPostable: false },
      ],
    } as never);
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue({
      id: 'k',
      levels: [
        { levelIndex: 1, title: 'a', digitLength: 4, defaultIsPostable: false },
      ],
    } as never);
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    expect(
      await screen.findByText(t.masterData.setupIncompatible),
    ).toBeInTheDocument();
    expect(api.createCodingStructureVersion).not.toHaveBeenCalled();
    expect(api.createAccountingConfiguration).not.toHaveBeenCalled();
  });
});

describe('PeriodCreateForm validation', () => {
  it('reversed range is refused client-side and never calls the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PeriodCreateForm
        organizationId="org-1"
        fiscalYears={[testFiscalYear]}
      />,
      { withProviders: false },
    );
    await user.selectOptions(
      screen.getByLabelText(t.masterData.fiscalYear),
      testFiscalYear.id,
    );
    await user.type(screen.getByLabelText(t.masterData.periodTitle), 'فروردین');
    await user.type(
      screen.getByLabelText(t.masterData.startDate),
      '1405/02/01',
    );
    await user.type(screen.getByLabelText(t.masterData.endDate), '1405/01/01');
    await user.click(
      screen.getByRole('button', { name: t.masterData.openPeriod }),
    );
    expect(await screen.findByText(t.masterData.dateRange)).toBeInTheDocument();
    expect(api.createAccountingPeriod).not.toHaveBeenCalled();
  });
});

describe('AccountCreateForm backend errors', () => {
  it('409 duplicate code shows an alert and no success', async () => {
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue({
      levels: [
        {
          levelIndex: 1,
          title: 'گروه',
          digitLength: 1,
          defaultIsPostable: false,
        },
      ],
    } as never);
    vi.mocked(api.listAccounts).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 500,
    } as never);
    vi.mocked(api.createAccount).mockRejectedValue(
      new ApiError({ code: 'Conflict', status: 409, message: 'duplicate' }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AccountCreateForm organizationId="org-1" />, {
      withProviders: false,
    });
    const localCode = screen.getByLabelText(t.masterData.localCode);
    await waitFor(() => expect(localCode).toBeEnabled());
    await user.type(localCode, '1');
    await user.type(screen.getByLabelText(t.masterData.accountTitle), 'نقد');
    await user.click(
      screen.getByRole('button', { name: t.masterData.createAccount }),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByText(t.masterData.accountCreated),
    ).not.toBeInTheDocument();
  });
});

describe('ChartSetupForm timeout-after-commit and reload recovery', () => {
  const LEVELS = [
    { levelIndex: 1, title: 'گروه', digitLength: 2, defaultIsPostable: false },
    { levelIndex: 2, title: 'معین', digitLength: 3, defaultIsPostable: true },
  ];
  type Agg = { id: string; levels: typeof LEVELS } | null;

  it('server commits coding publish but client times out → refetch shows partial state with no success, retry creates only the missing configuration, success only after both actives are confirmed compatible', async () => {
    // Stateful fake server: mutations mutate this truth; reads read it.
    const server: { codingActive: Agg; configActive: Agg } = {
      codingActive: null,
      configActive: null,
    };
    vi.mocked(api.getActiveCodingStructure).mockImplementation(
      async () => server.codingActive as never,
    );
    vi.mocked(api.getActiveAccountingConfiguration).mockImplementation(
      async () => server.configActive as never,
    );
    vi.mocked(api.listCodingStructureVersions).mockResolvedValue(
      LEVELS_RES as never,
    );
    vi.mocked(api.listAccountingConfigurations).mockResolvedValue(
      LEVELS_RES as never,
    );
    vi.mocked(api.createCodingStructureVersion).mockResolvedValue({
      id: 'cs-1',
    } as never);
    // The publish COMMITS on the server, then the response is lost (timeout).
    vi.mocked(api.publishCodingStructureVersion).mockImplementation(
      async () => {
        server.codingActive = { id: 'cs-1', levels: LEVELS };
        throw new Error('request timed out');
      },
    );
    vi.mocked(api.createAccountingConfiguration).mockImplementation(
      async () => ({ id: 'cfg-1' }) as never,
    );
    vi.mocked(api.publishAccountingConfiguration).mockImplementation(
      async () => {
        server.configActive = { id: 'cfg-1', levels: LEVELS };
        return server.configActive as never;
      },
    );

    const user = userEvent.setup();
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    await fillChartForm(user);
    await user.click(
      screen.getByRole('button', { name: t.masterData.activateChart }),
    );

    // Failure is reported, and the settle-refetch reveals the committed
    // partial state (coding done, configuration pending) — never success.
    expect(
      await screen.findByText(t.masterData.setupPartialFailure),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(t.masterData.setupPartial),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'LI' &&
          (el.textContent?.includes(t.masterData.setupStepDone) ?? false),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(t.masterData.chartReady)).not.toBeInTheDocument();
    expect(api.createCodingStructureVersion).toHaveBeenCalledTimes(1);

    // Retry: only the missing configuration is created+published.
    await user.click(
      screen.getByRole('button', { name: t.masterData.activateChart }),
    );
    expect(
      await screen.findByText(t.masterData.chartReady),
    ).toBeInTheDocument();
    expect(api.createCodingStructureVersion).toHaveBeenCalledTimes(1);
    expect(api.publishCodingStructureVersion).toHaveBeenCalledTimes(1);
    expect(api.createAccountingConfiguration).toHaveBeenCalledTimes(1);
    expect(api.createAccountingConfiguration).toHaveBeenCalledWith({
      organizationId: 'org-1',
      code: 'DEFAULT',
      name: 'پیکربندی اصلی',
      levels: LEVELS,
    });
    expect(api.publishAccountingConfiguration).toHaveBeenCalledWith(
      'org-1',
      'cfg-1',
    );
  });

  it('reload/remount after partial setup (coding active, configuration draft persisted) resumes by publishing the persisted draft — no creation, no republication of the active side', async () => {
    const server: { configActive: Agg } = { configActive: null };
    vi.mocked(api.getActiveCodingStructure).mockResolvedValue({
      id: 'cs-1',
      levels: LEVELS,
    } as never);
    vi.mocked(api.getActiveAccountingConfiguration).mockImplementation(
      async () => server.configActive as never,
    );
    vi.mocked(api.listCodingStructureVersions).mockResolvedValue(
      LEVELS_RES as never,
    );
    vi.mocked(api.listAccountingConfigurations).mockResolvedValue({
      items: [{ id: 'cfg-draft', levels: LEVELS }],
      total: 1,
      page: 1,
      pageSize: 100,
    } as never);
    vi.mocked(api.publishAccountingConfiguration).mockImplementation(
      async () => {
        server.configActive = { id: 'cfg-draft', levels: LEVELS };
        return server.configActive as never;
      },
    );

    const user = userEvent.setup();
    // Fresh mount with a fresh QueryClient == page reload.
    const first = renderWithProviders(
      <ChartSetupForm organizationId="org-1" />,
      { withProviders: false },
    );
    expect(
      await screen.findByText(t.masterData.setupPartial),
    ).toBeInTheDocument();
    first.unmount();
    const second = renderWithProviders(
      <ChartSetupForm organizationId="org-1" />,
      { withProviders: false },
    );
    expect(
      await screen.findByText(t.masterData.setupPartial),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: t.masterData.activateChart }),
    );

    expect(
      await screen.findByText(t.masterData.chartReady),
    ).toBeInTheDocument();
    expect(api.publishAccountingConfiguration).toHaveBeenCalledWith(
      'org-1',
      'cfg-draft',
    );
    expect(api.createAccountingConfiguration).not.toHaveBeenCalled();
    expect(api.createCodingStructureVersion).not.toHaveBeenCalled();
    expect(api.publishCodingStructureVersion).not.toHaveBeenCalled();
    second.unmount();
  });

  it('reload/remount with a persisted draft incompatible with the active coding structure never publishes that draft; it creates a configuration with the locked active shape instead', async () => {
    vi.mocked(api.getActiveCodingStructure).mockResolvedValue({
      id: 'cs-1',
      levels: LEVELS,
    } as never);
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue(null);
    vi.mocked(api.listCodingStructureVersions).mockResolvedValue(
      LEVELS_RES as never,
    );
    vi.mocked(api.listAccountingConfigurations).mockResolvedValue({
      items: [
        {
          id: 'cfg-bad',
          levels: [
            {
              levelIndex: 1,
              title: 'x',
              digitLength: 9,
              defaultIsPostable: true,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    } as never);
    vi.mocked(api.createAccountingConfiguration).mockResolvedValue({
      id: 'cfg-new',
    } as never);
    vi.mocked(api.publishAccountingConfiguration).mockResolvedValue({
      id: 'cfg-new',
    } as never);

    const user = userEvent.setup();
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    await screen.findByText(t.masterData.setupPartial);
    await user.click(
      screen.getByRole('button', { name: t.masterData.activateChart }),
    );

    await waitFor(() =>
      expect(api.publishAccountingConfiguration).toHaveBeenCalledWith(
        'org-1',
        'cfg-new',
      ),
    );
    expect(api.publishAccountingConfiguration).not.toHaveBeenCalledWith(
      'org-1',
      'cfg-bad',
    );
    expect(api.createAccountingConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ levels: LEVELS }),
    );
  });
});

describe('ChartSetupForm postable-default guardrails', () => {
  it('warns when a postable-by-default level is not the last level (the appended-level trap)', async () => {
    mockEmptySetup();
    const user = userEvent.setup();
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    // Shipped defaults: [L1 non-postable, L2 postable(last)] → no warning yet.
    const addLevel = await screen.findByRole('button', {
      name: t.masterData.addLevel,
    });
    expect(
      screen.queryByText(
        t.masterData.levelPostableNonLastWarning.replace('{level}', '2'),
      ),
    ).not.toBeInTheDocument();
    // Appending a level makes the previously-last postable level a parent
    // level — exactly the shape whose accounts later refuse children.
    await user.click(addLevel);
    expect(
      await screen.findByText(
        t.masterData.levelPostableNonLastWarning.replace('{level}', '2'),
      ),
    ).toBeInTheDocument();
  });

  it('warns when NO level defaults to postable', async () => {
    mockEmptySetup();
    const user = userEvent.setup();
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    const checkboxes = await screen.findAllByRole('checkbox');
    // Uncheck the one postable-by-default level (level 2 ships checked).
    const checked = checkboxes.find((box) => (box as HTMLInputElement).checked);
    expect(checked).toBeDefined();
    await user.click(checked as HTMLElement);
    expect(
      await screen.findByText(t.masterData.noPostableLevelWarning),
    ).toBeInTheDocument();
  });
});
