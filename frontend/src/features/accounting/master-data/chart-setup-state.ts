import type {
  AccountingConfiguration,
  CodingStructureVersion,
} from '@/api/contracts';

export interface LevelShape {
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
}

type AnyLevel = {
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
};

export function levelShapeOf(
  levels: readonly AnyLevel[] | undefined,
): LevelShape[] {
  return [...(levels ?? [])]
    .sort((a, b) => a.levelIndex - b.levelIndex)
    .map((l) => ({
      levelIndex: l.levelIndex,
      title: l.title,
      digitLength: l.digitLength,
      defaultIsPostable: l.defaultIsPostable,
    }));
}

/** ODR-1 coherence as the backend enforces it for root creation: same level count and same digit length per level. Titles/postable defaults are not part of the pin-coherence comparison (`AccountsService.assertPinCoherence`). */
export function shapesCompatible(
  a: readonly AnyLevel[] | undefined,
  b: readonly AnyLevel[] | undefined,
): boolean {
  const sa = levelShapeOf(a);
  const sb = levelShapeOf(b);
  return (
    sa.length === sb.length &&
    sa.every((l, i) => l.digitLength === sb[i]?.digitLength)
  );
}

export type ChartSetupState =
  | { kind: 'ready' }
  | { kind: 'blocked-incompatible' }
  | {
      kind: 'actionable';
      /** Levels the missing side(s) must use; from the active aggregate or a reusable draft when one side is already fixed. Null = user defines levels. */
      lockedLevels: LevelShape[] | null;
      codingAction: 'none' | 'publish-draft' | 'create-and-publish';
      codingDraftId: string | null;
      configAction: 'none' | 'publish-draft' | 'create-and-publish';
      configDraftId: string | null;
    };

function reusableDraft<T extends { id: string; levels: readonly AnyLevel[] }>(
  drafts: readonly T[],
  locked: readonly AnyLevel[] | null,
): T | null {
  if (locked === null) return drafts[0] ?? null;
  return drafts.find((d) => shapesCompatible(d.levels, locked)) ?? null;
}

/**
 * Classify the authoritative server state (active aggregates + drafts) into
 * the only legal next actions. Never proposes overwriting an active
 * aggregate; incompatible actives are blocked, not repaired automatically.
 */
export function classifyChartSetup(input: {
  codingActive: CodingStructureVersion | null;
  configActive: AccountingConfiguration | null;
  codingDrafts: readonly CodingStructureVersion[];
  configDrafts: readonly AccountingConfiguration[];
}): ChartSetupState {
  const { codingActive, configActive, codingDrafts, configDrafts } = input;

  if (codingActive !== null && configActive !== null) {
    return shapesCompatible(codingActive.levels, configActive.levels)
      ? { kind: 'ready' }
      : { kind: 'blocked-incompatible' };
  }

  // One side fixed → the other side must adopt its exact digit shape.
  const fixedLevels: readonly AnyLevel[] | null =
    codingActive?.levels ?? configActive?.levels ?? null;

  const codingDraft =
    codingActive === null ? reusableDraft(codingDrafts, fixedLevels) : null;
  const configDraft =
    configActive === null ? reusableDraft(configDrafts, fixedLevels) : null;

  // Neither active: a reusable draft pair/one draft also fixes the shape, so
  // a retry after partial success never invents a divergent pattern.
  const locked: readonly AnyLevel[] | null =
    fixedLevels ?? codingDraft?.levels ?? configDraft?.levels ?? null;

  return {
    kind: 'actionable',
    lockedLevels: locked === null ? null : levelShapeOf(locked),
    codingAction:
      codingActive !== null
        ? 'none'
        : codingDraft !== null
          ? 'publish-draft'
          : 'create-and-publish',
    codingDraftId: codingDraft?.id ?? null,
    configAction:
      configActive !== null
        ? 'none'
        : configDraft !== null
          ? 'publish-draft'
          : 'create-and-publish',
    configDraftId: configDraft?.id ?? null,
  };
}
