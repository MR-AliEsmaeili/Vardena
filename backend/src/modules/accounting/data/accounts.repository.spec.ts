import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { AccountStructureSnapshot } from './accounts.repository.js';
import { AccountsRepository } from './accounts.repository.js';
import {
  AccountImmutableAfterUseError,
  AccountPinsIncoherentError,
  AccountPlacementRejectedError,
} from './accounting-structure-errors.js';

/**
 * Repository-level contract spec for `AccountsRepository`'s PIN refusals — the
 * authoritative branches that run inside the locked transaction. They are the
 * last line of defence for two invariants:
 *
 * - a ROOT may only be pinned to an ACTIVE accounting configuration AND an
 *   ACTIVE (`status = 'active'`) coding-structure version (D1 + §9.4). The
 *   service resolves that pair, but a concurrent publish between resolution and
 *   the locked insert is exactly what this re-check exists for.
 * - a MOVE may only be validated against the configuration/version pair the
 *   account is ALREADY pinned to (Task 11 remediation, item 1) — a snapshot
 *   naming another configuration's or version's level set is refused, so
 *   validation can never read a foreign level shape.
 * - ODR-1 (Task 19): a snapshot whose two pinned roots do not describe the
 *   SAME code shape (level count + per-level digit length) is refused — the
 *   transaction never silently validates against one half of the pair.
 *
 * Why this spec exists: the final verification pass showed (mutation M8) that
 * removing the move refusal from THIS class left every other test green — the
 * domain function, the in-memory repository twin and the live suite covered the
 * decision, but not this call site. These tests exercise the real class through
 * a minimal fake transactional client, so the refusal cannot be deleted
 * silently again.
 *
 * The fake serves exactly the client surface the two paths touch:
 * `$transaction`, `$queryRaw` (row locks), `account.findMany`,
 * `account.create`, `account.update`, `accountingDocumentLine.count`. It is
 * deliberately small: it asserts wiring, not SQL semantics (PostgreSQL-level
 * behaviour is covered by `test/accounting-configuration-live.e2e-spec.ts` and
 * the migration rehearsal).
 */

const ORG = 'org-1';
const CONFIG_ACTIVE = 'config-active';
const CONFIG_OTHER = 'config-other';
const VERSION_ACTIVE = 'version-active';
const VERSION_SUPERSEDED = 'version-superseded';

const LEVELS = [
  { levelIndex: 1, digitLength: 2, defaultIsPostable: false },
  { levelIndex: 2, digitLength: 3, defaultIsPostable: true },
];

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    organizationId: ORG,
    code: '10',
    title: 'Assets',
    parentId: null,
    level: 1,
    codingStructureVersionId: VERSION_ACTIVE,
    accountingConfigurationId: CONFIG_ACTIVE,
    accountNature: 'DEBIT',
    isPostable: false,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

interface FakeOptions {
  /** Rows returned by the `FOR UPDATE` lock query, keyed by account id. */
  lockedAccounts?: Record<string, unknown>;
  /** Rows returned by `lockCodingStructureVersionRow` / `lockAccountingConfigurationRow`. */
  lockedVersions?: Record<string, unknown>;
  lockedConfigurations?: Record<string, unknown>;
  children?: readonly unknown[];
  hierarchy?: readonly unknown[];
  referencedByDocumentLine?: boolean;
  postedLedgerEntriesCount?: number;
}

