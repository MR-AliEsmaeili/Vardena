#!/usr/bin/env node
import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { deriveKeyId, parsePrivateKey } from "../protocol.js";
import {
  assertKeyFilePrivate,
  assertSignerEnvironment,
  SignerError,
} from "./signer.js";

/** Print public metadata for an existing private key without printing its contents. */
async function main(): Promise<void> {
  assertSignerEnvironment();
  const argv = process.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== "--key" || !argv[1]) {
    throw new SignerError(
      "request-malformed",
      "Usage: node dist-signer/signer/key-info.js --key <private-key-file>",
    );
  }
  const keyPath = path.resolve(argv[1]);
  await assertKeyFilePrivate(keyPath);
  let privateKey;
  try {
    privateKey = parsePrivateKey(await readFile(keyPath, "utf8"));
  } catch {
    throw new SignerError(
      "key-unavailable",
      "The private key file is unreadable or invalid.",
    );
  }
  if (privateKey.type !== "private") {
    throw new SignerError(
      "key-unavailable",
      "The supplied key is not a private key.",
    );
  }
  const publicKey = createPublicKey(privateKey);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        keyId: deriveKeyId(publicKey),
        publicKeySpkiBase64: publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64"),
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error: unknown) => {
  if (error instanceof SignerError) {
    process.stderr.write(
      "refused\t" + error.code + "\t" + error.message + "
",
    );
    process.exit(error.exitCode);
  }
  process.stderr.write(
    "refused\tsigner-failure\tKey inspection failed.
",
  );
  process.exit(2);
});
