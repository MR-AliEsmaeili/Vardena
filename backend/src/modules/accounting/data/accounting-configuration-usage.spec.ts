import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  configurationPinsOfDocumentLinesInTx,
  markConfigurationsUsedByDocumentInTx,
  markConfigurationsUsedInDb,
} from './accounting-configuration-usage.js';
import type { AccountingTxClient } from './accounting-rows.js';

/**
 * The statement Task 13 marks usage with — tested where it lives, against a
 * transaction client that executes the SQL the way PostgreSQL would for the
 * properties under test (predicate re-evaluation after a row lock, `RETURNING`).
 *
 * What a unit test of a raw statement can and cannot prove is stated plainly in
 * `docs/task-13-implementation-report.md` §10/§12: the SHAPE (one guarded write,
 * organization predicate, ascending per-row order, no second table, no
 * read-then-write window) is provable here; LOCK CONTENTION and ROLLBACK are
 * proven by the live-PostgreSQL rehearsal, not by this file.
 */

const CONFIG_A = '01CONFIGAAAAAAAAAAAAAAAAAA01';
const CONFIG_B = '01CONFIGAAAAAAAAAAAAAAAAAA02';
const ACCOUNT_1 = '01ACCOUNTAAAAAAAAAAAAAAAAA01';
const ACCOUNT_2 = '01ACCOUNTAAAAAAAAAAAAAAAAA02';
const ORG_A = '01ORGANIZATIONA000000000AA';
const ORG_B = '01ORGANIZATIONB000000000BB';
const DOCUMENT = '01DOCUMENTAAAAAAAAAAAAAAAA01';

interface ConfigurationRow {
  id: string;
  organizationId: string;
  operationallyUsedAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
}

interface Statement {
  sql: string;
  values: unknown[];
}

/**
 * A client that executes exactly the two statements this file issues.
 *
 * `lines` stands in for `accounting_document_lines ⋈ accounts` (one row per
 * line) and `configurations` for the configuration table. The UPDATE applies the
 * full WHERE clause — id, organization AND the `IS NULL` guard — against the
 * CURRENT row version, which is what first-use-wins and the concurrent loser
 * depend on.
 */
