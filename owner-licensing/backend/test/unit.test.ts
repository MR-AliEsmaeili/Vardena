import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  customerCode,
  customerResponse,
  object,
  password,
  permissions,
  role,
  roles,
  text,
} from "../src/domain.js";
import { config } from "../src/config.js";

describe("Owner deny-by-default policy and input boundary", () => {
  it("enforces the two-role MVP model (Owner Admin and License Operator) and rejects superseded roles", () => {
    expect(roles).toEqual(["OWNER_ADMIN", "LICENSE_OPERATOR"]);
    expect(permissions("OWNER_ADMIN")).toEqual([
      "customers.view",
      "customers.write",
      "users.manage",
      "audit.view",
      "operations.view",
      "operations.record",
      "replacements.authorize",
    ]);
    expect(permissions("LICENSE_OPERATOR")).toEqual([
      "customers.view",
      "audit.view",
      "operations.view",
      "operations.record",
    ]);
    expect(role("OWNER_ADMIN")).toBe("OWNER_ADMIN");
    expect(role("LICENSE_OPERATOR")).toBe("LICENSE_OPERATOR");
    for (const legacyOrUnknown of [
      "SYSTEM_ADMIN",
      "LICENSE_ISSUANCE",
      "READ_ONLY_OBSERVER",
      "SUPPORT_SPECIALIST",
      "anything",
      "OWNER_ADMIN.*",
      "OWNER_ADMIN.extra",
      "owner_admin",
      "license_operator",
      "customers.*",
    ]) {
      expect(permissions(legacyOrUnknown)).toEqual([]);
      expect(() => role(legacyOrUnknown)).toThrow("Invalid role.");
    }
  });
  it("matches the case-sensitive PDR-14 code contract", () => {
    expect(customerCode("a.b_C:9-")).toBe("a.b_C:9-");
    for (const code of [
      "",
      "a",
      " A1",
      "A1 ",
      "x/y",
      "نام",
      "ab\n",
      "a".repeat(65),
    ])
      expect(() => customerCode(code)).toThrow();
    expect(() => customerCode("C-01", "C-01")).toThrow();
  });
  it("rejects identity/actor/time injection, non-object and unknown fields", () => {
    for (const input of [
      null,
      [],
      { actorId: "fake" },
      { occurredAt: "yesterday" },
      { customerCode: "new" },
    ])
      expect(() => object(input, ["displayName"])).toThrow();
    expect(() => text(" ", "name", 1, 200)).toThrow();
    expect(() => password(" ".repeat(8))).toThrow();
    expect(() => password("a".repeat(129))).toThrow();
  });
  it("fails closed on customer config and insecure production origins", () => {
    expect(() => config({ DATABASE_URL: "postgresql://customer" })).toThrow();
    expect(() =>
      config({
        OWNER_DATABASE_URL: "postgresql://owner",
        NODE_ENV: "production",
        OWNER_PUBLIC_ORIGIN: "http://owner",
      }),
    ).toThrow();
    expect(() =>
      config({
        OWNER_DATABASE_URL: "postgresql://owner",
        OWNER_PUBLIC_ORIGIN: "https://owner/path",
      }),
    ).toThrow();
  });
});

describe("Customer field allowlist for the two-role model", () => {
  it("returns only allowlisted customer fields for Owner Admin and License Operator and denies unknown/superseded roles", () => {
    const row = {
      id: "id",
      customer_code: "A1",
      display_name: "Name",
      status: "ACTIVE",
      contract_reference: "private",
      created_by: "actor",
      updated_by: "actor",
      created_at: "time",
      updated_at: "time",
      future_sensitive_column: "secret",
    };
    expect(customerResponse(row, "OWNER_ADMIN")).toHaveProperty(
      "contractReference",
      "private",
    );
    expect(customerResponse(row, "LICENSE_OPERATOR")).toHaveProperty(
      "contractReference",
      "private",
    );
    for (const denied of [
      "UNKNOWN",
      "SYSTEM_ADMIN",
      "LICENSE_ISSUANCE",
      "READ_ONLY_OBSERVER",
      "SUPPORT_SPECIALIST",
    ])
      expect(() =>
        customerResponse(row, denied as (typeof roles)[number]),
      ).toThrow("Customer read is not permitted.");
    for (const r of roles)
      expect(customerResponse(row, r)).not.toHaveProperty(
        "future_sensitive_column",
      );
  });
  it("defines additive migration 003-two-role-authorization.sql that fails closed on legacy roles", () => {
    const sql = readFileSync(
      new URL("../migrations/003-two-role-authorization.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("ADD CONSTRAINT users_role_check CHECK");
    expect(sql).toContain("role IN ('OWNER_ADMIN', 'LICENSE_OPERATOR')");
    expect(sql).toContain("NOT IN ('OWNER_ADMIN', 'LICENSE_OPERATOR')");
    expect(sql).toContain("RAISE EXCEPTION");
  });
});
