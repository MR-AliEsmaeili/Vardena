import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { LicenseArtifactStore, sha256Bytes } from "../src/artifact-store.js";
import {
  ARTIFACT_MANIFEST_FILE,
  artifactBackupManifest,
  parseArtifactBackupManifest,
  verifyArtifactBackup,
  verifyArtifactsAgainstManifest,
  writeArtifactBackup,
  type ArtifactRow,
} from "../src/artifact-backup.js";

/**
 * OD-LIC-19: the backup/restore verification contract.
 *
 * These cases prove the read-only verifier that gates a restore: exact bytes by
 * byte size and SHA-256 against the authoritative metadata, absent and damaged
 * files reported (never repaired or regenerated), unaccounted files surfaced,
 * and a backup that refuses to copy a source it cannot verify. The
 * PostgreSQL-backed whole-archive and recovery cases live in
 * `licensing-lifecycle.test.ts`.
 */

let root: string;
let backupRoot: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "vardena-owner-backup-src-"));
  backupRoot = await mkdtemp(
    path.join(os.tmpdir(), "vardena-owner-backup-dst-"),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(backupRoot, { recursive: true, force: true });
});

const licenseBytes = Buffer.from(
  '{"license":"exact-original-bytes"}\n',
  "utf8",
);
const revocationBytes = Buffer.from(
  '{"revocation":"exact-original"}\n',
  "utf8",
);

function licenseRow(
  bytes: Buffer,
  overrides: Partial<ArtifactRow> = {},
): ArtifactRow {
  const issuanceId = overrides.issuance_id ?? ulid();
  return {
    id: ulid(),
    kind: "LICENSE",
    issuance_id: issuanceId,
    revocation_id: null,
    sha256: sha256Bytes(bytes),
    byte_size: bytes.length,
    store_key: `licenses/${issuanceId.slice(0, 4)}/${issuanceId}.json`,
    original_file_name: "vardena-license.json",
    status: "DURABLE",
    ...overrides,
  };
}

function revocationRow(
  bytes: Buffer,
  overrides: Partial<ArtifactRow> = {},
): ArtifactRow {
  const revocationId = overrides.revocation_id ?? ulid();
  return {
    id: ulid(),
    kind: "REVOCATION",
    issuance_id: null,
    revocation_id: revocationId,
    sha256: sha256Bytes(bytes),
    byte_size: bytes.length,
    store_key: `revocations/${revocationId.slice(0, 4)}/${revocationId}.json`,
    original_file_name: "vardena-revocation.json",
    status: "DURABLE",
    ...overrides,
  };
}

async function seed() {
  const store = new LicenseArtifactStore(root);
  const license = licenseRow(licenseBytes);
  const revocation = revocationRow(revocationBytes);
  await store.writeOnce(license.store_key, licenseBytes);
  await store.writeOnce(revocation.store_key, revocationBytes);
  return {
    store,
    license,
    revocation,
    manifest: artifactBackupManifest([license, revocation]),
  };
}

/** Stored artifacts are read-only; damaging one for a test needs +w first. */
async function replaceBytes(rootDir: string, storeKey: string, bytes: Buffer) {
  const target = path.join(rootDir, storeKey);
  await chmod(target, 0o644);
  await writeFile(target, bytes);
}

async function truncateBytes(rootDir: string, storeKey: string, size: number) {
  const target = path.join(rootDir, storeKey);
  await chmod(target, 0o644);
  await truncate(target, size);
}

