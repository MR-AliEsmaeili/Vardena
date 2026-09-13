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
import { PartiesRepository } from '../data/parties.repository.js';
import type { Party, PartyDto, PartyType } from '../domain/party.js';
import {
  hasAnyCapability,
  isPartyType,
  PARTY_TYPES,
  toPartyDto,
} from '../domain/party.js';
import {
  isNonBlank,
  MAX_CODE_LENGTH,
  MAX_PARTY_NAME_LENGTH,
  normalizeCode,
  normalizeName,
} from '../domain/master-data.js';
import { PARTY_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  PARTY_CREATED_EVENT,
  PARTY_DISABLED_EVENT,
  PARTY_ENABLED_EVENT,
  PARTY_UPDATED_EVENT,
} from '../domain/organization.events.js';
import {
  assertUsable,
  publishEvent,
  resolveSort,
} from './master-data-support.js';
import { OrganizationsService } from './organizations.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  displayName: 'displayName',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

/** `parties.email` / `parties.phone` column widths. */
const MAX_EMAIL_LENGTH = 320;
const MAX_PHONE_LENGTH = 64;

export interface ListPartiesQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  partyType?: PartyType | undefined;
  isCustomer?: boolean | undefined;
  isSupplier?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreatePartyInput {
  organizationId: string;
  code: string;
  displayName: string;
  legalName?: string | null | undefined;
  partyType: string;
  isCustomer: boolean;
  isSupplier: boolean;
  email?: string | null | undefined;
  phone?: string | null | undefined;
}

export interface UpdatePartyInput {
  code?: string | undefined;
  displayName?: string | undefined;
  legalName?: string | null | undefined;
  partyType?: string | undefined;
  isCustomer?: boolean | undefined;
  isSupplier?: boolean | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
}

/**
 * Party administration — the single counterparty master (D-02,
 * master-data-strategy.md §5).
 *
 * One record carries both capabilities: a partner that buys from us and sells
 * to us is one party with `isCustomer` and `isSupplier` both true, never two
 * rows. The rule enforced here is therefore "at least one capability", and the
 * capability set itself is closed in code (`domain/party.ts`) — there is no
 * unrestricted role engine.
 *
 * Deliberately not implemented (unresolved, expert-gated): Iranian legal/tax
 * identifiers and their validation, structured addresses/contacts/bank
 * accounts, credit limits and terms, any tax classification. See OQ-30/OQ-35/
 * OQ-38.
 */