function fakeClient(options: FakeOptions = {}) {
  const calls = {
    updates: [] as Array<Record<string, unknown>>,
    creates: [] as Array<Record<string, unknown>>,
    queryRaw: [] as string[],
  };
  const lockedAccounts = options.lockedAccounts ?? {
    'acc-1': accountRow(),
  };

  const tx = {
    $queryRaw: (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown[]> => {
      const sql = strings.join(' ? ');
      calls.queryRaw.push(sql);
      const id = String(values[0] ?? '');
      if (sql.includes('FROM "accounting"."accounts"')) {
        const row = lockedAccounts[id];
        return Promise.resolve(row === undefined ? [] : [row]);
      }
      if (sql.includes('FROM "accounting"."coding_structure_versions"')) {
        const row = options.lockedVersions?.[id];
        return Promise.resolve(row === undefined ? [] : [row]);
      }
      if (sql.includes('FROM "accounting"."accounting_configurations"')) {
        const row = options.lockedConfigurations?.[id];
        return Promise.resolve(row === undefined ? [] : [row]);
      }
      return Promise.resolve([]);
    },
    account: {
      findMany: (args: { where?: { parentId?: string } }) =>
        Promise.resolve(
          args.where?.parentId === undefined
            ? [...(options.hierarchy ?? [])]
            : [...(options.children ?? [])],
        ),
      create: (args: { data: Record<string, unknown> }) => {
        calls.creates.push(args.data);
        return Promise.resolve({ ...accountRow(), ...args.data });
      },
      update: (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        calls.updates.push(args.data);
        return Promise.resolve({ ...accountRow(), ...args.data });
      },
    },
    accountingDocumentLine: {
      count: () => Promise.resolve(options.referencedByDocumentLine ? 1 : 0),
    },
    ledgerEntry: {
      count: () => Promise.resolve(options.postedLedgerEntriesCount ?? 0),
    },
  };

  const client = {
    $transaction: <T>(fn: (txArg: typeof tx) => Promise<T>): Promise<T> =>
      fn(tx),
    account: tx.account,
    ledgerEntry: tx.ledgerEntry,
  };
  return { client, tx, calls };
}

function repositoryWith(options: FakeOptions = {}) {
  const { client, calls } = fakeClient(options);
  const prisma = {
    getClient: () => Promise.resolve(client),
  } as unknown as PrismaService;
  return { repository: new AccountsRepository(prisma), calls };
}

function snapshot(
  overrides: Partial<AccountStructureSnapshot> = {},
): AccountStructureSnapshot {
  return {
    accountingConfigurationId: CONFIG_ACTIVE,
    versionId: VERSION_ACTIVE,
    maxDepth: LEVELS.length,
    levels: LEVELS,
    // ODR-1 (Task 19): the snapshot carries the coding half of the pinned
    // pair; the default mirrors `levels` so the pair is coherent.
    codingLevels: LEVELS.map((level) => ({
      levelIndex: level.levelIndex,
      digitLength: level.digitLength,
    })),
    ...overrides,
  };
}

describe('AccountsRepository — root pin (D1 + §9.4) at the write boundary', () => {
  const rootCreate = (structure: AccountStructureSnapshot) => ({
    id: 'acc-new',
    organizationId: ORG,
    code: '20',
    title: 'Receivables',
    parentId: null,
    accountNature: 'DEBIT',
    isPostable: false,
    structure,
    now: new Date('2026-01-02T00:00:00Z'),
    actorId: null,
  });

  it('refuses a coding-structure version that is no longer active, and writes nothing', async () => {
    const { repository, calls } = repositoryWith({
      lockedVersions: {
        [VERSION_ACTIVE]: {
          id: VERSION_ACTIVE,
          organizationId: ORG,
          status: 'superseded',
        },
      },
      lockedConfigurations: {
        [CONFIG_ACTIVE]: {
          id: CONFIG_ACTIVE,
          organizationId: ORG,
          status: 'ACTIVE',
        },
      },
    });

    await expect(
      repository.createChecked(rootCreate(snapshot())),
    ).rejects.toThrow(/superseded/);
    expect(calls.creates).toHaveLength(0);
  });

  it('refuses a configuration that is not ACTIVE, and writes nothing', async () => {
    const { repository, calls } = repositoryWith({
      lockedVersions: {
        [VERSION_ACTIVE]: {
          id: VERSION_ACTIVE,
          organizationId: ORG,
          status: 'active',
        },
      },
      lockedConfigurations: {
        [CONFIG_ACTIVE]: {
          id: CONFIG_ACTIVE,
          organizationId: ORG,
          status: 'DRAFT',
        },
      },
    });

    await expect(
      repository.createChecked(rootCreate(snapshot())),
    ).rejects.toBeInstanceOf(Error);
    expect(calls.creates).toHaveLength(0);
  });

  it('ODR-1: refuses a snapshot whose pinned roots describe different code shapes, and writes nothing', async () => {
    // Both roots are ACTIVE, so the D1/§9.4 checks pass; the pair itself is
    // incoherent (coding says 2 + 2, configuration says 2 + 3).
    const { repository, calls } = repositoryWith({
      lockedVersions: {
        [VERSION_ACTIVE]: {
          id: VERSION_ACTIVE,
          organizationId: ORG,
          status: 'active',
        },
      },
      lockedConfigurations: {
        [CONFIG_ACTIVE]: {
          id: CONFIG_ACTIVE,
          organizationId: ORG,
          status: 'ACTIVE',
        },
      },
    });

    await expect(
      repository.createChecked(
        rootCreate(
          snapshot({
            codingLevels: [
              { levelIndex: 1, digitLength: 2 },
              { levelIndex: 2, digitLength: 2 },
            ],
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AccountPinsIncoherentError);
    expect(calls.creates).toHaveLength(0);
  });

  it('ODR-1: the same refusal fires on the CHILD path before placement', async () => {
    const parent = accountRow({
      id: 'acc-parent',
      code: '20',
      level: 1,
      parentId: null,
    });
    const { repository, calls } = repositoryWith({
      lockedAccounts: { 'acc-parent': parent },
      children: [],
      hierarchy: [],
    });

    await expect(
      repository.createChecked({
        id: 'acc-new',
        organizationId: ORG,
        code: '20101',
        title: 'Receivables — EU',
        parentId: 'acc-parent',
        accountNature: 'DEBIT',
        isPostable: true,
        structure: snapshot({
          codingLevels: [
            { levelIndex: 1, digitLength: 3 },
            { levelIndex: 2, digitLength: 3 },
          ],
        }),
        now: new Date('2026-01-02T00:00:00Z'),
        actorId: null,
      }),
    ).rejects.toBeInstanceOf(AccountPinsIncoherentError);
    expect(calls.creates).toHaveLength(0);
  });

  it('CONTROL: the ACTIVE pair is accepted and the row is created', async () => {
    const { repository, calls } = repositoryWith({
      lockedVersions: {
        [VERSION_ACTIVE]: {
          id: VERSION_ACTIVE,
          organizationId: ORG,
          status: 'active',
        },
      },
      lockedConfigurations: {
        [CONFIG_ACTIVE]: {
          id: CONFIG_ACTIVE,
          organizationId: ORG,
          status: 'ACTIVE',
        },
      },
    });

    const created = await repository.createChecked(rootCreate(snapshot()));
    expect(created.id).toBe('acc-new');
    expect(created.codingStructureVersionId).toBe(VERSION_ACTIVE);
    expect(created.accountingConfigurationId).toBe(CONFIG_ACTIVE);
    expect(calls.creates).toHaveLength(1);
  });
});

describe('AccountsRepository — move validation uses ONLY the account’s own pin (item 1)', () => {
  const move = (structure: AccountStructureSnapshot | null) => ({
    id: 'acc-1',
    parentId: null,
    structure,
    now: new Date('2026-01-02T00:00:00Z'),
    actorId: null,
  });

  const history = [{ id: 'acc-1', parentId: 'acc-parent' }];

  /**
   * The account must CURRENTLY have a parent for `parentId: null` to be a move:
   * `parentChanged` is `requestedParentId !== node.parentId`, so a row that is
   * already a root would skip the whole move path (and the pin check with it).
   */
  const movingAccount = () => ({
    lockedAccounts: { 'acc-1': accountRow({ parentId: 'acc-parent' }) },
    hierarchy: history,
  });

  it('refuses a snapshot naming ANOTHER configuration, and does not update the account', async () => {
    const { repository, calls } = repositoryWith(movingAccount());

    let rejected: unknown = null;
    try {
      await repository.updateChecked(
        move(snapshot({ accountingConfigurationId: CONFIG_OTHER })),
      );
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(AccountPlacementRejectedError);
    expect((rejected as AccountPlacementRejectedError).problem).toBe(
      'version_mismatch',
    );
    expect(calls.updates).toHaveLength(0);
  });

  it('refuses a snapshot naming ANOTHER coding version, and does not update the account', async () => {
    const { repository, calls } = repositoryWith(movingAccount());

    let rejected: unknown = null;
    try {
      await repository.updateChecked(
        move(snapshot({ versionId: VERSION_SUPERSEDED })),
      );
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(AccountPlacementRejectedError);
    expect((rejected as AccountPlacementRejectedError).problem).toBe(
      'version_mismatch',
    );
    expect(calls.updates).toHaveLength(0);
  });

  it('refuses a move with no snapshot at all (caller bug, not an API outcome)', async () => {
    const { repository, calls } = repositoryWith(movingAccount());

    await expect(repository.updateChecked(move(null))).rejects.toThrow(
      /requires the pinned configuration snapshot/,
    );
    expect(calls.updates).toHaveLength(0);
  });

  it('CONTROL: the account’s own pair passes the pin check and the move is applied', async () => {
    const { repository, calls } = repositoryWith(movingAccount());

    const updated = await repository.updateChecked(
      move(snapshot({ maxDepth: 1 })),
    );
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]?.['parentId']).toBeNull();
    expect(updated.id).toBe('acc-1');
  });

  it('ODR-1: refuses a move whose snapshot pair describes different code shapes, and writes nothing', async () => {
    const { repository, calls } = repositoryWith(movingAccount());

    await expect(
      repository.updateChecked(
        move(
          snapshot({
            codingLevels: [
              { levelIndex: 1, digitLength: 3 },
              { levelIndex: 2, digitLength: 3 },
            ],
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AccountPinsIncoherentError);
    expect(calls.updates).toHaveLength(0);
  });
});

describe('AccountsRepository — OD-29-02 Account Type immutability timing at write boundary', () => {
  const updateAccountInput = (overrides: Record<string, unknown> = {}) => ({
    id: 'acc-1',
    structure: null,
    now: new Date('2026-01-02T00:00:00Z'),
    actorId: null,
    ...overrides,
  });

  it('Case 1: allows updating accountType when account is completely unused', async () => {
    const { repository, calls } = repositoryWith({
      referencedByDocumentLine: false,
      postedLedgerEntriesCount: 0,
    });

    const updated = await repository.updateChecked(
      updateAccountInput({ accountType: 'INCOME_STATEMENT' }),
    );
    expect(updated.id).toBe('acc-1');
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]?.['accountType']).toBe('INCOME_STATEMENT');
  });

  it('Case 2 & 3: allows updating accountType when account is referenced in document lines (draft/temporary) but has NO posted ledger entries', async () => {
    const { repository, calls } = repositoryWith({
      referencedByDocumentLine: true,
      postedLedgerEntriesCount: 0,
    });

    // accountType update succeeds
    const updated = await repository.updateChecked(
      updateAccountInput({ accountType: 'INCOME_STATEMENT' }),
    );
    expect(updated.id).toBe('acc-1');
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]?.['accountType']).toBe('INCOME_STATEMENT');

    // but structural fields (nature/isPostable) fail due to document line reference
    await expect(
      repository.updateChecked(updateAccountInput({ accountNature: 'CREDIT' })),
    ).rejects.toBeInstanceOf(AccountImmutableAfterUseError);
  });

  it('Case 4: blocks updating accountType when account is referenced in posted ledger entries', async () => {
    const { repository, calls } = repositoryWith({
      referencedByDocumentLine: true,
      postedLedgerEntriesCount: 1,
    });

    let rejection: unknown = null;
    try {
      await repository.updateChecked(
        updateAccountInput({ accountType: 'INCOME_STATEMENT' }),
      );
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(AccountImmutableAfterUseError);
    expect((rejection as AccountImmutableAfterUseError).refused).toEqual([
      'accountType',
    ]);
    expect(calls.updates).toHaveLength(0);
  });
});
