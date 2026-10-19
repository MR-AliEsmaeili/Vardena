import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  signingKeyId,
  signingKeyLabel,
  signingKeyNotes,
  signingKeyEvidenceRef,
  signingKeyMetadata,
  signingKeySafety,
  signingKeyStatus,
  signingKeyResponse,
  operationResponse,
  optionalSigningKeyId,
} from "../src/domain.js";
import {
  getSigningKey,
  registerSigningKey,
  updateSigningKeyStatus,
  updateSigningKeyNotes,
} from "../src/signing-keys.js";
import { auditFilters, auditState } from "../src/audit.js";
const at = new Date("2026-10-08T21:00:00Z");
const row = {
  id: "authority-2026",
  label: "Authority",
  status: "ACTIVE",
  notes: null,
  evidence_ref: null,
  status_detected_at: null,
  status_reason: null,
  created_at: at,
  updated_at: at,
  created_by: "actor",
  updated_by: "actor",
};
const fake = (...rows: unknown[][]) => ({
  query: vi.fn().mockImplementation(async () => {
    const next = rows.shift() ?? [];
    return { rows: next, rowCount: next.length };
  }),
});
describe("OQ-74 domain and services", () => {
  it("maps all statuses and fails safe for absent/unrecognized status", () => {
    expect(signingKeySafety("ACTIVE")).toBe("SAFE");
    for (const s of ["COMPROMISED", "REVOKED"])
      expect(signingKeySafety(s)).toBe("NEEDS_REVIEW");
    for (const s of [null, undefined, "unexpected"])
      expect(signingKeySafety(s)).toBe("UNKNOWN");
    expect(optionalSigningKeyId(null)).toBeNull();
    expect(optionalSigningKeyId(undefined)).toBeNull();
  });
  it("uses opaque bounded IDs without normalization or secret/control acceptance", () => {
    for (const id of [
      "a",
      "authority-2026",
      "x".repeat(120),
      "authority/a?b#c%é",
    ])
      expect(signingKeyId(id)).toBe(id);
    for (const id of [
      "",
      " x",
      "x ",
      "x y",
      "x\n",
      "x\u007f",
      "x\u0085",
      "x\u200b",
      "x".repeat(121),
      "VLIC2.payload",
      ["PRIVATE", "KEY"].join(" "),
    ])
      expect(() => signingKeyId(id)).toThrow();
    for (const validate of [
      signingKeyLabel,
      signingKeyNotes,
      signingKeyEvidenceRef,
      (v: unknown) => signingKeyMetadata(v, "reason", 1, 500),
    ]) {
      for (const v of [
        "VLIC2.payload",
        "bad\n",
        "\ntrimmed",
        ["PRIVATE", "KEY"].join(" "),
      ])
        expect(() => validate(v)).toThrow();
    }
    expect(() => signingKeyLabel("x".repeat(201))).toThrow();
    expect(() => signingKeyNotes("x".repeat(2001))).toThrow();
    expect(() => signingKeyEvidenceRef("x".repeat(201))).toThrow();
    expect(() => signingKeyStatus("safe")).toThrow();
  });
  it("projects explicit allowlists and never treats an unassociated active status as safe", () => {
    expect(
      signingKeyResponse(
        { ...row, private_material: "not-exported" },
        "LICENSE_OPERATOR",
      ),
    ).not.toHaveProperty("private_material");
    const base = { kind: "LICENSE", created_at: at, updated_at: at };
    expect(
      operationResponse(
        { ...base, signing_key_status: "ACTIVE" },
        "OWNER_ADMIN",
      ).signingKeySafety,
    ).toBe("UNKNOWN");
    expect(
      operationResponse({ ...base, signing_key_id: "missing" }, "OWNER_ADMIN")
        .signingKeySafety,
    ).toBe("UNKNOWN");
    expect(
      operationResponse(
        { ...base, signing_key_id: row.id, signing_key_status: "ACTIVE" },
        "OWNER_ADMIN",
      ).signingKeySafety,
    ).toBe("SAFE");
    expect(
      auditState({
        signingKeyId: row.id,
        label: row.label,
        notes: "note",
        private_material: "not-exported",
      }),
    ).toEqual({ signingKeyId: row.id, label: row.label, notes: "note" });
    expect(
      auditFilters({ targetType: "SigningKey", targetId: row.id }).targetId,
    ).toBe(row.id);
    expect(() =>
      auditFilters({ targetType: "User", targetId: row.id }),
    ).toThrow();
    expect(() =>
      auditFilters({ targetType: "SigningKey", targetId: "VLIC2.payload" }),
    ).toThrow();
  });
  it("validates every key route before any database access and denies operator writes", async () => {
    const tx = fake();
    for (const id of [" x", "x\n", "x".repeat(121)]) {
      await expect(
        getSigningKey(tx as unknown as PoolClient, "OWNER_ADMIN", id),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        updateSigningKeyStatus(
          tx as unknown as PoolClient,
          "actor",
          "OWNER_ADMIN",
          id,
          { status: "COMPROMISED", reason: "incident" },
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        updateSigningKeyNotes(
          tx as unknown as PoolClient,
          "actor",
          "OWNER_ADMIN",
          id,
          { notes: "note" },
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      registerSigningKey(
        tx as unknown as PoolClient,
        "actor",
        "LICENSE_OPERATOR",
        {},
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateSigningKeyStatus(
        tx as unknown as PoolClient,
        "actor",
        "LICENSE_OPERATOR",
        row.id,
        {},
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateSigningKeyNotes(
        tx as unknown as PoolClient,
        "actor",
        "LICENSE_OPERATOR",
        row.id,
        {},
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.query).not.toHaveBeenCalled();
  });
  it("registers, audits, retries idempotently and rejects conflicting duplicates", async () => {
    const tx = fake([{ id: row.id }], [row], []);
    expect(
      await registerSigningKey(
        tx as unknown as PoolClient,
        "actor",
        "OWNER_ADMIN",
        { id: row.id, label: row.label },
      ),
    ).toMatchObject({ id: row.id });
    expect(tx.query.mock.calls[2]![1]).toEqual(
      expect.arrayContaining(["SIGNING_KEY_REGISTERED", "SigningKey", row.id]),
    );
    expect(tx.query.mock.calls[2]![1][8]).toMatchObject({
      signingKeyId: row.id,
      label: row.label,
      status: "ACTIVE",
    });
    const retry = fake([], [row]);
    await registerSigningKey(
      retry as unknown as PoolClient,
      "actor",
      "OWNER_ADMIN",
      { id: row.id, label: row.label },
    );
    expect(retry.query).toHaveBeenCalledTimes(2);
    for (const body of [
      { id: row.id, label: "different" },
      { id: row.id, label: row.label, notes: "different" },
    ]) {
      await expect(
        registerSigningKey(
          fake([], [row]) as unknown as PoolClient,
          "actor",
          "OWNER_ADMIN",
          body,
        ),
      ).rejects.toMatchObject({ status: 409 });
    }
  });
  it("requires a bounded safe reason, rejects same-status transitions, and audits before/after", async () => {
    for (const reason of [
      undefined,
      "",
      " ",
      "VLIC2.payload",
      "x".repeat(501),
      "bad\n",
    ])
      await expect(
        updateSigningKeyStatus(
          fake() as unknown as PoolClient,
          "actor",
          "OWNER_ADMIN",
          row.id,
          { status: "COMPROMISED", reason },
        ),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateSigningKeyStatus(
        fake([row]) as unknown as PoolClient,
        "actor",
        "OWNER_ADMIN",
        row.id,
        { status: "ACTIVE", reason: "same" },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const tx = fake(
      [row],
      [],
      [{ ...row, status: "COMPROMISED", status_detected_at: at }],
      [],
    );
    await updateSigningKeyStatus(
      tx as unknown as PoolClient,
      "actor",
      "OWNER_ADMIN",
      row.id,
      {
        status: "COMPROMISED",
        reason: "incident",
        evidenceReference: "CASE-74",
      },
    );
    expect(tx.query.mock.calls[3]![1][7]).toEqual({ status: "ACTIVE" });
    expect(tx.query.mock.calls[3]![1][8]).toEqual({
      status: "COMPROMISED",
      evidenceRef: "CASE-74",
    });
  });
});
