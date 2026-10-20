import { createHash, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KNOWN_MODULE_CODES,
  ProtocolError,
  REVOCATION_KIND,
  canonicalizeLicenseVersion,
  canonicalizeRevocation,
  decodeLicenseEnvelope,
  decodeRevocationEnvelope,
  hashKeyMaterial,
  licenseFileEnvelope,
  parseLicenseVersionPayload,
  parsePrivateKey,
  parseTrustedLicenseKeys,
  prepareLicenseRequest,
  prepareRevocationRequest,
  projectLicensePayload,
  sha256Hex,
  signLicenseVersion,
  signRevocation,
  verifyLicenseVersion,
  verifyRevocation,
  type LicenseRequestPayload,
  type LicenseVersionPayload,
  type RevocationPayload,
} from "../src/protocol.js";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
  "..",
);
const vectors = path.join(repoRoot, "docs", "licensing", "vectors");

function vectorFiles(folder: string): string[] {
  return readdirSync(path.join(vectors, folder))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(vectors, folder, name));
}

function readJson(file: string): Record<string, any> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
}

const authorityA = readJson(path.join(vectors, "keys", "authority-a.json"));
const authorityB = readJson(path.join(vectors, "keys", "authority-b.json"));
const privateA = parsePrivateKey(authorityA.privateKeyPkcs8Base64);
const trustedA = parseTrustedLicenseKeys([authorityA.publicKeySpkiBase64]);
const trustedBoth = parseTrustedLicenseKeys([
  authorityA.publicKeySpkiBase64,
  authorityB.publicKeySpkiBase64,
]);

function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ProtocolError) return error.reason;
    throw error;
  }
  throw new Error("Expected a ProtocolError");
}

function payloadFromVector(raw: Record<string, any>): LicenseVersionPayload {
  return parseLicenseVersionPayload(raw);
}

