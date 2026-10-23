import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveKeyId, parsePrivateKey } from "../src/protocol.js";

const temporaryDirectories: string[] = [];
const sourceDirectory = path.resolve("src", "signer");

function makeDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "vardena-keygen-"));
  temporaryDirectories.push(directory);
  chmodSync(directory, 0o700);
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
  it.skipIf(process.platform === "win32")(
    "generates a usable Ed25519 key and refuses to overwrite existing artifacts",
    () => {
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
    },
  );

  it.skipIf(process.platform === "win32")(
    "prints only public metadata when inspecting an existing private key",
    () => {
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
    },
  );
});
