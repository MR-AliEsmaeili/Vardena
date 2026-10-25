import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { SignerError } from "./errors.js";

/**
 * Private-key file privacy checks.
 *
 * POSIX exposes useful mode bits; NTFS does not. Node on Windows reports a
 * synthesized mode (commonly `100666`) regardless of the security descriptor,
 * so a mode check there rejects genuinely restricted keys and proves nothing
 * about the real ACL. Windows is therefore checked through the file's DACL,
 * and every other platform keeps the original mode check.
 */

const POSIX_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set<NodeJS.Platform>([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
]);

/**
 * Principals that are inherently able to take ownership of any local file.
 * They are trusted for key custody on a dedicated signing station; broad
 * principals such as Everyone, BUILTIN\Users and Authenticated Users are not.
 */
export const WINDOWS_TRUSTED_PRINCIPAL_SIDS: readonly string[] = Object.freeze([
  "S-1-5-18",
  "S-1-5-32-544",
]);

const WINDOWS_SID_PATTERN = /S-\d+(?:-\d+)+/;
const WINDOWS_OWNER_LINE_PATTERN = new RegExp(
  `^OWNER\\t(${WINDOWS_SID_PATTERN.source})$`,
);
const WINDOWS_USER_LINE_PATTERN = new RegExp(
  `^USER\\t(${WINDOWS_SID_PATTERN.source})$`,
);
const WINDOWS_ACE_LINE_PATTERN = new RegExp(
  `^ACE\\t(${WINDOWS_SID_PATTERN.source})\\t(Allow|Deny)\\t(\\d{1,10})\\t([01])\\t([01])$`,
);

const WINDOWS_ACL_INSPECTION_TIMEOUT_MS = 15_000;
const WINDOWS_ACL_INSPECTION_MAX_BUFFER = 1024 * 1024;

/**
 * Fixed, non-interpolated PowerShell. The key path is passed only through an
 * environment variable, so a path containing quotes, semicolons or `$()` is
 * never parsed as PowerShell syntax. `-NoProfile` prevents profile code and a
 * fixed System32 executable path prevents PATH hijacking.
 */
const WINDOWS_ACL_INSPECTION_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$keyPath = $env:VARDENA_SIGNER_KEY_PATH",
  "if ([string]::IsNullOrEmpty($keyPath)) { throw 'key path missing' }",
  "$acl = Get-Acl -LiteralPath $keyPath",
  "$ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
  "$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "Write-Output ('OWNER' + [char]9 + $ownerSid)",
  "Write-Output ('USER' + [char]9 + $userSid)",
  "foreach ($ace in $acl.Access) {",
  "  $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value",
  "  $mask = [int64]$ace.FileSystemRights",
  "  $inheritOnly = 0",
  "  if (($ace.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { $inheritOnly = 1 }",
  "  Write-Output ('ACE' + [char]9 + $sid + [char]9 + $ace.AccessControlType.ToString() + [char]9 + $mask + [char]9 + [int]$ace.IsInherited + [char]9 + $inheritOnly)",
  "}",
].join("\n");

const WINDOWS_ACL_INSPECTION_ARGUMENTS: readonly string[] = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  WINDOWS_ACL_INSPECTION_SCRIPT,
];

export interface WindowsAclAce {
  sid: string;
  accessType: "Allow" | "Deny";
  /** Numeric `FileSystemRights` bit mask. */
  mask: number;
  inherited: boolean;
  /**
   * True for an inheritance-only entry, which applies to child objects and
   * therefore grants nothing on the key file itself.
   */
  inheritOnly: boolean;
}

export interface WindowsAclInspection {
  /** Owner SID; the owner can rewrite the DACL and is therefore a trustee. */
  ownerSid: string;
  currentUserSid: string;
  aces: readonly WindowsAclAce[];
}

export interface WindowsAclCommandOptions {
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
  encoding: "utf8";
}

export type WindowsAclCommandRunner = (
  executable: string,
  args: readonly string[],
  options: WindowsAclCommandOptions,
) => Promise<{ stdout: string }>;

