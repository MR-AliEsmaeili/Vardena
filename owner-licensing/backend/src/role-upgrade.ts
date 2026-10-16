import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { Database, audit } from "./db.js";
import { digest, isRole, roles, type Role } from "./domain.js";

export const legacyRoles = [
  "SYSTEM_ADMIN",
  "LICENSE_ISSUANCE",
  "READ_ONLY_OBSERVER",
  "SUPPORT_SPECIALIST",
] as const;
export type LegacyRole = (typeof legacyRoles)[number];

export const dispositionKinds = [
  "MAP_EQUIVALENT",
  "RETAIN_REDUCED",
  "DEACTIVATE",
  "ELEVATE_PRIVILEGE",
] as const;
export type DispositionKind = (typeof dispositionKinds)[number];

export type PrivilegeImpact = "PRESERVES" | "REDUCES" | "INCREASES";

export interface LegacyRoleCompatibilityEntry {
  legacyRole: LegacyRole;
  historicalPermissions: readonly string[];
  historicalEffectiveCapabilities: readonly string[];
  permissionDecompositionProof: string;
  recommendedDisposition: {
    disposition: DispositionKind;
    targetRole: Role;
    preserveIsActive: boolean;
    privilegeImpact: PrivilegeImpact;
  };
  allowedDispositions: readonly {
    disposition: DispositionKind;
    targetRole: Role;
    isActiveRule: "PRESERVE_OR_FALSE" | "MUST_BE_FALSE" | "TRUE_OR_FALSE";
    privilegeImpact: PrivilegeImpact;
    requiresExplicitElevationFlag: boolean;
  }[];
  canAutomateWithoutExplicitDisposition: false;
  canPreserveWithoutPrivilegeIncrease: boolean;
  deploymentOwnerDecisionRequired: string;
}

export const legacyRoleCompatibilityMatrix: Record<
  LegacyRole,
  LegacyRoleCompatibilityEntry
