import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { SourcePostingMapping } from '../domain/source-posting-mapping.js';
import type {
  OrderBy,
  SourcePostingMappingDelegate,
  SourcePostingMappingRow,
  SourcePostingMappingWhere,
} from './accounting-rows.js';

/**
 * Data access for `accounting.source_posting_mappings` — the Accounting-owned
 * source → journal mapping (C-62, PDR-10 C62-OD-04).
 *
 * READ-ONLY in this slice: the mapping is resolved by the posting contract and
 * a missing row fails closed. The administrative surface that creates and
 * edits rows is a separate task, so no write method exists here yet — a write
 * nobody calls would be exactly the dormant capability
 * `docs/security.md` §3 forbids.
 *
 * Every read is scoped by the caller's organization: a mapping is looked up by
 * `(organizationId, sourceModule, sourceDocumentType)`, never by id alone, so
 * a cross-organization lookup cannot even be expressed.
 */
type Client = {
  sourcePostingMapping: Pick<
    SourcePostingMappingDelegate,
    'findFirst' | 'findMany' | 'count'
  >;
};

export interface SourcePostingMappingListFilter {
  organizationId: string;
  sourceModule?: string | undefined;
  sourceDocumentType?: string | undefined;
}

@Injectable()
export class SourcePostingMappingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findForSource(input: {
    organizationId: string;
    sourceModule: string;
    sourceDocumentType: string;
  }): Promise<SourcePostingMapping | null> {
    const { sourcePostingMapping } = await this.client();
    const row = await sourcePostingMapping.findFirst({
      where: {
        organizationId: input.organizationId,
        sourceModule: input.sourceModule,
        sourceDocumentType: input.sourceDocumentType,
      },
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: SourcePostingMappingListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: SourcePostingMapping[]; total: number }> {
    const { sourcePostingMapping } = await this.client();
    const where: SourcePostingMappingWhere = {
      organizationId: params.where.organizationId,
    };
    if (params.where.sourceModule !== undefined) {
      where.sourceModule = params.where.sourceModule;
    }
    if (params.where.sourceDocumentType !== undefined) {
      where.sourceDocumentType = params.where.sourceDocumentType;
    }
    const [rows, total] = await Promise.all([
      sourcePostingMapping.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      sourcePostingMapping.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }
}

function toDomain(row: SourcePostingMappingRow): SourcePostingMapping {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceModule: row.sourceModule,
    sourceDocumentType: row.sourceDocumentType,
    financialAreaId: row.financialAreaId,
    debitAccountId: row.debitAccountId,
    creditAccountId: row.creditAccountId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
