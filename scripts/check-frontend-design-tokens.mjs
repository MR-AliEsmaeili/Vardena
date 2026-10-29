#!/usr/bin/env node
/**
 * Frontend design-system guard (standards.md §17 "hex/rgb مستقیم" +
 * principle ۶ "رنگ فقط توکن semantic" + RTL logical properties).
 *
 * Enforces mechanically across both `frontend` and `owner-licensing/frontend`:
 *
 *  1. No hex/rgb/hsl colour literal in any `src/**` TS/TSX file. Colour values
 *     live in `src/styles/index.css` (`@theme`), nowhere else.
 *  2. Every UI, shell, and feature file (`src/ui/**`, `src/app/**`,
 *     `src/features/**`) uses semantic tokens only — zero raw Tailwind palette
 *     classes (`text-slate-600`, `bg-indigo-50`, `text-rose-800`, …).
 *  3. Zero physical horizontal directional classes (`ml-*`, `mr-*`, `pl-*`,
 *     `pr-*`, `text-left`, `text-right`, `border-l-*`, `border-r-*`) in
 *     non-test source files so Persian RTL stays 100% logical (`ms-*`, `me-*`,
 *     `ps-*`, `pe-*`, `text-start`, `text-end`, `border-s-*`, `border-e-*`).
 *  4. The semantic token contract (including `critical` severity tokens)
 *     exists in `src/styles/index.css`.
 *
 * Usage:
 *   node scripts/check-frontend-design-tokens.mjs [--root <dir>]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

const PALETTE_UTILITY = new RegExp(
  String.raw`\b(?:[a-z-]+:)*(?:text|bg|border|ring|outline|fill|stroke|from|via|to|divide|shadow|accent|caret|decoration|placeholder)-(?:${PALETTE})-[0-9]{2,3}\b`,
  'g',
);

const PHYSICAL_DIR_UTILITY =
  /\b(?:[a-z-]+:)*(?:ml|mr|pl|pr)-[0-9.px[\]]+\b|\b(?:[a-z-]+:)*(?:text-left|text-right|border-l|border-r|rounded-l|rounded-r)(?:-[a-z0-9[\].]+)?\b/g;

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/g;

const TOKEN_ONLY_DIRS = ['src/ui', 'src/app', 'src/features'];

const CUSTOMER_REQUIRED_TOKENS = [
  '--color-canvas',
  '--color-surface',
  '--color-sunken',
  '--color-line',
  '--color-line-strong',
  '--color-ink',
  '--color-ink-muted',
  '--color-ink-subtle',
  '--color-brand',
  '--color-brand-strong',
  '--color-brand-soft',
  '--color-brand-ink',
  '--color-ok-soft',
  '--color-ok-line',
  '--color-ok-ink',
  '--color-warn-soft',
  '--color-warn-line',
  '--color-warn-ink',
  '--color-danger',
  '--color-danger-strong',
  '--color-danger-soft',
  '--color-danger-line',
  '--color-danger-ink',
  '--color-critical',
  '--color-critical-soft',
  '--color-critical-line',
  '--color-critical-ink',
  '--color-info-soft',
  '--color-info-line',
  '--color-info-ink',
  '--radius-control',
  '--radius-card',
  '--shadow-card',
  '--shadow-raised',
];

const OWNER_REQUIRED_TOKENS = [
  '--color-canvas',
  '--color-surface',
  '--color-muted',
  '--color-line',
  '--color-control-line',
  '--color-ink',
  '--color-secondary',
  '--color-muted-ink',
  '--color-subtle',
  '--color-accent',
  '--color-accent-strong',
  '--color-accent-soft',
  '--color-accent-line',
  '--color-accent-ink',
  '--color-success',
  '--color-success-soft',
  '--color-success-line',
  '--color-warning',
  '--color-warning-soft',
  '--color-warning-line',
  '--color-danger',
  '--color-danger-action',
  '--color-danger-soft',
  '--color-danger-line',
  '--color-critical',
  '--color-critical-soft',
  '--color-critical-line',
  '--color-critical-ink',
  '--radius-control',
  '--radius-card',
  '--shadow-card',
  '--shadow-raised',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function parseArgs(argv) {
  let explicitRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      const value = argv[index + 1];
      if (value === undefined) {
        console.error('check-frontend-design-tokens: --root needs a directory');
        process.exit(2);
      }
      explicitRoot = resolve(value);
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
  if (explicitRoot !== null) {
    return [explicitRoot];
  }
  return [
    join(REPO_ROOT, 'frontend'),
    join(REPO_ROOT, 'owner-licensing', 'frontend'),
  ];
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

function isTokenOnlySource(posixPath) {
  return TOKEN_ONLY_DIRS.some(
    (dir) => posixPath === dir || posixPath.startsWith(`${dir}/`),
  );
}

function isTestFile(posixPath) {
  return /\.test\.tsx?$/.test(posixPath);
}

function scanFile(fullPath, posixPath, labelPrefix) {
  const violations = [];
  const text = readFileSync(fullPath, 'utf8');
  const displayPath = labelPrefix ? `${labelPrefix}/${posixPath}` : posixPath;

  for (const match of text.matchAll(COLOUR_LITERAL)) {
    violations.push({
      file: displayPath,
      line: lineOf(text, match.index ?? 0),
      rule: 'no-raw-colour',
      detail: `raw colour literal ${match[0]} — define the value as a token in src/styles/index.css`,
    });
  }

  if (isTokenOnlySource(posixPath)) {
    for (const match of text.matchAll(PALETTE_UTILITY)) {
      violations.push({
        file: displayPath,
        line: lineOf(text, match.index ?? 0),
        rule: 'semantic-token-only',
        detail: `palette utility ${match[0]} — use a semantic token (surface/line/ink/brand/ok/warn/danger/critical/info)`,
      });
    }
  }

  if (!isTestFile(posixPath)) {
    for (const match of text.matchAll(PHYSICAL_DIR_UTILITY)) {
      violations.push({
        file: displayPath,
        line: lineOf(text, match.index ?? 0),
        rule: 'rtl-logical-property',
        detail: `physical directional utility ${match[0]} — use logical RTL utilities (ms-/me-/ps-/pe-/text-start/text-end/border-s/border-e)`,
      });
    }
  }

  return violations;
}

function requiredTokensForRoot(root) {
  const normalized = toPosix(root);
  if (
    normalized.includes('owner-licensing/frontend') ||
    basename(root) === 'owner-licensing-frontend'
  ) {
    return OWNER_REQUIRED_TOKENS;
  }
  return CUSTOMER_REQUIRED_TOKENS;
}

function checkTokenContract(root, labelPrefix) {
  const cssRel = 'src/styles/index.css';
  const displayPath = labelPrefix ? `${labelPrefix}/${cssRel}` : cssRel;
  const cssPath = join(root, 'src', 'styles', 'index.css');
  let css;
  try {
    css = readFileSync(cssPath, 'utf8');
  } catch {
    return [
      {
        file: displayPath,
        line: 1,
        rule: 'token-contract',
        detail: 'the design-token layer is missing entirely',
      },
    ];
  }

  const required = requiredTokensForRoot(root);
  const missing = required.filter(
    (token) => !new RegExp(`${token}\\s*:`).test(css),
  );
  if (missing.length === 0) return [];

  return [
    {
      file: displayPath,
      line: 1,
      rule: 'token-contract',
      detail: `missing token(s): ${missing.join(', ')}`,
    },
  ];
}

const roots = parseArgs(process.argv.slice(2));
const multiRoot = roots.length > 1;

let totalFiles = 0;
const violations = [];

for (const root of roots) {
  const labelPrefix = multiRoot ? toPosix(relative(REPO_ROOT, root)) : '';
  const sourceFiles = walk(root)
    .map((full) => ({ full, posix: toPosix(relative(root, full)) }))
    .sort((left, right) => left.posix.localeCompare(right.posix));
  totalFiles += sourceFiles.length;
  violations.push(
    ...checkTokenContract(root, labelPrefix),
    ...sourceFiles.flatMap(({ full, posix }) =>
      scanFile(full, posix, labelPrefix),
    ),
  );
}

if (violations.length === 0) {
  console.log(
    `frontend design tokens: OK (${totalFiles} source files across ${roots.length} app(s), semantic-token & RTL-logical clean)`,
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
  'Colour decisions belong to src/styles/index.css; components use semantic tokens and RTL logical properties.',
);
process.exit(1);
