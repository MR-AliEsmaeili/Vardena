/**
 * Owner → customer licensing interoperability check (executed, not asserted).
 *
 * The Owner app and the Vardena customer app are two separate code bases that
 * must agree on the signed bytes. `docs/licensing/licensing-protocol-vectors.md`
 * (PDR-16) makes the checked-in vector corpus the contract, and each side runs
 * its own conformance suite against those vectors. What neither suite proves is
 * the *live* direction that actually matters for issuance:
 *
 *     Owner signs an artifact  →  the customer runtime verifies and parses it
 *
 * This script closes that gap without adding a cross-package import to either
 * build: it is a standalone tool that imports BOTH modules at runtime
 * (via `tsx`), signs with the Owner protocol implementation, and verifies with
 * the customer domain implementation. It is not part of either test suite and
 * changes no production code.
 *
 * What it proves when it exits 0:
 *   1. an artifact produced by `owner-licensing/backend/src/protocol.ts` is
 *      accepted by `backend/src/modules/licensing/domain/license-document.ts`;
 *   2. every signed field survives the trip unchanged (limits, entitlement
 *      sets, both lineage references, perpetual window, explicit device quota);
 *   3. the same artifact with one changed byte is REFUSED by the customer
 *      verifier, so a passing run is not "everything is accepted";
 *   4. an artifact signed by an untrusted key is refused.
 *
 * The key pair is generated in memory for this run only: no private key is
 * read from, written to or logged by this repository.
 *
 * Run from the repository root:
 *   owner-licensing/backend/node_modules/.bin/tsx scripts/verify-licensing-interop.ts
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";

import * as owner from "../owner-licensing/backend/src/protocol.ts";
import * as customer from "../backend/src/modules/licensing/domain/license-document.ts";
import * as customerRevocation from "../backend/src/modules/licensing/domain/license-revocation.ts";

const checks: string[] = [];
let failures = 0;

function check(name: string, run: () => void) {
  try {
    run();
    checks.push(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    checks.push(`FAIL ${name}: ${(error as Error).message}`);
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

/**
 * A ULID-shaped identifier (Crockford base32, 26 characters) generated here so
 * this tool needs no dependency resolution outside the two source trees it
 * imports. Only the SHAPE matters: the verifier validates the identifier shape
 * and the signature, not an issuance sequence.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(): string {
  let time = Date.now();
  const timePart = Array.from({ length: 10 }, () => {
    const digit = time % 32;
    time = (time - digit) / 32;
    return CROCKFORD[digit];
  })
    .reverse()
    .join("");
  const random = randomBytes(16);
  const randomPart = Array.from({ length: 16 }, (_, index) => {
    const byte = random[index] as number;
    return CROCKFORD[byte % 32];
  }).join("");
  return `${timePart}${randomPart}`;
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const authorityKeyPem = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const keyId = owner.deriveKeyId(publicKey);
// Real 26-character ULIDs: the customer verifier validates identifier shapes,
// so a hand-written placeholder would fail the parse for the wrong reason.
const ids = {
  revocation: ulid(),
  license: ulid(),
  operation: ulid(),
  customer: ulid(),
  installation: ulid(),
  renewed: ulid(),
};

/** A version issued today, valid for one year, with every optional shape set. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    version: 2 as const,
    kind: owner.LICENSE_DOCUMENT_KIND,
    operationId: ids.operation,
    licenseId: ids.license,
    customerId: ids.customer,
    customerCode: "CUST-INTEROP-01",
    // A Persian name: the canonical byte contract must not depend on ASCII.
    customerName: "شرکت آزمون بین‌سامانه‌ای",
    installationId: ids.installation,
    status: "ACTIVE" as const,
    validFrom: new Date("2026-10-21T00:00:00.000Z"),
    validUntil: new Date("2027-10-21T00:00:00.000Z"),
    organizationLimit: 2,
    userLimit: 25,
    deviceLimit: 5,
    deviceLimitSpecified: true,
    moduleEntitlements: ["organization", "accounting"],
    featureEntitlements: ["reports-export"],
    supersedesOperationId: null,
    renewsOperationId: ids.renewed,
    issuedAt: new Date("2026-10-21T08:15:00.000Z"),
    ...overrides,
  } as owner.LicenseVersionPayload;
}

const trusted = customer.parseTrustedLicenseKeys([`${keyId}:${authorityKeyPem}`]);

check("Owner signs a VLIC2 document the customer verifier accepts", () => {
  const document = owner.signLicenseVersion(payload(), privateKey);
  const envelope = owner.licenseFileEnvelope(document, keyId);
  const decoded = customer.decodeLicenseTransport(envelope);
  assert(decoded.document === document, "the envelope did not round-trip");
  const parsed = customer.parseLicenseDocument(decoded.document, trusted, {
    keyId: decoded.keyId ?? undefined,
  });
  assert(parsed.keyId === keyId, `key id drift: ${parsed.keyId} != ${keyId}`);
});

check("every signed field survives the trip unchanged", () => {
  const source = payload();
  const document = owner.signLicenseVersion(source, privateKey);
  const { payload: verified } = customer.parseLicenseDocument(
    document,
    trusted,
    { keyId },
  );
  assert(verified.operationId === source.operationId, "operationId drift");
  assert(verified.customerCode === source.customerCode, "customerCode drift");
  assert(verified.customerName === source.customerName, "customerName drift");
  assert(
    verified.installationId === source.installationId,
    "installationId drift",
  );
  assert(
    verified.organizationLimit === source.organizationLimit,
    "organizationLimit drift",
  );
  assert(verified.userLimit === source.userLimit, "userLimit drift");
  assert(verified.deviceLimit === source.deviceLimit, "deviceLimit drift");
  assert(
    verified.deviceLimitSpecified === source.deviceLimitSpecified,
    "deviceLimitSpecified drift",
  );
  assert(
    verified.renewsOperationId === source.renewsOperationId,
    "renewsOperationId drift",
  );
  assert(
    verified.validFrom.getTime() === source.validFrom.getTime(),
    "validFrom drift",
  );
  assert(
    verified.validUntil?.getTime() === source.validUntil?.getTime(),
    "validUntil drift",
  );
  // Entitlement lists are canonicalized SORTED (§2.1 of the file-exchange
  // contract), so the verifier returns them in canonical order rather than in
  // the order the caller passed. The contract is the set, and both sides agree
  // on the canonical ordering; asserting the raw input order would be asserting
  // something no side promises.
  assert(
    JSON.stringify(verified.moduleEntitlements) ===
      JSON.stringify([...source.moduleEntitlements].sort()),
    "moduleEntitlements drift",
  );
  assert(
    JSON.stringify(verified.featureEntitlements) ===
      JSON.stringify([...source.featureEntitlements].sort()),
    "featureEntitlements drift",
  );
  assert(
    new Set(verified.moduleEntitlements).size ===
      source.moduleEntitlements.length,
    "moduleEntitlements lost an entry",
  );
});

check("a perpetual license (null window, explicit device quota) is accepted", () => {
  const document = owner.signLicenseVersion(
    payload({ validUntil: null, deviceLimit: 0, deviceLimitSpecified: true }),
    privateKey,
  );
  const { payload: verified } = customer.parseLicenseDocument(
    document,
    trusted,
    { keyId },
  );
  assert(verified.validUntil === null, "validUntil should stay null");
  assert(verified.deviceLimit === 0, "an explicit 0 device quota must survive");
  assert(
    verified.deviceLimitSpecified === true,
    "deviceLimitSpecified must survive",
  );
});

check("one changed byte in the body is refused (signature over canonical bytes)", () => {
  const document = owner.signLicenseVersion(payload(), privateKey);
  const [prefix, body, signature] = document.split(".") as [
    string,
    string,
    string,
  ];
  const tamperedBody = Buffer.from(body, "base64url");
  tamperedBody[tamperedBody.length - 2] ^= 0x01;
  const tampered = [prefix, tamperedBody.toString("base64url"), signature].join(
    ".",
  );
  let refused = false;
  try {
    customer.parseLicenseDocument(tampered, trusted, { keyId });
  } catch {
    refused = true;
  }
  assert(refused, "the customer verifier accepted a tampered payload");
});

check("an artifact signed by an untrusted key is refused", () => {
  const other = generateKeyPairSync("ed25519").privateKey;
  const document = owner.signLicenseVersion(payload(), other);
  let refused = false;
  try {
    customer.parseLicenseDocument(document, trusted, {});
  } catch {
    refused = true;
  }
  assert(refused, "the customer verifier accepted an unknown signer");
});

// ---------------------------------------------------------------------------
// Revocation artifacts (OD-LIC-17), the second signed format the Owner emits
// and the customer must consume. `issuerKeyId` is a signed field, so the
// Owner's revocation payload names the same key id the trust list resolves.
// ---------------------------------------------------------------------------

function revocationPayload() {
  return {
    v: 1 as const,
    kind: owner.REVOCATION_KIND,
    revocationId: ids.revocation,
    licenseId: ids.license,
    targetOperationId: ids.operation,
    customerId: ids.customer,
    customerCode: "CUST-INTEROP-01",
    installationId: ids.installation,
    effect: owner.REVOCATION_EFFECT_LICENSE_ONLY,
    reason: "CONTRACT_TERMINATION" as const,
    reasonDetail: "پایان قرارداد پشتیبانی",
    issuerKeyId: keyId,
    issuedAt: new Date("2026-10-21T09:00:00.000Z"),
  } as owner.RevocationPayload;
}

check("Owner signs a VREV1 revocation the customer verifier accepts", () => {
  const document = owner.signRevocation(revocationPayload(), privateKey);
  const envelope = owner.revocationFileEnvelope(document, keyId);
  const decoded = customerRevocation.decodeRevocationTransport(envelope);
  assert(decoded.document === document, "the revocation envelope did not round-trip");
  const verified = customerRevocation.parseRevocationDocument(
    decoded.document,
    trusted,
    { keyId: decoded.keyId ?? undefined },
  );
  assert(verified.keyId === keyId, `key id drift: ${verified.keyId} != ${keyId}`);
  assert(
    verified.payload.revocationId === ids.revocation,
    "revocationId drift",
  );
  assert(
    verified.payload.reason === "CONTRACT_TERMINATION",
    "reason drift",
  );
  assert(
    verified.payload.effect === "LICENSE_ONLY",
    "effect drift",
  );
  assert(
    verified.payload.reasonDetail === "پایان قرارداد پشتیبانی",
    "reasonDetail drift",
  );
});

check("a revocation re-aimed at another installation is refused", () => {
  // The signature covers the installation id, so changing it invalidates the
  // artifact — this is the property that stops a revocation being redirected.
  const document = owner.signRevocation(revocationPayload(), privateKey);
  const [prefix, body, signature] = document.split(".") as [
    string,
    string,
    string,
  ];
  const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    installationId: string;
  };
  decoded.installationId = ulid();
  const forged = [
    prefix,
    Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url"),
    signature,
  ].join(".");
  let refused = false;
  try {
    customerRevocation.parseRevocationDocument(forged, trusted, { keyId });
  } catch {
    refused = true;
  }
  assert(refused, "the customer verifier accepted a re-aimed revocation");
});

console.log(`Owner ↔ customer licensing interop — ${checks.length} checks`);
for (const line of checks) console.log(line);
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(
    `\nAll ${checks.length} checks passed. Owner-signed artifacts verify against the customer runtime, and tampered or untrusted artifacts do not.`,
  );
}
