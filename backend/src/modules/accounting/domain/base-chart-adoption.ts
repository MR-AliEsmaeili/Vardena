/**
 * Base Chart Adoption — the pure planners behind the explicit, atomic,
 * organization-scoped COPY operation (Task 23; OD-20-1; Task 21 governance
 * baseline §3/§4/§5/§7).
 *
 * Three decision tables, each total and deterministic, each applied on BOTH
 * sides of the write boundary (service pre-flight + inside the locked
 * adoption transaction — the established two-call-site pattern
 * `planPinCoherence`/`planAccountPlacement` already use):
 *
 * 1. `planTemplateCompatibility` — Is this template version's shape valid
 *    under the organization's pinned configuration shape? Code-shape
 *    compatibility is mandatory BEFORE adoption (baseline §3, option C):
 *    depth must fit and every shared level's digit length must be equal, so
 *    every template code stays a valid §9.3 code inside the organization
 *    chart. ODR-1 pin coherence of the organization's pair itself is the
 *    caller's existing `planPinCoherence` gate — this planner only ever
 *    compares template ↔ configuration.
 *
 * 2. `planAdoptionSelection` — the FINAL ADOPTION SET (baseline §4.3):
 *
 *        requested accounts
 *        ∪  ancestor closure        (every node's ancestors, §8.6/AR-13)
 *        ∪  mandatory accounts      (every `is_mandatory` node, §5)
 *        =  final adoption set
 *
 *    `selectedNodeKeys = null` means FULL-version adoption (requested = the
 *    whole version); a supplied list is a bounded PARTIAL adoption. The
 *    output is returned IN TOPOLOGICAL ORDER (level ascending, then code
 *    ascending) — parents before children — so the insert order is a pure
 *    function of the version content, never of the caller's list order.
 *
 * 3. `deriveAdoptedPostability` — OD-20-5 as a DERIVATION, not a trust:
 *    `postable ⇒ leaf`. A node that has children IN THE FINAL ADOPTION SET
 *    is written `is_postable = false` regardless of the template default
 *    ("configured is_postable = true" can never allow non-leaf posting); a
 *    leaf keeps the template node's authored default.
 *
 * What deliberately does NOT live here: provenance on account rows (OPEN,
 * Task 21 §4.2/§8), any control role (OD-20-2/3), any organization-required,
 * statutory or dimension semantics (baseline §5 table, OQ-41/OQ-43), and
 * any upgrade/merge engine (baseline §8 — upgrades are future explicit
 * operations, never silent mutation of an adopted chart).
 *
 * Framework-free (AR-05): pure functions, unit-tested.
 */

import type { AccountCodeProblem } from './account-code.js';
import { checkAccountCode } from './account-code.js';
import type { BaseChartTemplateNode } from './base-chart-template.js';

// ---------------------------------------------------------------------------
// 1. Template ↔ organization configuration compatibility
// ---------------------------------------------------------------------------

export type BaseChartCompatibilityProblem =
  /** The template's depth exceeds the organization's configured depth. */
  | 'template_depth_exceeded'
  /** A shared level's digit length differs from the organization's shape. */
  | 'digit_length_mismatch'
  /**
   * A node code does not validate against the organization's shape (belt and
   * braces: with equal digit lengths this cannot trigger for a
   * content-planned version, but the ADOPTION boundary re-proves it rather
   * than trusting the gate that ran at authoring time).
   */
  | 'code_incompatible';

export interface BaseChartCompatibilityPlan {
  problem: BaseChartCompatibilityProblem | null;
  /** The offending level ordinal or node key. */
  subject?: string | undefined;
  /** Detail when `problem === 'code_incompatible'`. */
  accountCodeProblem?: AccountCodeProblem | undefined;
}

/**
 * Validate the template version against the organization's ACCOUNTING
 * CONFIGURATION levels — the root whose level set every account write
 * actually validates codes against (the caller already asserted the pinned
 * pair is ODR-1-coherent, so the coding structure cannot disagree).
 */
export function planTemplateCompatibility(input: {
  templateMaxDepth: number;
  templateLevels: readonly { levelIndex: number; digitLength: number }[];
  nodes: readonly BaseChartTemplateNode[];
  configurationLevels: readonly { levelIndex: number; digitLength: number }[];
}): BaseChartCompatibilityPlan {
  const organizationDepth = input.configurationLevels.length;
  if (input.templateMaxDepth > organizationDepth) {
    return {
      problem: 'template_depth_exceeded',
      subject: String(input.templateMaxDepth),
    };
  }
  const configurationByIndex = new Map(
    input.configurationLevels.map((level) => [
      level.levelIndex,
      level.digitLength,
    ]),
  );
  for (const level of input.templateLevels) {
    const organizationDigitLength = configurationByIndex.get(level.levelIndex);
    if (
      organizationDigitLength === undefined ||
      organizationDigitLength !== level.digitLength
    ) {
      return {
        problem: 'digit_length_mismatch',
        subject: String(level.levelIndex),
      };
    }
  }
  const byKey = new Map(input.nodes.map((node) => [node.nodeKey, node]));
  for (const node of input.nodes) {
    const parent =
      node.parentNodeKey === null ? null : byKey.get(node.parentNodeKey);
    const check = checkAccountCode({
      code: node.code,
      level: node.level,
      parentCode: parent === null || parent === undefined ? null : parent.code,
      levels: input.configurationLevels,
    });
    if (check.problem !== null) {
      return {
        problem: 'code_incompatible',
        subject: node.nodeKey,
        accountCodeProblem: check.problem,
      };
    }
  }
  return { problem: null };
}

