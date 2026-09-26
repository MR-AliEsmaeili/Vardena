/**
 * Account — one node of the organization's chart of accounts (§8, §14;
 * AC-D-06…AC-D-09, AC-D-19, AC-I-10/AC-I-11).
 *
 * ONE table for the whole tree (AC-D-07): `Group ── General ── Subsidiary ──
 * Detail` is the level VOCABULARY an organization configures in its coding
 * structure (§8.1), not four entities and not a code constant. The tree is
 * adjacency (`parentId`) plus an integer `level`, and depth is bounded only by
 * the active coding-structure version.
 *
 * What the level names are NOT allowed to do: nothing here infers postability,
 * temporary-ness or report behaviour from a level title. `isPostable` is a
 * validated account attribute whose DEFAULT comes from the level definition
 * (§14 rule 4) — the mechanism plus the leaf invariant is what makes any
 * per-organization policy safe, and the policy itself stays OQ-25.
 *
 * Immutability (§8.3/§8.4/§8.6, AC-I-11):
 * - `code` is immutable once created. There is therefore NO code field on the
 *   update path at all, and codes are never reused (nothing is deleted).
 * - `parentId`, `level`, `accountNature` and `isPostable` become immutable once
 *   a document line references the account. Document lines do not exist before
 *   the posting task, so the rule is implemented behind
 *   `isReferencedByDocumentLine` — the single documented seam, with no fake
 *   usage table (Task 10.3 §16).
 * - Titles are editable: renaming is governance, restructuring is not.
 *
 * Framework-free (AR-05): pure rules, unit-tested.
 */

import {
  accountCodeProblemMessage,
  type AccountCodeProblem,
  type AccountCodeCheck,
  checkAccountCode,
} from './account-code.js';
import type { CodingStructureLevel } from './coding-structure.js';

/** Balance direction (`ماهیت`) — a closed DECIDED list (§8.3). */
export const ACCOUNT_NATURES = ['debit', 'credit'] as const;

export type AccountNature = (typeof ACCOUNT_NATURES)[number];

export function isAccountNature(value: string): value is AccountNature {
  return (ACCOUNT_NATURES as readonly string[]).includes(value);
}

