import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { InventoryBusinessDocumentsRepository } from './inventory-business-documents.repository.js';

describe('InventoryBusinessDocumentsRepository.findFirstUnrenderableBusinessDate', () => {
  it('reads the canonical PostgreSQL date as text rather than a host-local Date carrier', async () => {
    const queryRaw = vi.fn(
      async (_query: TemplateStringsArray, ..._values: unknown[]) => [
        { businessDate: '0621-03-20' },
      ],
    );
    const prisma = {
      getClient: vi.fn(async () => ({ $queryRaw: queryRaw })),
    } as unknown as PrismaService;
    const repository = new InventoryBusinessDocumentsRepository(prisma);

    await expect(
      repository.findFirstUnrenderableBusinessDate('org-1'),
    ).resolves.toBe('0621-03-20');

    const query = queryRaw.mock.calls[0]?.[0].join('');
    expect(query).toContain(
      'SELECT candidate."businessDate"::text AS "businessDate"',
    );
    expect(query).toContain('ORDER BY candidate."businessDate" ASC');
  });

  it('returns null when no Inventory-owned date is outside the renderable range', async () => {
    const queryRaw = vi.fn(
      async (_query: TemplateStringsArray, ..._values: unknown[]) => [],
    );
    const prisma = {
      getClient: vi.fn(async () => ({ $queryRaw: queryRaw })),
    } as unknown as PrismaService;
    const repository = new InventoryBusinessDocumentsRepository(prisma);

    await expect(
      repository.findFirstUnrenderableBusinessDate('org-1'),
    ).resolves.toBeNull();
  });

  it('fails closed if the database returns a day outside the canonical API envelope', async () => {
    const queryRaw = vi.fn(
      async (_query: TemplateStringsArray, ..._values: unknown[]) => [
        { businessDate: '10000-01-01' },
      ],
    );
    const prisma = {
      getClient: vi.fn(async () => ({ $queryRaw: queryRaw })),
    } as unknown as PrismaService;
    const repository = new InventoryBusinessDocumentsRepository(prisma);

    await expect(
      repository.findFirstUnrenderableBusinessDate('org-1'),
    ).rejects.toThrow(
      'Inventory BusinessDate history contains a non-canonical day "10000-01-01".',
    );
  });
});
