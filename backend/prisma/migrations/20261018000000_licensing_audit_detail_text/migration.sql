-- PDR-11 §12.7: successful licensing operations write their typed audit event
-- in the same transaction as the state change. A valid 500-character operator
-- reason plus required recovery, transfer or resolution context can exceed the
-- old VARCHAR(500) boundary. Store the full detail instead of truncating the
-- reason/context or failing the atomic operation.
--
-- This is additive to the already-applied L-03 migration: changing
-- VARCHAR(500) to PostgreSQL TEXT preserves every existing value and does not
-- alter event rows or API contracts. Rejection-path detail remains explicitly
-- capped by its best-effort repository writer.
ALTER TABLE "licensing"."license_audit_events"
  ALTER COLUMN "detail" TYPE TEXT;

COMMENT ON COLUMN "licensing"."license_audit_events"."detail" IS
  'Human-readable audit detail; successful state-change events retain the complete operator reason and required context.';