> = {
  SYSTEM_ADMIN: {
    legacyRole: "SYSTEM_ADMIN",
    historicalPermissions: [
      "customers.view",
      "customers.write",
      "users.manage",
      "audit.view",
      "operations.view",
      "operations.record",
    ],
    historicalEffectiveCapabilities: [
      "GET /api/v1/customers and GET /api/v1/customers/:id (full customer projection including contractReference, createdBy, updatedBy)",
      "POST /api/v1/customers and PATCH /api/v1/customers/:id",
      "GET /api/v1/users, POST /api/v1/users, PATCH /api/v1/users/:id, POST /api/v1/users/:id/reset-password",
      "GET /api/v1/audit-events",
      "GET /api/v1/operational-records and GET /api/v1/operational-records/:id",
      "POST /api/v1/operational-records/license-observations, /:id/activation-observations, /:id/old-server-observations, /:id/replacement-observations",
      "POST /api/v1/operational-records/server-replacements (both normal and emergencyOldServerLost=true, historically gated by operations.record)",
    ],
    permissionDecompositionProof:
      "In pre-003 baseline (1a982323db7f:owner-licensing/backend/src/app.ts lines 576-647 and test/api.test.ts lines 742-756, 814-830), POST /api/v1/operational-records/server-replacements was gated by recorded() checking permissions(role).includes('operations.record'), which SYSTEM_ADMIN held. Phase 1.3 splits that existing server-replacement capability out of operations.record into the explicit permission code replacements.authorize so LICENSE_OPERATOR can be denied server-replacement creation while OWNER_ADMIN retains the exact same route and operation authority as SYSTEM_ADMIN with zero new endpoints or capabilities.",
    recommendedDisposition: {
      disposition: "MAP_EQUIVALENT",
      targetRole: "OWNER_ADMIN",
      preserveIsActive: true,
      privilegeImpact: "PRESERVES",
    },
    allowedDispositions: [
      {
        disposition: "MAP_EQUIVALENT",
        targetRole: "OWNER_ADMIN",
        isActiveRule: "PRESERVE_OR_FALSE",
        privilegeImpact: "PRESERVES",
        requiresExplicitElevationFlag: false,
      },
      {
        disposition: "RETAIN_REDUCED",
        targetRole: "LICENSE_OPERATOR",
        isActiveRule: "PRESERVE_OR_FALSE",
        privilegeImpact: "REDUCES",
        requiresExplicitElevationFlag: false,
      },
      {
        disposition: "DEACTIVATE",
        targetRole: "OWNER_ADMIN",
        isActiveRule: "MUST_BE_FALSE",
        privilegeImpact: "REDUCES",
        requiresExplicitElevationFlag: false,
      },
      {
        disposition: "DEACTIVATE",
        targetRole: "LICENSE_OPERATOR",
        isActiveRule: "MUST_BE_FALSE",
        privilegeImpact: "REDUCES",
        requiresExplicitElevationFlag: false,
      },
    ],
    canAutomateWithoutExplicitDisposition: false,
    canPreserveWithoutPrivilegeIncrease: true,
    deploymentOwnerDecisionRequired:
      "Confirm whether each SYSTEM_ADMIN account maps to OWNER_ADMIN (MAP_EQUIVALENT), is reduced to LICENSE_OPERATOR (RETAIN_REDUCED), or is deactivated (DEACTIVATE). At least one active OWNER_ADMIN must remain.",
  },
  LICENSE_ISSUANCE: {
    legacyRole: "LICENSE_ISSUANCE",
    historicalPermissions: [
      "customers.view",
      "audit.view",
      "operations.view",
      "operations.record",
    ],
    historicalEffectiveCapabilities: [
      "GET /api/v1/customers and GET /api/v1/customers/:id (full customer projection)",
      "GET /api/v1/audit-events",
      "GET /api/v1/operational-records and GET /api/v1/operational-records/:id",
      "POST /api/v1/operational-records/license-observations, /:id/activation-observations, /:id/old-server-observations, /:id/replacement-observations",
      "POST /api/v1/operational-records/server-replacements (historically permitted via operations.record in Phase 1.2, removed from LICENSE_OPERATOR in Phase 1.3)",
    ],
    permissionDecompositionProof:
      "In pre-003 baseline (1a982323db7f:owner-licensing/backend/src/domain.ts lines 28-34 and src/app.ts lines 576-647), LICENSE_ISSUANCE held operations.record, which also permitted POST /api/v1/operational-records/server-replacements. In Phase 1.3, server-replacement authorization is separated into replacements.authorize (granted only to OWNER_ADMIN), so transitioning LICENSE_ISSUANCE to LICENSE_OPERATOR strictly reduces effective privileges (RETAIN_REDUCED).",
    recommendedDisposition: {
      disposition: "RETAIN_REDUCED",
      targetRole: "LICENSE_OPERATOR",
      preserveIsActive: true,
      privilegeImpact: "REDUCES",
    },
    allowedDispositions: [
      {
        disposition: "RETAIN_REDUCED",
        targetRole: "LICENSE_OPERATOR",
        isActiveRule: "PRESERVE_OR_FALSE",
        privilegeImpact: "REDUCES",
        requiresExplicitElevationFlag: false,
      },
      {
        disposition: "DEACTIVATE",
        targetRole: "LICENSE_OPERATOR",
        isActiveRule: "MUST_BE_FALSE",
        privilegeImpact: "REDUCES",
        requiresExplicitElevationFlag: false,
      },
      {
        disposition: "ELEVATE_PRIVILEGE",
        targetRole: "OWNER_ADMIN",
        isActiveRule: "TRUE_OR_FALSE",
        privilegeImpact: "INCREASES",
        requiresExplicitElevationFlag: true,
      },
    ],
    canAutomateWithoutExplicitDisposition: false,
    canPreserveWithoutPrivilegeIncrease: true,
    deploymentOwnerDecisionRequired:
      "Confirm whether each LICENSE_ISSUANCE account is retained with reduced privileges as LICENSE_OPERATOR (RETAIN_REDUCED, removing server-replacement authorization) or deactivated (DEACTIVATE). Assigning OWNER_ADMIN increases privileges and requires ELEVATE_PRIVILEGE with allowPrivilegeElevation: true.",
  },
  READ_ONLY_OBSERVER: {
    legacyRole: "READ_ONLY_OBSERVER",
    historicalPermissions: ["customers.view", "audit.view", "operations.view"],
    historicalEffectiveCapabilities: [
      "GET /api/v1/customers and GET /api/v1/customers/:id (full customer projection)",
      "GET /api/v1/audit-events",
      "GET /api/v1/operational-records and GET /api/v1/operational-records/:id",
      "Zero mutation endpoints (all POST/PATCH business routes denied with 403)",
    ],
    permissionDecompositionProof:
      "In pre-003 baseline (1a982323db7f:owner-licensing/backend/src/domain.ts lines 35-36), READ_ONLY_OBSERVER held only read permissions (customers.view, audit.view, operations.view). Because both Phase 1.3 MVP roles (LICENSE_OPERATOR and OWNER_ADMIN) grant write capabilities (operations.record), keeping READ_ONLY_OBSERVER active in either role increases effective privileges.",
    recommendedDisposition: {
      disposition: "DEACTIVATE",
      targetRole: "LICENSE_OPERATOR",
      preserveIsActive: false,
      privilegeImpact: "REDUCES",
    },
    allowedDispositions: [
      {
        disposition: "DEACTIVATE",
        targetRole: "LICENSE_OPERATOR",
        isActiveRule: "MUST_BE_FALSE",
        privilegeImpact: "REDUCES",
        requiresExplicitElevationFlag: false,
      },
      {
        disposition: "ELEVATE_PRIVILEGE",
        targetRole: "LICENSE_OPERATOR",
        isActiveRule: "TRUE_OR_FALSE",
        privilegeImpact: "INCREASES",
        requiresExplicitElevationFlag: true,
      },
      {
        disposition: "ELEVATE_PRIVILEGE",
        targetRole: "OWNER_ADMIN",
        isActiveRule: "TRUE_OR_FALSE",
        privilegeImpact: "INCREASES",
        requiresExplicitElevationFlag: true,
      },
    ],
    canAutomateWithoutExplicitDisposition: false,
    canPreserveWithoutPrivilegeIncrease: false,
    deploymentOwnerDecisionRequired:
      "READ_ONLY_OBSERVER had zero write permissions, whereas both MVP roles grant write capabilities. Choose DEACTIVATE (isActive: false, targetRole: LICENSE_OPERATOR) to preserve least privilege, or explicitly authorize ELEVATE_PRIVILEGE with allowPrivilegeElevation: true.",
  },
  SUPPORT_SPECIALIST: {
    legacyRole: "SUPPORT_SPECIALIST",
    historicalPermissions: ["customers.view"],
    historicalEffectiveCapabilities: [
      "GET /api/v1/customers and GET /api/v1/customers/:id with restricted support projection (id, customerCode, displayName, status, createdAt, updatedAt only; contractReference, createdBy, updatedBy omitted by customerResponse in 1a982323db7f:src/domain.ts lines 86-97)",
      "Zero access to GET /api/v1/audit-events, GET /api/v1/operational-records, or any mutation endpoint",
    ],
    permissionDecompositionProof:
      "In pre-003 baseline (1a982323db7f:owner-licensing/backend/src/domain.ts lines 37 and 86-97), SUPPORT_SPECIALIST received ['customers.view'] in permissions() but customerResponse() restricted its projection to omit contractReference, createdBy, and updatedBy, and it lacked audit.view, operations.view, and operations.record. Assigning active LICENSE_OPERATOR or OWNER_ADMIN increases both read scope and write authority.",
    recommendedDisposition: {
      disposition: "DEACTIVATE",
      targetRole: "LICENSE_OPERATOR",
      preserveIsActive: false,
      privilegeImpact: "REDUCES",
    },
    allowedDispositions: [
      {
        disposition: "DEACTIVATE",
        targetRole: "LICENSE_OPERATOR",
        isActiveRule: "MUST_BE_FALSE",
        privilegeImpact: "REDUCES",
        requiresExplicitElevationFlag: false,
      },
      {
        disposition: "ELEVATE_PRIVILEGE",
        targetRole: "LICENSE_OPERATOR",
        isActiveRule: "TRUE_OR_FALSE",
        privilegeImpact: "INCREASES",
        requiresExplicitElevationFlag: true,
      },
      {
        disposition: "ELEVATE_PRIVILEGE",
        targetRole: "OWNER_ADMIN",
        isActiveRule: "TRUE_OR_FALSE",
        privilegeImpact: "INCREASES",
        requiresExplicitElevationFlag: true,
      },
    ],
    canAutomateWithoutExplicitDisposition: false,
    canPreserveWithoutPrivilegeIncrease: false,
    deploymentOwnerDecisionRequired:
      "SUPPORT_SPECIALIST had only restricted customer summary read access (omitting contractReference/attribution and lacking audit/operations access). Choose DEACTIVATE (isActive: false, targetRole: LICENSE_OPERATOR) to preserve least privilege, or explicitly authorize ELEVATE_PRIVILEGE with allowPrivilegeElevation: true.",
  },
};

