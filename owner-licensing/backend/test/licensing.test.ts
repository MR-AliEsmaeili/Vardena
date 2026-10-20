import { describe, expect, it } from "vitest";
import {
  assertPayloadMatchesIssuance,
  issuanceResponse,
} from "../src/licensing.js";
import type { LicenseVersionPayload } from "../src/protocol.js";

type Row = Parameters<typeof issuanceResponse>[0];

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FH1",
    customer_id: "01ARZ3NDEKTSV4RRFFQ69G5FH2",
    customer_code: "CUST-RESP-01",
    customer_name: "مشتری پاسخ",
    license_id: "01ARZ3NDEKTSV4RRFFQ69G5FH3",
    operation_id: "01ARZ3NDEKTSV4RRFFQ69G5FH4",
    installation_identity_id: "01ARZ3NDEKTSV4RRFFQ69G5FH5",
    installation_id: "01ARZ3NDEKTSV4RRFFQ69G5FH6",
    license_kind: "TIME_LIMITED",
    valid_from: new Date("2026-10-20T00:00:00.000Z"),
    valid_until: new Date("2027-10-20T00:00:00.000Z"),
    organization_limit: 1,
    user_limit: 5,
    device_limit: null,
    device_limit_specified: false,
    module_entitlements: ["accounting", "inventory"],
    feature_entitlements: [],
    limit_profile_id: null,
    signing_key_id: null,
    supersedes_operation_id: null,
    renews_operation_id: null,
    status: "REQUEST_PREPARED",
    request_payload_sha256: "a".repeat(64),
    request_binding_sha256: "b".repeat(64),
    request_document: "{}",
    request_file_name: "vardena-license-signing-request.json",
    requested_at: new Date("2026-10-20T10:00:00.000Z"),
    requested_by: "01ARZ3NDEKTSV4RRFFQ69G5FH7",
    signed_at: null,
    imported_at: null,
    imported_by: null,
    artifact_sha256: null,
    artifact_store_key: null,
    abandoned_at: null,
    abandoned_by: null,
    abandonment_reason: null,
    ...overrides,
  } as Row;
}

function payload(
  overrides: Partial<LicenseVersionPayload> = {},
): LicenseVersionPayload {
  return {
    version: 2,
    kind: "SERVER_LICENSE_VERSION",
    operationId: "01ARZ3NDEKTSV4RRFFQ69G5FH4",
    licenseId: "01ARZ3NDEKTSV4RRFFQ69G5FH3",
    customerId: "01ARZ3NDEKTSV4RRFFQ69G5FH2",
    customerCode: "CUST-RESP-01",
    customerName: "مشتری پاسخ",
    installationId: "01ARZ3NDEKTSV4RRFFQ69G5FH6",
    status: "ACTIVE",
    validFrom: new Date("2026-10-20T00:00:00.000Z"),
    validUntil: new Date("2027-10-20T00:00:00.000Z"),
    organizationLimit: 1,
    userLimit: 5,
    deviceLimit: null,
    deviceLimitSpecified: false,
    moduleEntitlements: ["inventory", "accounting"],
    featureEntitlements: [],
    supersedesOperationId: null,
    renewsOperationId: null,
    issuedAt: new Date("2026-10-20T10:00:00.000Z"),
    ...overrides,
  };
}

