-- Task 11 migration rehearsal — verification.
--
-- Runs AFTER `20260920000000_accounting_configuration_foundation/migration.sql`
-- against the database seeded by `pre-task-11-fixture.sql`, inside ONE
-- transaction that the runner rolls back (read-only gate, negative probes
-- included).
--
-- Every check RAISEs on failure (the runner then exits non-zero) and emits a
-- `PASS …` notice on success. The snapshot tables it compares against are
-- created by `rehearse.mjs` in the `rehearsal` schema BEFORE the Task 11
-- migration runs:
--   rehearsal.counts_pre        — row counts before the migration
--   rehearsal.account_counts_pre— per-organization account counts
--   rehearsal.snapshot_pre      — every account row before the migration
--
-- `RAISE NOTICE` lines prefixed `PASS` are the machine-checkable evidence; the
-- `OBSERVED` lines record behaviour that is DOCUMENTED but still decision-open
-- (the fallback level shape), so the rehearsal never claims more than it
-- verified.

-- ---------------------------------------------------------------------------
-- 1. Row counts and row preservation
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  accounts_before integer;
  accounts_after integer;
  versions_before integer;
  versions_after integer;
  levels_before integer;
  levels_after integer;
BEGIN
  SELECT count(*) INTO accounts_before FROM rehearsal.snapshot_pre;
  SELECT count(*) INTO accounts_after FROM "accounting"."accounts";
  SELECT row_count INTO versions_before FROM rehearsal.counts_pre WHERE relation = 'coding_structure_versions';
  SELECT count(*) INTO versions_after FROM "accounting"."coding_structure_versions";
  SELECT row_count INTO levels_before FROM rehearsal.counts_pre WHERE relation = 'coding_structure_levels';
  SELECT count(*) INTO levels_after FROM "accounting"."coding_structure_levels";

  IF accounts_after <> accounts_before THEN
    RAISE EXCEPTION 'account row count changed: % before, % after', accounts_before, accounts_after;
  END IF;
  IF versions_after <> versions_before THEN
    RAISE EXCEPTION 'coding_structure_versions row count changed: % before, % after', versions_before, versions_after;
  END IF;
  IF levels_after <> levels_before THEN
    RAISE EXCEPTION 'coding_structure_levels row count changed: % before, % after', levels_before, levels_after;
  END IF;
  RAISE NOTICE 'PASS row counts: accounts=% (unchanged), coding_structure_versions=% (unchanged), coding_structure_levels=% (unchanged)',
    accounts_after, versions_after, levels_after;
END $$;

DO $$
DECLARE
  per_org_bad integer;
BEGIN
  SELECT count(*) INTO per_org_bad
  FROM (
    SELECT organization_id, count(*) AS after_count
    FROM "accounting"."accounts"
    GROUP BY organization_id
  ) after_rows
  LEFT JOIN rehearsal.account_counts_pre pre ON pre.organization_id = after_rows.organization_id
  WHERE pre.organization_id IS NULL OR pre.account_count <> after_rows.after_count;

  IF per_org_bad <> 0 THEN
    RAISE EXCEPTION 'per-organization account counts changed for % organization(s)', per_org_bad;
  END IF;
  RAISE NOTICE 'PASS per-organization account counts unchanged';
END $$;

DO $$
DECLARE
  diff integer;
BEGIN
  SELECT count(*) INTO diff
  FROM rehearsal.snapshot_pre s
  FULL JOIN "accounting"."accounts" a ON a.id = s.id
  WHERE a.id IS NULL
     OR s.id IS NULL
     OR a.organization_id             IS DISTINCT FROM s.organization_id
     OR a.code                        IS DISTINCT FROM s.code
     OR a.title                       IS DISTINCT FROM s.title
     OR a.parent_id                   IS DISTINCT FROM s.parent_id
     OR a.level                       IS DISTINCT FROM s.level
     OR a.coding_structure_version_id IS DISTINCT FROM s.coding_structure_version_id
     OR a.account_nature              IS DISTINCT FROM s.account_nature
     OR a.is_postable                 IS DISTINCT FROM s.is_postable
     OR a.is_active                   IS DISTINCT FROM s.is_active;
  IF diff <> 0 THEN
    RAISE EXCEPTION '% account row(s) differ from the pre-migration snapshot', diff;
  END IF;
  RAISE NOTICE 'PASS row preservation: every account kept its id, code, level, parent, nature and coding_structure_version_id';
