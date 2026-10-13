import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { DocumentTypeConfig } from '../domain/document-type-config.js';
import {
  type DocumentTypeConfigCreate,
  type DocumentTypeConfigDelegate,
  type DocumentTypeConfigRow,
  type DocumentTypeConfigUpdate,
  type DocumentTypeConfigWhere,
  type OrderBy,
} from './documents-rows.js';

/**
 * Data access for `documents.document_type_configs` (Task 8, ADR-0023).
 *
 * One row per (organization, document type). The document type code comes from
 * the code-defined `DocumentTypeRegistry`; this repository stores only the
 * organization's selection. The `(organization_id, document_type)` unique
 * index is authoritative for duplicate detection; the service pre-checks for a
 * useful 409 and the unique violation is still mapped on the race.
 */

export interface DocumentTypeConfigListFilter {
  organizationId: string;
}

type Client = {
  documentTypeConfig: DocumentTypeConfigDelegate;
};

@Injectable()
export class DocumentTypeConfigsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findForType(
    organizationId: string,
    documentType: string,
  ): Promise<DocumentTypeConfig | null> {
    const { documentTypeConfig } = await this.client();
    const row = await documentTypeConfig.findFirst({
      where: { organizationId, documentType },
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    organizationId: string;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: DocumentTypeConfig[]; total: number }> {
    const { documentTypeConfig } = await this.client();
    const where: DocumentTypeConfigWhere = {
      organizationId: params.organizationId,
    };
    const [rows, total] = await Promise.all([
      documentTypeConfig.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      documentTypeConfig.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: DocumentTypeConfigCreate): Promise<DocumentTypeConfig> {
    const { documentTypeConfig } = await this.client();
    return toDomain(await documentTypeConfig.create({ data: input }));
  }

  async update(
    id: string,
    patch: DocumentTypeConfigUpdate,
  ): Promise<DocumentTypeConfig | null> {
    const { documentTypeConfig } = await this.client();
    try {
      return toDomain(
        await documentTypeConfig.update({ where: { id }, data: patch }),
      );
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

function toDomain(row: DocumentTypeConfigRow): DocumentTypeConfig {
  return {
    id: row.id,
    organizationId: row.organizationId,
    documentType: row.documentType,
    draftRequired: row.draftRequired,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
