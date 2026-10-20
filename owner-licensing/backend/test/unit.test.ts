import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { open as fsOpen } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertActiveAuthorizedActor,
  assertContractDateOrder,
  assertPermission,
  effectivePermissions,
  isGrantablePermission,
  operatorGrantablePermissions,
  businessDay,
  customerCode,
  customerResponse,
  isRole,
  object,
  operationResponse,
  optionalBusinessDay,
  password,
  permissions,
  persistedBusinessDay,
  recordedOnFor,
  role,
  roles,
  safeUser,
  text,
  utcCalendarDay,
} from "../src/domain.js";
import {
  RoleUpgradeError,
  legacyRoleCompatibilityMatrix,
  legacyRoles,
  validateRoleUpgradePlan,
  type SafeUserUpgradeRow,
} from "../src/migrate.js";
import {
  FilesystemAuditArchiveStore,
  TOLERATED_DIRECTORY_SYNC_ERROR_CODES,
  canonicalAuditRetentionPolicy,
  computeArchiveBatchDigest,
  computeArchiveBundleDigest,
  computeArchivedEventDigest,
  computeMinimumRetainedUntil,
  createAuditArchiveBatch,
  evaluateAuditEventRetention,
  formatDurableBatchFileName,
  getAuditArchiveBatch,
  getAuditArchiveStatus,
  isInherentSecurityIncident,
  listAuditArchiveBatches,
  recoverAuditArchiveService,
  validateAndNormalizeIncidentMetadata,
  verifyAuditArchiveIntegrity,
  verifyExportedArchiveBundle,
} from "../src/archive.js";
import { config } from "../src/config.js";

