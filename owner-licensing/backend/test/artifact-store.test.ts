import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import {
  LicenseArtifactStore,
  licenseArtifactStoreKey,
  sha256Bytes,
} from "../src/artifact-store.js";

/**
 * OD-LIC-10 / OD-LIC-19 evidence for the durable artifact store itself.
 *
 * The database-backed staging, reconciliation and quarantine paths live in
 * `licensing-lifecycle.test.ts` (CI-only, PostgreSQL). This suite proves the
 * filesystem contract the database path depends on: write-once, fail-closed
 * byte comparison, read-back verification, key/path validation, durable
 * permissions and the recovery surface (`listKeys`/`remove`/`exists`).
 */

let root: string;
let store: LicenseArtifactStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "vardena-owner-artifacts-"));
  store = new LicenseArtifactStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("artifact store configuration", () => {
  it("refuses a relative path, the filesystem root and an embedded NUL", () => {
    expect(() => new LicenseArtifactStore("relative/artifacts")).toThrow(
      /absolute directory path/,
    );
    expect(() => new LicenseArtifactStore(path.parse(root).root)).toThrow(
      /filesystem root/,
    );
    expect(() => new LicenseArtifactStore(`${root}\0x`)).toThrow(
      /absolute directory path/,
    );
    expect(() => new LicenseArtifactStore("   ")).toThrow(
      /absolute directory path/,
    );
  });

  it("derives a sharded key from a ULID and refuses anything else", () => {
    const id = ulid();
    expect(licenseArtifactStoreKey("licenses", id)).toBe(
      `licenses/${id.slice(0, 4)}/${id}.json`,
    );
    expect(licenseArtifactStoreKey("revocations", id)).toBe(
      `revocations/${id.slice(0, 4)}/${id}.json`,
    );
    expect(() => licenseArtifactStoreKey("licenses", "not-a-ulid")).toThrow(
      /ULID/,
    );
    expect(() => licenseArtifactStoreKey("licenses", id.toLowerCase())).toThrow(
      /ULID/,
    );
  });

  it("refuses keys that are not canonical or that would escape the root", async () => {
    const id = ulid();
    const valid = licenseArtifactStoreKey("licenses", id);
    for (const key of [
      `licenses/${id.slice(0, 4)}/../../etc/passwd.json`,
      `../${valid}`,
      valid.replace(/\.json$/, ""),
      valid.replace("licenses", "other"),
      `${valid}/extra.json`,
      "licenses/AAAA/not-a-ulid.json",
      "/etc/passwd.json",
      "",
    ]) {
      await expect(store.read(key)).rejects.toThrow();
    }
  });
});

describe("write-once semantics", () => {
  it("stores the exact bytes readable at 0444 with no temporary file left behind", async () => {
    const bytes = Buffer.from('{"document":"VLIC2.x.y"}', "utf8");
    const key = licenseArtifactStoreKey("licenses", ulid());
    const target = await store.writeOnce(key, bytes);

    expect(await readFile(target)).toEqual(bytes);
    expect((await stat(target)).mode & 0o777).toBe(0o444);
    const directory = path.dirname(target);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(await readdir(directory)).toEqual([path.basename(target)]);
    expect(await store.exists(key)).toBe(true);
  });

  it("accepts a byte-identical rewrite and refuses a different artifact under the same key", async () => {
    const key = licenseArtifactStoreKey("revocations", ulid());
    const bytes = Buffer.from('{"document":"VREV1.x.y"}', "utf8");
    await store.writeOnce(key, bytes);
    // A retried import of the same artifact is not an error.
    await expect(store.writeOnce(key, bytes)).resolves.toContain(
      key.split("/").pop()!,
    );

    await expect(
      store.writeOnce(key, Buffer.from('{"document":"VREV1.x.z"}', "utf8")),
    ).rejects.toThrow(/A different artifact already occupies this store key/);
    // The first artifact was never replaced.
    expect((await store.read(key)).toString("utf8")).toBe(
      bytes.toString("utf8"),
    );
  });

  it("fails closed when a foreign object already occupies the key", async () => {
    const key = licenseArtifactStoreKey("licenses", ulid());
    const target = path.join(root, key);
    await rm(path.dirname(target), { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "pre-existing");

    await expect(
      store.writeOnce(key, Buffer.from("new-bytes", "utf8")),
    ).rejects.toThrow(/A different artifact already occupies this store key/);
    expect(await readFile(target, "utf8")).toBe("pre-existing");
  });

  it("fails closed without overwriting a configured root that is a regular file", async () => {
    const fileRoot = path.join(root, "not-a-directory");
    await writeFile(fileRoot, "sentinel");
    const invalidStore = new LicenseArtifactStore(fileRoot);
    const key = licenseArtifactStoreKey("licenses", ulid());

    await expect(
      invalidStore.writeOnce(key, Buffer.from("signed-artifact", "utf8")),
    ).rejects.toThrow();
    expect(await readFile(fileRoot, "utf8")).toBe("sentinel");
    expect(await invalidStore.exists(key)).toBe(false);
    expect(await invalidStore.listKeys()).toEqual([]);
  });

  it("reports a missing artifact instead of inventing one", async () => {
    const key = licenseArtifactStoreKey("licenses", ulid());
    await expect(store.read(key)).rejects.toThrow(/ENOENT/);
    expect(await store.exists(key)).toBe(false);
    // Removing a key that was never written is not an error.
    await expect(store.remove(key)).resolves.toBeUndefined();
  });

  it("detects a modified file through the recorded digest", async () => {
    const key = licenseArtifactStoreKey("licenses", ulid());
    const bytes = Buffer.from("signed-artifact", "utf8");
    const recorded = sha256Bytes(bytes);
    const target = await store.writeOnce(key, bytes);
    // The store is the durability layer, not the integrity authority: a
    // mutation on disk is detected by comparing the recorded digest, which is
    // exactly what download/reconcile do.
    await chmod(target, 0o644);
    await writeFile(target, "tampered");
    expect(sha256Bytes(await store.read(key))).not.toBe(recorded);
  });
});

describe("recovery surface", () => {
  it("lists every stored artifact in sorted order and ignores noise", async () => {
    const first = licenseArtifactStoreKey("licenses", ulid());
    const second = licenseArtifactStoreKey("revocations", ulid());
    await store.writeOnce(first, Buffer.from("a"));
    await store.writeOnce(second, Buffer.from("b"));
    const directory = path.dirname(path.join(root, second));
    await writeFile(path.join(directory, ".tmp-leftover"), "x");
    await writeFile(path.join(directory, "notes.txt"), "x");
    await writeFile(path.join(root, "stray.json"), "x");

    expect(await store.listKeys()).toEqual([first, second].sort());
  });

  it("tolerates a missing root until the first write", async () => {
    await rm(root, { recursive: true, force: true });
    expect(await store.listKeys()).toEqual([]);
    const key = licenseArtifactStoreKey("licenses", ulid());
    await store.writeOnce(key, Buffer.from("x"));
    expect(await store.exists(key)).toBe(true);
  });
});
