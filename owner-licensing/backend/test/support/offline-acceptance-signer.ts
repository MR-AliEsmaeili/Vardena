// Disposable offline acceptance signer. It is spawned as a separate Node
// process and receives no database URLs or production application config.
import { createInterface } from "node:readline";
import { generateKeyPairSync } from "node:crypto";
import {
  canonicalizeLicenseVersion,
  deriveKeyId,
  licenseFileEnvelope,
  parseLicenseVersionPayload,
  type LicenseVersionPayload,
  signLicenseVersion,
} from "../../src/protocol.js";
import {
  signLicenseRequest,
  signRevocationRequest,
} from "../../src/signer/signer.js";

const pair = generateKeyPairSync("ed25519");
const keyId = deriveKeyId(pair.publicKey);
const publicMaterial = Buffer.from(
  pair.publicKey.export({ format: "der", type: "spki" }),
).toString("base64");
const now = new Date("2026-10-22T12:00:00.000Z");

function reply(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

reply({ type: "ready", keyId, publicMaterial });

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    const message = JSON.parse(line) as Record<string, unknown>;
    const action = message.action;
    if (action === "license") {
      const result = await signLicenseRequest({
        requestContent: String(message.requestContent),
        expectedDigest: String(message.expectedDigest),
        keyId,
        loadPrivateKey: () => pair.privateKey,
        now,
      });
      reply({ ok: true, result });
      continue;
    }
    if (action === "revocation") {
      const result = await signRevocationRequest({
        requestContent: String(message.requestContent),
        expectedDigest: String(message.expectedDigest),
        keyId,
        loadPrivateKey: () => pair.privateKey,
        now,
      });
      reply({ ok: true, result });
      continue;
    }
    if (action === "payload" || action === "rogue-payload") {
      const canonicalPayload = canonicalizeLicenseVersion(
        message.payload as LicenseVersionPayload,
      );
      const payload = parseLicenseVersionPayload(JSON.parse(canonicalPayload));
      const signingKey =
        action === "payload"
          ? pair.privateKey
          : generateKeyPairSync("ed25519").privateKey;
      const document = signLicenseVersion(payload, signingKey);
      reply({
        ok: true,
        envelope: licenseFileEnvelope(document, keyId),
      });
      continue;
    }
    throw new Error("Unknown offline signer operation.");
  } catch (error) {
    reply({
      ok: false,
      error: error instanceof Error ? error.message : "Offline signer failed.",
    });
  }
}