@Injectable()
export class PartiesService {
  constructor(
    private readonly repository: PartiesRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listParties(
    query: ListPartiesQuery,
  ): Promise<PaginatedResult<PartyDto>> {
    await this.authorization.requireAllPermissions([PARTY_PERMISSIONS.VIEW]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        isActive: query.isActive,
        partyType: query.partyType,
        isCustomer: query.isCustomer,
        isSupplier: query.isSupplier,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toPartyDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getParty(organizationId: string, id: string): Promise<PartyDto> {
    await this.authorization.requireAllPermissions([PARTY_PERMISSIONS.VIEW]);
    return toPartyDto(await this.mustFindInOrganization(organizationId, id));
  }

  async createParty(input: CreatePartyInput): Promise<PartyDto> {
    await this.authorization.requireAllPermissions([PARTY_PERMISSIONS.CREATE]);
    const code = normalizeCode(input.code);
    const displayName = normalizeName(input.displayName);
    const legalName = normalizeOptionalName(input.legalName);
    const partyType = requirePartyType(input.partyType);
    const capabilities = {
      isCustomer: input.isCustomer,
      isSupplier: input.isSupplier,
    };
    const email = normalizeOptionalContact(input.email);
    const phone = normalizeOptionalContact(input.phone);
    assertPartyShape(code, displayName, legalName, capabilities, {
      email,
      phone,
    });

    await this.organizations.requireUsableOrganization(input.organizationId);

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A party with that code already exists in this organization.',
      );
    }

    const now = new Date();
    let created: Party;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        code,
        displayName,
        legalName,
        partyType,
        isCustomer: capabilities.isCustomer,
        isSupplier: capabilities.isSupplier,
        email,
        phone,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A party with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: PARTY_CREATED_EVENT,
      aggregateType: 'Party',
      aggregateId: created.id,
      // Code only: no name, email or phone in the event payload.
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.code,
      },
    });
    this.logger.log(
      'Party created',
      { partyId: created.id, organizationId: created.organizationId },
      PartiesService.name,
    );
    return toPartyDto(created);
  }

  async updateParty(
    organizationId: string,
    id: string,
    input: UpdatePartyInput,
  ): Promise<PartyDto> {
    await this.authorization.requireAllPermissions([PARTY_PERMISSIONS.EDIT]);
    const current = await this.mustFindInOrganization(organizationId, id);

    const code =
      input.code === undefined ? undefined : normalizeCode(input.code);
    const displayName =
      input.displayName === undefined
        ? undefined
        : normalizeName(input.displayName);
    const legalName =
      input.legalName === undefined
        ? undefined
        : normalizeOptionalName(input.legalName);
    const partyType =
      input.partyType === undefined
        ? undefined
        : requirePartyType(input.partyType);
    const capabilities = {
      isCustomer: input.isCustomer ?? current.isCustomer,
      isSupplier: input.isSupplier ?? current.isSupplier,
    };
    const email =
      input.email === undefined
        ? undefined
        : normalizeOptionalContact(input.email);
    const phone =
      input.phone === undefined
        ? undefined
        : normalizeOptionalContact(input.phone);
    assertPartyShape(
      code ?? current.code,
      displayName ?? current.displayName,
      legalName === undefined ? current.legalName : legalName,
      capabilities,
      {
        email: email === undefined ? current.email : email,
        phone: phone === undefined ? current.phone : phone,
      },
    );

    if (code !== undefined && code !== current.code) {
      const taken = await this.repository.findByCodeExcludingId(
        current.organizationId,
        code,
        id,
      );
      if (taken !== null) {
        throw AppException.conflict(
          'A party with that code already exists in this organization.',
        );
      }
    }

    const patch: {
      code?: string;
      displayName?: string;
      legalName?: string | null;
      partyType?: string;
      isCustomer?: boolean;
      isSupplier?: boolean;
      email?: string | null;
      phone?: string | null;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (displayName !== undefined) patch.displayName = displayName;
    if (legalName !== undefined) patch.legalName = legalName;
    if (partyType !== undefined) patch.partyType = partyType;
    if (input.isCustomer !== undefined) patch.isCustomer = input.isCustomer;
    if (input.isSupplier !== undefined) patch.isSupplier = input.isSupplier;
    if (email !== undefined) patch.email = email;
    if (phone !== undefined) patch.phone = phone;

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Party', id);

    await publishEvent(this.events, {
      type: PARTY_UPDATED_EVENT,
      aggregateType: 'Party',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toPartyDto(updated);
  }

  async enableParty(organizationId: string, id: string): Promise<PartyDto> {
    return this.setActive(organizationId, id, true, PARTY_PERMISSIONS.ENABLE);
  }

  async disableParty(organizationId: string, id: string): Promise<PartyDto> {
    return this.setActive(organizationId, id, false, PARTY_PERMISSIONS.DISABLE);
  }

  /**
   * Reference resolution for the future Sales/Purchasing modules: they resolve
   * a counterparty through this method (AR-07) and never read
   * `organization.parties`.
   */
  async requireUsablePartyInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Party> {
    const party = await this.repository.findById(id);
    if (party === null || party.organizationId !== organizationId) {
      throw AppException.notFound('Party', id);
    }
    assertUsable('Party', party.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return party;
  }

  // ---- internals ----------------------------------------------------------

  private async setActive(
    organizationId: string,
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<PartyDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.isActive === isActive) return toPartyDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Party', id);

    await publishEvent(this.events, {
      type: isActive ? PARTY_ENABLED_EVENT : PARTY_DISABLED_EVENT,
      aggregateType: 'Party',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toPartyDto(updated);
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<Party> {
    this.organizations.assertOrganizationInScope(organizationId);
    const party = await this.repository.findById(id);
    if (party === null || party.organizationId !== organizationId) {
      throw AppException.notFound('Party', id);
    }
    return party;
  }
}

// ---- Internal helpers ----

function requirePartyType(value: string): PartyType {
  if (!isPartyType(value)) {
    throw AppException.badRequest(
      `Party type must be one of: ${PARTY_TYPES.join(', ')}.`,
    );
  }
  return value;
}

function normalizeOptionalName(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = normalizeName(value);
  return normalized === '' ? null : normalized;
}

function assertPartyShape(
  code: string,
  displayName: string,
  legalName: string | null,
  capabilities: { isCustomer: boolean; isSupplier: boolean },
  contact: { email: string | null; phone: string | null },
): void {
  if (!isNonBlank(code) || code.length > MAX_CODE_LENGTH) {
    throw AppException.badRequest(
      `Code is required and must be at most ${MAX_CODE_LENGTH} characters.`,
    );
  }
  if (!isNonBlank(displayName) || displayName.length > MAX_PARTY_NAME_LENGTH) {
    throw AppException.badRequest(
      `Display name is required and must be at most ${MAX_PARTY_NAME_LENGTH} characters.`,
    );
  }
  if (legalName !== null && legalName.length > MAX_PARTY_NAME_LENGTH) {
    throw AppException.badRequest(
      `Legal name must be at most ${MAX_PARTY_NAME_LENGTH} characters.`,
    );
  }
  assertContactLength('Email', contact.email, MAX_EMAIL_LENGTH);
  assertContactLength('Phone', contact.phone, MAX_PHONE_LENGTH);
  if (!hasAnyCapability(capabilities)) {
    // A domain rule, not a malformed request: the payload is well-formed but
    // describes a counterparty with no business role.
    throw AppException.businessRule(
      'A party must hold at least one capability (customer or supplier).',
    );
  }
}

/**
 * Column-width guard for the optional contact fields.
 *
 * The DTOs declare the same limits, but the service is the authority: a future
 * caller (an internal service, a worker, a seeder) must not be able to write a
 * value the column cannot hold. A blank value is rejected too — an empty string
 * would be stored as data that means "no contact details" while reading as one.
 */
function assertContactLength(
  label: string,
  value: string | null,
  maxLength: number,
): void {
  if (value === null) return;
  if (!isNonBlank(value)) {
    throw AppException.badRequest(`${label} cannot be blank.`);
  }
  if (value.length > maxLength) {
    throw AppException.badRequest(
      `${label} must be at most ${maxLength} characters.`,
    );
  }
}

/** `null` and blank both mean "no contact detail"; whitespace is trimmed. */
function normalizeOptionalContact(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