END $$;

-- ---------------------------------------------------------------------------
-- 2. NOT NULL + backfill + scope correctness
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  null_count integer;
  nullable text;
  cross_scope integer;
BEGIN
  SELECT count(*) INTO null_count FROM "accounting"."accounts" WHERE "accounting_configuration_id" IS NULL;
  IF null_count <> 0 THEN
    RAISE EXCEPTION '% account(s) still have NULL accounting_configuration_id after SET NOT NULL', null_count;
  END IF;

  SELECT is_nullable INTO nullable
    FROM information_schema.columns
   WHERE table_schema = 'accounting' AND table_name = 'accounts' AND column_name = 'accounting_configuration_id';
  IF nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'accounts.accounting_configuration_id is_nullable=% (expected NO)', nullable;
  END IF;

  SELECT count(*) INTO cross_scope
    FROM "accounting"."accounts" a
    JOIN "accounting"."accounting_configurations" c ON c.id = a.accounting_configuration_id
   WHERE c.organization_id <> a.organization_id;
  IF cross_scope <> 0 THEN
    RAISE EXCEPTION '% account(s) reference a configuration of ANOTHER organization', cross_scope;
  END IF;
  RAISE NOTICE 'PASS NOT NULL: every account is backfilled, the column is NOT NULL and every pin is same-organization';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Orphan handling: one LEGACY ACTIVE configuration per organization that
--    had accounts; nothing at all for an organization without accounts
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad
  FROM "accounting"."accounts" a
  JOIN "accounting"."accounting_configurations" c ON c.id = a.accounting_configuration_id
  WHERE c.code <> 'LEGACY' OR c.version_number <> 1 OR c.status <> 'ACTIVE';
  IF bad <> 0 THEN
    RAISE EXCEPTION '% account(s) are pinned to a configuration that is not the LEGACY v1 ACTIVE row', bad;
  END IF;

  SELECT count(*) INTO bad
  FROM "accounting"."accounting_configurations" c
  WHERE c.code = 'LEGACY' AND c.operationally_used_at IS NULL;
  IF bad <> 0 THEN
    RAISE EXCEPTION '% LEGACY configuration(s) were created without operationally_used_at', bad;
  END IF;

  SELECT count(*) INTO bad
  FROM (
    SELECT organization_id FROM "accounting"."accounting_configurations" WHERE code = 'LEGACY'
    GROUP BY organization_id HAVING count(*) <> 1
  ) duplicates;
  IF bad <> 0 THEN
    RAISE EXCEPTION '% organization(s) do not have exactly ONE LEGACY configuration', bad;
  END IF;

  SELECT count(*) INTO bad
  FROM "accounting"."accounting_configurations" c
  WHERE NOT EXISTS (
    SELECT 1 FROM "accounting"."accounts" a WHERE a.accounting_configuration_id = c.id
  );
  IF bad <> 0 THEN
    RAISE EXCEPTION '% configuration(s) exist that no account references', bad;
  END IF;

  SELECT count(*) INTO bad
  FROM "accounting"."accounting_configurations" c
  WHERE NOT EXISTS (
    SELECT 1 FROM "accounting"."accounting_configuration_levels" l WHERE l.accounting_configuration_id = c.id
  );
  IF bad <> 0 THEN
    RAISE EXCEPTION '% configuration(s) have no level rows', bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "accounting"."accounting_configurations" WHERE organization_id = 'org-no-config'
  ) THEN
    RAISE EXCEPTION 'organization with no accounts and no coding structure received a configuration';
  END IF;
  IF (SELECT count(*) FROM "accounting"."accounts" WHERE organization_id = 'org-no-config') <> 0 THEN
    RAISE EXCEPTION 'fixture drift: org-no-config must not have accounts';
  END IF;

  RAISE NOTICE 'PASS orphan handling: exactly one LEGACY ACTIVE v1 configuration per organization with accounts; org-no-config untouched';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Level preservation — a copied level set is never extended
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  diff integer;
  level_count integer;
  cfg_multi text;
  cfg_one text;
  cfg_draft text;
