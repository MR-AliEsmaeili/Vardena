import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Durable, write-once store for signed license and revocation artifacts
 * (OD-LIC-10, OD-LIC-19).
 *
 * A different root from the audit archive on purpose: license artifacts and
 * audit bundles have different retention, access and disclosure properties,
 * and sharing one root would couple their backup lifecycles.
 *
 * It is deliberately NOT claimed to be transactional with PostgreSQL. Callers
 * stage a row, write and fsync the file, verify it by reading it back, and only
 * then commit the settled state; `reconcile()` reports and repairs the states a
 * crash can leave behind.
 */

const STORE_KEY_PATTERN =
  /^(licenses|revocations)\/[0-9A-HJKMNP-TV-Z]{4}\/[0-9A-HJKMNP-TV-Z]{26}\.json$/;

export function licenseArtifactStoreKey(
  kind: "licenses" | "revocations",
  id: string,
): string {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
    throw new Error("Artifact store keys require a ULID identity.");
  }
  return `${kind}/${id.slice(0, 4)}/${id}.json`;
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class LicenseArtifactStore {
  readonly rootDir: string;

  constructor(rootDir: string) {
    if (
      typeof rootDir !== "string" ||
      rootDir.trim().length === 0 ||
      rootDir.includes("\0") ||
      !path.isAbsolute(rootDir.trim())
    ) {
      throw new Error(
        "OWNER_LICENSE_ARTIFACT_DIR must be an absolute directory path.",
      );
    }
    const resolved = path.resolve(rootDir.trim());
    if (resolved === path.parse(resolved).root) {
      throw new Error(
        "OWNER_LICENSE_ARTIFACT_DIR must not be the filesystem root.",
      );
    }
    this.rootDir = resolved;
  }

  private resolveKey(storeKey: string): string {
    if (!STORE_KEY_PATTERN.test(storeKey)) {
      throw new Error("Invalid artifact store key.");
    }
    const target = path.join(this.rootDir, storeKey);
    const relative = path.relative(this.rootDir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Artifact store key escapes the configured root.");
    }
    return target;
  }

  /**
   * Write the exact bytes once. An existing file is accepted only when its
   * bytes are identical; a different payload under the same key fails closed.
   */
  async writeOnce(storeKey: string, bytes: Buffer): Promise<string> {
    const target = this.resolveKey(storeKey);
    const dir = path.dirname(target);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = path.join(
      dir,
      `.tmp-${path.basename(target)}-${process.pid}-${Date.now()}`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await link(temporary, target);
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        const existing = await readFile(target);
        if (!existing.equals(bytes)) {
          throw new Error(
            "A different artifact already occupies this store key.",
          );
        }
      }
      await chmod(target, 0o444);
      const directory = await open(dir, "r");
      try {
        await directory.sync();
      } catch (error) {
        // Some filesystems refuse directory fsync; the file itself is synced.
        const code = (error as { code?: string }).code;
        if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EISDIR") {
          throw error;
        }
      } finally {
        await directory.close();
      }
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // ignore
        }
      }
      try {
        await unlink(temporary);
      } catch {
        // already linked or never created
      }
    }
    const stored = await readFile(target);
    if (!stored.equals(bytes)) {
      throw new Error("Artifact read-back verification failed.");
    }
    return target;
  }

  async read(storeKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(storeKey));
  }

  async exists(storeKey: string): Promise<boolean> {
    try {
      const info = await stat(this.resolveKey(storeKey));
      return info.isFile();
    } catch {
      return false;
    }
  }

  /** Test/recovery helper: delete a file that no database row references. */
  async remove(storeKey: string): Promise<void> {
    try {
      await unlink(this.resolveKey(storeKey));
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }

  /** Every stored artifact key, for reconciliation. */
  async listKeys(): Promise<string[]> {
    const keys: string[] = [];
    for (const kind of ["licenses", "revocations"] as const) {
      const kindDir = path.join(this.rootDir, kind);
      let prefixes: string[];
      try {
        prefixes = await readdir(kindDir);
      } catch {
        continue;
      }
      for (const prefix of prefixes) {
        const prefixDir = path.join(kindDir, prefix);
        let files: string[];
        try {
          const info = await stat(prefixDir);
          if (!info.isDirectory()) continue;
          files = await readdir(prefixDir);
        } catch {
          continue;
        }
        for (const file of files) {
          if (!file.endsWith(".json") || file.startsWith(".")) continue;
          keys.push(`${kind}/${prefix}/${file}`);
        }
      }
    }
    return keys.sort();
  }
}