describe("artifact backup verification (OD-LIC-19)", () => {
  it("accepts a store whose exact bytes match size and SHA-256", async () => {
    const { store, manifest } = await seed();
    const report = await verifyArtifactsAgainstManifest(manifest, store);
    expect(report.ok).toBe(true);
    expect(report.rows.map((r) => r.verified)).toEqual(["INTACT", "INTACT"]);
    expect(report.orphanFiles).toEqual([]);
    expect(report.unsettled).toEqual([]);
  });

  it("reports a database row without a file as MISSING and never recreates it", async () => {
    const { store, manifest, license } = await seed();
    await unlink(path.join(root, license.store_key));
    const report = await verifyArtifactsAgainstManifest(manifest, store);
    expect(report.ok).toBe(false);
    const missing = report.rows.find((r) => r.storeKey === license.store_key)!;
    expect(missing.verified).toBe("MISSING");
    expect(missing.actualByteSize).toBeNull();
    // Nothing was written back: recovery means restoring the original bytes.
    await expect(store.read(license.store_key)).rejects.toThrow();
  });

  it("reports a truncated file as SIZE_MISMATCH before the digest is considered", async () => {
    const { store, manifest, license } = await seed();
    await replaceBytes(root, license.store_key, Buffer.from("short"));
    await truncateBytes(root, license.store_key, 5);
    const report = await verifyArtifactsAgainstManifest(manifest, store);
    const row = report.rows.find((r) => r.storeKey === license.store_key)!;
    expect(row.verified).toBe("SIZE_MISMATCH");
    expect(row.actualByteSize).toBe(5);
    expect(row.expectedByteSize).toBe(licenseBytes.length);
    expect(report.ok).toBe(false);
  });

  it("reports same-size corruption as DIGEST_MISMATCH", async () => {
    const { store, manifest, license } = await seed();
    const corrupted = Buffer.from(licenseBytes);
    corrupted[0] = 0x5b; // "{" -> "["; same length, different bytes
    await replaceBytes(root, license.store_key, corrupted);
    const report = await verifyArtifactsAgainstManifest(manifest, store);
    const row = report.rows.find((r) => r.storeKey === license.store_key)!;
    expect(row.verified).toBe("DIGEST_MISMATCH");
    expect(row.actualByteSize).toBe(licenseBytes.length);
    expect(row.actualSha256).not.toBe(license.sha256);
    expect(report.ok).toBe(false);
  });

  it("surfaces a file with no consistent database row and never adopts it", async () => {
    const { store, manifest } = await seed();
    const orphan = `licenses/${ulid().slice(0, 4)}/${ulid()}.json`;
    await store.writeOnce(orphan, Buffer.from("not-registered", "utf8"));
    const report = await verifyArtifactsAgainstManifest(manifest, store);
    expect(report.orphanFiles).toEqual([orphan]);
    expect(report.ok).toBe(false);
  });

  it("does not report a staged registration as a restored archive", async () => {
    const { store, license, revocation } = await seed();
    const staged = artifactBackupManifest([
      { ...license, status: "PENDING" },
      revocation,
    ]);
    const report = await verifyArtifactsAgainstManifest(staged, store);
    // The bytes are intact, but the registration never settled: reconcile must
    // settle it, the restore gate must not call it done.
    expect(report.rows.every((r) => r.verified === "INTACT")).toBe(true);
    expect(report.unsettled).toEqual([license.store_key]);
    expect(report.ok).toBe(false);
  });

  it("copies exact bytes, refuses an unverifiable source and excludes quarantined rows", async () => {
    const { store, manifest, license, revocation } = await seed();
    const rows = [license, revocation];

    // Remove one byte: the backup must refuse before copying anything.
    await replaceBytes(root, license.store_key, licenseBytes.subarray(1));
    const refusedRoot = path.join(backupRoot, "damaged");
    await expect(
      writeArtifactBackup(rows, (key) => store.read(key), refusedRoot),
    ).rejects.toThrow(/not verifiable/);
    await expect(
      readFile(path.join(refusedRoot, ARTIFACT_MANIFEST_FILE), "utf8"),
    ).rejects.toThrow();

    // A quarantined row is reported, not claimed as a restorable original.
    await replaceBytes(root, license.store_key, licenseBytes);
    const quarantined = await writeArtifactBackup(
      [{ ...license, status: "QUARANTINED" }, revocation],
      (key) => store.read(key),
      path.join(backupRoot, "quarantined"),
    );
    expect(quarantined.excluded).toEqual([license.store_key]);
    expect(quarantined.manifest.artifacts.map((a) => a.storeKey)).toEqual([
      revocation.store_key,
    ]);
    expect(quarantined.verification.ok).toBe(true);
    expect(manifest.artifacts).toHaveLength(2);
  });

  it("verifies a bundle from its manifest alone, before any restore", async () => {
    const { store, license, revocation } = await seed();
    const destination = path.join(backupRoot, "bundle");
    await writeArtifactBackup(
      [license, revocation],
      (key) => store.read(key),
      destination,
    );
    const ok = await verifyArtifactBackup(destination);
    expect(ok.ok).toBe(true);
    expect(ok.rows).toHaveLength(2);

    await truncateBytes(destination, revocation.store_key, 3);
    const damaged = await verifyArtifactBackup(destination);
    expect(damaged.ok).toBe(false);
    expect(
      damaged.rows.find((r) => r.storeKey === revocation.store_key)!.verified,
    ).toBe("SIZE_MISMATCH");
  });

  it("rejects a malformed or unrecognised manifest", () => {
    expect(() => parseArtifactBackupManifest(null)).toThrow(/not an object/);
    expect(() =>
      parseArtifactBackupManifest({ format: "something-else", version: 1 }),
    ).toThrow(/format/);
    expect(() =>
      parseArtifactBackupManifest({
        format: "VARDENA-OWNER-ARTIFACT-BACKUP",
        version: 99,
        createdAt: new Date().toISOString(),
        artifacts: [],
      }),
    ).toThrow(/version/);
  });
});
