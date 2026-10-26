import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetailStructureVersion } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { StructureFormPage, StructureListPage } from './structure-admin-page';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));
vi.mock('@/api/accounting.api', () => ({
  createCodingStructureVersion: vi.fn(),
  createDetailStructureVersion: vi.fn(),
  getCodingStructure: vi.fn(),
  getDetailStructure: vi.fn(),
  listCodingStructureVersions: vi.fn(),
  listDetailStructures: vi.fn(),
  publishCodingStructureVersion: vi.fn(),
  publishDetailStructureVersion: vi.fn(),
  updateCodingStructureVersion: vi.fn(),
  updateDetailStructureVersion: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

const detailStructure: DetailStructureVersion = {
  id: 'structure-1',
  organizationId: testOrganization.id,
  versionNumber: 1,
  status: 'draft',
  title: null,
  maxDepth: 3,
  pattern: '2 + 2 + 2',
  levels: [
    { id: 'level-1', levelIndex: 1, title: 'Group', digitLength: 2 },
    { id: 'level-2', levelIndex: 2, title: 'Person', digitLength: 2 },
    { id: 'level-3', levelIndex: 3, title: 'Record', digitLength: 2 },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [
      'Organization.Organization.View',
      'Accounting.DetailStructure.View',
      'Accounting.DetailStructure.Configure',
    ],
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listDetailStructures).mockResolvedValue({
    items: [detailStructure],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(accountingApi.createDetailStructureVersion).mockResolvedValue(
    detailStructure,
  );
});

describe('Detail structure administration', () => {
  it('lists the server version status and pattern', async () => {
    renderWithProviders(<StructureListPage kind="detail" />, {
      initialEntries: ['/app/accounting/detail-structures'],
    });

    expect(
      await screen.findByRole('cell', { name: t.structureAdmin.draft }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: detailStructure.pattern }),
    ).toBeInTheDocument();
    expect(accountingApi.listDetailStructures).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: testOrganization.id, page: 1 }),
      expect.any(AbortSignal),
    );
  });

  it('creates contiguous levels using only the detail-structure DTO fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StructureFormPage kind="detail" mode="create" />, {
      initialEntries: ['/app/accounting/detail-structures/new'],
    });

    const levelTitles = await screen.findAllByLabelText(
      t.structureAdmin.levelTitle,
    );
    await user.type(levelTitles[0]!, 'Group');
    await user.type(levelTitles[1]!, 'Person');
    await user.type(levelTitles[2]!, 'Record');
    await user.click(
      screen.getByRole('button', { name: t.structureAdmin.save }),
    );

    await waitFor(() =>
      expect(accountingApi.createDetailStructureVersion).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        maxDepth: 3,
        levels: [
          { levelIndex: 1, title: 'Group', digitLength: 2 },
          { levelIndex: 2, title: 'Person', digitLength: 2 },
          { levelIndex: 3, title: 'Record', digitLength: 2 },
        ],
      }),
    );
    const body = vi.mocked(accountingApi.createDetailStructureVersion).mock
      .calls[0]?.[0];
    expect(body).not.toHaveProperty('code');
    expect(body?.levels[0]).not.toHaveProperty('defaultIsPostable');
    expect(body?.levels[0]).not.toHaveProperty('levelKind');
  });
});
