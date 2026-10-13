-- L-02 hardening: the raw license code is no longer persisted.
--
-- `licensing.licenses.code` stored the complete signed activation code
-- (`VLIC1.<payload>.<signature>`). Nothing read it: activation compares
-- `code_hash` (SHA-256) for idempotency, and evaluation after a restart uses
-- only the derived columns (status, validity, limits) plus the entitlement
-- rows. Keeping the code therefore bought nothing and made a leaked or
-- inspected database disclose a reusable license code.
--
-- The irreversible `code_hash` stays: it is all that deterministic
-- re-activation, replacement and audit need.

ALTER TABLE "licensing"."licenses"
  DROP COLUMN "code";
