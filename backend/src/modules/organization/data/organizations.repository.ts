import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Organization } from '../domain/organization.js';
import { isCalendarSystem } from '../../../kernel/datetime/calendar-system.js';
import { isTimeZone } from '../../../kernel/datetime/time-zone.js';
import {
  businessDateFromDbDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { JALALI_RENDERABLE_GREGORIAN_RANGE } from '../../../kernel/datetime/jalali.js';
import type { LicensedAllocation } from '../../licensing/application/licensing.service.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `organization.organizations`.
 *
 * Rules (AR-07, AR-03): Prisma access lives in the data layer only; the
 * repository returns domain entities and never exposes row shapes; it does not
 * enforce business rules — it persists what the application layer hands it.
 *
 * Prisma delegate: `organization` (multi-schema models keep their model name
 * in the client API — the database schema is not a prefix).
 */

type OrganizationRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  /** C-63: `GREGORIAN` | `JALALI` (closed list, validated in `toDomain`). */
  calendarSystem: string;
  /** C-63: IANA time zone (resolvable, validated in `toDomain`). */
  timeZone: string;
} & AuditColumns;

interface OrganizationWhere {
  code?: string;
  isActive?: boolean;
  id?: { in: string[] };
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  name?: { contains: string; mode: 'insensitive' };
}

