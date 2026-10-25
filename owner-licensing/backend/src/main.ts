import "dotenv/config"
import { config } from "./config.js"
import { Database } from "./db.js"
import { createApp } from "./app.js"
const cfg = config()
console.log(
  "[DIAGNOSTIC] OWNER_TRUSTED_KEY_COUNT:",
  cfg.trustedPublicKeys?.length ?? 0,
)
const db = new Database(cfg.databaseUrl)
const app = await createApp(db, cfg)
const server = app.listen(cfg.port, "0.0.0.0", () =>
  console.log(`Owner API listening on port ${cfg.port}.`),
)
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      void db.close()
    }),
  )
