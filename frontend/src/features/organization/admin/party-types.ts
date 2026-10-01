import type { PartyType } from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * The closed party identity set, copied from the backend domain
 * (`backend/src/modules/organization/domain/party.ts` → `PARTY_TYPES`) and
 * type-checked against the generated contract: adding a value the API does
 * not accept, or dropping one it does, fails `tsc`.
 *
 * `enum` is forbidden by `standards.md` §4 — this is a const tuple plus the
 * union derived from the OpenAPI document.
 */
export const PARTY_TYPES = [
  'person',
  'organization',
] as const satisfies readonly PartyType[];

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  person: t.orgAdmin.partyTypePerson,
  organization: t.orgAdmin.partyTypeOrganization,
};

export function parsePartyType(value: string | null): PartyType | '' {
  return (PARTY_TYPES as readonly string[]).includes(value ?? '')
    ? (value as PartyType)
    : '';
}