BEGIN
  SELECT accounting_configuration_id INTO cfg_multi
    FROM "accounting"."accounts" WHERE organization_id = 'org-multi' LIMIT 1;
  SELECT accounting_configuration_id INTO cfg_one
    FROM "accounting"."accounts" WHERE organization_id = 'org-one-level' LIMIT 1;
  SELECT accounting_configuration_id INTO cfg_draft
    FROM "accounting"."accounts" WHERE organization_id = 'org-draft-version' LIMIT 1;

  -- org-multi: the ACTIVE version has 3 levels (2+3+3); a superseded one has 2.
  SELECT count(*) INTO level_count
    FROM "accounting"."accounting_configuration_levels" WHERE accounting_configuration_id = cfg_multi;
  IF level_count <> 3 THEN
    RAISE EXCEPTION 'org-multi legacy configuration has % level(s); expected exactly 3 (the ACTIVE version''s set)', level_count;
  END IF;

  SELECT count(*) INTO diff
  FROM (
    SELECT level_index, title, digit_length, default_is_postable, level_kind
      FROM "accounting"."accounting_configuration_levels" WHERE accounting_configuration_id = cfg_multi
    EXCEPT
    SELECT level_index, title, digit_length, default_is_postable, level_kind
      FROM "accounting"."coding_structure_levels" WHERE coding_structure_version_id = 'csv-multi-v2'
  ) missing
  UNION ALL
  SELECT count(*) FROM (
    SELECT level_index, title, digit_length, default_is_postable, level_kind
      FROM "accounting"."coding_structure_levels" WHERE coding_structure_version_id = 'csv-multi-v2'
    EXCEPT
    SELECT level_index, title, digit_length, default_is_postable, level_kind
      FROM "accounting"."accounting_configuration_levels" WHERE accounting_configuration_id = cfg_multi
  ) extra;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'org-multi legacy levels differ from the ACTIVE coding structure in % row(s)', diff;
  END IF;

  -- org-one-level: the SINGLE-level structure must stay single-level.
  SELECT count(*) INTO level_count
    FROM "accounting"."accounting_configuration_levels" WHERE accounting_configuration_id = cfg_one;
  IF level_count <> 1 THEN
    RAISE EXCEPTION 'org-one-level legacy configuration has % level(s); a ONE-level structure must not be extended', level_count;
  END IF;

  SELECT count(*) INTO diff
  FROM (
    SELECT level_index, title, digit_length, default_is_postable, level_kind
      FROM "accounting"."accounting_configuration_levels" WHERE accounting_configuration_id = cfg_one
    EXCEPT
    SELECT level_index, title, digit_length, default_is_postable, level_kind
      FROM "accounting"."coding_structure_levels" WHERE coding_structure_version_id = 'csv-one-v1'
  ) missing
  UNION ALL
  SELECT count(*) FROM (
    SELECT level_index, title, digit_length, default_is_postable, level_kind
      FROM "accounting"."coding_structure_levels" WHERE coding_structure_version_id = 'csv-one-v1'
    EXCEPT
    SELECT level_index, title, digit_length, default_is_postable, level_kind
      FROM "accounting"."accounting_configuration_levels" WHERE accounting_configuration_id = cfg_one
  ) extra;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'org-one-level legacy level differs from its ACTIVE coding structure in % row(s)', diff;
  END IF;

  -- org-draft-version: copy from the ACTIVE version (3+2), never the draft (2+2).
  SELECT count(*) INTO diff
  FROM (
    SELECT level_index, title, digit_length, default_is_postable
      FROM "accounting"."accounting_configuration_levels" WHERE accounting_configuration_id = cfg_draft
    EXCEPT
    SELECT level_index, title, digit_length, default_is_postable
      FROM "accounting"."coding_structure_levels" WHERE coding_structure_version_id = 'csv-draft-v1'
  ) missing
  UNION ALL
  SELECT count(*) FROM (
    SELECT level_index, title, digit_length, default_is_postable
      FROM "accounting"."coding_structure_levels" WHERE coding_structure_version_id = 'csv-draft-v1'
    EXCEPT
    SELECT level_index, title, digit_length, default_is_postable
      FROM "accounting"."accounting_configuration_levels" WHERE accounting_configuration_id = cfg_draft
  ) extra;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'org-draft-version legacy levels do not match the ACTIVE version in % row(s)', diff;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "accounting"."accounting_configuration_levels"
     WHERE accounting_configuration_id = cfg_draft AND level_index = 1 AND digit_length = 2
  ) THEN
    RAISE EXCEPTION 'org-draft-version copied the unpublished DRAFT level shape (2+2) instead of the ACTIVE one (3+2)';
  END IF;

  RAISE NOTICE 'PASS level preservation: copied sets equal the ACTIVE coding structure (3 levels for org-multi, 1 level for org-one-level, ACTIVE 3+2 for org-draft-version)';
