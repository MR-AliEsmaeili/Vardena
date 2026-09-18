/**
 * Accounting Configuration — generic, organization-scoped, versioned root
 * (Task 11 — Accounting Configuration Foundation).
 *
 * This is the foundation for all accounting configuration that affects
 * Transaction, Posting or Reporting: Chart of Accounts, Account Coding,
 * Detail Structure, Dimensions, Posting Rules, Control Roles, Tax Rules,
 * Costing Rules, Numbering Policies, Closing Policies.
 *
 * The configuration is versioned: multiple versions may exist, but only one
 * ACTIVE version per organization scope. Status lifecycle:
 *   DRAFT → ACTIVE (before operational use)
 *   ACTIVE → SUPERSEDED (after operational use, when new version becomes ACTIVE)
 *   ACTIVE → DELETE forbidden
 *   ACTIVE → destructive mutation forbidden
 *   SUPERSEDED immutable
 *
 * Operational freeze: once configuration is used operationally (has ledger
 * entries, vouchers, etc.), it is marked operationally used and becomes
 * immutable. Future changes require new version or controlled migration.
 *
 * This file is framework-free (AR-05): pure constants and functions.
 */

import { isNonBlank, MAX_CODE_LENGTH, MAX_TITLE_LENGTH } from './master-data.js';

/** Closed list — Task 11 §3.1/§4. */
export const ACCOUNTING_CONFIGURATION_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'SUPERSEDED',
] as const;

export type AccountingConfigurationStatus =
  (typeof ACCOUNTING_CONFIGURATION_STATUSES)[number];

export function isAccountingConfigurationStatus(
  value: string,
): value is AccountingConfigurationStatus {
  return (ACCOUNTING_CONFIGURATION_STATUSES as readonly string[]).includes(
    value,
  );
}

/** Architecture cap — max depth for configuration levels (same as coding). */
export const MAX_ACCOUNTING_CONFIGURATION_DEPTH = 8;
export const MAX_ACCOUNTING_CONFIGURATION_CODE_LENGTH = 32;
export const MIN_CONFIGURATION_LEVEL_DIGIT_LENGTH = 1;

/** One level of an accounting configuration version. */
export interface AccountingConfigurationLevel {
  id: string;
  configurationId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
}

