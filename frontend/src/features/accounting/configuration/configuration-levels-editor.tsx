import type {
  ConfigurationLevelDraft,
  LevelFieldProblem,
  LevelProblems,
} from './configuration-levels';
import {
  CONFIGURATION_LEVEL_KINDS,
  MAX_ACCOUNT_CODE_LENGTH,
  MIN_LEVEL_DIGIT_LENGTH,
  suggestPattern,
} from './configuration-levels';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FormField } from '@/ui/patterns/form-field';

/**
 * The level editor of one accounting-configuration version (ACC-06).
 *
 * A fully controlled component: it renders the rows the page owns and emits
 * structural changes (add / remove-last / row patch). It performs NO request,
 * derives no state and never renumbers silently — `levelIndex` stays
 * contiguous because only the tail is added or removed, which is exactly the
 * server's `1..maxDepth` requirement.
 *
 * The pattern shown here is a PREVIEW: the authoritative `pattern` is the one
 * the API returns for a stored version (the detail/list surfaces show that).
 */
const KIND_LABELS: Record<string, string> = {
  group: t.accountingConfig.levelKindGroup,
  general: t.accountingConfig.levelKindGeneral,
  subsidiary: t.accountingConfig.levelKindSubsidiary,
  detail: t.accountingConfig.levelKindDetail,
};

function problemText(
  problem: LevelFieldProblem | undefined,
): string | undefined {
  if (problem === 'titleRequired') return t.accountingConfig.levelTitleRequired;
  if (problem === 'digitsRange') return t.accountingConfig.digitLengthInvalid;
  if (problem === 'kindTooLong') return t.accountingConfig.levelKindTooLong;
  return undefined;
}

export function ConfigurationLevelsEditor({
  levels,
  rows,
  continuityInvalid,
  totalLengthInvalid,
  disabled = false,
  onAdd,
  onRemoveLast,
  onChange,
}: {
  levels: readonly ConfigurationLevelDraft[];
  /** Per-`levelIndex` problems from `validateLevels` (absent = acceptable). */
  rows: Record<number, LevelProblems>;
  continuityInvalid: boolean;
  totalLengthInvalid: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onRemoveLast: () => void;
  onChange: (index: number, patch: Partial<ConfigurationLevelDraft>) => void;
}) {
  return (
    <section className="space-y-3" aria-label={t.accountingConfig.levels}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          {t.accountingConfig.levels}
        </h2>
        <p className="text-xs text-ink-subtle">
          {t.accountingConfig.patternPreview}:{' '}
          <span
            className="code"
            dir="ltr"
            data-testid="configuration-pattern-preview"
          >
            {suggestPattern(levels)}
          </span>
        </p>
      </div>
      <p className="text-xs text-ink-subtle">{t.accountingConfig.levelsHint}</p>

      {levels.map((level, index) => {
        const problems = rows[level.levelIndex] ?? {};
        return (
          <div
            key={level.levelIndex}
            className="grid items-start gap-3 rounded-card border border-line p-3 sm:grid-cols-2 lg:grid-cols-5"
            data-testid="configuration-level-row"
          >
            <p className="text-xs font-medium text-ink-muted">
              {t.accountingConfig.levelIndex} {level.levelIndex}
            </p>
            <FormField
              id={`configuration-level-${index}-title`}
              label={t.accountingConfig.levelTitle}
              required
              error={problemText(problems.title)}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  value={level.title}
                  onChange={(event) =>
                    onChange(index, { title: event.target.value })
                  }
                  disabled={disabled}
                  autoComplete="off"
                />
              )}
            </FormField>
            <FormField
              id={`configuration-level-${index}-digits`}
              label={t.accountingConfig.digitLength}
              required
              error={problemText(problems.digitLength)}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  type="number"
                  dir="ltr"
                  min={MIN_LEVEL_DIGIT_LENGTH}
                  max={MAX_ACCOUNT_CODE_LENGTH}
                  value={level.digitLength}
                  onChange={(event) =>
                    onChange(index, {
                      digitLength: Number(event.target.value),
                    })
                  }
                  disabled={disabled}
                />
              )}
            </FormField>
            <FormField
              id={`configuration-level-${index}-kind`}
              label={t.accountingConfig.levelKind}
              error={problemText(problems.levelKind)}
            >
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  value={level.levelKind}
                  onChange={(event) =>
                    onChange(index, { levelKind: event.target.value })
                  }
                  disabled={disabled}
                >
                  <option value="">{t.accountingConfig.levelKindNone}</option>
                  {CONFIGURATION_LEVEL_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <label className="flex items-center gap-2 pt-6 text-xs text-ink">
              <input
                type="checkbox"
                checked={level.defaultIsPostable}
                onChange={(event) =>
                  onChange(index, { defaultIsPostable: event.target.checked })
                }
                disabled={disabled}
              />
              {t.accountingConfig.defaultPostable}
            </label>
          </div>
        );
      })}

      {continuityInvalid && (
        <p className="text-xs text-danger-ink" role="alert">
          {t.accountingConfig.levelContinuity}
        </p>
      )}
      {totalLengthInvalid && (
        <p className="text-xs text-danger-ink" role="alert">
          {t.accountingConfig.totalLengthInvalid}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={disabled}
          data-testid="configuration-add-level"
        >
          {t.accountingConfig.addLevel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemoveLast}
          disabled={disabled || levels.length <= 1}
          data-testid="configuration-remove-level"
        >
          {t.accountingConfig.removeLevel}
        </Button>
      </div>
    </section>
  );
}

/** The kind labels the detail surface renders for a stored `levelKind`. */
export function configurationLevelKindLabel(levelKind: string | null): string {
  if (levelKind === null || levelKind.trim() === '') {
    return t.accountingConfig.levelKindNone;
  }
  return KIND_LABELS[levelKind] ?? levelKind;
}
