import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { LicenseArtifactStore, sha256Bytes } from "./artifact-store.js";

/**
 * OD-LIC-19 backup and restore verification for the signed-artifact archive.
 *
 * The archive is two stores with different lifecycles:
 *
 *  - PostgreSQL holds the authoritative metadata (`owner.license_artifacts`:
 *    digest, byte size, store key, target, settlement status), and
 *  - the filesystem holds the exact original bytes under `OWNER_LICENSE_ARTIFACT_DIR`.
 *
 * They are **not** one atomic transaction. The database row is written PENDING,
 * the file is written once and fsynced, and only then is the row settled
 * DURABLE (`archiveArtifact`); `reconcileArtifacts` repairs or quarantines the
 * states a crash can leave. A backup therefore always captures the
 * two stores separately and must be verified, never assumed consistent.
 *
 * These helpers verify bytes against the authoritative metadata by SHA-256
 * **and** byte size, and never repair, regenerate or adopt anything. Recovery
 * restores the original bytes from a backup — a missing or damaged artifact is
 * reported, never reconstructed and presented as the original.
 */

export const ARTIFACT_BACKUP_FORMAT = "VARDENA-OWNER-ARTIFACT-BACKUP";
export const ARTIFACT_BACKUP_VERSION = 1;
export const ARTIFACT_MANIFEST_FILE = "artifact-manifest.json";

export interface ArtifactRow {
  id: string;
  kind: "LICENSE" | "REVOCATION";
  issuance_id: string | null;
  revocation_id: string | null;
  sha256: string;
  byte_size: number;
  store_key: string;
  original_file_name: string;
  status: "PENDING" | "DURABLE" | "QUARANTINED";
}

export interface ArtifactBackupEntry {
  artifactId: string;
  kind: "LICENSE" | "REVOCATION";
  /** The issuance or revocation the artifact belongs to. */
  targetId: string | null;
  sha256: string;
  byteSize: number;
  storeKey: string;
  originalFileName: string;
  status: "PENDING" | "DURABLE" | "QUARANTINED";
}

export interface ArtifactBackupManifest {
  format: typeof ARTIFACT_BACKUP_FORMAT;
  version: typeof ARTIFACT_BACKUP_VERSION;
  createdAt: string;
  artifacts: ArtifactBackupEntry[];
}

export type ArtifactFileOutcome =
  "INTACT" | "MISSING" | "SIZE_MISMATCH" | "DIGEST_MISMATCH";

export interface ArtifactVerificationRow {
  artifactId: string;
  storeKey: string;
  status: ArtifactBackupEntry["status"];
  verified: ArtifactFileOutcome;
  expectedByteSize: number;
  actualByteSize: number | null;
  expectedSha256: string;
  actualSha256: string | null;
}

export interface ArtifactVerificationReport {
  /** True only when every row is DURABLE and intact and no orphan file exists. */
  ok: boolean;
  /** Set when verification could not even read the store itself. */
  error?: string;
  rows: ArtifactVerificationRow[];
  /** Files present under the artifact root that no manifest/row describes. */
  orphanFiles: string[];
  /** Rows whose bytes verify but whose registration never settled. */
  unsettled: string[];
}

export async function readArtifactRows(tx: PoolClient): Promise<ArtifactRow[]> {
  return (
    await tx.query<ArtifactRow>(
      `SELECT id,kind,issuance_id,revocation_id,sha256,byte_size,store_key,
              original_file_name,status
         FROM owner.license_artifacts
        ORDER BY store_key`,
    )
  ).rows;
}

