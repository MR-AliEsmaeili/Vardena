import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { setOwnerTheme } from '@/lib/appearance';
import { t } from '@/lib/i18n';
import { Badge } from './badge';
import { PasswordInput } from './password-input';

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
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('Owner Licensing design tokens & controls', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/styles/index.css'),
    'utf8',
  );
  const light = parseBlock(css, '@theme');
  const dark = { ...light, ...parseBlock(css, "[data-theme='dark']") };

  const buttonInk = light['--color-surface']!;

  it.each([
    ['light', light],
    ['dark', dark],
  ])(
    'satisfies >= 4.5:1 WCAG AA contrast for text and action tokens in %s theme',
    (_name, theme) => {
      const pairs: [string, string][] = [
        [theme['--color-ink']!, theme['--color-surface']!],
        [theme['--color-secondary']!, theme['--color-surface']!],
        [theme['--color-muted-ink']!, theme['--color-surface']!],
        [theme['--color-subtle']!, theme['--color-surface']!],
        [buttonInk, theme['--color-accent']!],
        [buttonInk, theme['--color-accent-strong']!],
        [buttonInk, theme['--color-danger-action']!],
        [theme['--color-accent-ink']!, theme['--color-accent-soft']!],
        [theme['--color-success']!, theme['--color-success-soft']!],
        [theme['--color-warning']!, theme['--color-warning-soft']!],
        [theme['--color-danger']!, theme['--color-danger-soft']!],
        [theme['--color-critical-ink']!, theme['--color-critical-soft']!],
      ];
      for (const [fg, bg] of pairs) {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('renders PasswordInput with accessible show/hide toggle and Badge severity tiers', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <PasswordInput
          aria-label={t.auth.password}
          defaultValue="owner-secret"
        />
        <Badge variant="critical">افشاشده</Badge>
      </div>,
    );

    const input = screen.getByLabelText(t.auth.password);
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: t.auth.showPassword }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByText('افشاشده').className).toContain('bg-critical-soft');

    setOwnerTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    setOwnerTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
