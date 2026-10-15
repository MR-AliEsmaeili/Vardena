// Pure unit tests for the audit explorer contract. No database is required; the
// SQL-shape assertions use a recording transaction double.
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  auditFilters,
  auditPageSize,
  auditState,
  listAuditEvents,
  utcInstant,
} from "../src/audit.js";

const ulidA = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ulidB = "01BX5ZZKBKACTAV9WEVGEMMVRZ";

function expectValidationFailure(run: () => unknown, message?: RegExp) {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  // The error contract: a 400 ValidationFailed whose message names the rule broken.
  expect(caught).toBeDefined();
  expect(caught).toMatchObject({ status: 400, code: "ValidationFailed" });
  if (message) expect((caught as Error).message).toMatch(message);
}

function recordingTx(rows: unknown[] = []) {
  const query = vi.fn(async () => ({ rows }));
  return { tx: { query } as unknown as PoolClient, query };
}

describe("audit explorer query contract", () => {
  it("defaults to the first page with no filters", () => {
    expect(auditFilters({})).toEqual({ page: 1 });
  });

  it("accepts every supported filter together and normalizes instants to canonical UTC", () => {
    expect(
      auditFilters({
        page: "3",
        eventType: "CUSTOMER_UPDATED",
        actorId: ulidA,
        targetType: "Customer",
        targetId: ulidB,
        outcome: "DENIED",
        occurredFrom: "2026-10-01T00:00:00Z",
        occurredBefore: "2026-10-02T12:30:15.5Z",
      }),
    ).toEqual({
      page: 3,
      eventType: "CUSTOMER_UPDATED",
      actorId: ulidA,
      targetType: "Customer",
      targetId: ulidB,
      outcome: "DENIED",
      occurredFrom: "2026-10-01T00:00:00.000Z",
      occurredBefore: "2026-10-02T12:30:15.500Z",
    });
  });

  it("treats an empty value as not supplied, as the operational-record filters do", () => {
    expect(
      auditFilters({ eventType: "", actorId: "", occurredFrom: "" }),
    ).toEqual({ page: 1 });
  });

  it.each([
    ["unknown key", { actor: ulidA }],
    ["lower-case event type", { eventType: "customer_updated" }],
    ["LIKE wildcard in event type", { eventType: "CUSTOMER%" }],
    ["underscore wildcard alone", { eventType: "_" }],
    ["SQL fragment in event type", { eventType: "x' OR '1'='1" }],
    ["over-long event type", { eventType: "A".repeat(121) }],
    ["wildcard in actor id", { actorId: "%" }],
    ["short actor id", { actorId: "01ARZ3" }],
    ["unknown target type", { targetType: "Users" }],
    ["SQL in target type", { targetType: "Customer' OR 1=1 --" }],
    ["unknown outcome", { outcome: "OK" }],
    ["malformed target id", { targetId: "not-a-ulid" }],
    ["repeated key as array", { eventType: ["AUTH_LOGIN", "AUTH_LOGOUT"] }],
    ["object-valued key", { eventType: { $ne: "AUTH_LOGIN" } }],
    ["offset-bearing instant", { occurredFrom: "2026-10-01T00:00:00+03:30" }],
    ["instant without zone", { occurredFrom: "2026-10-01T00:00:00" }],
    ["calendar rollover", { occurredFrom: "2026-02-31T00:00:00Z" }],
    ["leap second", { occurredFrom: "2026-06-30T23:59:60Z" }],
    // Documented minimum: years below 1000 are invalid. 0099 and 0999 are the
    // boundary cases the rule must catch; 0099 is also a Date.UTC two-digit year.
    ["year 0050 (below 1000)", { occurredFrom: "0050-01-01T00:00:00Z" }],
    ["year 0099 (below 1000)", { occurredFrom: "0099-12-31T23:59:59Z" }],
    ["year 0999 (below 1000)", { occurredFrom: "0999-12-31T23:59:59.999Z" }],
    [
      "year 0999 as exclusive bound",
      { occurredBefore: "0999-06-01T00:00:00Z" },
    ],
    ["year 0000", { occurredFrom: "0000-01-01T00:00:00Z" }],
    [
      "inverted window",
      {
        occurredFrom: "2026-10-02T00:00:00Z",
        occurredBefore: "2026-10-01T00:00:00Z",
      },
    ],
    [
      "empty window",
      {
        occurredFrom: "2026-10-01T00:00:00Z",
        occurredBefore: "2026-10-01T00:00:00Z",
      },
    ],
    ["empty page (page is strict, unlike filters)", { page: "" }],
    ["page zero", { page: "0" }],
    ["non-numeric page", { page: "abc" }],
    ["oversized page", { page: "1000000" }],
  ])("rejects %s with a validation error", (_label, query) => {
    expectValidationFailure(() =>
      auditFilters(query as Record<string, unknown>),
    );
  });

  it("requires years from 1000 onward and accepts the year-1000 boundary", () => {
    expect(utcInstant("1000-01-01T00:00:00Z", "x")).toBe(
      "1000-01-01T00:00:00.000Z",
    );
    expect(utcInstant("1000-12-31T23:59:59.999Z", "x")).toBe(
      "1000-12-31T23:59:59.999Z",
    );
    // 1000 is divisible by 100 but not by 400, so it is not a leap year.
    expectValidationFailure(
      () => utcInstant("1000-02-29T00:00:00Z", "x"),
      /valid calendar instant/,
    );
    for (const early of [
      "0999-12-31T23:59:59.999Z",
      "0099-12-31T00:00:00Z",
      "0000-01-01T00:00:00Z",
    ])
      expectValidationFailure(() => utcInstant(early, "x"), /year 1000/);
  });

  it("accepts 9999-12-31T23:59:59.999Z as the last representable instant", () => {
    // The UI rejects `to=9999-12-31` because its exclusive end is year 10000, which
    // this four-digit-year contract cannot express. This pins the upper limit.
    expect(utcInstant("9999-12-31T23:59:59.999Z", "x")).toBe(
      "9999-12-31T23:59:59.999Z",
    );
    expectValidationFailure(
      () => utcInstant("10000-01-01T00:00:00Z", "x"),
      /must be a UTC instant ending with Z/,
    );
  });

  it("validates UTC instants on the calendar, not only by pattern", () => {
    expect(utcInstant("2028-02-29T00:00:00Z", "x")).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    expectValidationFailure(() => utcInstant("2027-02-29T00:00:00Z", "x"));
    expectValidationFailure(() => utcInstant("2026-13-01T00:00:00Z", "x"));
  });
});