export function isLegacyRole(value: unknown): value is LegacyRole {
  return legacyRoles.includes(value as LegacyRole);
}

export interface SafeUserUpgradeRow {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AccountDispositionInput {
  userId: string;
  username: string;
  fromRole: LegacyRole;
  disposition: DispositionKind;
  targetRole: Role;
  isActive: boolean;
  allowPrivilegeElevation?: boolean;
  reason: string;
}

export interface RoleUpgradePlanInput {
  authorizedByUserId: string;
  reason: string;
  dispositions: AccountDispositionInput[];
}

export interface ValidatedAccountDisposition extends AccountDispositionInput {
  previousIsActive: boolean;
  mustChangePassword: boolean;
  privilegeImpact: PrivilegeImpact;
}

export interface ValidatedRoleUpgradePlan {
  authorizedByUserId: string;
  reason: string;
  dispositions: ValidatedAccountDisposition[];
}

export class RoleUpgradeError extends Error {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`Legacy role upgrade validation failed: ${errors.join(" | ")}`);
    this.name = "RoleUpgradeError";
    this.errors = errors;
  }
}

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function trimmedText(
  value: unknown,
  field: string,
  min: number,
  max: number,
  errors: string[],
): string | null {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.push(
      `${field} must contain ${min}..${max} non-whitespace characters.`,
    );
    return null;
  }
  return trimmed;
}

