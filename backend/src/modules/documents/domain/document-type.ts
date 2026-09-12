/**
 * Document type — the controlled, code-defined document vocabulary
 * (Task 8 §6, ADR-0019 §4, ADR-0018 "structure is code").
 *
 * A document type is CODE, never a database row and never user input: modules
 * register their types in the application `DocumentTypeRegistry` (the same
 * relationship `rbac.permissions` has to the permission registry). This file
 * holds the framework-free definition and its validation.
 *
 * Two things are deliberately separated (Task 8 §7/§8):
 *   - the PRIMARY STATES a document is in after issuance: `temporary`,
 *     `final`. There is NO `initial` state — it was explicitly removed;
 *   - the DRAFT phase: a separate, optional pre-issuance phase a document may
 *     pass through before being issued into `temporary` or `final`.
 *
 * `draft` is therefore NOT a state: reports and permissions branch on the
 * states, while draft capability is a per-type/per-organization selection.
 */

export const DOCUMENT_STATES = ['temporary', 'final'] as const;

export type DocumentState = (typeof DOCUMENT_STATES)[number];

export function isDocumentState(value: string): value is DocumentState {
  return (DOCUMENT_STATES as readonly string[]).includes(value);
}

/** The pre-issuance phase. Separate from the states by design (Task 8 §8). */
export const DRAFT_PHASE = 'draft' as const;

/**
 * Where a document is, across both the Draft phase and the primary states.
 * `null` means the document does not exist yet (only meaningful for the
 * `create` action).
 */
export type DocumentPhase = DocumentState | typeof DRAFT_PHASE;

export const DOCUMENT_PHASES = [DRAFT_PHASE, ...DOCUMENT_STATES] as const;

export function isDocumentPhase(value: string): value is DocumentPhase {
  return (DOCUMENT_PHASES as readonly string[]).includes(value);
}

/**
 * The state/phase actions the Foundation models (Task 8 §9). This is the
 * authorization vocabulary, not a second permission system: each action still
 * maps to an RBAC `Module.Entity.Action` permission in the owning module. The
 * Foundation provides the *state* half of the decision; RBAC provides the
 * *permission* half; the owning module composes them.
 */
export const DOCUMENT_ACTIONS = [
  'create',
  'view',
  'edit',
  'delete',
  'print',
  'export',
  'assign_number',
  'submit',
  'finalize',
  'reopen',
] as const;

export type DocumentAction = (typeof DOCUMENT_ACTIONS)[number];

export function isDocumentAction(value: string): value is DocumentAction {
  return (DOCUMENT_ACTIONS as readonly string[]).includes(value);
}

/** Document type codes are stable snake_case strings (`inventory_receipt`). */
export const DOCUMENT_TYPE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const MAX_DOCUMENT_TYPE_CODE_LENGTH = 64;

export function isValidDocumentTypeCode(code: string): boolean {
  return DOCUMENT_TYPE_CODE_PATTERN.test(code);
}

/** Module names are lowercase snake_case (`inventory`, `sales`). */
export const MODULE_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const MAX_MODULE_NAME_LENGTH = 64;

export function isValidModuleName(module: string): boolean {
  return MODULE_NAME_PATTERN.test(module);
}

export const MAX_DOCUMENT_TYPE_NAME_LENGTH = 200;

/**
 * The structure a module declares for one of its document types. Selection
 * (which types an organization uses, whether draft is required, which
 * numbering series is bound) is organization configuration; this shape is not.
 *
 * - `entryStates`: the states a document may ENTER issuance in — the target of
 *   a draft `submit`, or the state a directly-created document lands in.
 *   Task 8 §7 options map here: A → `['temporary']` with draft,
 *   B → `['final']` with draft, C → `['temporary']` without draft,
 *   D → `['final']` without draft.
 * - `draftCapable`: whether the type supports the pre-issuance Draft phase.
 * - `deletablePhases`: the phases in which a module permits deletion
 *   (Task 8 §14). `final` is included only if explicitly declared — the
 *   default is that final documents are protected (Task 8 §15).
 */
