import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SignerError } from "../src/signer/errors.js";
import {
  assertKeyFilePrivate,
  assertPosixModePrivate,
  assertWindowsAclPrivate,
  inspectWindowsAcl,
  parseWindowsAclInspection,
  WINDOWS_TRUSTED_PRINCIPAL_SIDS,
  type WindowsAclAce,
  type WindowsAclInspection,
} from "../src/signer/key-permissions.js";

// Well-known SIDs, not account names: the check must not depend on the
// display language of a Windows installation.
const CURRENT_USER = "S-1-5-21-1111111111-2222222222-3333333333-1001";
const EVERYONE = "S-1-1-0";
const USERS = "S-1-5-32-545";
const AUTHENTICATED_USERS = "S-1-5-11";
const GUESTS = "S-1-5-32-546";
const INTERACTIVE = "S-1-5-4";
const SYSTEM = "S-1-5-18";
const ADMINISTRATORS = "S-1-5-32-544";

function ace(overrides: Partial<WindowsAclAce> = {}): WindowsAclAce {
  return {
    sid: CURRENT_USER,
    accessType: "Allow",
    mask: 0x1f01ff,
    inherited: false,
    inheritOnly: false,
    ...overrides,
  };
}

function inspection(
  aces: readonly WindowsAclAce[] = [ace()],
  currentUserSid = CURRENT_USER,
  ownerSid = CURRENT_USER,
): WindowsAclInspection {
  return { ownerSid, currentUserSid, aces };
}

function aclOutput(
  aces: readonly WindowsAclAce[] = [ace()],
  currentUserSid = CURRENT_USER,
  ownerSid = CURRENT_USER,
): string {
  return [
    `OWNER\t${ownerSid}`,
    `USER\t${currentUserSid}`,
    ...aces.map(
      (entry) =>
        `ACE\t${entry.sid}\t${entry.accessType}\t${entry.mask}\t${entry.inherited ? 1 : 0}\t${entry.inheritOnly ? 1 : 0}`,
    ),
  ].join("\r\n");
}

function commandRunner(stdout: unknown) {
  return async () => ({ stdout: stdout as string });
}

function rejectingRunner() {
  return async () => {
    throw new Error("inspection command failed");
  };
}

describe("offline signer — POSIX key permissions", () => {
  it("accepts a key readable and writable only by its owner", async () => {
    let inspected = false;
    await expect(
      assertKeyFilePrivate("/keys/authority.pkcs8", {
        platform: "linux",
        statFile: async () => ({ mode: 0o100600 }),
        inspectWindowsAcl: async () => {
          inspected = true;
          return inspection();
        },
      }),
    ).resolves.toBeUndefined();
    expect(inspected).toBe(false);
  });

  it.each([0o100644, 0o100640, 0o100604, 0o100660, 0o100601])(
    "rejects insecure mode %s",
    async (mode) => {
      await expect(
        assertKeyFilePrivate("/keys/authority.pkcs8", {
          platform: "linux",
          statFile: async () => ({ mode }),
        }),
      ).rejects.toMatchObject({ code: "key-unavailable", exitCode: 3 });
    },
  );

  it("checks the group and other bits, not the file-type bits", () => {
    expect(() => assertPosixModePrivate(0o100400)).not.toThrow();
    expect(() => assertPosixModePrivate(0o100600)).not.toThrow();
    expect(() => assertPosixModePrivate(0o100700)).not.toThrow();
    expect(() => assertPosixModePrivate(0o100610)).toThrow(SignerError);
  });

  it("reports a missing key without consulting the Windows inspector", async () => {
    let inspected = false;
    await expect(
      assertKeyFilePrivate("/keys/missing.pkcs8", {
        platform: "linux",
        statFile: async () => {
          throw new Error("ENOENT");
        },
        inspectWindowsAcl: async () => {
          inspected = true;
          return inspection();
        },
      }),
    ).rejects.toThrow("The private key file is missing.");
    expect(inspected).toBe(false);
  });
});

