-- Phase 1.3 (2026-10-16): align Owner user roles with the Product Owner's
-- two-role MVP authorization policy (Owner Admin and License Operator; OQ-75 / PDR-17).
-- Preserves 001-foundation.sql and 002-manual-operations.sql checksums.
DO $$
DECLARE
  legacy_roles text;
BEGIN
  SELECT string_agg(DISTINCT role, ', ' ORDER BY role)
    INTO legacy_roles
    FROM owner.users
   WHERE role NOT IN ('OWNER_ADMIN', 'LICENSE_OPERATOR');

  IF legacy_roles IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to apply two-role constraint while superseded four-role user rows exist (%). Run `npm run migrate:preflight` to inspect affected accounts and `npm run migrate:remediate-roles -- <dispositions.json>` with an explicitly authorized disposition plan.',
      legacy_roles
      USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE owner.users
  DROP CONSTRAINT IF EXISTS users_role_check,
  ADD CONSTRAINT users_role_check CHECK (
    role IN ('OWNER_ADMIN', 'LICENSE_OPERATOR')
  );
