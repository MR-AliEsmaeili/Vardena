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

function reply(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function signingTime(value: unknown): Date {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("The acceptance signer requires the fixed test clock.");
  }
  return date;
}

function revivePayloadDates(value: unknown): LicenseVersionPayload {
  if (value === null || typeof value !== "object") {
    throw new Error("The acceptance signer requires a license payload.");
  }
  const payload = value as Record<string, unknown>;
  const validFrom = signingTime(payload.validFrom);
  const issuedAt = signingTime(payload.issuedAt);
  const validUntil =
    payload.validUntil === null ? null : signingTime(payload.validUntil);
  return {
    ...(payload as unknown as LicenseVersionPayload),
    validFrom,
    validUntil,
    issuedAt,
  };
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
        now: signingTime(message.now),
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
        now: signingTime(message.now),
      });
      reply({ ok: true, result });
      continue;
    }
    if (action === "payload" || action === "rogue-payload") {
      const canonicalPayload = canonicalizeLicenseVersion(
        revivePayloadDates(message.payload),
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