END $$;

-- ---------------------------------------------------------------------------
-- 5. Documented fallback (decision-open) — an organization with accounts but
--    NO active coding version gets the default 2 + 3 shape
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  shape text;
BEGIN
  SELECT string_agg(l.digit_length::text, '+' ORDER BY l.level_index) INTO shape
  FROM "accounting"."accounting_configuration_levels" l
  WHERE l.accounting_configuration_id = (
    SELECT accounting_configuration_id FROM "accounting"."accounts"
     WHERE organization_id = 'org-superseded-only' LIMIT 1
  );

  IF shape IS DISTINCT FROM '2+3' THEN
    RAISE EXCEPTION 'org-superseded-only fallback shape is % (documented fallback is 2+3)', shape;
  END IF;
  RAISE NOTICE 'OBSERVED fallback: org-superseded-only (accounts pin a SUPERSEDED version, no ACTIVE one) received the documented default shape 2+3 — decision-open, see the Task 11 remediation report';
END $$;

-- ---------------------------------------------------------------------------
-- 6. NOT NULL + FK behaviour (negative probes, rolled back with the gate)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO "accounting"."accounts"
      ("id", "organization_id", "code", "title", "parent_id", "level", "coding_structure_version_id",
       "accounting_configuration_id", "account_nature", "is_postable", "is_active", "created_at", "updated_at")
    VALUES
      ('probe-null-config', 'org-multi', '99', 'Probe', NULL, 1, 'csv-multi-v2',
       NULL, 'debit', false, true, NOW(), NOW());
    RAISE EXCEPTION 'expected NOT NULL rejection: inserting an account with NULL accounting_configuration_id succeeded';
  EXCEPTION
    WHEN not_null_violation THEN
      RAISE NOTICE 'PASS NOT NULL: a NULL accounting_configuration_id is rejected by the database (23502)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "accounting"."accounts"
      ("id", "organization_id", "code", "title", "parent_id", "level", "coding_structure_version_id",
       "accounting_configuration_id", "account_nature", "is_postable", "is_active", "created_at", "updated_at")
    VALUES
      ('probe-bad-config', 'org-multi', '98', 'Probe', NULL, 1, 'csv-multi-v2',
       'cfg-does-not-exist', 'debit', false, true, NOW(), NOW());
    RAISE EXCEPTION 'expected FK rejection: inserting an account with a non-existent accounting_configuration_id succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'PASS FK: accounts.accounting_configuration_id rejects unknown configurations (23503)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "accounting"."accounts"
      ("id", "organization_id", "code", "title", "parent_id", "level", "coding_structure_version_id",
       "accounting_configuration_id", "account_nature", "is_postable", "is_active", "created_at", "updated_at")
    VALUES
      ('probe-bad-version', 'org-multi', '97', 'Probe', NULL, 1, 'csv-does-not-exist',
       (SELECT accounting_configuration_id FROM "accounting"."accounts" WHERE id = 'acc-multi-root'),
       'debit', false, true, NOW(), NOW());
    RAISE EXCEPTION 'expected FK rejection: inserting an account with a non-existent coding_structure_version_id succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'PASS FK: accounts.coding_structure_version_id rejects unknown versions (23503)';
  END;