export function evaluateDispositionPrivilege(
  fromRole: LegacyRole,
  previousIsActive: boolean,
  disposition: DispositionKind,
  targetRole: Role,
  isActive: boolean,
  allowPrivilegeElevation: boolean,
  label: string,
): { privilegeImpact: PrivilegeImpact; error?: string } {
  if (disposition === "DEACTIVATE") {
    if (isActive) {
      return {
        privilegeImpact: "REDUCES",
        error: `${label}: DEACTIVATE disposition requires isActive: false.`,
      };
    }
    if (fromRole !== "SYSTEM_ADMIN" && targetRole === "OWNER_ADMIN") {
      return {
        privilegeImpact: "INCREASES",
        error: `${label}: DEACTIVATE disposition for ${fromRole} must assign targetRole LICENSE_OPERATOR so reactivating the account later cannot grant administrative authority without explicit role assignment.`,
      };
    }
    return { privilegeImpact: "REDUCES" };
  }

  // If the account was active and is being set to inactive, disposition must be DEACTIVATE.
  if (previousIsActive && !isActive) {
    return {
      privilegeImpact: "REDUCES",
      error: `${label}: setting an active account to isActive: false requires disposition DEACTIVATE.`,
    };
  }

  // Activating an account that was previously inactive increases effective privileges from zero.
  const reactivatingInactive = !previousIsActive && isActive;

  if (fromRole === "SYSTEM_ADMIN") {
    if (reactivatingInactive) {
      if (disposition !== "ELEVATE_PRIVILEGE" || !allowPrivilegeElevation) {
        return {
          privilegeImpact: "INCREASES",
          error: `${label}: PrivilegeElevationDenied — activating a previously inactive SYSTEM_ADMIN account requires disposition ELEVATE_PRIVILEGE and allowPrivilegeElevation: true.`,
        };
      }
      return { privilegeImpact: "INCREASES" };
    }
    if (targetRole === "OWNER_ADMIN") {
      if (disposition !== "MAP_EQUIVALENT") {
        return {
          privilegeImpact: "PRESERVES",
          error: `${label}: SYSTEM_ADMIN -> OWNER_ADMIN must use disposition MAP_EQUIVALENT (or DEACTIVATE when isActive: false).`,
        };
      }
      return { privilegeImpact: "PRESERVES" };
    }
    // targetRole === "LICENSE_OPERATOR"
    if (disposition !== "RETAIN_REDUCED") {
      return {
        privilegeImpact: "REDUCES",
        error: `${label}: SYSTEM_ADMIN -> LICENSE_OPERATOR reduces privileges and must use disposition RETAIN_REDUCED (or DEACTIVATE when isActive: false).`,
      };
    }
    return { privilegeImpact: "REDUCES" };
  }

  if (fromRole === "LICENSE_ISSUANCE") {
    if (targetRole === "LICENSE_OPERATOR" && !reactivatingInactive) {
      if (disposition !== "RETAIN_REDUCED") {
        return {
          privilegeImpact: "REDUCES",
          error: `${label}: LICENSE_ISSUANCE -> LICENSE_OPERATOR removes server-replacement authorization and must use disposition RETAIN_REDUCED (not ${disposition}).`,
        };
      }
      return { privilegeImpact: "REDUCES" };
    }
    // Either targetRole === "OWNER_ADMIN" or reactivating an inactive account: privilege elevation!
    if (disposition !== "ELEVATE_PRIVILEGE" || !allowPrivilegeElevation) {
      return {
        privilegeImpact: "INCREASES",
        error: `${label}: PrivilegeElevationDenied — transitioning LICENSE_ISSUANCE to ${targetRole} (isActive: ${String(isActive)}) increases effective privileges and requires disposition ELEVATE_PRIVILEGE with allowPrivilegeElevation: true.`,
      };
    }
    return { privilegeImpact: "INCREASES" };
  }

  // READ_ONLY_OBSERVER or SUPPORT_SPECIALIST:
  // Keeping or making the account active in either MVP role increases effective privileges.
  if (isActive) {
    if (disposition !== "ELEVATE_PRIVILEGE" || !allowPrivilegeElevation) {
      return {
        privilegeImpact: "INCREASES",
        error: `${label}: PrivilegeElevationDenied — ${fromRole} had no write permissions; assigning active ${targetRole} increases effective privileges and requires disposition ELEVATE_PRIVILEGE with allowPrivilegeElevation: true (or use DEACTIVATE with isActive: false).`,
      };
    }
    return { privilegeImpact: "INCREASES" };
  }

  // Inactive READ_ONLY_OBSERVER / SUPPORT_SPECIALIST remaining inactive must use DEACTIVATE.
  return {
    privilegeImpact: "REDUCES",
    error: `${label}: inactive ${fromRole} must use disposition DEACTIVATE with targetRole LICENSE_OPERATOR and isActive: false.`,
  };
}

