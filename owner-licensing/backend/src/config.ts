export interface Config {
  databaseUrl: string;
  origin: string;
  production: boolean;
  port: number;
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
  return { databaseUrl, origin, production, port };
}