describe("Owner deny-by-default policy and input boundary", () => {
  it("enforces the two-role MVP model (Owner Admin and License Operator) and rejects superseded roles", () => {
    expect(roles).toEqual(["OWNER_ADMIN", "LICENSE_OPERATOR"]);
    // PDR-19 §6.1 eligibility matrix (OD-LIC-07, OD-LIC-12, OD-LIC-16).
    expect(permissions("OWNER_ADMIN")).toEqual([
      "customers.view",
      "customers.write",
      "users.manage",
      "audit.view",
      "audit.archive",
      "operations.view",
      "operations.record",
      "replacements.authorize",
      "licenses.issue.time_limited",
      "licenses.issue.perpetual",
      "licenses.import",
      "licenses.view",
      "licenses.download",
      "limit_profiles.manage",
    ]);
    expect(permissions("LICENSE_OPERATOR")).toEqual([
      "customers.view",
      "audit.view",
      "operations.view",
      "operations.record",
      "licenses.issue.time_limited",
      "licenses.import",
      "licenses.view",
      "licenses.download",
    ]);
    expect(role("OWNER_ADMIN")).toBe("OWNER_ADMIN");
    expect(role("LICENSE_OPERATOR")).toBe("LICENSE_OPERATOR");
    expect(isRole("OWNER_ADMIN")).toBe(true);
    expect(isRole("LICENSE_OPERATOR")).toBe(true);
    for (const validRole of roles) {
      expect(
        safeUser({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          username: "u",
          password_hash: "$argon2id$v=19$m=19456,t=2,p=1$x$y",
          role: validRole,
          is_active: true,
          must_change_password: false,
          created_at: new Date("2026-10-16T00:00:00.000Z"),
        }).role,
      ).toBe(validRole);
    }
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
      expect(isRole(legacyOrUnknown)).toBe(false);
      expect(() => role(legacyOrUnknown)).toThrow("Invalid role.");
      expect(() =>
        safeUser({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          username: "u",
          password_hash: "$argon2id$v=19$m=19456,t=2,p=1$x$y",
          role: legacyOrUnknown as (typeof roles)[number],
          is_active: true,
          must_change_password: false,
          created_at: new Date("2026-10-16T00:00:00.000Z"),
        }),
      ).toThrow("Invalid role.");
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
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS users_role_check");
    expect(sql).toContain("ADD CONSTRAINT users_role_check CHECK");
    expect(sql).toContain("role IN ('OWNER_ADMIN', 'LICENSE_OPERATOR')");
    expect(sql).toContain("NOT IN ('OWNER_ADMIN', 'LICENSE_OPERATOR')");
    expect(sql).toContain("string_agg(DISTINCT role, ', ' ORDER BY role)");
    expect(sql).toContain("RAISE EXCEPTION");
  });
  it("validates legacy role upgrade compatibility matrix and disposition plans", () => {
    expect(legacyRoles).toEqual([
      "SYSTEM_ADMIN",
      "LICENSE_ISSUANCE",
      "READ_ONLY_OBSERVER",
      "SUPPORT_SPECIALIST",
    ]);
    expect(
      legacyRoleCompatibilityMatrix.SYSTEM_ADMIN
        .canPreserveWithoutPrivilegeIncrease,
    ).toBe(true);
    expect(
      legacyRoleCompatibilityMatrix.SYSTEM_ADMIN
        .historicalEffectiveCapabilities,
    ).toContain(
      "POST /api/v1/operational-records/server-replacements (both normal and emergencyOldServerLost=true, historically gated by operations.record)",
    );
    expect(
      legacyRoleCompatibilityMatrix.SYSTEM_ADMIN.permissionDecompositionProof,
    ).toContain(
      "1a982323db7f:owner-licensing/backend/src/app.ts lines 576-647",
    );
    expect(
      legacyRoleCompatibilityMatrix.LICENSE_ISSUANCE
        .canPreserveWithoutPrivilegeIncrease,
    ).toBe(true);
    expect(
      legacyRoleCompatibilityMatrix.READ_ONLY_OBSERVER
        .canPreserveWithoutPrivilegeIncrease,
    ).toBe(false);
    expect(
      legacyRoleCompatibilityMatrix.SUPPORT_SPECIALIST
        .canPreserveWithoutPrivilegeIncrease,
    ).toBe(false);
    expect(
      legacyRoleCompatibilityMatrix.SUPPORT_SPECIALIST.historicalPermissions,
    ).toEqual(["customers.view"]);

    const now = new Date("2026-10-16T00:00:00.000Z");
    const users: SafeUserUpgradeRow[] = [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        username: "legacy_admin",
        role: "SYSTEM_ADMIN",
        is_active: true,
        must_change_password: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
        username: "legacy_issuance",
        role: "LICENSE_ISSUANCE",
        is_active: true,
        must_change_password: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FA3",
        username: "legacy_observer",
        role: "READ_ONLY_OBSERVER",
        is_active: true,
        must_change_password: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FA4",
        username: "legacy_support",
        role: "SUPPORT_SPECIALIST",
        is_active: true,
        must_change_password: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FA5",
        username: "existing_operator",
        role: "LICENSE_OPERATOR",
        is_active: true,
        must_change_password: false,
        created_at: now,
        updated_at: now,
      },
    ];

    // Valid least-privilege disposition plan
    const valid = validateRoleUpgradePlan(users, {
      authorizedByUserId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      reason: "Approved Phase 1.3 role migration",
      dispositions: [
        {
          userId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          username: "legacy_admin",
          fromRole: "SYSTEM_ADMIN",
          disposition: "MAP_EQUIVALENT",
          targetRole: "OWNER_ADMIN",
          isActive: true,
          reason: "Map SYSTEM_ADMIN to OWNER_ADMIN",
        },
        {
          userId: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
          username: "legacy_issuance",
          fromRole: "LICENSE_ISSUANCE",
          disposition: "RETAIN_REDUCED",
          targetRole: "LICENSE_OPERATOR",
          isActive: true,
          reason:
            "Retain issuance account as LICENSE_OPERATOR without replacement authority",
        },
        {
          userId: "01ARZ3NDEKTSV4RRFFQ69G5FA3",
          username: "legacy_observer",
          fromRole: "READ_ONLY_OBSERVER",
          disposition: "DEACTIVATE",
          targetRole: "LICENSE_OPERATOR",
          isActive: false,
          reason:
            "Deactivate read-only observer to prevent unapproved write access",
        },
        {
          userId: "01ARZ3NDEKTSV4RRFFQ69G5FA4",
          username: "legacy_support",
          fromRole: "SUPPORT_SPECIALIST",
          disposition: "DEACTIVATE",
          targetRole: "LICENSE_OPERATOR",
          isActive: false,
          reason:
            "Deactivate support specialist to prevent unapproved write access",
        },
      ],
    });
    expect(valid.dispositions).toHaveLength(4);
    expect(valid.dispositions[0]?.privilegeImpact).toBe("PRESERVES");
    expect(valid.dispositions[1]?.privilegeImpact).toBe("REDUCES");
    expect(valid.dispositions[2]?.privilegeImpact).toBe("REDUCES");
    expect(valid.dispositions[3]?.privilegeImpact).toBe("REDUCES");

    // Missing, null, non-admin, or inactive authorizedByUserId is rejected.
    const validDispositions = valid.dispositions.map((d) => ({
      userId: d.userId,
      username: d.username,
      fromRole: d.fromRole,
      disposition: d.disposition,
      targetRole: d.targetRole,
      isActive: d.isActive,
      allowPrivilegeElevation: d.allowPrivilegeElevation,
      reason: d.reason,
    }));
    expect(() =>
      validateRoleUpgradePlan(users, {
        reason: "Missing authorizedByUserId",
        dispositions: validDispositions,
      }),
    ).toThrow(/authorizedByUserId is required/);
    expect(() =>
      validateRoleUpgradePlan(users, {
        authorizedByUserId: null,
        reason: "Null authorizedByUserId",
        dispositions: validDispositions,
      }),
    ).toThrow(/authorizedByUserId is required/);
    expect(() =>
      validateRoleUpgradePlan(users, {
        authorizedByUserId: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
        reason: "Non-admin authorizedByUserId",
        dispositions: validDispositions,
      }),
    ).toThrow(/is not an active administrator/);
    expect(() =>
      validateRoleUpgradePlan(
        users.map((u) =>
          u.id === "01ARZ3NDEKTSV4RRFFQ69G5FA1"
            ? { ...u, is_active: false }
            : u,
        ),
        {
          authorizedByUserId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          reason: "Inactive admin authorizedByUserId",
          dispositions: validDispositions,
        },
      ),
    ).toThrow(/belongs to an inactive account/);

    // Unauthorized privilege elevation on READ_ONLY_OBSERVER and SUPPORT_SPECIALIST is rejected.
    expect(() =>
      validateRoleUpgradePlan(users, {
        authorizedByUserId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        reason: "Attempted unapproved elevation",
        dispositions: [
          {
            userId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
            username: "legacy_admin",
            fromRole: "SYSTEM_ADMIN",
            disposition: "MAP_EQUIVALENT",
            targetRole: "OWNER_ADMIN",
            isActive: true,
            reason: "ok",
          },
          {
            userId: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
            username: "legacy_issuance",
            fromRole: "LICENSE_ISSUANCE",
            disposition: "RETAIN_REDUCED",
            targetRole: "LICENSE_OPERATOR",
            isActive: true,
            reason: "ok",
          },
          {
            userId: "01ARZ3NDEKTSV4RRFFQ69G5FA3",
            username: "legacy_observer",
            fromRole: "READ_ONLY_OBSERVER",
            disposition: "RETAIN_REDUCED",
            targetRole: "LICENSE_OPERATOR",
            isActive: true,
            reason:
              "Attempt active observer as operator without elevation flag",
          },
          {
            userId: "01ARZ3NDEKTSV4RRFFQ69G5FA4",
            username: "legacy_support",
            fromRole: "SUPPORT_SPECIALIST",
            disposition: "ELEVATE_PRIVILEGE",
            targetRole: "LICENSE_OPERATOR",
            isActive: true,
            allowPrivilegeElevation: false,
            reason:
              "Attempt support elevation with allowPrivilegeElevation false",
          },
        ],
      }),
    ).toThrow(RoleUpgradeError);

    // Demoting/deactivating all admins is rejected with LastAdminProtected.
    expect(() =>
      validateRoleUpgradePlan(users, {
        authorizedByUserId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        reason: "Demote only admin",
        dispositions: [
          {
            userId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
            username: "legacy_admin",
            fromRole: "SYSTEM_ADMIN",
            disposition: "RETAIN_REDUCED",
            targetRole: "LICENSE_OPERATOR",
            isActive: true,
            reason: "demote",
          },
          {
            userId: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
            username: "legacy_issuance",
            fromRole: "LICENSE_ISSUANCE",
            disposition: "RETAIN_REDUCED",
            targetRole: "LICENSE_OPERATOR",
            isActive: true,
            reason: "retain",
          },
          {
            userId: "01ARZ3NDEKTSV4RRFFQ69G5FA3",
            username: "legacy_observer",
            fromRole: "READ_ONLY_OBSERVER",
            disposition: "DEACTIVATE",
            targetRole: "LICENSE_OPERATOR",
            isActive: false,
            reason: "deactivate",
          },
          {
            userId: "01ARZ3NDEKTSV4RRFFQ69G5FA4",
            username: "legacy_support",
            fromRole: "SUPPORT_SPECIALIST",
            disposition: "DEACTIVATE",
            targetRole: "LICENSE_OPERATOR",
            isActive: false,
            reason: "deactivate",
          },
        ],
      }),
    ).toThrow(/LastAdminProtected/);

    // Enforce assertPermission and assertActiveAuthorizedActor
    expect(assertPermission("OWNER_ADMIN", "replacements.authorize")).toBe(
      "OWNER_ADMIN",
    );
    expect(assertPermission("OWNER_ADMIN", "audit.archive")).toBe(
      "OWNER_ADMIN",
    );
    expect(() =>
      assertPermission("LICENSE_OPERATOR", "replacements.authorize"),
    ).toThrow("You do not have permission.");
    expect(() => assertPermission("LICENSE_OPERATOR", "audit.archive")).toThrow(
      "You do not have permission.",
    );
    expect(() =>
      assertActiveAuthorizedActor(
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          role: "OWNER_ADMIN",
          is_active: false,
          must_change_password: false,
        },
        "users.manage",
      ),
    ).toThrow("Authentication is required.");
    expect(() =>
      assertActiveAuthorizedActor(
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          role: "OWNER_ADMIN",
          is_active: true,
          must_change_password: true,
        },
        "users.manage",
      ),
    ).toThrow("Initial password must be changed first.");
  });

  it("implements OD-LIC-12 R-1: role eligibility is not access for an operator", () => {
    const operator = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
      role: "LICENSE_OPERATOR" as const,
      is_active: true,
      must_change_password: false,
    };
    // No grant rows at all: every permission is denied, including the four the
    // role held before OD-LIC-12.
    for (const permission of permissions("LICENSE_OPERATOR")) {
      expect(() => assertActiveAuthorizedActor(operator, permission)).toThrow(
        "You do not have permission.",
      );
      expect(
        effectivePermissions("LICENSE_OPERATOR", []).includes(permission),
      ).toBe(false);
    }
    // An active grant enables exactly that permission.
    expect(
      effectivePermissions("LICENSE_OPERATOR", ["customers.view"]),
    ).toEqual(["customers.view"]);
    expect(() =>
      assertActiveAuthorizedActor(
        { ...operator, permissions: ["customers.view"] },
        "customers.view",
      ),
    ).not.toThrow();
    // Intersection, never union: a grant cannot widen the role.
    expect(
      effectivePermissions("LICENSE_OPERATOR", [
        "licenses.issue.perpetual",
        "limit_profiles.manage",
        "customers.write",
        "users.manage",
        "audit.archive",
      ]),
    ).toEqual([]);
    expect(
      effectivePermissions("LICENSE_OPERATOR", [
        "licenses.issue.time_limited",
        "licenses.import",
      ]),
    ).toEqual(["licenses.issue.time_limited", "licenses.import"]);
    // OWNER_ADMIN is not under the grant model and is unchanged.
    expect(effectivePermissions("OWNER_ADMIN", [])).toEqual(
      permissions("OWNER_ADMIN"),
    );
    expect(() =>
      assertActiveAuthorizedActor(
        { ...operator, is_active: false, permissions: ["customers.view"] },
        "customers.view",
      ),
    ).toThrow("Authentication is required.");
    expect(() =>
      assertActiveAuthorizedActor(
        {
          ...operator,
          must_change_password: true,
          permissions: ["customers.view"],
        },
        "customers.view",
      ),
    ).toThrow("Initial password must be changed first.");
    expect(isGrantablePermission("licenses.issue.perpetual")).toBe(false);
    expect(isGrantablePermission("limit_profiles.manage")).toBe(false);
    expect(isGrantablePermission("licenses.install")).toBe(false);
    expect(isGrantablePermission("customers.*")).toBe(false);
    expect(isGrantablePermission("licenses.issue.time_limited")).toBe(true);
    expect(operatorGrantablePermissions).toEqual([
      "customers.view",
      "audit.view",
      "operations.view",
      "operations.record",
      "licenses.issue.time_limited",
      "licenses.import",
      "licenses.view",
      "licenses.download",
    ]);
  });

  it("enforces OQ-77 3-year retention boundary, unresolved incident hold, archive integrity digests, and safe failure on invalid metadata", async () => {
    const eventId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const batchId = "01BX5ZZKBKACTAV9WEVGEMMVRZ";
    const actorId = "01ARZ3NDEKTSV4RRFFQ69G5FA1";

    expect(canonicalAuditRetentionPolicy).toEqual({
      appendOnly: true,
      minimumRetentionYears: 3,
      threeYearMinimumIsPurgeDate: false,
      unresolvedSecurityIncidentsExcludedFromCleanup: true,
      permanentSeparateArchiveInForce: true,
      automaticDestructivePurgeEnabled: false,
      archiveStorageBoundary:
        "INDEPENDENT_DURABLE_FILESYSTEM_STORE_AND_POSTGRES_LEDGER",
      cryptographicHardwareWormImplemented: false,
    });

    // Exact 3-year calendar calculation in UTC including leap-day clamping (2024-02-29 -> 2027-02-28)
    expect(
      computeMinimumRetainedUntil("2023-10-17T12:34:56.789Z").toISOString(),
    ).toBe("2026-10-17T12:34:56.789Z");
    expect(
      computeMinimumRetainedUntil("2024-02-29T23:59:59.500Z").toISOString(),
    ).toBe("2027-02-28T23:59:59.500Z");

    const baseEvent = {
      sequence: 1,
      id: eventId,
      actorId,
      eventType: "CUSTOMER_CREATED",
      targetType: "Customer",
      targetId: eventId,
      occurredAt: "2023-10-17T12:00:00.000Z",
      minimumRetainedUntil: "2026-10-17T12:00:00.000Z",
      outcome: "SUCCESS" as const,
      securityIncident: false,
      incidentStatus: "NONE" as const,
      reason: "Created customer",
      beforeState: null,
      afterState: { customerCode: "ACME-1", displayName: "Acme" },
    };
    const recordDigest = computeArchivedEventDigest(baseEvent);

    // 1ms before 3-year boundary: within minimum retention window
    const beforeBoundary = evaluateAuditEventRetention(
      baseEvent,
      "2026-10-17T11:59:59.999Z",
    );
    expect(beforeBoundary.withinMinimumRetentionWindow).toBe(true);
    expect(beforeBoundary.pastMinimumRetentionFloor).toBe(false);
    expect(beforeBoundary.cleanupEligible).toBe(false);
    expect(beforeBoundary.retentionDisposition).toBe(
      "RETAIN_ACTIVE_WITHIN_MINIMUM_WINDOW",
    );
    expect(beforeBoundary.cleanupProtectionReasons).toEqual([
      "WITHIN_THREE_YEAR_MINIMUM_RETENTION",
      "UNARCHIVED_SOURCE_EVIDENCE",
      "PERMANENT_RETENTION_POLICY_NO_PURGE",
    ]);

    // Exact 3-year boundary (+0ms) unarchived: past floor, awaiting archive
    const atBoundaryUnarchived = evaluateAuditEventRetention(
      baseEvent,
      "2026-10-17T12:00:00.000Z",
    );
    expect(atBoundaryUnarchived.withinMinimumRetentionWindow).toBe(false);
    expect(atBoundaryUnarchived.pastMinimumRetentionFloor).toBe(true);
    expect(atBoundaryUnarchived.archiveVerified).toBe(false);
    expect(atBoundaryUnarchived.cleanupEligible).toBe(false);
    expect(atBoundaryUnarchived.retentionDisposition).toBe(
      "RETAIN_PAST_FLOOR_AWAITING_ARCHIVE",
    );
    expect(atBoundaryUnarchived.cleanupProtectionReasons).toEqual([
      "UNARCHIVED_SOURCE_EVIDENCE",
      "PERMANENT_RETENTION_POLICY_NO_PURGE",
    ]);

    // Beyond 3-year boundary (+1ms) and verified in separate archive: permanently retained
    const pastBoundaryArchived = evaluateAuditEventRetention(
      {
        ...baseEvent,
        archived: true,
        archiveBatchId: batchId,
        recordSha256: recordDigest,
      },
      "2026-10-17T12:00:00.001Z",
    );
    expect(pastBoundaryArchived.withinMinimumRetentionWindow).toBe(false);
    expect(pastBoundaryArchived.pastMinimumRetentionFloor).toBe(true);
    expect(pastBoundaryArchived.archiveVerified).toBe(true);
    expect(pastBoundaryArchived.cleanupEligible).toBe(false);
    expect(pastBoundaryArchived.retentionDisposition).toBe(
      "RETAIN_PAST_FLOOR_ARCHIVED_PERMANENTLY",
    );
    expect(pastBoundaryArchived.cleanupProtectionReasons).toEqual([
      "PERMANENT_RETENTION_POLICY_NO_PURGE",
    ]);

    // Unresolved security incidents are protected both within and beyond the 3-year floor
    const incidentPayload = {
      ...baseEvent,
      sequence: 2,
      eventType: "AUTH_LOGIN_FAILED",
      targetType: "User",
      outcome: "DENIED" as const,
      securityIncident: true,
      incidentStatus: "UNRESOLVED" as const,
      reason: "Invalid credentials",
      afterState: null,
    };
    const incidentDigest = computeArchivedEventDigest(incidentPayload);

    const incidentWithinWindow = evaluateAuditEventRetention(
      incidentPayload,
      "2026-10-17T11:59:59.999Z",
    );
    expect(incidentWithinWindow.securityIncident).toBe(true);
    expect(incidentWithinWindow.incidentProtected).toBe(true);
    expect(incidentWithinWindow.retentionDisposition).toBe(
      "RETAIN_ACTIVE_WITHIN_WINDOW_AND_INCIDENT_HOLD",
    );
    expect(incidentWithinWindow.cleanupProtectionReasons).toContain(
      "UNRESOLVED_SECURITY_INCIDENT_HOLD",
    );

    const incidentPastWindowArchived = evaluateAuditEventRetention(
      {
        ...incidentPayload,
        archived: true,
        archiveBatchId: batchId,
        recordSha256: incidentDigest,
      },
      "2030-01-01T00:00:00.000Z",
    );
    expect(incidentPastWindowArchived.pastMinimumRetentionFloor).toBe(true);
    expect(incidentPastWindowArchived.incidentProtected).toBe(true);
    expect(incidentPastWindowArchived.archiveVerified).toBe(true);
    expect(incidentPastWindowArchived.cleanupEligible).toBe(false);
    expect(incidentPastWindowArchived.retentionDisposition).toBe(
      "RETAIN_PAST_FLOOR_INCIDENT_HOLD",
    );
    expect(incidentPastWindowArchived.cleanupProtectionReasons).toEqual([
      "UNRESOLVED_SECURITY_INCIDENT_HOLD",
      "PERMANENT_RETENTION_POLICY_NO_PURGE",
    ]);

    // Verify exported archive bundle validation and tamper rejection
    const batchDigest = computeArchiveBatchDigest({
      batchId,
      firstSequence: 1,
      lastSequence: 2,
      eventCount: 2,
      retentionCutoffAt: "2023-10-17T12:00:00.000Z",
      previousBatchDigest: null,
      recordDigests: [recordDigest, incidentDigest],
    });
    const durableFileName = formatDurableBatchFileName(1, batchId);
    const validBundleBase = {
      batch: {
        id: batchId,
        batchNumber: 1,
        createdBy: actorId,
        createdAt: "2026-10-17T12:00:00.000Z",
        reason: "Initial archive bundle",
        firstSequence: 1,
        lastSequence: 2,
        eventCount: 2,
        retentionCutoffAt: "2023-10-17T12:00:00.000Z",
        previousBatchDigest: null,
        batchDigestSha256: batchDigest,
        durableFileName,
      },
      events: [
        {
          ...baseEvent,
          batchId,
          archivedAt: "2026-10-17T12:00:00.000Z",
          recordSha256: recordDigest,
        },
        {
          ...incidentPayload,
          batchId,
          archivedAt: "2026-10-17T12:00:00.000Z",
          recordSha256: incidentDigest,
        },
      ],
    };
    const bundleDigest = computeArchiveBundleDigest(validBundleBase);
    const validBundle = {
      ...validBundleBase,
      batch: {
        ...validBundleBase.batch,
        bundleDigestSha256: bundleDigest,
      },
    };
    expect(verifyExportedArchiveBundle(validBundle)).toEqual({
      verified: true,
      batchId,
      batchNumber: 1,
      eventCount: 2,
      firstSequence: 1,
      lastSequence: 2,
      batchDigestSha256: batchDigest,
      bundleDigestSha256: bundleDigest,
      durableFileName,
    });

    // Invalid, missing, or inconsistent incident/archive metadata fails safely
    expect(() =>
      validateAndNormalizeIncidentMetadata({
        eventType: "AUTH_LOGIN_FAILED",
        outcome: "DENIED",
        securityIncident: false,
      }),
    ).toThrow(/must have securityIncident = true/);
    expect(() =>
      validateAndNormalizeIncidentMetadata({
        eventType: "AUTH_LOGIN_FAILED",
        outcome: "DENIED",
        incidentStatus: "RESOLVED",
      }),
    ).toThrow(/cannot be marked RESOLVED/);
    expect(() =>
      validateAndNormalizeIncidentMetadata({
        eventType: "AUTH_LOGIN_FAILED",
        outcome: "DENIED",
        incidentStatus: "NONE",
      }),
    ).toThrow(/must have incidentStatus = UNRESOLVED/);
    expect(() =>
      validateAndNormalizeIncidentMetadata({
        eventType: "CUSTOMER_CREATED",
        outcome: "SUCCESS",
        securityIncident: false,
        incidentStatus: "UNRESOLVED",
      }),
    ).toThrow(/must have incidentStatus = NONE/);
    expect(() =>
      evaluateAuditEventRetention(
        {
          ...baseEvent,
          minimumRetainedUntil: "2025-10-17T12:00:00.000Z",
        },
        "2026-10-17T12:00:00.000Z",
      ),
    ).toThrow(/contradicts occurredAt \+ 3 years/);
    expect(() =>
      evaluateAuditEventRetention(
        {
          ...baseEvent,
          archived: true,
          archiveBatchId: null,
          recordSha256: recordDigest,
        },
        "2026-10-17T12:00:00.000Z",
      ),
    ).toThrow(/valid 26-character ULID archiveBatchId/);
    expect(() =>
      evaluateAuditEventRetention(
        {
          ...baseEvent,
          archived: true,
          archiveBatchId: batchId,
          recordSha256: "0".repeat(64),
        },
        "2026-10-17T12:00:00.000Z",
      ),
    ).toThrow(/recordSha256 mismatch/);
    expect(() =>
      evaluateAuditEventRetention(
        {
          ...baseEvent,
          archived: false,
          archiveBatchId: batchId,
        },
        "2026-10-17T12:00:00.000Z",
      ),
    ).toThrow(/Unarchived audit event cannot carry archiveBatchId/);
    expect(() =>
      computeArchivedEventDigest({
        ...baseEvent,
        afterState: { password_hash: "$argon2id$secret" },
      }),
    ).toThrow(/forbidden secret/);
    expect(() =>
      verifyExportedArchiveBundle({
        ...validBundle,
        batch: { ...validBundle.batch, batchDigestSha256: "f".repeat(64) },
      }),
    ).toThrow(/batchDigestSha256 mismatch/);

    expect(isInherentSecurityIncident("AUTH_LOGIN_FAILED", "DENIED")).toBe(
      true,
    );
    expect(
      isInherentSecurityIncident("AUDIT_ARCHIVE_ACCESS_DENIED", "DENIED"),
    ).toBe(true);
    expect(isInherentSecurityIncident("CUSTOMER_CREATED", "SUCCESS")).toBe(
      false,
    );

    // Events with nullable actorId and nullable targetId (e.g. AUTH_LOGIN_FAILED on unknown username)
    // compute deterministic digests and verify cleanly in archive bundles
    const nullTargetEvent = {
      ...baseEvent,
      actorId: null,
      eventType: "AUTH_LOGIN_FAILED",
      targetType: "User",
      targetId: null,
      outcome: "DENIED" as const,
      securityIncident: true,
      incidentStatus: "UNRESOLVED" as const,
      afterState: null,
    };
    const nullTargetDigest = computeArchivedEventDigest(nullTargetEvent);
    expect(nullTargetDigest).toMatch(/^[0-9a-f]{64}$/);
    const nullTargetBatchDigest = computeArchiveBatchDigest({
      batchId,
      firstSequence: 1,
      lastSequence: 1,
      eventCount: 1,
      retentionCutoffAt: nullTargetEvent.occurredAt,
      previousBatchDigest: null,
      recordDigests: [nullTargetDigest],
    });
    expect(
      verifyExportedArchiveBundle({
        batch: {
          ...validBundleBase.batch,
          firstSequence: 1,
          lastSequence: 1,
          eventCount: 1,
          retentionCutoffAt: nullTargetEvent.occurredAt,
          batchDigestSha256: nullTargetBatchDigest,
        },
        events: [
          {
            ...nullTargetEvent,
            batchId,
            archivedAt: "2026-10-17T12:05:00.000Z",
            recordSha256: nullTargetDigest,
          },
        ],
      }).verified,
    ).toBe(true);

    // Service-layer authorization guards on archive operations reject LICENSE_OPERATOR before DB access
    const fakeTx = {} as Parameters<typeof getAuditArchiveStatus>[0];
    const operatorActor = {
      id: actorId,
      role: "LICENSE_OPERATOR" as const,
      is_active: true,
      must_change_password: false,
    };
    await expect(
      getAuditArchiveStatus(fakeTx, operatorActor),
    ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
    await expect(
      listAuditArchiveBatches(fakeTx, operatorActor),
    ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
    await expect(
      getAuditArchiveBatch(fakeTx, operatorActor, batchId),
    ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
    await expect(
      createAuditArchiveBatch(fakeTx, operatorActor, { reason: "test" }),
    ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
    await expect(
      verifyAuditArchiveIntegrity(fakeTx, operatorActor, { reason: "test" }),
    ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });
    await expect(
      recoverAuditArchiveService(fakeTx, operatorActor, { reason: "test" }),
    ).rejects.toMatchObject({ status: 403, code: "PermissionDenied" });

    // Archive write, retrieve, verify, and recover fail closed (503 ArchiveStorageUnavailable)
    // when OWNER_AUDIT_ARCHIVE_DIR / store is not configured
    const adminActor = {
      id: actorId,
      role: "OWNER_ADMIN" as const,
      is_active: true,
      must_change_password: false,
    };
    await expect(
      createAuditArchiveBatch(fakeTx, adminActor, { reason: "test" }),
    ).rejects.toMatchObject({
      status: 503,
      code: "ArchiveStorageUnavailable",
    });
    await expect(
      getAuditArchiveBatch(fakeTx, adminActor, batchId),
    ).rejects.toMatchObject({
      status: 503,
      code: "ArchiveStorageUnavailable",
    });
    await expect(
      verifyAuditArchiveIntegrity(fakeTx, adminActor, { reason: "test" }),
    ).rejects.toMatchObject({
      status: 503,
      code: "ArchiveStorageUnavailable",
    });
    await expect(
      recoverAuditArchiveService(fakeTx, adminActor, { reason: "test" }),
    ).rejects.toMatchObject({
      status: 503,
      code: "ArchiveStorageUnavailable",
    });

    // Config validation for OWNER_AUDIT_ARCHIVE_DIR
    expect(
      config({
        OWNER_DATABASE_URL: "postgresql://u:p@localhost:5432/owner",
        OWNER_PUBLIC_ORIGIN: "https://owner.example.test",
        OWNER_AUDIT_ARCHIVE_DIR: "/var/lib/vardena-owner/audit-archive",
      }).archiveDir,
    ).toBe("/var/lib/vardena-owner/audit-archive");
    expect(() =>
      config({
        OWNER_DATABASE_URL: "postgresql://u:p@localhost:5432/owner",
        OWNER_PUBLIC_ORIGIN: "https://owner.example.test",
        OWNER_AUDIT_ARCHIVE_DIR: "relative/archive",
      }),
    ).toThrow(/OWNER_AUDIT_ARCHIVE_DIR must be an absolute path/);
    expect(() =>
      config({
        OWNER_DATABASE_URL: "postgresql://u:p@localhost:5432/owner",
        OWNER_PUBLIC_ORIGIN: "https://owner.example.test",
        OWNER_AUDIT_ARCHIVE_DIR: "/",
      }),
    ).toThrow(/OWNER_AUDIT_ARCHIVE_DIR must not be the filesystem root/);

    // FilesystemAuditArchiveStore persists write-once read-back-verified bundles,
    // detects tampering/missing files, and cleanly rolls back on failure
    const tmpArchiveDir = mkdtempSync(
      path.join(os.tmpdir(), "vardena-archive-unit-"),
    );
    try {
      const store = new FilesystemAuditArchiveStore(tmpArchiveDir);
      const emptyVerify = await store.verifyStore();
      expect(emptyVerify.verified).toBe(true);
      expect(emptyVerify.manifest.batches).toHaveLength(0);

      const persisted1 = await store.persistBatch(validBundle);
      expect(persisted1.entry.id).toBe(batchId);
      expect(persisted1.entry.fileName).toBe(durableFileName);

      const batchFilePath = path.join(
        tmpArchiveDir,
        "batches",
        durableFileName,
      );
      const st = statSync(batchFilePath);
      expect(st.mode & 0o777).toBe(0o444);

      const verifiedAfter1 = await store.verifyStore();
      expect(verifiedAfter1.verified).toBe(true);
      expect(verifiedAfter1.manifest.batches).toHaveLength(1);
      expect(verifiedAfter1.bundles[0]?.bundleDigestSha256).toBe(bundleDigest);

      // Idempotent re-persist of the same latest batch succeeds without error
      const idempotentPersist = await store.persistBatch(validBundle);
      expect(idempotentPersist.entry.bundleDigestSha256).toBe(bundleDigest);

      // Tampering with batch file on disk is detected by verifyStore()
      const originalBatchRaw = readFileSync(batchFilePath, "utf8");
      chmodSync(batchFilePath, 0o600);
      writeFileSync(
        batchFilePath,
        originalBatchRaw.replace("Created customer", "Tampered customer"),
        "utf8",
      );
      await expect(store.verifyStore()).rejects.toMatchObject({
        status: 409,
        code: "ArchiveIntegrityViolation",
      });
      writeFileSync(batchFilePath, originalBatchRaw, "utf8");
      chmodSync(batchFilePath, 0o444);
      expect((await store.verifyStore()).verified).toBe(true);

      // Extra unlisted file in batches/ is detected
      const unlistedPath = path.join(
        tmpArchiveDir,
        "batches",
        "batch-000002-01ARZ3NDEKTSV4RRFFQ69G5FA1.json",
      );
      writeFileSync(unlistedPath, "{}", "utf8");
      await expect(store.verifyStore()).rejects.toMatchObject({
        status: 409,
        code: "ArchiveIntegrityViolation",
      });
      rmSync(unlistedPath);
      expect((await store.verifyStore()).verified).toBe(true);

      // Rollback removes uncommitted batch file and restores manifest
      await persisted1.rollback();
      const afterRollback = await store.verifyStore();
      expect(afterRollback.manifest.batches).toHaveLength(0);
      expect(afterRollback.bundles).toHaveLength(0);
    } finally {
      rmSync(tmpArchiveDir, { recursive: true, force: true });
    }

    // Supported-filesystem directory sync policy:
    // - Only EINVAL from dirHandle.sync() is tolerated
    // - Fatal directory sync errors (EIO, ENOSPC, EDQUOT, EROFS, EACCES, EPERM, EBADF, ENOTSUP, unclassified)
    //   fail closed with 503 ArchiveStorageUnavailable, clean up partial artifacts, and never leak paths
    // - Directory open() failures and regular file fh.sync() failures are never tolerated
    expect([...TOLERATED_DIRECTORY_SYNC_ERROR_CODES]).toEqual(["EINVAL"]);

    const syncPolicyDir = mkdtempSync(
      path.join(os.tmpdir(), "vardena-archive-sync-policy-"),
    );
    try {
      const makeErrno = (code: string, msg: string) =>
        Object.assign(new Error(msg), { code });

      // 1. Tolerated EINVAL on directory descriptor sync succeeds cleanly
      let dirSyncCalls = 0;
      const einvalDirStore = new FilesystemAuditArchiveStore(syncPolicyDir, {
        open: (async (
          targetPath: Parameters<typeof fsOpen>[0],
          flags: any,
          mode?: any,
        ) => {
          const handle = await fsOpen(targetPath, flags, mode);
          if (flags === "r") {
            return new Proxy(handle, {
              get(target, prop, receiver) {
                if (prop === "sync") {
                  return async () => {
                    dirSyncCalls += 1;
                    throw makeErrno(
                      "EINVAL",
                      `EINVAL: invalid argument, fsync '${String(targetPath)}'`,
                    );
                  };
                }
                const val = Reflect.get(target, prop, receiver);
                return typeof val === "function" ? val.bind(target) : val;
              },
            });
          }
          return handle;
        }) as typeof fsOpen,
      });

      const einvalPersisted = await einvalDirStore.persistBatch(validBundle);
      expect(dirSyncCalls).toBe(2); // batches/ directory sync + rootDir manifest directory sync
      expect(
        (await einvalDirStore.verifyStore()).manifest.batches,
      ).toHaveLength(1);
      await einvalPersisted.rollback();
      expect(
        (await einvalDirStore.verifyStore()).manifest.batches,
      ).toHaveLength(0);

      // 2. Fatal directory sync error codes fail closed (503 ArchiveStorageUnavailable),
      //    remove linked batch file on failure, and do not leak filesystem paths
      for (const fatalCode of [
        "EIO",
        "ENOSPC",
        "EDQUOT",
        "EROFS",
        "EACCES",
        "EPERM",
        "EBADF",
        "ENOTSUP",
      ]) {
        const fatalDirStore = new FilesystemAuditArchiveStore(syncPolicyDir, {
          open: (async (
            targetPath: Parameters<typeof fsOpen>[0],
            flags: any,
            mode?: any,
          ) => {
            const handle = await fsOpen(targetPath, flags, mode);
            if (flags === "r") {
              return new Proxy(handle, {
                get(target, prop, receiver) {
                  if (prop === "sync") {
                    return async () => {
                      throw makeErrno(
                        fatalCode,
                        `${fatalCode}: sync failure at ${String(targetPath)}`,
                      );
                    };
                  }
                  const val = Reflect.get(target, prop, receiver);
                  return typeof val === "function" ? val.bind(target) : val;
                },
              });
            }
            return handle;
          }) as typeof fsOpen,
        });

        let caught: unknown;
        try {
          await fatalDirStore.persistBatch(validBundle);
        } catch (err) {
          caught = err;
        }
        expect(caught).toMatchObject({
          status: 503,
          code: "ArchiveStorageUnavailable",
        });
        expect((caught as Error).message).not.toContain(syncPolicyDir);
        expect(
          readdirSync(path.join(syncPolicyDir, "batches")).filter(
            (f) => !f.startsWith("."),
          ),
        ).toEqual([]);
        expect(existsSync(path.join(syncPolicyDir, "manifest.json"))).toBe(
          false,
        );
      }

      // 3. Unclassified directory sync error (no error code) also fails closed
      const unclassifiedDirStore = new FilesystemAuditArchiveStore(
        syncPolicyDir,
        {
          open: (async (
            targetPath: Parameters<typeof fsOpen>[0],
            flags: any,
            mode?: any,
          ) => {
            const handle = await fsOpen(targetPath, flags, mode);
            if (flags === "r") {
              return new Proxy(handle, {
                get(target, prop, receiver) {
                  if (prop === "sync") {
                    return async () => {
                      throw new Error(
                        `Unexpected disk failure at ${String(targetPath)}`,
                      );
                    };
                  }
                  const val = Reflect.get(target, prop, receiver);
                  return typeof val === "function" ? val.bind(target) : val;
                },
              });
            }
            return handle;
          }) as typeof fsOpen,
        },
      );
      await expect(
        unclassifiedDirStore.persistBatch(validBundle),
      ).rejects.toMatchObject({
        status: 503,
        code: "ArchiveStorageUnavailable",
      });

      // 4. Directory sync failure during manifest.json write (second syncDirectory call)
      //    rolls back both manifest.json and the newly written batch file
      let dirSyncCount = 0;
      const failOnManifestSyncStore = new FilesystemAuditArchiveStore(
        syncPolicyDir,
        {
          open: (async (
            targetPath: Parameters<typeof fsOpen>[0],
            flags: any,
            mode?: any,
          ) => {
            const handle = await fsOpen(targetPath, flags, mode);
            if (flags === "r") {
              return new Proxy(handle, {
                get(target, prop, receiver) {
                  if (prop === "sync") {
                    return async () => {
                      dirSyncCount += 1;
                      if (dirSyncCount === 2) {
                        throw makeErrno(
                          "EIO",
                          `EIO on manifest dir ${String(targetPath)}`,
                        );
                      }
                    };
                  }
                  const val = Reflect.get(target, prop, receiver);
                  return typeof val === "function" ? val.bind(target) : val;
                },
              });
            }
            return handle;
          }) as typeof fsOpen,
        },
      );
      await expect(
        failOnManifestSyncStore.persistBatch(validBundle),
      ).rejects.toMatchObject({
        status: 503,
        code: "ArchiveStorageUnavailable",
      });
      expect(
        (await einvalDirStore.verifyStore()).manifest.batches,
      ).toHaveLength(0);

      // 5. Directory open(dirPath, "r") failure (even with EINVAL) is NEVER tolerated
      const dirOpenFailStore = new FilesystemAuditArchiveStore(syncPolicyDir, {
        open: (async (
          targetPath: Parameters<typeof fsOpen>[0],
          flags: any,
          mode?: any,
        ) => {
          if (flags === "r") {
            throw makeErrno(
              "EINVAL",
              `Cannot open directory ${String(targetPath)}`,
            );
          }
          return fsOpen(targetPath, flags, mode);
        }) as typeof fsOpen,
      });
      await expect(
        dirOpenFailStore.persistBatch(validBundle),
      ).rejects.toMatchObject({
        status: 503,
        code: "ArchiveStorageUnavailable",
      });

      // 6. Regular file fh.sync() failure (even with EINVAL) is NEVER tolerated
      const fileSyncFailStore = new FilesystemAuditArchiveStore(syncPolicyDir, {
        open: (async (
          targetPath: Parameters<typeof fsOpen>[0],
          flags: any,
          mode?: any,
        ) => {
          const handle = await fsOpen(targetPath, flags, mode);
          if (flags === "wx") {
            return new Proxy(handle, {
              get(target, prop, receiver) {
                if (prop === "sync") {
                  return async () => {
                    throw makeErrno(
                      "EINVAL",
                      `Regular file fsync failed on ${String(targetPath)}`,
                    );
                  };
                }
                const val = Reflect.get(target, prop, receiver);
                return typeof val === "function" ? val.bind(target) : val;
              },
            });
          }
          return handle;
        }) as typeof fsOpen,
      });
      await expect(
        fileSyncFailStore.persistBatch(validBundle),
      ).rejects.toMatchObject({
        status: 503,
        code: "ArchiveStorageUnavailable",
      });
    } finally {
      rmSync(syncPolicyDir, { recursive: true, force: true });
    }

    // Error sanitization in getAuditArchiveStatus: non-ApiError exceptions from store or DB
    // never leak raw filesystem paths, SQL queries, or credentials in integrity.issueMessage
    const leakingStore = {
      rootDir: "/var/lib/secret-archive-mount",
      verifyStore: async () => {
        throw new Error(
          "EACCES: permission denied, open '/var/lib/secret-archive-mount/manifest.json' with postgres://admin:supersecret@db/owner",
        );
      },
      persistBatch: async () => {
        throw new Error("unreachable");
      },
    };
    const fakeStatusTx = {
      query: async (sql: string) => {
        if (sql.includes("ORDER BY batch_number ASC")) {
          return { rows: [] };
        }
        return {
          rows: [
            {
              total_source_events: "0",
              within_minimum_window_count: "0",
              past_minimum_floor_count: "0",
              unresolved_incident_count: "0",
              past_floor_incident_hold_count: "0",
              archived_event_count: "0",
              unarchived_eligible_count: "0",
              db_batch_count: "0",
            },
          ],
        };
      },
    } as unknown as Parameters<typeof getAuditArchiveStatus>[0];

    const sanitizedStatus = await getAuditArchiveStatus(
      fakeStatusTx,
      adminActor,
      {},
      leakingStore,
    );
    expect(sanitizedStatus.integrity.verified).toBe(false);
    expect(sanitizedStatus.integrity.durableStoreVerified).toBe(false);
    expect(sanitizedStatus.integrity.issueMessage).toBe(
      "Independent durable archive store failed verification.",
    );
    expect(sanitizedStatus.integrity.issueMessage).not.toContain(
      "/var/lib/secret-archive-mount",
    );
    expect(sanitizedStatus.integrity.issueMessage).not.toContain("supersecret");

    const okEmptyStore = {
      rootDir: "/var/lib/clean-archive",
      verifyStore: async () => ({
        verified: true as const,
        manifest: {
          format: "vardena-owner-audit-archive-manifest" as const,
          formatVersion: 1 as const,
          updatedAt: "2026-10-17T00:00:00.000Z",
          latestBatchId: null,
          latestBatchNumber: 0,
          latestBatchDigestSha256: null,
          lastArchivedSequence: null,
          batches: [],
          manifestDigestSha256: "0".repeat(64),
        },
        bundles: [],
      }),
      persistBatch: async () => {
        throw new Error("unreachable");
      },
    };
    const leakingDbTx = {
      query: async (sql: string) => {
        if (sql.includes("ORDER BY batch_number ASC")) {
          throw new Error(
            "SELECT * FROM owner_audit_archive.archive_batches failed on postgres://admin:dbsecret@10.0.0.5:5432/owner",
          );
        }
        return {
          rows: [
            {
              total_source_events: "0",
              within_minimum_window_count: "0",
              past_minimum_floor_count: "0",
              unresolved_incident_count: "0",
              past_floor_incident_hold_count: "0",
              archived_event_count: "0",
              unarchived_eligible_count: "0",
              db_batch_count: "0",
            },
          ],
        };
      },
    } as unknown as Parameters<typeof getAuditArchiveStatus>[0];

    const sanitizedDbStatus = await getAuditArchiveStatus(
      leakingDbTx,
      adminActor,
      {},
      okEmptyStore,
    );
    expect(sanitizedDbStatus.integrity.verified).toBe(false);
    expect(sanitizedDbStatus.integrity.dbLedgerVerified).toBe(false);
    expect(sanitizedDbStatus.integrity.issueMessage).toBe(
      "PostgreSQL archive ledger failed verification.",
    );
    expect(sanitizedDbStatus.integrity.issueMessage).not.toContain("dbsecret");
    expect(sanitizedDbStatus.integrity.issueMessage).not.toContain("10.0.0.5");
  });
});

describe("PDR-18 §1 — contract dates, observation metadata and signed-license validity", () => {
  it("derives the UTC calendar day of an instant, never a local day", () => {
    // One instant expressed in two offsets is the same UTC day; a process
    // timezone must never change the recorded day.
    expect(utcCalendarDay(new Date("2026-10-17T00:00:00.000Z"))).toBe(
      "2026-10-17",
    );
    expect(utcCalendarDay(new Date("2026-10-17T23:59:59.999Z"))).toBe(
      "2026-10-17",
    );
    // Tehran regression: 03:30+03:30 is the START of the same UTC day, and
    // 20:00-04:00 is the same UTC day seen from the west.
    expect(utcCalendarDay(new Date("2026-10-17T03:30:00.000+03:30"))).toBe(
      "2026-10-17",
    );
    expect(utcCalendarDay(new Date("2026-10-16T20:00:00.000-04:00"))).toBe(
      "2026-10-17",
    );
    // A Tehran evening is the NEXT UTC day, so a local-day reading would shift.
    expect(utcCalendarDay(new Date("2026-10-17T20:00:00.000+03:30"))).toBe(
      "2026-10-17",
    );
  });
  it("accepts only real canonical calendar days", () => {
    expect(businessDay("2028-02-29", "contractStartDate")).toBe("2028-02-29");
    for (const value of [
      "2027-02-29",
      "2027-13-01",
      "2027-1-1",
      "1405/07/23",
      "2027-01-01T00:00:00Z",
      "",
    ])
      expect(() => businessDay(value, "contractStartDate")).toThrow(
        /contractStartDate/,
      );
  });
  it("treats an omitted value as not recorded, never as a defaulted day", () => {
    expect(optionalBusinessDay(undefined, "contractEndDate")).toBeNull();
    expect(optionalBusinessDay(null, "contractEndDate")).toBeNull();
    expect(optionalBusinessDay("", "contractEndDate")).toBeNull();
    expect(optionalBusinessDay("2027-01-01", "contractEndDate")).toBe(
      "2027-01-01",
    );
  });
  it("reads a PostgreSQL date back without a timezone shift", () => {
    // node-postgres materializes `date` as a LOCAL-midnight JS Date, so the
    // value must be read through its UTC date components.
    expect(persistedBusinessDay(null)).toBeNull();
    expect(persistedBusinessDay(undefined)).toBeNull();
    expect(persistedBusinessDay(new Date(2026, 9, 17))).toBe("2026-10-17");
    expect(persistedBusinessDay(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(persistedBusinessDay(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(persistedBusinessDay("2026-10-17")).toBe("2026-10-17");
  });

  // ---------------------------------------------------------------------
  // Owner-side observation metadata (PDR-17: cryptographic issuance and
  // verification are not implemented, so the recording day is metadata about
  // the recording, never an attested issuance or activation date).
  // ---------------------------------------------------------------------
  it("derives the recording day from the server instant, in UTC, not locally", () => {
    expect(recordedOnFor(new Date("2026-10-17T00:00:00.000Z"))).toBe(
      "2026-10-17",
    );
    expect(recordedOnFor(new Date("2026-10-17T23:59:59.999Z"))).toBe(
      "2026-10-17",
    );
    expect(recordedOnFor(new Date("2026-10-17T03:30:00.000+03:30"))).toBe(
      "2026-10-17",
    );
    expect(recordedOnFor(new Date("2026-10-16T20:00:00.000-04:00"))).toBe(
      "2026-10-17",
    );
    // An ISO string round-trips to the same day; it is the same instant.
    expect(recordedOnFor("2026-10-17T12:00:00.000Z")).toBe("2026-10-17");
    expect(() => recordedOnFor("not-a-date")).toThrow();
  });
  it("accepts a recorded end before, equal to, or after the recording day", () => {
    // `recordedOn` is when an operator RECORDED the observation; it is not the
    // license's technical activation start. An operator must be able to record
    // an observation of an ALREADY-EXPIRED license, so the recorded end is
    // never compared with the recording day.
    const row = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      customer_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      customer_code: "Acme.01",
      display_name: "Acme",
      kind: "LICENSE",
      observation_category: "EXTERNAL_ISSUANCE_OBSERVED",
      observed_status: "ISSUED",
      installation_reference: "INST-1",
      created_at: new Date("2026-10-17T00:00:00.000Z"),
      updated_at: new Date("2026-10-17T00:00:00.000Z"),
      created_by: "u1",
      updated_by: "u1",
    };
    const endOn = (observed_validity_end: Date | null) =>
      operationResponse({ ...row, observed_validity_end }, "OWNER_ADMIN");
    // Before the recording day (an already-expired license).
    expect(endOn(new Date(2026, 0, 1)).observedValidityEnd).toBe("2026-01-01");
    // Equal to the recording day.
    expect(endOn(new Date(2026, 9, 17)).observedValidityEnd).toBe("2026-10-17");
    // After the recording day (the ordinary forward case).
    expect(endOn(new Date(2027, 0, 1)).observedValidityEnd).toBe("2027-01-01");
    // No recorded end is still allowed and is not the same as "unlimited".
    expect(endOn(null).observedValidityEnd).toBeNull();
    // The recording day is unaffected by the end in every case.
    expect(endOn(new Date(2026, 0, 1)).recordedOn).toBe("2026-10-17");
  });
  it("still refuses impossible and malformed calendar days", () => {
    for (const value of [
      "2027-02-29",
      "2027-13-01",
      "2027-1-1",
      "1405/07/23",
      "2027-01-01T00:00:00Z",
    ])
      expect(() => optionalBusinessDay(value, "observedValidityEnd")).toThrow(
        /observedValidityEnd/,
      );
    // A real leap day is accepted.
    expect(optionalBusinessDay("2028-02-29", "observedValidityEnd")).toBe(
      "2028-02-29",
    );
  });
  it("records an observation without establishing a signed-license issuance date", () => {
    const row = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      customer_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      customer_code: "Acme.01",
      display_name: "Acme",
      kind: "LICENSE",
      observation_category: "EXTERNAL_ISSUANCE_OBSERVED",
      observed_status: "ISSUED",
      installation_reference: "INST-1",
      observed_validity_end: new Date(2027, 0, 1),
      created_at: new Date("2026-10-17T23:59:59.000Z"),
      updated_at: new Date("2026-10-17T23:59:59.000Z"),
      created_by: "u1",
      updated_by: "u1",
    };
    const body = operationResponse(row, "OWNER_ADMIN");
    // The three concepts are separate fields with separate names.
    expect(body.recordedOn).toBe("2026-10-17");
    expect(body.observedValidityEnd).toBe("2027-01-01");
    // The response states its own epistemic status explicitly (PDR-17).
    expect(body.evidenceBasis).toBe("OPERATOR_OBSERVED");
    expect(body.cryptographicVerification).toBe("NOT_IMPLEMENTED");
    expect(body.signedArtifactProduced).toBe(false);
    expect(body.customerServerContacted).toBe(false);
    // No field may claim to hold the signed license's issuance or activation
    // date: such a claim would be unsupported by this application.
    const names = Object.keys(body);
    expect(names).not.toContain("activationValidFrom");
    expect(names).not.toContain("activationValidUntil");
    expect(names.join(" ")).not.toMatch(
      /issuedAt|issuanceDate|activationDate/i,
    );
  });
  it("moves the recording day when the recording instant moves, proving it tracks the recording", () => {
    const base = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      customer_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      customer_code: "Acme.01",
      display_name: "Acme",
      kind: "LICENSE",
      observation_category: "EXTERNAL_ISSUANCE_OBSERVED",
      observed_status: "ISSUED",
      installation_reference: "INST-1",
      observed_validity_end: null,
      updated_at: new Date("2026-10-17T23:59:59.000Z"),
      created_by: "u1",
      updated_by: "u1",
    };
    // Same license facts, two different recording instants: the recorded day
    // follows the recording, so it can never be an issuance date.
    expect(
      operationResponse(
        { ...base, created_at: new Date("2026-10-17T00:00:00.000Z") },
        "OWNER_ADMIN",
      ).recordedOn,
    ).toBe("2026-10-17");
    expect(
      operationResponse(
        { ...base, created_at: new Date("2026-10-18T00:00:00.000Z") },
        "OWNER_ADMIN",
      ).recordedOn,
    ).toBe("2026-10-18");
  });
  it("records no validity end for a server-replacement observation", () => {
    const body = operationResponse(
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        customer_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        customer_code: "Acme.01",
        display_name: "Acme",
        kind: "SERVER_REPLACEMENT",
        observation_category: "REPLACEMENT_AUTHORIZED",
        observed_status: "REPLACEMENT_AUTHORIZED",
        old_installation_reference: "OLD-1",
        replacement_installation_reference: "NEW-1",
        observed_validity_end: null,
        created_at: new Date("2026-10-17T00:00:00.000Z"),
        updated_at: new Date("2026-10-17T00:00:00.000Z"),
        created_by: "u1",
        updated_by: "u1",
      },
      "OWNER_ADMIN",
    );
    expect(body.observedValidityEnd).toBeNull();
    expect(body.recordedOn).toBe("2026-10-17");
  });

  // ---------------------------------------------------------------------
  // Commercial contract dates (never derived from, and never overwriting,
  // technical validity).
  // ---------------------------------------------------------------------
  it("allows contract dates that precede issuance and a single-day contract", () => {
    expect(() =>
      assertContractDateOrder("2020-03-20", "2021-03-21"),
    ).not.toThrow();
    expect(() =>
      assertContractDateOrder("2027-05-05", "2027-05-05"),
    ).not.toThrow();
    expect(() => assertContractDateOrder("2027-01-02", "2027-01-01")).toThrow(
      /contractEndDate/,
    );
    expect(() => assertContractDateOrder(null, "2027-01-01")).not.toThrow();
    expect(() => assertContractDateOrder("2027-01-01", null)).not.toThrow();
  });
  it("exposes contract dates as their own pair in the customer response", () => {
    const body = customerResponse(
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        customer_code: "Acme.01",
        display_name: "Acme",
        status: "ACTIVE",
        contract_reference: "REF-1",
        contract_start_date: new Date(2026, 9, 2),
        contract_end_date: new Date(2027, 9, 2),
        created_at: new Date(),
        updated_at: new Date(),
        created_by: "u1",
        updated_by: "u1",
      },
      "OWNER_ADMIN",
    );
    expect(body.contractStartDate).toBe("2026-10-02");
    expect(body.contractEndDate).toBe("2027-10-02");
    // Contract dates are a customer-level concept; an operational record never
    // carries them, so the two pairs cannot be confused.
    expect(() =>
      customerResponse(
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          customer_code: "Acme.01",
          display_name: "Acme",
          status: "ACTIVE",
          contract_reference: "REF-1",
        },
        "LICENSE_OPERATOR",
      ),
    ).not.toThrow();
  });
});