export function artifactBackupManifest(
  rows: readonly ArtifactRow[],
  now = new Date(),
): ArtifactBackupManifest {
  return {
    format: ARTIFACT_BACKUP_FORMAT,
    version: ARTIFACT_BACKUP_VERSION,
    createdAt: now.toISOString(),
    artifacts: rows.map((row) => ({
      artifactId: row.id,
      kind: row.kind,
      targetId: row.issuance_id ?? row.revocation_id,
      sha256: row.sha256,
      byteSize: row.byte_size,
      storeKey: row.store_key,
      originalFileName: row.original_file_name,
      status: row.status,
    })),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict reader for a manifest file; a malformed backup fails closed. */
export function parseArtifactBackupManifest(
  value: unknown,
): ArtifactBackupManifest {
  if (!isObject(value)) throw new Error("Artifact manifest is not an object.");
  if (value.format !== ARTIFACT_BACKUP_FORMAT)
    throw new Error("Artifact manifest format is not recognised.");
  if (value.version !== ARTIFACT_BACKUP_VERSION)
    throw new Error("Artifact manifest version is not supported.");
  if (typeof value.createdAt !== "string" || !Array.isArray(value.artifacts))
    throw new Error("Artifact manifest is incomplete.");
  const artifacts = value.artifacts.map((item: unknown) => {
    if (!isObject(item)) throw new Error("Artifact manifest entry is invalid.");
    const {
      artifactId,
      kind,
      targetId,
      sha256,
      byteSize,
      storeKey,
      originalFileName,
      status,
    } = item;
    if (typeof artifactId !== "string" || artifactId.length === 0)
      throw new Error("Artifact manifest entry has no artifact id.");
    if (kind !== "LICENSE" && kind !== "REVOCATION")
      throw new Error("Artifact manifest entry has an invalid kind.");
    if (targetId !== null && typeof targetId !== "string")
      throw new Error("Artifact manifest entry has an invalid target.");
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))
      throw new Error("Artifact manifest entry has an invalid digest.");
    if (
      typeof byteSize !== "number" ||
      !Number.isInteger(byteSize) ||
      byteSize <= 0
    )
      throw new Error("Artifact manifest entry has an invalid byte size.");
    if (typeof storeKey !== "string")
      throw new Error("Artifact manifest entry has no store key.");
    if (typeof originalFileName !== "string" || originalFileName.length === 0)
      throw new Error("Artifact manifest entry has no file name.");
    if (
      status !== "PENDING" &&
      status !== "DURABLE" &&
      status !== "QUARANTINED"
    )
      throw new Error("Artifact manifest entry has an invalid status.");
    return {
      artifactId,
      kind,
      targetId: targetId ?? null,
      sha256,
      byteSize,
      storeKey,
      originalFileName,
      status,
    } satisfies ArtifactBackupEntry;
  });
  return {
    format: ARTIFACT_BACKUP_FORMAT,
    version: ARTIFACT_BACKUP_VERSION,
    createdAt: value.createdAt,
    artifacts,
  };
}

function classify(
  entry: Pick<ArtifactBackupEntry, "sha256" | "byteSize">,
  bytes: Buffer | null,
): {
  verified: ArtifactFileOutcome;
  actualByteSize: number | null;
  actualSha256: string | null;
} {
  if (bytes === null)
    return { verified: "MISSING", actualByteSize: null, actualSha256: null };
  const actualSha256 = sha256Bytes(bytes);
  if (bytes.length !== entry.byteSize)
    return {
      verified: "SIZE_MISMATCH",
      actualByteSize: bytes.length,
      actualSha256,
    };
  if (actualSha256 !== entry.sha256)
    return {
      verified: "DIGEST_MISMATCH",
      actualByteSize: bytes.length,
      actualSha256,
    };
  return { verified: "INTACT", actualByteSize: bytes.length, actualSha256 };
}

/**
 * Read-only verification of a store against a manifest. It never writes,
 * repairs or quarantines anything: a restore is accepted only when every row's
 * exact bytes are present and settled, and no unaccounted file exists.
 */
export async function verifyArtifactsAgainstManifest(
  manifest: ArtifactBackupManifest,
  store: LicenseArtifactStore,
): Promise<ArtifactVerificationReport> {
  const rows: ArtifactVerificationRow[] = [];
  for (const entry of manifest.artifacts) {
    let bytes: Buffer | null = null;
    try {
      bytes = await store.read(entry.storeKey);
    } catch {
      bytes = null;
    }
    const result = classify(entry, bytes);
    rows.push({
      artifactId: entry.artifactId,
      storeKey: entry.storeKey,
      status: entry.status,
      ...result,
      expectedByteSize: entry.byteSize,
      expectedSha256: entry.sha256,
    });
  }
  let orphanFiles: string[];
  try {
    const known = new Set(manifest.artifacts.map((entry) => entry.storeKey));
    orphanFiles = (await store.listKeys()).filter((key) => !known.has(key));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "store unreadable",
      rows,
      orphanFiles: [],
      unsettled: rows
        .filter((row) => row.status !== "DURABLE")
        .map((row) => row.storeKey),
    };
  }
  const unsettled = rows
    .filter((row) => row.status !== "DURABLE")
    .map((row) => row.storeKey);
  return {
    ok:
      rows.every((row) => row.verified === "INTACT") &&
      unsettled.length === 0 &&
      orphanFiles.length === 0,
    rows,
    orphanFiles,
    unsettled,
  };
}

