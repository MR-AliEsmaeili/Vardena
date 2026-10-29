import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function parseBlock(css: string, marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`Missing CSS block ${marker}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = css.slice(open + 1, end);
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      tokens[key] = value.trim();
    }
  }
  return tokens;
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const srgb = Number.parseInt(clean.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Vardena semantic token WCAG AA contrast contract', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/styles/index.css'),
    'utf8',
  );
  const light = parseBlock(css, '@theme');
  const dark = { ...light, ...parseBlock(css, "[data-theme='dark']") };
  const explicitLight = parseBlock(css, "[data-theme='light']");
  const buttonInk = light['--color-surface']!;

  it.each([
    ['light', light],
    ['dark', dark],
  ])(
    'keeps text and interactive button pairs >= 4.5:1 in %s theme',
    (_name, theme) => {
      const textPairs: [string, string][] = [
        [theme['--color-ink']!, theme['--color-surface']!],
        [theme['--color-ink']!, theme['--color-canvas']!],
        [theme['--color-ink-muted']!, theme['--color-surface']!],
        [theme['--color-ink-muted']!, theme['--color-canvas']!],
        [theme['--color-ink-subtle']!, theme['--color-surface']!],
        [buttonInk, theme['--color-brand']!],
        [buttonInk, theme['--color-brand-strong']!],
        [buttonInk, theme['--color-danger']!],
        [buttonInk, theme['--color-danger-strong']!],
        [theme['--color-brand-ink']!, theme['--color-brand-soft']!],
        [theme['--color-ok-ink']!, theme['--color-ok-soft']!],
        [theme['--color-warn-ink']!, theme['--color-warn-soft']!],
        [theme['--color-danger-ink']!, theme['--color-danger-soft']!],
        [theme['--color-critical-ink']!, theme['--color-critical-soft']!],
        [theme['--color-info-ink']!, theme['--color-info-soft']!],
      ];

      for (const [fg, bg] of textPairs) {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }

      for (const mod of [
        'workspace',
        'accounting',
        'inventory',
        'organization',
        'licensing',
        'admin',
      ]) {
        expect(
          contrastRatio(
            theme[`--color-tone-src-${mod}-ink`]!,
            theme[`--color-tone-src-${mod}-soft`]!,
          ),
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('re-declares brand and status tokens in [data-theme="light"] so nested previews inside dark mode stay isolated', () => {
    for (const key of [
      '--color-brand',
      '--color-brand-strong',
      '--color-ok-ink',
      '--color-warn-ink',
      '--color-danger-ink',
      '--color-critical-ink',
      '--color-info-ink',
    ]) {
      expect(explicitLight[key]).toBe(light[key]);
    }
  });
});
