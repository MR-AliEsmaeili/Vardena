/* eslint-disable no-await-in-loop -- Mutate the same fixture sequentially to prove each failure independently. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  cp,
  readdir,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { files, stageDateFoundation } from './stage-date-foundation.mjs';

test('stages only exact canonical sources, removes stale files, fails unknown imports/missing source', async () => {
  const root = await mkdtemp(`${tmpdir()}/vardena-date-`);
  const source = pathToFileURL(`${root}/source/`);
  const target = pathToFileURL(`${root}/target/`);
  try {
    await cp(
      new URL('../../../frontend/src/lib/datetime/', import.meta.url),
      source,
      { recursive: true },
    );
    await stageDateFoundation(source, target);
    assert.deepEqual((await readdir(target)).sort(), [...files].sort());
    for (const file of files)
      assert.deepEqual(
        await readFile(new URL(file, target)),
        await readFile(new URL(file, source)),
      );
    await writeFile(new URL('stale.ts', target), 'stale');
    await stageDateFoundation(source, target);
    await assert.rejects(readFile(new URL('stale.ts', target)), {
      code: 'ENOENT',
    });
    for (const code of [
      "import secret from '../app';",
      "import '../app';",
      "export * from '../app';",
      "const app = import('../app');",
      "const app = require('../app');",
      "type App = import('../app').App;",
      "import App = require('../app');",
      "import dayjs from 'dayjs';", // allowed package, but NOT this file's edge
      'export const silentlyRemovedDependencies = true;',
    ]) {
      await writeFile(new URL('calendar.ts', source), code);
      await assert.rejects(stageDateFoundation(source, target), /Unapproved/);
    }
    await rm(new URL('calendar.ts', source));
    await assert.rejects(stageDateFoundation(source, target), {
      code: 'ENOENT',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const expected = [
  'calendar.ts',
  'dayjs.ts',
  'numerals.ts',
  'business-date.ts',
  'time-zone.ts',
  'instant.ts',
  'instant-range.ts',
];
test('explicit PO seven-file boundary matches staging, Docker COPY and context allowlists', async () => {
  assert.deepEqual(files, expected);
  const docker = await readFile(
    new URL('../Dockerfile', import.meta.url),
    'utf8',
  );
  const context = await readFile(
    new URL('../Dockerfile.dockerignore', import.meta.url),
    'utf8',
  );
  const copied = [
    ...docker.matchAll(/frontend\/src\/lib\/datetime\/([\w.-]+\.ts)/g),
  ].map((m) => m[1]);
  const permitted = [
    ...context.matchAll(/^!frontend\/src\/lib\/datetime\/([\w.-]+\.ts)$/gm),
  ].map((m) => m[1]);
  assert.deepEqual(copied.sort(), [...expected].sort());
  assert.deepEqual(permitted.sort(), [...expected].sort());
  assert.ok(context.includes('\n**\n'));
  for (const excluded of [
    'node_modules',
    'dist',
    'coverage',
    '.env*',
    'src/lib/.date-foundation',
  ]) {
    assert.ok(context.includes(`owner-licensing/frontend/${excluded}`));
  }
  for (const ignore of ['.gitignore', '.prettierignore']) {
    assert.ok(
      (
        await readFile(new URL(`../${ignore}`, import.meta.url), 'utf8')
      ).includes('src/lib/.date-foundation/'),
    );
  }
});

test('type declarations belong to Owner-installed locked dependencies, not staged files', async () => {
  const lock = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
  );
  for (const name of ['jalaali-js', 'dayjs']) {
    const root = new URL(`../node_modules/${name}/`, import.meta.url);
    const pkg = JSON.parse(
      await readFile(new URL('package.json', root), 'utf8'),
    );
    assert.equal(pkg.version, lock.packages[`node_modules/${name}`].version);
    assert.equal(typeof pkg.types, 'string');
    await access(new URL(pkg.types, root));
  }
  for (const name of ['utc', 'timezone'])
    await access(
      new URL(`../node_modules/dayjs/plugin/${name}.d.ts`, import.meta.url),
    );
  assert.ok(files.every((file) => !file.endsWith('.d.ts')));
});
