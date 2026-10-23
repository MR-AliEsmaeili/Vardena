import {
  chmodSync,
  statSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveKeyId, parsePrivateKey } from "../src/protocol.js";

const temporaryDirectories: string[] = [];
const sourceDirectory = path.resolve("src", "signer");

function makeDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "vardena-keygen-"));
  temporaryDirectories.push(directory);
  if (process.platform === "win32") {
    const sid = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    const acl = spawnSync(
      "icacls.exe",
      [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)(F)`],
      { encoding: "utf8" },
    );
    if (acl.status !== 0)
      throw new Error(`Could not restrict test directory: ${acl.stderr}`);
  } else {
    chmodSync(directory, 0o700);
  }
  return directory;
}

function cleanSignerEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OWNER_DATABASE_URL;
  delete env.OWNER_PUBLIC_ORIGIN;
  if (env.NODE_ENV === "production") env.NODE_ENV = "test";
  return env;
}

function runCli(file: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", path.join(sourceDirectory, file), ...args],
    {
      cwd: process.cwd(),
      env: cleanSignerEnvironment(),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("offline signer key utility CLIs", () => {
  it("generates a usable Ed25519 key and refuses to overwrite existing artifacts", () => {
    const directory = makeDirectory();
    const result = runCli("keygen.ts", ["--out-dir", directory]);
    expect(result.status, result.stderr).toBe(0);
    const metadata = JSON.parse(result.stdout) as {
      ok: boolean;
      keyId: string;
      publicKeySpkiBase64: string;
    };
    expect(metadata.ok).toBe(true);
    expect(metadata.keyId).toMatch(/^sha256-[0-9a-f]{16}$/);
    expect(metadata.publicKeySpkiBase64).toBeTruthy();
    expect(metadata.keyId).toBe(
      deriveKeyId(
        createPublicKey(
          parsePrivateKey(
            readFileSync(path.join(directory, "key.pkcs8"), "utf8"),
          ),
        ),
      ),
    );
    if (process.platform !== "win32") {
      expect(statSync(path.join(directory, "key.pkcs8")).mode & 0o077).toBe(0);
    }
    expect(readdirSync(directory).sort()).toEqual([
      "key-info.json",
      "key.pkcs8",
      "public-key.txt",
    ]);
    expect(
      readFileSync(path.join(directory, "key.pkcs8"), "utf8").trim(),
    ).toBeTruthy();

    const keyInfoBefore = readFileSync(
      path.join(directory, "key-info.json"),
      "utf8",
    );
    const retry = runCli("keygen.ts", ["--out-dir", directory]);
    expect(retry.status).not.toBe(0);
    expect(retry.stderr).toContain(
      "Refusing to overwrite an existing key artifact",
    );
    expect(readFileSync(path.join(directory, "key-info.json"), "utf8")).toBe(
      keyInfoBefore,
    );
    expect(readdirSync(directory).sort()).toEqual([
      "key-info.json",
      "key.pkcs8",
      "public-key.txt",
    ]);
  });

  it("prints only public metadata when inspecting an existing private key", () => {
    const directory = makeDirectory();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privatePath = path.join(directory, "key.pkcs8");
    writeFileSync(
      privatePath,
      privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") +
        "\n",
      { mode: 0o600 },
    );
    chmodSync(privatePath, 0o600);

    const result = runCli("key-info.ts", ["--key", privatePath]);
    expect(result.status, result.stderr).toBe(0);
    const metadata = JSON.parse(result.stdout) as {
      keyId: string;
      publicKeySpkiBase64: string;
    };
    expect(metadata.keyId).toBe(deriveKeyId(publicKey));
    expect(metadata.publicKeySpkiBase64).toBe(
      publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    );
    expect(result.stdout).not.toContain(
      privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    );
    expect(parsePrivateKey(readFileSync(privatePath, "utf8")).type).toBe(
      "private",
    );
  });
  it("preserves pre-existing artifacts when generation is refused", () => {
    const directory = makeDirectory();
    writeFileSync(
      path.join(directory, "public-key.txt"),
      "previous public key",
      { mode: 0o600 },
    );
    const result = runCli("keygen.ts", ["--out-dir", directory]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(directory, "public-key.txt"), "utf8")).toBe(
      "previous public key",
    );
    expect(readdirSync(directory)).toEqual(["public-key.txt"]);
  });

  it("refuses malformed, public-only, and missing key files without leaking material", () => {
    const directory = makeDirectory();
    const file = path.join(directory, "key.pkcs8");
    for (const content of [
      "invalid private material",
      generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ format: "der", type: "pkcs8" })
        .toString("base64"),
      generateKeyPairSync("ed25519")
        .publicKey.export({ format: "der", type: "spki" })
        .toString("base64"),
    ]) {
      writeFileSync(file, content, { mode: 0o600 });
      if (process.platform !== "win32") chmodSync(file, 0o600);
      const result = runCli("key-info.ts", ["--key", file]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain(content);
    }
    rmSync(file);
    expect(runCli("key-info.ts", ["--key", file]).status).not.toBe(0);
  });

  it("rejects unexpected and repeated signer CLI arguments before reading a key", () => {
    const directory = makeDirectory();
    for (const args of [
      ["--unexpected", "x"],
      ["--request", "one", "--request", "two"],
      ["stray"],
    ]) {
      const result = runCli("cli.ts", ["sign-license", ...args]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("request-malformed");
      expect(readdirSync(directory)).toEqual([]);
    }
  });

  it("does not bypass the offline environment guard", () => {
    const directory = makeDirectory();
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(sourceDirectory, "keygen.ts"),
        "--out-dir",
        directory,
      ],
      {
        cwd: process.cwd(),
        env: { ...cleanSignerEnvironment(), OWNER_DATABASE_URL: "unsafe" },
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unsafe-environment");
    expect(readdirSync(directory)).toEqual([]);
  });
});
