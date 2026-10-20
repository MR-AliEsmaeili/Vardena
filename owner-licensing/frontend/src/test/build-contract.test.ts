import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('independent Owner install/build contract', () => {
  it('ships a real Owner v3 lock, not a placeholder or customer lock', () => {
    const manifest = JSON.parse(read('../../package.json'));
    const lock = JSON.parse(read('../../package-lock.json'));
    expect(lock.name).toBe('vardena-owner-ui');
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages[''].dependencies).toEqual(manifest.dependencies);
    expect(lock.packages[''].devDependencies).toEqual(manifest.devDependencies);
    expect(lock.packages['node_modules/thinking-orbs']).toMatchObject({
      version: '0.3.2',
      resolved:
        'https://registry.npmjs.org/thinking-orbs/-/thinking-orbs-0.3.2.tgz',
      integrity: expect.stringMatching(/^sha512-/),
    });
  });
  it('installs from the Owner working directory and copies its own lock into the image', () => {
    const dockerfile = read('../../Dockerfile');
    expect(dockerfile).toContain('WORKDIR /repo/owner-licensing/frontend');
    expect(dockerfile).toContain(
      'COPY owner-licensing/frontend/package.json owner-licensing/frontend/package-lock.json ./',
    );
    expect(dockerfile).toContain(
      'RUN npm ci --ignore-scripts --no-audit --no-fund',
    );
    expect(dockerfile).toContain('RUN npm run build');
    expect(dockerfile).not.toContain('COPY frontend/package');
  });
});
