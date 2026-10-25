import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertDeveloperKeyPathPrivate,
  assertPosixModePrivate,
  assertWindowsAclPrivate,
  writeExclusive,
} from './developer-license-key-files.js';

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('Developer License key-file custody', () => {
  it('accepts private POSIX modes and refuses group/other access', () => {
    expect(() => assertPosixModePrivate(0o100600)).not.toThrow();
    expect(() => assertPosixModePrivate(0o040700)).not.toThrow();
    expect(() => assertPosixModePrivate(0o100640)).toThrow(/group or others/);
    expect(() => assertPosixModePrivate(0o040755)).toThrow(/group or others/);
  });

  it('accepts only the operator/SYSTEM/Administrators in a Windows DACL', () => {
    const privateAcl = [
      'OWNER\tS-1-5-21-1000',
      'USER\tS-1-5-21-1000',
      'ACE\tS-1-5-21-1000\tAllow\t2032127\t0',
      'ACE\tS-1-5-18\tAllow\t2032127\t0',
      'ACE\tS-1-5-32-544\tAllow\t2032127\t0',
    ].join('\n');
    expect(() => assertWindowsAclPrivate(privateAcl)).not.toThrow();
    expect(() =>
      assertWindowsAclPrivate(`${privateAcl}\nACE\tS-1-1-0\tAllow\t1\t0`),
    ).toThrow(/unapproved Windows principal/);
    expect(() =>
      assertWindowsAclPrivate(
        [
          'OWNER\tS-1-1-0',
          'USER\tS-1-5-21-1000',
          'ACE\tS-1-5-21-1000\tAllow\t1\t0',
        ].join('\n'),
      ),
    ).toThrow(/owned by an unapproved/);
    expect(() => assertWindowsAclPrivate('malformed')).toThrow(/malformed/);
  });

  it('refuses symbolic links before private key access', async () => {
    if (process.platform === 'win32') return;
    const directory = await mkdtemp(path.join(tmpdir(), 'vardena-key-link-'));
    created.push(directory);
    await chmod(directory, 0o700);
    const target = path.join(directory, 'target.pkcs8');
    const link = path.join(directory, 'link.pkcs8');
    await writeFile(target, 'synthetic\n', { mode: 0o600 });
    await symlink(target, link);
    await expect(assertDeveloperKeyPathPrivate(link)).rejects.toThrow(
      /never a link/,
    );
  });

  it('creates exclusively and never overwrites an existing file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'vardena-key-file-'));
    created.push(directory);
    await chmod(directory, 0o700);
    const destination = path.join(directory, 'key.pkcs8');
    await writeExclusive(destination, 'first\n');
    await expect(writeExclusive(destination, 'second\n')).rejects.toThrow(
      /overwrite/,
    );
    expect(await readFile(destination, 'utf8')).toBe('first\n');
  });
});