interface OrganizationCreate {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  /**
   * C-63: REQUIRED on the create payload. The application layer fills in the
   * deployment default (`DEFAULT_DATE_TIME_SETTINGS`) when the caller omitted
   * them, so the write path, the API response and the database column default
   * can never disagree about what a new organization's calendar is.
   */
  calendarSystem: string;
  timeZone: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface OrganizationUpdate {
  code?: string | undefined;
  name?: string | undefined;
  isActive?: boolean | undefined;
  calendarSystem?: string | undefined;
  timeZone?: string | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type OrganizationDelegate = MasterDataDelegate<
  OrganizationRow,
  OrganizationWhere,
  OrganizationCreate,
  OrganizationUpdate
>;

type OrganizationTx = {
  organization: OrganizationDelegate;
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

type Client = OrganizationTx & {
  $transaction<T>(fn: (tx: OrganizationTx) => Promise<T>): Promise<T>;
};

export interface OrganizationListFilter {
  isActive?: boolean | undefined;
  /** Case-insensitive substring match on code or name. */
  search?: string | undefined;
}

/** Outcome of a serialized GREGORIAN → JALALI organization update. */
export type JalaliCalendarUpdateResult =
  | { kind: 'updated'; organization: Organization }
  | { kind: 'not_found' }
  | { kind: 'unrenderable_history'; businessDate: BusinessDate };

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Organization | null> {
    const { organization } = await this.client();
    const row = await organization.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(code: string): Promise<Organization | null> {
    const { organization } = await this.client();
    const row = await organization.findFirst({ where: { code } });
    return row === null ? null : toDomain(row);
  }

  /**
   * Code availability for edits: a row with the same code but a different id
   * means "already taken".
   */
  async findByCodeExcludingId(
    code: string,
    excludeId: string,
  ): Promise<Organization | null> {
    const existing = await this.findByCode(code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: OrganizationListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Organization[]; total: number }> {
    const { organization } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      organization.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      organization.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async countAll(): Promise<number> {
    const { organization } = await this.client();
    return organization.count({ where: {} });
  }

  /**
   * The organization BOOTSTRAP read's second half
   * (`OrganizationsService.listMyOrganizations`): the active organizations
   * among a set of ids, code-ascending. The id set itself is never
   * caller-supplied here — it is always the membership rows resolved for the
   * authenticated principal, so this is not a general-purpose "fetch by ids"
   * escape hatch from authorization.
   *
   * Inactive organizations are excluded at the query level: a disabled
   * organization must not appear in the ordinary "choose your working
   * organization" bootstrap list (master-data-strategy.md §7.4), even though
   * its existing records stay readable through other, already-scoped paths.
   */
  async listActiveByIds(ids: readonly string[]): Promise<Organization[]> {
    if (ids.length === 0) return [];
    const { organization } = await this.client();
    const rows = await organization.findMany({
      where: { id: { in: [...ids] }, isActive: true },
      orderBy: [{ code: 'asc' }],
      skip: 0,
      take: ids.length,
    });
    return rows.map(toDomain);
  }

  /**
   * Serialize licensed organization allocation for one installation. The
   * transaction-scoped advisory lock is held through count + insert, so a
   * concurrent contender re-counts only after the winner commits.
   */
  async createWithinLicenseLimit(
    input: OrganizationCreate,
    allocation: LicensedAllocation,
  ): Promise<Organization | null> {
    const client = await this.client();
    return client.$transaction(async (tx) => {
      await lockInstallationAllocation(
        tx,
        allocation.installationId,
        'organizations',
      );
      if (allocation.limit !== null) {
        const count = await tx.organization.count({ where: {} });
        if (count >= allocation.limit) return null;
      }
      return toDomain(await tx.organization.create({ data: input }));
    });
  }

  async create(input: OrganizationCreate): Promise<Organization> {
    const { organization } = await this.client();
    return toDomain(await organization.create({ data: input }));
  }

  async update(
    id: string,
    patch: OrganizationUpdate,
  ): Promise<Organization | null> {
    const { organization } = await this.client();
    try {
      return toDomain(
        await organization.update({ where: { id }, data: patch }),
      );
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Update toward JALALI only after serializing against Inventory BusinessDate
   * writes and checking history in the same transaction as the organization
   * update. The explicit `FOR UPDATE` is the writer/transition rendezvous:
   * Inventory header inserts/date edits hold `FOR KEY SHARE` on this row until
   * their transaction commits, so the query sees their committed date or a
   * later stale writer re-checks the calendar before persisting.
   *
   * This narrow cross-schema query enforces the C-63 data-integrity boundary;
   * it never changes, deletes, or rewrites an Inventory document.
   */
  async updateToJalali(
    id: string,
    patch: OrganizationUpdate,
  ): Promise<JalaliCalendarUpdateResult> {
    const client = await this.client();
    return client.$transaction(async (tx) => {
      const lockedOrganizations = await tx.$queryRaw<
        Array<{ calendarSystem: string }>
      >`
        SELECT "calendar_system" AS "calendarSystem"
          FROM "organization"."organizations"
         WHERE "id" = ${id}
         FOR UPDATE
      `;
      const current = lockedOrganizations[0];
      if (current === undefined) return { kind: 'not_found' };

      if (current.calendarSystem === 'GREGORIAN') {
        const incompatibleDocuments = await tx.$queryRaw<
          Array<{ businessDate: Date }>
        >`
          SELECT "business_date" AS "businessDate"
            FROM "inventory"."inventory_business_documents"
           WHERE "organization_id" = ${id}
             AND (
               "business_date" < CAST(${JALALI_RENDERABLE_GREGORIAN_RANGE.minimum} AS date)
               OR "business_date" > CAST(${JALALI_RENDERABLE_GREGORIAN_RANGE.maximum} AS date)
             )
           ORDER BY "business_date" ASC, "id" ASC
           LIMIT 1
        `;
        const incompatible = incompatibleDocuments[0];
        if (incompatible !== undefined) {
          return {
            kind: 'unrenderable_history',
            businessDate: businessDateFromDbDate(incompatible.businessDate),
          };
        }
      }

      try {
        return {
          kind: 'updated',
          organization: toDomain(
            await tx.organization.update({ where: { id }, data: patch }),
          ),
        };
      } catch (error) {
        if (isRecordNotFound(error)) return { kind: 'not_found' };
        throw error;
      }
    });
  }
}

// ---- Internal helpers ----

async function lockInstallationAllocation(
  tx: OrganizationTx,
  installationId: string,
  resource: 'organizations',
): Promise<void> {
  const key = `vardena:license:${installationId}:${resource}`;
  await tx.$queryRaw<unknown>`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "locked"`;
}

function toWhere(filter: OrganizationListFilter): OrganizationWhere {
  const where: OrganizationWhere = {};
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: OrganizationRow): Organization {
  // C-63: a stored calendar/zone the code does not know is a defect, never a
  // silent default — the same fail-closed rule the inventory module applies to
  // its stored vocabularies. Falling back would silently re-render every date
  // of this organization in the wrong calendar.
  if (!isCalendarSystem(row.calendarSystem)) {
    throw new Error(
      `Stored organization "${row.id}" has an unknown calendar system "${row.calendarSystem}".`,
    );
  }
  if (!isTimeZone(row.timeZone)) {
    throw new Error(
      `Stored organization "${row.id}" has an unknown time zone "${row.timeZone}".`,
    );
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    calendarSystem: row.calendarSystem,
    timeZone: row.timeZone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
