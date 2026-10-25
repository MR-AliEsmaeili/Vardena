import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeLicenseTransport } from './modules/licensing/domain/license-document.js';
import { parsePublicKey } from './modules/licensing/domain/license-code.js';
import { parseDeveloperLicenseDocument } from './modules/licensing/domain/developer-license-document.js';
import { runDeveloperLicenseCli } from './issue-development-license.js';

const created: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    created
      .splice(0)
      .map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

async function privateDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'vardena-developer-license-'),
  );
  created.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

describe('official Developer License CLI', () => {
  it('generates protected key files without printing private material', async () => {
    const directory = await privateDirectory();
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    await runDeveloperLicenseCli(['--keygen', '--out-dir', directory]);

    const privatePath = path.join(directory, 'developer-license-key.pkcs8');
    const privateMaterial = (await readFile(privatePath, 'utf8')).trim();
    expect(output.join('')).not.toContain(privateMaterial);
    if (process.platform !== 'win32') {
      expect((await stat(privatePath)).mode & 0o077).toBe(0);
    }
    await expect(
      runDeveloperLicenseCli(['--keygen', '--out-dir', directory]),
    ).rejects.toThrow(/overwrite/);
  });

  it('issues deterministic, self-verifying files and refuses overwrite', async () => {
    const directory = await privateDirectory();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runDeveloperLicenseCli(['--keygen', '--out-dir', directory]);
    const privatePath = path.join(directory, 'developer-license-key.pkcs8');
    const publicMaterial = (
      await readFile(
        path.join(directory, 'developer-license-public-key.txt'),
        'utf8',
      )
    ).trim();
    const info: unknown = JSON.parse(
      await readFile(
        path.join(directory, 'developer-license-key-info.json'),
        'utf8',
      ),
    );
    if (
      typeof info !== 'object' ||
      info === null ||
      !('keyId' in info) ||
      typeof info.keyId !== 'string'
    ) {
      throw new Error('Generated key metadata did not contain a key id.');
    }
    const first = path.join(directory, 'first.vdev.json');
    const second = path.join(directory, 'second.vdev.json');
    const common = [
      '--private-key-file',
      privatePath,
      '--installation',
      '01JDEVINSTALLATION000000000',
      '--developer-id',
      'developer-alice',
      '--developer-name',
      'Alice Example',
      '--operation-id',
      'developer-operation-001',
      '--license-id',
      'developer-license-001',
      '--issued-at',
      '2026-10-25T10:00:00.000Z',
      '--valid-from',
      '2026-10-25T10:00:00.000Z',
      '--valid-until',
      '2027-01-25T10:00:00.000Z',
      '--organizations',
      '2',
      '--users',
      '10',
      '--modules',
      'organization,users',
      '--features',
      'developer-tools',
    ];
    await runDeveloperLicenseCli([...common, '--out', first]);
    await runDeveloperLicenseCli([...common, '--out', second]);
    expect(await readFile(first, 'utf8')).toBe(await readFile(second, 'utf8'));

    const transport = decodeLicenseTransport(await readFile(first, 'utf8'));
    expect(
      parseDeveloperLicenseDocument(
        transport.document,
        [{ id: info.keyId, key: parsePublicKey(publicMaterial) }],
        { keyId: transport.keyId },
      ).payload,
    ).toMatchObject({
      licenseType: 'DEVELOPER',
      developerId: 'developer-alice',
      installationId: '01JDEVINSTALLATION000000000',
    });
    await expect(
      runDeveloperLicenseCli([...common, '--out', first]),
    ).rejects.toThrow(/overwrite/);
  });

  it('refuses out-of-range CLI limits without writing an artifact', async () => {
    const directory = await privateDirectory();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runDeveloperLicenseCli(['--keygen', '--out-dir', directory]);
    const output = path.join(directory, 'invalid.vdev.json');

    await expect(
      runDeveloperLicenseCli([
        '--private-key-file',
        path.join(directory, 'developer-license-key.pkcs8'),
        '--out',
        output,
        '--installation',
        '01JDEVINSTALLATION000000000',
        '--developer-id',
        'developer-alice',
        '--developer-name',
        'Alice Example',
        '--issued-at',
        '2026-10-25T10:00:00.000Z',
        '--valid-from',
        '2026-10-25T10:00:00.000Z',
        '--valid-until',
        '2027-01-25T10:00:00.000Z',
        '--organizations',
        '2',
        '--users',
        '2147483648',
        '--modules',
        'organization,users',
      ]),
    ).rejects.toThrow(/positive 32-bit integer/);
    await expect(readFile(output, 'utf8')).rejects.toThrow();
  });

  it('rejects permissive private-key permissions before signing on POSIX', async () => {
    if (process.platform === 'win32') return;
    const directory = await privateDirectory();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runDeveloperLicenseCli(['--keygen', '--out-dir', directory]);
    const privatePath = path.join(directory, 'developer-license-key.pkcs8');
    await chmod(privatePath, 0o644);
    await expect(
      runDeveloperLicenseCli([
        '--private-key-file',
        privatePath,
        '--out',
        path.join(directory, 'refused.vdev.json'),
      ]),
    ).rejects.toThrow(/group or others/);

    await chmod(privatePath, 0o600);
    await chmod(directory, 0o755);
    await expect(
      runDeveloperLicenseCli([
        '--private-key-file',
        privatePath,
        '--out',
        path.join(directory, 'refused-parent.vdev.json'),
      ]),
    ).rejects.toThrow(/group or others/);
  });
});
