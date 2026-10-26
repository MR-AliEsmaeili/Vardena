/**
 * Profile → «رنگ ماژول‌ها» (D-3, spec §4.3·§6.10·ب).
 *
 * A pure re-assignment grid over the SIX approved tones — never a colour
 * picker, never a raw hex. Choosing a tone that another module holds SWAPS
 * the two (bijection preserved by construction, W-17), and «بازگشت به
 * پیش‌فرض» restores the shipped mapping.
 *
 * Application is instant and app-wide without re-rendering anything:
 * `applyModuleTones` re-points the module-facing CSS variables at the
 * source palette (`--color-tone-src-*`) on `<html>`, and every component
 * keeps reading its module-keyed tokens. The preview renders both themes
 * side by side through nested `data-theme` containers using the SOURCE
 * tiles, so it shows the tones themselves, not the current remap.
 */

import { useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  applyModuleTones,
  DEFAULT_MODULE_TONES,
  MODULE_IDS,
  swapModuleTone,
  type ModuleId,
  type ModuleToneMap,
} from '@/lib/module-tones';
import {
  persistModuleTones,
  readModuleTones,
} from '@/lib/module-tones-storage';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { NAV_TONE_SRC_TILE } from '@/ui/nav-glyph';
import { Select } from '@/ui/select';

export function ModuleTonesSection() {
  const [tones, setTones] = useState<ModuleToneMap>(() => readModuleTones());

  const commit = (next: ModuleToneMap) => {
    setTones(next);
    persistModuleTones(next);
    applyModuleTones(next);
  };

  const assign = (moduleId: ModuleId, tone: ModuleId) => {
    const next = swapModuleTone(tones, moduleId, tone);
    if (next === tones) return;
    commit(next);
  };

  const resetAll = () => {
    commit({ ...DEFAULT_MODULE_TONES });
  };

  return (
    <Card data-testid="module-tones-section">
      <CardHeader>
        <CardTitle>{t.workspace.tonesSectionTitle}</CardTitle>
        <CardDescription>{t.workspace.tonesSectionDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {MODULE_IDS.map((moduleId) => (
            <div
              key={moduleId}
              className="flex items-center gap-2.5 rounded-control border border-line bg-surface p-2"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph ring-1 ring-inset',
                  NAV_TONE_SRC_TILE[tones[moduleId]].idle,
                )}
              />
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-ink">
                  {t.workspace.moduleNames[moduleId]}
                </span>
                <Select
                  aria-label={t.workspace.toneSelectorLabel.replace(
                    '{module}',
                    t.workspace.moduleNames[moduleId],
                  )}
                  data-testid={`module-tone-select-${moduleId}`}
                  value={tones[moduleId]}
                  onChange={(event) =>
                    assign(moduleId, event.target.value as ModuleId)
                  }
                  className="h-8 text-xs"
                >
                  {MODULE_IDS.map((tone) => (
                    <option key={tone} value={tone}>
                      {t.workspace.toneNames[tone]}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          ))}
        </div>

        {/* Dual-theme preview (§4.3): both themes simultaneously; the chips
            read the SOURCE palette so each shows the tone itself. */}
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">
            {t.workspace.tonesPreviewLabel}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['light', 'dark'] as const).map((theme) => (
              <div
                key={theme}
                data-theme={theme}
                data-testid={`module-tones-preview-${theme}`}
                className="rounded-card border border-line bg-canvas p-3"
              >
                <p className="mb-2 text-[0.6875rem] text-ink-subtle">
                  {theme === 'light'
                    ? t.workspace.tonesPreviewLight
                    : t.workspace.tonesPreviewDark}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {MODULE_IDS.map((moduleId) => (
                    <span
                      key={moduleId}
                      title={t.workspace.moduleNames[moduleId]}
                      aria-label={`${t.workspace.moduleNames[moduleId]}: ${t.workspace.toneNames[tones[moduleId]]}`}
                      className={cn(
                        'h-6 w-6 rounded-control ring-1 ring-inset',
                        NAV_TONE_SRC_TILE[tones[moduleId]].idle,
                      )}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={resetAll}
          data-testid="module-tones-reset"
        >
          {t.workspace.resetTones}
        </Button>
      </CardContent>
    </Card>
  );
}
