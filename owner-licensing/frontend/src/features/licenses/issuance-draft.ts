import { calendarDayStartInstant } from '@/lib/date-time';
import { o } from '@/lib/owner-i18n';
import type { LicenseKind, PrepareIssuanceInput } from '@/api/licensing';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type LineageMode = 'none' | 'renew' | 'supersede';

/**
 * What the operator has entered, before anything is sent.
 *
 * Every identifier in this draft is chosen from a server-provided list; the
 * string fields that look like identifiers exist only so the review step can
 * render the real record the selection points at, and so the pure validator
 * can be unit-tested without a DOM.
 */
export interface IssuanceDraft {
  customerId: string;
  customerCode: string;
  customerName: string;
  installationIdentityId: string;
  installationId: string;
  signingKeyId: string;
  kind: LicenseKind;
  /**
   * Canonical `YYYY-MM-DD` BusinessDate, produced by the shared `DateInput`
   * adapter from the Jalali text the operator typed. The Jalali conversion
   * happens once, in that adapter — never here.
   */
  validUntil: string;
  organizationLimit: string;
  userLimit: string;
  deviceLimit: string;
  deviceLimitSpecified: boolean;
  modules: string[];
  features: string;
  lineage: LineageMode;
  lineageOperationId: string;
}

export function emptyDraft(): IssuanceDraft {
  return {
    customerId: '',
    customerCode: '',
    customerName: '',
    installationIdentityId: '',
    installationId: '',
    signingKeyId: '',
    kind: 'TIME_LIMITED',
    validUntil: '',
    organizationLimit: '',
    userLimit: '',
    deviceLimit: '',
    deviceLimitSpecified: false,
    modules: [],
    features: '',
    lineage: 'none',
    lineageOperationId: '',
  };
}

function positiveIntegerOrNull(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label}: ${o.licenses.errorPositive}`);
  return parsed;
}

/**
 * Client-side pre-flight only (AR-21). It refuses what the operator can fix
 * before a round trip and never decides anything the backend owns: signature,
 * trust list, limit profile, customer/installation state and lineage targets
 * are all re-checked server-side.
 */
export function validateDraft(draft: IssuanceDraft): string | null {
  if (!ULID.test(draft.customerId.trim())) return o.licenses.errorCustomer;
  if (!ULID.test(draft.installationIdentityId.trim()))
    return o.licenses.errorInstallation;
  if (!draft.signingKeyId.trim()) return o.licenses.errorKey;
  if (draft.modules.length === 0) return o.licenses.errorModules;
  if (draft.kind === 'TIME_LIMITED') {
    if (!draft.validUntil.trim()) return o.licenses.errorEndDate;
    const instant = calendarDayStartInstant(draft.validUntil, 'UTC');
    if (instant === undefined) return o.licenses.errorEndDate;
    if (Date.parse(instant) <= Date.now()) return o.licenses.errorEndFuture;
  }
  try {
    positiveIntegerOrNull(
      draft.organizationLimit,
      o.licenses.organizationLimit,
    );
    positiveIntegerOrNull(draft.userLimit, o.licenses.userLimit);
    if (draft.deviceLimitSpecified) {
      const parsed = Number(draft.deviceLimit);
      if (!Number.isInteger(parsed) || parsed < 0)
        throw new Error(o.licenses.errorDevice);
    }
  } catch (error) {
    return error instanceof Error ? error.message : o.licenses.errorPositive;
  }
  if (draft.lineage !== 'none' && !ULID.test(draft.lineageOperationId.trim()))
    return o.licenses.lineageNoTargets;
  return null;
}

/** The exact body `POST /license-issuances` accepts. */
export function toPrepareInput(draft: IssuanceDraft): PrepareIssuanceInput {
  const device = draft.deviceLimitSpecified ? Number(draft.deviceLimit) : null;
  return {
    customerId: draft.customerId.trim(),
    installationIdentityId: draft.installationIdentityId.trim(),
    validUntil:
      draft.kind === 'PERPETUAL'
        ? null
        : (calendarDayStartInstant(draft.validUntil, 'UTC') ?? null),
    organizationLimit: positiveIntegerOrNull(
      draft.organizationLimit,
      o.licenses.organizationLimit,
    ),
    userLimit: positiveIntegerOrNull(draft.userLimit, o.licenses.userLimit),
    deviceLimit: device,
    deviceLimitSpecified: draft.deviceLimitSpecified,
    modules: draft.modules,
    features: draft.features
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    signingKeyId: draft.signingKeyId.trim(),
    supersedesOperationId:
      draft.lineage === 'supersede' ? draft.lineageOperationId.trim() : null,
    renewsOperationId:
      draft.lineage === 'renew' ? draft.lineageOperationId.trim() : null,
  };
}
