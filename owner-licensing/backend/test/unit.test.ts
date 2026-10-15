import { describe, expect, it } from "vitest";
import {
  customerCode,
  customerResponse,
  object,
  password,
  permissions,
  roles,
  text,
} from "../src/domain.js";
import { config } from "../src/config.js";

describe("Owner deny-by-default policy and input boundary", () => {
  it("exercises all four categories with exact approved read and write permissions", () => {
    expect(roles).toHaveLength(4);
    expect(permissions("SYSTEM_ADMIN")).toEqual([
      "customers.view",
      "customers.write",
      "users.manage",
      "audit.view",
      "operations.view",
      "operations.record",
    ]);
    expect(permissions("LICENSE_ISSUANCE")).toEqual([
      "customers.view",
      "audit.view",
      "operations.view",
      "operations.record",
    ]);
    expect(permissions("READ_ONLY_OBSERVER")).toEqual([
      "customers.view",
      "audit.view",
      "operations.view",
    ]);
    expect(permissions("SUPPORT_SPECIALIST")).toEqual(["customers.view"]);
    expect(permissions("anything")).toEqual([]);
    for (const unknown of [
      "SYSTEM_ADMIN.*",
      "SYSTEM_ADMIN.extra",
      "system_admin",
      "customers.*",
    ])
      expect(permissions(unknown)).toEqual([]);
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

describe("Support customer field allowlist", () => {
  it("returns only identity and operational status, including when new fields are added", () => {
    const row = {
      id: "id",
      customer_code: "A1",
      display_name: "Name",
      status: "ACTIVE",
      contract_reference: "private",
      created_by: "actor",
      created_at: "time",
      future_sensitive_column: "secret",
    };
    expect(customerResponse(row, "SUPPORT_SPECIALIST")).toEqual({
      id: "id",
      customerCode: "A1",
      displayName: "Name",
      status: "ACTIVE",
    });
    expect(customerResponse(row, "LICENSE_ISSUANCE")).toHaveProperty(
      "contractReference",
      "private",
    );
    expect(customerResponse(row, "READ_ONLY_OBSERVER")).toHaveProperty(
      "contractReference",
      "private",
    );
    expect(customerResponse(row, "SYSTEM_ADMIN")).toHaveProperty(
      "contractReference",
      "private",
    );
    expect(() =>
      customerResponse(row, "UNKNOWN" as (typeof roles)[number]),
    ).toThrow("Customer read is not permitted.");
    for (const r of roles)
      expect(customerResponse(row, r)).not.toHaveProperty(
        "future_sensitive_column",
      );
  });
});
