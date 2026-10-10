import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Organization } from '../domain/organization.js';
import {
  isCalendarSystem,
  type CalendarSystem,
} from '../../../kernel/datetime/calendar-system.js';
import { isTimeZone } from '../../../kernel/datetime/time-zone.js';
import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
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

type OrganizationTransactionOptions = {
  maxWait: number;
  timeout: number;
  isolationLevel: 'ReadCommitted';
};

type Client = OrganizationTx & {
  $transaction<T>(
    fn: (tx: OrganizationTx) => Promise<T>,
    options?: OrganizationTransactionOptions,
  ): Promise<T>;
};

// Prisma interactive transactions default to a 5-second timeout. The Inventory
// write transaction keeps that default; the Organization-side lock transaction
// must outlive it so the FOR SHARE lock cannot expire before Inventory commits.
// READ COMMITTED is explicit because a writer that waits behind a transition
// must observe the committed calendar when its SELECT ... FOR SHARE resumes.
const CALENDAR_TRANSITION_TRANSACTION: OrganizationTransactionOptions = {
  maxWait: 3_000,
  timeout: 15_000,
  isolationLevel: 'ReadCommitted',
};
const BUSINESS_DATE_WRITE_LOCK_TRANSACTION: OrganizationTransactionOptions = {
  maxWait: 3_000,
  timeout: 10_000,
  isolationLevel: 'ReadCommitted',
};

export interface OrganizationListFilter {
  isActive?: boolean | undefined;
  /** Case-insensitive substring match on code or name. */
  search?: string | undefined;
}

/** Outcome of a serialized organization calendar-system update. */
export type OrganizationCalendarUpdateResult =
  | { kind: 'updated'; organization: Organization }
  | { kind: 'not_found' }
  | { kind: 'unrenderable_history'; businessDate: BusinessDate };

/** Outcome of the Organization-owned calendar lock around an Inventory write. */
export type OrganizationCalendarWriteLockResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'not_found' }
  | { kind: 'calendar_changed' };

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
   * Update the calendar system in Organization's transaction. The owner
   * module supplies an awaited history reader for a requested JALALI setting;
   * this repository itself reads only `organization.organizations` (AR-07).
   *
   * `FOR UPDATE` is the transition/writer rendezvous in BOTH directions. The
   * history callback calls Inventory's public application contract only for
   * GREGORIAN → JALALI; JALALI → GREGORIAN remains unrestricted. An exception
   * from the mandatory callback aborts this transaction.
   */
  async updateCalendarSystem(
    id: string,
    patch: OrganizationUpdate,
    findFirstUnrenderableBusinessDate?: (
      organizationId: string,
    ) => Promise<BusinessDate | null>,
  ): Promise<OrganizationCalendarUpdateResult> {
    if (
      patch.calendarSystem === 'JALALI' &&
      typeof findFirstUnrenderableBusinessDate !== 'function'
    ) {
      throw new Error(
        'A Jalali transition requires the Inventory history contract.',
      );
    }
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

      if (
        current.calendarSystem === 'GREGORIAN' &&
        patch.calendarSystem === 'JALALI'
      ) {
        if (typeof findFirstUnrenderableBusinessDate !== 'function') {
          throw new Error(
            'A Jalali transition requires the Inventory history contract.',
          );
        }
        const incompatibleBusinessDate =
          await findFirstUnrenderableBusinessDate(id);
        if (incompatibleBusinessDate !== null) {
          return {
            kind: 'unrenderable_history',
            businessDate: incompatibleBusinessDate,
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
    }, CALENDAR_TRANSITION_TRANSACTION);
  }

  /**
   * Organization-owned half of the Inventory BusinessDate write contract.
   * Keep the row lock while the caller's complete Inventory transaction
   * commits; no transaction client crosses the module boundary. The callback
   * is never invoked for a missing organization or stale calendar.
   */
  async withBusinessDateWriteLock<T>(
    organizationId: string,
    validatedCalendarSystem: CalendarSystem,
    work: () => Promise<T>,
  ): Promise<OrganizationCalendarWriteLockResult<T>> {
    if (typeof work !== 'function') {
      throw new Error(
        'An Inventory BusinessDate write requires a transaction callback.',
      );
    }
    const client = await this.client();
    return client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ calendarSystem: string }>>`
        SELECT "calendar_system" AS "calendarSystem"
          FROM "organization"."organizations"
         WHERE "id" = ${organizationId}
         FOR SHARE
      `;
      const organization = rows[0];
      if (organization === undefined) return { kind: 'not_found' };
      if (organization.calendarSystem !== validatedCalendarSystem) {
        return { kind: 'calendar_changed' };
      }
      return { kind: 'completed', value: await work() };
    }, BUSINESS_DATE_WRITE_LOCK_TRANSACTION);
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
