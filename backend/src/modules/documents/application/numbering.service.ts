import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { NumberingSeriesRepository } from '../data/numbering-series.repository.js';
import { NumberingAllocationsRepository } from '../data/numbering-allocations.repository.js';
import type { NumberingAllocation } from '../domain/numbering-allocation.js';
import { toNumberingAllocationDto } from '../domain/numbering-allocation.js';
import { NUMBERING_PERMISSIONS } from '../domain/document-permissions.js';
import { DOCUMENT_NUMBER_ALLOCATED_EVENT } from '../domain/document.events.js';
import {
  normalizeReference,
  publishEvent,
  requireAllocationKey,
  requireScopeKey,
} from './documents-support.js';
import { NumberingSeriesService } from './numbering-series.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  number: 'number',
  createdAt: 'createdAt',
};

export interface AllocateNumberInput {
  organizationId: string;
  documentType: string;
  scopeKey?: string | null | undefined;
  allocationKey: string;
  referenceModule?: string | null | undefined;
  referenceDocumentType?: string | null | undefined;
  referenceDocumentId?: string | null | undefined;
}

export interface ListAllocationsQuery {
  organizationId: string;
  seriesId?: string | undefined;
  documentType?: string | undefined;
  referenceModule?: string | undefined;
  referenceDocumentType?: string | undefined;
  referenceDocumentId?: string | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

/**
 * Number allocation and the numbering ledger (Task 8 §11/§17).
 *
 * Allocation is concurrency-safe by construction: the repository locks the
 * series counter (`SELECT … FOR UPDATE`) and writes the allocation row and the
 * counter advance in ONE transaction, and `(series_id, number)` is unique —
 * two concurrent requests for one series can never receive the same serial.
 *
 * Allocation is idempotent: a retried `allocationKey` with the identical
 * intent replays the stored serial; the same key with different intent is
 * rejected with 409 and never applied. The pre-check and the unique-violation
 * fallback (two requests racing the same key) funnel through `replayOrReject`.
 */
@Injectable()
export class NumberingService {
  constructor(
    private readonly series: NumberingSeriesService,
    private readonly seriesRepository: NumberingSeriesRepository,
    private readonly allocations: NumberingAllocationsRepository,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listAllocations(
    query: ListAllocationsQuery,
  ): Promise<PaginatedResult<ReturnType<typeof toNumberingAllocationDto>>> {
    await this.authorization.requireAllPermissions([
      NUMBERING_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.allocations.list({
      where: {
        organizationId: query.organizationId,
        seriesId: query.seriesId,
        documentType: query.documentType,
        referenceModule: query.referenceModule,
        referenceDocumentType: query.referenceDocumentType,
        referenceDocumentId: query.referenceDocumentId,
      },
      orderBy: resolveSort(query.sort),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toNumberingAllocationDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getAllocation(organizationId: string, id: string) {
    await this.authorization.requireAllPermissions([
      NUMBERING_PERMISSIONS.VIEW,
    ]);
    const allocation = await this.allocations.findById(id);
    if (allocation === null || allocation.organizationId !== organizationId) {
      throw AppException.notFound('Numbering allocation', id);
    }
    return toNumberingAllocationDto(allocation);
  }

  /**
   * Allocate the next serial for a document (module-internal service — Task 8
   * §20 exposes no standalone HTTP allocation). No permission of its own: the
   * owning module has already authorized the document operation this
   * allocation is part of. The allocation participates in the caller's
   * transaction boundary via the shared Prisma client.
   */
  async allocateNumber(input: AllocateNumberInput) {
    const allocationKey = requireAllocationKey(input.allocationKey);
    const scopeKey = requireScopeKey(input.scopeKey);
    const reference = normalizeReference({
      referenceModule: input.referenceModule,
      referenceDocumentType: input.referenceDocumentType,
      referenceDocumentId: input.referenceDocumentId,
    });

    const resolved = await this.series.resolveSeries(
      input.organizationId,
      input.documentType,
      scopeKey,
    );
    if (resolved === null) {
      throw AppException.businessRule(
        `No numbering series is configured for document type "${input.documentType}"` +
          (scopeKey === '' ? '' : ` (scope "${scopeKey}")`) +
          ` in this organization. Configure one before allocating numbers.`,
      );
    }
    if (!resolved.isActive) {
      throw AppException.businessRule(
        `The numbering series for document type "${input.documentType}" is disabled.`,
      );
    }

    const replay = await this.replayOrReject(
      resolved.id,
      allocationKey,
      reference,
    );
    if (replay !== null) return replay;

    const actorId = getPrincipal()?.userId ?? null;
    const allocationId = generateId();
    try {
      const { allocation } = await this.seriesRepository.allocate({
        seriesId: resolved.id,
        organizationId: input.organizationId,
        documentType: input.documentType,
        allocationId,
        allocationKey,
        referenceModule: reference.referenceModule,
        referenceDocumentType: reference.referenceDocumentType,
        referenceDocumentId: reference.referenceDocumentId,
        actorId,
      });
      await publishEvent(this.events, {
        type: DOCUMENT_NUMBER_ALLOCATED_EVENT,
        aggregateType: 'DocumentNumber',
        aggregateId: allocation.id,
        payload: {
          id: allocation.id,
          organizationId: allocation.organizationId,
          seriesId: allocation.seriesId,
          documentType: allocation.documentType,
          number: allocation.number,
          referenceModule: allocation.referenceModule,
          referenceDocumentType: allocation.referenceDocumentType,
          referenceDocumentId: allocation.referenceDocumentId,
        },
      });
      this.logger.log(
        'Document number allocated',
        {
          allocationId: allocation.id,
          seriesId: resolved.id,
          organizationId: allocation.organizationId,
          number: allocation.number,
        },
        NumberingService.name,
      );
      return toNumberingAllocationDto(allocation);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Lost a key/number race inside the transaction: the winner's row is
        // what decides replay-or-reject now.
        const raced = await this.replayOrReject(
          resolved.id,
          allocationKey,
          reference,
        );
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  // ---- internals ----------------------------------------------------------

  /**
   * The idempotency decision for one (series, key): no row → null (proceed to
   * allocate); row with the same reference → the replayed allocation; row with
   * a different reference → 409 (the key is taken by other intent).
   */
  private async replayOrReject(
    seriesId: string,
    allocationKey: string,
    reference: {
      referenceModule: string | null;
      referenceDocumentType: string | null;
      referenceDocumentId: string | null;
    },
  ): Promise<ReturnType<typeof toNumberingAllocationDto> | null> {
    const existing = await this.allocations.findBySeriesAndKey(
      seriesId,
      allocationKey,
    );
    if (existing === null) return null;
    assertReplayable(existing, reference);
    return toNumberingAllocationDto(existing);
  }
}

// ---- Internal helpers ----

function resolveSort(
  sort: string | undefined,
): Array<Record<string, 'asc' | 'desc'>> {
  if (sort === undefined || sort === '') {
    return [{ number: 'asc' }];
  }
  return sort.split(',').map((entry) => {
    const [field, direction] = entry.split(':');
    const mapped = field === undefined ? undefined : SORTABLE_FIELDS[field];
    if (mapped === undefined || (direction !== 'asc' && direction !== 'desc')) {
      throw AppException.validation([
        {
          field: 'sort',
          message: `Cannot sort by "${field ?? ''}". Allowed: ${Object.keys(SORTABLE_FIELDS).join(', ')}.`,
          code: 'isSortableField',
        },
      ]);
    }
    return { [mapped]: direction };
  });
}

function assertReplayable(
  existing: NumberingAllocation,
  reference: {
    referenceModule: string | null;
    referenceDocumentType: string | null;
    referenceDocumentId: string | null;
  },
): void {
  if (
    existing.referenceModule !== reference.referenceModule ||
    existing.referenceDocumentType !== reference.referenceDocumentType ||
    existing.referenceDocumentId !== reference.referenceDocumentId
  ) {
    throw AppException.conflict(
      'This allocationKey was already used with a different request. ' +
        'Retry with the original request, or use a new key.',
    );
  }
}
