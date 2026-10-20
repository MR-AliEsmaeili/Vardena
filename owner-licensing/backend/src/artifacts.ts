import "dotenv/config";
import { fileURLToPath } from "node:url";
import { LicenseArtifactStore } from "./artifact-store.js";
import {
  ARTIFACT_MANIFEST_FILE,
  backupArtifacts,
  verifyArtifactBackup,
  verifyArtifactStore,
  type ArtifactVerificationReport,
} from "./artifact-backup.js";
import { config } from "./config.js";
import { Database } from "./db.js";

/**
 * OD-LIC-19 archive tooling.
 *
 *   npm run artifacts:backup -- --destination /absolute/backup-root
 *   npm run artifacts:verify -- --directory /absolute/artifact-root
 *       (verifies the live archive against `owner.license_artifacts`)
 *   npm run artifacts:verify -- --backup /absolute/backup-root
 *       (verifies a backup bundle against its own manifest, before restore)
 *
 * Verification is read-only. It exits non-zero unless every artifact is
 * DURABLE and byte-identical (size and SHA-256) and no unaccounted file exists.
 * The database itself is backed up with PostgreSQL's own tooling (pg_dump);
 * this tool never writes to the source archive and never regenerates bytes.
 */

const usage = [
  "Usage:",
  "  artifacts backup --destination <absolute directory>",
  "  artifacts verify [--directory <absolute directory>]",
  "  artifacts verify --backup <absolute directory>",
].join("\n");

function parse(argv: string[]) {
  const command = argv[0];
  if (command !== "backup" && command !== "verify") throw new Error(usage);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!arg.startsWith("--")) throw new Error(usage);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for ${arg}.`);
    values.set(arg.slice(2), value);
    index += 1;
  }
  const known =
    command === "backup" ? ["destination"] : ["directory", "backup"];
  for (const name of values.keys())
    if (!known.includes(name)) throw new Error(usage);
  const destination = values.get("destination");
  const directory = values.get("directory");
  const backup = values.get("backup");
  if (command === "backup" && destination === undefined) throw new Error(usage);
  if (command === "verify" && backup !== undefined && directory !== undefined)
    throw new Error("Choose either --directory or --backup.");
  return { command, destination, directory, backup };
}

function report(label: string, verification: ArtifactVerificationReport) {
  process.stdout.write(
    `${JSON.stringify(
      {
        check: label,
        ok: verification.ok,
        artifacts: verification.rows.length,
        intact: verification.rows.filter((row) => row.verified === "INTACT")
          .length,
        unsettled: verification.unsettled,
        orphanFiles: verification.orphanFiles,
        problems: verification.rows.filter((row) => row.verified !== "INTACT"),
        ...(verification.error === undefined
          ? {}
          : { error: verification.error }),
      },
      null,
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  if (args.command === "verify" && args.backup !== undefined) {
    const verification = await verifyArtifactBackup(args.backup);
    report(`backup:${args.backup}:${ARTIFACT_MANIFEST_FILE}`, verification);
    if (!verification.ok) process.exitCode = 1;
    return;
  }
  const cfg = config();
  const artifactDir = args.directory ?? cfg.artifactDir;
  if (artifactDir === undefined)
    throw new Error("OWNER_LICENSE_ARTIFACT_DIR is not configured.");
  const store = new LicenseArtifactStore(artifactDir);
  const db = new Database(cfg.databaseUrl);
  const client = await db.pool.connect();
  try {
    if (args.command === "backup") {
      const { verification, excluded } = await backupArtifacts(
        client,
        store,
        args.destination!,
      );
      report(`backup:${args.destination}`, verification);
      if (excluded.length > 0)
        process.stdout.write(
          `${JSON.stringify({ excludedFromBackup: excluded }, null, 2)}\n`,
        );
      return;
    }
    const verification = await verifyArtifactStore(client, store);
    report(`archive:${artifactDir}`, verification);
    if (!verification.ok) process.exitCode = 1;
  } finally {
    client.release();
    await db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "artifact tooling failed"}\n`,
    );
    process.exitCode = 1;
  });
}
