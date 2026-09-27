/**
 * Base Chart Template — the versioned, Accounting-owned PRODUCT chart
 * template (Task 23; OD-20-1; Task 21 governance baseline §1/§2/§7/§8).
 *
 * The identity chain this module protects (OD-20-1):
 *
 *   Base Chart Template version  (product asset — NEW, non-tenant)
 *           │  adoption = COPY (explicit, one transaction, atomic)
 *           ▼
 *   organization-owned `accounts` rows     (EXISTING table, unchanged)
 *           │
 *           ▼
 *   ledger_entries.account_id → accounts.id (EXISTING, untouched)
 *
 * A template id is therefore NEVER ledger identity: nothing in this file (or
 * anywhere else) may steer a ledger/document reference at a template row,
 * and no `accounts` column points back at a template row (account-level
 * provenance stays OPEN — Task 21 §4.2/§8, AR-29).
 *
 * Lifecycle (Task 21 §8) — one-way, like the coding structure's
 * `draft → active → superseded` but with the authoring → approval →
 * publication split the baseline requires:
 *
 *   draft ──approve──▶ approved ──publish──▶ published ──supersede──▶ superseded
 *
 * - `draft` is the ONLY mutable state: levels/nodes/`maxDepth` may be
 *   replaced while drafting (the ADR-0024 draft-workspace rule the coding
 *   structure established); a draft is never adoptable and never reachable
 *   from an adopted account.
 * - `approved` freezes the content pending publication; it is NOT adoptable
 *   (only a PUBLISHED version may be adopted — Task 21 §4.2).
 * - `published` is immutable and adoptable; publishing a new version of a
 *   template supersedes its previously published version (at most one
 *   published version per template at any moment, the exact analogue of
 *   "exactly one ACTIVE coding-structure version" — §9.4).
 * - `superseded` is immutable and terminal; prior adoptions of it are
 *   unaffected (copy semantics: adopted rows belong to the organization).
 *
 * Hierarchy is CONFIGURABLE (Task 21 §3): the version's own level rows carry
 * the digit lengths; nothing here knows about four levels, and the
 * `Group/General/Subsidiary/Detail` titles stay organization vocabulary
 * (contract §8.1) — template levels deliberately carry no title/kind.
 *
 * Content VALUES (codes, Persian titles, natures, the mandatory set) are
 * owner/accountant content (OQ-25 stays OPEN): this file validates the
 * SHAPE only and the module seeds nothing.
 *
 * Framework-free (AR-05): pure constants and functions, unit-tested.
 */

import { checkAccountCode, type AccountCodeProblem } from './account-code.js';
import { isAccountNature } from './account.js';
import {
  MAX_ACCOUNT_CODE_LENGTH,
  MAX_CODING_STRUCTURE_DEPTH,
  MIN_LEVEL_DIGIT_LENGTH,
} from './coding-structure.js';
import {
  isNonBlank,
  MAX_CODE_LENGTH,
  MAX_TITLE_LENGTH,
} from './master-data.js';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Closed code-defined list (TEXT in the DB, the accounting convention). */
export const BASE_CHART_VERSION_STATUSES = [
  'draft',
  'approved',
  'published',
  'superseded',
] as const;

export type BaseChartVersionStatus =
  (typeof BASE_CHART_VERSION_STATUSES)[number];

export function isBaseChartVersionStatus(
  value: string,
): value is BaseChartVersionStatus {
  return (BASE_CHART_VERSION_STATUSES as readonly string[]).includes(value);
}

/** The named lifecycle operations (each is one allowed edge). */
export const BASE_CHART_VERSION_TRANSITIONS = {
  approve: { from: 'draft', to: 'approved' },
  publish: { from: 'approved', to: 'published' },
  supersede: { from: 'published', to: 'superseded' },
} as const;

export type BaseChartVersionTransition =
  keyof typeof BASE_CHART_VERSION_TRANSITIONS;