describe("offline signer — Windows ACL policy", () => {
  it("accepts the signing operator, SYSTEM and Administrators", () => {
    expect(() =>
      assertWindowsAclPrivate(
        inspection([
          ace({ sid: CURRENT_USER }),
          ace({ sid: SYSTEM }),
          ace({ sid: ADMINISTRATORS }),
        ]),
      ),
    ).not.toThrow();
    expect(WINDOWS_TRUSTED_PRINCIPAL_SIDS).toEqual([SYSTEM, ADMINISTRATORS]);
  });

  it.each([
    ["Everyone", EVERYONE],
    ["BUILTIN\\Users", USERS],
    ["Authenticated Users", AUTHENTICATED_USERS],
    ["Guests", GUESTS],
    ["INTERACTIVE", INTERACTIVE],
  ])("rejects an explicit grant to %s", (_label, sid) => {
    expect(() =>
      assertWindowsAclPrivate(inspection([ace(), ace({ sid })])),
    ).toThrow(SignerError);
  });

  it("rejects an inherited grant to a broad principal", () => {
    expect(() =>
      assertWindowsAclPrivate(
        inspection([ace(), ace({ sid: USERS, inherited: true })]),
      ),
    ).toThrow(SignerError);
  });

  it("ignores deny entries, which grant nothing", () => {
    expect(() =>
      assertWindowsAclPrivate(
        inspection([
          ace(),
          ace({ sid: EVERYONE, accessType: "Deny" }),
          ace({ sid: USERS, accessType: "Deny", inherited: true }),
        ]),
      ),
    ).not.toThrow();
  });

  it("ignores inheritance-only entries, which do not apply to the key file", () => {
    expect(() =>
      assertWindowsAclPrivate(
        inspection([ace(), ace({ sid: USERS, inheritOnly: true })]),
      ),
    ).not.toThrow();
  });

  it("rejects any other principal, including an unresolved SID", () => {
    expect(() =>
      assertWindowsAclPrivate(
        inspection([ace(), ace({ sid: "S-1-5-21-9-9-9-9999" })]),
      ),
    ).toThrow(SignerError);
  });

  it("rejects a file owned by an unapproved principal", () => {
    expect(() =>
      assertWindowsAclPrivate(inspection([ace()], CURRENT_USER, USERS)),
    ).toThrow(SignerError);
  });

  it("accepts SYSTEM or Administrators as owner", () => {
    for (const ownerSid of [SYSTEM, ADMINISTRATORS]) {
      expect(() =>
        assertWindowsAclPrivate(inspection([ace()], CURRENT_USER, ownerSid)),
      ).not.toThrow();
    }
  });

  it("accepts a restricted ACL even when stat reports 100666", async () => {
    // This is the reported NTFS behaviour. The old mode check rejected it.
    await expect(
      assertKeyFilePrivate("C:\\keys\\authority.pkcs8", {
        platform: "win32",
        statFile: async () => ({ mode: 0o100666 }),
        inspectWindowsAcl: async () => inspection(),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a Windows key whose ACL inspection fails", async () => {
    await expect(
      assertKeyFilePrivate("C:\\keys\\authority.pkcs8", {
        platform: "win32",
        statFile: async () => ({ mode: 0o100666 }),
        inspectWindowsAcl: async () => {
          throw new Error("access denied");
        },
      }),
    ).rejects.toMatchObject({ code: "key-unavailable", exitCode: 3 });
  });

  it("rejects a Windows key whose ACL policy fails", async () => {
    await expect(
      assertKeyFilePrivate("C:\\keys\\authority.pkcs8", {
        platform: "win32",
        statFile: async () => ({ mode: 0o100666 }),
        inspectWindowsAcl: async () =>
          inspection([ace(), ace({ sid: AUTHENTICATED_USERS })]),
      }),
    ).rejects.toMatchObject({ code: "key-unavailable", exitCode: 3 });
  });

  it("fails closed on an unsupported platform before touching the file", async () => {
    let inspected = false;
    await expect(
      assertKeyFilePrivate("/keys/authority.pkcs8", {
        platform: "cygwin",
        statFile: async () => ({ mode: 0o100600 }),
        inspectWindowsAcl: async () => {
          inspected = true;
          return inspection();
        },
      }),
    ).rejects.toMatchObject({ code: "key-unavailable", exitCode: 3 });
    expect(inspected).toBe(false);
  });
});

describe("offline signer — Windows ACL inspection", () => {
  it("parses a valid inspection, including CRLF and a UTF-8 BOM", () => {
    const parsed = parseWindowsAclInspection(
      `\uFEFF${aclOutput([
        ace({ sid: CURRENT_USER }),
        ace({ sid: USERS, inherited: true }),
      ])}`,
    );
    expect(parsed.ownerSid).toBe(CURRENT_USER);
    expect(parsed.currentUserSid).toBe(CURRENT_USER);
    expect(parsed.aces).toHaveLength(2);
    expect(parsed.aces[1]).toMatchObject({
      sid: USERS,
      inherited: true,
      mask: 2032127,
    });
  });

  const header = `OWNER\t${CURRENT_USER}\r\nUSER\t${CURRENT_USER}`;
  it.each([
    ["empty output", ""],
    ["garbage", "Access is denied."],
    [
      "missing owner",
      `USER\t${CURRENT_USER}\r\nACE\t${CURRENT_USER}\tAllow\t1\t0\t0`,
    ],
    [
      "missing identity",
      `OWNER\t${CURRENT_USER}\r\nACE\t${CURRENT_USER}\tAllow\t1\t0\t0`,
    ],
    [
      "owner after identity",
      `USER\t${CURRENT_USER}\r\nOWNER\t${CURRENT_USER}\r\nACE\t${CURRENT_USER}\tAllow\t1\t0\t0`,
    ],
    [
      "duplicate owner",
      `OWNER\t${CURRENT_USER}\r\nOWNER\t${CURRENT_USER}\r\n${header}\r\nACE\t${CURRENT_USER}\tAllow\t1\t0\t0`,
    ],
    [
      "duplicate identity",
      `${header}\r\nUSER\t${CURRENT_USER}\r\nACE\t${CURRENT_USER}\tAllow\t1\t0\t0`,
    ],
    [
      "access rule before identity",
      `OWNER\t${CURRENT_USER}\r\nACE\t${CURRENT_USER}\tAllow\t1\t0\t0`,
    ],
    ["no access rules", header],
    [
      "unknown access type",
      `${header}\r\nACE\t${CURRENT_USER}\tAudit\t1\t0\t0`,
    ],
    [
      "non-numeric mask",
      `${header}\r\nACE\t${CURRENT_USER}\tAllow\tread\t0\t0`,
    ],
    ["negative mask", `${header}\r\nACE\t${CURRENT_USER}\tAllow\t-1\t0\t0`],
    [
      "oversized mask",
      `${header}\r\nACE\t${CURRENT_USER}\tAllow\t4294967296\t0\t0`,
    ],
    ["bad inherited flag", `${header}\r\nACE\t${CURRENT_USER}\tAllow\t1\t2\t0`],
    ["extra field", `${header}\r\nACE\t${CURRENT_USER}\tAllow\t1\t0\t0\textra`],
    [
      "bad owner SID",
      `OWNER\tS-1-5-NOT-A-SID\r\n${header}\r\nACE\t${CURRENT_USER}\tAllow\t1\t0\t0`,
    ],
    ["bad ACE SID", `${header}\r\nACE\tS-1-5-NOT-A-SID\tAllow\t1\t0\t0`],
    ["non-string output", 42],
  ])("fails closed on %s", (_label, output) => {
    expect(() => parseWindowsAclInspection(output)).toThrow(SignerError);
  });

  it("passes the key path only through an environment variable", async () => {
    // The fake runner means no Windows API is touched; keep the system root
    // absolute for the host running the suite so the path check is exercised
    // on Linux CI as well as on Windows.
    const systemRoot =
      process.platform === "win32" ? "C:\\Windows" : "/opt/windows";
    const calls: Array<{
      executable: string;
      args: readonly string[];
      options: {
        env: NodeJS.ProcessEnv;
        timeout: number;
        maxBuffer: number;
        windowsHide: boolean;
        encoding: "utf8";
      };
    }> = [];
    const dangerousPath =
      'C:\\keys\\authority"; Remove-Item -Recurse C:\\; #.pkcs8';
    const runner = async (
      executable: string,
      args: readonly string[],
      options: {
        env: NodeJS.ProcessEnv;
        timeout: number;
        maxBuffer: number;
        windowsHide: boolean;
        encoding: "utf8";
      },
    ) => {
      calls.push({ executable, args, options });
      return { stdout: aclOutput() };
    };

    const parsed = await inspectWindowsAcl(dangerousPath, {
      systemRoot,
      runCommand: runner,
    });

    expect(parsed.currentUserSid).toBe(CURRENT_USER);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.executable).toBe(
      path.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
    );
    expect(call?.args).toContain("-NoProfile");
    expect(call?.args).toContain("-NonInteractive");
    expect(call?.args.join(" ")).not.toContain("Remove-Item");
    expect(call?.args.join(" ")).not.toContain("authority");
    expect(call?.options.env.VARDENA_SIGNER_KEY_PATH).toBe(dangerousPath);
    expect(call?.options.windowsHide).toBe(true);
    expect(call?.options.encoding).toBe("utf8");
  });

  it("fails closed when the inspection command fails", async () => {
    await expect(
      inspectWindowsAcl("C:\\keys\\authority.pkcs8", {
        systemRoot: "C:\\Windows",
        runCommand: rejectingRunner(),
      }),
    ).rejects.toMatchObject({ code: "key-unavailable" });
  });

  it("fails closed on malformed command output", async () => {
    await expect(
      inspectWindowsAcl("C:\\keys\\authority.pkcs8", {
        systemRoot: "C:\\Windows",
        runCommand: commandRunner("partial output"),
      }),
    ).rejects.toMatchObject({ code: "key-unavailable" });
  });

  it("fails closed when Windows PowerShell is not locatable", async () => {
    await expect(
      inspectWindowsAcl("C:\\keys\\authority.pkcs8", {
        systemRoot: "relative-path",
        runCommand: commandRunner(aclOutput()),
      }),
    ).rejects.toMatchObject({ code: "key-unavailable" });
    await expect(
      inspectWindowsAcl("C:\\keys\\authority.pkcs8", {
        systemRoot: "",
        runCommand: commandRunner(aclOutput()),
      }),
    ).rejects.toMatchObject({ code: "key-unavailable" });
  });
});

const windowsOnly = describe.runIf(process.platform === "win32");

windowsOnly("offline signer — real Windows NTFS ACLs", () => {
  const powershell = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function tempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "owner-signer-acl-"));
    tempDirs.push(dir);
    return dir;
  }

  function runPowerShell(script: string, env: Record<string, string>): void {
    execFileSync(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: { ...process.env, ...env },
        windowsHide: true,
        stdio: "pipe",
      },
    );
  }

  function currentUserSid(): string {
    return execFileSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
  }

  function setFileAcl(
    target: string,
    ownerSid: string,
    broadSid?: string,
  ): void {
    runPowerShell(
      [
        "$ErrorActionPreference = 'Stop'",
        "$acl = [System.Security.AccessControl.FileSecurity]::new()",
        "$acl.SetAccessRuleProtection($true, $false)",
        "$owner = [System.Security.Principal.SecurityIdentifier]::new($env:VARDENA_TEST_OWNER_SID)",
        "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($owner, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow))",
        "if (-not [string]::IsNullOrEmpty($env:VARDENA_TEST_BROAD_SID)) {",
        "  $broad = [System.Security.Principal.SecurityIdentifier]::new($env:VARDENA_TEST_BROAD_SID)",
        "  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($broad, [System.Security.AccessControl.FileSystemRights]::Read, [System.Security.AccessControl.AccessControlType]::Allow))",
        "}",
        "Set-Acl -LiteralPath $env:VARDENA_TEST_PATH -AclObject $acl",
      ].join("\n"),
      {
        VARDENA_TEST_PATH: target,
        VARDENA_TEST_OWNER_SID: ownerSid,
        ...(broadSid === undefined ? {} : { VARDENA_TEST_BROAD_SID: broadSid }),
      },
    );
  }

  function setDirectoryAcl(
    target: string,
    ownerSid: string,
    broadSid: string,
  ): void {
    runPowerShell(
      [
        "$ErrorActionPreference = 'Stop'",
        "$acl = [System.Security.AccessControl.DirectorySecurity]::new()",
        "$acl.SetAccessRuleProtection($true, $false)",
        "$inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'",
        "$propagation = [System.Security.AccessControl.PropagationFlags]::None",
        "$owner = [System.Security.Principal.SecurityIdentifier]::new($env:VARDENA_TEST_OWNER_SID)",
        "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($owner, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $propagation, [System.Security.AccessControl.AccessControlType]::Allow))",
        "$broad = [System.Security.Principal.SecurityIdentifier]::new($env:VARDENA_TEST_BROAD_SID)",
        "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($broad, [System.Security.AccessControl.FileSystemRights]::Read, $inheritance, $propagation, [System.Security.AccessControl.AccessControlType]::Allow))",
        "Set-Acl -LiteralPath $env:VARDENA_TEST_PATH -AclObject $acl",
      ].join("\n"),
      {
        VARDENA_TEST_PATH: target,
        VARDENA_TEST_OWNER_SID: ownerSid,
        VARDENA_TEST_BROAD_SID: broadSid,
      },
    );
  }

  it("accepts a genuinely restricted key even though stat reports 100666", async () => {
    const dir = tempDir();
    const file = path.join(dir, "authority.pkcs8");
    writeFileSync(file, "test-only placeholder, not key material\n", {
      mode: 0o600,
    });
    setFileAcl(file, currentUserSid());

    // The reported NTFS mode is why the old group/other check could not work.
    expect(statSync(file).mode & 0o077).not.toBe(0);
    await expect(assertKeyFilePrivate(file)).resolves.toBeUndefined();
  });

  it("rejects an explicit grant to BUILTIN\\Users", async () => {
    const dir = tempDir();
    const file = path.join(dir, "authority.pkcs8");
    writeFileSync(file, "test-only placeholder, not key material\n");
    setFileAcl(file, currentUserSid(), USERS);

    await expect(assertKeyFilePrivate(file)).rejects.toMatchObject({
      code: "key-unavailable",
    });
  });

  it("rejects inherited access for BUILTIN\\Users", async () => {
    const dir = tempDir();
    setDirectoryAcl(dir, currentUserSid(), USERS);
    const file = path.join(dir, "authority.pkcs8");
    writeFileSync(file, "test-only placeholder, not key material\n");

    await expect(assertKeyFilePrivate(file)).rejects.toMatchObject({
      code: "key-unavailable",
    });
  });
});
