import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { DocumentRelation } from '../domain/document-relation.js';
import { decimalToString } from './documents-rows.js';
import type {
  DocumentRelationCreate,
  DocumentRelationDelegate,
  DocumentRelationRow,
  DocumentRelationWhere,
  OrderBy,
} from './documents-rows.js';

/**
 * Data access for `documents.document_relations` (Task 8, ADR-0019 §5.2).
 *
 * Links are logical references (no FK). Existence of the referenced documents
 * is the creating module's responsibility (ADR-0019 consequence); this layer
 * stores and looks up the links only. There is deliberately no tuple-unique
 * index (line ids are NULL-able, and PostgreSQL treats NULLs as distinct), so
 * exact-duplicate prevention is best-effort in the service — acceptable because
 * the creating service writes inside its own transaction.
 */

export interface RelationListFilter {
  organizationId: string;
  relationKind?: string | undefined;
  sourceModule?: string | undefined;
  sourceDocumentType?: string | undefined;
  sourceDocumentId?: string | undefined;
  targetModule?: string | undefined;
  targetDocumentType?: string | undefined;
  targetDocumentId?: string | undefined;
}

type Client = {
  documentRelation: DocumentRelationDelegate;
};

@Injectable()
export class DocumentRelationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<DocumentRelation | null> {
    const { documentRelation } = await this.client();
    const row = await documentRelation.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: RelationListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: DocumentRelation[]; total: number }> {
    const { documentRelation } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      documentRelation.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      documentRelation.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: DocumentRelationCreate): Promise<DocumentRelation> {
    const { documentRelation } = await this.client();
    return toDomain(await documentRelation.create({ data: input }));
  }

  async delete(id: string): Promise<DocumentRelation | null> {
    const { documentRelation } = await this.client();
    try {
      return toDomain(await documentRelation.delete({ where: { id } }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: RelationListFilter): DocumentRelationWhere {
  const where: DocumentRelationWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.relationKind !== undefined)
    where.relationKind = filter.relationKind;
  if (filter.sourceModule !== undefined)
    where.sourceModule = filter.sourceModule;
  if (filter.sourceDocumentType !== undefined) {
    where.sourceDocumentType = filter.sourceDocumentType;
  }
  if (filter.sourceDocumentId !== undefined) {
    where.sourceDocumentId = filter.sourceDocumentId;
  }
  if (filter.targetModule !== undefined)
    where.targetModule = filter.targetModule;
  if (filter.targetDocumentType !== undefined) {
    where.targetDocumentType = filter.targetDocumentType;
  }
  if (filter.targetDocumentId !== undefined) {
    where.targetDocumentId = filter.targetDocumentId;
  }
  return where;
}

function toDomain(row: DocumentRelationRow): DocumentRelation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: {
      module: row.sourceModule,
      documentType: row.sourceDocumentType,
      documentId: row.sourceDocumentId,
      lineId: row.sourceLineId,
    },
    target: {
      module: row.targetModule,
      documentType: row.targetDocumentType,
      documentId: row.targetDocumentId,
      lineId: row.targetLineId,
    },
    relationKind: row.relationKind as DocumentRelation['relationKind'],
    quantity: row.quantity === null ? null : decimalToString(row.quantity),
    createdByProcess: row.createdByProcess,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