export function validateRoleUpgradePlan(
  users: readonly SafeUserUpgradeRow[],
  rawPlan: unknown,
): ValidatedRoleUpgradePlan {
  const errors: string[] = [];
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    throw new RoleUpgradeError(["Disposition plan must be a JSON object."]);
  }
  const planObj = rawPlan as Record<string, unknown>;
  const allowedTopKeys = ["authorizedByUserId", "reason", "dispositions"];
  for (const k of Object.keys(planObj)) {
    if (!allowedTopKeys.includes(k)) {
      errors.push(`Unknown top-level field '${k}' in disposition plan.`);
    }
  }
  const planReason = trimmedText(planObj.reason, "reason", 1, 500, errors);
  const usersById = new Map(users.map((u) => [u.id, u]));

  let authorizedByUserId: string | null = null;
  if (
    typeof planObj.authorizedByUserId !== "string" ||
    !ulidPattern.test(planObj.authorizedByUserId)
  ) {
    errors.push(
      "authorizedByUserId is required and must be a valid 26-character ULID of an active administrator.",
    );
  } else {
    const authUser = usersById.get(planObj.authorizedByUserId);
    if (!authUser) {
      errors.push(
        `authorizedByUserId '${planObj.authorizedByUserId}' does not match any existing user in owner.users.`,
      );
    } else if (!authUser.is_active) {
      errors.push(
        `authorizedByUserId '${planObj.authorizedByUserId}' belongs to an inactive account and cannot authorize role remediation.`,
      );
    } else if (
      authUser.role !== "OWNER_ADMIN" &&
      authUser.role !== "SYSTEM_ADMIN"
    ) {
      errors.push(
        `authorizedByUserId '${planObj.authorizedByUserId}' has role '${authUser.role}' and is not an active administrator.`,
      );
    } else {
      authorizedByUserId = planObj.authorizedByUserId;
    }
  }

  if (!Array.isArray(planObj.dispositions)) {
    errors.push("dispositions must be an array.");
    throw new RoleUpgradeError(errors);
  }

  const legacyUsers = users.filter((u) => !isRole(u.role));
  const seenUserIds = new Set<string>();
  const seenUsernames = new Set<string>();
  const validatedDispositions: ValidatedAccountDisposition[] = [];

  const allowedEntryKeys = [
    "userId",
    "username",
    "fromRole",
    "disposition",
    "targetRole",
    "isActive",
    "allowPrivilegeElevation",
    "reason",
  ];

  for (let i = 0; i < planObj.dispositions.length; i++) {
    const rawEntry = planObj.dispositions[i];
    const prefix = `dispositions[${i}]`;
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    for (const k of Object.keys(entry)) {
      if (!allowedEntryKeys.includes(k)) {
        errors.push(`${prefix}: unknown field '${k}'.`);
      }
    }
    const userId =
      typeof entry.userId === "string" && ulidPattern.test(entry.userId)
        ? entry.userId
        : null;
    if (!userId) {
      errors.push(`${prefix}: userId must be a valid 26-character ULID.`);
    }
    const username = trimmedText(
      entry.username,
      `${prefix}.username`,
      1,
      64,
      errors,
    );
    const fromRole = isLegacyRole(entry.fromRole) ? entry.fromRole : null;
    if (!fromRole) {
      errors.push(
        `${prefix}: fromRole must be one of ${legacyRoles.join(", ")}.`,
      );
    }
    const disposition = dispositionKinds.includes(
      entry.disposition as DispositionKind,
    )
      ? (entry.disposition as DispositionKind)
      : null;
    if (!disposition) {
      errors.push(
        `${prefix}: disposition must be one of ${dispositionKinds.join(", ")}.`,
      );
    }
    const targetRole = isRole(entry.targetRole) ? entry.targetRole : null;
    if (!targetRole) {
      errors.push(`${prefix}: targetRole must be one of ${roles.join(", ")}.`);
    }
    const isActive =
      typeof entry.isActive === "boolean" ? entry.isActive : null;
    if (isActive === null) {
      errors.push(`${prefix}: isActive must be a boolean.`);
    }
    if (
      entry.allowPrivilegeElevation !== undefined &&
      typeof entry.allowPrivilegeElevation !== "boolean"
    ) {
      errors.push(
        `${prefix}: allowPrivilegeElevation must be a boolean when provided.`,
      );
    }
    const allowPrivilegeElevation = entry.allowPrivilegeElevation === true;
    const entryReason = trimmedText(
      entry.reason,
      `${prefix}.reason`,
      1,
      500,
      errors,
    );

    if (userId) {
      if (seenUserIds.has(userId)) {
        errors.push(`${prefix}: duplicate disposition for userId '${userId}'.`);
      }
      seenUserIds.add(userId);
    }
    if (username) {
      if (seenUsernames.has(username)) {
        errors.push(
          `${prefix}: duplicate disposition for username '${username}'.`,
        );
      }
      seenUsernames.add(username);
    }

    if (!userId) continue;
    const dbUser = usersById.get(userId);
    if (!dbUser) {
      errors.push(
        `${prefix}: unknown userId '${userId}' (username '${username ?? "unknown"}').`,
      );
      continue;
    }
    if (isRole(dbUser.role)) {
      errors.push(
        `${prefix}: account '${dbUser.username}' (${dbUser.id}) already holds current role '${dbUser.role}' and cannot be remediated as a legacy account.`,
      );
      continue;
    }
    if (username && dbUser.username !== username) {
      errors.push(
        `${prefix}: username mismatch for userId '${userId}': database has '${dbUser.username}', disposition specified '${username}'.`,
      );
    }
    if (fromRole && dbUser.role !== fromRole) {
      errors.push(
        `${prefix}: fromRole mismatch for '${dbUser.username}' (${userId}): database has '${dbUser.role}', disposition specified '${fromRole}'.`,
      );
    }

    if (
      username &&
      fromRole &&
      dbUser.role === fromRole &&
      disposition &&
      targetRole &&
      isActive !== null &&
      entryReason
    ) {
      const check = evaluateDispositionPrivilege(
        fromRole,
        dbUser.is_active,
        disposition,
        targetRole,
        isActive,
        allowPrivilegeElevation,
        `${prefix} (${dbUser.username} / ${userId})`,
      );
      if (check.error) {
        errors.push(check.error);
      } else {
        validatedDispositions.push({
          userId,
          username,
          fromRole,
          disposition,
          targetRole,
          isActive,
          allowPrivilegeElevation,
          reason: entryReason,
          previousIsActive: dbUser.is_active,
          mustChangePassword: dbUser.must_change_password,
          privilegeImpact: check.privilegeImpact,
        });
      }
    }
  }

  for (const legacyUser of legacyUsers) {
    if (!seenUserIds.has(legacyUser.id)) {
      errors.push(
        `Missing disposition for legacy account '${legacyUser.username}' (${legacyUser.id}) with role '${legacyUser.role}'.`,
      );
    }
  }

  // Verify that if the database has any users, at least one active OWNER_ADMIN
  // will exist after remediation (LastAdminProtected), and that authorizedByUserId
  // is an active OWNER_ADMIN at execution time.
  if (users.length > 0 && errors.length === 0 && authorizedByUserId) {
    const dispositionByUserId = new Map(
      validatedDispositions.map((d) => [d.userId, d]),
    );
    let finalActiveAdmins = 0;
    for (const u of users) {
      const d = dispositionByUserId.get(u.id);
      const finalRole = d ? d.targetRole : u.role;
      const finalActive = d ? d.isActive : u.is_active;
      if (finalRole === "OWNER_ADMIN" && finalActive) {
        finalActiveAdmins++;
      }
    }
    if (finalActiveAdmins < 1) {
      errors.push(
        "LastAdminProtected: At least one active OWNER_ADMIN account must remain after legacy role remediation.",
      );
    }
    const authDisposition = dispositionByUserId.get(authorizedByUserId);
    const authUser = usersById.get(authorizedByUserId)!;
    const finalAuthRole = authDisposition
      ? authDisposition.targetRole
      : authUser.role;
    const finalAuthActive = authDisposition
      ? authDisposition.isActive
      : authUser.is_active;
    if (
      !authUser.is_active ||
      finalAuthRole !== "OWNER_ADMIN" ||
      !finalAuthActive ||
      (authDisposition && authDisposition.disposition !== "MAP_EQUIVALENT")
    ) {
      errors.push(
        `authorizedByUserId '${authorizedByUserId}' must belong to an active OWNER_ADMIN (or an active SYSTEM_ADMIN mapped to active OWNER_ADMIN via MAP_EQUIVALENT).`,
      );
    }
  }

  if (errors.length > 0 || !planReason || !authorizedByUserId) {
    throw new RoleUpgradeError(errors);
  }

  // Order dispositions so that if authorizedByUserId is a legacy SYSTEM_ADMIN being
  // transitioned to OWNER_ADMIN, it is upgraded to active OWNER_ADMIN first before
  // any other account remediation or audit event executes.
  const orderedDispositions = [...validatedDispositions].sort((a, b) => {
    if (a.userId === authorizedByUserId) return -1;
    if (b.userId === authorizedByUserId) return 1;
    return a.userId.localeCompare(b.userId);
  });

  return {
    authorizedByUserId,
    reason: planReason,
    dispositions: orderedDispositions,
  };
}

