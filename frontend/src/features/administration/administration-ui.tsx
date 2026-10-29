/**
 * Presentational atoms shared by the administration surfaces (users, roles).
 *
 * `Definition`/`DefinitionList` are re-exported from the shared pattern layer
 * (`@/ui/patterns/definition-list`) instead of being re-implemented here: the
 * compact record-metadata grid must look and measure the same in every module
 * (design-system.md §1 rule 3).
 *
 * Only `@/ui`, `@/lib` and `@/api` cross the feature boundary
 * (`standards.md` §2).
 */

export { Definition, DefinitionList } from '@/ui/patterns/definition-list';