/** One node of the chart of accounts. */
export interface Account {
  id: string;
  organizationId: string;
  /** Canonical digits-only code, unique per organization, immutable. */
  code: string;
  title: string;
  parentId: string | null;
  /** 1-based depth, always DERIVED (never client input). */
  level: number;
  /** The structure version this code was composed under — code shape version (Task 10.3, untouched per D2). NOT NULL in DB after D3, nullable in legacy in-memory fixtures (posting-readiness). */
  codingStructureVersionId: string | null;
  /** The accounting configuration version this account belongs to — sole configuration scope (Task 11 D1, NOT NULL after D3). Nullable in legacy in-memory fixtures (posting-readiness). */
  accountingConfigurationId: string | null;
  accountNature: AccountNature;
  isPostable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountDto {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  level: number;
  codingStructureVersionId: string | null;
  accountingConfigurationId: string | null;
  accountNature: AccountNature;
  isPostable: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toAccountDto(account: Account): AccountDto {
  return {
    id: account.id,
    organizationId: account.organizationId,
    code: account.code,
    title: account.title,
    parentId: account.parentId,
    level: account.level,
    codingStructureVersionId: account.codingStructureVersionId,
    accountingConfigurationId: account.accountingConfigurationId,
    accountNature: account.accountNature,
    isPostable: account.isPostable,
    isActive: account.isActive,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The immutability-after-use seam (§8.4 rule 4, AC-I-11)
// ---------------------------------------------------------------------------

/**
 * Whether a document line already references this account.
 *
 * The predicate AC-I-11 is written against is DATA, not a domain fact: it is
 * "does `accounting_document_lines` hold a row for this account?". Task 10.4
 * implements it for real — `AccountingDocumentLinesRepository.countForAccount`
 * for the service pre-check, and `countReferencingLinesInTx` inside the
 * account guard's transaction, where the count runs UNDER the account row's
 * `FOR UPDATE` lock so it interlocks with a voucher's `FOR SHARE` lock
 * (`accounting-locks.ts`). No `used_at` column and no usage counter exist on
 * purpose: the lines ARE the evidence, and a denormalized flag could drift.
 */

/** The fields AC-I-11 freezes for a referenced account (§8.4 rule 4). */
export const ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS = [
  'parentId',
  'level',
  'accountNature',
  'isPostable',
] as const;

export type AccountImmutableField =
  (typeof ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS)[number];

export interface AccountEditPlan {
  /** The refused fields, empty when the edit is allowed. */
  refused: AccountImmutableField[];
}

/**
 * Decide an account edit: `title` (and lifecycle) always pass; the structural
 * fields pass only while the account is unreferenced. `code` never appears —
 * it is immutable from creation (§8.3), so the API has no field to send.
 */
export function planAccountEdit(input: {
  referencedByDocumentLine: boolean;
  changes: Partial<Record<AccountImmutableField, boolean>>;
}): AccountEditPlan {
  if (!input.referencedByDocumentLine) return { refused: [] };
  const refused = ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS.filter(
    (field) => input.changes[field] === true,
  );
  return { refused };
}

// ---------------------------------------------------------------------------
// Placement (create + move) — the hierarchy invariants of §8.4/§9.3/§14
// ---------------------------------------------------------------------------

/** The part of the parent row the placement rules read. */
export interface AccountPlacementParent {
  id: string;
  organizationId: string;
  code: string;
  level: number;
  isPostable: boolean;
  isActive: boolean;
  codingStructureVersionId: string | null;
  accountingConfigurationId: string | null;
}

/** The part of the moved row the placement rules read (`null` on a create). */
export interface AccountPlacementCurrent {
  level: number;
  codingStructureVersionId: string | null;
  accountingConfigurationId: string | null;
  hasChildren: boolean;
}

export type AccountPlacementProblem =
  | 'parent_not_found'
  | 'self_parent'
  | 'cross_organization'
  | 'cycle'
  | 'parent_disabled'
  | 'parent_postable'
  | 'depth_exceeded'
  | 'version_mismatch'
  | 'restructure_with_children'
  | AccountCodeProblem;

export interface AccountPlacementPlan {
  problem: AccountPlacementProblem | null;
  /** The level the placement resolves to (derived, never client input). */
  level: number;
  /** Which request field the message should highlight. */
  field: 'code' | 'parentId';
}

/**
 * Validate placing an account under `parentId` (or as a root).
 *
 * Every rule the tree needs is here, so the create path, the move path and the
 * repository's locked re-check all use the same decision table:
 * 1. level = parent level + 1, roots are exactly level 1, no level is skipped
 *    (§8.4 rules 1/5) — hence `level` is DERIVED, never accepted;
 * 2. the code must extend the parent code by exactly the level's segment
 *    (§8.4 rule 2, §9.3) — checked by `checkAccountCode`;
 * 3. a node may not be moved under its own descendant (§8.4 rule 3) — cycles;
 * 4. a parent must exist, be in the same organization, and be usable (§8.6: an
 *    inactive account blocks new children);
 * 5. a postable parent cannot receive children (§14 rule 2);
 * 6. depth is bounded by the pinned version's `maxDepth` (§9.1);
 * 7. a subtree stays under ONE coding-structure version, and re-parenting that
 *    would shift the level of an account that already has children is refused:
 *    re-levelling a subtree rewrites descendants' codes, and codes are
 *    immutable — the restructuring policy that would decide how is OQ-25.
 *    (A same-depth move — the code prefix still matches — stays allowed.)
 *
 * Two deliberate non-features, both recorded rather than assumed:
 *
 * - **the parent is always named explicitly.** §9.3 validates "both sides" — a
 *   child code against its parent, and an explicitly supplied code against the
 *   implied parent — and the prefix + length rules make an implied-only code
 *   unsatisfiable: `'02003'` cannot be created as a root (wrong length for
 *   level 1) nor under a parent it does not extend. So the invariant holds
 *   without deriving a parent from a code string, which would silently invent
 *   an account the caller never named.
 * - **no "clear the parent's postability in the same operation" path.** §14
 *   rule 2 permits it; the rule's REQUIREMENT is that no invalid configuration
 *   be representable, and refusing the child create satisfies that with one
 *   invariant to reason about. Clearing `is_postable` on the parent is an
 *   ordinary `PATCH` (and §8.4 rule 4 forbids it outright once the parent has
 *   lines), so nothing is blocked — only combined into two audited steps.
 */
export function planAccountPlacement(input: {
  /** Id of the account being placed; `''` on a create (no id yet). */
  id: string;
  organizationId: string;
  parentId: string | null;
  code: string;
  parent: AccountPlacementParent | null;
  descendantIds: readonly string[];
  current: AccountPlacementCurrent | null;
  levels: readonly Pick<CodingStructureLevel, 'levelIndex' | 'digitLength'>[];
  maxDepth: number;
}): AccountPlacementPlan {
  const parent = input.parent;
  const level = parent === null ? 1 : parent.level + 1;
  const fail = (
    problem: AccountPlacementProblem,
    field: AccountPlacementPlan['field'] = 'parentId',
  ): AccountPlacementPlan => ({ problem, level, field });

  if (input.parentId !== null && parent === null) {
    return fail('parent_not_found');
  }
  if (
    input.parentId !== null &&
    input.id !== '' &&
    input.parentId === input.id
  ) {
    return fail('self_parent');
  }
  if (parent !== null && parent.organizationId !== input.organizationId) {
    return fail('cross_organization');
  }
  if (parent !== null && input.descendantIds.includes(parent.id)) {
    return fail('cycle');
  }
  if (parent !== null && !parent.isActive) {
    return fail('parent_disabled');
  }
  if (parent !== null && parent.isPostable) {
    return fail('parent_postable');
  }
  if (level > input.maxDepth) {
    return fail('depth_exceeded');
  }
  if (parent !== null && input.current !== null) {
    // After Task 11 final per D1/D3: accounting_configuration_id is sole scope NOT NULL,
    // coding_structure_version_id is code shape NOT NULL (D2 untouched). Both must stay isolated.
    if (
      input.current.accountingConfigurationId !==
      parent.accountingConfigurationId
    ) {
      return fail('version_mismatch');
    }
    if (
      input.current.codingStructureVersionId !== parent.codingStructureVersionId
    ) {
      return fail('version_mismatch');
    }
    if (input.current.hasChildren && input.current.level !== level) {
      return fail('restructure_with_children');
    }
  }

  const codeCheck: AccountCodeCheck = checkAccountCode({
    code: input.code,
    level,
    parentCode: parent === null ? null : parent.code,
    levels: input.levels,
  });
  if (codeCheck.problem !== null) {
    return { problem: codeCheck.problem, level, field: codeCheck.field };
  }
  return { problem: null, level, field: 'code' };
}

// ---------------------------------------------------------------------------
// Configuration/version pin (Task 11 remediation, D1 + D2)
// ---------------------------------------------------------------------------
//
// An account is pinned to exactly ONE pair: the accounting configuration it is
// validated under (`accountingConfigurationId`, D1) and the coding-structure
// version its code shape comes from (`codingStructureVersionId`, D2). The pair
// is written together and never re-derived from a second source, so validation
// can never use the levels of a DIFFERENT configuration than the one the
// account references.
//
// The two functions below are that decision table. They are pure so the
// repository (the authoritative write boundary, inside its locked transaction)
// and the in-memory test stand-in evaluate the SAME rules — the pattern this
// module already uses for placement and postability.

/** Why a root account's pin could not be established. */
export type RootAccountPinProblem =
  | 'configuration_missing'
  | 'configuration_not_active'
  | 'coding_version_missing'
  | 'coding_version_not_active';

/**
 * The ROOT write boundary: a new root is validated against the levels of the
 * configuration it is about to be pinned to, and that configuration and the
 * pinned coding version must still be the organization's ACTIVE ones under the
 * locks the insert holds (D1 + §9.4). A MISSING or FOREIGN row is reported as
 * `*_missing` (the service resolved both from the caller's organization, so a
 * mismatch is a stale/bugged resolution, never a legitimate write).
 */
export function planRootAccountPin(input: {
  organizationId: string;
  snapshot: {
    accountingConfigurationId: string;
    versionId: string;
  };
  configuration: {
    organizationId: string;
    status: string;
  } | null;
  version: {
    organizationId: string;
    status: string;
  } | null;
}): RootAccountPinProblem | null {
  const configuration = input.configuration;
  if (
    configuration === null ||
    configuration.organizationId !== input.organizationId
  ) {
    return 'configuration_missing';
  }
  if (configuration.status !== 'ACTIVE') {
    return 'configuration_not_active';
  }
  const version = input.version;
  if (version === null || version.organizationId !== input.organizationId) {
    return 'coding_version_missing';
  }
  if (version.status !== 'active') {
    return 'coding_version_not_active';
  }
  return null;
}

/**
 * The MOVE write boundary: the snapshot a move is validated against must be the
 * pair the account is ALREADY pinned to. Anything else would validate an
 * account's code against another configuration's (or version's) levels while
 * the row keeps its own pin — the cross-configuration validation this
 * remediation forbids.
 */
export function planAccountMovePin(input: {
  pinned: {
    accountingConfigurationId: string | null;
    codingStructureVersionId: string | null;
  };
  snapshot: {
    accountingConfigurationId: string;
    versionId: string;
  };
}): 'pin_mismatch' | null {
  if (
    input.pinned.accountingConfigurationId !==
      input.snapshot.accountingConfigurationId ||
    input.pinned.codingStructureVersionId !== input.snapshot.versionId
  ) {
    return 'pin_mismatch';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Configuration pin coherence (ODR-1, Task 19)
// ---------------------------------------------------------------------------

/**
 * Why the two pinned configuration roots cannot be used together for one
 * account write. The comparison is over the CODE-SHAPE projection only —
 * level count and per-level digit lengths — because that is the one
 * configuration relationship both roots actually define for accounts.
 * Titles, level kinds and postability defaults stay owned by whichever root
 * the write already reads them from (the accounting configuration), so they
 * are deliberately NOT part of coherence.
 */
export type PinCoherenceProblem =
  'coding_level_count_mismatch' | 'coding_digit_length_mismatch';

/**
 * ODR-1 — the Explicit Coherence Rule. Every account pins BOTH configuration
 * roots (`coding_structure_version_id` and `accounting_configuration_id`),
 * and code-shape validation reads the ACCOUNTING CONFIGURATION's levels while
 * the coding structure's digit lengths were historically not consulted at
 * all. This rule closes that gap the only way that introduces no second
 * source of truth: an account write whose two pinned roots do not describe
 * the SAME code shape is REJECTED — neither pin is silently picked as the
 * winner.
 *
 * The defined configuration relationship is derived from the repository, not
 * invented: both roots store `levelIndex` + `digitLength`, and an account's
 * canonical code is the concatenation of the level digit lengths
 * (`domain/account-code.ts`). Two roots are coherent for an account write
 * exactly when they agree on the number of levels and on every level's digit
 * length.
 *
 * Applied on every write path that establishes or re-validates an account's
 * pins (root create, child create, move) — in the service for fast feedback
 * and re-applied inside the repository's locked transaction from the same
 * snapshot (the established two-call-site decision-table pattern). Reads are
 * never blocked: existing divergent rows stay readable, and their repair is
 * OQ-62/OQ-63, which this rule does not resolve and does not silently
 * perform.
 */
export function planPinCoherence(input: {
  codingLevels: readonly { levelIndex: number; digitLength: number }[];
  configurationLevels: readonly { levelIndex: number; digitLength: number }[];
}): PinCoherenceProblem | null {
  if (input.codingLevels.length !== input.configurationLevels.length) {
    return 'coding_level_count_mismatch';
  }
  const codingByIndex = new Map(
    input.codingLevels.map((level) => [level.levelIndex, level.digitLength]),
  );
  for (const level of input.configurationLevels) {
    const codingDigitLength = codingByIndex.get(level.levelIndex);
    if (codingDigitLength === undefined) {
      // Same count but different indices — still a level-set mismatch.
      return 'coding_level_count_mismatch';
    }
    if (codingDigitLength !== level.digitLength) {
      return 'coding_digit_length_mismatch';
    }
  }
  return null;
}

/** Human-readable message per coherence problem (AR-24). */
export function pinCoherenceProblemMessage(
  problem: PinCoherenceProblem,
): string {
  switch (problem) {
    case 'coding_level_count_mismatch':
      return 'The pinned coding structure and accounting configuration define different numbers of levels. Publish a coherent pair before creating or moving accounts.';
    case 'coding_digit_length_mismatch':
      return 'The pinned coding structure and accounting configuration define different digit lengths for the same level. Publish a coherent pair before creating or moving accounts.';
  }
}

/** Human-readable message per problem (AR-24). */
export function accountPlacementProblemMessage(
  problem: AccountPlacementProblem,
): string {
  switch (problem) {
    case 'parent_not_found':
      return 'The parent account does not exist in this organization.';
    case 'self_parent':
      return 'An account cannot be its own parent.';
    case 'cross_organization':
      return 'An account and its parent must belong to the same organization.';
    case 'cycle':
      return 'An account cannot be moved under one of its own descendants (the tree must stay acyclic).';
    case 'parent_disabled':
      return 'A disabled account cannot receive new children (its subtree is closed for extension).';
    case 'parent_postable':
      return 'A postable account cannot have children: posting to both a parent and its children would double-count its rollup. Clear the parent postability first.';
    case 'depth_exceeded':
      return 'The account level would exceed the maximum depth of the applicable coding structure.';
    case 'version_mismatch':
      return 'A subtree stays under one coding-structure version: the target parent belongs to a different version.';
    case 'restructure_with_children':
      return 'Re-parenting an account that has children may not change its level: its descendants keep immutable codes, so a subtree cannot be re-levelled (structure-change policy is OQ-25).';
    default:
      // `default` narrows to exactly the code problems, so the messages stay
      // defined once, next to the rule that produces them.
      return accountCodeProblemMessage(problem);
  }
}

// ---------------------------------------------------------------------------
// Postability (AC-D-19)
// ---------------------------------------------------------------------------

/**
 * §14 rule 2, the parent-facing half: an account with children cannot be
 * postable (its movement is the rollup of its descendants, §8.5). The other
 * half — a postable account cannot get its first child — is rule 5/7 above.
 * Together they make an invalid posting configuration UNREPRESENTABLE.
 *
 * A leaf may still be non-postable (§14 rule 3): this is not "postable ⇔ leaf".
 */
export function planPostabilityChange(input: {
  isPostable: boolean;
  hasChildren: boolean;
}): 'postable_with_children' | null {
  if (input.isPostable && input.hasChildren) return 'postable_with_children';
  return null;
}

/** The default postability a NEW account inherits from its level (§14.4). */
export function defaultIsPostableForLevel(
  levels: readonly Pick<
    CodingStructureLevel,
    'levelIndex' | 'defaultIsPostable'
  >[],
  level: number,
): boolean {
  for (const entry of levels) {
    if (entry.levelIndex === level) return entry.defaultIsPostable;
  }
  return false;
}