export interface RoleUpgradePreflightReport {
  migration003Applied: boolean;
  requiresRemediation: boolean;
  canRunAutomaticMigrate: boolean;
  activeOwnerAdminCount: number;
  currentRoleAccounts: {
    id: string;
    username: string;
    role: Role;
    isActive: boolean;
    mustChangePassword: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  legacyAccounts: {
    id: string;
    username: string;
    legacyRole: string;
    isActive: boolean;
    mustChangePassword: boolean;
    createdAt: string;
    updatedAt: string;
    historicalPermissions: readonly string[];
    historicalEffectiveCapabilities: readonly string[];
    permissionDecompositionProof: string;
    recommendedDisposition:
      LegacyRoleCompatibilityEntry["recommendedDisposition"] | null;
    allowedDispositions: LegacyRoleCompatibilityEntry["allowedDispositions"];
    deploymentOwnerDecisionRequired: string;
  }[];
  compatibilityMatrix: Record<LegacyRole, LegacyRoleCompatibilityEntry>;
  dispositionPlanTemplate: {
    authorizedByUserId: string;
    reason: string;
    dispositions: {
      userId: string;
      username: string;
      fromRole: string;
      disposition: DispositionKind;
      targetRole: Role;
      isActive: boolean;
      allowPrivilegeElevation: boolean;
      reason: string;
    }[];
  };
}

async function assertNotCustomerDatabase(tx: PoolClient) {
  const foreign = await tx.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name IN ('licensing','users','identity')",
  );
  if (foreign.rowCount)
    throw new Error("Refusing to migrate a customer Vardena database.");
}

async function querySafeUsersForUpgrade(
  tx: PoolClient,
  forUpdate: boolean,
): Promise<SafeUserUpgradeRow[]> {
  const lockClause = forUpdate ? " FOR UPDATE" : "";
  const res = await tx.query<SafeUserUpgradeRow>(
    `SELECT id, username, role, is_active, must_change_password, created_at, updated_at
     FROM owner.users
     ORDER BY id${lockClause}`,
  );
  return res.rows;
}

