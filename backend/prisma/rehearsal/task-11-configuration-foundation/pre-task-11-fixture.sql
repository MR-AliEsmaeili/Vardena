-- Task 11 migration rehearsal — deterministic PRE-Task-11 data.
--
-- Applied to a disposable database that has exactly the migrations BEFORE
-- 20260920000000_accounting_configuration_foundation (see rehearse.mjs). At
-- this point `accounting.accounting_configurations` does not exist and
-- `accounting.accounts.accounting_configuration_id` does not exist either —
-- which is the whole point: the migration must backfill real rows.
--
-- Ids are readable placeholders (the columns are TEXT; production ids are
-- ULIDs). Timestamps are fixed so the rehearsal is byte-for-byte repeatable.
--
-- Organizations:
--   org-multi            3-level ACTIVE coding structure + a superseded one;
--                        accounts pinned to BOTH
--   org-one-level        ONE-level ACTIVE coding structure + accounts
--   org-no-config        organization with no coding structure and no accounts
--   org-draft-version    ACTIVE 3+2 coding structure + an unpublished 2+2 DRAFT
--   org-superseded-only  accounts pinned to a SUPERSEDED version; NO active one
--
-- Expected state after the Task 11 migration is asserted by verify.sql.

BEGIN;

INSERT INTO "organization"."organizations" ("id", "code", "name", "created_at", "updated_at")
VALUES
  ('org-multi',            'ORG-MULTI',   'Multi-level org',            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('org-one-level',        'ORG-ONE',     'One-level org',              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('org-no-config',        'ORG-NONE',    'Organization without config','2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('org-draft-version',    'ORG-DRAFT',   'Draft-version org',          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('org-superseded-only',  'ORG-SUPER',   'Superseded-only org',        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

-- ---- coding structures -----------------------------------------------------
INSERT INTO "accounting"."coding_structure_versions"
  ("id", "organization_id", "code", "version_number", "status", "max_depth", "separator", "created_at", "updated_at")
VALUES
  -- org-multi: v1 superseded (2+3), v2 active (2+3+3)
  ('csv-multi-v1', 'org-multi', 'DEFAULT', 1, 'superseded', 2, '', '2026-01-02T00:00:00Z', '2026-02-01T00:00:00Z'),
  ('csv-multi-v2', 'org-multi', 'DEFAULT', 2, 'active',     3, '', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
  -- org-one-level: a single-level structure (digit length 4)
  ('csv-one-v1',   'org-one-level', 'SIMPLE', 1, 'active', 1, '', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  -- org-draft-version: active 3+2, unpublished draft 2+2
  ('csv-draft-v1', 'org-draft-version', 'MAIN', 1, 'active', 2, '', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('csv-draft-v2', 'org-draft-version', 'MAIN', 2, 'draft',  2, '', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  -- org-superseded-only: the only version is superseded (no active one)
  ('csv-super-v1', 'org-superseded-only', 'LEGACY', 1, 'superseded', 2, '', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');

INSERT INTO "accounting"."coding_structure_levels"
  ("id", "organization_id", "coding_structure_version_id", "level_index", "title", "digit_length", "default_is_postable", "level_kind", "created_at", "updated_at")
VALUES
  -- org-multi v1 (2 + 3)
  ('csl-multi-v1-l1', 'org-multi', 'csv-multi-v1', 1, 'Group',  2, false, 'group',      '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('csl-multi-v1-l2', 'org-multi', 'csv-multi-v1', 2, 'Detail', 3, true,  'detail',     '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  -- org-multi v2 (2 + 3 + 3)
  ('csl-multi-v2-l1', 'org-multi', 'csv-multi-v2', 1, 'Group',      2, false, 'group',      '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
  ('csl-multi-v2-l2', 'org-multi', 'csv-multi-v2', 2, 'General',    3, false, 'general',    '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
  ('csl-multi-v2-l3', 'org-multi', 'csv-multi-v2', 3, 'Subsidiary', 3, true,  'subsidiary', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
  -- org-one-level (4)
  ('csl-one-v1-l1',   'org-one-level', 'csv-one-v1', 1, 'Group', 4, true, 'group', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  -- org-draft-version active v1 (3 + 2)
  ('csl-draft-v1-l1', 'org-draft-version', 'csv-draft-v1', 1, 'Group',  3, false, 'group',  '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('csl-draft-v1-l2', 'org-draft-version', 'csv-draft-v1', 2, 'Detail', 2, true,  'detail', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  -- org-draft-version draft v2 (2 + 2) — must NOT be copied
  ('csl-draft-v2-l1', 'org-draft-version', 'csv-draft-v2', 1, 'Group',  2, false, null, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  ('csl-draft-v2-l2', 'org-draft-version', 'csv-draft-v2', 2, 'Detail', 2, true,  null, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  -- org-superseded-only (2 + 2)
  ('csl-super-v1-l1', 'org-superseded-only', 'csv-super-v1', 1, 'Group',  2, false, null, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('csl-super-v1-l2', 'org-superseded-only', 'csv-super-v1', 2, 'Detail', 2, true,  null, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');

-- ---- accounts (all of them are "orphans": no configuration exists yet) -----
INSERT INTO "accounting"."accounts"
  ("id", "organization_id", "code", "title", "parent_id", "level", "coding_structure_version_id", "account_nature", "is_postable", "is_active", "created_at", "updated_at")
VALUES
  -- org-multi: two accounts on the ACTIVE version, one on the SUPERSEDED one
  ('acc-multi-root',   'org-multi', '10',    'Assets',            NULL,           1, 'csv-multi-v2', 'debit',  false, true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  ('acc-multi-child',  'org-multi', '10001', 'Cash',              'acc-multi-root', 2, 'csv-multi-v2', 'debit',  true,  true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  ('acc-multi-old',    'org-multi', '20',    'Legacy receivable', NULL,           1, 'csv-multi-v1', 'debit',  false, true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  -- org-one-level: two roots shaped 4 digits
  ('acc-one-root-a',   'org-one-level', '1000', 'Cash',     NULL, 1, 'csv-one-v1', 'debit',  true, true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  ('acc-one-root-b',   'org-one-level', '2000', 'Payables', NULL, 1, 'csv-one-v1', 'credit', true, true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  -- org-draft-version: pinned to the ACTIVE version, not the draft
  ('acc-draft-root',   'org-draft-version', '100',   'Assets', NULL,             1, 'csv-draft-v1', 'debit', false, true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  ('acc-draft-child',  'org-draft-version', '10001', 'Cash',   'acc-draft-root', 2, 'csv-draft-v1', 'debit', true,  true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  -- org-superseded-only: the only coding version is superseded
  ('acc-super-root',   'org-superseded-only', '10',   'Assets', NULL,              1, 'csv-super-v1', 'debit', false, true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  ('acc-super-child',  'org-superseded-only', '1001', 'Cash',   'acc-super-root',  2, 'csv-super-v1', 'debit', true,  true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');

COMMIT;
