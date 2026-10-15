/* eslint-disable no-await-in-loop -- Mutate the same fixture sequentially to prove each failure independently. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
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