export async function preflightRoleUpgrade(
  db: Database,
): Promise<RoleUpgradePreflightReport> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(78153214)");
    await assertNotCustomerDatabase(tx);

    const hasUsersTable = (
      await tx.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='owner' AND table_name='users'",
      )
    ).rowCount;
    const hasLedgerTable = (
      await tx.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='owner_migrations'",
      )
    ).rowCount;

    const migration003Applied = Boolean(
      hasLedgerTable &&
      (
        await tx.query(
          "SELECT 1 FROM public.owner_migrations WHERE name='003-two-role-authorization.sql'",
        )
      ).rowCount,
    );

    const users = hasUsersTable
      ? await querySafeUsersForUpgrade(tx, false)
      : [];
    const currentRoleAccounts: RoleUpgradePreflightReport["currentRoleAccounts"] =
      [];
    const legacyAccounts: RoleUpgradePreflightReport["legacyAccounts"] = [];

    for (const u of users) {
      if (isRole(u.role)) {
        currentRoleAccounts.push({
          id: u.id,
          username: u.username,
          role: u.role,
          isActive: u.is_active,
          mustChangePassword: u.must_change_password,
          createdAt: u.created_at.toISOString(),
          updatedAt: u.updated_at.toISOString(),
        });
      } else {
        const compat = isLegacyRole(u.role)
          ? legacyRoleCompatibilityMatrix[u.role]
          : null;
        legacyAccounts.push({
          id: u.id,
          username: u.username,
          legacyRole: u.role,
          isActive: u.is_active,
          mustChangePassword: u.must_change_password,
          createdAt: u.created_at.toISOString(),
          updatedAt: u.updated_at.toISOString(),
          historicalPermissions: compat?.historicalPermissions ?? [],
          historicalEffectiveCapabilities:
            compat?.historicalEffectiveCapabilities ?? [],
          permissionDecompositionProof:
            compat?.permissionDecompositionProof ??
            "Unknown legacy role; explicit remediation required.",
          recommendedDisposition: compat?.recommendedDisposition ?? null,
          allowedDispositions: compat?.allowedDispositions ?? [],
          deploymentOwnerDecisionRequired:
            compat?.deploymentOwnerDecisionRequired ??
            "Unknown legacy role; explicit remediation required.",
        });
      }
    }

    const activeOwnerAdminCount = currentRoleAccounts.filter(
      (u) => u.role === "OWNER_ADMIN" && u.isActive,
    ).length;

    const candidateAdmin =
      currentRoleAccounts.find((u) => u.role === "OWNER_ADMIN" && u.isActive)
        ?.id ??
      legacyAccounts.find((u) => u.legacyRole === "SYSTEM_ADMIN" && u.isActive)
        ?.id ??
      "<REQUIRED_ACTIVE_OWNER_ADMIN_USER_ID>";

    return {
      migration003Applied,
      requiresRemediation: legacyAccounts.length > 0,
      canRunAutomaticMigrate: legacyAccounts.length === 0,
      activeOwnerAdminCount,
      currentRoleAccounts,
      legacyAccounts,
      compatibilityMatrix: legacyRoleCompatibilityMatrix,
      dispositionPlanTemplate: {
        authorizedByUserId: candidateAdmin,
        reason:
          "Phase 1.3 two-role authorization upgrade disposition authorized by deployment owner",
        dispositions: legacyAccounts.map((u) => {
          const rec = u.recommendedDisposition;
          const preserveActive = rec
            ? rec.preserveIsActive && u.isActive
            : false;
          const disposition: DispositionKind =
            !u.isActive || !preserveActive
              ? "DEACTIVATE"
              : (rec?.disposition ?? "DEACTIVATE");
          const targetRole: Role =
            disposition === "DEACTIVATE" && u.legacyRole !== "SYSTEM_ADMIN"
              ? "LICENSE_OPERATOR"
              : (rec?.targetRole ?? "LICENSE_OPERATOR");
          return {
            userId: u.id,
            username: u.username,
            fromRole: u.legacyRole,
            disposition,
            targetRole,
            isActive: preserveActive,
            allowPrivilegeElevation: false,
            reason: `Authorized ${disposition} transition from ${u.legacyRole} to ${targetRole}`,
          };
        }),
      },
    };
  });
}

interface PriorRemediationAuditRow {
  target_id: string;
  actor_id: string | null;
  reason: string | null;
  before_state: {
    username?: string;
    role?: string;
    isActive?: boolean;
    mustChangePassword?: boolean;
  } | null;
  after_state: {
    username?: string;
    role?: string;
    isActive?: boolean;
    mustChangePassword?: boolean;
  } | null;
}