END $$;

DO $$
DECLARE
  pinned_config text;
BEGIN
  SELECT accounting_configuration_id INTO pinned_config FROM "accounting"."accounts" WHERE id = 'acc-multi-root';
  BEGIN
    UPDATE "accounting"."accounts"
       SET accounting_configuration_id = 'cfg-does-not-exist'
     WHERE id = 'acc-multi-root';
    RAISE EXCEPTION 'expected FK rejection: re-pinning an account to a non-existent configuration succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'PASS FK: re-pinning an account to an unknown configuration is rejected';
  END;

  IF (SELECT accounting_configuration_id FROM "accounting"."accounts" WHERE id = 'acc-multi-root') IS DISTINCT FROM pinned_config THEN
    RAISE EXCEPTION 'account pin changed despite the rejected UPDATE';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    DELETE FROM "accounting"."accounting_configurations"
     WHERE id = (SELECT accounting_configuration_id FROM "accounting"."accounts" WHERE id = 'acc-multi-root');
    RAISE EXCEPTION 'expected FK RESTRICT: deleting a configuration referenced by an account succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'PASS FK RESTRICT: a configuration referenced by accounts cannot be deleted';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    DELETE FROM "accounting"."coding_structure_versions" WHERE id = 'csv-multi-v2';
    RAISE EXCEPTION 'expected FK RESTRICT: deleting a coding-structure version referenced by an account succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'PASS FK RESTRICT: a coding-structure version referenced by accounts cannot be deleted';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Partial unique index: exactly one ACTIVE configuration per organization
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  definition text;
BEGIN
  SELECT indexdef INTO definition
    FROM pg_indexes
   WHERE schemaname = 'accounting'
     AND tablename = 'accounting_configurations'
     AND indexname = 'uq_accounting_configurations_org_active';
  IF definition IS NULL THEN
    RAISE EXCEPTION 'partial unique index uq_accounting_configurations_org_active does not exist';
  END IF;
  IF definition NOT ILIKE '%UNIQUE%' OR definition NOT ILIKE '%WHERE%' OR definition NOT ILIKE '%ACTIVE%' THEN
    RAISE EXCEPTION 'uq_accounting_configurations_org_active is not the expected partial unique index: %', definition;
  END IF;
  RAISE NOTICE 'PASS partial unique index present: %', definition;
END $$;

DO $$
DECLARE
  before_count integer;
  after_count integer;
BEGIN
  SELECT count(*) INTO before_count FROM "accounting"."accounting_configurations" WHERE status = 'ACTIVE';

  BEGIN
    INSERT INTO "accounting"."accounting_configurations"
      ("id", "organization_id", "code", "name", "version_number", "status", "created_at", "updated_at")
    VALUES
      ('probe-second-active', 'org-multi', 'PROBE', 'Second ACTIVE probe', 1, 'ACTIVE', NOW(), NOW());
    RAISE EXCEPTION 'expected partial-index rejection: a SECOND ACTIVE configuration for one organization was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS partial unique index: a second ACTIVE configuration for the same organization is rejected (23505)';
  END;

  SELECT count(*) INTO after_count FROM "accounting"."accounting_configurations" WHERE status = 'ACTIVE';
  IF after_count <> before_count THEN
    RAISE EXCEPTION 'ACTIVE configuration count changed after the rejected insert';
  END IF;
