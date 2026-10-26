import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import { renderWithProviders } from '@/test/test-utils';
import { UnitConversionResolveSection } from './unit-conversion-resolve-page';

vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: () => '01ARZ3NDEKTSV4RRFFQ69G5FAV',
}));
vi.mock('../master-data-references', () => ({
  useActiveItemOptions: () => ({
    items: [],
    unavailable: true,
    truncated: false,
  }),
  useActiveUnitOptions: () => ({
    items: [],
    unavailable: true,
    truncated: false,
  }),
}));
vi.mock('@/api/inventory-master.api', () => ({
  resolveUnitConversion: vi.fn(),
}));
const api = await import('@/api/inventory-master.api');
const FROM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TO = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const ITEM = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const path = `/app/inventory/unit-conversions?resolveFromUnitId=${FROM}&resolveToUnitId=${TO}&resolveAsOf=2026-10-26`;

beforeEach(() => vi.resetAllMocks());

function render(pathname = path) {
  return renderWithProviders(<UnitConversionResolveSection />, {
    withProviders: false,
    initialEntries: [pathname],
  });
}

describe('backend conversion resolve', () => {
  it('uses the backend null result, never synthesizing 1:1', async () => {
    vi.mocked(api.resolveUnitConversion).mockResolvedValue({
      conversion: null,
    });
    render();
    expect(
      await screen.findByText(t.inventoryMaster.resolveEmptyBody),
    ).toBeInTheDocument();
    expect(api.resolveUnitConversion).toHaveBeenCalledWith(
      {
        organizationId: FROM,
        fromUnitId: FROM,
        toUnitId: TO,
        asOf: '2026-10-26',
      },
      expect.anything(),
    );
    expect(screen.queryByText('1:1')).not.toBeInTheDocument();
  });

  it('renders the precise backend factor and validity window for the item-specific version', async () => {
    vi.mocked(api.resolveUnitConversion).mockResolvedValue({
      conversion: {
        id: ITEM,
        organizationId: FROM,
        itemId: ITEM,
        fromUnitId: FROM,
        toUnitId: TO,
        factor: '12.000001',
        validFrom: '2026-10-26',
        validTo: '2026-10-27',
        createdAt: '2026-10-26T08:00:00Z',
        updatedAt: '2026-10-26T08:00:00Z',
      },
    });
    render(`${path}&resolveItemId=${ITEM}`);
    expect(await screen.findByText('12.000001')).toBeInTheDocument();
    expect(api.resolveUnitConversion).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: ITEM }),
      expect.anything(),
    );
  });

  it('renders a null validTo as open-ended (without inventing an end date)', async () => {
    vi.mocked(api.resolveUnitConversion).mockResolvedValue({
      conversion: {
        id: ITEM,
        organizationId: FROM,
        itemId: null,
        fromUnitId: FROM,
        toUnitId: TO,
        factor: '1.250000',
        validFrom: '2026-10-25',
        validTo: null,
        createdAt: '2026-10-25T08:00:00Z',
        updatedAt: '2026-10-25T08:00:00Z',
      },
    });
    render();
    expect(await screen.findByText('1.250000')).toBeInTheDocument();
    expect(
      screen.getByText(t.inventoryMaster.resolveOpenEnded),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t.inventoryMaster.resolveGlobal),
    ).toBeInTheDocument();
  });

  it('does not query an identity pair and allows a view-only user to enter IDs manually', async () => {
    render('/app/inventory/unit-conversions');
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(`${t.inventoryMaster.resolveFrom} — ULID`),
      FROM,
    );
    await user.type(
      screen.getByLabelText(`${t.inventoryMaster.resolveTo} — ULID`),
      FROM,
    );
    expect(
      screen.getByText(t.inventoryMaster.resolveSameUnit),
    ).toBeInTheDocument();
    expect(api.resolveUnitConversion).not.toHaveBeenCalled();
    await user.clear(
      screen.getByLabelText(`${t.inventoryMaster.resolveTo} — ULID`),
    );
    await user.type(
      screen.getByLabelText(`${t.inventoryMaster.resolveTo} — ULID`),
      TO,
    );
    // A date is still required: no implicit timezone-dependent default.
    expect(
      screen.getByRole('button', { name: t.inventoryMaster.resolveCheck }),
    ).toBeDisabled();
  });

  it('reports a backend error instead of treating it as no coverage', async () => {
    vi.mocked(api.resolveUnitConversion).mockRejectedValue(
      new Error('connection lost'),
    );
    render();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        t.inventoryMaster.resolveFailed,
      ),
    );
    expect(
      screen.queryByText(t.inventoryMaster.resolveEmptyBody),
    ).not.toBeInTheDocument();
  });
});
