-- Phase 1.3 / OQ-75 two-role authorization model (PDR-17, PDR-11 §21, 2026-10-16).
-- Supersedes the historical four-role model (SYSTEM_ADMIN, LICENSE_ISSUANCE,
-- READ_ONLY_OBSERVER, SUPPORT_SPECIALIST) with OWNER_ADMIN and LICENSE_OPERATOR.
-- Fails closed if any legacy role row exists rather than silently remapping or
-- escalating read-only/support accounts.
DO $$
DECLARE
  legacy_roles text;
BEGIN
  SELECT string_agg(DISTINCT role, ', ' ORDER BY role)
    INTO legacy_roles
    FROM owner.users
    WHERE role NOT IN ('OWNER_ADMIN', 'LICENSE_OPERATOR');
  IF legacy_roles IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to apply two-role constraint while superseded four-role user rows exist (%)', legacy_roles
      USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE owner.users
  DROP CONSTRAINT IF EXISTS users_role_check,
  ADD CONSTRAINT users_role_check CHECK (
    role IN ('OWNER_ADMIN', 'LICENSE_OPERATOR')
  );