export interface WindowsAclInspectionDependencies {
  systemRoot?: string;
  runCommand?: WindowsAclCommandRunner;
}

export interface KeyPermissionDependencies {
  platform?: NodeJS.Platform;
  statFile?: (keyPath: string) => Promise<{ mode: number }>;
  inspectWindowsAcl?: (keyPath: string) => Promise<WindowsAclInspection>;
}

function aclVerificationError(reason: string): SignerError {
  return new SignerError(
    "key-unavailable",
    `The Windows ACL of the private key file could not be verified (${reason}); refusing to sign.`,
  );
}

function defaultWindowsAclCommand(
  executable: string,
  args: readonly string[],
  options: WindowsAclCommandOptions,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], options, (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve({ stdout });
    });
  });
}

/**
 * Parse the line-oriented output of the fixed inspection script. Any line that
 * is not exactly `OWNER<TAB>SID`, `USER<TAB>SID` or
 * `ACE<TAB>SID<TAB>Allow|Deny<TAB>mask<TAB>inherited<TAB>inheritOnly` is
 * malformed: accepting a partially understood ACL would defeat fail-closed.
 * The owner and the signing identity must both precede every ACE.
 */
export function parseWindowsAclInspection(
  stdout: unknown,
): WindowsAclInspection {
  if (typeof stdout !== "string") throw aclVerificationError("no output");
  const lines = stdout
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (lines.length === 0)
    throw aclVerificationError("no access rules were returned");

  let ownerSid: string | undefined;
  let currentUserSid: string | undefined;
  const aces: WindowsAclAce[] = [];

  for (const line of lines) {
    const ownerMatch = WINDOWS_OWNER_LINE_PATTERN.exec(line);
    if (ownerMatch !== null) {
      const sid = ownerMatch[1];
      if (sid === undefined) throw aclVerificationError("malformed owner line");
      if (ownerSid !== undefined)
        throw aclVerificationError("duplicate owner line");
      if (currentUserSid !== undefined || aces.length > 0)
        throw aclVerificationError("owner line is out of order");
      ownerSid = sid;
      continue;
    }

    const userMatch = WINDOWS_USER_LINE_PATTERN.exec(line);
    if (userMatch !== null) {
      const sid = userMatch[1];
      if (sid === undefined)
        throw aclVerificationError("malformed identity line");
      if (currentUserSid !== undefined)
        throw aclVerificationError("duplicate identity line");
      if (ownerSid === undefined || aces.length > 0)
        throw aclVerificationError("identity line is out of order");
      currentUserSid = sid;
      continue;
    }

    const aceMatch = WINDOWS_ACE_LINE_PATTERN.exec(line);
    if (aceMatch === null)
      throw aclVerificationError("malformed access-rule line");
    if (ownerSid === undefined || currentUserSid === undefined)
      throw aclVerificationError("access rules precede the signing identity");

    const sid = aceMatch[1];
    const accessType = aceMatch[2];
    const rawMask = aceMatch[3];
    const rawInherited = aceMatch[4];
    const rawInheritOnly = aceMatch[5];
    if (
      sid === undefined ||
      (accessType !== "Allow" && accessType !== "Deny") ||
      rawMask === undefined ||
      rawInherited === undefined ||
      rawInheritOnly === undefined
    )
      throw aclVerificationError("malformed access-rule line");

    const mask = Number(rawMask);
    if (!Number.isSafeInteger(mask) || mask < 0 || mask > 0xffffffff)
      throw aclVerificationError("invalid access mask");

    aces.push({
      sid,
      accessType,
      mask,
      inherited: rawInherited === "1",
      inheritOnly: rawInheritOnly === "1",
    });
  }

  if (ownerSid === undefined)
    throw aclVerificationError("the file owner was not identified");
  if (currentUserSid === undefined)
    throw aclVerificationError("the signing identity was not identified");
  if (aces.length === 0)
    throw aclVerificationError("no access rules were returned");
  return { ownerSid, currentUserSid, aces };
}

/**
 * Accept an allow ACE only for the signing operator, SYSTEM or Administrators.
 * The owner must be in the same set: the owner can rewrite the DACL. Deny
 * entries grant nothing; inheritance-only entries apply to children, not to the
 * key file. Inherited allow entries are otherwise treated exactly like
 * explicit ones, because they are effective permission on this file.
 */