export interface DocumentTypeDefinition {
  /** Stable code, e.g. `inventory_receipt`. */
  code: string;
  /** Owning module name, e.g. `inventory`. */
  module: string;
  /** Human-readable name for UI/registry inspection. */
  name: string;
  description?: string | undefined;
  /** Whether the pre-issuance Draft phase is available for this type. */
  draftCapable: boolean;
  /** The states a document may enter issuance in (non-empty). */
  entryStates: readonly DocumentState[];
  /** The phases in which deletion is permitted (subset of the phases). */
  deletablePhases: readonly DocumentPhase[];
}

export type DocumentTypeDefinitionProblem =
  | 'invalid_code'
  | 'invalid_module'
  | 'blank_name'
  | 'empty_entry_states'
  | 'invalid_entry_state'
  | 'invalid_deletable_phase'
  | 'draft_without_capability';

/**
 * Validate a definition at registration time. This is a programmer-error
 * check (like `assertValidPermissionDefinitions`): a malformed definition means
 * the code that declares the type is wrong, so the module must fail at startup
 * rather than register a type nobody can reason about.
 *
 * @throws Error describing the first problem found.
 */
export function assertValidDocumentTypeDefinition(
  definition: DocumentTypeDefinition,
): void {
  if (!isValidDocumentTypeCode(definition.code)) {
    throw new Error(
      `Invalid document type code "${definition.code}". Codes must be lowercase snake_case, e.g. "inventory_receipt".`,
    );
  }
  if (!isValidModuleName(definition.module)) {
    throw new Error(
      `Invalid module name "${definition.module}" for document type "${definition.code}". Module names must be lowercase snake_case, e.g. "inventory".`,
    );
  }
  if (definition.name.trim().length === 0) {
    throw new Error(`Document type "${definition.code}" must have a name.`);
  }
  if (definition.name.length > MAX_DOCUMENT_TYPE_NAME_LENGTH) {
    throw new Error(
      `Document type "${definition.code}" name is too long (max ${MAX_DOCUMENT_TYPE_NAME_LENGTH}).`,
    );
  }
  if (definition.entryStates.length === 0) {
    throw new Error(
      `Document type "${definition.code}" must declare at least one entry state.`,
    );
  }
  for (const state of definition.entryStates) {
    if (!isDocumentState(state)) {
      throw new Error(
        `Document type "${definition.code}" declares an unknown entry state "${state}".`,
      );
    }
  }
  if (
    !definition.draftCapable &&
    definition.deletablePhases.includes(DRAFT_PHASE)
  ) {
    throw new Error(
      `Document type "${definition.code}" lists "draft" as deletable but is not draft-capable.`,
    );
  }
  for (const phase of definition.deletablePhases) {
    if (!isDocumentPhase(phase)) {
      throw new Error(
        `Document type "${definition.code}" declares an unknown deletable phase "${phase}".`,
      );
    }
  }
}

/**
 * Validate a set of definitions at registration time. Programmer-error check:
 * fails loudly on the first malformed or duplicated code.
 *
 * @throws Error on a malformed definition or a duplicated code.
 */
export function assertValidDocumentTypeDefinitions(
  definitions: readonly DocumentTypeDefinition[],
): void {
  const seen = new Set<string>();
  for (const definition of definitions) {
    assertValidDocumentTypeDefinition(definition);
    if (seen.has(definition.code)) {
      throw new Error(
        `Duplicate document type code "${definition.code}" in a single registration.`,
      );
    }
    seen.add(definition.code);
  }
}

/** The state a directly-created document lands in by default: the first entry
 * state (types declare `temporary` first when it is an option). */
export function defaultEntryState(
  definition: DocumentTypeDefinition,
): DocumentState {
  const first = definition.entryStates[0];
  if (first === undefined) {
    throw new Error(
      `Document type "${definition.code}" declares no entry states.`,
    );
  }
  return first;
}
