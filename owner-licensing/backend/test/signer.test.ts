import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SignerError,
  assertKeyFilePrivate,
  assertSignerEnvironment,
  signLicenseRequest,
  signRevocationRequest,
} from "../src/signer/signer.js";
import {
  canonicalizeRevocation,
  parsePrivateKey,
  parseTrustedLicenseKeys,
  prepareLicenseRequest,
  prepareRevocationRequest,
  sha256Hex,
  verifyLicenseVersion,
  verifyRevocation,
  type LicenseRequestPayload,
  type RevocationPayload,
} from "../src/protocol.js";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
  "..",
);
const vectors = path.join(repoRoot, "docs", "licensing", "vectors");
const authorityA = JSON.parse(
  readFileSync(path.join(vectors, "keys", "authority-a.json"), "utf8"),
) as {
  privateKeyPkcs8Base64: string;
  publicKeySpkiBase64: string;
  keyId: string;
};
const authorityB = JSON.parse(
  readFileSync(path.join(vectors, "keys", "authority-b.json"), "utf8"),
) as {
  privateKeyPkcs8Base64: string;
  publicKeySpkiBase64: string;
  keyId: string;
};
const trustedA = parseTrustedLicenseKeys([authorityA.publicKeySpkiBase64]);
const privateA = parsePrivateKey(authorityA.privateKeyPkcs8Base64);

function baseRequest(): LicenseRequestPayload {
  return {
    v: 1,
    kind: "SERVER_LICENSE_ISSUANCE_REQUEST",
    requestId: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
    operationId: "01ARZ3NDEKTSV4RRFFQ69G5FE2",
    licenseId: "01ARZ3NDEKTSV4RRFFQ69G5FE3",
    customerId: "01ARZ3NDEKTSV4RRFFQ69G5FE4",
    customerCode: "CUST-SIGN-01",
    customerName: "مشتری امضا",
    installationId: "01ARZ3NDEKTSV4RRFFQ69G5FE5",
    status: "ACTIVE",
    validFrom: new Date("2026-10-20T00:00:00.000Z"),
    validUntil: new Date("2027-10-20T00:00:00.000Z"),
    organizationLimit: 1,
    userLimit: 5,
    deviceLimit: null,
    deviceLimitSpecified: false,
    modules: ["accounting"],
    features: [],
    supersedesOperationId: null,
    renewsOperationId: null,
    issuedAt: new Date("2026-10-20T10:00:00.000Z"),
    requestedAt: new Date("2026-10-20T10:00:00.000Z"),
    requestedByUserId: "01ARZ3NDEKTSV4RRFFQ69G5FE6",
    signingKeyId: authorityA.keyId,
  };
}

function tamper(
  canonical: string,
  mutate: (wire: Record<string, unknown>) => void,
): string {
  const wire = JSON.parse(canonical) as Record<string, unknown>;
  mutate(wire);
  return `VLSR1.${Buffer.from(JSON.stringify(wire), "utf8").toString("base64url")}`;
}

function envelopeFor(armored: string): string {
  return JSON.stringify({
    format: "vardena-license-signing-request",
    fileVersion: 1,
    request: armored,
  });
}

/** A loader that fails the test if the signer touches the key too early. */
function guardedKeyLoader() {
  const state = { calls: 0 };
  return {
    state,
    load: () => {
      state.calls += 1;
      return privateA;
    },
  };
}

async function expectSignerError(
  run: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(SignerError);
    expect((error as SignerError).code).toBe(code);
    return;
  }
  throw new Error(`Expected SignerError ${code}`);
}