async function validateIdempotentAlreadyAppliedPlan(
  tx: PoolClient,
  users: readonly SafeUserUpgradeRow[],
  rawPlan: unknown,
): Promise<void> {
  const priorAudits = (
    await tx.query<PriorRemediationAuditRow>(
      `SELECT target_id, actor_id, reason, before_state, after_state
       FROM owner.audit_events
       WHERE event_type = 'USER_LEGACY_ROLE_REMEDIATED'
       ORDER BY sequence ASC`,
    )
  ).rows;

  const latestAuditByTargetId = new Map<string, PriorRemediationAuditRow>();
  for (const row of priorAudits) {
    latestAuditByTargetId.set(row.target_id, row);
  }

  // Reconstruct the pre-remediation user rows from the recorded audit trail so
  // the full validateRoleUpgradePlan validation (field allowlists, mandatory
  // authorizedByUserId, complete account coverage, privilege-elevation rules,
  // and LastAdminProtected) executes identically on repeated runs.
  const reconstructedPreUpgradeUsers: SafeUserUpgradeRow[] = users.map((u) => {
    const prior = latestAuditByTargetId.get(u.id);
    if (!prior || !prior.before_state) return u;
    return {
      ...u,
      role:
        typeof prior.before_state.role === "string"
          ? prior.before_state.role
          : u.role,
      is_active:
        typeof prior.before_state.isActive === "boolean"
          ? prior.before_state.isActive
          : u.is_active,
    };
  });

  const validated = validateRoleUpgradePlan(
    reconstructedPreUpgradeUsers,
    rawPlan,
  );

  const errors: string[] = [];
  const currentUsersById = new Map(users.map((u) => [u.id, u]));
  const currentAuthUser = currentUsersById.get(validated.authorizedByUserId);
  if (
    !currentAuthUser ||
    !currentAuthUser.is_active ||
    currentAuthUser.role !== "OWNER_ADMIN"
  ) {
    errors.push(
      `authorizedByUserId '${validated.authorizedByUserId}' must currently be an active OWNER_ADMIN account.`,
    );
  }

  for (const d of validated.dispositions) {
    const currentUser = currentUsersById.get(d.userId);
    const prior = latestAuditByTargetId.get(d.userId);
    if (!currentUser) {
      errors.push(`Unknown userId '${d.userId}'.`);
      continue;
    }
    if (
      currentUser.role !== d.targetRole ||
      currentUser.is_active !== d.isActive
    ) {
      errors.push(
        `Account '${currentUser.username}' (${d.userId}) currently has role='${currentUser.role}', isActive=${String(currentUser.is_active)}, which contradicts disposition targetRole='${d.targetRole}', isActive=${String(d.isActive)}.`,
      );
    }
    if (prior) {
      const expectedReason = `[${d.disposition}] ${d.reason}`.slice(0, 500);
      if (prior.actor_id !== validated.authorizedByUserId) {
        errors.push(
          `Account '${currentUser.username}' (${d.userId}) was remediated under authorizedByUserId '${String(prior.actor_id)}', not '${validated.authorizedByUserId}'.`,
        );
      }
      if (prior.reason !== expectedReason) {
        errors.push(
          `Account '${currentUser.username}' (${d.userId}) disposition reason/kind does not match the recorded remediation audit.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new RoleUpgradeError(errors);
  }
}

export interface RemediateLegacyRolesResult {
  status: "APPLIED" | "ALREADY_APPLIED";
  remediatedCount: number;
  migrationApplied: boolean;
}

export interface RemediateLegacyRolesOptions {
  /** Test-only hook invoked inside the transaction after user updates/audit writes and before 003 SQL runs. */
  beforeMigration003Hook?: (tx: PoolClient) => Promise<void> | void;
}

export async function remediateLegacyRolesAndMigrate(
  db: Database,
  rawPlan: unknown,
  options?: RemediateLegacyRolesOptions,
): Promise<RemediateLegacyRolesResult> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(78153214)");
    await assertNotCustomerDatabase(tx);
    await tx.query(
      "CREATE TABLE IF NOT EXISTS public.owner_migrations(name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
    );
    const folder = fileURLToPath(new URL("../migrations/", import.meta.url));
    const files = (await readdir(folder))
      .filter((n) => /^\d+.*\.sql$/.test(n))
      .sort();
    const ledger = await tx.query<{ name: string; checksum: string }>(
      "SELECT name,checksum FROM public.owner_migrations",
    );
    if (ledger.rows.some((r) => !files.includes(r.name)))
      throw new Error("Missing applied migration.");

    // Ensure pre-003 migrations (001, 002) are verified/applied first.
    for (const name of files) {
      if (name >= "003-two-role-authorization.sql") break;
      const sql = await readFile(`${folder}/${name}`, "utf8");
      const previous = ledger.rows.find((r) => r.name === name);
      if (previous && previous.checksum !== digest(sql))
        throw new Error("Applied migration checksum mismatch.");
      if (!previous) {
        await tx.query(sql);
        await tx.query(
          "INSERT INTO public.owner_migrations(name,checksum) VALUES($1,$2)",
          [name, digest(sql)],
        );
      }
    }

    const users = await querySafeUsersForUpgrade(tx, true);
    const legacyUsers = users.filter((u) => !isRole(u.role));
    const sql003 = await readFile(
      `${folder}/003-two-role-authorization.sql`,
      "utf8",
    );
    const prev003 = ledger.rows.find(
      (r) => r.name === "003-two-role-authorization.sql",
    );
    if (prev003 && prev003.checksum !== digest(sql003))
      throw new Error("Applied migration checksum mismatch.");

    // Safe idempotent re-run when 003 is already applied and no legacy rows remain.
    if (prev003 && legacyUsers.length === 0) {
      await validateIdempotentAlreadyAppliedPlan(tx, users, rawPlan);
      return {
        status: "ALREADY_APPLIED",
        remediatedCount: 0,
        migrationApplied: false,
      };
    }

    const plan = validateRoleUpgradePlan(users, rawPlan);

    if (plan.dispositions.length > 0) {
      await tx.query(
        "ALTER TABLE owner.users DROP CONSTRAINT IF EXISTS users_role_check",
      );
      for (const d of plan.dispositions) {
        await tx.query(
          "UPDATE owner.users SET role=$1, is_active=$2, updated_at=clock_timestamp() WHERE id=$3",
          [d.targetRole, d.isActive, d.userId],
        );
        await tx.query(
          "UPDATE owner.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL",
          [d.userId],
        );
        await audit(tx, {
          actor: plan.authorizedByUserId,
          type: "USER_LEGACY_ROLE_REMEDIATED",
          targetType: "User",
          targetId: d.userId,
          reason: `[${d.disposition}] ${d.reason}`.slice(0, 500),
          before: {
            username: d.username,
            role: d.fromRole,
            isActive: d.previousIsActive,
            mustChangePassword: d.mustChangePassword,
          },
          after: {
            username: d.username,
            role: d.targetRole,
            isActive: d.isActive,
            mustChangePassword: d.mustChangePassword,
          },
        });
      }
    }

    // Verify that the authorizing account is now an active OWNER_ADMIN in owner.users.
    const authCheck = (
      await tx.query<{ role: string; is_active: boolean }>(
        "SELECT role, is_active FROM owner.users WHERE id=$1",
        [plan.authorizedByUserId],
      )
    ).rows[0];
    if (
      !authCheck ||
      !authCheck.is_active ||
      authCheck.role !== "OWNER_ADMIN"
    ) {
      throw new RoleUpgradeError([
        `authorizedByUserId '${plan.authorizedByUserId}' is not an active OWNER_ADMIN at remediation execution time.`,
      ]);
    }

    if (options?.beforeMigration003Hook) {
      await options.beforeMigration003Hook(tx);
    }

    for (const name of files) {
      if (name < "003-two-role-authorization.sql") continue;
      const sql = await readFile(`${folder}/${name}`, "utf8");
      const previous = ledger.rows.find((r) => r.name === name);
      if (previous && previous.checksum !== digest(sql))
        throw new Error("Applied migration checksum mismatch.");
      if (!previous) {
        await tx.query(sql);
        await tx.query(
          "INSERT INTO public.owner_migrations(name,checksum) VALUES($1,$2)",
          [name, digest(sql)],
        );
      }
    }

    return {
      status: "APPLIED",
      remediatedCount: plan.dispositions.length,
      migrationApplied: !prev003,
    };
  });
}
