import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertActiveAuthorizedActor,
  assertPermission,
  customerCode,
  customerResponse,
  isRole,
  object,
  password,
  permissions,
  role,
  roles,
  safeUser,
  text,
} from "../src/domain.js";
import {
  RoleUpgradeError,
  legacyRoleCompatibilityMatrix,
  legacyRoles,
  validateRoleUpgradePlan,
  type SafeUserUpgradeRow,
} from "../src/migrate.js";
import {
  canonicalAuditRetentionPolicy,
  computeArchiveBatchDigest,
  computeArchivedEventDigest,
  computeMinimumRetainedUntil,
  createAuditArchiveBatch,
  evaluateAuditEventRetention,
  getAuditArchiveBatch,
  getAuditArchiveStatus,
  isInherentSecurityIncident,
  listAuditArchiveBatches,
  validateAndNormalizeIncidentMetadata,
  verifyAuditArchiveIntegrity,
  verifyExportedArchiveBundle,
} from "../src/archive.js";
import { config } from "../src/config.js";

describe("Owner deny-by-default policy and input boundary", () => {
  it("enforces the two-role MVP model (Owner Admin and License Operator) and rejects superseded roles", () => {
    expect(roles).toEqual(["OWNER_ADMIN", "LICENSE_OPERATOR"]);
    expect(permissions("OWNER_ADMIN")).toEqual([
      "customers.view",
      "customers.write",
      "users.manage",
      "audit.view",
      "audit.archive",
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
      archiveStorageBoundary: "SEPARATE_POSTGRES_SCHEMA_AND_EXPORTABLE_BUNDLE",
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
    const validBundle = {
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
    expect(verifyExportedArchiveBundle(validBundle)).toEqual({
      verified: true,
      batchId,
      eventCount: 2,
      firstSequence: 1,
      lastSequence: 2,
      batchDigestSha256: batchDigest,
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
  });
});