describe("offline signer — OD-LIC-11 digest gate before the key", () => {
  const prepared = prepareLicenseRequest(baseRequest());

  it("signs an untouched request and produces a customer-verifiable artifact", async () => {
    const key = guardedKeyLoader();
    const result = await signLicenseRequest({
      requestContent: prepared.envelope,
      expectedDigest: prepared.requestDigest,
      keyId: authorityA.keyId,
      loadPrivateKey: key.load,
      now: new Date("2026-10-20T10:05:00.000Z"),
    });
    expect(key.state.calls).toBe(1);
    expect(result.requestPayloadSha256).toBe(prepared.requestDigest);
    expect(result.requestBindingSha256).toBe(prepared.bindingDigest);
    expect(result.operationId).toBe(baseRequest().operationId);
    const verified = verifyLicenseVersion(result.document, trustedA);
    expect(verified.keyId).toBe(authorityA.keyId);
    expect(sha256Hex(Buffer.from(verified.canonicalBody, "utf8"))).toBe(
      prepared.bindingDigest,
    );
  });

  it("refuses a missing, empty, malformed, case-varied or shortened digest without reading the key", async () => {
    for (const digest of [
      null,
      undefined,
      "",
      "   ",
      "abc",
      prepared.requestDigest.slice(0, 32),
      prepared.requestDigest.toUpperCase(),
      prepared.requestDigest.replace("a", "g"),
    ]) {
      const key = guardedKeyLoader();
      await expectSignerError(
        () =>
          signLicenseRequest({
            requestContent: prepared.envelope,
            expectedDigest: digest,
            keyId: authorityA.keyId,
            loadPrivateKey: key.load,
            now: new Date("2026-10-20T10:05:00.000Z"),
          }),
        digest === null || digest === undefined || digest.trim() === ""
          ? "digest-missing"
          : "digest-malformed",
      );
      expect(key.state.calls).toBe(0);
    }
  });

  it("refuses every well-formed substitution T-1…T-9 without reading the key", async () => {
    const canonical = prepared.canonical;
    const alterations: [string, (wire: Record<string, unknown>) => void][] = [
      [
        "T-1 customer",
        (w) => {
          w.customerId = "01ARZ3NDEKTSV4RRFFQ69G5FF1";
          w.customerCode = "CUST-OTHER-01";
          w.customerName = "مشتری دیگر";
        },
      ],
      [
        "T-2 installation",
        (w) => {
          w.installationId = "01ARZ3NDEKTSV4RRFFQ69G5FF2";
        },
      ],
      [
        "T-3 unlimited limits",
        (w) => {
          w.organizationLimit = null;
          w.userLimit = null;
        },
      ],
      [
        "T-4 device limit",
        (w) => {
          w.deviceLimitSpecified = true;
          w.deviceLimit = 50;
        },
      ],
      [
        "T-5 extra module",
        (w) => {
          w.modules = ["accounting", "inventory"];
        },
      ],
      [
        "T-6 perpetual",
        (w) => {
          w.validUntil = null;
        },
      ],
      [
        "T-7 pushed end date",
        (w) => {
          w.validUntil = "2035-10-20T00:00:00.000Z";
        },
      ],
      [
        "T-9 attribution",
        (w) => {
          w.requestedByUserId = "01ARZ3NDEKTSV4RRFFQ69G5FF3";
        },
      ],
    ];
    for (const [, mutate] of alterations) {
      const key = guardedKeyLoader();
      await expectSignerError(
        () =>
          signLicenseRequest({
            requestContent: envelopeFor(tamper(canonical, mutate)),
            expectedDigest: prepared.requestDigest,
            keyId: authorityA.keyId,
            loadPrivateKey: key.load,
            now: new Date("2026-10-20T10:05:00.000Z"),
          }),
        "digest-mismatch",
      );
      expect(key.state.calls).toBe(0);
    }
  });

  it("refuses a request for another key, an invalid window or a replayed operation before the key", async () => {
    const otherKey = guardedKeyLoader();
    await expectSignerError(
      () =>
        signLicenseRequest({
          requestContent: prepared.envelope,
          expectedDigest: prepared.requestDigest,
          keyId: authorityB.keyId,
          loadPrivateKey: otherKey.load,
          now: new Date("2026-10-20T10:05:00.000Z"),
        }),
      "key-id-mismatch",
    );
    expect(otherKey.state.calls).toBe(0);

    // A future-dated start, signed-off request with a matching digest, is still
    // refused before the key: dates are validated independently of the digest.
    const future = prepareLicenseRequest({
      ...baseRequest(),
      validFrom: new Date("2027-01-01T00:00:00.000Z"),
      validUntil: new Date("2028-01-01T00:00:00.000Z"),
    });
    const futureKey = guardedKeyLoader();
    await expectSignerError(
      () =>
        signLicenseRequest({
          requestContent: future.envelope,
          expectedDigest: future.requestDigest,
          keyId: authorityA.keyId,
          loadPrivateKey: futureKey.load,
          now: new Date("2026-10-20T10:05:00.000Z"),
        }),
      "date-invalid",
    );
    expect(futureKey.state.calls).toBe(0);

    const dir = mkdtempSync(path.join(os.tmpdir(), "owner-signer-state-"));
    const statePath = path.join(dir, "signed.log");
    const first = guardedKeyLoader();
    await signLicenseRequest({
      requestContent: prepared.envelope,
      expectedDigest: prepared.requestDigest,
      keyId: authorityA.keyId,
      loadPrivateKey: first.load,
      statePath,
      now: new Date("2026-10-20T10:05:00.000Z"),
    });
    const replay = guardedKeyLoader();
    await expectSignerError(
      () =>
        signLicenseRequest({
          requestContent: prepared.envelope,
          expectedDigest: prepared.requestDigest,
          keyId: authorityA.keyId,
          loadPrivateKey: replay.load,
          statePath,
          now: new Date("2026-10-20T10:06:00.000Z"),
        }),
      "already-signed",
    );
    expect(replay.state.calls).toBe(0);
    expect(readFileSync(statePath, "utf8")).toContain(
      baseRequest().operationId,
    );
    // The state file is append-only and one line per signature.
    expect(readFileSync(statePath, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("refuses a request signed by a private key that does not match the pinned id", async () => {
    const wrong = parsePrivateKey(authorityB.privateKeyPkcs8Base64);
    await expectSignerError(
      () =>
        signLicenseRequest({
          requestContent: prepared.envelope,
          expectedDigest: prepared.requestDigest,
          keyId: authorityA.keyId,
          loadPrivateKey: () => wrong,
          now: new Date("2026-10-20T10:05:00.000Z"),
        }),
      "key-id-mismatch",
    );
  });
});

describe("offline signer — revocation artifacts", () => {
  function revocation(): RevocationPayload {
    return {
      v: 1,
      kind: "SERVER_LICENSE_REVOCATION",
      revocationId: "01ARZ3NDEKTSV4RRFFQ69G5FG1",
      licenseId: "01ARZ3NDEKTSV4RRFFQ69G5FG2",
      targetOperationId: "01ARZ3NDEKTSV4RRFFQ69G5FG3",
      customerId: "01ARZ3NDEKTSV4RRFFQ69G5FG4",
      customerCode: "CUST-SIGN-REV",
      installationId: "01ARZ3NDEKTSV4RRFFQ69G5FG5",
      effect: "LICENSE_ONLY",
      reason: "CONTRACT_TERMINATION",
      reasonDetail: "قرارداد پایان یافت",
      issuerKeyId: authorityA.keyId,
      issuedAt: new Date("2026-10-20T12:00:00.000Z"),
    };
  }

  it("signs an untouched revocation request and refuses a tampered one before reading the key", async () => {
    const prepared = prepareRevocationRequest(revocation());
    const key = guardedKeyLoader();
    const result = await signRevocationRequest({
      requestContent: prepared.envelope,
      expectedDigest: prepared.requestDigest,
      keyId: authorityA.keyId,
      loadPrivateKey: key.load,
      now: new Date("2026-10-20T12:01:00.000Z"),
    });
    expect(key.state.calls).toBe(1);
    const verified = verifyRevocation(result.document, trustedA);
    expect(verified.payload.reason).toBe("CONTRACT_TERMINATION");
    expect(result.requestBindingSha256).toBe(prepared.bindingDigest);
    expect(canonicalizeRevocation(verified.payload)).toBe(prepared.canonical);

    const wire = JSON.parse(prepared.canonical) as Record<string, unknown>;
    wire.customerCode = "CUST-ATTACKER";
    const tamperedEnvelope = JSON.stringify({
      format: "vardena-revocation-signing-request",
      fileVersion: 1,
      request: `VRRQ1.${Buffer.from(JSON.stringify(wire), "utf8").toString("base64url")}`,
    });
    const second = guardedKeyLoader();
    await expectSignerError(
      () =>
        signRevocationRequest({
          requestContent: tamperedEnvelope,
          expectedDigest: prepared.requestDigest,
          keyId: authorityA.keyId,
          loadPrivateKey: second.load,
          now: new Date("2026-10-20T12:01:00.000Z"),
        }),
      "digest-mismatch",
    );
    expect(second.state.calls).toBe(0);
  });
});

describe("offline signer — operand isolation", () => {
  it("refuses to run in an Owner application or production service environment", () => {
    expect(() => assertSignerEnvironment({})).not.toThrow();
    for (const env of [
      { OWNER_DATABASE_URL: "postgresql://x/y" },
      { OWNER_PUBLIC_ORIGIN: "https://owner.example" },
      { NODE_ENV: "production" },
    ]) {
      expect(() => assertSignerEnvironment(env)).toThrow(SignerError);
      try {
        assertSignerEnvironment(env);
      } catch (error) {
        expect((error as SignerError).exitCode).toBe(5);
      }
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses a private key file that other users can read",
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "owner-signer-key-"));
      const strict = path.join(dir, "strict.pkcs8");
      writeFileSync(strict, authorityA.privateKeyPkcs8Base64, { mode: 0o600 });
      await expect(assertKeyFilePrivate(strict)).resolves.toBeUndefined();
      const loose = path.join(dir, "loose.pkcs8");
      writeFileSync(loose, authorityA.privateKeyPkcs8Base64);
      chmodSync(loose, 0o644);
      await expect(assertKeyFilePrivate(loose)).rejects.toThrow(SignerError);
    },
  );

  it("refuses a missing private key file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "owner-signer-key-"));
    await expect(
      assertKeyFilePrivate(path.join(dir, "missing")),
    ).rejects.toThrow(SignerError);
  });

  it("keeps the signer out of the deployable Owner API build", () => {
    const build = JSON.parse(
      readFileSync(
        path.join(
          repoRoot,
          "owner-licensing",
          "backend",
          "tsconfig.build.json",
        ),
        "utf8",
      ),
    ) as { exclude?: string[] };
    expect(build.exclude).toContain("src/signer/**");
    const dockerfile = readFileSync(
      path.join(repoRoot, "owner-licensing", "backend", "Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toContain("COPY --from=build /app/dist ./dist");
    expect(dockerfile).not.toContain("dist-signer");
  });
});