END $$;

DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT organization_id FROM "accounting"."accounting_configurations" WHERE status = 'ACTIVE'
    GROUP BY organization_id HAVING count(*) > 1
  ) duplicates;
  IF bad <> 0 THEN
    RAISE EXCEPTION '% organization(s) have more than one ACTIVE configuration', bad;
  END IF;
  RAISE NOTICE 'PASS exactly one ACTIVE configuration per organization';
END $$;

-- ---------------------------------------------------------------------------
-- 8. level_kind contract: the column is 20 characters wide and never truncates
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  width integer;
BEGIN
  SELECT character_maximum_length INTO width
    FROM information_schema.columns
   WHERE table_schema = 'accounting'
     AND table_name = 'accounting_configuration_levels'
     AND column_name = 'level_kind';
  IF width IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'accounting_configuration_levels.level_kind width is % (expected 20)', width;
  END IF;

  UPDATE "accounting"."accounting_configuration_levels"
     SET level_kind = repeat('k', 20)
   WHERE id = (SELECT id FROM "accounting"."accounting_configuration_levels"
                WHERE accounting_configuration_id IN
                      (SELECT accounting_configuration_id FROM "accounting"."accounts" WHERE organization_id = 'org-multi')
                ORDER BY level_index LIMIT 1);
  RAISE NOTICE 'PASS level_kind: a 20-character value is stored as-is';

  BEGIN
    UPDATE "accounting"."accounting_configuration_levels"
       SET level_kind = repeat('k', 21)
     WHERE id = (SELECT id FROM "accounting"."accounting_configuration_levels"
                  WHERE accounting_configuration_id IN
                        (SELECT accounting_configuration_id FROM "accounting"."accounts" WHERE organization_id = 'org-multi')
                  ORDER BY level_index LIMIT 1);
    RAISE EXCEPTION 'expected length rejection: a 21-character level_kind was accepted (silent widening?)';
  EXCEPTION
    WHEN string_data_right_truncation THEN
      RAISE NOTICE 'PASS level_kind: a 21-character value is REJECTED (22001), never truncated';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Migration completion: every object the migration promises exists
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(expected.name, ', ') INTO missing
  FROM (
    VALUES
      ('table:accounting_configurations'),
      ('table:accounting_configuration_levels'),
      ('index:uq_accounting_configurations_org_code_version'),
      ('index:idx_accounting_configurations_org_status'),
      ('index:idx_accounting_configurations_org_code'),
      ('index:uq_accounting_configuration_levels_config_level'),
      ('index:idx_accounting_configuration_levels_org_config'),
      ('index:idx_accounts_accounting_configuration_id')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'accounting'
      AND c.relname = split_part(expected.name, ':', 2)
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration did not create: %', missing;
  END IF;

  SELECT string_agg(expected.name, ', ') INTO missing
  FROM (
    VALUES
      ('fk_accounts_accounting_configuration'),
      ('fk_accounting_accounts_coding_structure_version'),
      ('fk_accounting_configuration_levels_configuration')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = expected.name
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration did not create constraint(s): %', missing;
  END IF;

  RAISE NOTICE 'PASS migration completion: tables, indexes and foreign keys all exist';
END $$;

DO $$
DECLARE
  accounts_after integer;
BEGIN
  SELECT count(*) INTO accounts_after FROM "accounting"."accounts";
  RAISE NOTICE 'PASS rehearsal summary: % organizations, % accounts, % configurations, % configuration levels',
    (SELECT count(*) FROM "organization"."organizations"),
    accounts_after,
    (SELECT count(*) FROM "accounting"."accounting_configurations"),
    (SELECT count(*) FROM "accounting"."accounting_configuration_levels");
END $$;
