import { describe, expect, it } from "vitest";
import {
  ApiError,
  duplicateConstraintCode,
  evidenceReference,
  installationReference,
  licenseActivation,
  licenseObservationCreate,
  oldServerObservation,
  operationResponse,
  operationStatusFilter,
  permissions,
  reasonText,
  replacementCreate,
  replacementObservation,
  unfinishedReplacementCrossUse,
  roles,
} from "../src/domain.js";
import {
  recordActivationObservation,
  recordLicenseObservation,
  recordOldServerObservation,
  recordReplacementObservation,
  recordServerReplacement,
} from "../src/operations.js";

function code(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).code;
  }
  throw new Error("expected a domain error");
}

describe("manual observation transitions", () => {
  it("records external issuance only as ISSUED and activation only from that state", () => {
    expect(licenseObservationCreate()).toEqual({
      kind: "LICENSE",
      priorStatus: "UNRECORDED",
      observedStatus: "ISSUED",
      observationCategory: "EXTERNAL_ISSUANCE_OBSERVED",
    });
    expect(licenseActivation("ISSUED").observedStatus).toBe("ACTIVATED");
    expect(code(() => licenseActivation("ACTIVATED"))).toBe(
      "InvalidTransition",
    );
    expect(code(() => licenseActivation("UNRECORDED"))).toBe(
      "InvalidTransition",
    );
    expect(code(() => licenseActivation("REPLACEMENT_RECORDED"))).toBe(
      "InvalidTransition",
    );
  });
  it("enforces the manual replacement sequence and the emergency skip", () => {
    expect(replacementCreate(false).insertStatus).toBe(
      "REPLACEMENT_AUTHORIZED",
    );
    expect(replacementCreate(false).oldServerObservedState).toBeNull();
    const emergency = replacementCreate(true);
    expect(emergency.insertStatus).toBe("OLD_SERVER_STATE_RECORDED");
    expect(emergency.oldServerObservedState).toBe("UNAVAILABLE_EMERGENCY_LOSS");
    expect(emergency.transitions.map((step) => step.next)).toEqual([
      "REPLACEMENT_AUTHORIZED",
      "OLD_SERVER_STATE_RECORDED",
    ]);
    expect(
      oldServerObservation(
        { observedStatus: "REPLACEMENT_AUTHORIZED", emergency: false },
        "DEACTIVATION_OBSERVED",
      ).observedStatus,
    ).toBe("OLD_SERVER_STATE_RECORDED");
    expect(
      code(() =>
        oldServerObservation(
          { observedStatus: "REPLACEMENT_AUTHORIZED", emergency: true },
          "DEACTIVATION_OBSERVED",
        ),
      ),
    ).toBe("InvalidTransition");
    expect(
      code(() =>
        oldServerObservation(
          { observedStatus: "OLD_SERVER_STATE_RECORDED", emergency: false },
          "DEACTIVATION_OBSERVED",
        ),
      ),
    ).toBe("InvalidTransition");
    expect(
      code(() =>
        oldServerObservation(
          { observedStatus: "REPLACEMENT_AUTHORIZED", emergency: false },
          "ACTIVATED",
        ),
      ),
    ).toBe("ValidationFailed");
    expect(
      code(() =>
        replacementObservation(
          "REPLACEMENT_AUTHORIZED",
          "INSTALLATION_OBSERVED",
        ),
      ),
    ).toBe("InvalidTransition");
    expect(
      replacementObservation(
        "OLD_SERVER_STATE_RECORDED",
        "INSTALLATION_OBSERVED",
      ).observedStatus,
    ).toBe("REPLACEMENT_RECORDED");
    expect(
      code(() =>
        replacementObservation("REPLACEMENT_RECORDED", "INSTALLATION_OBSERVED"),
      ),
    ).toBe("InvalidTransition");
    expect(
      code(() =>
        replacementObservation("OLD_SERVER_STATE_RECORDED", "ACTIVATED"),
      ),
    ).toBe("ValidationFailed");
  });
  it("maps duplicate constraints and rejects key material in notes", () => {
    expect(
      duplicateConstraintCode("operational_license_installation_unique"),
    ).toBe("DuplicateOperation");
    expect(duplicateConstraintCode("operational_replacement_old_once")).toBe(
      "DuplicateOperation",
    );
    expect(duplicateConstraintCode("users_username_key")).toBe("Conflict");
    expect(duplicateConstraintCode(undefined)).toBe("Conflict");
    expect(installationReference("inst.a:1/b", "installationReference")).toBe(
      "inst.a:1/b",
    );
    expect(
      code(() => installationReference("bad ref", "installationReference")),
    ).toBe("ValidationFailed");
    expect(evidenceReference(undefined)).toBeNull();
    expect(evidenceReference("CASE-14")).toBe("CASE-14");
    // Keep the header split in source so the repository secret scan sees no key.
    const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    for (const value of [
      privateKeyMarker,
      "VLIC1.payload",
      "note\nwith break",
      "x".repeat(201),
    ])
      expect(code(() => evidenceReference(value))).toBe("ValidationFailed");
    expect(code(() => reasonText("observed VLIC2 artifact"))).toBe(
      "ValidationFailed",
    );
    expect(code(() => operationStatusFilter("CANCELED"))).toBe(
      "ValidationFailed",
    );
  });
  it("serializes an allowlist and never a cryptographic claim", () => {
    const row = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      customer_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      customer_code: "Acme.01",
      display_name: "نام",
      kind: "LICENSE",
      observation_category: "EXTERNAL_ISSUANCE_OBSERVED",
      observed_status: "ISSUED",
      installation_reference: "INST-1",
      old_installation_reference: null,
      replacement_installation_reference: null,
      old_server_observed_state: null,
      replacement_observed_state: null,
      emergency_old_server_lost: false,
      replaces_record_id: null,
      created_at: new Date("2026-10-15T00:00:00.000Z"),
      updated_at: new Date("2026-10-15T00:00:00.000Z"),
      created_by: "actor",
      updated_by: "actor",
      contract_reference: "SECRET-CONTRACT",
      password_hash: "secret",
      signed_payload: "VLIC2",
    };
    const body = operationResponse(row, "LICENSE_OPERATOR", [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        actor_id: "actor",
        occurred_at: new Date("2026-10-15T00:00:00.000Z"),
        prior_status: "UNRECORDED",
        new_status: "ISSUED",
        reason: "observed externally",
        evidence_reference: "CASE-1",
        confirmation_kind: "OPERATOR_OBSERVED",
      },
    ]);
    expect(body).toMatchObject({
      customerCode: "Acme.01",
      evidenceBasis: "OPERATOR_OBSERVED",
      cryptographicVerification: "NOT_IMPLEMENTED",
      signedArtifactProduced: false,
      customerServerContacted: false,
    });
    expect(body).not.toHaveProperty("contract_reference");
    expect(body).not.toHaveProperty("contractReference");
    expect(JSON.stringify(body)).not.toContain("SECRET-CONTRACT");
    expect(JSON.stringify(body)).not.toContain("password_hash");
    expect(JSON.stringify(body)).not.toContain("VLIC2");
    for (const denied of [
      "SUPPORT_SPECIALIST",
      "READ_ONLY_OBSERVER",
      "SYSTEM_ADMIN",
      "LICENSE_ISSUANCE",
    ])
      expect(
        code(() => operationResponse(row, denied as (typeof roles)[number])),
      ).toBe("PermissionDenied");
    for (const role of roles)
      if (!permissions(role).includes("operations.view"))
        expect(code(() => operationResponse(row, role))).toBe(
          "PermissionDenied",
        );
  });
  it("rejects only unfinished cross-use and still allows a completed chain", () => {
    const unfinished = {
      observedStatus: "REPLACEMENT_AUTHORIZED",
      oldInstallationReference: "A",
      replacementInstallationReference: "B",
    };
    expect(
      unfinishedReplacementCrossUse(unfinished, {
        oldInstallationReference: "B",
        replacementInstallationReference: "C",
      }),
    ).toBe(true);
    expect(
      unfinishedReplacementCrossUse(
        { ...unfinished, observedStatus: "OLD_SERVER_STATE_RECORDED" },
        {
          oldInstallationReference: "C",
          replacementInstallationReference: "A",
        },
      ),
    ).toBe(true);
    expect(
      unfinishedReplacementCrossUse(
        { ...unfinished, observedStatus: "REPLACEMENT_RECORDED" },
        {
          oldInstallationReference: "B",
          replacementInstallationReference: "C",
        },
      ),
    ).toBe(false);
  });
  it("enforces operations.record and replacements.authorize at the service layer before database access", async () => {
    const fakeTx = {} as Parameters<typeof recordServerReplacement>[0];
    await expect(
      recordServerReplacement(
        fakeTx,
        "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "LICENSE_OPERATOR",
        {},
      ),
    ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
    for (const legacy of [
      "SYSTEM_ADMIN",
      "LICENSE_ISSUANCE",
      "READ_ONLY_OBSERVER",
      "SUPPORT_SPECIALIST",
    ] as unknown as (typeof roles)[number][]) {
      await expect(
        recordLicenseObservation(
          fakeTx,
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          legacy,
          {},
        ),
      ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
      await expect(
        recordActivationObservation(
          fakeTx,
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          legacy,
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          {},
        ),
      ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
      await expect(
        recordServerReplacement(
          fakeTx,
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          legacy,
          {},
        ),
      ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
      await expect(
        recordOldServerObservation(
          fakeTx,
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          legacy,
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          {},
        ),
      ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
      await expect(
        recordReplacementObservation(
          fakeTx,
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          legacy,
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          {},
        ),
      ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
    }
  });
});
