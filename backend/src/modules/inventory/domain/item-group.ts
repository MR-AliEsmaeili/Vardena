/**
 * Item group — hierarchical classification for reporting and creation-time
 * defaults (master-data-strategy.md §3.2, glossary §Item group / category).
 *
 * It is *not* a universal category or tag system: it is a single self-
 * referencing tree per organization, used to group items in reports and to
 * suggest defaults when an item is created. Groups never override an existing
 * item at runtime (§7.2).
 *
 * Framework-free (AR-05).
 */

export interface ItemGroup {
  id: string;
  organizationId: string;
  /** Null for a root group. */
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ItemGroupDto {
  id: string;
  organizationId: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toItemGroupDto(group: ItemGroup): ItemGroupDto {
  return {
    id: group.id,
    organizationId: group.organizationId,
    parentId: group.parentId,
    code: group.code,
    name: group.name,
    isActive: group.isActive,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}
