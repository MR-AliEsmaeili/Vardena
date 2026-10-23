#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { deriveKeyId } from "../protocol.js";
import {
  assertKeyFilePrivate,
  assertSignerEnvironment,
  SignerError,
} from "./signer.js";

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
  const privateMaterial = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64");
  const publicMaterial = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const keyId = deriveKeyId(publicKey);
  const privatePath = path.join(outDir, "key.pkcs8");
  const publicPath = path.join(outDir, "public-key.txt");
  const infoPath = path.join(outDir, "key-info.json");

  // Preflight every destination before writing. Never overwrite or delete
  // artifacts that may belong to a previous key operation.
  for (const destination of [privatePath, publicPath, infoPath]) {
    const existing = await stat(destination).catch(() => null);
    if (existing !== null) {
      throw new SignerError(
        "key-unavailable",
        "Refusing to overwrite an existing key artifact: " +
          path.basename(destination) +
          ".",
      );
    }
  }

  let privateCreated = false;
  let publicCreated = false;
  let infoCreated = false;
  try {
    // Exclusive open prevents races from replacing an existing artifact.
    const privateHandle = await open(privatePath, "wx", 0o600);
    privateCreated = true;
    try {
      await privateHandle.writeFile(privateMaterial + "\n", "utf8");
      await privateHandle.sync();
    } finally {
      await privateHandle.close();
    }

    // Verify the newly-created key file before writing any public metadata.
    await assertKeyFilePrivate(privatePath);

    const publicHandle = await open(publicPath, "wx", 0o600);
    publicCreated = true;
    try {
      await publicHandle.writeFile(publicMaterial + "\n", "utf8");
      await publicHandle.sync();
    } finally {
      await publicHandle.close();
    }

    const infoHandle = await open(infoPath, "wx", 0o600);
    infoCreated = true;
    try {
      await infoHandle.writeFile(
        JSON.stringify({ keyId, publicKeySpkiBase64: publicMaterial }, null, 2) + "\n",
        "utf8",
      );
      await infoHandle.sync();
    } finally {
      await infoHandle.close();
    }
  } catch (error) {
    // Remove only files this invocation actually created.
    if (privateCreated) await unlink(privatePath).catch(() => undefined);
    if (publicCreated) await unlink(publicPath).catch(() => undefined);
    if (infoCreated) await unlink(infoPath).catch(() => undefined);
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
    process.stderr.write(`refused\t${error.code}\\t${error.message}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write("refused\tsigner-failure\\tKey generation failed.\n");
  process.exit(2);
});