export function assertWindowsAclPrivate(
  inspection: WindowsAclInspection,
): void {
  const allowed = new Set<string>([
    inspection.currentUserSid,
    ...WINDOWS_TRUSTED_PRINCIPAL_SIDS,
  ]);
  if (!allowed.has(inspection.ownerSid))
    throw new SignerError(
      "key-unavailable",
      "The Windows private key file is owned by an unapproved principal; only the signing operator, SYSTEM or Administrators may own it.",
    );
  for (const ace of inspection.aces) {
    if (ace.accessType !== "Allow") continue;
    if (ace.inheritOnly) continue;
    if (ace.mask === 0) continue;
    if (allowed.has(ace.sid)) continue;
    throw new SignerError(
      "key-unavailable",
      "The Windows ACL of the private key file grants access to an unapproved principal, including through inheritance; remove access for Everyone, Users, Authenticated Users, and every account other than the signing operator.",
    );
  }
}

/** Preserve the original restrictive POSIX mode check. */
export function assertPosixModePrivate(mode: number): void {
  if ((mode & 0o077) !== 0) {
    throw new SignerError(
      "key-unavailable",
      "The private key file must not be readable by group or others.",
    );
  }
}

/**
 * Read the real DACL through Windows PowerShell and return only the fields the
 * policy needs. A missing executable, non-zero exit, timeout, oversized output,
 * unresolved SID or unparsable line all throw `key-unavailable`.
 */
export async function inspectWindowsAcl(
  keyPath: string,
  dependencies: WindowsAclInspectionDependencies = {},
): Promise<WindowsAclInspection> {
  const systemRoot =
    dependencies.systemRoot ?? process.env.SystemRoot ?? process.env.windir;
  if (
    systemRoot === undefined ||
    systemRoot.trim() === "" ||
    !path.isAbsolute(systemRoot)
  )
    throw aclVerificationError("Windows PowerShell is unavailable");

  const executable = path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

  let result: { stdout: string };
  try {
    result = await (dependencies.runCommand ?? defaultWindowsAclCommand)(
      executable,
      WINDOWS_ACL_INSPECTION_ARGUMENTS,
      {
        env: {
          ...process.env,
          VARDENA_SIGNER_KEY_PATH: keyPath,
        },
        timeout: WINDOWS_ACL_INSPECTION_TIMEOUT_MS,
        maxBuffer: WINDOWS_ACL_INSPECTION_MAX_BUFFER,
        windowsHide: true,
        encoding: "utf8",
      },
    );
  } catch {
    throw aclVerificationError("the ACL inspection command failed");
  }

  return parseWindowsAclInspection(result.stdout);
}

/**
 * Refuse a key file that the signing operator cannot keep private.
 *
 * POSIX: no group/other permission bit may be set.
 * Windows: the effective DACL may grant access only to the current user,
 * SYSTEM or Administrators (see `assertWindowsAclPrivate`).
 * Every other platform and every inspection failure refuses the key.
 */
export async function assertKeyFilePrivate(
  keyPath: string,
  dependencies: KeyPermissionDependencies = {},
): Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "win32" && !POSIX_PLATFORMS.has(platform)) {
    throw new SignerError(
      "key-unavailable",
      "The private key file permission check is unsupported on this platform; refusing to sign.",
    );
  }

  let info: { mode: number };
  try {
    info = await (dependencies.statFile ?? stat)(keyPath);
  } catch {
    throw new SignerError(
      "key-unavailable",
      "The private key file is missing.",
    );
  }

  if (platform === "win32") {
    let inspection: WindowsAclInspection;
    try {
      inspection = await (dependencies.inspectWindowsAcl ?? inspectWindowsAcl)(
        keyPath,
      );
    } catch (error) {
      if (error instanceof SignerError) throw error;
      throw aclVerificationError("the ACL inspection failed");
    }
    assertWindowsAclPrivate(inspection);
    return;
  }

  assertPosixModePrivate(info.mode);
}