/** Verify the live archive against the authoritative database metadata. */
export async function verifyArtifactStore(
  tx: PoolClient,
  store: LicenseArtifactStore,
): Promise<ArtifactVerificationReport> {
  return verifyArtifactsAgainstManifest(
    artifactBackupManifest(await readArtifactRows(tx)),
    store,
  );
}

/**
 * Copy the exact original bytes into a backup root and write a manifest.
 *
 * The source is verified before anything is copied, so a backup never silently
 * captures corruption or a missing file. A `QUARANTINED` row is excluded and
 * reported: its bytes already failed verification when reconciliation
 * quarantined them, so they are not a restorable original and the manifest must
 * not claim them. Nothing is ever regenerated.
 */
export async function writeArtifactBackup(
  rows: readonly ArtifactRow[],
  readSource: (storeKey: string) => Promise<Buffer>,
  destinationDir: string,
  now = new Date(),
): Promise<{
  manifest: ArtifactBackupManifest;
  verification: ArtifactVerificationReport;
  excluded: string[];
}> {
  const destination = new LicenseArtifactStore(destinationDir);
  const problems: string[] = [];
  const excluded: string[] = [];
  const copied: ArtifactRow[] = [];
  const bytesByKey = new Map<string, Buffer>();
  for (const row of rows) {
    let bytes: Buffer | null = null;
    try {
      bytes = await readSource(row.store_key);
    } catch {
      bytes = null;
    }
    if (row.status === "QUARANTINED") {
      excluded.push(row.store_key);
      continue;
    }
    const result = classify(
      { sha256: row.sha256, byteSize: row.byte_size },
      bytes,
    );
    if (result.verified !== "INTACT") {
      problems.push(
        `${row.store_key}: ${result.verified}` +
          (result.actualByteSize === null
            ? ""
            : ` (expected ${row.byte_size} bytes, found ${result.actualByteSize})`),
      );
      continue;
    }
    copied.push(row);
    bytesByKey.set(row.store_key, bytes!);
  }
  if (problems.length > 0)
    throw new Error(
      `Artifact backup refused; the source archive is not verifiable:\n${problems.join("\n")}`,
    );
  const manifest = artifactBackupManifest(copied, now);
  for (const entry of manifest.artifacts)
    await destination.writeOnce(
      entry.storeKey,
      bytesByKey.get(entry.storeKey)!,
    );
  await mkdir(destinationDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(destinationDir, ARTIFACT_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o444 },
  );
  const verification = await verifyArtifactsAgainstManifest(
    manifest,
    destination,
  );
  if (!verification.ok)
    throw new Error("Artifact backup failed its own read-back verification.");
  return { manifest, verification, excluded };
}

/** Backup the archive: read-only for the source, fail-closed on any mismatch. */
export async function backupArtifacts(
  tx: PoolClient,
  source: LicenseArtifactStore,
  destinationDir: string,
): Promise<{
  manifest: ArtifactBackupManifest;
  verification: ArtifactVerificationReport;
  excluded: string[];
}> {
  const rows = await readArtifactRows(tx);
  return writeArtifactBackup(
    rows,
    (storeKey) => source.read(storeKey),
    destinationDir,
  );
}

/** Load and verify a backup bundle before it is used to restore a live archive. */
export async function verifyArtifactBackup(
  backupDir: string,
): Promise<ArtifactVerificationReport> {
  const raw = await readFile(
    path.join(backupDir, ARTIFACT_MANIFEST_FILE),
    "utf8",
  );
  const manifest = parseArtifactBackupManifest(JSON.parse(raw));
  return verifyArtifactsAgainstManifest(
    manifest,
    new LicenseArtifactStore(backupDir),
  );
}
