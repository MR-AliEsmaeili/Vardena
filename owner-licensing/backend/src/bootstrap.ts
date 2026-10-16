import "dotenv/config";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";
import { Database, audit } from "./db.js";
import { config } from "./config.js";
import { password, text } from "./domain.js";
import { hashPassword } from "./security.js";
export async function bootstrap(
  db: Database,
  username: unknown,
  initialPassword: unknown,
) {
  const name = text(username, "username", 1, 64);
  const hash = await hashPassword(password(initialPassword));
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(78153215)");
    const existing = await tx.query(
      "SELECT id,username,is_active,role FROM owner.users WHERE username=$1",
      [name],
    );
    if (existing.rowCount) {
      const user = existing.rows[0];
      if (
        user.username !== name ||
        !user.is_active ||
        user.role !== "OWNER_ADMIN"
      )
        throw new Error(
          "Bootstrap refuses to override an existing installation.",
        );
      return false;
    }
    if ((await tx.query("SELECT 1 FROM owner.users LIMIT 1")).rowCount)
      throw new Error("Bootstrap only creates an empty installation.");
    const uid = ulid();
    await tx.query(
      `INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,'OWNER_ADMIN',true)`,
      [uid, name, hash],
    );
    await audit(tx, {
      actor: uid,
      type: "USER_BOOTSTRAPPED",
      targetType: "User",
      targetId: uid,
      reason: "Explicit installation bootstrap",
      after: { username: name, role: "OWNER_ADMIN", mustChangePassword: true },
    });
    return true;
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = new Database(config().databaseUrl);
  try {
    await bootstrap(
      db,
      process.env.OWNER_BOOTSTRAP_USERNAME,
      process.env.OWNER_BOOTSTRAP_PASSWORD,
    );
    console.log(
      "Owner bootstrap completed; existing credentials are never reset.",
    );
  } catch {
    console.error("Owner bootstrap failed; check configuration/account state.");
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
