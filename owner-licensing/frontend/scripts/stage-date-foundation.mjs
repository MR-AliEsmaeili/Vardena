import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// PO-approved build-time projection, not an independent implementation. Only
// this exact framework-free seven-file boundary can enter Owner. No settings/React/API/app
// imports, runtime customer dependency, rewriting, or stale fallback is allowed.
// Explicit final-review PO approval includes dayjs.ts plugin initialization;
// declarations come from Owner-installed locked dependencies, not source copies.
export const files = [
  'calendar.ts',
  'dayjs.ts',
  'numerals.ts',
  'business-date.ts',
  'time-zone.ts',
  'instant.ts',
  'instant-range.ts',
];
// Freeze the reviewed per-file graph, not just a union of allowed packages.
// Changes to these edges (including removed imports) need boundary review.
const approvedImports = {
  'calendar.ts': ['jalaali-js'],
  'dayjs.ts': ['dayjs', 'dayjs/plugin/timezone', 'dayjs/plugin/utc'],
  'numerals.ts': [],
  'business-date.ts': ['./calendar', './dayjs', './numerals'],
  'time-zone.ts': [],
  'instant.ts': [
    './numerals',
    './dayjs',
    './calendar',
    './business-date',
    './time-zone',
  ],
  'instant-range.ts': [
    './business-date',
    './dayjs',
    './instant',
    './time-zone',
  ],
};
export async function stageDateFoundation(
  source = new URL('../../../frontend/src/lib/datetime/', import.meta.url),
  target = new URL('../src/lib/.date-foundation/', import.meta.url),
) {
  const sources = await Promise.all(
    files.map(async (file) => {
      const data = await readFile(new URL(file, source), 'utf8');
      const tree = ts.createSourceFile(
        file,
        data,
        ts.ScriptTarget.Latest,
        true,
      );
      if (tree.parseDiagnostics.length)
        throw new Error(`Invalid date foundation: ${file}`);
      const seen = new Set();
      function check(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          const specifier = node.moduleSpecifier;
          if (specifier) {
            const name = ts.isStringLiteral(specifier) ? specifier.text : '';
            seen.add(name);
            if (!approvedImports[file].includes(name)) {
              throw new Error(
                `Unapproved date-foundation dependency in ${file}: ${name}`,
              );
            }
          }
        }
        // No dynamic/require/import-type escape from the static allowlist.
        if (
          ts.isImportEqualsDeclaration(node) ||
          ts.isImportTypeNode(node) ||
          (ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                node.expression.text === 'require')))
        ) {
          throw new Error(
            `Unapproved dynamic date-foundation dependency in ${file}`,
          );
        }
        ts.forEachChild(node, check);
      }
      check(tree);
      if (seen.size !== approvedImports[file].length) {
        throw new Error(
          `Unapproved date-foundation dependency removal in ${file}`,
        );
      }
      return [file, data];
    }),
  );
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await Promise.all(
    sources.map(([file, data]) => writeFile(new URL(file, target), data)),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await stageDateFoundation();
