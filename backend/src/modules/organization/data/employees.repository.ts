import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Employee } from '../domain/employee.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `organization.employees` — minimal reference data only
 * (OQ-32). There is deliberately no join to `users.users`: an Employee is a
 * business record, not a login account (see `domain/employee.ts`, OQ-37).
 */

type EmployeeRow = {
  id: string;
  organizationId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  departmentId: string | null;
  branchId: string | null;
  isActive: boolean;
} & AuditColumns;

interface EmployeeWhere {
  organizationId?: string;
  employeeCode?: string;
  isActive?: boolean;
  departmentId?: string;
  branchId?: string;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  employeeCode?: { contains: string; mode: 'insensitive' };
  firstName?: { contains: string; mode: 'insensitive' };
  lastName?: { contains: string; mode: 'insensitive' };
}

interface EmployeeCreate {
  id: string;
  organizationId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  departmentId: string | null;
  branchId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface EmployeeUpdate {
  employeeCode?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  departmentId?: string | null | undefined;
  branchId?: string | null | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  employee: MasterDataDelegate<
    EmployeeRow,
    EmployeeWhere,
    EmployeeCreate,
    EmployeeUpdate
  >;
};

export interface EmployeeListFilter {
  organizationId: string;
  isActive?: boolean | undefined;
  departmentId?: string | undefined;
  branchId?: string | undefined;
  search?: string | undefined;
}

@Injectable()
export class EmployeesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Employee | null> {
    const { employee } = await this.client();
    const row = await employee.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    employeeCode: string,
  ): Promise<Employee | null> {
    const { employee } = await this.client();
    const row = await employee.findFirst({
      where: { organizationId, employeeCode },
    });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    employeeCode: string,
    excludeId: string,
  ): Promise<Employee | null> {
    const existing = await this.findByCode(organizationId, employeeCode);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: EmployeeListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Employee[]; total: number }> {
    const { employee } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      employee.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      employee.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: EmployeeCreate): Promise<Employee> {
    const { employee } = await this.client();
    return toDomain(await employee.create({ data: input }));
  }

  async update(id: string, patch: EmployeeUpdate): Promise<Employee | null> {
    const { employee } = await this.client();
    try {
      return toDomain(await employee.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: EmployeeListFilter): EmployeeWhere {
  const where: EmployeeWhere = { organizationId: filter.organizationId };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.departmentId !== undefined)
    where.departmentId = filter.departmentId;
  if (filter.branchId !== undefined) where.branchId = filter.branchId;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { employeeCode: { contains: filter.search, mode: 'insensitive' } },
      { firstName: { contains: filter.search, mode: 'insensitive' } },
      { lastName: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: EmployeeRow): Employee {
  return {
    id: row.id,
    organizationId: row.organizationId,
    employeeCode: row.employeeCode,
    firstName: row.firstName,
    lastName: row.lastName,
    departmentId: row.departmentId,
    branchId: row.branchId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