function fakeClient(input: {
  lines?: { accountId: string; accountingConfigurationId: string | null }[];
  configurations: ConfigurationRow[];
  statements: Statement[];
}): AccountingTxClient {
  const client = {
    $queryRaw: async <T>(
      query: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]> => {
      // Whitespace-normalized: the assertions below are about the statement's
      // SHAPE (predicates, guard, order), not about its pretty-printing.
      const sql = query.join('?').replace(/\s+/g, ' ').trim();
      input.statements.push({ sql, values });
      if (sql.includes('UPDATE "accounting"."accounting_configurations"')) {
        // Positions: SET now, now, actor | WHERE id, organization_id.
        const [now, , actorId, configurationId, organizationId] = values;
        const row = input.configurations.find(
          (candidate) =>
            candidate.id === configurationId &&
            candidate.organizationId === organizationId &&
            candidate.operationallyUsedAt === null,
        );
        if (row === undefined) return [] as T[];
        row.operationallyUsedAt = now as Date;
        row.updatedAt = now as Date;
        row.updatedBy = (actorId as string | null) ?? null;
        return [{ id: row.id }] as T[];
      }
      if (sql.includes('FROM "accounting"."accounting_document_lines"')) {
        const rows = (input.lines ?? []).map((line) => ({
          accountId: line.accountId,
          accountingConfigurationId: line.accountingConfigurationId,
        }));
        return rows as T[];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  return client as unknown as AccountingTxClient;
}

function usedRow(overrides: Partial<ConfigurationRow> = {}): ConfigurationRow {
  return {
    id: CONFIG_A,
    organizationId: ORG_A,
    operationallyUsedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: null,
    ...overrides,
  };
}

describe('markConfigurationsUsedInDb — the guarded marker statement', () => {
  it('issues one guarded UPDATE per configuration, ascending and deduplicated', async () => {
    const statements: Statement[] = [];
    const client = fakeClient({
      configurations: [usedRow({ id: CONFIG_B }), usedRow({ id: CONFIG_A })],
      statements,
    });

    const marked = await markConfigurationsUsedInDb(client, {
      organizationId: ORG_A,
      configurationIds: [CONFIG_B, CONFIG_A, CONFIG_B],
      now: new Date('2026-04-05T06:00:00.000Z'),
      actorId: '01ACTORAAAAAAAAAAAAAAAAAA1',
    });

    expect(marked).toEqual([CONFIG_A, CONFIG_B]);
    expect(statements).toHaveLength(2);
    expect(statements[0]?.values).toContain(CONFIG_A);
    expect(statements[1]?.values).toContain(CONFIG_B);
    for (const statement of statements) {
      // First-use-wins: the guard is IN the statement, so there is no
      // read-then-write window for a concurrent finalization to race into.
      expect(statement.sql).toContain('"operationally_used_at" IS NULL');
      // Organization isolation is part of the write, not a caller's promise.
      expect(statement.sql).toContain('"organization_id" = ?');
      expect(statement.sql).toContain('"id" = ?');
      // Every value is a bind parameter: no interpolation of any kind.
      expect(statement.sql).not.toContain(ORG_A);
      expect(statement.sql).not.toContain(CONFIG_A);
      expect(statement.sql).not.toMatch(/\$\{|\$\d|'"\s*\+/);
      // The marker rides the configuration row: no second table, no log table.
      expect(statement.sql.match(/"accounting"\."(\w+)"/g)).toEqual([
        '"accounting"."accounting_configurations"',
      ]);
    }
  });

  it('writes nothing when the set is empty (a document with no lines)', async () => {
    const statements: Statement[] = [];
    const client = fakeClient({
      configurations: [usedRow()],
      statements,
    });
    const marked = await markConfigurationsUsedInDb(client, {
      organizationId: ORG_A,
      configurationIds: [],
      now: new Date(),
      actorId: null,
    });
    expect(marked).toEqual([]);
    expect(statements).toEqual([]);
  });

  it('leaves the first timestamp untouched when the row is already used', async () => {
    const statements: Statement[] = [];
    const firstUse = new Date('2026-04-05T06:00:00.000Z');
    const rows = [usedRow({ operationallyUsedAt: firstUse })];
    const client = fakeClient({ configurations: rows, statements });

    const marked = await markConfigurationsUsedInDb(client, {
      organizationId: ORG_A,
      configurationIds: [CONFIG_A],
      now: new Date('2027-01-01T00:00:00.000Z'),
      actorId: null,
    });

    // 0 rows affected, and the stored instant is still the FIRST one: a retry
    // or a concurrent loser can neither duplicate nor overwrite the evidence.
    expect(marked).toEqual([]);
    expect(rows[0]?.operationallyUsedAt).toBe(firstUse);
  });

  it('cannot mark a configuration that belongs to another organization', async () => {
    const statements: Statement[] = [];
    const rows = [usedRow({ organizationId: ORG_B })];
    const client = fakeClient({ configurations: rows, statements });

    const marked = await markConfigurationsUsedInDb(client, {
      organizationId: ORG_A,
      configurationIds: [CONFIG_A],
      now: new Date(),
      actorId: null,
    });

    expect(marked).toEqual([]);
    expect(rows[0]?.operationallyUsedAt).toBeNull();
    expect(statements).toHaveLength(1);
  });

  it('records the caller’s clock and actor on the row it marks', async () => {
    const statements: Statement[] = [];
    const now = new Date('2026-04-05T06:00:00.000Z');
    const rows = [usedRow()];
    const client = fakeClient({ configurations: rows, statements });

    await markConfigurationsUsedInDb(client, {
      organizationId: ORG_A,
      configurationIds: [CONFIG_A],
      now,
      actorId: '01ACTORAAAAAAAAAAAAAAAAAA1',
    });

    // The marker carries no second clock and no invented actor: it is stamped
    // with the finalization's own instant and finalizer (audit-column policy,
    // AR-12), and `updated_at` moves with it.
    expect(rows[0]?.operationallyUsedAt).toBe(now);
    expect(rows[0]?.updatedAt).toBe(now);
    expect(rows[0]?.updatedBy).toBe('01ACTORAAAAAAAAAAAAAAAAAA1');
  });
});

describe('markConfigurationsUsedByDocumentInTx — read, resolve, then write', () => {
  it('reads the pins through an unlocked, organization-scoped set query', async () => {
    const statements: Statement[] = [];
    const client = fakeClient({
      lines: [
        { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
        { accountId: ACCOUNT_2, accountingConfigurationId: CONFIG_A },
      ],
      configurations: [usedRow()],
      statements,
    });

    await configurationPinsOfDocumentLinesInTx(client, {
      organizationId: ORG_A,
      documentId: DOCUMENT,
    });

    const read = statements[0];
    expect(read?.sql).toContain('"accounting"."accounting_document_lines"');
    expect(read?.sql).toContain('"accounting"."accounts"');
    // Both sides scoped: a foreign account contributes no pin, whatever its id.
    expect(read?.sql.match(/"organization_id" = \?/g)).toHaveLength(2);
    expect(read?.sql).toContain('ln."document_id" = ?');
    // It is a READ: no FOR UPDATE / FOR SHARE — the exclusive lock is taken by
    // the marker statement itself, at the configuration position of the global
    // order (never after the accounts are locked FOR SHARE).
    expect(read?.sql).not.toMatch(/FOR (UPDATE|SHARE|KEY SHARE|NO KEY UPDATE)/);
    expect(read?.values).toEqual([DOCUMENT, ORG_A, ORG_A]);
  });

  it('marks the resolved set inside the same call that read it', async () => {
    const statements: Statement[] = [];
    const rows = [
      usedRow({ id: CONFIG_A }),
      usedRow({ id: CONFIG_B, organizationId: ORG_A }),
    ];
    const client = fakeClient({
      lines: [
        { accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A },
        { accountId: ACCOUNT_2, accountingConfigurationId: CONFIG_B },
      ],
      configurations: rows,
      statements,
    });

    const marked = await markConfigurationsUsedByDocumentInTx(client, {
      organizationId: ORG_A,
      documentId: DOCUMENT,
      accountIds: [ACCOUNT_1, ACCOUNT_2],
      now: new Date('2026-04-05T06:00:00.000Z'),
      actorId: null,
    });

    expect(marked).toEqual([CONFIG_A, CONFIG_B]);
    expect(
      statements.map((statement) => statement.sql.trim().split(/\s+/)[0]),
    ).toEqual(['SELECT', 'UPDATE', 'UPDATE']);
  });

  it('refuses BEFORE writing when a reference cannot be resolved', async () => {
    const statements: Statement[] = [];
    const rows = [usedRow()];
    const client = fakeClient({
      // ACCOUNT_2 has no pin row: the account is foreign or gone.
      lines: [{ accountId: ACCOUNT_1, accountingConfigurationId: CONFIG_A }],
      configurations: rows,
      statements,
    });

    await expect(
      markConfigurationsUsedByDocumentInTx(client, {
        organizationId: ORG_A,
        documentId: DOCUMENT,
        accountIds: [ACCOUNT_1, ACCOUNT_2],
        now: new Date(),
        actorId: null,
      }),
    ).rejects.toThrow(/account_pin_unresolved/);

    // Only the read ran — an unresolvable reference marks nothing, and the
    // surrounding finalization transaction rolls back with the throw.
    expect(statements).toHaveLength(1);
    expect(rows[0]?.operationallyUsedAt).toBeNull();
  });
});

describe('operational-freeze boundary contract (Task 13 §5/§7)', () => {
  it('exposes no HTTP surface that marks usage', () => {
    // §7: usage is a fact about a committed business effect. An endpoint (or a
    // route DTO field) that set it would let a caller freeze a configuration
    // without performing any operation, so the surface must not exist at all —
    // asserted over the WHOLE `api/` folder, so a future controller cannot add
    // one silently.
    const apiFiles = sourceFiles('src/modules/accounting/api');
    expect(apiFiles.length).toBeGreaterThan(0);
    for (const path of apiFiles) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/markOperationallyUsed/);
      expect(source, path).not.toMatch(
        /@(Get|Post|Patch|Put|Delete)\((?:'|")[^'"]*(usage|used|freeze)/i,
      );
      expect(source, path).not.toMatch(/operationally_used_at/);
    }
  });

  it('registers no permission for marking usage', () => {
    const source = readFileSync(
      'src/modules/accounting/domain/accounting-permissions.ts',
      'utf8',
    );
    const codes = [...source.matchAll(/'(Accounting\.[A-Za-z.]+)'/g)].map(
      (match) => match[1] as string,
    );
    expect(codes.length).toBeGreaterThan(0);
    // Existing permissions stay sufficient: finalizing (the business operation)
    // is what marks, so no new code exists and none may be added.
    expect(
      codes.filter((code) => /Used|Use|Freeze|Unfreeze|Mark/i.test(code)),
    ).toEqual([]);
  });

  it('keeps exactly one writer of the marker column', () => {
    // `SET "operationally_used_at"` is THE write. Two writers would mean two
    // idempotency rules, and the frozen guarantee would be only as strong as
    // the weaker one.
    const writers = sourceFiles('src/modules').filter((path) =>
      readFileSync(path, 'utf8').includes('SET "operationally_used_at"'),
    );
    expect(writers).toEqual([
      'src/modules/accounting/data/accounting-configuration-usage.ts',
    ]);
  });

  it('is called from the finalization transaction and nowhere else', () => {
    const callers = sourceFiles('src/modules').filter(
      (path) =>
        !path.endsWith('accounting-configuration-usage.ts') &&
        readFileSync(path, 'utf8').includes(
          'markConfigurationsUsedByDocumentInTx(',
        ),
    );
    expect(callers).toEqual([
      'src/modules/accounting/data/accounting-documents.repository.ts',
    ]);
  });
});

/**
 * Every non-spec TypeScript source under a folder, for the static contract
 * checks above (the `level-kind-contract.spec.ts` precedent: a guarantee that
 * lives in "this file is the only one that does X" cannot be tested
 * behaviourally, so the declarations are read and compared).
 */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) {
      out.push(path);
    }
  }
  return out.sort();
}