describe("audit explorer read (no database)", () => {
  it("binds every value as a parameter and never concatenates filter input into SQL", async () => {
    const { tx, query } = recordingTx();
    await listAuditEvents(tx, {
      page: "2",
      eventType: "CUSTOMER_UPDATED",
      actorId: ulidA,
      targetType: "Customer",
      targetId: ulidB,
      outcome: "SUCCESS",
      occurredFrom: "2026-10-01T00:00:00Z",
      occurredBefore: "2026-10-02T00:00:00Z",
    });
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    for (const value of [
      "CUSTOMER_UPDATED",
      ulidA,
      "Customer",
      ulidB,
      "SUCCESS",
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
    ]) {
      expect(sql).not.toContain(value);
      expect(values).toContain(value);
    }
    expect(sql).toContain("ORDER BY sequence DESC");
    expect(sql).toContain("occurred_at >= $");
    expect(sql).toContain("occurred_at < $");
    // Page 2 starts after the first full page; the extra row is the hasNext probe.
    expect(values).toContain(auditPageSize + 1);
    expect(values).toContain(auditPageSize);
  });

  it("uses a fixed page size and reports hasNext from the extra probe row", async () => {
    const row = (n: number) => ({
      id: `ROW${String(n).padStart(22, "0")}`,
      actor_id: null,
      event_type: "AUTH_LOGIN",
      target_type: "User",
      target_id: null,
      occurred_at: new Date("2026-10-15T10:00:00.000Z"),
      outcome: "SUCCESS",
      reason: null,
      before_state: null,
      after_state: null,
    });
    const full = recordingTx(Array.from({ length: 51 }, (_, i) => row(i)));
    const first = await listAuditEvents(full.tx, {});
    expect(first.items).toHaveLength(50);
    expect(first.hasNext).toBe(true);
    expect(first.pageSize).toBe(50);

    const last = recordingTx(Array.from({ length: 50 }, (_, i) => row(i)));
    const exact = await listAuditEvents(last.tx, {});
    expect(exact.items).toHaveLength(50);
    expect(exact.hasNext).toBe(false);
  });

  it("projects only the documented fields and never raw JSON", async () => {
    const { tx } = recordingTx([
      {
        id: ulidA,
        actor_id: ulidB,
        event_type: "CUSTOMER_UPDATED",
        target_type: "Customer",
        target_id: ulidA,
        occurred_at: new Date("2026-10-15T10:00:00.000Z"),
        outcome: "SUCCESS",
        reason: "Operator correction",
        before_state: {
          displayName: "old",
          password_hash: "$argon2id$secret",
        },
        after_state: {
          displayName: "new",
          token_hash: "a".repeat(64),
          nested: { password_hash: "$argon2id$secret" },
        },
      },
    ]);
    const body = await listAuditEvents(tx, {});
    expect(Object.keys(body.items[0]!).sort()).toEqual(
      [
        "actorId",
        "afterState",
        "beforeState",
        "eventType",
        "id",
        "occurredAt",
        "outcome",
        "reason",
        "targetId",
        "targetType",
      ].sort(),
    );
    expect(body.items[0]!.occurredAt).toBe("2026-10-15T10:00:00.000Z");
    expect(body.items[0]!.beforeState).toEqual({ displayName: "old" });
    expect(body.items[0]!.afterState).toEqual({ displayName: "new" });
    expect(JSON.stringify(body)).not.toContain("argon2");
    expect(JSON.stringify(body)).not.toContain("token_hash");
  });

  it("drops unknown, nested and non-scalar state while keeping allowlisted milestones", () => {
    expect(
      auditState({
        displayName: "x",
        password_hash: "$argon2id$",
        token_hash: "b".repeat(64),
        nested: { customerCode: "A" },
        milestones: ["REPLACEMENT_AUTHORIZED", "OLD_SERVER_STATE_RECORDED"],
        mixed: [1, "two"],
      }),
    ).toEqual({
      displayName: "x",
      milestones: ["REPLACEMENT_AUTHORIZED", "OLD_SERVER_STATE_RECORDED"],
    });
    expect(auditState(null)).toBeNull();
    expect(auditState(["displayName"])).toBeNull();
  });
});
