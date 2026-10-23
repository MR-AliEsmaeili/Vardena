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
 * crash can leave behind. POSIX directory entries are synchronized where the
 * filesystem supports it. Windows directory synchronization has the narrower
 * guarantee documented in `syncDirectory`; it is not claimed to be equivalent.
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

/** Filesystem seam used by the platform and failure-path regression tests. */
export interface FilesystemArtifactStoreOps {
  chmod: typeof chmod;
  link: typeof link;
  mkdir: typeof mkdir;
  open: typeof open;
  readFile: typeof readFile;
  readdir: typeof readdir;
  stat: typeof stat;
  unlink: typeof unlink;
}

const defaultFilesystemArtifactStoreOps: FilesystemArtifactStoreOps = {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
};

export class LicenseArtifactStore {
  readonly rootDir: string;
  private readonly fs: FilesystemArtifactStoreOps;
  private readonly platform: NodeJS.Platform;

  constructor(
    rootDir: string,
    fsOps: Partial<FilesystemArtifactStoreOps> = {},
    platform: NodeJS.Platform = process.platform,
  ) {
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
    this.fs = { ...defaultFilesystemArtifactStoreOps, ...fsOps };
    this.platform = platform;
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

  private async syncDirectory(dir: string): Promise<void> {
    const directory = await this.fs.open(dir, "r");
    try {
      await directory.sync();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      // Node.js on Windows can open a directory but rejects fsync on that
      // handle with EPERM. Tolerate exactly that operation/platform/code: the
      // regular file is still fsynced, publication is still atomic and
      // read-back is still mandatory. This does NOT claim POSIX-equivalent
      // directory-entry crash durability on Windows. Directory open errors,
      // regular-file sync errors, and every other directory error propagate.
      const unsupportedOnWindows =
        this.platform === "win32" && code === "EPERM";
      // Preserve the existing handling for filesystems which explicitly report
      // that directory-descriptor synchronization is unsupported.
      const unsupported =
        code === "EINVAL" ||
        code === "ENOTSUP" ||
        code === "EISDIR" ||
        unsupportedOnWindows;
      if (!unsupported) throw error;
    } finally {
      await directory.close();
    }
  }

  /**
   * Write the exact bytes once. An existing file is accepted only when its
   * bytes are identical; a different payload under the same key fails closed.
   */
  async writeOnce(storeKey: string, bytes: Buffer): Promise<string> {
    const target = this.resolveKey(storeKey);
    const dir = path.dirname(target);
    await this.fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = path.join(
      dir,
      `.tmp-${path.basename(target)}-${process.pid}-${Date.now()}`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let temporaryRemoved = false;
    try {
      handle = await this.fs.open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
      // Regular-file synchronization is mandatory on every platform. In
      // particular, Windows directory EPERM handling never reaches this call.
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        // A hard link publishes the already-synced bytes atomically and never
        // overwrites an existing target on supported Windows or POSIX filesystems.
        await this.fs.link(temporary, target);
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        const existing = await this.fs.readFile(target);
        if (!existing.equals(bytes)) {
          throw new Error(
            "A different artifact already occupies this store key.",
          );
        }
      }
      // Remove the temporary name before making the shared file read-only.
      // Windows refuses to delete a read-only hard link; POSIX directory sync
      // below still covers both the publication and this name removal.
      await this.fs.unlink(temporary);
      temporaryRemoved = true;
      await this.fs.chmod(target, 0o444);
      await this.syncDirectory(dir);
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // Preserve the original write/sync failure.
        }
      }
      if (!temporaryRemoved) {
        try {
          await this.fs.unlink(temporary);
        } catch {
          // Already unlinked, never created, or cleanup failed while another
          // error is propagating. Temporary names are never listed as artifacts.
        }
      }
    }
    const stored = await this.fs.readFile(target);
    if (!stored.equals(bytes)) {
      throw new Error("Artifact read-back verification failed.");
    }
    return target;
  }

  async read(storeKey: string): Promise<Buffer> {
    return this.fs.readFile(this.resolveKey(storeKey));
  }

  async exists(storeKey: string): Promise<boolean> {
    try {
      const info = await this.fs.stat(this.resolveKey(storeKey));
      return info.isFile();
    } catch {
      return false;
    }
  }

  /** Test/recovery helper: delete a file that no database row references. */
  async remove(storeKey: string): Promise<void> {
    try {
      await this.fs.unlink(this.resolveKey(storeKey));
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
        prefixes = await this.fs.readdir(kindDir);
      } catch {
        continue;
      }
      for (const prefix of prefixes) {
        const prefixDir = path.join(kindDir, prefix);
        let files: string[];
        try {
          const info = await this.fs.stat(prefixDir);
          if (!info.isDirectory()) continue;
          files = await this.fs.readdir(prefixDir);
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
