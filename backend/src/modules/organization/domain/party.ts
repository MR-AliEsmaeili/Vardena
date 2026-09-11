/**
 * Party — one counterparty record with explicit capabilities
 * (master-data-strategy.md §5, D-02, ADR-0020 §2, glossary §Partner).
 *
 * There is exactly ONE party concept. No `Customer`, `Supplier`, `Buyer`,
 * `Seller` or `Vendor` table exists: a business partner that sells to us and
 * buys from us is one row with both capability flags set, which is what makes
 * receivable/payable reporting per counterparty possible and satisfies
 * "one owner per fact" (AR-08).
 *
 * Capabilities are booleans, not a role table and not key/value metadata:
 * the set is closed in code (`PARTY_CAPABILITIES`), and adding one is a
 * deliberate code + migration change. There is no unrestricted role engine.
 *
 * Scope: a party is organization-scoped. The blueprint's scope table
 * (master-data-strategy.md §1) lists partners as organization-scoped, and
 * cross-organization party reuse is explicitly deferred to OQ-22/OQ-38 —
 * the same real-world counterparty in two organizations is two rows today.
 *
 * Deliberately absent (unresolved, expert-gated — do not invent):
 * - Iranian national id / economic code and any validation of them
 *   (OQ-30, OQ-38),
 * - structured addresses, contacts and bank accounts — children of a party in
 *   the target model (ADR-0020 §2) but outside Task 6's scope (OQ-38),
 * - credit limit / payment terms and their enforcement (D-14, OQ-35),
 * - tax classification of any kind (OQ-30).
 *
 * Framework-free (AR-05).
 */

/** Closed party identity types (glossary §Partner: PERSON | ORGANIZATION). */
export const PARTY_TYPES = ['person', 'organization'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export function isPartyType(value: string): value is PartyType {
  return (PARTY_TYPES as readonly string[]).includes(value);
}

/**
 * Closed capability set. A party must hold at least one: a counterparty
 * record with no business role has no purpose in an ERP. The rule is enforced
 * in the application layer rather than by a database CHECK so that adding a
 * capability later does not require rewriting a constraint (and because CHECK
 * constraints are not representable in the Prisma schema — see the migration
 * header).
 */
export const PARTY_CAPABILITIES = ['isCustomer', 'isSupplier'] as const;
export type PartyCapability = (typeof PARTY_CAPABILITIES)[number];

export interface Party {
  id: string;
  organizationId: string;
  /** Business key, unique within the organization. */
  code: string;
  /** Name used on screens and documents. */
  displayName: string;
  /** Registered/legal name where the counterparty has one. */
  legalName: string | null;
  partyType: PartyType;
  isCustomer: boolean;
  isSupplier: boolean;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PartyDto {
  id: string;
  organizationId: string;
  code: string;
  displayName: string;
  legalName: string | null;
  partyType: PartyType;
  /** Capabilities, always non-empty. */
  isCustomer: boolean;
  isSupplier: boolean;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPartyDto(party: Party): PartyDto {
  return {
    id: party.id,
    organizationId: party.organizationId,
    code: party.code,
    displayName: party.displayName,
    legalName: party.legalName,
    partyType: party.partyType,
    isCustomer: party.isCustomer,
    isSupplier: party.isSupplier,
    email: party.email,
    phone: party.phone,
    isActive: party.isActive,
    createdAt: party.createdAt.toISOString(),
    updatedAt: party.updatedAt.toISOString(),
  };
}

/** True when the party holds at least one capability. */
export function hasAnyCapability(party: {
  isCustomer: boolean;
  isSupplier: boolean;
}): boolean {
  return party.isCustomer || party.isSupplier;
}