export function baseChartCompatibilityProblemMessage(
  problem: BaseChartCompatibilityProblem,
): string {
  switch (problem) {
    case 'template_depth_exceeded':
      return 'The base chart version is deeper than the organization’s configured chart depth. Publish a compatible accounting configuration first.';
    case 'digit_length_mismatch':
      return 'The base chart version’s digit length for a level differs from the organization’s configured digit length for that level.';
    case 'code_incompatible':
      return 'A node of the base chart version is not a valid account code under the organization’s configured chart shape.';
  }
}

// ---------------------------------------------------------------------------
// 2 + 3. Final adoption set + leaf-only postability derivation
// ---------------------------------------------------------------------------

export type BaseChartSelectionProblem =
  /** A selected key names no node of the template version. */
  | 'unknown_node_key'
  /**
   * A node's authored parent is not part of the version (broken template
   * integrity — unreachable for a content-planned published version, so this
   * is a corruption guard, not an authoring error).
   */
  | 'ancestor_missing';

/** One node of the FINAL adoption set, ready to become an `accounts` row. */
export interface PlannedAdoptionNode {
  nodeKey: string;
  parentNodeKey: string | null;
  level: number;
  code: string;
  title: string;
  accountNature: string;
  /**
   * DERIVED, leaf-only (OD-20-5): `false` whenever the node has children in
   * the final adoption set, the template's authored default otherwise.
   */
  isPostable: boolean;
  isMandatory: boolean;
  defaultIsActive: boolean;
  /** Template node row id (read-side correlation only, never stored back). */
  templateNodeId: string;
}

export interface BaseChartAdoptionPlan {
  problem: BaseChartSelectionProblem | null;
  /** The offending node key. */
  subject?: string | undefined;
  /** Final adoption set in topological order (level, then code ascending). */
  nodes: PlannedAdoptionNode[];
}

/**
 * Compute the final adoption set for one request against one immutable
 * published version.
 *
 * The set derivation has NO case analysis beyond the two invariants:
 * closure and mandatory-inclusion apply identically to a full adoption
 * (where they are tautologies the planner still PROVES — template integrity
 * is never assumed) and to a partial one (where they are the bounding
 * rules).
 */
export function planAdoptionSelection(input: {
  nodes: readonly BaseChartTemplateNode[];
  /** `null` = adopt the whole version; otherwise the authored selection. */
  selectedNodeKeys: readonly string[] | null;
}): BaseChartAdoptionPlan {
  const byKey = new Map(input.nodes.map((node) => [node.nodeKey, node]));
  // Template integrity: every authored parent must be a node of the version.
  for (const node of input.nodes) {
    if (node.parentNodeKey !== null && !byKey.has(node.parentNodeKey)) {
      return {
        problem: 'ancestor_missing',
        subject: node.nodeKey,
        nodes: [],
      };
    }
  }

  const requested = new Set<string>();
  if (input.selectedNodeKeys === null) {
    for (const node of input.nodes) requested.add(node.nodeKey);
  } else {
    for (const key of input.selectedNodeKeys) {
      if (!byKey.has(key)) {
        return { problem: 'unknown_node_key', subject: key, nodes: [] };
      }
      requested.add(key);
    }
  }
  // Mandatory inclusion applies to EVERY adoption, full or partial (§5).
  for (const node of input.nodes) {
    if (node.isMandatory) requested.add(node.nodeKey);
  }

  // Ancestor closure over the requested ∪ mandatory union.
  const final = new Set<string>();
  for (const key of requested) {
    let cursor: string | null = key;
    while (cursor !== null && !final.has(cursor)) {
      final.add(cursor);
      cursor = byKey.get(cursor)?.parentNodeKey ?? null;
    }
  }

  const finalNodes = input.nodes.filter((node) => final.has(node.nodeKey));
  const withChildren = new Set<string>();
  for (const node of finalNodes) {
    if (node.parentNodeKey !== null) withChildren.add(node.parentNodeKey);
  }
  const planned = finalNodes.map((node) => ({
    nodeKey: node.nodeKey,
    parentNodeKey: node.parentNodeKey,
    level: node.level,
    code: node.code,
    title: node.title,
    accountNature: node.accountNature,
    isPostable: withChildren.has(node.nodeKey) ? false : node.isPostable,
    isMandatory: node.isMandatory,
    defaultIsActive: node.defaultIsActive,
    templateNodeId: node.id,
  }));

  // Topological order: parents (smaller level) first, code ascending inside
  // one level — parents always precede children because child level =
  // parent level + 1 by derivation.
  planned.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.code.localeCompare(b.code, 'en');
  });

  return { problem: null, nodes: planned };
}

export function baseChartSelectionProblemMessage(
  problem: BaseChartSelectionProblem,
): string {
  switch (problem) {
    case 'unknown_node_key':
      return 'The selection names a nodeKey that does not belong to this base chart version.';
    case 'ancestor_missing':
      return 'The base chart version is internally inconsistent: a node’s parent is missing (the version is not adoptable integrity-wise).';
  }
}