describe("issuance response", () => {
  it("reports customer-importability from the term, without inventing a signature", () => {
    const early = issuanceResponse(row(), {
      now: new Date("2026-11-01T00:00:00.000Z").getTime(),
    });
    expect(early.customerImportAdvisory).toBe("IMPORTABLE");
    expect(early.signedArtifactProduced).toBe(false);
    expect(early.artifactAvailable).toBe(false);
    const late = issuanceResponse(row(), {
      now: new Date("2027-10-20T00:00:00.000Z").getTime(),
    });
    expect(late.customerImportAdvisory).toBe("TERM_ENDED");
  });

  it("reports the request age and signed/imported metadata independently", () => {
    const response = issuanceResponse(
      row({
        status: "SIGNED_RECORDED",
        signing_key_id: "sha256-e6fc4307e011fd04",
        signed_at: new Date("2026-10-20T11:00:00.000Z"),
        imported_at: new Date("2026-10-20T11:02:00.000Z"),
        imported_by: "01ARZ3NDEKTSV4RRFFQ69G5FH8",
        artifact_sha256: "c".repeat(64),
        artifact_store_key: "licenses/01AR/01ARZ3NDEKTSV4RRFFQ69G5FH1.json",
      }),
      {
        now: new Date("2026-10-23T12:00:00.000Z").getTime(),
        revocation: {
          revocationId: "01ARZ3NDEKTSV4RRFFQ69G5FH9",
          reason: "NON_PAYMENT",
          status: "IMPORTED",
          importedAt: "2026-10-24T00:00:00.000Z",
        },
      },
    );
    expect(response.requestAgeDays).toBe(3);
    expect(response.signedArtifactProduced).toBe(true);
    expect(response.artifactAvailable).toBe(true);
    expect(response.signingKeyId).toBe("sha256-e6fc4307e011fd04");
    expect(response.revocation?.reason).toBe("NON_PAYMENT");
    expect(response.validFrom).toBe("2026-10-20T00:00:00.000Z");
    expect(response.validUntil).toBe("2027-10-20T00:00:00.000Z");
  });

  it("never exposes the stored request document or digests' inputs", () => {
    const response = issuanceResponse(row());
    expect(response).not.toHaveProperty("requestDocument");
    expect(response).not.toHaveProperty("artifactStoreKey");
  });
});

describe("import binding: the signed payload must equal the prepared request", () => {
  it("accepts the exact projection and ignores module ordering", () => {
    expect(() => assertPayloadMatchesIssuance(row(), payload())).not.toThrow();
  });

  const mismatches: [string, Partial<LicenseVersionPayload>][] = [
    ["operationId", { operationId: "01ARZ3NDEKTSV4RRFFQ69G5HX" }],
    ["licenseId", { licenseId: "01ARZ3NDEKTSV4RRFFQ69G5HX" }],
    ["customerId", { customerId: "01ARZ3NDEKTSV4RRFFQ69G5HX" }],
    ["customerCode", { customerCode: "CUST-OTHER" }],
    ["customerName", { customerName: "مشتری دیگر" }],
    ["installationId", { installationId: "01ARZ3NDEKTSV4RRFFQ69G5HX" }],
    ["status", { status: "SUSPENDED" }],
    ["validFrom", { validFrom: new Date("2026-10-21T00:00:00.000Z") }],
    ["validUntil", { validUntil: new Date("2028-10-20T00:00:00.000Z") }],
    ["organizationLimit", { organizationLimit: null }],
    ["userLimit", { userLimit: 6 }],
    ["deviceLimit", { deviceLimit: 3, deviceLimitSpecified: true }],
    ["deviceLimitSpecified", { deviceLimitSpecified: true }],
    ["modules", { moduleEntitlements: ["accounting"] }],
    ["features", { featureEntitlements: ["reports-basic"] }],
    [
      "supersedesOperationId",
      { supersedesOperationId: "01ARZ3NDEKTSV4RRFFQ69G5HY" },
    ],
    ["renewsOperationId", { renewsOperationId: "01ARZ3NDEKTSV4RRFFQ69G5HY" }],
    ["issuedAt", { issuedAt: new Date("2026-10-20T10:00:01.000Z") }],
  ];

  it.each(mismatches)("refuses a %s substitution", (field, override) => {
    try {
      assertPayloadMatchesIssuance(row(), payload(override));
      throw new Error("expected failure");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(409);
      expect((error as { code?: string }).code).toBe("ArtifactBindingMismatch");
      expect((error as Error).message).toContain(field);
    }
  });
});
