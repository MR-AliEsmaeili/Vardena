#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { mkdir, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { deriveKeyId } from "../protocol.js";
import { assertKeyFilePrivate, assertSignerEnvironment, SignerError } from "./signer.js";

/**
 * Generate an Ed25519 signing key for the offline Vardena signer.
 * The output directory must already be private; it is checked before any
 * key material is generated or written. Existing files are never overwritten.
 */

function parseOutDir(argv: string[]): string {
  if (argv.length !== 2 || argv[0] !== "--out-dir" || !argv[1]) {
    throw new SignerError(
      "request-malformed",
      "Usage: node dist-signer/signer/keygen.js --out-dir <existing-private-directory>",
    );
  }
  const outDir = path.resolve(argv[1]);
  if (!path.isAbsolute(outDir)) {
    throw new SignerError("key-unavailable", "The output directory must be absolute.");
  }
  return outDir;
}

async function main(): Promise<void> {
  assertSignerEnvironment();
  const outDir = parseOutDir(process.argv.slice(2));
  const info = await stat(outDir).catch(() => null);
  if (info === null || !info.isDirectory()) {
    throw new SignerError("key-unavailable", "The output directory does not exist.");
  }

  // Validate the directory's own access policy before creating key material.
  await assertKeyFilePrivate(outDir);

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateMaterial = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const publicMaterial = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const keyId = deriveKeyId(publicKey);
  const privatePath = path.join(outDir, "key.pkcs8");
  const publicPath = path.join(outDir, "public-key.txt");
  const infoPath = path.join(outDir, "key-info.json");

  // Exclusive creation prevents accidental replacement of an existing authority.
  await writeFile(privatePath, `${privateMaterial}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  try {
    // Verify the newly-created key file before writing any public metadata.
    await assertKeyFilePrivate(privatePath);
    await writeFile(publicPath, `${publicMaterial}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      infoPath,
      `${JSON.stringify({ keyId, publicKeySpkiBase64: publicMaterial }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    // Never leave a private key behind if its access policy cannot be verified.
    await unlink(privatePath).catch(() => undefined);
    await unlink(publicPath).catch(() => undefined);
    await unlink(infoPath).catch(() => undefined);
    throw error;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        keyId,
        publicKeySpkiBase64: publicMaterial,
        privateKeyPath: privatePath,
        publicKeyPath: publicPath,
        infoPath,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof SignerError) {
    process.stderr.write(`refused\\t${error.code}\\t${error.message}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write("refused\\tsigner-failure\\tKey generation failed.\n");
  process.exit(2);
});
