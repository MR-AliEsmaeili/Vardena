import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { FinancialAreasService } from '../src/modules/accounting/application/financial-areas.service.js';
import { FiscalYearsService } from '../src/modules/accounting/application/fiscal-years.service.js';
import { AccountingPeriodsService } from '../src/modules/accounting/application/accounting-periods.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database concurrency suite for the Accounting foundation (Task
 * 10.2). Skipped unless VARDENA_TEST_DATABASE_URL is set (CI with
 * Postgres, or local Docker). Requires a generated client
 * (`npm run prisma:generate`) and a migrated database
 * (`prisma migrate dev`).
 *
 * This is where the guarded transactions are exercised for real: the
 * area/year `SELECT … FOR UPDATE` serialization plus the unique
 * indexes must make concurrent creates/transitions settle deterministically
 * — exactly one winner, every loser a clean 4xx (never a torn write, never
 * two overlapping years, never two defaults). The in-memory suites
 * (`accounting-authorization.spec.ts`, `accounting.e2e-spec.ts`) cover the
 * same contract with faked data access but cannot prove lock contention.
 *
 * The services run here in system context (no HTTP request in flight), so
 * authorization is not under test — only the data-plane guarantees.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Accounting foundation (live database)',
  () => {
    const suffix = generateId().slice(-8);

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizationId = '';
    let areaId = '';

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
      const areas = app.get(FinancialAreasService);
      organizationId = (
        await organizations.createOrganization({
          code: `ACCT-${suffix}`,
          name: 'Accounting live org',
        })
      ).id;
      areaId = (
        await areas.createFinancialArea({
          organizationId,
          code: 'GA',
          title: 'General Area',
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (app !== undefined) {
        try {
          // Test-only cleanup through the raw client; the API has no delete
          // endpoints for these rows (Task 10.2 §20).
          const client = await prisma.getClient<{
            accountBalanceProjection: {
              deleteMany: (args: unknown) => Promise<unknown>;
            };
            accountingPeriod: {
              deleteMany: (args: unknown) => Promise<unknown>;
            };
            fiscalYear: { deleteMany: (args: unknown) => Promise<unknown> };
            financialArea: {
              deleteMany: (args: unknown) => Promise<unknown>;
            };
            organization: { deleteMany: (args: unknown) => Promise<unknown> };
          }>();
          // Task 12: balance projections RESTRICT their period/account/etc.,
          // so delete them before their parents (same as ledger-entries).
          await client.accountBalanceProjection.deleteMany({
            where: { organizationId },
          });
          await client.accountingPeriod.deleteMany({
            where: { organizationId },
          });
          await client.fiscalYear.deleteMany({ where: { organizationId } });
          await client.financialArea.deleteMany({
            where: { organizationId },
          });
          await client.organization.deleteMany({
            where: { id: organizationId },
          });
        } finally {
          // app.close() owns the Prisma client + pg pool teardown; it must
          // run even when cleanup fails, or the worker process stays alive.
          await app.close();
        }
      }
    }, 60_000);

    it('admits exactly one of concurrent overlapping year creates', async () => {
      const years = app!.get(FiscalYearsService);
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          years.createFiscalYear({
            organizationId,
            financialAreaId: areaId,
            // Distinct codes isolate the overlap guard (not the P2002 path).
            code: `RACE-Y${index}`,
            title: `Race year ${index}`,
            startDate: '2025-03-21',
            endDate: '2026-03-20',
          }),
        ),
      );

      const winners = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      const losers = outcomes.filter(
        (outcome) => outcome.status === 'rejected',
      );
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(7);
      // Every loser is the overlap rule — the guard re-evaluated inside
      // the area-locked transaction, after the winner committed.
      for (const loser of losers) {
        expect(loser).toMatchObject({
          status: 'rejected',
          reason: { code: 'BusinessRuleViolation' },
        });
      }

      const client = await prisma.getClient<{
        fiscalYear: { count: (args: unknown) => Promise<number> };
      }>();
      const count = await client.fiscalYear.count({
        where: { organizationId, financialAreaId: areaId },
      });
      expect(count).toBe(1);
    }, 60_000);

    it('maps a raced unique code to Conflict, not a torn write', async () => {
      const years = app!.get(FiscalYearsService);
      // Disjoint ranges isolate the unique-code path (not the overlap path).
      const ranges = [
        ['2027-03-21', '2028-03-19'],
        ['2028-03-20', '2029-03-19'],
        ['2029-03-20', '2030-03-19'],
        ['2030-03-20', '2031-03-19'],
      ] as const;
      const outcomes = await Promise.allSettled(
        ranges.map(([startDate, endDate]) =>
          years.createFiscalYear({
            organizationId,
            financialAreaId: areaId,
            code: 'RACE-CODE',
            title: 'Race code',
            startDate,
            endDate,
          }),
        ),
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
    }, 60_000);

    it('admits exactly one of concurrent overlapping period opens', async () => {
      const years = app!.get(FiscalYearsService);
      const periods = app!.get(AccountingPeriodsService);
      const year = await years.createFiscalYear({
        organizationId,
        financialAreaId: areaId,
        code: 'RACE-PY',
        title: 'Race periods year',
        startDate: '2032-03-20',
        endDate: '2033-03-20',
      });

      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          periods.createAccountingPeriod({
            organizationId,
            fiscalYearId: year.id,
            // Distinct sequences isolate the overlap guard (not P2002).
            sequence: index + 1,
            title: `Race period ${index}`,
            startDate: '2032-03-20',
            endDate: '2032-04-19',
          }),
        ),
      );

      const winners = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      expect(winners).toHaveLength(1);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toMatchObject({
            code: 'BusinessRuleViolation',
          });
        }
      }

      const client = await prisma.getClient<{
        accountingPeriod: { count: (args: unknown) => Promise<number> };
      }>();
      const count = await client.accountingPeriod.count({
        where: { fiscalYearId: year.id },
      });
      expect(count).toBe(1);
    }, 60_000);

    it('settles concurrent closes of one year with exactly one winner', async () => {
      const years = app!.get(FiscalYearsService);
      const year = await years.createFiscalYear({
        organizationId,
        financialAreaId: areaId,
        code: 'RACE-CLOSE',
        title: 'Race close year',
        startDate: '2034-03-21',
        endDate: '2035-03-20',
      });

      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          years.transitionFiscalYear({
            organizationId,
            id: year.id,
            transition: 'close',
            reason: 'Concurrent close.',
          }),
        ),
      );

      const winners = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      expect(winners).toHaveLength(1);
      // A loser either read `open` and lost the guarded write (409) or read
      // after the winner committed (422) — both are correct, neither wrote.
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(['Conflict', 'BusinessRuleViolation']).toContain(
            (outcome.reason as { code: string }).code,
          );
        }
      }
      const settled = await years.getFiscalYear(organizationId, year.id);
      expect(settled.status).toBe('closed');
    }, 60_000);

    it('keeps exactly one default under concurrent default transfers', async () => {
      const areas = app!.get(FinancialAreasService);
      const second = await areas.createFinancialArea({
        organizationId,
        code: 'GB',
        title: 'Second Area',
      });
      const third = await areas.createFinancialArea({
        organizationId,
        code: 'GC',
        title: 'Third Area',
      });

      // Both transfers serialize on the organization lock; each clears the
      // previous default inside the same transaction, so no two defaults
      // can survive regardless of interleaving.
      await Promise.all([
        areas.updateFinancialArea(organizationId, second.id, {
          isDefault: true,
        }),
        areas.updateFinancialArea(organizationId, third.id, {
          isDefault: true,
        }),
      ]);

      const client = await prisma.getClient<{
        financialArea: { count: (args: unknown) => Promise<number> };
      }>();
      const defaults = await client.financialArea.count({
        where: { organizationId, isDefault: true },
      });
      expect(defaults).toBe(1);
    }, 60_000);

    it('closes with cascade on the live schema, then seals', async () => {
      const years = app!.get(FiscalYearsService);
      const periods = app!.get(AccountingPeriodsService);
      const year = await years.createFiscalYear({
        organizationId,
        financialAreaId: areaId,
        code: 'LIVE-CASCADE',
        title: 'Live cascade year',
        startDate: '2036-03-21',
        endDate: '2037-03-20',
      });
      const period = await periods.createAccountingPeriod({
        organizationId,
        fiscalYearId: year.id,
        sequence: 1,
        title: 'Only period',
        startDate: '2036-03-21',
        endDate: '2036-04-20',
      });

      // An open period blocks the seal on the real schema too.
      await years.transitionFiscalYear({
        organizationId,
        id: year.id,
        transition: 'close',
        reason: 'Year-end close.',
      });
      const cascaded = await periods.getAccountingPeriod(
        organizationId,
        period.id,
      );
      expect(cascaded.status).toBe('closed');

      const sealed = await years.transitionFiscalYear({
        organizationId,
        id: year.id,
        transition: 'seal',
        reason: 'Audit sign-off.',
      });
      expect(sealed.status).toBe('sealed');
    }, 60_000);
  },
);
