import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Database } from "./db.js";
import { config } from "./config.js";
import { digest } from "./domain.js";
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
    const folder = fileURLToPath(new URL("../migrations/", import.meta.url));
    const files = (await readdir(folder))
      .filter((n) => /^\d+.*\.sql$/.test(n))
      .sort();
    const ledger = await tx.query<{ name: string; checksum: string }>(
      "SELECT name,checksum FROM public.owner_migrations",
    );
    if (ledger.rows.some((r) => !files.includes(r.name)))
      throw new Error("Missing applied migration.");
    for (const name of files) {
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
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = new Database(config().databaseUrl);
  try {
    await migrate(db);
    console.log("Owner migrations verified/applied.");
  } catch {
    console.error(
      "Owner migration failed; verify configuration and migration ledger.",
    );
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
