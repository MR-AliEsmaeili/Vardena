import { describe, expect, it } from "vitest";
import {
  customerCode,
  object,
  password,
  permissions,
  roles,
  text,
} from "../src/domain.js";
import { config } from "../src/config.js";

describe("Owner deny-by-default policy and input boundary", () => {
  it("exercises all four categories without inventing the missing proposal", () => {
    expect(roles).toHaveLength(4);
    expect(permissions("SYSTEM_ADMIN")).toContain("users.manage");
    expect(permissions("READ_ONLY_OBSERVER")).toEqual([
      "customers.view",
      "audit.view",
    ]);
    expect(permissions("LICENSE_ISSUANCE")).toEqual([]);
    expect(permissions("SUPPORT_SPECIALIST")).toEqual([]);
    expect(permissions("anything")).toEqual([]);
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
