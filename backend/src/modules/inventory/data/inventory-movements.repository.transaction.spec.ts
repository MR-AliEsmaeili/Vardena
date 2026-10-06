import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { InventoryMovementsRepository } from './inventory-movements.repository.js';
import type { CoreTxClient } from './inventory-core-rows.js';

describe('InventoryMovementsRepository caller-owned transaction seam', () => {
  it('runs composite work in exactly one database transaction', async () => {
    const tx = { marker: 'tx' } as unknown as CoreTxClient;
    const transaction = vi.fn(
      async <T>(work: (client: CoreTxClient) => Promise<T>): Promise<T> =>
        work(tx),
    );
    const prisma = {
      getClient: vi.fn(async () => ({ $transaction: transaction })),
    } as unknown as PrismaService;
    const repository = new InventoryMovementsRepository(prisma);
    const work = vi.fn(async (client: CoreTxClient) => {
      expect(client).toBe(tx);
      return 'committed';
    });

    await expect(repository.withTransaction(work)).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
  });

  it('propagates a composite failure so the database transaction rolls back', async () => {
    const failure = new Error('replacement failed');
    const transaction = vi.fn(
      async <T>(work: (client: CoreTxClient) => Promise<T>): Promise<T> =>
        work({} as CoreTxClient),
    );
    const prisma = {
      getClient: vi.fn(async () => ({ $transaction: transaction })),
    } as unknown as PrismaService;
    const repository = new InventoryMovementsRepository(prisma);

    await expect(
      repository.withTransaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