/**
 * Decide one lifecycle step. Returns the resulting status, or `null` when the
 * edge does not exist (a `published` template is never `draft` again, an
 * `approved` one is never superseded, …). One-way only, by design.
 */
export function planBaseChartVersionTransition(
  current: BaseChartVersionStatus,
  transition: BaseChartVersionTransition,
): BaseChartVersionStatus | null {
  const rule = BASE_CHART_VERSION_TRANSITIONS[transition];
  return current === rule.from ? rule.to : null;
}

/** Content (levels, nodes, maxDepth) is editable ONLY while drafting. */
export function isVersionContentEditable(
  status: BaseChartVersionStatus,
): boolean {
  return status === 'draft';
}

/** Only an immutable PUBLISHED version may be adopted (Task 21 §4.2). */
export function isVersionAdoptable(status: BaseChartVersionStatus): boolean {
  return status === 'published';
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** The template identity (product asset — versions share it). */
export interface BaseChartTemplate {
  id: string;
  code: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One level of one template version's OWN coding shape (no title/kind). */
export interface BaseChartTemplateLevel {
  id: string;
  versionId: string;
  /** 1-based ordinal inside the version. */
  levelIndex: number;
  digitLength: number;
  defaultIsPostable: boolean;
}

/** One node of the template chart tree (template-INTERNAL identity). */
export interface BaseChartTemplateNode {
  id: string;
  versionId: string;
  /** Authored template-internal key; unique within the version. */
  nodeKey: string;
  /** Authored tree edge in the template key space (null = root). */
  parentNodeKey: string | null;
  /** Resolved adjacency edge (self-FK), written from the same derivation. */
  parentId: string | null;
  /** Canonical digits-only code relative to the version's level shape. */
  code: string;
  title: string;
  accountNature: string;
  /**
   * Authored postability default (Task 21 §7) — NEVER trusted: every write
   * of an `accounts` row derives postability leaf-only (OD-20-5).
   */
  isPostable: boolean;
  /** Adoption-completeness flag ONLY (Task 21 §5). */
  isMandatory: boolean;
  defaultIsActive: boolean;
  /** 1-based depth, ALWAYS derived (root = 1). */
  level: number;
}

/** One immutable-at-publish version of a Base Chart template. */
export interface BaseChartTemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  status: BaseChartVersionStatus;
  maxDepth: number;
  approvedAt: Date | null;
  publishedAt: Date | null;
  supersededAt: Date | null;
  supersededByVersionId: string | null;
  levels: readonly BaseChartTemplateLevel[];
  nodes: readonly BaseChartTemplateNode[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The tenant-scoped adoption record (the ONLY template → organization link).
 * `adoptedAt`/`adoptedBy` project the AR-12 `createdAt`/`createdBy` columns:
 * an adoption row is created once and never mutated, so creation IS adoption.
 */
export interface BaseChartAdoption {
  id: string;
  organizationId: string;
  templateVersionId: string;
  accountingConfigurationId: string;
  codingStructureVersionId: string;
  /** Final adoption set size (requested ∪ ancestor closure ∪ mandatory). */
  accountCount: number;
  createdAt: Date;
  createdBy: string | null;
}

/** An adoption read with the adopted version's identity resolved. */
export interface BaseChartAdoptionView extends BaseChartAdoption {
  templateId: string;
  templateCode: string;
  versionNumber: number;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface BaseChartTemplateDto {
  id: string;
  code: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface BaseChartTemplateLevelDto {
  id: string;
  levelIndex: number;
  digitLength: number;
  defaultIsPostable: boolean;
}

export interface BaseChartTemplateNodeDto {
  id: string;
  nodeKey: string;
  parentNodeKey: string | null;
  code: string;
  title: string;
  accountNature: string;
  isPostable: boolean;
  isMandatory: boolean;
  defaultIsActive: boolean;
  level: number;
}

export interface BaseChartTemplateVersionDto {
  id: string;
  templateId: string;
  templateCode: string;
  versionNumber: number;
  status: BaseChartVersionStatus;
  maxDepth: number;
  approvedAt: string | null;
  publishedAt: string | null;
  supersededAt: string | null;
  supersededByVersionId: string | null;
  levels: BaseChartTemplateLevelDto[];
  nodes: BaseChartTemplateNodeDto[];
  createdAt: string;
  updatedAt: string;
}

export interface BaseChartAdoptionDto {
  id: string;
  organizationId: string;
  templateId: string;
  templateCode: string;
  versionNumber: number;
  templateVersionId: string;
  accountingConfigurationId: string;
  codingStructureVersionId: string;
  accountCount: number;
  adoptedAt: string;
  adoptedBy: string | null;
}

export function toBaseChartTemplateDto(
  template: BaseChartTemplate,
): BaseChartTemplateDto {
  return {
    id: template.id,
    code: template.code,
    title: template.title,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

export function toBaseChartTemplateNodeDto(
  node: BaseChartTemplateNode,
): BaseChartTemplateNodeDto {
  return {
    id: node.id,
    nodeKey: node.nodeKey,
    parentNodeKey: node.parentNodeKey,
    code: node.code,
    title: node.title,
    accountNature: node.accountNature,
    isPostable: node.isPostable,
    isMandatory: node.isMandatory,
    defaultIsActive: node.defaultIsActive,
    level: node.level,
  };
}

export function toBaseChartTemplateVersionDto(
  template: BaseChartTemplate,
  version: BaseChartTemplateVersion,
): BaseChartTemplateVersionDto {
  return {
    id: version.id,
    templateId: version.templateId,
    templateCode: template.code,
    versionNumber: version.versionNumber,
    status: version.status,
    maxDepth: version.maxDepth,
    approvedAt: version.approvedAt?.toISOString() ?? null,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    supersededAt: version.supersededAt?.toISOString() ?? null,
    supersededByVersionId: version.supersededByVersionId,
    levels: version.levels.map((level) => ({
      id: level.id,
      levelIndex: level.levelIndex,
      digitLength: level.digitLength,
      defaultIsPostable: level.defaultIsPostable,
    })),
    nodes: version.nodes.map(toBaseChartTemplateNodeDto),
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}

export function toBaseChartAdoptionDto(
  view: BaseChartAdoptionView,
): BaseChartAdoptionDto {
  return {
    id: view.id,
    organizationId: view.organizationId,
    templateId: view.templateId,
    templateCode: view.templateCode,
    versionNumber: view.versionNumber,
    templateVersionId: view.templateVersionId,
    accountingConfigurationId: view.accountingConfigurationId,
    codingStructureVersionId: view.codingStructureVersionId,
    accountCount: view.accountCount,
    adoptedAt: view.createdAt.toISOString(),
    adoptedBy: view.createdBy,
  };
}

// ---------------------------------------------------------------------------
// Content draft/gate validation (authoring + publish gate + in-tx re-check)
// ---------------------------------------------------------------------------

/** One level row as the author supplies it (shape only — no title/kind). */
export interface BaseChartLevelInput {
  levelIndex: number;
  digitLength: number;
  defaultIsPostable: boolean;
}

/**
 * One node row as the author supplies it. `level` and `parentId` are NOT
 * input: the derivation computes both from `parentNodeKey` — a caller can
 * never smuggle a level (AC-I-10 rule 1 parity: `accounts.level` is derived
 * too). `isPostable` omitted = the node's level default (Task 21 §7).
 */
export interface BaseChartNodeInput {
  nodeKey: string;
  parentNodeKey: string | null;
  code: string;
  title: string;
  accountNature: string;
  isPostable?: boolean | undefined;
  isMandatory: boolean;
  defaultIsActive: boolean;
}

/** A node after derivation (what a draft write persists). */
export interface DerivedBaseChartNode {
  nodeKey: string;
  parentNodeKey: string | null;
  level: number;
  code: string;
  title: string;
  accountNature: string;
  isPostable: boolean;
  isMandatory: boolean;
  defaultIsActive: boolean;
}

export type BaseChartContentProblem =
  /** `max_depth` outside 1..MAX_CODING_STRUCTURE_DEPTH. */
  | 'max_depth_invalid'
  /** No level rows at all — a shape with no levels cannot code anything. */
  | 'levels_missing'
  /** More level rows than `max_depth` allows. */
  | 'levels_exceed_depth'
  /** A level ordinal below 1 or above `max_depth`. */
  | 'level_index_out_of_range'
  /** Two rows claiming the same ordinal. */
  | 'level_index_duplicate'
  /** Ordinals do not cover exactly 1..max_depth. */
  | 'level_index_gap'
  /** A segment shorter than one digit. */
  | 'digit_length_invalid'
  /** The configured code would exceed the architecture length cap. */
  | 'code_length_too_large'
  /** A chart template with no nodes has nothing to adopt. */
  | 'nodes_missing'
  /** Node key missing or too long. */
  | 'node_key_invalid'
  /** Two nodes claiming the same template key. */
  | 'node_key_duplicate'
  /** A node's parent key is not part of the same version. */
  | 'node_parent_unknown'
  /** Following parent keys from a node returns to the node itself. */
  | 'node_cycle'
  /**
   * A node code violates the version's own shape (not digits, too long,
   * wrong total length for its derived level, or not extending the parent's
   * code — `accountCodeProblem` carries the detail).
   */
  | 'node_code_invalid'
  /** Two nodes claiming the same code inside one version. */
  | 'node_code_duplicate'
  /** Blank or over-long node title. */
  | 'node_title_invalid'
  /** Nature outside the decided closed list. */
  | 'node_nature_invalid'
  /**
   * A node that HAS children is authored postable — refused at authoring and
   * at the publish gate, and additionally force-derived `false` at adoption
   * (OD-20-5 is a domain invariant, not a configuration courtesy).
   */
  | 'node_parent_postable';

export interface BaseChartContentPlan {
  problem: BaseChartContentProblem | null;
  /** The offending node key or level ordinal, when the problem names one. */
  subject?: string | undefined;
  /** Detail when `problem === 'node_code_invalid'`. */
  accountCodeProblem?: AccountCodeProblem | undefined;
}

export interface BaseChartContentResult {
  plan: BaseChartContentPlan;
  /** The derived node set (empty when the plan refused the content). */
  nodes: DerivedBaseChartNode[];
}

/**
 * Validate one Base Chart version's content (level shape + node tree) and
 * derive the per-node levels. Total and deterministic: the same function
 * runs on the draft write (fast feedback), on the publish gate, and again
 * INSIDE the write transactions, so a representable template is an adoptable
 * template shape. No partial acceptance.
 *
 * Codes are checked against the TEMPLATE'S OWN level rows via the same
 * `checkAccountCode` decision table the chart of accounts uses — a template
 * whose codes already satisfy its own shape is compatible-by-construction
 * with every organization shape whose digit lengths match (see
 * `planTemplateCompatibility`).
 */
export function planBaseChartVersionContent(input: {
  maxDepth: number;
  levels: readonly BaseChartLevelInput[];
  nodes: readonly BaseChartNodeInput[];
}): BaseChartContentResult {
  const fail = (
    problem: BaseChartContentProblem,
    subject?: string,
    accountCodeProblem?: AccountCodeProblem,
  ): BaseChartContentResult => ({
    plan: { problem, subject, accountCodeProblem },
    nodes: [],
  });

  // ---- level shape (mirrors planCodingStructure's shape rules, minus the
  // title/kind vocabulary the template deliberately does not own) ----
  if (
    !Number.isInteger(input.maxDepth) ||
    input.maxDepth < 1 ||
    input.maxDepth > MAX_CODING_STRUCTURE_DEPTH
  ) {
    return fail('max_depth_invalid');
  }
  if (input.levels.length === 0) {
    return fail('levels_missing');
  }
  if (input.levels.length > input.maxDepth) {
    return fail('levels_exceed_depth');
  }
  const seenLevels = new Set<number>();
  let totalLength = 0;
  for (const level of input.levels) {
    if (
      !Number.isInteger(level.levelIndex) ||
      level.levelIndex < 1 ||
      level.levelIndex > input.maxDepth
    ) {
      return fail('level_index_out_of_range', String(level.levelIndex));
    }
    if (seenLevels.has(level.levelIndex)) {
      return fail('level_index_duplicate', String(level.levelIndex));
    }
    seenLevels.add(level.levelIndex);
    if (
      !Number.isInteger(level.digitLength) ||
      level.digitLength < MIN_LEVEL_DIGIT_LENGTH
    ) {
      return fail('digit_length_invalid', String(level.levelIndex));
    }
    totalLength += level.digitLength;
  }
  for (let index = 1; index <= input.maxDepth; index += 1) {
    if (!seenLevels.has(index)) {
      return fail('level_index_gap', String(index));
    }
  }
  if (totalLength > MAX_ACCOUNT_CODE_LENGTH) {
    return fail('code_length_too_large');
  }

  // ---- node tree ----
  if (input.nodes.length === 0) {
    return fail('nodes_missing');
  }
  const byKey = new Map<string, BaseChartNodeInput>();
  const seenCodes = new Set<string>();
  for (const node of input.nodes) {
    if (!isNonBlank(node.nodeKey) || node.nodeKey.length > MAX_CODE_LENGTH) {
      return fail('node_key_invalid', node.nodeKey);
    }
    if (byKey.has(node.nodeKey)) {
      return fail('node_key_duplicate', node.nodeKey);
    }
    byKey.set(node.nodeKey, node);
    if (seenCodes.has(node.code)) {
      return fail('node_code_duplicate', node.code);
    }
    seenCodes.add(node.code);
    if (!isNonBlank(node.title) || node.title.length > MAX_TITLE_LENGTH) {
      return fail('node_title_invalid', node.nodeKey);
    }
    if (!isAccountNature(node.accountNature)) {
      return fail('node_nature_invalid', node.nodeKey);
    }
  }
  for (const node of input.nodes) {
    if (node.parentNodeKey === null) continue;
    if (!byKey.has(node.parentNodeKey) || node.parentNodeKey === node.nodeKey) {
      return fail('node_parent_unknown', node.nodeKey);
    }
  }

  // Derive levels: root = 1, child = parent + 1, with a visited set per walk
  // (a cycle can only hide in a parent chain, never in one level pass).
  const derivedLevel = new Map<string, number>();
  const levelOf = (nodeKey: string): number | 'cycle' => {
    const memo = derivedLevel.get(nodeKey);
    if (memo !== undefined) return memo;
    const node = byKey.get(nodeKey);
    if (node === undefined || node.parentNodeKey === null) {
      derivedLevel.set(nodeKey, 1);
      return 1;
    }
    // Walk up with the visiting set; memoized results stay exact.
    const chain: string[] = [];
    let cursor: string = nodeKey;
    const visiting = new Set<string>();
    while (true) {
      if (visiting.has(cursor)) return 'cycle';
      visiting.add(cursor);
      chain.push(cursor);
      const upstream = byKey.get(cursor);
      if (upstream === undefined || upstream.parentNodeKey === null) {
        break;
      }
      const parentMemo = derivedLevel.get(upstream.parentNodeKey);
      if (parentMemo !== undefined) {
        for (const [index, key] of chain.entries()) {
          derivedLevel.set(key, parentMemo + (chain.length - index));
        }
        return derivedLevel.get(nodeKey) as number;
      }
      cursor = upstream.parentNodeKey;
    }
    for (const [index, key] of chain.entries()) {
      derivedLevel.set(key, chain.length - index);
    }
    return derivedLevel.get(nodeKey) as number;
  };
  for (const node of input.nodes) {
    if (levelOf(node.nodeKey) === 'cycle') {
      return fail('node_cycle', node.nodeKey);
    }
  }

  // Parent/child + code + authored postability gates.
  const hasChildren = new Set<string>();
  for (const node of input.nodes) {
    if (node.parentNodeKey !== null) hasChildren.add(node.parentNodeKey);
  }
  const derived: DerivedBaseChartNode[] = [];
  for (const node of input.nodes) {
    const level = derivedLevel.get(node.nodeKey) as number;
    const parentCode =
      node.parentNodeKey === null
        ? null
        : (byKey.get(node.parentNodeKey)?.code ?? null);
    const check = checkAccountCode({
      code: node.code,
      level,
      parentCode,
      levels: input.levels,
    });
    if (check.problem !== null) {
      return fail('node_code_invalid', node.nodeKey, check.problem);
    }
    if (hasChildren.has(node.nodeKey) && node.isPostable === true) {
      return fail('node_parent_postable', node.nodeKey);
    }
    derived.push({
      nodeKey: node.nodeKey,
      parentNodeKey: node.parentNodeKey,
      level,
      code: node.code,
      title: node.title,
      accountNature: node.accountNature,
      isPostable:
        node.isPostable ??
        defaultIsPostableForTemplateLevel(input.levels, level),
      isMandatory: node.isMandatory,
      defaultIsActive: node.defaultIsActive,
    });
  }

  return { plan: { problem: null }, nodes: derived };
}

/** The postability default a node inherits from its level (Task 21 §7). */
export function defaultIsPostableForTemplateLevel(
  levels: readonly Pick<
    BaseChartTemplateLevel,
    'levelIndex' | 'defaultIsPostable'
  >[],
  level: number,
): boolean {
  for (const entry of levels) {
    if (entry.levelIndex === level) return entry.defaultIsPostable;
  }
  return false;
}

/** Human-readable message per problem (AR-24: never leak internals). */
export function baseChartContentProblemMessage(
  problem: BaseChartContentProblem,
): string {
  switch (problem) {
    case 'max_depth_invalid':
      return `maxDepth must be an integer between 1 and ${MAX_CODING_STRUCTURE_DEPTH} (the architecture depth cap).`;
    case 'levels_missing':
      return 'A base chart version needs one level definition per level (maxDepth rows).';
    case 'levels_exceed_depth':
      return 'The level list is longer than maxDepth.';
    case 'level_index_out_of_range':
      return 'Every levelIndex must be an integer between 1 and maxDepth.';
    case 'level_index_duplicate':
      return 'Two levels claim the same levelIndex; ordinals are 1..maxDepth with no duplicates.';
    case 'level_index_gap':
      return 'The level ordinals must cover 1..maxDepth with no gap.';
    case 'digit_length_invalid':
      return `Every level must contribute at least ${MIN_LEVEL_DIGIT_LENGTH} digit(s).`;
    case 'code_length_too_large':
      return `The configured levels add up to more than the maximum account code length (${MAX_ACCOUNT_CODE_LENGTH} characters).`;
    case 'nodes_missing':
      return 'A base chart version needs at least one account node (an empty template has nothing to adopt).';
    case 'node_key_invalid':
      return `Every node needs a non-blank nodeKey of at most ${MAX_CODE_LENGTH} characters.`;
    case 'node_key_duplicate':
      return 'Two nodes claim the same nodeKey inside one version.';
    case 'node_parent_unknown':
      return 'A node’s parentNodeKey must name another node of the same version.';
    case 'node_cycle':
      return 'The node tree must stay acyclic (following parent keys returns to the same node).';
    case 'node_code_invalid':
      return 'A node code must be digits only, match the total digit length of its derived level, and extend its parent’s code by exactly the level’s segment.';
    case 'node_code_duplicate':
      return 'Two nodes claim the same account code inside one version.';
    case 'node_title_invalid':
      return `Every node needs a non-blank title of at most ${MAX_TITLE_LENGTH} characters.`;
    case 'node_nature_invalid':
      return 'Every node’s accountNature must be "debit" or "credit".';
    case 'node_parent_postable':
      return 'A node that has children cannot be postable (posting stays leaf-only — OD-20-5).';
  }
}
