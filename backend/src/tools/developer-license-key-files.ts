import { execFile } from 'node:child_process';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

const POSIX_PLATFORMS = new Set<NodeJS.Platform>([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'netbsd',
  'openbsd',
  'sunos',
]);
const TRUSTED_WINDOWS_SIDS = new Set(['S-1-5-18', 'S-1-5-32-544']);
const SID = 'S-\\d+(?:-\\d+)+';
const WINDOWS_ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$p = $env:VARDENA_DEVELOPER_KEY_PATH',
  "if ([string]::IsNullOrEmpty($p)) { throw 'path missing' }",
  '$acl = if ([System.IO.Directory]::Exists($p)) { [System.IO.Directory]::GetAccessControl($p) } else { [System.IO.File]::GetAccessControl($p) }',
  '$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value',
  '$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  "Write-Output ('OWNER' + [char]9 + $owner)",
  "Write-Output ('USER' + [char]9 + $user)",
  'foreach ($ace in $acl.Access) {',
  '  $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value',
  '  $mask = [int64]$ace.FileSystemRights',
  '  $inheritOnly = 0',
  '  if (($ace.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { $inheritOnly = 1 }',
  "  Write-Output ('ACE' + [char]9 + $sid + [char]9 + $ace.AccessControlType.ToString() + [char]9 + $mask + [char]9 + $inheritOnly)",
  '}',
].join('\n');

export class DeveloperKeyFileError extends Error {}

/** Fail closed unless a key file/directory is private to this operator. */
export async function assertDeveloperKeyPathPrivate(
  target: string,
  dependencies: {
    platform?: NodeJS.Platform;
    lstatPath?: typeof lstat;
    inspectWindowsAcl?: (target: string) => Promise<string>;
  } = {},
): Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  let information: Awaited<ReturnType<typeof lstat>>;
  try {
    information = await (dependencies.lstatPath ?? lstat)(target);
  } catch {
    throw new DeveloperKeyFileError('The private key path does not exist.');
  }
  if (
    information.isSymbolicLink() ||
    (!information.isFile() && !information.isDirectory())
  ) {
    throw new DeveloperKeyFileError(
      'The private key path must be a regular file or directory, never a link or special file.',
    );
  }
  if (platform !== 'win32') {
    if (!POSIX_PLATFORMS.has(platform)) {
      throw new DeveloperKeyFileError(
        'Private-key permissions cannot be verified on this platform.',
      );
    }
    assertPosixModePrivate(information.mode);
    return;
  }

  let stdout: string;
  try {
    stdout = await (dependencies.inspectWindowsAcl ?? inspectWindowsAcl)(
      target,
    );
  } catch {
    throw new DeveloperKeyFileError(
      'The Windows ACL could not be verified; refusing to access the private key.',
    );
  }
  assertWindowsAclPrivate(stdout);
}

export function assertPosixModePrivate(mode: number): void {
  if ((mode & 0o077) !== 0) {
    throw new DeveloperKeyFileError(
      'The private key path must not be accessible by group or others (use mode 600 for a file and 700 for its directory).',
    );
  }
}

export function assertWindowsAclPrivate(stdout: string): void {
  const lines = stdout
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line !== '');
  const ownerPattern = new RegExp(`^OWNER\\t(${SID})$`);
  const userPattern = new RegExp(`^USER\\t(${SID})$`);
  const acePattern = new RegExp(
    `^ACE\\t(${SID})\\t(Allow|Deny)\\t(\\d{1,10})\\t([01])$`,
  );
  const owner = ownerPattern.exec(lines[0] ?? '')?.[1];
  const user = userPattern.exec(lines[1] ?? '')?.[1];
  if (owner === undefined || user === undefined || lines.length < 3) {
    throw new DeveloperKeyFileError(
      'The Windows ACL inspection was malformed.',
    );
  }
  const allowed = new Set([user, ...TRUSTED_WINDOWS_SIDS]);
  if (!allowed.has(owner)) {
    throw new DeveloperKeyFileError(
      'The private key path is owned by an unapproved Windows principal.',
    );
  }
  for (const line of lines.slice(2)) {
    const match = acePattern.exec(line);
    if (match === null) {
      throw new DeveloperKeyFileError(
        'The Windows ACL inspection was malformed.',
      );
    }
    const [, principal, access, rawMask, inheritOnly] = match;
    const mask = Number(rawMask);
    if (
      access === 'Allow' &&
      inheritOnly !== '1' &&
      mask !== 0 &&
      principal !== undefined &&
      !allowed.has(principal)
    ) {
      throw new DeveloperKeyFileError(
        'The private key path grants access to an unapproved Windows principal.',
      );
    }
  }
}

async function inspectWindowsAcl(target: string): Promise<string> {
  const root = process.env.SystemRoot ?? process.env.windir;
  if (root === undefined || !path.isAbsolute(root)) {
    throw new DeveloperKeyFileError('Windows PowerShell is unavailable.');
  }
  const executable = path.join(
    root,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        WINDOWS_ACL_SCRIPT,
      ],
      {
        env: { ...process.env, VARDENA_DEVELOPER_KEY_PATH: target },
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, output) => {
        if (error !== null) reject(error);
        else resolve(output);
      },
    );
  });
}

/** Exclusive, fsynced write. Existing files are never overwritten. */
export async function writeExclusive(
  destination: string,
  content: string,
): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(destination, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new DeveloperKeyFileError(
        `Refusing to overwrite existing file: ${destination}`,
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
}
