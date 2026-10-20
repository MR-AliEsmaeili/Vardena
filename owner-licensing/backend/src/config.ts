import path from "node:path";

export interface Config {
  databaseUrl: string;
  origin: string;
  production: boolean;
  port: number;
  archiveDir?: string;
  /** Dedicated durable root for signed license/revocation artifacts (OD-LIC-10). */
  artifactDir?: string;
  /** Raw trust-list entries (`keyId:<base64 DER>` or bare base64 DER). */
  trustedPublicKeys?: string[];
}
export function config(env = process.env): Config {
  const databaseUrl = env.OWNER_DATABASE_URL;
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error("OWNER_DATABASE_URL is required.");
  const production = env.NODE_ENV === "production";
  const origin =
    env.OWNER_PUBLIC_ORIGIN ?? (production ? "" : "http://localhost:5174");
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("OWNER_PUBLIC_ORIGIN must be an HTTP(S) origin.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== origin ||
    (production && url.protocol !== "https:")
  )
    throw new Error(
      "OWNER_PUBLIC_ORIGIN must be an origin (HTTPS in production).",
    );
  const port = Number(env.OWNER_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid OWNER_PORT.");
  const trustedPublicKeys = parseKeyEntries(
    env.OWNER_LICENSE_TRUSTED_PUBLIC_KEYS,
  );
  const rawArtifactDir = env.OWNER_LICENSE_ARTIFACT_DIR;
  let artifactDir: string | undefined;
  if (rawArtifactDir !== undefined && rawArtifactDir.trim() !== "") {
    const trimmed = rawArtifactDir.trim();
    if (trimmed.includes("\0") || !path.isAbsolute(trimmed))
      throw new Error("OWNER_LICENSE_ARTIFACT_DIR must be an absolute path.");
    const resolved = path.resolve(trimmed);
    if (resolved === path.parse(resolved).root)
      throw new Error(
        "OWNER_LICENSE_ARTIFACT_DIR must not be the filesystem root.",
      );
    if (resolved === path.resolve(env.OWNER_AUDIT_ARCHIVE_DIR ?? ""))
      throw new Error(
        "OWNER_LICENSE_ARTIFACT_DIR must not share the audit archive root.",
      );
    artifactDir = resolved;
  }
  const rawArchiveDir = env.OWNER_AUDIT_ARCHIVE_DIR;
  if (rawArchiveDir !== undefined && rawArchiveDir.trim() !== "") {
    const trimmed = rawArchiveDir.trim();
    if (trimmed.includes("\0") || !path.isAbsolute(trimmed))
      throw new Error("OWNER_AUDIT_ARCHIVE_DIR must be an absolute path.");
    const resolved = path.resolve(trimmed);
    if (resolved === path.parse(resolved).root)
      throw new Error(
        "OWNER_AUDIT_ARCHIVE_DIR must not be the filesystem root.",
      );
    return {
      databaseUrl,
      origin,
      production,
      port,
      archiveDir: resolved,
      ...(artifactDir === undefined ? {} : { artifactDir }),
      trustedPublicKeys,
    };
  }
  return {
    databaseUrl,
    origin,
    production,
    port,
    ...(artifactDir === undefined ? {} : { artifactDir }),
    trustedPublicKeys,
  };
}

/**
 * `OWNER_LICENSE_TRUSTED_PUBLIC_KEYS` accepts a JSON array or a comma-separated
 * list. Entries use the customer's trust-list grammar. PEM is not accepted in
 * an environment variable because it contains newlines; use base64 DER (SPKI).
 */
function parseKeyEntries(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const value = raw.trim();
  if (value.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(
        "OWNER_LICENSE_TRUSTED_PUBLIC_KEYS must be a JSON array of strings.",
      );
    }
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== "string")
    )
      throw new Error(
        "OWNER_LICENSE_TRUSTED_PUBLIC_KEYS must be a JSON array of strings.",
      );
    return (parsed as string[]).map((entry) => entry.trim());
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
