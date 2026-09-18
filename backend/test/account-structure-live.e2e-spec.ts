import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { CodingStructuresService } from '../src/modules/accounting/application/coding-structures.service.js';
import { AccountingConfigurationsService } from '../src/modules/accounting/application/accounting-configurations.service.js';
import { AccountsService } from '../src/modules/accounting/application/accounts.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database concurrency suite for the coding structure + chart of accounts
 * (Task 10.3). Skipped unless VARDENA_TEST_DATABASE_URL is set (CI with
 * Postgres, or local Docker). Requires a generated client
 * (`npm run prisma:generate`) and a migrated database (`prisma migrate deploy`).
 *
 * This is where the invariants that a sequential test cannot prove are
 * exercised for real, against the actual `accounting.coding_structure_versions`,
 * `accounting.coding_structure_levels` and `accounting.accounts` tables
 * created by `20260914010000_accounting_coding_structure_accounts`:
 *
 * - the `(organization_id, code)` unique index — not the service's pre-check —
 *   decides a duplicate-code race, and the loser gets 409 with no torn write;
 * - the organization-wide version locks admit exactly ONE concurrent publish,
 *   so "exactly one active coding structure per organization" (§9.4) holds in
 *   the persisted rows;
 * - the parent-row lock serialises a postability flip against the first child
 *   create, so "postable ⇒ leaf" (§14 rule 2) is never violated by the pair;
 * - level derivation and the code-prefix proof hold for every row that survives
 *   a burst of concurrent sibling creates;
 * - concurrent cycle-forming re-parentings leave an ACYCLIC graph, verified by
 *   a recursive walk over the persisted edges (not by trusting the guard).
 *
 * The services run here in system context (no HTTP request in flight), so
 * authorization is not under test — only the data-plane guarantees
 * (`docs/accounting/domain-contract.md` AC-I-10/11, ADR-0026 §7).
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Accounting chart foundation (live database)',
  () => {
    const suffix = generateId().slice(-8);

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizationId = '';

    /** A 2 + 3 configuration, chosen to differ from the other suites'. */
    const CONFIGURATION = {
      maxDepth: 2,
      separator: '-',
      levels: [
        {
          levelIndex: 1,
          title: 'Group',
          digitLength: 2,
          defaultIsPostable: false,
        },
        {
          levelIndex: 2,
          title: 'Detail',
          digitLength: 3,
          defaultIsPostable: false,
        },
      ],
    };

    function createAccount(
      code: string,
      extra: { parentId?: string; isPostable?: boolean; title?: string } = {},
    ) {
      const input: Parameters<AccountsService['createAccount']>[0] = {
        organizationId,
        code,
        title: extra.title ?? `Live ${code}`,
        accountNature: 'debit',
      };
      if (extra.parentId !== undefined) input.parentId = extra.parentId;
      if (extra.isPostable !== undefined) input.isPostable = extra.isPostable;
      return app!.get(AccountsService).createAccount(input);
    }

    async function rows(where: Record<string, unknown>) {
      const client = await prisma.getClient<{
        account: {
          findMany: (args: unknown) => Promise<
            Array<{
              id: string;
              code: string;
              parentId: string | null;
              level: number;
              isPostable: boolean;
              codingStructureVersionId: string;
            }>
          >;
        };
      }>();
      return client.account.findMany({
        where: { organizationId, ...where },
        orderBy: [{ code: 'asc' }],
      });
    }

    async function versionRows(where: Record<string, unknown>) {
      const client = await prisma.getClient<{
        codingStructureVersion: {
          findMany: (
            args: unknown,
          ) => Promise<Array<{ id: string; code: string; status: string }>>;
        };
      }>();
      return client.codingStructureVersion.findMany({
        where: { organizationId, ...where },
        orderBy: [{ id: 'asc' }],
      });
    }

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);

      const organizations = app.get(OrganizationsService);
      const structures = app.get(CodingStructuresService);
      const configurations = app.get(AccountingConfigurationsService);
      organizationId = (
        await organizations.createOrganization({
          code: `CHART-${suffix}`,
          name: 'Chart live org',
        })
      ).id;
      const draft = await structures.createVersion({
        organizationId,
        code: 'LIVE',
        ...CONFIGURATION,
      });
      await structures.publishVersion(organizationId, draft.id);
      const accDraft = await configurations.createConfiguration({
        organizationId,
        code: 'LIVE',
        name: 'Live config',
        levels: CONFIGURATION.levels as any,
      });
      await configurations.publishConfiguration(organizationId, accDraft.id);
    }, 60_000);

    afterAll(async () => {
      if (app !== undefined) {
        try {
          // Test-only cleanup through the raw client: the API has no delete
          // endpoints for these rows (§8.6 — accounts are never deleted).
          const client = await prisma.getClient<{
            account: { deleteMany: (args: unknown) => Promise<unknown> };
            accountingConfigurationLevel: {
              deleteMany: (args: unknown) => Promise<unknown>;
            };
            accountingConfiguration: {
              deleteMany: (args: unknown) => Promise<unknown>;
            };
            codingStructureLevel: {
              deleteMany: (args: unknown) => Promise<unknown>;
            };
            codingStructureVersion: {
              deleteMany: (args: unknown) => Promise<unknown>;
            };
            organization: { deleteMany: (args: unknown) => Promise<unknown> };
          }>();
          await client.account.deleteMany({ where: { organizationId } });
          await client.accountingConfigurationLevel.deleteMany({
            where: { organizationId },
          });
          await client.accountingConfiguration.deleteMany({
            where: { organizationId },
          });
          await client.codingStructureLevel.deleteMany({
            where: { organizationId },
          });
          await client.codingStructureVersion.deleteMany({
            where: { organizationId },
          });
          await client.organization.deleteMany({
            where: { id: organizationId },
          });
        } finally {
          // app.close() owns the Prisma client + pg pool teardown.
          await app.close();
        }
      }
    }, 60_000);

    it('lets the unique index decide a duplicate-code race', async () => {
      // Every writer aims at the SAME code from a separate connection: the
      // unique index is the arbiter, so at most one may insert.
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, () => createAccount('30')),
      );

      const winners = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      expect(winners).toHaveLength(1);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toMatchObject({ code: 'Conflict' });
        }
      }
      const rowsAfter = await rows({ code: '30' });
      expect(rowsAfter).toHaveLength(1);
    }, 60_000);

    it('admits exactly one concurrent publish of a coding structure version', async () => {
      const structures = app!.get(CodingStructuresService);
      // Four drafts of FOUR distinct structures: the ordinal index cannot be
      // the reason one of them fails, so only the active-version guard can.
      const drafts = await Promise.all(
        [1, 2, 3, 4].map((index) =>
          structures.createVersion({
            organizationId,
            code: `RACE${index}`,
            ...CONFIGURATION,
          }),
        ),
      );

      const outcomes = await Promise.allSettled(
        drafts.map((draft) =>
          structures.publishVersion(organizationId, draft.id),
        ),
      );
      // Publishing is SERIALIZED, not mutually exclusive-refused: each writer
      // waits on the organization-wide lock, re-reads the committed rows under
      // it, and activates its own version. All four may therefore succeed…
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          throw new Error(
            `publish must not fail under contention: ${String(
              (outcome.reason as { message?: string })?.message,
            )}`,
          );
        }
      }
      // …but the persisted state must show EXACTLY ONE active version (§9.4) —
      // and it is NOT the version this suite published in `beforeAll` anymore,
      // which is why later tests read the pinned version off the rows instead
      // of assuming a fixture id.
      const active = await versionRows({ status: 'active' });
      expect(active).toHaveLength(1);
      const superseded = await versionRows({ status: 'superseded' });
      // The pre-existing LIVE version plus the three losers of the race.
      expect(superseded).toHaveLength(4);
      expect(await versionRows({ status: 'draft' })).toHaveLength(0);
      expect((await versionRows({})).length).toBe(5);
    }, 60_000);

    it('serialises a postability flip against the first child create', async () => {
      const accounts = app!.get(AccountsService);
      const parent = await createAccount('40');
      // (a) make the parent postable, (b) put a child under it — concurrently.
      // The two writes lock the SAME row (the parent), so the pair may never
      // leave "postable account with children" behind (§14 rule 2).
      const [flip, child] = await Promise.allSettled([
        accounts.updateAccount(organizationId, parent.id, { isPostable: true }),
        createAccount('40001', { parentId: parent.id }),
      ]);

      const persisted = await rows({ code: '40' });
      const children = await rows({ parentId: parent.id });
      expect(persisted).toHaveLength(1);
      const persistedParent = persisted[0];
      if (persistedParent === undefined) throw new Error('parent row missing');
      if (children.length > 0) {
        expect(persistedParent.isPostable).toBe(false);
      } else {
        expect(persistedParent.isPostable).toBe(true);
      }
      // Exactly one of the two committed; the other was refused as a rule.
      const committed = [flip, child].filter((o) => o.status === 'fulfilled');
      expect(committed).toHaveLength(1);
      for (const outcome of [flip, child]) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toMatchObject({
            code: 'BusinessRuleViolation',
          });
        }
      }
    }, 60_000);

    it('keeps every concurrent sibling consistent with the pinned structure', async () => {
      const parent = await createAccount('50');
      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, (_, index) =>
          createAccount(`50${String(index).padStart(3, '0')}`, {
            parentId: parent.id,
          }),
        ),
      );
      // All ten are distinct codes, so all ten must succeed — and every row
      // must carry the derived level, the parent's version and the prefix.
      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(
        true,
      );
      const children = await rows({ parentId: parent.id });
      expect(children).toHaveLength(10);
      const [persistedParent] = await rows({ code: '50' });
      if (persistedParent === undefined) throw new Error('parent row missing');
      for (const child of children) {
        expect(child.level).toBe(2);
        expect(child.code.startsWith('50')).toBe(true);
        expect(child.code).toHaveLength(5);
        // The rule under test is the CHILD rule: a child inherits the version
        // its PARENT is pinned to — never "the current active one". Asserting
        // that instead of a fixture id keeps this test independent of the
        // publish race above, which legitimately supersedes the version this
        // suite published in `beforeAll`.
        expect(child.codingStructureVersionId).toBe(
          persistedParent.codingStructureVersionId,
        );
      }
      // …and the version a ROOT landed on is a real, non-draft one.
      const pinned = (await versionRows({})).find(
        (row) => row.id === persistedParent.codingStructureVersionId,
      );
      expect(pinned?.status).not.toBe('draft');
    }, 60_000);

    it('leaves an acyclic graph after concurrent cycle-forming re-parentings', async () => {
      const accounts = app!.get(AccountsService);
      const pairs: Array<[string, string]> = [
        ['60', '60001'],
        ['61', '61001'],
        ['62', '62001'],
      ];
      const ids: Array<{ root: string; child: string }> = [];
      for (const [rootCode, childCode] of pairs) {
        const root = await createAccount(rootCode);
        const child = await createAccount(childCode, { parentId: root.id });
        ids.push({ root: root.id, child: child.id });
      }

      // Every attempt moves a root UNDER its own child — the one-edge cycle.
      const outcomes = await Promise.allSettled(
        ids.map((pair) =>
          accounts.updateAccount(organizationId, pair.root, {
            parentId: pair.child,
          }),
        ),
      );
      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toMatchObject({
            code: 'BusinessRuleViolation',
            details: { rule: 'cycle' },
          });
        }
      }

      // The proof is a database-side walk, not the guard's word: every account
      // must be reachable from a root. A cycle would hide nodes from this
      // query, and the recursion would not terminate without `CYCLE`.
      const client = await prisma.getClient<{
        $queryRaw: (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ reachable: number; total: number }>>;
      }>();
      const [counts] = await client.$queryRaw`
        WITH RECURSIVE walk("id", "depth") AS (
          SELECT a."id", 0
            FROM "accounting"."accounts" AS a
           WHERE a."organization_id" = ${organizationId}
             AND a."parent_id" IS NULL
          UNION ALL
          SELECT child."id", walk."depth" + 1
            FROM "accounting"."accounts" AS child
            JOIN walk ON child."parent_id" = walk."id"
           WHERE child."organization_id" = ${organizationId}
             AND walk."depth" < 32
        )
        SELECT
          (SELECT count(DISTINCT "id") FROM walk)::int AS "reachable",
          (SELECT count(*) FROM "accounting"."accounts"
            WHERE "organization_id" = ${organizationId})::int AS "total"`;
      expect(counts).toBeDefined();
      expect(counts?.reachable).toBe(counts?.total);
    }, 60_000);

    it('assigns distinct version ordinals under concurrent drafting', async () => {
      const structures = app!.get(CodingStructuresService);
      // Six concurrent "next version of RACE-DRAFT" creates: max + 1 is a
      // read-then-write, so the ORDINAL index (and the retry behind it) is what
      // has to keep them distinct.
      const outcomes = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          structures.createVersion({
            organizationId,
            code: 'RACE-DRAFT',
            ...CONFIGURATION,
          }),
        ),
      );
      const created = outcomes
        .filter((o) => o.status === 'fulfilled')
        .map(
          (o) =>
            (o as PromiseFulfilledResult<{ id: string; versionNumber: number }>)
              .value,
        );
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toMatchObject({ code: 'Conflict' });
        }
      }
      const numbers = created
        .map((row) => row.versionNumber)
        .sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(
        created.length + outcomes.filter((o) => o.status === 'rejected').length,
      ).toBe(6);

      const client = await prisma.getClient<{
        codingStructureVersion: {
          count: (args: unknown) => Promise<number>;
        };
      }>();
      const total = await client.codingStructureVersion.count({
        where: { organizationId, code: 'RACE-DRAFT' },
      });
      expect(total).toBe(created.length);
    }, 60_000);

    it('never pins a new root account to a version that is not active', async () => {
      const structures = app!.get(CodingStructuresService);
      const accounts = app!.get(AccountsService);
      // A publish that will supersede the version the creates resolve against:
      // a create either lands on the version that was active in its own
      // transaction, or is refused with 409 — never silently pinned to a
      // freshly superseded version, and never a 500.
      const next = await structures.createVersion({
        organizationId,
        code: 'LIVE',
        ...CONFIGURATION,
      });
      const outcomes = await Promise.allSettled([
        structures.publishVersion(organizationId, next.id),
        accounts.createAccount({
          organizationId,
          code: '70',
          title: 'Race root A',
          accountNature: 'debit',
        }),
        accounts.createAccount({
          organizationId,
          code: '71',
          title: 'Race root B',
          accountNature: 'debit',
        }),
      ]);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          const reason = outcome.reason as { code?: string };
          expect(['Conflict', 'BusinessRuleViolation']).toContain(reason.code);
        }
      }
      const client = await prisma.getClient<{
        $queryRaw: (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ orphans: number }>>;
      }>();
      const [violations] = await client.$queryRaw`
        SELECT count(*)::int AS "orphans"
          FROM "accounting"."accounts" AS a
          JOIN "accounting"."coding_structure_versions" AS v
            ON v."id" = a."coding_structure_version_id"
         WHERE a."organization_id" = ${organizationId}
           AND a."parent_id" IS NULL
           AND v."status" = 'draft'`;
      expect(violations?.orphans).toBe(0);
    }, 60_000);
  },
);
