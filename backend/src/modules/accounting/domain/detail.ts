/**
 * Detail — one node of the organization's detail hierarchy (Task 30 — OD-29-03).
 *
 * Detail hierarchy is a first-class, organization-configurable hierarchy
 * independent from the Chart of Accounts.
 *
 * - Level 1 nodes are Level-1 Detail Groups (`گروه تفصیلی`).
 * - Level 2+ nodes are child Details under their parent Detail / Detail Group.
 * - Accounts relate to Level-1 Detail Groups (`Account.detailGroupId`), and
 *   document lines on such accounts must allocate to a valid descendant Detail
 *   under that group.
 *
 * Framework-free (AR-05): pure rules, unit-tested.
 */

import {
  checkDetailCode,
  detailCodeProblemMessage,
  type DetailCodeProblem,
} from './detail-structure.js';

export const MAX_DETAIL_TITLE_LENGTH = 200;

export interface Detail {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  /** 1-based depth (Level 1 = Detail Group). */
  level: number;
  detailStructureVersionId: string;
  isPostable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DetailDto {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  level: number;
  detailStructureVersionId: string;
  isPostable: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toDetailDto(detail: Detail): DetailDto {
  return {
    id: detail.id,
    organizationId: detail.organizationId,
    code: detail.code,
    title: detail.title,
    parentId: detail.parentId,
    level: detail.level,
    detailStructureVersionId: detail.detailStructureVersionId,
    isPostable: detail.isPostable,
    isActive: detail.isActive,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
  };
}

export interface DetailPlacementParent {
  id: string;
  organizationId: string;
  code: string;
  level: number;
  isPostable: boolean;
  isActive: boolean;
  detailStructureVersionId: string;
}

export type DetailPlacementProblem =
  | 'parent_not_found'
  | 'self_parent'
  | 'cross_organization'
  | 'cycle'
  | 'parent_disabled'
  | 'parent_postable'
  | 'depth_exceeded'
  | 'version_mismatch'
  | DetailCodeProblem;

export interface DetailPlacementPlan {
  problem: DetailPlacementProblem | null;
  level: number;
}

export function planDetailPlacement(input: {
  id: string;
  organizationId: string;
  parentId: string | null;
  code: string;
  parent: DetailPlacementParent | null;
  descendantIds: readonly string[];
  levels: readonly { levelIndex: number; digitLength: number }[];
  maxDepth: number;
}): DetailPlacementPlan {
  const parent = input.parent;
  const level = parent === null ? 1 : parent.level + 1;

  if (input.parentId !== null) {
    if (parent === null) {
      return { problem: 'parent_not_found', level };
    }
    if (input.id !== '' && input.id === input.parentId) {
      return { problem: 'self_parent', level };
    }
    if (parent.organizationId !== input.organizationId) {
      return { problem: 'cross_organization', level };
    }
    if (input.descendantIds.includes(input.parentId)) {
      return { problem: 'cycle', level };
    }
    if (!parent.isActive) {
      return { problem: 'parent_disabled', level };
    }
    if (parent.isPostable) {
      return { problem: 'parent_postable', level };
    }
  }

  if (level > input.maxDepth) {
    return { problem: 'depth_exceeded', level };
  }

  const codeCheck = checkDetailCode({
    code: input.code,
    level,
    parentCode: parent === null ? null : parent.code,
    levels: input.levels,
  });

  if (codeCheck.problem !== null) {
    return { problem: codeCheck.problem, level };
  }

  return { problem: null, level };
}

export function planDetailPostabilityChange(input: {
  isPostable: boolean;
  hasChildren: boolean;
}): DetailPlacementProblem | null {
  if (input.isPostable && input.hasChildren) {
    return 'parent_postable';
  }
  return null;
}

export function detailPlacementProblemMessage(
  problem: DetailPlacementProblem,
): string {
  switch (problem) {
    case 'parent_not_found':
      return 'The parent detail does not exist in this organization.';
    case 'self_parent':
      return 'A detail cannot be its own parent.';
    case 'cross_organization':
      return 'A detail and its parent must belong to the same organization.';
    case 'cycle':
      return 'A detail cannot be moved under one of its own descendants.';
    case 'parent_disabled':
      return 'A disabled detail cannot receive new children.';
    case 'parent_postable':
      return 'A parent detail cannot be postable: only leaf details can post.';
    case 'depth_exceeded':
      return 'The detail level would exceed the maximum depth of the detail structure.';
    case 'version_mismatch':
      return 'Detail and parent must belong to the same detail structure version.';
    default:
      return detailCodeProblemMessage(problem);
  }
}

/**
 * Checks if a detail node belongs to a Level-1 Detail Group.
 * Returns true if:
 * 1. The detail itself is the group (detail.id === groupId, when detail.level === 1)
 * 2. Or the detail's root ancestor ID matches the groupId.
 */
export function isDetailInGroup(input: {
  detailId: string;
  groupId: string;
  detailLookup: (
    id: string,
  ) => { id: string; parentId: string | null; level: number } | null;
}): boolean {
  let currentId: string | null = input.detailId;
  const visited = new Set<string>();

  while (currentId !== null) {
    if (visited.has(currentId)) return false; // cycle safeguard
    visited.add(currentId);

    if (currentId === input.groupId) {
      return true;
    }

    const node = input.detailLookup(currentId);
    if (node === null) return false;
    currentId = node.parentId;
  }

  return false;
}
