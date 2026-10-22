#!/usr/bin/env node
/**
 * Frontend design-system guard (standards.md §17 "hex/rgb مستقیم" +
 * principle ۶ "رنگ فقط توکن semantic").
 *
 * The owner does not read diffs, so every rule that can be stated mechanically
 * has to be executed by a gate (standards.md §17, principle ۱۲). Tailwind makes
 * it very easy to reintroduce a raw palette value (`text-slate-600`) or a hex
 * literal ({"#e11d48"}) in a component, which silently bypasses the semantic
 * token layer in `src/styles/index.css` and drifts the product's visual
 * language one commit at a time.
 *
 * What this checks, and deliberately does NOT check:
 *
 *  1. No hex/rgb/hsl colour literal in any `src/**` TS/TSX file. Colour values
 *     live in `src/styles/index.css` (`@theme`), nowhere else.
 *  2. The shared layer (`src/ui/**` — every primitive and pattern — and
 *     `src/app/**` — the shell, gates, breadcrumb) uses semantic tokens only:
 *     `bg-surface`, `text-ink-muted`, `border-line`, `text-danger-ink`, …
 *     A feature page may still use a palette utility for a one-off accent
 *     while it migrates; the shared layer, which every page inherits, may not.
 *  3. The semantic token contract itself exists in `src/styles/index.css`, so
 *     a component cannot reference a token that was never defined.
 *
 * Usage:
 *   node scripts/check-frontend-design-tokens.mjs [--root <dir>]
 *
 * Exit code 0 = clean, 1 = violations (printed with file:line), 2 = usage
 * error. No network, no dependencies, read-only.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Tailwind's default palette scales: the raw values a semantic token replaces. */
const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/**
 * Matches a palette utility anywhere in a class string: `text-slate-600`,
 * `hover:bg-rose-50`, `border-b-amber-200`, `focus-visible:outline-indigo-500`.
 * The required digit range keeps non-colour names such as `text-balance` or
 * `border-collapse` out of the match.
 */
const PALETTE_UTILITY = new RegExp(
  String.raw`\b(?:[a-z-]+:)*(?:text|bg|border|ring|outline|fill|stroke|from|via|to|divide|shadow|accent|caret|decoration|placeholder)-(?:${PALETTE})-[0-9]{2,3}\b`,
  'g',
);

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/g;

/** The shared layer: inherited by every feature page, so tokens are mandatory. */
const SHARED_DIRS = ['src/ui', 'src/app'];

/** The token contract a shared component is allowed to reference. */
const REQUIRED_TOKENS = [
  '--color-canvas',
  '--color-surface',
  '--color-sunken',
  '--color-line',
  '--color-line-strong',
  '--color-ink',
  '--color-ink-muted',
  '--color-ink-subtle',
  '--color-brand',
  '--color-brand-soft',
  '--color-brand-ink',
  '--color-ok-soft',
  '--color-ok-line',
  '--color-ok-ink',
  '--color-warn-soft',
  '--color-warn-line',
  '--color-warn-ink',
  '--color-danger',
  '--color-danger-soft',
  '--color-danger-line',
  '--color-danger-ink',
  '--color-info-soft',
  '--color-info-line',
  '--color-info-ink',
  '--radius-control',
  '--radius-card',
  '--shadow-card',
  '--shadow-raised',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function parseArgs(argv) {
  let root = join(SCRIPT_DIR, '..', 'frontend');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      const value = argv[index + 1];
      if (value === undefined) {
        console.error('check-frontend-design-tokens: --root needs a directory');
        process.exit(2);
      }
      root = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/check-frontend-design-tokens.mjs [--root <dir>]',
      );
      process.exit(0);
    } else {
      console.error(
        `check-frontend-design-tokens: unknown argument ${JSON.stringify(arg)}`,
      );
      process.exit(2);
    }
  }
  return { root };
}

function walk(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, files);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function lineOf(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function isSharedSource(posixPath) {
  return SHARED_DIRS.some(
    (dir) => posixPath === dir || posixPath.startsWith(`${dir}/`),
  );
}

function scanFile(fullPath, posixPath) {
  const violations = [];
  const text = readFileSync(fullPath, 'utf8');

  for (const match of text.matchAll(COLOUR_LITERAL)) {
    violations.push({
      file: posixPath,
      line: lineOf(text, match.index ?? 0),
      rule: 'no-raw-colour',
      detail: `raw colour literal ${match[0]} — define the value as a token in src/styles/index.css`,
    });
  }

  if (isSharedSource(posixPath)) {
    for (const match of text.matchAll(PALETTE_UTILITY)) {
      violations.push({
        file: posixPath,
        line: lineOf(text, match.index ?? 0),
        rule: 'shared-layer-uses-token',
        detail: `palette utility ${match[0]} in the shared layer — use a semantic token (surface/line/ink/brand/ok/warn/danger/info)`,
      });
    }
  }

  return violations;
}

function checkTokenContract(root) {
  const cssPath = join(root, 'src', 'styles', 'index.css');
  let css;
  try {
    css = readFileSync(cssPath, 'utf8');
  } catch {
    return [
      {
        file: 'src/styles/index.css',
        line: 1,
        rule: 'token-contract',
        detail: 'the design-token layer is missing entirely',
      },
    ];
  }

  const missing = REQUIRED_TOKENS.filter(
    (token) => !new RegExp(`${token}\\s*:`).test(css),
  );
  if (missing.length === 0) return [];

  return [
    {
      file: 'src/styles/index.css',
      line: 1,
      rule: 'token-contract',
      detail: `missing token(s): ${missing.join(', ')}`,
    },
  ];
}

const { root } = parseArgs(process.argv.slice(2));

const sourceFiles = walk(root)
  .map((full) => ({ full, posix: toPosix(relative(root, full)) }))
  .sort((left, right) => left.posix.localeCompare(right.posix));

const violations = [
  ...checkTokenContract(root),
  ...sourceFiles.flatMap(({ full, posix }) => scanFile(full, posix)),
];

if (violations.length === 0) {
  console.log(
    `frontend design tokens: OK (${sourceFiles.length} source files, shared layer is token-only)`,
  );
  process.exit(0);
}

console.error(
  `frontend design tokens: ${violations.length} violation(s) (standards.md §17, principle ۶)`,
);
for (const violation of violations) {
  console.error(
    `  ${violation.file}:${violation.line}  [${violation.rule}] ${violation.detail}`,
  );
}
console.error(
  'Colour decisions belong to src/styles/index.css; components use the semantic tokens it defines.',
);
process.exit(1);