/** The accounting configuration version — the root. */
export interface AccountingConfiguration {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  versionNumber: number;
  status: AccountingConfigurationStatus;
  effectiveFrom: Date | null;
  operationallyUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountingConfigurationLevelDto {
  id: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
}

export interface AccountingConfigurationDto {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  versionNumber: number;
  status: AccountingConfigurationStatus;
  effectiveFrom: string | null;
  operationallyUsedAt: string | null;
  isOperationallyUsed: boolean;
  createdAt: string;
  updatedAt: string;
  levels: AccountingConfigurationLevelDto[];
  pattern: string;
}

export function toAccountingConfigurationLevelDto(
  level: AccountingConfigurationLevel,
): AccountingConfigurationLevelDto {
  return {
    id: level.id,
    levelIndex: level.levelIndex,
    title: level.title,
    digitLength: level.digitLength,
    defaultIsPostable: level.defaultIsPostable,
    levelKind: level.levelKind,
  };
}

export function toAccountingConfigurationDto(
  config: AccountingConfiguration & {
    levels: readonly AccountingConfigurationLevel[];
  },
): AccountingConfigurationDto {
  return {
    id: config.id,
    organizationId: config.organizationId,
    code: config.code,
    name: config.name,
    versionNumber: config.versionNumber,
    status: config.status,
    effectiveFrom: config.effectiveFrom?.toISOString() ?? null,
    operationallyUsedAt: config.operationallyUsedAt?.toISOString() ?? null,
    isOperationallyUsed: config.operationallyUsedAt !== null,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
    levels: config.levels.map(toAccountingConfigurationLevelDto),
    pattern: describeConfigurationPattern(config.levels),
  };
}

export function describeConfigurationPattern(
  levels: readonly Pick<AccountingConfigurationLevel, 'levelIndex' | 'digitLength'>[],
): string {
  return orderedConfigurationLevels(levels)
    .map((l) => String(l.digitLength))
    .join(' + ');
}

export function orderedConfigurationLevels<
  T extends Pick<AccountingConfigurationLevel, 'levelIndex'>,
>(levels: readonly T[]): T[] {
  return [...levels].sort((a, b) => a.levelIndex - b.levelIndex);
}

/** Whether configuration is mutable (only DRAFT). */
export function isConfigurationMutable(
  status: AccountingConfigurationStatus,
): boolean {
  return status === 'DRAFT';
}

/** Whether configuration is ACTIVE. */
export function isConfigurationActive(
  status: AccountingConfigurationStatus,
): boolean {
  return status === 'ACTIVE';
}

/** Whether configuration is operationally used. */
export function isConfigurationOperationallyUsed(
  config: Pick<AccountingConfiguration, 'operationallyUsedAt'>,
): boolean {
  return config.operationallyUsedAt !== null;
}

/** Whether configuration can be deleted. */
export function canDeleteConfiguration(input: {
  status: AccountingConfigurationStatus;
  isOperationallyUsed: boolean;
}): boolean {
  // ACTIVE → DELETE forbidden always.
  if (input.status === 'ACTIVE') return false;
  // Operationally used configuration cannot be deleted (any status).
  if (input.isOperationallyUsed) return false;
  // Only DRAFT not yet used can be deleted.
  return input.status === 'DRAFT';
}

/** Whether destructive mutation is allowed. */
export function canDestructivelyMutate(input: {
  status: AccountingConfigurationStatus;
  isOperationallyUsed: boolean;
}): boolean {
  // ACTIVE → destructive mutation forbidden.
  if (input.status === 'ACTIVE') return false;
  // SUPERSEDED immutable.
  if (input.status === 'SUPERSEDED') return false;
  // Operationally used → no destructive mutation.
  if (input.isOperationallyUsed) return false;
  return input.status === 'DRAFT';
}

/** Whether transition is allowed. */
export type ConfigurationTransitionProblem =
  | 'not_draft'
  | 'already_active'
  | 'not_active'
  | 'already_superseded'
  | 'operationally_used_draft'
  | 'invalid_transition';

export interface ConfigurationTransitionPlan {
  problem: ConfigurationTransitionProblem | null;
}

export function planConfigurationTransition(input: {
  from: AccountingConfigurationStatus;
  to: AccountingConfigurationStatus;
  isOperationallyUsed: boolean;
}): ConfigurationTransitionPlan {
  const { from, to } = input;

  // DRAFT → ACTIVE allowed before operational use.
  if (from === 'DRAFT' && to === 'ACTIVE') {
    // Even draft that is operationally used cannot become active? Actually
    // operational use should only happen after ACTIVE, but guard anyway.
    if (input.isOperationallyUsed) {
      return { problem: 'operationally_used_draft' };
    }
    return { problem: null };
  }

  // ACTIVE → SUPERSEDED allowed after operational use (and also before,
  // when new version supersedes it).
  if (from === 'ACTIVE' && to === 'SUPERSEDED') {
    return { problem: null };
  }

  // Same status — no transition.
  if (from === to) {
    if (from === 'ACTIVE') return { problem: 'already_active' };
    if (from === 'SUPERSEDED') return { problem: 'already_superseded' };
    return { problem: null };
  }

  // DRAFT → SUPERSEDED not allowed directly.
  if (from === 'DRAFT' && to === 'SUPERSEDED') {
    return { problem: 'invalid_transition' };
  }

  // ACTIVE → DRAFT not allowed (one-way).
  if (from === 'ACTIVE' && to === 'DRAFT') {
    return { problem: 'invalid_transition' };
  }

  // SUPERSEDED → anything not allowed (one-way).
  if (from === 'SUPERSEDED') {
    return { problem: 'invalid_transition' };
  }

  return { problem: 'invalid_transition' };
}

export function configurationTransitionProblemMessage(
  problem: ConfigurationTransitionProblem,
): string {
  switch (problem) {
    case 'not_draft':
      return 'Only a DRAFT configuration can be published.';
    case 'already_active':
      return 'Configuration is already ACTIVE.';
    case 'not_active':
      return 'Only an ACTIVE configuration can be superseded.';
    case 'already_superseded':
      return 'Configuration is already SUPERSEDED and cannot be changed.';
    case 'operationally_used_draft':
      return 'A configuration that has been used operationally cannot be activated as DRAFT.';
    case 'invalid_transition':
      return 'Invalid configuration status transition.';
  }
}

// ---------------------------------------------------------------------------
// Validation for configuration creation (Task 11 §3.1, §8)
// ---------------------------------------------------------------------------

export interface AccountingConfigurationLevelInput {
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
}

export type AccountingConfigurationProblem =
  | 'code_invalid'
  | 'name_invalid'
  | 'effective_from_invalid'
  | 'levels_missing'
  | 'levels_exceed_depth'
  | 'level_index_out_of_range'
  | 'level_index_duplicate'
  | 'level_index_gap'
  | 'digit_length_invalid'
  | 'code_length_too_large'
  | 'level_title_invalid'
  | 'level_kind_invalid';

export interface AccountingConfigurationPlan {
  problem: AccountingConfigurationProblem | null;
  subject?: string | undefined;
}

export function planAccountingConfiguration(input: {
  code: string;
  name: string;
  effectiveFrom: Date | null;
  maxDepth: number;
  levels: readonly AccountingConfigurationLevelInput[];
}): AccountingConfigurationPlan {
  if (!isNonBlank(input.code) || input.code.length > MAX_CODE_LENGTH) {
    return { problem: 'code_invalid' };
  }
  if (!isNonBlank(input.name) || input.name.length > MAX_TITLE_LENGTH) {
    return { problem: 'name_invalid' };
  }
  if (
    input.effectiveFrom !== null &&
    !(input.effectiveFrom instanceof Date && !isNaN(input.effectiveFrom.getTime()))
  ) {
    return { problem: 'effective_from_invalid' };
  }
  if (input.levels.length === 0) {
    return { problem: 'levels_missing' };
  }
  if (input.levels.length > input.maxDepth) {
    return { problem: 'levels_exceed_depth' };
  }

  const seen = new Set<number>();
  let totalLength = 0;
  for (const level of input.levels) {
    if (
      !Number.isInteger(level.levelIndex) ||
      level.levelIndex < 1 ||
      level.levelIndex > input.maxDepth
    ) {
      return {
        problem: 'level_index_out_of_range',
        subject: String(level.levelIndex),
      };
    }
    if (seen.has(level.levelIndex)) {
      return {
        problem: 'level_index_duplicate',
        subject: String(level.levelIndex),
      };
    }
    seen.add(level.levelIndex);

    if (
      !Number.isInteger(level.digitLength) ||
      level.digitLength < MIN_CONFIGURATION_LEVEL_DIGIT_LENGTH
    ) {
      return {
        problem: 'digit_length_invalid',
        subject: String(level.levelIndex),
      };
    }
    totalLength += level.digitLength;

    if (
      !isNonBlank(level.title) ||
      level.title.length > MAX_TITLE_LENGTH ||
      level.title.trim().length === 0
    ) {
      return {
        problem: 'level_title_invalid',
        subject: String(level.levelIndex),
      };
    }
    // levelKind is informational only — allow any non-blank or null, but
    // validate against known kinds if provided? Task says level semantics
    // explicit and configurable, not hardcoded. So we allow any string? But
    // to keep compatibility with existing ACCOUNT_LEVEL_KINDS, we allow
    // known kinds or any custom? For Task 11 foundation, we allow known kinds
    // plus any custom title — but we validate against known list for safety,
    // while still allowing null. We will allow any non-empty string as
    // custom levelKind to keep it configurable and not hardcoded.
    if (level.levelKind !== null && level.levelKind.trim() === '') {
      return {
        problem: 'level_kind_invalid',
        subject: String(level.levelIndex),
      };
    }
  }

  for (let i = 1; i <= input.maxDepth; i += 1) {
    if (!seen.has(i)) {
      return { problem: 'level_index_gap', subject: String(i) };
    }
  }

  if (totalLength > MAX_ACCOUNTING_CONFIGURATION_CODE_LENGTH) {
    return { problem: 'code_length_too_large' };
  }

  return { problem: null };
}

export function accountingConfigurationProblemMessage(
  problem: AccountingConfigurationProblem,
): string {
  switch (problem) {
    case 'code_invalid':
      return `Configuration code is required and must be at most ${MAX_CODE_LENGTH} characters.`;
    case 'name_invalid':
      return `Configuration name is required and must be at most ${MAX_TITLE_LENGTH} characters.`;
    case 'effective_from_invalid':
      return 'effectiveFrom must be a valid date or null.';
    case 'levels_missing':
      return 'An accounting configuration needs one level definition per level.';
    case 'levels_exceed_depth':
      return 'The level list is longer than maxDepth.';
    case 'level_index_out_of_range':
      return 'Every levelIndex must be an integer between 1 and maxDepth.';
    case 'level_index_duplicate':
      return 'Two levels claim the same levelIndex; ordinals are 1..maxDepth with no duplicates.';
    case 'level_index_gap':
      return 'The level ordinals must cover 1..maxDepth with no gap.';
    case 'digit_length_invalid':
      return `Every level must contribute at least ${MIN_CONFIGURATION_LEVEL_DIGIT_LENGTH} digit(s).`;
    case 'code_length_too_large':
      return `The configured levels add up to more than the maximum account code length (${MAX_ACCOUNTING_CONFIGURATION_CODE_LENGTH} characters).`;
    case 'level_title_invalid':
      return 'Every level needs a non-blank title.';
    case 'level_kind_invalid':
      return 'levelKind must be non-empty string or null.';
  }
}