describe("VLIC2 canonical byte contract, proven against the shared corpus", () => {
  it("reproduces every canonicalization vector byte-for-byte", () => {
    let checked = 0;
    for (const file of vectorFiles("canonical")) {
      const vector = readJson(file);
      if (vector.protocolVersion !== "VLIC2") continue;
      const canonical = canonicalizeLicenseVersion(
        payloadFromVector(vector.input),
      );
      expect(canonical, vector.id).toBe(vector.expectedCanonicalUtf8);
      expect(Buffer.from(canonical, "utf8").toString("hex"), vector.id).toBe(
        vector.expectedCanonicalUtf8Hex,
      );
      checked += 1;
    }
    expect(checked).toBe(5);
  });

  it("verifies every valid VLIC2 artifact and refuses every invalid one with the published reason", () => {
    const ok = readJson(path.join(vectors, "valid", "OK-01.json"));
    const verified = verifyLicenseVersion(ok.artifact, trustedA);
    expect(verified.keyId).toBe(ok.keyId);
    expect(Buffer.from(verified.canonicalBody, "utf8").toString("hex")).toBe(
      ok.expectedCanonicalUtf8Hex,
    );
    for (const file of vectorFiles("invalid")) {
      const vector = readJson(file);
      if (vector.protocolVersion !== "VLIC2") continue;
      if (vector.expectedReason === "response-signature") continue;
      expect(
        reasonOf(() => verifyLicenseVersion(vector.artifact, trustedA)),
      ).toBe(vector.expectedReason);
    }
  });

  it("honours the rotation vectors: a retired key stops verifying", () => {
    const first = readJson(path.join(vectors, "rotation", "ROT-01.json"));
    expect(verifyLicenseVersion(first.artifact, trustedBoth).keyId).toBe(
      first.expectedKeyId,
    );
    const second = readJson(path.join(vectors, "rotation", "ROT-02.json"));
    expect(
      reasonOf(() =>
        verifyLicenseVersion(
          second.artifact,
          parseTrustedLicenseKeys([authorityB.publicKeySpkiBase64]),
        ),
      ),
    ).toBe(second.expectedResult);
  });

  it("pins independent literal canonical bytes, not values produced by the code under test", () => {
    const payload: LicenseVersionPayload = {
      version: 2,
      kind: "SERVER_LICENSE_VERSION",
      operationId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      licenseId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      customerId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      customerCode: "CUST-LITERAL-01",
      customerName: "شرکت نمونه",
      installationId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
      status: "ACTIVE",
      validFrom: new Date("2026-10-20T00:00:00.000Z"),
      validUntil: new Date("2027-10-20T00:00:00.000Z"),
      organizationLimit: 2,
      userLimit: 10,
      deviceLimit: null,
      deviceLimitSpecified: false,
      moduleEntitlements: ["users", "accounting"],
      featureEntitlements: ["reports-basic"],
      supersedesOperationId: null,
      renewsOperationId: null,
      issuedAt: new Date("2026-10-20T08:00:00.000Z"),
    };
    const literal =
      '{"v":2,"kind":"SERVER_LICENSE_VERSION","operationId":"01ARZ3NDEKTSV4RRFFQ69G5FAV",' +
      '"licenseId":"01ARZ3NDEKTSV4RRFFQ69G5FAW","customerId":"01ARZ3NDEKTSV4RRFFQ69G5FAX",' +
      '"customerCode":"CUST-LITERAL-01","customerName":"شرکت نمونه",' +
      '"installationId":"01ARZ3NDEKTSV4RRFFQ69G5FAY","status":"ACTIVE",' +
      '"validFrom":"2026-10-20T00:00:00.000Z","validUntil":"2027-10-20T00:00:00.000Z",' +
      '"organizationLimit":2,"userLimit":10,"modules":["accounting","users"],' +
      '"features":["reports-basic"],"supersedesOperationId":null,' +
      '"issuedAt":"2026-10-20T08:00:00.000Z"}';
    expect(canonicalizeLicenseVersion(payload)).toBe(literal);
    expect(sha256Hex(Buffer.from(literal, "utf8"))).toBe(
      createHash("sha256").update(literal, "utf8").digest("hex"),
    );

    // A renewal emits `renewsOperationId` between supersession and issuedAt.
    const renewalLiteral = literal.replace(
      '"supersedesOperationId":null,',
      '"supersedesOperationId":null,"renewsOperationId":"01ARZ3NDEKTSV4RRFFQ69G5FAZ",',
    );
    expect(
      canonicalizeLicenseVersion({
        ...payload,
        renewsOperationId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
      }),
    ).toBe(renewalLiteral);

    // A specified device limit is emitted; an unspecified one is omitted.
    expect(
      canonicalizeLicenseVersion({
        ...payload,
        deviceLimit: 5,
        deviceLimitSpecified: true,
      }),
    ).toBe(
      literal.replace('"userLimit":10,', '"userLimit":10,"deviceLimit":5,'),
    );
  });

  it("sets/verifies signatures and detects tampering", () => {
    const payload = payrollPayload();
    const document = signLicenseVersion(payload, privateA);
    const verified = verifyLicenseVersion(document, trustedA);
    expect(verified.payload.operationId).toBe(payload.operationId);
    const [prefix, body, signature] = document.split(".");
    const tamperedBody = Buffer.from(
      Buffer.from(body as string, "base64url")
        .toString("utf8")
        .replace("CUST-LITERAL-02", "CUST-LITERAL-03"),
      "utf8",
    ).toString("base64url");
    expect(
      reasonOf(() =>
        verifyLicenseVersion(
          `${prefix}.${tamperedBody}.${signature}`,
          trustedA,
        ),
      ),
    ).toBe("signature");
    // An unknown key hint is refused before any signature attempt.
    expect(
      reasonOf(() =>
        verifyLicenseVersion(document, trustedA, { keyIdHint: "other-key" }),
      ),
    ).toBe("unknown-key");
    expect(decodeLicenseEnvelope(licenseFileEnvelope(document)).document).toBe(
      document,
    );
  });

  it("keeps the module catalog identical to the customer source literal", () => {
    const source = readFileSync(
      path.join(
        repoRoot,
        "backend",
        "src",
        "modules",
        "licensing",
        "domain",
        "license-code.ts",
      ),
      "utf8",
    );
    const start = source.indexOf("export const KNOWN_MODULE_CODES");
    const open = source.indexOf("[", start);
    const close = source.indexOf("];", open);
    const literals = [
      ...source.slice(open, close).matchAll(/["']([a-z]+)["']/g),
    ].map((match) => match[1]);
    expect(literals).toEqual([...KNOWN_MODULE_CODES]);
  });
});

function payrollPayload(): LicenseVersionPayload {
  return {
    version: 2,
    kind: "SERVER_LICENSE_VERSION",
    operationId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
    licenseId: "01ARZ3NDEKTSV4RRFFQ69G5FB2",
    customerId: "01ARZ3NDEKTSV4RRFFQ69G5FB3",
    customerCode: "CUST-LITERAL-02",
    customerName: "شرکت نمونه دوم",
    installationId: "01ARZ3NDEKTSV4RRFFQ69G5FB4",
    status: "ACTIVE",
    validFrom: new Date("2026-10-20T00:00:00.000Z"),
    validUntil: null,
    organizationLimit: null,
    userLimit: 4,
    deviceLimit: 2,
    deviceLimitSpecified: true,
    moduleEntitlements: ["accounting"],
    featureEntitlements: [],
    supersedesOperationId: null,
    renewsOperationId: null,
    issuedAt: new Date("2026-10-20T09:00:00.000Z"),
  };
}

describe("signing requests (unsigned transport) and their two digests", () => {
  function requestPayload(): LicenseRequestPayload {
    return {
      v: 1,
      kind: "SERVER_LICENSE_ISSUANCE_REQUEST",
      requestId: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
      operationId: "01ARZ3NDEKTSV4RRFFQ69G5FC2",
      licenseId: "01ARZ3NDEKTSV4RRFFQ69G5FC3",
      customerId: "01ARZ3NDEKTSV4RRFFQ69G5FC4",
      customerCode: "CUST-REQ-01",
      customerName: "مشتری درخواست",
      installationId: "01ARZ3NDEKTSV4RRFFQ69G5FC5",
      status: "ACTIVE",
      validFrom: new Date("2026-10-20T00:00:00.000Z"),
      validUntil: new Date("2027-10-20T00:00:00.000Z"),
      organizationLimit: 1,
      userLimit: 5,
      deviceLimit: null,
      deviceLimitSpecified: false,
      modules: ["inventory", "accounting"],
      features: [],
      supersedesOperationId: null,
      renewsOperationId: null,
      issuedAt: new Date("2026-10-20T10:00:00.000Z"),
      requestedAt: new Date("2026-10-20T10:00:00.000Z"),
      requestedByUserId: "01ARZ3NDEKTSV4RRFFQ69G5FC6",
      signingKeyId: authorityA.keyId,
    };
  }

  it("computes a whole-request digest and a different binding digest", () => {
    const prepared = prepareLicenseRequest(requestPayload());
    expect(prepared.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    // RV-2: the two digests are over different field sets and can never be
    // used interchangeably, yet both are pure functions of the request.
    expect(prepared.requestDigest).not.toBe(prepared.bindingDigest);
    expect(prepared.bindingDigest).toBe(
      sha256Hex(
        Buffer.from(
          canonicalizeLicenseVersion(projectLicensePayload(requestPayload())),
          "utf8",
        ),
      ),
    );
    expect(prepared.envelope).toContain("vardena-license-signing-request");
    expect(prepared.envelope).not.toContain("VLIC2");
  });

  it("refuses a request whose signed projection would be invalid", () => {
    expect(() =>
      prepareLicenseRequest(requestPayload() as LicenseRequestPayload),
    ).not.toThrow();
    expect(() =>
      prepareLicenseRequest({
        ...requestPayload(),
        modules: ["accounting", "accounting"],
      }),
    ).toThrow(ProtocolError);
    expect(() =>
      prepareLicenseRequest({
        ...requestPayload(),
        validUntil: new Date("2026-10-19T00:00:00.000Z"),
      }),
    ).toThrow(ProtocolError);
  });
});

describe("VREV1 signed revocation artifact", () => {
  function revocation(): RevocationPayload {
    return {
      v: 1,
      kind: REVOCATION_KIND,
      revocationId: "01ARZ3NDEKTSV4RRFFQ69G5FD1",
      licenseId: "01ARZ3NDEKTSV4RRFFQ69G5FD2",
      targetOperationId: "01ARZ3NDEKTSV4RRFFQ69G5FD3",
      customerId: "01ARZ3NDEKTSV4RRFFQ69G5FD4",
      customerCode: "CUST-REV-01",
      installationId: "01ARZ3NDEKTSV4RRFFQ69G5FD5",
      effect: "LICENSE_ONLY",
      reason: "NON_PAYMENT",
      reasonDetail: null,
      issuerKeyId: authorityA.keyId,
      issuedAt: new Date("2026-10-20T11:00:00.000Z"),
    };
  }

  it("pins a literal canonical revocation payload and signs/verifies it", () => {
    const literal =
      '{"v":1,"kind":"SERVER_LICENSE_REVOCATION",' +
      '"revocationId":"01ARZ3NDEKTSV4RRFFQ69G5FD1",' +
      '"licenseId":"01ARZ3NDEKTSV4RRFFQ69G5FD2",' +
      '"targetOperationId":"01ARZ3NDEKTSV4RRFFQ69G5FD3",' +
      '"customerId":"01ARZ3NDEKTSV4RRFFQ69G5FD4","customerCode":"CUST-REV-01",' +
      '"installationId":"01ARZ3NDEKTSV4RRFFQ69G5FD5","effect":"LICENSE_ONLY",' +
      '"reason":"NON_PAYMENT","reasonDetail":null,' +
      `"issuerKeyId":"${authorityA.keyId}","issuedAt":"2026-10-20T11:00:00.000Z"}`;
    expect(canonicalizeRevocation(revocation())).toBe(literal);
    const document = signRevocation(revocation(), privateA);
    expect(document.startsWith("VREV1.")).toBe(true);
    const verified = verifyRevocation(document, trustedA);
    expect(verified.payload).toEqual(revocation());
    expect(verified.digest).toBe(sha256Hex(Buffer.from(literal, "utf8")));
    expect(verified.canonicalBody).toBe(literal);
  });

  it("refuses malformed, mis-signed, untrusted, non-canonical and cross-format documents", () => {
    const document = signRevocation(revocation(), privateA);
    const [prefix, body, signature] = document.split(".");
    const bodyText = Buffer.from(body as string, "base64url").toString("utf8");
    const tampered = Buffer.from(
      bodyText.replace('"CUST-REV-01"', '"CUST-REV-02"'),
      "utf8",
    ).toString("base64url");
    expect(
      reasonOf(() =>
        verifyRevocation(`${prefix}.${tampered}.${signature}`, trustedA),
      ),
    ).toBe("signature");
    expect(
      reasonOf(() =>
        verifyRevocation(
          document,
          parseTrustedLicenseKeys([authorityB.publicKeySpkiBase64]),
        ),
      ),
    ).toBe("signature");
    // Signed by B's key but claiming A's issuer id → key-mismatch.
    const foreign = signRevocation(
      { ...revocation(), issuerKeyId: authorityA.keyId },
      parsePrivateKey(authorityB.privateKeyPkcs8Base64),
    );
    expect(reasonOf(() => verifyRevocation(foreign, trustedBoth))).toBe(
      "key-mismatch",
    );
    expect(
      reasonOf(() =>
        verifyRevocation(document, trustedA, { keyIdHint: "nope" }),
      ),
    ).toBe("unknown-key");
    const notCanonical = Buffer.from(
      bodyText.replace('"v":1', '"v": 1'),
      "utf8",
    ).toString("base64url");
    // Re-sign the same logical payload over non-canonical bytes: signature is
    // valid but the payload is not in canonical form.
    const nonCanonicalSignature = sign(
      null,
      Buffer.from(bodyText.replace('"v":1', '"v": 1'), "utf8"),
      privateA,
    ).toString("base64url");
    expect(
      reasonOf(() =>
        verifyRevocation(
          `VREV1.${notCanonical}.${nonCanonicalSignature}`,
          trustedA,
        ),
      ),
    ).toBe("canonical");
    // A VLIC2 document is not a revocation.
    expect(
      reasonOf(() =>
        verifyRevocation(
          signLicenseVersion(payrollPayload(), privateA),
          trustedA,
        ),
      ),
    ).toBe("unsupported-version");
    expect(
      reasonOf(() => verifyRevocation("VREV1.only-two-parts", trustedA)),
    ).toBe("malformed");
    expect(() => decodeRevocationEnvelope("{}")).toThrow(ProtocolError);
  });

  it("prepares an unsigned VRRQ1 request whose digest is the payload digest", () => {
    const prepared = prepareRevocationRequest(revocation());
    expect(prepared.envelope).toContain("vardena-revocation-signing-request");
    expect(prepared.envelope).toContain("VRRQ1.");
    expect(prepared.requestDigest).toBe(prepared.bindingDigest);
    expect(prepared.requestDigest).toBe(
      sha256Hex(Buffer.from(canonicalizeRevocation(revocation()), "utf8")),
    );
  });
});

describe("trust-list grammar parity with the customer runtime", () => {
  it("derives the documented bare-key id and refuses duplicates", () => {
    expect(
      hashKeyMaterial(
        parseTrustedLicenseKeys([authorityA.publicKeySpkiBase64])[0]!.key,
      ),
    ).toBe(authorityA.keyId);
    expect(() =>
      parseTrustedLicenseKeys([
        `${authorityA.keyId}:${authorityA.publicKeySpkiBase64}`,
        `${authorityA.keyId}:${authorityB.publicKeySpkiBase64}`,
      ]),
    ).toThrow(/duplicate key id/);
    expect(() => parseTrustedLicenseKeys(["not-a-key"])).toThrow(
      /not a valid Ed25519 public key/,
    );
  });
});
