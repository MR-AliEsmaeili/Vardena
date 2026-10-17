import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Database } from "./db.js";
import { config } from "./config.js";
import { validatedMigrationChain } from "./migration-ledger.js";
import {
  RoleUpgradeError,
  preflightRoleUpgrade,
  remediateLegacyRolesAndMigrate,
} from "./role-upgrade.js";

export {
  RoleUpgradeError,
  dispositionKinds,
  evaluateDispositionPrivilege,
  isLegacyRole,
  legacyRoleCompatibilityMatrix,
  legacyRoles,
  preflightRoleUpgrade,
  remediateLegacyRolesAndMigrate,
  validateRoleUpgradePlan,
  type AccountDispositionInput,
  type DispositionKind,
  type LegacyRole,
  type LegacyRoleCompatibilityEntry,
  type PrivilegeImpact,
  type RemediateLegacyRolesOptions,
  type RemediateLegacyRolesResult,
  type RoleUpgradePlanInput,
  type RoleUpgradePreflightReport,
  type SafeUserUpgradeRow,
  type ValidatedAccountDisposition,
  type ValidatedRoleUpgradePlan,
} from "./role-upgrade.js";

export async function migrate(db: Database) {
  // Entire chain and its ledger commit together; advisory lock serializes deploys.
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(78153214)");
    const foreign = await tx.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name IN ('licensing','users','identity')",
    );
    if (foreign.rowCount)
      throw new Error("Refusing to migrate a customer Vardena database.");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS public.owner_migrations(name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
    );
    const { chain, ledger } = await validatedMigrationChain(tx);
    for (const { name, sql, checksum } of chain) {
      const previous = ledger.find((r) => r.name === name);
      if (!previous) {
        await tx.query(sql);
        await tx.query(
          "INSERT INTO public.owner_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
      }
    }
  });
}

export async function runMigrateCli(
  db: Database,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (args.includes("--preflight")) {
    const report = await preflightRoleUpgrade(db);
    return JSON.stringify(report, null, 2);
  }
  const remediateIdx = args.indexOf("--remediate-roles");
  if (remediateIdx !== -1) {
    const filePath =
      args[remediateIdx + 1] ?? env.OWNER_ROLE_DISPOSITIONS_FILE ?? "";
    if (!filePath || filePath.startsWith("--")) {
      throw new Error(
        "Missing dispositions JSON path. Usage: npm run migrate:remediate-roles -- <dispositions.json>",
      );
    }
    const rawJson = await readFile(filePath, "utf8");
    const parsed = JSON.parse(rawJson) as unknown;
    const outcome = await remediateLegacyRolesAndMigrate(db, parsed);
    return JSON.stringify(outcome, null, 2);
  }
  await migrate(db);
  return "Owner migrations verified/applied.";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = new Database(config().databaseUrl);
  try {
    const output = await runMigrateCli(db, process.argv.slice(2));
    console.log(output);
  } catch (error) {
    if (error instanceof RoleUpgradeError) {
      console.error(error.message);
    } else if (
      error instanceof Error &&
      error.message.includes(
        "Refusing to apply two-role constraint while superseded four-role user rows exist",
      )
    ) {
      console.error(error.message);
    } else {
      console.error(
        "Owner migration failed; verify configuration and migration ledger.",
      );
    }
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
