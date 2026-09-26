import { beforeEach, describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import {
  createDocumentStores,
  type DocumentStores,
} from '../../../../test/support/document-repositories.js';
import { DocumentTypeRegistry } from './document-type-registry.js';
import { DocumentTypesService } from './document-types.service.js';
import { NumberingSeriesService } from './numbering-series.service.js';
import { NumberingService } from './numbering.service.js';
import { uniqueViolation } from '../../../../test/support/in-memory-repositories.js';
import { DOCUMENT_NUMBER_ALLOCATED_EVENT } from '../domain/document.events.js';

/**
 * `NumberingService` — allocation idempotency and the concurrency contract
 * (Task 8 §11/§17, ADR-0019 §7).
 *
 * The no-duplicate guarantee has three layers, exercised here:
 *   1. the repository's locked counter (in-memory fake mirrors the real
 *      `SELECT … FOR UPDATE` transaction: compute → insert → advance);
 *   2. the `(series, allocationKey)` unique index → idempotent replay;
 *   3. the unique-violation fallback → a lost race recovers via replay-or-
 *      reject instead of double-issuing.
 *
 * True row-lock contention is a Postgres behaviour and is covered by the
 * opt-in live-database suite (`test/documents-live.e2e-spec.ts`).
 */

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

interface Fixture {
  numbering: NumberingService;
  series: NumberingSeriesService;
  stores: DocumentStores;
  events: DomainEvent[];
  organizationId: string;
  seriesId: string;
}

async function buildFixture(): Promise<Fixture> {
  const stores = createDocumentStores();
  const master = createMasterDataStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  bus.on(DOCUMENT_NUMBER_ALLOCATED_EVENT, (event) => {
    events.push(event);
  });

  // No request context → system context, so authorization is the caller's
  // concern (see AuthorizationService). HTTP authorization is covered by the
  // e2e suite.
  const authorization = new AuthorizationService(
    undefined as never,
    loggerStub(),
  );
  const organizations = new OrganizationsService(
    master.organizations,
    master.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
  );
  const registry = new DocumentTypeRegistry();
  registry.register([
    {
      code: 'inventory_receipt',
      module: 'inventory',
      name: 'Inventory receipt',
      draftCapable: true,
      entryStates: ['temporary'],
      deletablePhases: ['draft', 'temporary'],
    },
  ]);
  const documentTypes = new DocumentTypesService(
    registry,
    stores.typeConfigs,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const seriesService = new NumberingSeriesService(
    stores.numberingSeries,
    organizations,
    documentTypes,
    authorization,
    loggerStub(),
  );
  const numbering = new NumberingService(
    seriesService,
    stores.numberingSeries,
    stores.numberingAllocations,
    authorization,
    loggerStub(),
    bus,
  );

  const organizationId = (
    await organizations.createOrganization({ code: 'ORG-A', name: 'Org A' })
  ).id;
  const series = await seriesService.createNumberingSeries({
    organizationId,
    documentType: 'inventory_receipt',
    name: 'Receipts',
    width: 5,
  });

  return {
    numbering,
    series: seriesService,
    stores,
    events,
    organizationId,
    seriesId: series.id,
  };
}

function reference(id: string): {
  referenceModule: string;
  referenceDocumentType: string;
  referenceDocumentId: string;
} {
  return {
    referenceModule: 'inventory',
    referenceDocumentType: 'inventory_receipt',
    referenceDocumentId: id,
  };
}

describe('NumberingService allocation', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('allocates a numeric-only, zero-padded serial and publishes an event', async () => {
    const allocation = await fixture.numbering.allocateNumber({
      organizationId: fixture.organizationId,
      documentType: 'inventory_receipt',
      allocationKey: 'receipt-1',
      ...reference(generateId()),
    });

    expect(allocation.number).toBe('00001');
    expect(allocation.number).toMatch(/^\d+$/);
    expect(fixture.events.map((event) => event.type)).toEqual([
      DOCUMENT_NUMBER_ALLOCATED_EVENT,
    ]);
    // The counter advanced, visible through the series.
    const series = await fixture.series.getNumberingSeries(
      fixture.organizationId,
      fixture.seriesId,
    );
    expect(series.lastValue).toBe('1');
  });

  it('allocates distinct monotonic serials across distinct keys', async () => {
    const first = await fixture.numbering.allocateNumber({
      organizationId: fixture.organizationId,
      documentType: 'inventory_receipt',
      allocationKey: 'k-1',
      ...reference(generateId()),
    });
    const second = await fixture.numbering.allocateNumber({
      organizationId: fixture.organizationId,
      documentType: 'inventory_receipt',
      allocationKey: 'k-2',
      ...reference(generateId()),
    });
    expect([first.number, second.number]).toEqual(['00001', '00002']);
  });

  it('replays the stored serial for a retried allocation key (idempotent)', async () => {
    const key = 'receipt-retry';
    const ref = reference(generateId());
    const first = await fixture.numbering.allocateNumber({
      organizationId: fixture.organizationId,
      documentType: 'inventory_receipt',
      allocationKey: key,
      ...ref,
    });
    const replay = await fixture.numbering.allocateNumber({
      organizationId: fixture.organizationId,
      documentType: 'inventory_receipt',
      allocationKey: key,
      ...ref,
    });

    expect(replay.number).toBe(first.number);
    expect(replay.id).toBe(first.id);
    // One ledger row, one serial, one event.
    expect(fixture.stores.raw.numberingAllocations.stateSize()).toBe(1);
    expect(fixture.events).toHaveLength(1);
    const series = await fixture.series.getNumberingSeries(
      fixture.organizationId,
      fixture.seriesId,
    );
    expect(series.lastValue).toBe('1');
  });

  it('rejects the same key with a different logical reference (409)', async () => {
    await fixture.numbering.allocateNumber({
      organizationId: fixture.organizationId,
      documentType: 'inventory_receipt',
      allocationKey: 'shared-key',
      ...reference(generateId()),
    });
    await expect(
      fixture.numbering.allocateNumber({
        organizationId: fixture.organizationId,
        documentType: 'inventory_receipt',
        allocationKey: 'shared-key',
        ...reference(generateId()),
      }),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('handles concurrent allocations with distinct keys without collisions', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        fixture.numbering.allocateNumber({
          organizationId: fixture.organizationId,
          documentType: 'inventory_receipt',
          allocationKey: `parallel-${index}`,
          ...reference(generateId()),
        }),
      ),
    );

    const numbers = results.map((allocation) => allocation.number);
    expect(new Set(numbers).size).toBe(25);
    // Every serial is exactly the monotonic sequence — no gaps, no duplicates.
    expect(
      numbers.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    ).toEqual(
      Array.from({ length: 25 }, (_, index) =>
        String(index + 1).padStart(5, '0'),
      ),
    );
  });

  it('recovers a lost allocation race through the unique-violation fallback', async () => {
    // Simulate two transactions racing the SAME key: the winner's insert
    // commits first, then this (losing) transaction's insert violates the
    // (series, key) unique index. The service must replay the winner's serial
    // from the fallback, never double-issue.
    const key = 'race-key';
    const ref = reference(generateId());
    let seededWinnerId = '';

    // A losing repository whose `allocate` commits the winner's row and then
    // fails with P2002 exactly like a real lost race.
    const losing = {
      allocate: async () => {
        const winner = fixture.stores.raw.numberingAllocations.seed({
          seriesId: fixture.seriesId,
          organizationId: fixture.organizationId,
          documentType: 'inventory_receipt',
          number: '00001',
          allocationKey: key,
          referenceModule: ref.referenceModule,
          referenceDocumentType: ref.referenceDocumentType,
          referenceDocumentId: ref.referenceDocumentId,
        });
        seededWinnerId = winner.id;
        throw uniqueViolation();
      },
    };
    const numberingWithRace = new NumberingService(
      fixture.series,
      losing as never,
      fixture.stores.numberingAllocations,
      new AuthorizationService(undefined as never, loggerStub()),
      loggerStub(),
      new DomainEventBus(),
    );

    const recovered = await numberingWithRace.allocateNumber({
      organizationId: fixture.organizationId,
      documentType: 'inventory_receipt',
      allocationKey: key,
      ...ref,
    });
    expect(recovered.id).toBe(seededWinnerId);
    expect(recovered.number).toBe('00001');
    expect(fixture.stores.raw.numberingAllocations.stateSize()).toBe(1);
  });

  it('rejects an allocation when no series is configured (422)', async () => {
    await expect(
      fixture.numbering.allocateNumber({
        organizationId: fixture.organizationId,
        documentType: 'sales_invoice',
        allocationKey: 'no-series',
        ...reference(generateId()),
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('rejects an allocation on a disabled series (422)', async () => {
    await fixture.series.updateNumberingSeries(
      fixture.organizationId,
      fixture.seriesId,
      {
        isActive: false,
      },
    );
    await expect(
      fixture.numbering.allocateNumber({
        organizationId: fixture.organizationId,
        documentType: 'inventory_receipt',
        allocationKey: 'disabled-series',
        ...reference(generateId()),
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('requires a non-blank allocation key', async () => {
    await expect(
      fixture.numbering.allocateNumber({
        organizationId: fixture.organizationId,
        documentType: 'inventory_receipt',
        allocationKey: '   ',
        ...reference(generateId()),
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('scopes by-id access to the owning organization (404 on another org)', async () => {
    // Resolves within the owning organization…
    await expect(
      fixture.series.requireSeriesInOrganization(
        fixture.organizationId,
        fixture.seriesId,
      ),
    ).resolves.toMatchObject({ id: fixture.seriesId });

    // …and answers 404 (never 403) for a foreign organization's id.
    await expect(
      fixture.series.requireSeriesInOrganization(
        generateId(),
        fixture.seriesId,
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });
});
