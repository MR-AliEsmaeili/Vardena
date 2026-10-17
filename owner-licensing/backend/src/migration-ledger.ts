import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { digest } from "./domain.js";

/** Called under the deployment advisory lock, before any migration/remediation writes. */
export async function validatedMigrationChain(tx: PoolClient) {
  const folder = fileURLToPath(new URL("../migrations/", import.meta.url));
  const files = (await readdir(folder))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const chain = await Promise.all(
    files.map(async (name) => {
      const sql = await readFile(`${folder}/${name}`, "utf8");
      return { name, sql, checksum: digest(sql) };
    }),
  );
  const ledger = await tx.query<{ name: string; checksum: string }>(
    "SELECT name,checksum FROM public.owner_migrations",
  );
  if (ledger.rows.some((row) => !files.includes(row.name)))
    throw new Error("Missing applied migration.");
  let pending = false;
  for (const migration of chain) {
    const applied = ledger.rows.find((row) => row.name === migration.name);
    if (!applied) {
      pending = true;
      continue;
    }
    if (pending)
      throw new Error("Applied migration ledger is not a contiguous prefix.");
    if (applied.checksum !== migration.checksum)
      throw new Error("Applied migration checksum mismatch.");
  }
  return { chain, ledger: ledger.rows };
}
