-- Up Migration

-- ---------------------------------------------------------------------------
-- Merging duplicate persons (T-1863, D-446).
--
-- The provider supplies some players under two ids, and D-079 adopted one
-- `person` per id; D-230 gave coaches their own id space, so a man adopted as
-- a player and again as a coach is two rows. A person confirms that two rows
-- are one human (D-446, Option A); this migration is the engine every caller
-- (the `catalog.mjs` command of T-1864, any later admin page) shares.
--
-- `person_merge`: one row per merge. The loser (`from_person_id`) keeps its
-- `person` row as a tombstone (D-094's precedent), so members' message cards,
-- panel links and the audit trail keep their target and are never rewritten;
-- reads resolve a tombstone through this table in one step, because
-- `into_person_id` is never itself merged: merging B into C rewrites every
-- live A -> B to A -> C (flattening). An undone merge keeps its row with who
-- undid it and why; at most one live merge per loser.
--
-- `person_merge_moved`: what each merge changed, so it can be undone exactly.
-- `repointed` rows hold the primary key the row had before the merge;
-- `collision` and `fetch_state` rows hold the whole row the merge deleted (a
-- loser's row that a unique key would have made a duplicate of the
-- survivor's, where the survivor's is kept; and the loser's provider-ask
-- records, deleted so the jobs ask again by every id). Immutable.
--
-- `person_not_duplicate`: a pair a person judged to be two humans. The
-- candidate check of T-1864 leaves it out, and `merge_person` refuses it.
--
-- `merge_person(from, into, actor, reason)`, one transaction:
--   * refuses a pair whose two rows are both on the line-up (starting XI or
--     bench) of one match: two people on one team sheet are two humans. A
--     shared match through statistics, incidents, absences or a coach link
--     alone is NOT refused: the data auditor's review of production
--     (2026-11-17) found that pattern in every checked pair, one id holding
--     the line-up and the other the statistics and events of the same side
--     in the same match (one human split over two ids). A coach appearance is
--     not a line-up appearance (a player-coach is legitimate);
--   * refuses a pair that one incident names together (one id as the person,
--     the other as the related person: a substitution with one off and the
--     other on, an assist to the other's goal): two humans again;
--   * re-points every foreign-key column referencing `person` (24 columns in
--     22 tables, except `panel_post.link_person_id`, which is members'
--     writing and stays on the tombstone), the polymorphic `followed_entity`,
--     `entity_alias`, `entity_media` and `article_entity`, and every
--     `provider_mapping` row of the loser (all providers, player and `coach:`
--     ids alike), so the provider's next answer for the loser's id lands on
--     the survivor;
--   * on a unique-key collision keeps the survivor's row and moves the
--     loser's into `person_merge_moved`; so too a loser's row that exactly
--     repeats one of the survivor's in a table without such a key (a closed
--     club spell, a coaching spell, a transfer: the same facts the provider
--     gave under both ids), so the survivor's page lists it once;
--   * fills only the survivor's empty profile fields from the loser (D-220);
--   * writes `audit_log` (`person.merge`, target the loser): actor, time,
--     reason, the previous value and the counts moved (rule 10).
-- A re-pointed row keeps its `updated_at`: its facts did not change, only
-- whose they are, and a line-up stamped "updated today" years after the
-- match would be the stale-looking-current that rule 4 forbids. That is the
-- one change to `set_updated_at()` below: it leaves `updated_at` alone while
-- the setting `fmip.keep_updated_at` holds the id of the CURRENT transaction,
-- which only these two functions write (transaction-local, and cleared at
-- their end). A value set any other way, for a session, a role or a
-- database, names no running transaction and never matches, so it cannot
-- switch the stamping off.
--
-- `merge_person_undo(merge, actor, reason)` puts every re-pointed key back,
-- restores every deleted row as it was, clears the profile fields the merge
-- filled (when nobody changed them since) and writes `person.unmerge`. It is
-- refused once the survivor has itself been merged further (undo that one
-- first). Rows the provider wrote for the survivor after the merge stay with
-- the survivor. An archived follow is not restored for a member whose
-- account has since been deleted (D-094) or no longer exists. The undo is
-- for recent merges: a column added later to an archived table, NOT NULL
-- without a value in the archived row, makes an old merge's undo fail
-- loudly rather than guess.
--
-- Never touched: `input_snapshot`, `forecast`, predictions, settlements and
-- ratings, none of which names a person (rules 5 and 8); `message.card_id`,
-- `panel_post.link_person_id`, `audit_log.target_id` and
-- `console_audit.target_id`, which keep the tombstone;
-- `unresolved_entity.resolved_internal_id`, the review queue's history,
-- rewritten at the id's next sighting; `training.fixture_lineup` and
-- `training.absence`, which every load replaces whole.
--
-- New tables and functions only; nothing to backfill. The production repair
-- of the existing groups is T-1867, after review. The down section refuses
-- once any merge exists: dropping the tables then would leave tombstones with
-- no redirect and no way back.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- T-1863: `merge_person` and `merge_person_undo` move rows between persons
  -- without changing their facts, and keep their timestamps. They write the
  -- current transaction's id; anything else (a session-wide 'on' included)
  -- never matches.
  IF coalesce(current_setting('fmip.keep_updated_at', true), '') <> '' THEN
    IF current_setting('fmip.keep_updated_at', true) = pg_current_xact_id()::text THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'Trigger function: stamps NEW.updated_at with now(), except while the setting fmip.keep_updated_at holds the current transaction''s id (written only by the person merge functions, T-1863). Attach BEFORE UPDATE on any table with an updated_at column.';

CREATE TABLE person_merge (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_person_id       uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  into_person_id       uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  merged_at            timestamptz NOT NULL DEFAULT now(),
  actor_id             uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  reason               text NOT NULL,
  audit_log_id         uuid REFERENCES audit_log (id) ON DELETE RESTRICT,
  -- The survivor's `updated_at` before the merge, and the profile fields the
  -- merge filled with the values it wrote (each was empty before).
  survivor_updated_at  timestamptz NOT NULL,
  filled               jsonb NOT NULL DEFAULT '{}',
  undone_at            timestamptz,
  undone_by            uuid REFERENCES user_account (id) ON DELETE RESTRICT,
  undo_reason          text,
  undo_audit_log_id    uuid REFERENCES audit_log (id) ON DELETE RESTRICT,
  CONSTRAINT person_merge_not_self CHECK (from_person_id <> into_person_id),
  CONSTRAINT person_merge_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT person_merge_filled_object CHECK (jsonb_typeof(filled) = 'object'),
  CONSTRAINT person_merge_undo_whole CHECK (
    (undone_at IS NULL AND undone_by IS NULL AND undo_reason IS NULL AND undo_audit_log_id IS NULL)
    OR (undone_at IS NOT NULL AND undone_by IS NOT NULL AND btrim(coalesce(undo_reason, '')) <> ''
        AND undo_audit_log_id IS NOT NULL))
);

CREATE UNIQUE INDEX person_merge_one_live_per_person
  ON person_merge (from_person_id) WHERE undone_at IS NULL;
CREATE INDEX person_merge_into_idx ON person_merge (into_person_id) WHERE undone_at IS NULL;

COMMENT ON TABLE person_merge IS
  'T-1863, D-446: one merge of a duplicate person (the loser, a tombstone) into the survivor, by a person with a reason; live while undone_at is null. into_person_id is never itself merged (flattened), so a lookup is one step.';

-- Only the functions below change a merge: flattening moves `into_person_id`
-- of a live merge, the audit row is linked once, and an undo is recorded
-- once. Nothing else is ever rewritten and nothing is deleted.
CREATE FUNCTION person_merge_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a person merge is never deleted; undo it with merge_person_undo'
      USING ERRCODE = 'PL007';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.from_person_id IS DISTINCT FROM OLD.from_person_id
     OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.survivor_updated_at IS DISTINCT FROM OLD.survivor_updated_at
     OR NEW.filled IS DISTINCT FROM OLD.filled
     OR (OLD.audit_log_id IS NOT NULL AND NEW.audit_log_id IS DISTINCT FROM OLD.audit_log_id)
     OR (OLD.undone_at IS NOT NULL AND (
           NEW.undone_at IS DISTINCT FROM OLD.undone_at
           OR NEW.undone_by IS DISTINCT FROM OLD.undone_by
           OR NEW.undo_reason IS DISTINCT FROM OLD.undo_reason
           OR NEW.undo_audit_log_id IS DISTINCT FROM OLD.undo_audit_log_id
           OR NEW.into_person_id IS DISTINCT FROM OLD.into_person_id))
  THEN
    RAISE EXCEPTION 'a person merge is never rewritten'
      USING ERRCODE = 'PL007';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER person_merge_fixed
  BEFORE UPDATE OR DELETE ON person_merge
  FOR EACH ROW EXECUTE FUNCTION person_merge_guard();

CREATE TABLE person_merge_moved (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merge_id    uuid NOT NULL REFERENCES person_merge (id) ON DELETE RESTRICT,
  table_name  text NOT NULL,
  column_name text NOT NULL,
  action      text NOT NULL,
  row         jsonb NOT NULL,
  CONSTRAINT person_merge_moved_action_check
    CHECK (action IN ('repointed', 'collision', 'fetch_state')),
  -- The undo builds its statements from these names: a closed list.
  CONSTRAINT person_merge_moved_table_check CHECK (table_name IN (
    'player_spell', 'fixture', 'fixture_participant', 'incident', 'lineup',
    'fixture_player_stat', 'fixture_absence', 'person_name_fetch', 'person_bio_fetch',
    'team_squad_member', 'player_season_stat', 'player_career_season',
    'player_season_fetch', 'player_career_fetch', 'fixture_player_expected',
    'coach_reference_split', 'coach_spell', 'coach_fetch', 'transfer_listing',
    'person_transfer_fetch', 'absence_history', 'followed_entity', 'entity_alias',
    'entity_media', 'article_entity', 'provider_mapping', 'person_merge')),
  CONSTRAINT person_merge_moved_row_object CHECK (jsonb_typeof(row) = 'object')
);

CREATE INDEX person_merge_moved_merge_idx ON person_merge_moved (merge_id, id);

CREATE TRIGGER person_merge_moved_immutable
  BEFORE UPDATE OR DELETE ON person_merge_moved
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

COMMENT ON TABLE person_merge_moved IS
  'T-1863, D-446: what a person merge changed: the primary key of each re-pointed row (repointed), and each row it deleted whole (collision: the survivor kept its own; fetch_state: the loser''s provider-ask records). Read by merge_person_undo. Immutable.';

CREATE TABLE person_not_duplicate (
  low_person_id  uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  high_person_id uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  reason         text NOT NULL,
  CONSTRAINT person_not_duplicate_pkey PRIMARY KEY (low_person_id, high_person_id),
  CONSTRAINT person_not_duplicate_ordered CHECK (low_person_id < high_person_id),
  CONSTRAINT person_not_duplicate_reason_not_blank CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE person_not_duplicate IS
  'T-1863, D-446: a pair of persons a person judged to be two humans (low id first). Never a merge candidate; merge_person refuses it.';

-- The match whose line-up (starting XI or bench) names both persons, if any:
-- two people on one team sheet are two humans.
CREATE FUNCTION person_shared_lineup_fixture(p_a uuid, p_b uuid) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT pa.fixture_id
    FROM lineup la
    JOIN fixture_participant pa ON pa.id = la.participant_id
    JOIN fixture_participant pb ON pb.fixture_id = pa.fixture_id
    JOIN lineup lb ON lb.participant_id = pb.id
   WHERE la.person_id = p_a
     AND lb.person_id = p_b
   LIMIT 1
$$;

-- The incident that names both persons together, one as its person and the
-- other as its related person (a substitution, an assist), if any: two
-- humans again. Incidents that name only one of them are no evidence.
CREATE FUNCTION person_shared_incident(p_a uuid, p_b uuid) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM incident
   WHERE (person_id = p_a AND related_person_id = p_b)
      OR (person_id = p_b AND related_person_id = p_a)
   LIMIT 1
$$;

-- The survivor a tombstone redirects to, or NULL for a person not merged.
CREATE FUNCTION person_merged_into(p_person uuid) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT into_person_id FROM person_merge
   WHERE from_person_id = p_person AND undone_at IS NULL
$$;

-- Re-points one column from the loser to the survivor, recording the primary
-- key of each row it moves. Internal to merge_person.
CREATE FUNCTION person_merge__repoint(
  p_merge uuid, p_table text, p_column text, p_filter text, p_from uuid, p_into uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_key   text;
  v_where text;
  v_n     integer;
BEGIN
  SELECT string_agg(format('%L, t.%I', a.attname, a.attname), ', ' ORDER BY k.ord)
    INTO v_key
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k (attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indrelid = p_table::regclass AND i.indisprimary;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'table % has no primary key to record', p_table;
  END IF;
  v_where := format('t.%I = $2', p_column) || coalesce(' AND ' || p_filter, '');
  EXECUTE format(
    'INSERT INTO person_merge_moved (merge_id, table_name, column_name, action, row)
     SELECT $1, %L, %L, ''repointed'', jsonb_build_object(%s) FROM %I t WHERE %s',
    p_table, p_column, v_key, p_table, v_where)
  USING p_merge, p_from;
  EXECUTE format('UPDATE %I t SET %I = $3 WHERE %s', p_table, p_column, v_where)
  USING p_merge, p_from, p_into;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Deletes the loser's rows that match `p_where` ($2 is the loser, $3 the
-- survivor), keeping each whole in person_merge_moved. Internal.
CREATE FUNCTION person_merge__remove(
  p_merge uuid, p_table text, p_column text, p_action text, p_where text,
  p_from uuid, p_into uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_n integer;
BEGIN
  EXECUTE format(
    'WITH gone AS (DELETE FROM %I t WHERE %s RETURNING t.*)
     INSERT INTO person_merge_moved (merge_id, table_name, column_name, action, row)
     SELECT $1, %L, %L, %L, to_jsonb(gone) FROM gone',
    p_table, p_where, p_table, p_column, p_action)
  USING p_merge, p_from, p_into;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE FUNCTION merge_person(p_from uuid, p_into uuid, p_actor uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_merge     uuid := gen_random_uuid();
  v_loser     person%ROWTYPE;
  v_survivor  person%ROWTYPE;
  v_shared    uuid;
  v_filled    jsonb;
  v_moved     jsonb := '{}';
  v_removed   jsonb := '{}';
  v_n         integer;
  v_audit     uuid;
  r           record;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'a merge names the person who confirmed it'
      USING ERRCODE = 'PL024', HINT = 'actor';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a merge carries its reason'
      USING ERRCODE = 'PL024', HINT = 'reason';
  END IF;
  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into THEN
    RAISE EXCEPTION 'a merge needs two different persons'
      USING ERRCODE = 'PL024', HINT = 'same_person';
  END IF;

  -- Both rows locked, lower id first, so two merges touching one person queue.
  PERFORM 1 FROM person WHERE id IN (p_from, p_into) ORDER BY id FOR UPDATE;
  SELECT * INTO v_loser FROM person WHERE id = p_from;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no person %', p_from USING ERRCODE = 'PL024', HINT = 'not_found';
  END IF;
  SELECT * INTO v_survivor FROM person WHERE id = p_into;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no person %', p_into USING ERRCODE = 'PL024', HINT = 'not_found';
  END IF;
  IF person_merged_into(p_from) IS NOT NULL THEN
    RAISE EXCEPTION 'person % is already merged into %', p_from, person_merged_into(p_from)
      USING ERRCODE = 'PL024', HINT = 'already_merged';
  END IF;
  IF person_merged_into(p_into) IS NOT NULL THEN
    RAISE EXCEPTION 'person % is merged into %; merge into that one', p_into, person_merged_into(p_into)
      USING ERRCODE = 'PL024', HINT = 'into_merged';
  END IF;
  IF EXISTS (SELECT 1 FROM person_not_duplicate
              WHERE low_person_id = least(p_from, p_into)
                AND high_person_id = greatest(p_from, p_into)) THEN
    RAISE EXCEPTION 'persons % and % were judged to be two people', p_from, p_into
      USING ERRCODE = 'PL024', HINT = 'judged_different';
  END IF;
  v_shared := person_shared_lineup_fixture(p_from, p_into);
  IF v_shared IS NOT NULL THEN
    RAISE EXCEPTION 'persons % and % are both on the line-up of fixture %: two people',
      p_from, p_into, v_shared
      USING ERRCODE = 'PL024', HINT = 'shared_lineup';
  END IF;
  v_shared := person_shared_incident(p_from, p_into);
  IF v_shared IS NOT NULL THEN
    RAISE EXCEPTION 'persons % and % are named together by incident %: two people',
      p_from, p_into, v_shared
      USING ERRCODE = 'PL024', HINT = 'shared_incident';
  END IF;

  -- What the survivor's empty profile fields will take from the loser (D-220).
  v_filled := jsonb_strip_nulls(jsonb_build_object(
    'known_as',       CASE WHEN v_survivor.known_as IS NULL THEN v_loser.known_as END,
    'date_of_birth',  CASE WHEN v_survivor.date_of_birth IS NULL THEN v_loser.date_of_birth END,
    'nationality_id', CASE WHEN v_survivor.nationality_id IS NULL THEN v_loser.nationality_id END,
    'height_cm',      CASE WHEN v_survivor.height_cm IS NULL THEN v_loser.height_cm END,
    'preferred_foot', CASE WHEN v_survivor.preferred_foot IS NULL THEN v_loser.preferred_foot END));

  PERFORM set_config('fmip.keep_updated_at', pg_current_xact_id()::text, true);

  INSERT INTO person_merge (id, from_person_id, into_person_id, actor_id, reason, survivor_updated_at, filled)
  VALUES (v_merge, p_from, p_into, p_actor, p_reason, v_survivor.updated_at, v_filled);

  -- 1. Flatten: whatever was merged into the loser now points at the survivor.
  v_n := person_merge__repoint(v_merge, 'person_merge', 'into_person_id',
                               't.undone_at IS NULL', p_from, p_into);
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('person_merge.into_person_id', v_n); END IF;

  -- 2. Collisions: the survivor's row stays, the loser's is kept aside. The
  --    unique keys first; then, in the tables without one, a loser's row
  --    that repeats a survivor's row in every column but its id, its
  --    person and its timestamps.
  FOR r IN SELECT * FROM (VALUES
    ('player_spell', 'person_id',
     't.person_id = $2 AND t.end_date IS NULL AND EXISTS (SELECT 1 FROM player_spell s
        WHERE s.person_id = $3 AND s.team_id = t.team_id AND s.end_date IS NULL)'),
    ('player_spell', 'person_id',
     't.person_id = $2 AND EXISTS (SELECT 1 FROM player_spell s
        WHERE s.person_id = $3
          AND to_jsonb(s) - ARRAY[''id'', ''person_id'', ''created_at'', ''updated_at'']
            = to_jsonb(t) - ARRAY[''id'', ''person_id'', ''created_at'', ''updated_at''])'),
    ('coach_spell', 'person_id',
     't.person_id = $2 AND EXISTS (SELECT 1 FROM coach_spell s
        WHERE s.person_id = $3
          AND to_jsonb(s) - ARRAY[''id'', ''person_id'', ''fetched_at'']
            = to_jsonb(t) - ARRAY[''id'', ''person_id'', ''fetched_at''])'),
    ('transfer_listing', 'subject_person_id',
     't.subject_person_id = $2 AND EXISTS (SELECT 1 FROM transfer_listing s
        WHERE s.subject_person_id = $3
          AND s.person_id IS NOT DISTINCT FROM (CASE WHEN t.person_id = $2 THEN $3 ELSE t.person_id END)
          AND to_jsonb(s) - ARRAY[''id'', ''subject_person_id'', ''person_id'', ''fetched_at'']
            = to_jsonb(t) - ARRAY[''id'', ''subject_person_id'', ''person_id'', ''fetched_at''])'),
    ('fixture_player_stat', 'person_id',
     't.person_id = $2 AND EXISTS (SELECT 1 FROM fixture_player_stat s
        WHERE s.person_id = $3 AND s.participant_id = t.participant_id AND s.metric = t.metric)'),
    ('fixture_player_expected', 'person_id',
     't.person_id = $2 AND EXISTS (SELECT 1 FROM fixture_player_expected s
        WHERE s.person_id = $3 AND s.participant_id = t.participant_id
          AND s.source = t.source AND s.metric = t.metric)'),
    ('fixture_absence', 'person_id',
     't.person_id = $2 AND EXISTS (SELECT 1 FROM fixture_absence s
        WHERE s.person_id = $3 AND s.fixture_id = t.fixture_id)'),
    ('team_squad_member', 'person_id',
     't.person_id = $2 AND EXISTS (SELECT 1 FROM team_squad_member s
        WHERE s.person_id = $3 AND s.team_id = t.team_id)'),
    ('player_season_stat', 'person_id',
     't.person_id = $2 AND EXISTS (SELECT 1 FROM player_season_stat s
        WHERE s.person_id = $3 AND s.source = t.source AND s.season_year = t.season_year
          AND s.competition_id = t.competition_id AND s.team_id = t.team_id)'),
    ('player_career_season', 'person_id',
     't.person_id = $2 AND EXISTS (SELECT 1 FROM player_career_season s
        WHERE s.person_id = $3 AND s.source = t.source AND s.team_id = t.team_id
          AND s.season_year = t.season_year)'),
    ('followed_entity', 'entity_id',
     't.entity_type = ''person'' AND t.entity_id = $2 AND EXISTS (SELECT 1 FROM followed_entity s
        WHERE s.entity_type = ''person'' AND s.entity_id = $3 AND s.user_id = t.user_id)'),
    ('entity_alias', 'entity_id',
     't.entity_type = ''person'' AND t.entity_id = $2 AND EXISTS (SELECT 1 FROM entity_alias s
        WHERE s.entity_type = ''person'' AND s.entity_id = $3
          AND (search_key(s.alias) = search_key(t.alias)
               OR (s.kind = ''name'' AND t.kind = ''name'' AND s.language = t.language)))'),
    ('entity_media', 'entity_id',
     't.entity_type = ''person'' AND t.entity_id = $2 AND EXISTS (SELECT 1 FROM entity_media s
        WHERE s.entity_type = ''person'' AND s.entity_id = $3 AND s.kind = t.kind)'),
    ('article_entity', 'entity_id',
     't.entity_type = ''person'' AND t.entity_id = $2 AND EXISTS (SELECT 1 FROM article_entity s
        WHERE s.entity_type = ''person'' AND s.entity_id = $3 AND s.article_id = t.article_id)')
  ) AS c (tbl, col, cond)
  LOOP
    v_n := person_merge__remove(v_merge, r.tbl, r.col, 'collision', r.cond, p_from, p_into);
    IF v_n > 0 THEN v_removed := v_removed || jsonb_build_object(r.tbl, coalesce((v_removed ->> r.tbl)::integer, 0) + v_n); END IF;
  END LOOP;

  -- 3. The loser's provider-ask records go, so the jobs ask again by every id.
  FOR r IN SELECT * FROM (VALUES
    ('person_name_fetch'), ('person_bio_fetch'), ('player_season_fetch'),
    ('player_career_fetch'), ('coach_fetch'), ('person_transfer_fetch')
  ) AS c (tbl)
  LOOP
    v_n := person_merge__remove(v_merge, r.tbl, 'person_id', 'fetch_state',
                                't.person_id = $2', p_from, p_into);
    IF v_n > 0 THEN v_removed := v_removed || jsonb_build_object(r.tbl, v_n); END IF;
  END LOOP;

  -- 4. Every remaining reference moves to the survivor.
  FOR r IN SELECT * FROM (VALUES
    ('player_spell', 'person_id', NULL),
    ('fixture', 'referee_id', NULL),
    ('fixture_participant', 'coach_id', NULL),
    ('incident', 'person_id', NULL),
    ('incident', 'related_person_id', NULL),
    ('lineup', 'person_id', NULL),
    ('fixture_player_stat', 'person_id', NULL),
    ('fixture_absence', 'person_id', NULL),
    ('team_squad_member', 'person_id', NULL),
    ('player_season_stat', 'person_id', NULL),
    ('player_career_season', 'person_id', NULL),
    ('fixture_player_expected', 'person_id', NULL),
    ('coach_reference_split', 'person_id', NULL),
    ('coach_spell', 'person_id', NULL),
    ('transfer_listing', 'subject_person_id', NULL),
    ('transfer_listing', 'person_id', NULL),
    ('absence_history', 'person_id', NULL),
    ('followed_entity', 'entity_id', 't.entity_type = ''person'''),
    ('entity_alias', 'entity_id', 't.entity_type = ''person'''),
    ('entity_media', 'entity_id', 't.entity_type = ''person'''),
    ('article_entity', 'entity_id', 't.entity_type = ''person'''),
    ('provider_mapping', 'internal_id', 't.entity_type = ''person''')
  ) AS c (tbl, col, filter)
  LOOP
    v_n := person_merge__repoint(v_merge, r.tbl, r.col, r.filter, p_from, p_into);
    IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object(r.tbl || '.' || r.col, v_n); END IF;
  END LOOP;

  -- 5. The survivor's empty profile fields take the loser's (D-220); nothing
  --    the survivor already has is overwritten.
  IF v_filled <> '{}' THEN
    UPDATE person
       SET known_as       = coalesce(known_as, v_loser.known_as),
           date_of_birth  = coalesce(date_of_birth, v_loser.date_of_birth),
           nationality_id = coalesce(nationality_id, v_loser.nationality_id),
           height_cm      = coalesce(height_cm, v_loser.height_cm),
           preferred_foot = coalesce(preferred_foot, v_loser.preferred_foot),
           updated_at     = now()
     WHERE id = p_into;
  END IF;

  -- 6. Rule 10: who, when, why, the previous value and what moved.
  INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
  VALUES (p_actor, 'person.merge', 'person', p_from::text, p_reason,
          jsonb_build_object(
            'merged_into', NULL,
            'survivor', p_into,
            'survivor_profile', jsonb_build_object(
              'known_as', v_survivor.known_as, 'date_of_birth', v_survivor.date_of_birth,
              'nationality_id', v_survivor.nationality_id, 'height_cm', v_survivor.height_cm,
              'preferred_foot', v_survivor.preferred_foot)),
          jsonb_build_object(
            'merge_id', v_merge, 'merged_into', p_into,
            'repointed', v_moved, 'kept_aside', v_removed, 'filled', v_filled))
  RETURNING id INTO v_audit;
  UPDATE person_merge SET audit_log_id = v_audit WHERE id = v_merge;

  PERFORM set_config('fmip.keep_updated_at', '', true);
  RETURN v_merge;
END;
$$;

COMMENT ON FUNCTION merge_person(uuid, uuid, uuid, text) IS
  'T-1863, D-446: merges the loser (from) into the survivor (into) in one audited transaction and returns the merge id; refuses two persons on one match''s line-up or named together by one incident (PL024, hints shared_lineup, shared_incident).';

CREATE FUNCTION merge_person_undo(p_merge uuid, p_actor uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  m           person_merge%ROWTYPE;
  v_person    person%ROWTYPE;
  v_match     text;
  v_restored  jsonb := '{}';
  v_n         integer;
  v_all       boolean := true;
  v_any       boolean := false;
  v_audit     uuid;
  f           text;
  g           record;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'an undo names the person who asked for it'
      USING ERRCODE = 'PL024', HINT = 'actor';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'an undo carries its reason'
      USING ERRCODE = 'PL024', HINT = 'reason';
  END IF;
  SELECT * INTO m FROM person_merge WHERE id = p_merge FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no person merge %', p_merge USING ERRCODE = 'PL024', HINT = 'not_found';
  END IF;
  IF m.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'person merge % was undone at %', p_merge, m.undone_at
      USING ERRCODE = 'PL024', HINT = 'already_undone';
  END IF;
  PERFORM 1 FROM person WHERE id IN (m.from_person_id, m.into_person_id) ORDER BY id FOR UPDATE;
  -- The survivor merged further: either it is a tombstone now, or a later
  -- live merge flattened this one. That one is undone first.
  IF person_merged_into(m.into_person_id) IS NOT NULL
     OR EXISTS (SELECT 1 FROM person_merge_moved mv
                  JOIN person_merge later ON later.id = mv.merge_id
                 WHERE mv.table_name = 'person_merge' AND mv.row ->> 'id' = p_merge::text
                   AND later.undone_at IS NULL) THEN
    RAISE EXCEPTION 'the survivor of person merge % has been merged since; undo that merge first', p_merge
      USING ERRCODE = 'PL024', HINT = 'survivor_merged';
  END IF;

  PERFORM set_config('fmip.keep_updated_at', pg_current_xact_id()::text, true);

  -- Re-pointed keys go back, newest group first.
  FOR g IN
    SELECT table_name, column_name, max(id) AS last
      FROM person_merge_moved
     WHERE merge_id = p_merge AND action = 'repointed'
     GROUP BY table_name, column_name
     ORDER BY last DESC
  LOOP
    SELECT string_agg(format('t.%I = r.%I', a.attname, a.attname), ' AND ')
      INTO v_match
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) AS k (attnum)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = g.table_name::regclass AND i.indisprimary;
    EXECUTE format(
      'UPDATE %I t SET %I = $2
         FROM person_merge_moved mv
         CROSS JOIN LATERAL jsonb_populate_record(NULL::%I, mv.row || jsonb_build_object(%L, $1)) r
        WHERE mv.merge_id = $3 AND mv.table_name = %L AND mv.column_name = %L
          AND mv.action = ''repointed'' AND %s AND t.%I = $1',
      g.table_name, g.column_name, g.table_name, g.column_name, g.table_name, g.column_name,
      v_match, g.column_name)
    USING m.into_person_id, m.from_person_id, p_merge;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := v_restored || jsonb_build_object(g.table_name || '.' || g.column_name, v_n);
  END LOOP;

  -- Deleted rows come back whole.
  FOR g IN
    SELECT table_name, max(id) AS last
      FROM person_merge_moved
     WHERE merge_id = p_merge AND action IN ('collision', 'fetch_state')
     GROUP BY table_name
     ORDER BY last DESC
  LOOP
    EXECUTE format(
      'INSERT INTO %I OVERRIDING SYSTEM VALUE
       SELECT r.* FROM person_merge_moved mv
        CROSS JOIN LATERAL jsonb_populate_record(NULL::%I, mv.row) r
        WHERE mv.merge_id = $1 AND mv.table_name = %L
          AND mv.action IN (''collision'', ''fetch_state'') %s
        ORDER BY mv.id',
      g.table_name, g.table_name, g.table_name,
      -- A follow comes back only for a member who still has an account
      -- (D-094: a deleted account's follows are gone and stay gone).
      CASE WHEN g.table_name = 'followed_entity' THEN
        'AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = r.user_id AND u.status <> ''deleted'')'
      ELSE '' END)
    USING p_merge;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := v_restored || jsonb_build_object(g.table_name || ' (restored rows)', v_n);
  END LOOP;

  -- The survivor's filled fields are emptied again where they still hold
  -- what the merge wrote; its timestamp returns when nothing else changed it.
  IF m.filled <> '{}' THEN
    SELECT * INTO v_person FROM person WHERE id = m.into_person_id;
    FOR f IN SELECT jsonb_object_keys(m.filled) LOOP
      IF to_jsonb(v_person) -> f = m.filled -> f THEN
        EXECUTE format('UPDATE person SET %I = NULL WHERE id = $1', f) USING m.into_person_id;
        v_any := true;
      ELSE
        v_all := false;
      END IF;
    END LOOP;
    IF v_all AND v_person.updated_at = m.merged_at THEN
      UPDATE person SET updated_at = m.survivor_updated_at WHERE id = m.into_person_id;
    ELSIF v_any THEN
      UPDATE person SET updated_at = now() WHERE id = m.into_person_id;
    END IF;
  END IF;

  INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
  VALUES (p_actor, 'person.unmerge', 'person', m.from_person_id::text, p_reason,
          jsonb_build_object('merge_id', p_merge, 'merged_into', m.into_person_id),
          jsonb_build_object('merge_id', p_merge, 'merged_into', NULL, 'restored', v_restored))
  RETURNING id INTO v_audit;

  UPDATE person_merge
     SET undone_at = now(), undone_by = p_actor, undo_reason = p_reason,
         undo_audit_log_id = v_audit
   WHERE id = p_merge;

  PERFORM set_config('fmip.keep_updated_at', '', true);
END;
$$;

COMMENT ON FUNCTION merge_person_undo(uuid, uuid, text) IS
  'T-1863, D-446: reverses one person merge exactly (re-pointed keys back, deleted rows restored, filled profile fields emptied) and audits it as person.unmerge; refused once the survivor has been merged further (PL024, hint survivor_merged).';

-- Down Migration

-- Once a merge exists, dropping these tables would leave its tombstone with
-- no redirect and no way back: undo the merges first, or keep the migration.
DO $$
BEGIN
  IF to_regclass('person_merge') IS NOT NULL AND EXISTS (SELECT 1 FROM person_merge) THEN
    RAISE EXCEPTION 'person_merge holds % merges; the T-1863 migration is not rolled back over them',
      (SELECT count(*) FROM person_merge);
  END IF;
END
$$;

DROP FUNCTION IF EXISTS merge_person_undo(uuid, uuid, text);
DROP FUNCTION IF EXISTS merge_person(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS person_merge__remove(uuid, text, text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS person_merge__repoint(uuid, text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS person_merged_into(uuid);
DROP FUNCTION IF EXISTS person_shared_lineup_fixture(uuid, uuid);
DROP FUNCTION IF EXISTS person_shared_incident(uuid, uuid);
DROP TABLE IF EXISTS person_not_duplicate;
DROP TABLE IF EXISTS person_merge_moved;
DROP TABLE IF EXISTS person_merge;
DROP FUNCTION IF EXISTS person_merge_guard();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'Trigger function: stamps NEW.updated_at with now(). Attach BEFORE UPDATE on any table with an updated_at column.';
